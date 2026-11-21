// Family key renewal: every way it is triggered, on a local family:
//   node rekey-triggers.mjs <BASE url> <admin-link file>
// Revoking an unused invite; the platinum key holder ending a guest (a renewal
// signed by the platinum phone); deleting a linked person; renewing by hand.
// Also: a phone with the old storage format (one key, no versions) keeps
// working, and an invite sent before two renewals still joins. Prints
// PASS/FAIL lines; exits non-zero on any failure. Never prints links or keys.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [BASE, LINKFILE] = process.argv.slice(2);
if (!BASE || !LINKFILE) {
  console.log('usage: node rekey-triggers.mjs <BASE url> <admin-link file>');
  process.exit(2);
}
const base = BASE.replace(/\/+$/, '');
const repo = process.env.FT_REPO ?? path.resolve(path.dirname(path.resolve(LINKFILE)), '../..');
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
// renewals since the script started: key ids new to the log
let startKids = new Set();
const renewals = async () => new Set((await fetchLog()).map(e => e.kid).filter(k => !startKids.has(k))).size;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const errs = [];
async function phone(name, link) {
  const page = await (await browser.createBrowserContext()).newPage();
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
const ended = p => p.evaluate(() => !!document.querySelector('.join h2')?.innerText.includes('انتهى دخولك') && !localStorage.getItem('ft-family'));
const people = p => p.evaluate(() => Number(document.querySelector('.top .sub b')?.innerText.replace(/,/g, '')));
const version = p => p.evaluate(async () => { const t = [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')); if (t && !document.querySelector('.page.admin')) { t.click(); await new Promise(r => setTimeout(r, 500)); } return [...document.querySelectorAll('.hint')].map(h => h.innerText.match(/الإصدار (\d+)/)?.[1]).find(Boolean); });
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
// the Members row of a person: its cancel / unlink button
const cancelRow = (p, name) => p.evaluate(n => {
  const row = [...document.querySelectorAll('.prow')].find(e => e.querySelector('b')?.innerText.trim() === n && e.querySelector('button[aria-label="إلغاء"]'));
  row?.querySelector('button[aria-label="إلغاء"]').click();
  return !!row;
}, name);
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
const store = (p, k) => p.evaluate(k => localStorage.getItem(k), k);
// names unique to this run, so the script can run again on the same family
const tag = String(Date.now()).slice(-4);

try {
  // ---- set up: A links to the tree and makes P the platinum key holder; P joins
  const A = await phone('A', adminLink);
  await click(A, 'اربط باسمي');
  const me = await pickRow(A, 'منصور', []);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  // the holder's name alone (the keys screen shows only that); on a new family the seat is
  // empty and is given here, and the picker row's whole <b> (name, then the nasab on its own
  // line) also finds exactly the same person in the invite search below
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  let platinum = await A.evaluate(() => { const k = document.querySelector('button.keyrow.platinum'); return k.classList.contains('empty') ? null : k.querySelector('.kn').innerText.trim(); });
  let platinumRow = null;
  if (!platinum) {
    await click(A, 'بلاتيني', 'button.keyrow');
    [platinum, platinumRow] = await A.evaluate(() => {
      const r = document.querySelector('.results .prow'), b = r.querySelector('b');
      const t = [[...b.childNodes].filter(x => x.nodeType === Node.TEXT_NODE).map(x => x.textContent).join('').trim(), b.innerText.trim()];
      r.click();
      return t;
    });
    await wait(1500);
  }
  const used = [me, ...(await A.evaluate(() => [...document.querySelectorAll('.prow b')].map(b => b.innerText.trim())))];
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await A.type('.sfield input', platinum, { delay: 10 }); // the name only: a line break would press Enter
  await wait(600);
  const pWho = await A.evaluate((name, row) => {
    const r = [...document.querySelectorAll('.results .prow')].find(e => (row ? e.querySelector('b').innerText.trim() === row : e.querySelector('b').innerText.trim().startsWith(name)));
    r?.click();
    return r?.querySelector('b').innerText.trim();
  }, platinum, platinumRow);
  check('the platinum key holder is found to invite', !!pWho);
  await wait(1500);
  const pLink = await copyLink(A);
  used.push(pWho);
  const P = await phone('P', pLink);
  await click(P, 'نعم، أنا');
  check('the platinum key holder joined', !!(await until(() => ready(P))));
  // relative to where the family stands, so the script can run again on it (the version A
  // shows: the log may also hold key ids from forged renewals)
  const startLog = await fetchLog();
  startKids = new Set(startLog.map(x => x.kid));
  const kStart = startLog.at(-1).kid;
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  const v0 = Number(await version(A));
  check('A shows the family key version', v0 >= 1);

  // E's invite goes out now and is opened only after two renewals; F's invite is never used
  const e = await invite(A, 'محمد', used); used.push(e.who);
  const f = await invite(A, 'محمد', used); used.push(f.who);

  // ---- 1. revoking an unused invite renews the key (its link carried it)
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  check('A cancels the unused invite', await cancelRow(A, f.who));
  check('a renewal follows', !!(await until(async () => (await renewals()) === 1)) && (await until(async () => (await version(A)) === String(v0 + 1))) === true);
  check("the cancelled invite's link no longer opens anything new", await (async () => {
    const F = await phone('F', f.link);
    return !!(await until(() => ended(F)));
  })());

  // ---- 2. the platinum key holder invites a guest and ends it: P's phone renews the key
  await P.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await P.type('.guestnew input', 'ضيف المفتاح ' + tag, { delay: 10 });
  await P.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(P, 'دعوة زائر للمشاهدة');
  const gLink = await copyLink(P);
  const G = await phone('G', gLink);
  await click(G, 'قبول الدعوة');
  check('the guest joined', !!(await until(() => ready(G))));
  await P.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  const endOk = await P.evaluate(t => { const row = [...document.querySelectorAll('.prow')].find(e => e.innerText.includes(t)); row?.querySelector('button[aria-label="إنهاء"]').click(); return !!row; }, 'ضيف المفتاح ' + tag);
  check('P ends the guest', endOk);
  const log3 = await until(async () => ((await renewals()) === 2 ? fetchLog() : null));
  check('a renewal follows', !!log3);
  if (log3) {
    const k3 = log3.at(-1).kid;
    const rekey = log3[log3.findIndex(x => x.kid === k3) - 1];
    const pDev = JSON.parse(await store(P, 'ft-device')).pk;
    check("it is signed by the platinum holder's phone", rekey.pub === pDev);
  }
  check("the guest's phone removed the family", !!(await until(() => ended(G))));
  check('A follows the renewal made by P', (await until(async () => (await version(A)) === String(v0 + 2))) === true);

  // ---- 3. a phone that still has the old storage format (one key, no versions) keeps working
  await P.evaluate(k1Key => {
    const m = JSON.parse(localStorage.getItem('ft-family'));
    localStorage.setItem('ft-family', JSON.stringify({ fid: m.fid, key: k1Key }));
  }, Object.entries(JSON.parse(await store(P, 'ft-family')).keys).find(([kid]) => kid === kStart)?.[1]);
  await P.reload({ waitUntil: 'networkidle0' });
  await settle(P);
  check('an old-format phone (only the key its link carried) still opens the family after two renewals', !!(await until(() => ready(P))));
  const pm = JSON.parse(await store(P, 'ft-family'));
  check('and its storage is upgraded in place with every version', Object.keys(pm.keys ?? {}).length === v0 + 2 && pm.fid === fid);

  // ---- 4. an invite sent before both renewals still joins
  const E = await phone('E', e.link);
  await click(E, 'نعم، أنا');
  check('an invite sent before two renewals still joins', !!(await until(() => ready(E))));
  await E.reload({ waitUntil: 'networkidle0' });
  await settle(E);
  check('and stays in after reopening the app', !!(await until(() => ready(E))));

  // ---- 5. deleting a linked person renews the key
  await addChild(A, 'مؤقت' + tag);
  const h = await invite(A, 'مؤقت' + tag, used); used.push(h.who);
  const H = await phone('H', h.link);
  await click(H, 'نعم، أنا');
  check('H joined', !!(await until(() => ready(H))));
  await tab(A, 'الشجرة');
  await A.evaluate(() => document.querySelector('.home .search')?.click());
  await wait(400);
  await A.type('.sfield input', 'مؤقت' + tag, { delay: 10 });
  await wait(600);
  await A.evaluate(() => document.querySelector('.results .prow')?.click());
  await wait(1200);
  await click(A, 'الملف الكامل');
  await click(A, 'حذف من الشجرة');
  check('a renewal follows the deletion', !!(await until(async () => (await renewals()) === 3)));
  check("the deleted person's phone removed the family", !!(await until(() => ended(H))));

  // ---- 6. renewing by hand
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await click(A, 'تجديد', '.card.renew button');
  check('A renews by hand', !!(await until(async () => (await renewals()) === 4)) && (await until(async () => (await version(A)) === String(v0 + 4))) === true);
  await addChild(A, 'أخير');
  const n = await people(A);
  for (const [name, p] of [['P', P], ['E', E]]) {
    await tab(p, 'الشجرة');
    check(`${name} still reads everything new`, !!(await until(async () => (await people(p)) === n)));
  }
  const last = await fetchLog();
  const lastKid = last.at(-1).kid;
  check('every entry after the last renewal uses the newest key', last.slice(last.findIndex(x => x.kid === lastKid)).every(x => x.kid === lastKid));
} catch (err) {
  check('script ran to the end', false, err.stack);
}
await browser.close();
check('no page or console errors', errs.length === 0, errs.join(' | '));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
