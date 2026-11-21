// Review: a platinum key holder who turns against the family.
//   node rekey-review-lockout.mjs <BASE url> <admin-link file>
// The platinum holder may renew the family key. Here their phone's key signs
// renewals made outside the app:
// 1. one whose copy for the root admin does not open (every other copy does):
//    it must count nowhere, or the root admin could never read or write again;
// 2. one whose copy for member B does not open: B's phone must not wipe itself
//    (it was not removed), and a fresh invite link brings B back.
// Prints PASS/FAIL lines; exits non-zero on any failure. Never prints links or keys.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [BASE, LINKFILE] = process.argv.slice(2);
if (!BASE || !LINKFILE) {
  console.log('usage: node rekey-review-lockout.mjs <BASE url> <admin-link file>');
  process.exit(2);
}
const base = BASE.replace(/\/+$/, '');
const repo = process.env.FT_REPO ?? path.resolve(path.dirname(path.resolve(LINKFILE)), '../..');
const { makeEntry, entryHash } = await import(path.join(repo, 'src/core/log.ts'));
const { openLog, addKeys } = await import(path.join(repo, 'src/core/keyring.ts'));
const C$ = await import(path.join(repo, 'src/core/crypto.ts'));

const adminLink = (() => {
  const line = fs.readFileSync(LINKFILE, 'utf8').split('\n').find(l => /^https?:\/\/localhost[:/]/.test(l));
  if (!line) throw new Error('no local admin link in the file');
  return base + line.slice(new URL(line).origin.length);
})();
const fid = adminLink.match(/join=([a-z0-9]+)\./)[1];

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
const fetchLog = async () => (await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json()).entries;
const put = async e => (await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) })).status;
async function append(key, signer, payload) {
  for (let i = 0; i < 6; i++) {
    const log = await fetchLog();
    const s = await put(makeEntry(key, signer, log.length, log.length ? entryHash(log.at(-1)) : '', payload));
    if (s !== 409) return s;
  }
  return 409;
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const errs = [];
async function phone(name, link, ctx) {
  const page = await (ctx ?? (await browser.createBrowserContext())).newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(name + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(name + ': ' + m.text()); });
  page.on('dialog', d => d.accept());
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
const people = p => p.evaluate(() => Number(document.querySelector('.top .sub b')?.innerText.replace(/,/g, '')));
const version = async p => { await p.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600))); return Number(await p.evaluate(async () => { const t = [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')); if (t && !document.querySelector('.page.admin')) { t.click(); await new Promise(r => setTimeout(r, 500)); } return [...document.querySelectorAll('.hint')].map(h => h.innerText.match(/الإصدار (\d+)/)?.[1]).find(Boolean); })); };
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
async function invite(p, q, skip, exact = false) {
  await p.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await p.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(p, 'دعوة فرد');
  let who;
  if (exact) {
    // the search skips «بن»: type the first names of the chain, then pick the row that is this person
    await p.type('.sfield input', q.split(/\s+/).filter(w => w !== 'بن' && w !== 'بنت').slice(0, 3).join(' '), { delay: 10 });
    await wait(600);
    who = await p.evaluate(name => { const r = [...document.querySelectorAll('.results .prow')].find(e => e.querySelector('b').innerText.trim().startsWith(name)); r?.click(); return r?.querySelector('b').innerText.trim(); }, q);
    if (!who) console.log('  (no search result for the exact name; results: ' + (await p.evaluate(() => document.querySelectorAll('.results .prow').length)) + ', query length ' + q.length + ', sheet open: ' + (await p.evaluate(() => !!document.querySelector('.sfield input'))) + ')');
    await wait(1500);
  } else who = await pickRow(p, q, skip);
  return { who, link: await copyLink(p) };
}
async function addChild(p, name) {
  await tab(p, 'الشجرة');
  await p.evaluate(() => document.querySelector('.fab').click());
  await wait(600);
  await click(p, 'ابن', '.bigchoice button');
  await click(p, 'التالي');
  await p.type('.bigin', name, { delay: 10 });
  await click(p, 'التالي');
  await click(p, 'التالي');
  await click(p, 'إضافة إلى الشجرة');
  await wait(1500);
}
const tag = String(Date.now()).slice(-4);

// what P's phone can read, and every public key a renewal would need to reach
async function asP(P) {
  const m = JSON.parse(await store(P, 'ft-family'));
  const d = JSON.parse(await store(P, 'ft-device'));
  const log = await fetchLog();
  const ring = new Map();
  addKeys(ring, [m.key, ...Object.values(m.keys ?? {})]);
  const opened = [];
  openLog(log, opened, ring, [d.sk]);
  const pubs = new Set([log[0].pub]);
  for (const p of opened) {
    if (p?.type === 'claim') pubs.add(p.device);
    if (p?.type === 'admin' && p.act.kind === 'invite') pubs.add(p.act.key);
    if (p?.type === 'admin' && p.act.kind === 'self') pubs.add(p.act.device);
    if (p?.type === 'access' && p.act.kind === 'guest') pubs.add(p.act.key);
  }
  const plat = opened.filter(p => p?.type === 'admin' && p.act.kind === 'appoint' && p.act.tier === 'platinum').pop().act.holder;
  return { key: C$.unb64(m.key), dev: { sk: d.sk, pk: d.pk }, admin: log[0].pub, pubs: [...pubs], plat };
}

try {
  // ---- set up: A links to the tree; P holds the platinum key; P and B join
  const A = await phone('A', adminLink);
  await click(A, 'اربط باسمي');
  const me = await pickRow(A, 'منصور', []);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  let platinum = await A.evaluate(() => { const k = document.querySelector('button.keyrow.platinum'); return k.classList.contains('empty') ? null : k.querySelector('.kn').innerText.trim(); });
  if (!platinum) {
    await click(A, 'بلاتيني', 'button.keyrow');
    platinum = await A.evaluate(() => { const r = document.querySelector('.results .prow'); const t = r.querySelector('b').innerText.trim(); r.click(); return t; });
    await wait(1500);
  }
  const used = [me, ...(await A.evaluate(() => [...document.querySelectorAll('.prow b')].map(b => b.innerText.trim())))];
  const p = await invite(A, platinum, used, true); used.push(p.who);
  const P = await phone('P', p.link);
  await click(P, 'نعم، أنا');
  const b = await invite(A, 'محمد', used); used.push(b.who);
  const bCtx = await browser.createBrowserContext();
  const B = await phone('B', b.link, bCtx);
  await click(B, 'نعم، أنا');
  check('P (platinum) and B joined', !!(await until(() => ready(P))) && !!(await until(() => ready(B))));
  const v0 = await version(A);
  const kid0 = (await fetchLog()).at(-1).kid;

  // ---- 1. P renews with a copy for the root admin that does not open
  {
    const f = await asP(P);
    const k3 = C$.newFamilyKey();
    const w = C$.wrapKey(k3, f.pubs);
    w.wraps[f.admin] = C$.wrapKey(C$.newFamilyKey(), [f.admin]).wraps[f.admin];
    const s1 = await append(f.key, f.dev, { type: 'rekey', kid: C$.keyId(k3), ...w, by: f.plat });
    const tx = { id: 'tx-lock-' + tag, at: Date.now(), by: f.plat, title: 'طلب بعد الإقفال ' + tag, subject: f.plat, level: 'everyday', branch: null, ops: [], status: 'pending', approvals: [] };
    const s2 = await append(k3, f.dev, { type: 'propose', tx });
    const s3 = await append(k3, f.dev, { type: 'keys', keys: { [kid0]: C$.b64(f.key) } });
    // what follows under P's own new key: stored, or refused by the server's write check (feat/writegate)
    check('the server stores the renewal and what follows it (or refuses what follows)', s1 === 201 && [s2, s3].every(s => s === 201 || s === 403), [s1, s2, s3].join(' '));
  }
  await wait(4500);
  check('A is still in and shows no error', (await ready(A)) && !(await A.evaluate(() => document.body.innerText.includes('لم يصل مفتاح'))));
  check(`A still shows version ${v0}`, (await version(A)) === v0);
  check('B and P are still in', (await ready(B)) && (await ready(P)));
  await tab(A, 'الطلبات');
  await tab(B, 'الطلبات');
  check('the request under the renewal that shut A out counts nowhere', !(await A.evaluate(t => document.body.innerText.includes(t), 'طلب بعد الإقفال ' + tag)) && !(await B.evaluate(t => document.body.innerText.includes(t), 'طلب بعد الإقفال ' + tag)));
  await tab(A, 'الشجرة');
  const n0 = await people(A);
  await addChild(A, 'بعدالإقفال' + tag);
  const n1 = await people(A);
  check('A adds a person after it', n0 > 0 && n1 === n0 + 1, `${n0} -> ${n1}`);
  for (const [name, q] of [['B', B], ['P', P]]) {
    await tab(q, 'الشجرة');
    check(`${name} reads what A adds next (A can still write)`, !!(await until(async () => (await people(q)) === n1)));
  }
  check('A wrote with the key in force before it', (await fetchLog()).at(-1).kid === kid0);

  // ---- 2. P renews with a copy for B that does not open (the root admin's opens)
  const bPub = JSON.parse(await store(B, 'ft-device')).pk;
  {
    const f = await asP(P);
    const k4 = C$.newFamilyKey();
    const w = C$.wrapKey(k4, f.pubs);
    check('B is among the readers P found', !!w.wraps[bPub]);
    w.wraps[bPub] = C$.wrapKey(C$.newFamilyKey(), [bPub]).wraps[bPub];
    const s = await append(f.key, f.dev, { type: 'rekey', kid: C$.keyId(k4), ...w, by: f.plat });
    check('the server stores it', s === 201, String(s));
  }
  check(`A follows it (version ${v0 + 1})`, (await until(async () => (await version(A)) === v0 + 1)) === true);
  const bBroken = await until(() => B.evaluate(() => document.body.innerText.includes('لم يُفتح مفتاح العائلة الجديد') && !!localStorage.getItem('ft-family')), 15000);
  check("B's phone says the new key did not open, and keeps the family (B was not removed)", !!bBroken, (await B.evaluate(() => document.body.innerText)).slice(0, 200).replace(/\n/g, ' | '));
  // a fresh invite for B's own place brings the phone back
  const b2 = await invite(A, b.who, [], true);
  const B2 = await phone('B2', b2.link, bCtx);
  if (await B2.evaluate(() => [...document.querySelectorAll('button')].some(x => x.textContent.includes('نعم، أنا')))) await click(B2, 'نعم، أنا');
  check('B opens a fresh invite and is back in', !!(await until(() => ready(B2))));
  await tab(A, 'الشجرة');
  const m0 = await people(A);
  await addChild(A, 'بعدالعودة' + tag);
  const n2 = await people(A);
  await tab(B2, 'الشجرة');
  check('B reads what A adds after it', n2 === m0 + 1 && !!(await until(async () => (await people(B2)) === n2)));
} catch (e) {
  check('script ran to the end', false, e.stack);
}
await browser.close();
check('no page or console errors', errs.length === 0, errs.join(' | '));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
