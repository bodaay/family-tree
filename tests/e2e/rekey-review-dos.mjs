// Review: renewals that must not be blocked, and writes with an old key.
//   node rekey-review-dos.mjs <BASE url> <admin-link file>
// 1. Whoever holds an invite link can claim it for any "device" string. Two
//    invites are claimed for keys nobody can hold ('zz', a small-order point):
//    renewals must still go through (before the fix, none ever could).
// 2. The root admin undoes the addition of a person whose phone is linked: the
//    key is renewed and that phone forgets the family.
// 3. That removed phone's old keys keep writing (a request, an access act, a
//    renewal, a keys entry): nobody counts any of it.
// Prints PASS/FAIL lines; exits non-zero on any failure. Never prints links or keys.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [BASE, LINKFILE] = process.argv.slice(2);
if (!BASE || !LINKFILE) {
  console.log('usage: node rekey-review-dos.mjs <BASE url> <admin-link file>');
  process.exit(2);
}
const base = BASE.replace(/\/+$/, '');
const repo = process.env.FT_REPO ?? path.resolve(path.dirname(path.resolve(LINKFILE)), '../..');
const { makeEntry, entryHash } = await import(path.join(repo, 'src/core/log.ts'));
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
// appends one entry at the end of the log, retrying if someone else got there first
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
const toasts = [];
async function phone(name, link) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(name + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(name + ': ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(link, { waitUntil: 'networkidle0' });
  await settle(page);
  // every toast this phone shows, to catch "could not renew"
  await page.exposeFunction('__toast', t => toasts.push(name + ': ' + t)).catch(() => {});
  await page.evaluate(() => {
    new MutationObserver(() => { const t = document.querySelector('.toast'); if (t && t.innerText !== window.__last) { window.__last = t.innerText; window.__toast(t.innerText); } }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
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
const ended = p => p.evaluate(() => !!document.querySelector('.join h2')?.innerText.includes('انتهى دخولك') && !localStorage.getItem('ft-family'));
const people = p => p.evaluate(() => Number(document.querySelector('.top .sub b')?.innerText.replace(/,/g, '')));
const version = async p => { await p.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600))); return Number(await p.evaluate(async () => { const t = [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')); if (t && !document.querySelector('.page.admin')) { t.click(); await new Promise(r => setTimeout(r, 500)); } return [...document.querySelectorAll('.hint')].map(h => h.innerText.match(/الإصدار (\d+)/)?.[1]).find(Boolean); })); };
const changes = async p => { await tab(p, 'أنا'); return p.evaluate(() => [...document.querySelectorAll('.srow')].find(r => r.innerText.includes('التغييرات'))?.querySelector('b').innerText); };
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
const cancelRow = (p, name) => p.evaluate(n => {
  const row = [...document.querySelectorAll('.prow')].find(e => e.querySelector('b')?.innerText.trim() === n && e.querySelector('button[aria-label="إلغاء"]'));
  row?.querySelector('button[aria-label="إلغاء"]').click();
  return !!row;
}, name);
async function addChild(p, name, direct = true) {
  await tab(p, 'الشجرة');
  await p.evaluate(() => document.querySelector('.fab').click());
  await wait(600);
  await click(p, 'ابن', '.bigchoice button');
  await click(p, 'التالي');
  await p.type('.bigin', name, { delay: 10 });
  await click(p, 'التالي');
  await click(p, 'التالي');
  await click(p, direct ? 'إضافة إلى الشجرة' : 'إرسال للاعتماد');
  await wait(1500);
}
const store = (p, k) => p.evaluate(k => localStorage.getItem(k), k);
const inviteSk = link => link.match(/\.i([0-9a-f]{64})/)[1];
const tag = String(Date.now()).slice(-4);

try {
  const A = await phone('A', adminLink);
  await click(A, 'اربط باسمي');
  const me = await pickRow(A, 'منصور', []);
  await tab(A, 'أنا');
  const used = [me, ...(await A.evaluate(() => [...document.querySelectorAll('.prow b')].map(b => b.innerText.trim())))];
  const v0 = await version(A);
  check('A shows the family key version', v0 >= 1);

  // ---- 1. two invites claimed for "devices" nobody can hold
  const x = await invite(A, 'محمد', used); used.push(x.who);
  const y = await invite(A, 'محمد', used); used.push(y.who);
  const cur = C$.unb64(JSON.parse(await store(A, 'ft-family')).key);
  const small = '01' + '00'.repeat(31);
  const sx = await append(cur, C$.deviceFromSecret(inviteSk(x.link)), { type: 'claim', device: 'zz' });
  const sy = await append(cur, C$.deviceFromSecret(inviteSk(y.link)), { type: 'claim', device: small });
  check('the server takes claims for a garbage key and a small-order point', sx === 201 && sy === 201, `${sx} ${sy}`);
  await wait(3500);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  check('A sees both invites as used', !!(await until(() => A.evaluate((a, b) => [a, b].every(n => [...document.querySelectorAll('.prow')].some(e => e.querySelector('b')?.innerText.trim() === n && e.innerText.includes('انضم'))), x.who, y.who))));

  const b = await invite(A, 'محمد', used); used.push(b.who);
  const B = await phone('B', b.link);
  await click(B, 'نعم، أنا');
  if (!check('B joined', !!(await until(() => ready(B))))) console.log('  B shows: ' + (await B.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n/g, ' | ') + ' link? ' + !!b.link);

  // cancelling an unused invite must still renew the key
  const z = await invite(A, 'محمد', used); used.push(z.who);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  const known = new Set((await fetchLog()).map(e => e.kid));
  check('A cancels an unused invite', await cancelRow(A, z.who));
  const renewed = await until(async () => { const l = await fetchLog(); return !known.has(l.at(-1).kid) ? l : null; });
  check('the key is renewed despite the garbage "devices"', !!renewed, toasts.filter(t => t.includes('تعذّر')).join(' | '));
  check(`A shows version ${v0 + 1}`, (await until(async () => (await version(A)) === v0 + 1)) === true);
  check('no "could not renew" message', !toasts.some(t => t.includes('تعذّر')), toasts.join(' | '));
  await addChild(A, 'بعدالتجديد' + tag);
  const n1 = await people(A);
  await tab(B, 'الشجرة');
  check('B still reads what A adds after the renewal', !!(await until(async () => (await people(B)) === n1)));

  // ---- 2. the root admin undoes adding a person whose phone is linked
  await addChild(A, 'مؤقت' + tag);
  const h = await invite(A, 'مؤقت' + tag, used); used.push(h.who);
  const H = await phone('H', h.link);
  await click(H, 'نعم، أنا');
  check('H joined', !!(await until(() => ready(H))));
  const hOld = { m: JSON.parse(await store(H, 'ft-family')), d: JSON.parse(await store(H, 'ft-device')) };
  const known2 = new Set((await fetchLog()).map(e => e.kid));
  await tab(A, 'الطلبات');
  const undone = await A.evaluate(t => {
    const card = [...document.querySelectorAll('.card.hist')].find(c => c.innerText.includes(t) && c.querySelector('button'));
    card?.querySelector('button').click();
    return !!card;
  }, 'مؤقت' + tag);
  check('A undoes the addition from the record', undone);
  check('the key is renewed after the undo', !!(await until(async () => !known2.has((await fetchLog()).at(-1).kid))));
  check("the removed person's phone forgets the family", !!(await until(() => ended(H))));
  const v2 = await version(A);
  check(`A shows version ${v0 + 2}`, v2 === v0 + 2);

  // ---- 3. the removed phone's old keys keep writing: nobody counts it
  const before = await changes(A);
  await tab(A, 'الشجرة');
  const n2 = await people(A);
  const hKey = C$.unb64(hOld.m.key);
  const hDev = { sk: hOld.d.sk, pk: hOld.d.pk };
  const plat = 'nobody';
  const tx = { id: 'tx-old-' + tag, at: Date.now(), by: hOld.m.fid, title: 'طلب بمفتاح قديم ' + tag, subject: me, level: 'everyday', branch: null, ops: [], status: 'pending', approvals: [] };
  const k9 = C$.newFamilyKey();
  const s1 = await append(hKey, hDev, { type: 'propose', tx });
  const s2 = await append(hKey, hDev, { type: 'access', act: { kind: 'viewall', person: me, on: true }, by: plat });
  const s3 = await append(hKey, hDev, { type: 'rekey', kid: C$.keyId(k9), ...C$.wrapKey(k9, [hDev.pk, (await fetchLog())[0].pub]), by: plat });
  const s4 = await append(k9, hDev, { type: 'keys', keys: {} });
  // stored, or refused by the server's write check (feat/writegate): either way nobody may count it
  check('the server stores what the old keys write (it cannot tell), or refuses it', [s1, s2, s3, s4].every(s => s === 201 || s === 403), [s1, s2, s3, s4].join(' '));
  await wait(4500);
  check('A and B are still in', (await ready(A)) && (await ready(B)));
  check('A still shows the same key version', (await version(A)) === v2);
  check("A's change count ignores them", (await changes(A)) === before, `${before} -> ${await changes(A)}`);
  await tab(A, 'الطلبات');
  check('the request sealed with the old key is not listed', !(await A.evaluate(t => document.body.innerText.includes(t), 'طلب بمفتاح قديم ' + tag)));
  await addChild(A, 'أخير' + tag);
  await tab(B, 'الشجرة');
  check('A and B read what A adds next', n2 > 0 && (await people(A)) === n2 + 1 && !!(await until(async () => (await people(B)) === n2 + 1)));
  const last = await fetchLog();
  check('A wrote with the current key, not the old one', last.at(-1).kid !== hOld.m.key && C$.keyId(hKey) !== last.at(-1).kid && C$.keyId(k9) !== last.at(-1).kid);
} catch (e) {
  check('script ran to the end', false, e.stack);
}
await browser.close();
check('no page or console errors', errs.length === 0, errs.join(' | '));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
