// The server's write check, end to end on a family made by today's init script:
//   node writegate-flow.mjs <BASE url> <admin-link file>
// 1. Before the root admin's phone opens, nothing is registered: anyone who
//    knows the family id can append, including junk (sealed with no key, with
//    the family key but in no shape the app writes, not even JSON). It is stored.
// 2. The root admin's phone opens: it is not stalled by the junk, and it
//    registers the write key. From then on the server refuses entries without
//    the write signature (an older app version, an outsider) or with a wrong one.
// 3. Members join and keep writing. Junk from someone holding the current key
//    is still stored, and no phone stalls on it.
// 4. The root admin unlinks C: the key is renewed and the server moves to the new
//    write key with the renewal. Anything written with C's old membership is
//    refused. B, whose phone has not seen the renewal yet, is refused once, learns
//    the new key and writes again without noticing.
// 5. B moves the write key with a renewal of their own (they hold the current
//    key): the root admin's open phone puts it back by itself. With the root
//    admin's phone closed, B's phone says clearly why it cannot save; when the
//    root admin's phone opens again it puts it right and B saves.
// Prints PASS/FAIL lines; exits non-zero on any failure, page error or console
// error. Never prints links or keys.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [BASE, LINKFILE] = process.argv.slice(2);
if (!BASE || !LINKFILE) {
  console.log('usage: node writegate-flow.mjs <BASE url> <admin-link file>');
  process.exit(2);
}
const base = BASE.replace(/\/+$/, '');
const repo = process.env.FT_REPO ?? path.resolve(path.dirname(path.resolve(LINKFILE)), '../..');
const L$ = await import(path.join(repo, 'src/core/log.ts'));
const C$ = await import(path.join(repo, 'src/core/crypto.ts'));
const { gcm } = await import(path.join(repo, 'node_modules/@noble/ciphers/aes.js'));

const adminLink = (() => {
  const line = fs.readFileSync(LINKFILE, 'utf8').split('\n').find(l => /^https?:\/\/localhost[:/]/.test(l));
  if (!line) throw new Error('no local admin link in the file');
  return base + line.slice(new URL(line).origin.length);
})();
const fid = adminLink.match(/join=([a-z0-9]+)\./)[1];
const k1 = C$.unb64(adminLink.match(/join=[a-z0-9]+\.([A-Za-z0-9_-]+)/)[1]);
const w1 = C$.writeKeyOf(k1).pk;

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' - ' + detail : ''}`);
  return ok;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 400) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = null; }
    if (v || Date.now() > end) return v;
    await wait(step);
  }
}
const server = async () => (await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json());
const fetchLog = async () => (await server()).entries;
const put = async e => {
  const r = await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
  return { status: r.status, body: await r.json() };
};
const old = e => { const { w, ...rest } = e; return rest; };
// the next entry at the end of the log; `shape` may change it before it is sent
async function append(key, signer, payload, { nw, shape = e => e } = {}) {
  for (let i = 0; i < 6; i++) {
    const log = await fetchLog();
    const r = await put(shape(L$.makeEntry(key, signer, log.length, log.length ? L$.entryHash(log.at(-1)) : '', payload, nw)));
    if (r.status !== 409) return r;
  }
  return { status: 409 };
}
// junk a key holder can write: no JSON, not an object, and known kinds in shapes the app never writes
async function junk(key, signer, sign = true) {
  const statuses = [];
  const shape = sign ? e => e : old;
  const notJson = e => {
    const nonce = C$.randomBytes(12);
    const out = { ...e, nonce: C$.b64(nonce), ct: C$.b64(gcm(key, nonce).encrypt(new TextEncoder().encode('{"type": "propose", "tx"'))) };
    // signed again over what is sent (the server checks the signature)
    const body = [out.v, out.n, out.prev, out.at, out.pub, out.kid, out.nonce, out.ct];
    out.sig = C$.sign(signer.sk, new TextEncoder().encode(JSON.stringify(body)));
    delete out.w;
    return sign ? { ...out, w: C$.sign(C$.writeKeyOf(key).sk, new TextEncoder().encode(JSON.stringify(['ft-write:v1', L$.entryHash(out), null]))) } : out;
  };
  statuses.push((await append(key, signer, { type: 'keys', keys: {} }, { shape: notJson })).status);
  for (const p of [null, 42, { type: 'propose' }, { type: 'propose', tx: { id: 'x', ops: 'all' } }, { type: 'admin', act: null, by: null }, { type: 'claim', device: { pk: 1 } }, { type: 'approve', txId: { a: 1 } }]) {
    statuses.push((await append(key, signer, p, { shape })).status);
  }
  return statuses;
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const errs = [];
const toasts = [];
// a refusal this script sets up on purpose shows in the console as a failed request: only those are expected
const expected = new Set();
async function phone(name, link, ctx) {
  const page = await (ctx ?? (await browser.createBrowserContext())).newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(name + ': ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (expected.has(name) && /status of 403/.test(m.text())) return;
    errs.push(name + ': ' + m.text());
  });
  page.on('dialog', d => d.accept());
  await page.exposeFunction('__toast', t => toasts.push(name + ': ' + t)).catch(() => {});
  await page.evaluateOnNewDocument(() => {
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => { const t = document.querySelector('.toast'); if (t && t.innerText !== window.__last) { window.__last = t.innerText; window.__toast(t.innerText); } }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  });
  await page.goto(link, { waitUntil: 'networkidle0' });
  await settle(page);
  return page;
}
const settle = async p => { await until(() => p.evaluate(() => !document.querySelector('.wl-mark.spin'))); await wait(600); };
const click = async (p, text, sel = 'button') => {
  const ok = await p.evaluate((t, s) => { const b = [...document.querySelectorAll(s)].find(e => e.textContent.includes(t)); b?.click(); return !!b; }, text, sel);
  if (!ok) console.log('  (button not found: ' + text + ')');
  await wait(700);
  return ok;
};
const tab = (p, label) => click(p, label, '.tab');
const ready = p => p.evaluate(() => !!document.querySelector('nav.tabs') && !document.querySelector('.join'));
const people = async p => Number((await p.evaluate(() => document.querySelector('.top .sub b')?.innerText ?? '')).replace(/[^\d]/g, ''));
const store = (p, k) => p.evaluate(k => localStorage.getItem(k), k);
async function pickRow(p, q, skip) {
  await p.type('.sfield input', q, { delay: 10 });
  await wait(600);
  const who = await p.evaluate(sk => {
    const r = [...document.querySelectorAll('.results .prow')].find(e => !sk.includes(e.querySelector('b').innerText.trim()));
    r?.click();
    return r?.querySelector('b').innerText.trim();
  }, skip);
  await wait(1500);
  return who;
}
async function copyLink(p) {
  await until(() => p.evaluate(() => !!document.querySelector('.modal.invite')));
  await p.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async t => { window.__copied = t; }; });
  await click(p, 'نسخ الرابط');
  const link = await p.evaluate(() => window.__copied);
  await click(p, 'إغلاق', '.mhead button');
  return link;
}
async function invite(p, q, skip) {
  await p.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await p.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(p, 'دعوة فرد');
  const who = await pickRow(p, q, skip);
  return { who, link: await copyLink(p) };
}
async function addChild(p, name, direct) {
  await tab(p, 'الشجرة');
  await p.evaluate(() => document.querySelector('.fab').click());
  await wait(600);
  await click(p, 'ابن', '.bigchoice button');
  await click(p, 'التالي');
  await p.type('.bigin', name, { delay: 10 });
  await click(p, 'التالي');
  // a brother by the same name: carry on
  await p.evaluate(() => [...document.querySelectorAll('.modal button')].find(b => b.textContent.includes('متابعة'))?.click());
  await click(p, 'التالي');
  await click(p, direct ? 'إضافة إلى الشجرة' : 'إرسال للاعتماد');
  await wait(1500);
}
const requestSeen = (p, t) => until(async () => { await tab(p, 'الطلبات'); return p.evaluate(t => [...document.querySelectorAll('.card.req h4')].some(h => h.innerText.includes(t)), t); });
const tag = String(Date.now()).slice(-4);

try {
  // ---- 1. a family from before the write check
  const outsider = C$.newDeviceKey();
  let s0 = await server();
  check('the new family has no write key registered yet', s0.wk === null && s0.entries.length === 1, JSON.stringify({ wk: s0.wk, n: s0.entries.length }));
  {
    const sealedElsewhere = await append(C$.newFamilyKey(), outsider, { type: 'keys', keys: {} }, { shape: old });
    const pretend = await append(C$.newFamilyKey(), outsider, { type: 'writekey', kid: 'x' }, { nw: C$.writeKeyOf(C$.newFamilyKey()).pk });
    const withKey = await junk(k1, outsider, false);
    check('before registration the server takes anything signed: an outsider, an old link holder, junk of every kind', [sealedElsewhere.status, pretend.status, ...withKey].every(s => s === 201), JSON.stringify([sealedElsewhere.status, pretend.status, ...withKey]));
    check('an outsider naming a write key registers nothing', (await server()).wk === null);
  }
  const junkBefore = (await fetchLog()).length - 1;

  // ---- 2. the root admin's phone opens and registers the write key
  const A = await phone('A', adminLink);
  check("the root admin's phone opens the family despite the junk before it", (await ready(A)) && (await people(A)) > 0);
  check("the root admin's phone registers the write key on its own", !!(await until(async () => (await server()).wk === w1)));
  {
    const log = await fetchLog();
    const reg = log.filter(e => e.nw);
    const adminPub = log[0].pub;
    check('it did so with one entry of its own, signed with the root admin key', reg.filter(e => e.pub === adminPub).length === 1 && reg.find(e => e.pub === adminPub).nw === w1);
    let prev = '';
    check('the whole log still verifies (old entries and new)', log.every(e => { const ok = !L$.checkEntry(e, prev); prev = L$.entryHash(e); return ok; }));
  }
  {
    const oldApp = await append(k1, outsider, { type: 'keys', keys: {} }, { shape: old });
    const wrongKey = await append(C$.newFamilyKey(), outsider, { type: 'keys', keys: {} });
    const notAdmin = await append(C$.newFamilyKey(), outsider, { type: 'writekey', kid: 'x' }, { nw: C$.writeKeyOf(C$.newFamilyKey()).pk });
    check('after it, an entry without the write signature (an older app, or an outsider) is refused', oldApp.status === 403 && oldApp.body.error === 'wrong write key' && oldApp.body.wk === w1, JSON.stringify(oldApp));
    check('an entry signed with another key is refused, and so is one naming a new write key without the current one', wrongKey.status === 403 && notAdmin.status === 403, `${wrongKey.status} ${notAdmin.status}`);
    check('the write key is still the one registered', (await server()).wk === w1);
  }

  // ---- 3. members join and keep writing; junk from a key holder does not stall anyone
  await click(A, 'اربط باسمي');
  const me = await pickRow(A, 'منصور', []);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  const used = [me, ...(await A.evaluate(() => [...document.querySelectorAll('.prow b')].map(b => b.innerText.trim())))];
  const b = await invite(A, 'محمد', used); used.push(b.who);
  const c = await invite(A, 'محمد', used); used.push(c.who);
  const bCtx = await browser.createBrowserContext();
  const B = await phone('B', b.link, bCtx);
  await click(B, 'نعم، أنا');
  const C = await phone('C', c.link);
  await click(C, 'نعم، أنا');
  check('B and C joined (their claims passed the write check)', !!(await until(() => ready(B))) && !!(await until(() => ready(C))));
  await addChild(B, 'طلبب' + tag, false);
  check("B's request reaches A", !!(await requestSeen(A, 'طلبب' + tag)));
  const bm = JSON.parse(await store(B, 'ft-family'));
  const bd = JSON.parse(await store(B, 'ft-device'));
  const statuses = await junk(C$.unb64(bm.key), bd);
  check('junk from someone holding the current key is still stored (the server cannot read it)', statuses.every(s => s === 201), statuses.join(' '));
  await wait(3500);
  await tab(A, 'الشجرة');
  const n0 = await people(A);
  await addChild(A, 'بعدالخلط' + tag, true);
  check('A keeps writing after it', (await people(A)) === n0 + 1);
  await tab(B, 'الشجرة');
  check('B keeps reading after it (no phone stalls on junk)', !!(await until(async () => (await people(B)) === n0 + 1)));
  check('A and B are still in, with no error', (await ready(A)) && (await ready(B)) && !(await A.evaluate(() => !!document.querySelector('.join, .err'))));

  // ---- 4. A unlinks C: the key is renewed, and the server moves to the new write key with it
  const cOld = { m: JSON.parse(await store(C, 'ft-family')), d: JSON.parse(await store(C, 'ft-device')) };
  // B's phone stops hearing about new entries (as if it were offline) until it next writes
  await B.setRequestInterception(true);
  let stale = true;
  const offline = r => {
    const u = r.url();
    if (r.method() === 'PUT' && u.includes('/api/f/')) stale = false;
    if (stale && r.method() === 'GET' && u.includes(`/api/f/${fid}/log?after=`)) return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], wk: w1 }) });
    r.continue();
  };
  B.on('request', offline);
  const refusedB = [];
  B.on('response', r => { if (r.request().method() === 'PUT' && r.status() === 403) refusedB.push(r.url()); });
  expected.add('B');
  const known = new Set((await fetchLog()).map(e => e.kid));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  check('A unlinks C from the members list', await A.evaluate(name => {
    const row = [...document.querySelectorAll('.prow')].find(e => e.querySelector('b')?.innerText.trim() === name && e.innerText.includes('انضم'));
    row?.querySelector('button[aria-label="إلغاء"]').click();
    return !!row;
  }, c.who));
  const renewed = await until(async () => { const s = await server(); return s.wk !== w1 && s.entries.some(e => !known.has(e.kid)) ? s : null; });
  check('the key is renewed and the server moved to a new write key', !!renewed);
  const rekey = renewed.entries.find(e => e.nw === renewed.wk);
  check('the renewal itself carried the new write key, signed by the root admin', !!rekey && rekey.pub === renewed.entries[0].pub && L$.nextWriteKey(rekey) === renewed.wk);
  check("C's phone forgets the family", !!(await until(() => C.evaluate(() => document.querySelector('.join h2')?.innerText.includes('انتهى دخولك') && !localStorage.getItem('ft-family')))));
  {
    const cKey = C$.unb64(cOld.m.key);
    const tx = { id: 'tx-c-' + tag, at: Date.now(), by: c.who, title: 'طلب بعد الفصل ' + tag, subject: me, level: 'everyday', branch: null, ops: [], status: 'pending', approvals: [] };
    const r1 = await append(cKey, cOld.d, { type: 'propose', tx });
    const r2 = await append(cKey, cOld.d, { type: 'claim', device: cOld.d.pk });
    const k9 = C$.newFamilyKey();
    const r3 = await append(cKey, cOld.d, { type: 'rekey', kid: C$.keyId(k9), ...C$.wrapKey(k9, [cOld.d.pk]), by: null }, { nw: C$.writeKeyOf(k9).pk });
    const r4 = await append(cKey, cOld.d, { type: 'propose', tx }, { shape: old });
    check("C's old membership cannot append anything: a request, a claim, a renewal of its own, an old-format entry", [r1, r2, r3, r4].every(r => r.status === 403), [r1, r2, r3, r4].map(r => r.status).join(' '));
    check('nor move the write key', (await server()).wk === renewed.wk);
  }
  // B writes from where it stood: refused once, learns the new key, writes again
  await addChild(B, 'بعدالتجديد' + tag, false);
  check("B's write with the old key was refused by the server", refusedB.length >= 1, String(refusedB.length));
  check("B's request still reaches A, with the new key", !!(await requestSeen(A, 'بعدالتجديد' + tag)));
  {
    const bNow = JSON.parse(await store(B, 'ft-family'));
    const last = (await fetchLog()).filter(e => e.pub === bd.pk).at(-1);
    check('B now holds the new key, and wrote with it', C$.writeKeyOf(C$.unb64(bNow.key)).pk === renewed.wk && last.kid === C$.keyId(C$.unb64(bNow.key)));
  }
  check('B saw no error', !toasts.some(t => t.startsWith('B: ') && t.includes('تعذّر')), toasts.join(' | '));
  B.off('request', offline);
  await B.setRequestInterception(false);
  expected.delete('B');

  // ---- 5. B moves the write key with a renewal of their own: the root admin's phone puts it back
  const k2 = C$.unb64(JSON.parse(await store(B, 'ft-family')).key);
  const w2 = C$.writeKeyOf(k2).pk;
  const rogue = async () => {
    const kx = C$.newFamilyKey();
    return append(k2, bd, { type: 'rekey', kid: C$.keyId(kx), ...C$.wrapKey(kx, [bd.pk]), by: null }, { nw: C$.writeKeyOf(kx).pk });
  };
  check("B's own renewal is stored and moves the write key", (await rogue()).status === 201 && (await server()).wk !== w2);
  check("the root admin's open phone puts it back by itself", !!(await until(async () => (await server()).wk === w2)));
  await addChild(B, 'بعدالإصلاح' + tag, false);
  check('B writes again', !!(await requestSeen(A, 'بعدالإصلاح' + tag)));
  // with the root admin's phone closed
  const aCtx = A.browserContext();
  await A.close();
  check('again, with the root admin away', (await rogue()).status === 201 && (await server()).wk !== w2);
  expected.add('B');
  await addChild(B, 'أثناءالعطل' + tag, false);
  check("B's phone says why it cannot save", !!(await until(() => toasts.some(t => t.startsWith('B: ') && t.includes('مفتاح الكتابة على الخادم لا يطابق')), 6000)), toasts.slice(-3).join(' | '));
  const A2 = await phone('A2', base + '/', aCtx);
  check("the root admin's phone opens again and puts it right", (await ready(A2)) && !!(await until(async () => (await server()).wk === w2)));
  expected.delete('B');
  await addChild(B, 'بعدالعودة' + tag, false);
  check('B saves again', !!(await requestSeen(A2, 'بعدالعودة' + tag)));
  check('A and B are still in', (await ready(A2)) && (await ready(B)));
  const junkAll = (await fetchLog()).length;
  check(`no phone stalled on junk (${junkBefore} entries appended before the write key, more after)`, junkAll > junkBefore);
} catch (e) {
  check('script ran to the end', false, e.stack);
}
await browser.close();
check('no page or console errors', errs.length === 0, errs.join(' | '));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
