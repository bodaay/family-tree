// Review of feat/permissions: the members and view-all lists open a person's
// permissions from their name (now a real button), and still look as before.
// Needs a fresh local test family.
//   node perm-review-lists.mjs <BASE> <admin-link-file> [screenshot dir]
// Never prints links or keys: the link file is read here and used only in the browser.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = (process.argv[2] ?? 'http://localhost:5186').replace(/\/+$/, '');
const linkFile = process.argv[3];
const out = process.argv[4] ?? null;
if (!linkFile) { console.log('usage: node perm-review-lists.mjs BASE admin-link-file [shots]'); process.exit(2); }
const adminLink = fs.readFileSync(linkFile, 'utf8').split('\n').find(l => l.startsWith('http://localhost'))?.trim().replace(/^http:\/\/localhost:\d+/, BASE);
if (!adminLink) { console.log('FAIL no admin link in the file'); process.exit(1); }
const hide = t => String(t).replace(/#join=[^\s'"]*/g, '#join=<hidden>').replace(/[0-9a-f]{64}/g, '<hex>');

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const errs = [];
let failed = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (ok, label, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' · ' + hide(extra) : ''}`); return ok; };
const shot = async (p, name) => { if (out) await p.screenshot({ path: `${out}/${name}.png` }); };

const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => errs.push(hide(e.message)));
page.on('console', m => { if (m.type() === 'error') errs.push(hide(m.text())); });
page.on('dialog', d => d.accept());
await page.goto(adminLink, { waitUntil: 'networkidle0' }); await wait(1500);
const A = page;
const click = async (text, sel = 'button') => {
  const ok = await A.evaluate((t, s) => { const b = [...document.querySelectorAll(s)].find(e => e.textContent.includes(t)); b?.click(); return !!b; }, text, sel);
  if (!ok) check(false, 'button found: ' + text);
  await wait(700);
};
const pick = async (q, year) => {
  await A.type('.sfield input', q, { delay: 10 }); await wait(500);
  const ok = await A.evaluate(y => { const r = [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y)); r?.click(); return !!r; }, year);
  if (!ok) check(false, 'search result ' + q);
  await wait(1500);
};
await click('اربط باسمي'); await pick('منصور', '1963');
await click('الإدارة', '.tab');
await click('دعوة فرد'); await pick('ماجد', '1953');
await click('إغلاق', '.mhead button');
await click('منح فرد مشاهدة الكل'); await pick('وليد', '1956');
const rows = await A.evaluate(() => [...document.querySelectorAll(':is(.page.me, .page.admin) .prow .pt.tap')].map(e => {
  const r = e.getBoundingClientRect(), b = e.querySelector('b').getBoundingClientRect(), row = e.closest('.prow').getBoundingClientRect();
  return { tag: e.tagName, text: e.innerText.replace(/\s+/g, ' '), right: Math.round(row.right - b.right), align: getComputedStyle(e).textAlign, h: Math.round(r.height), focusable: e.tabIndex >= 0 };
}));
check(rows.length === 2 && rows.every(r => r.tag === 'BUTTON' && r.focusable), 'names in both lists are focusable buttons', JSON.stringify(rows.map(r => r.tag)));
check(rows.every(r => r.right < 70 && r.align !== 'center'), 'names stay at the start of the row (right, in Arabic)', JSON.stringify(rows.map(r => [r.right, r.align])));
await A.evaluate(() => [...document.querySelectorAll('h3')].find(h => h.textContent.includes('الأعضاء'))?.scrollIntoView()); await wait(300);
await shot(A, 'lists-members');
await A.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]); await wait(400);
await shot(A, 'lists-members-light');
// keyboard: focus the name and press Enter
await A.evaluate(() => [...document.querySelectorAll(':is(.page.me, .page.admin) .prow .pt.tap')].find(e => e.innerText.includes('وليد')).focus());
await A.keyboard.press('Enter'); await wait(900);
const at = await A.evaluate(() => { const s = document.querySelector('.page.profile section.perms'); const r = s?.getBoundingClientRect(); return s ? { seg: s.querySelector('.seg.viewall .on')?.innerText, top: Math.round(r.top) } : null; });
check(at?.seg === 'مفعّلة' && at.top >= 0 && at.top < 460, 'Enter on a view-all name opens his permissions, scrolled to them', JSON.stringify(at));
await A.evaluate(() => document.querySelector('.page.profile .navbtns .round').click()); await wait(400);
await A.evaluate(() => [...document.querySelectorAll(':is(.page.me, .page.admin) .prow .pt.tap')].find(e => e.innerText.includes('ماجد')).click()); await wait(900);
check(await A.evaluate(() => document.querySelector('.page.profile section.perms')?.innerText.includes('دعوة بانتظار الانضمام')), 'tapping an invited member opens his permissions with the pending invite');

await browser.close();
if (errs.length) { failed++; console.log('FAIL page errors:\n' + errs.join('\n')); }
console.log(failed ? `FAIL (${failed})` : 'PASS');
process.exit(failed ? 1 : 0);
