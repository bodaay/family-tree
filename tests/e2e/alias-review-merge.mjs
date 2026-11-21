// Merging two records with different names, as the root admin:
//   node alias-review-merge.mjs <BASE url> <admin-link file>
// The record whose profile is open (and focused in the tree) is the one merged
// away: the kept record takes its child, its name (as «اسم يُعرف به»), its
// kunya and its birth year; the profile and the tree move to the kept record.
// Undoing from the Requests tab brings both back exactly. A daughter entered
// twice gets the duplicate question in the feminine.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [BASE, LINKFILE] = process.argv.slice(2);
if (!BASE || !LINKFILE) {
  console.log('usage: node alias-review-merge.mjs <BASE url> <admin-link file>');
  process.exit(2);
}
// the admin link is used, never printed
const line = fs.readFileSync(LINKFILE, 'utf8').split('\n').find(l => l.includes('#join='));
if (!line) {
  console.log('FAIL no admin link in the file');
  process.exit(1);
}
const adminLink = BASE.replace(/\/+$/, '') + line.trim().slice(line.trim().indexOf('/#join='));
const redact = t => String(t).replace(/#join=\S*/g, '#join=…');
const SHOTS = process.env.SHOTS;

let failures = 0;
const check = (ok, msg) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + msg);
  if (!ok) failures++;
};
const errs = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const LETTERS = 'بتثجحخدذرزسشصضطظعغفقكلمن';
const uniq = (n = 6) => Array.from({ length: n }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
async function phone(name, url) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(name + ': ' + e.message));
  page.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()));
  page.on('dialog', d => d.accept());
  await page.goto(url, { waitUntil: 'networkidle0' });
  await wait(1500);
  return page;
}
const click = async (p, text, sel = 'button') => {
  const ok = await p.evaluate((t, s) => {
    const b = [...document.querySelectorAll(s)].find(e => e.textContent.includes(t) && !e.disabled);
    b?.click();
    return !!b;
  }, text, sel);
  if (!ok) throw new Error('not found: ' + text + ' in ' + sel);
  await wait(700);
};
const has = (p, sel, text = '') => p.evaluate((s, t) => [...document.querySelectorAll(s)].some(e => e.textContent.includes(t)), sel, text);
const textOf = (p, sel) => p.evaluate(s => document.querySelector(s)?.innerText ?? '', sel);
const shot = async (p, name) => SHOTS && p.screenshot({ path: `${SHOTS}/${name}.png` });
const search = async (p, q) => {
  if (!(await has(p, '.sfield input'))) {
    await p.evaluate(() => document.querySelector('.home .search').click());
    await wait(400);
  }
  await p.evaluate(() => {
    const i = document.querySelector('.sfield input');
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.type('.sfield input', q, { delay: 8 });
  await wait(500);
  return p.evaluate(() => [...document.querySelectorAll('.results .prow')].map(r => r.innerText.replace(/\s+/g, ' ')));
};
const closeSearch = async p => {
  if (await has(p, '.searchpage')) await p.evaluate(() => document.querySelector('.searchpage .shead .round').click());
  await wait(300);
};
const pickRow = async (p, text) => {
  await p.evaluate(t => [...document.querySelectorAll('.results .prow')].find(r => r.innerText.includes(t)).click(), text);
  await wait(1200);
};
const toTree = async p => {
  for (let i = 0; i < 4 && (await has(p, '.page.profile')); i++) {
    await p.evaluate(() => document.querySelector('.navbtns .round').click());
    await wait(400);
  }
  await click(p, 'الشجرة', '.tab');
  if (await has(p, '.searchbar')) await p.evaluate(() => document.querySelector('.searchbar .round').click());
  await wait(300);
};
const openPerson = async (p, q, pickText) => {
  await toTree(p);
  await search(p, q);
  await pickRow(p, pickText);
  await click(p, 'الملف الكامل');
};
const openKid = async (p, name) => {
  await p.evaluate(n => [...document.querySelectorAll('.fam .fp')].find(k => k.querySelector('b').innerText.trim() === n).click(), name);
  await wait(800);
};
const addChild = async (p, sex, name) => {
  await click(p, 'إضافة ابن أو ابنة', '.link');
  await click(p, sex === 'f' ? 'ابنة' : 'ابن', '.bigchoice button');
  await click(p, 'التالي', '.foot button');
  await p.type('.addsheet .bigin', name, { delay: 8 });
  await click(p, 'التالي', '.foot button');
  if (await has(p, '.modal.dups')) await click(p, 'متابعة', '.modal.dups button');
  await click(p, 'التالي', '.foot button');
  await p.evaluate(() => document.querySelector('.addsheet .foot .btn.primary').click());
  await wait(1500);
};
const snapshot = p =>
  p.evaluate(() => ({
    name: document.querySelector('.pc h1')?.innerText,
    line: document.querySelector('.pc .ns')?.innerText,
    aka: document.querySelector('.pc .aka')?.innerText ?? '',
    born: document.querySelector('.stats .stat')?.innerText.replace(/\s+/g, ' '),
    kids: [...document.querySelectorAll('.fam')].filter(c => !c.querySelector('.famh')?.innerText.includes('إخوت')).flatMap(c => [...c.querySelectorAll('.fp b')]).map(b => b.innerText.trim()).join(','),
  }));

try {
  const A = await phone('admin', adminLink);
  if (await has(A, '.welcome')) await click(A, 'تصفّح');
  const Y = new Date().getFullYear();
  const X = uniq(), Z = uniq(), K = uniq(), KZ = uniq(), D = uniq();

  // under علي: X (birth year cleared) and Z, who has a son and a kunya
  await openPerson(A, 'سلطان', 'الجيل الثاني');
  await addChild(A, 'm', X);
  await addChild(A, 'm', Z);
  await openKid(A, X);
  await click(A, 'تعديل البيانات');
  await A.evaluate(() => {
    const i = document.querySelector('.addsheet input[inputmode="numeric"]');
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(A, 'حفظ', '.foot button');
  await wait(1200);
  const xBefore = await snapshot(A);
  check(xBefore.name === X && xBefore.born.includes('—'), 'X has no birth year');
  await openPerson(A, Z, 'الجيل الثالث');
  await addChild(A, 'm', K);
  await click(A, 'تعديل البيانات');
  await A.type('.aliases input', 'أبو ' + KZ, { delay: 8 });
  await click(A, 'حفظ', '.foot button');
  await wait(1200);
  const zBefore = await snapshot(A);
  check(zBefore.kids === K && zBefore.aka.includes('أبو ' + KZ), 'Z has a son and a kunya');

  // Z is focused in the tree and its profile is open: merge X in, then swap so Z goes
  await toTree(A);
  await search(A, Z);
  await pickRow(A, Z);
  check((await textOf(A, '.sheet .who h2')).includes(Z), 'Z is focused in the tree');
  await click(A, 'الملف الكامل');
  await click(A, 'دمج مع…');
  const offered = await A.evaluate(() => [...document.querySelectorAll('.results .prow')].length);
  check(offered === 0 && (await has(A, '.searchpage .hint', 'اكتب اسمه')), 'no record with the same name: the picker asks for a name');
  await search(A, X);
  await pickRow(A, X);
  await click(A, 'تبديل', '.modal.merge button');
  const rows = await A.evaluate(() => [...document.querySelectorAll('.modal.merge .prow')].map(r => r.innerText.replace(/\s+/g, ' ')));
  check(rows[0].includes(X) && rows[1].includes(Z), 'swapped: X stays, Z (the open profile) goes');
  const summary = await textOf(A, '.modal.merge .review');
  check(summary.includes('واحد، ينتقل') && summary.includes(Z) && summary.includes('أبو ' + KZ) && summary.includes('الميلاد'), 'the summary: one child, the name and kunya, and the birth year');
  await shot(A, 'r1-merge-names');
  await click(A, 'دمج', '.modal.merge .btn.primary');
  await wait(1500);
  const merged = await snapshot(A);
  check(merged.name === X && merged.kids === K, 'the profile moves to X, with Z\'s son');
  check(merged.aka.includes(Z) && merged.aka.includes('أبو ' + KZ), 'X is known by Z\'s name and kunya');
  check(!merged.born.includes('—') && merged.born.includes(String(Y)), 'X takes Z\'s birth year');
  check(await has(A, '.page.profile .arow', 'اسم يُعرف به'), 'Z\'s name is kept as «اسم يُعرف به»');
  await A.evaluate(() => document.querySelector('.navbtns .round').click());
  await wait(600);
  check((await textOf(A, '.sheet .who h2')).includes(X), 'the tree now focuses X');
  const byZ = await search(A, Z);
  check(byZ.length === 1 && byZ[0].includes(X) && byZ[0].includes('يُعرف بـ ' + Z), 'searching Z\'s name finds X, «يُعرف بـ»');
  await closeSearch(A);

  // undo from the Requests tab
  await click(A, 'الطلبات', '.tab');
  await A.evaluate(t => [...document.querySelectorAll('.card.hist')].find(c => c.innerText.includes(t)).querySelector('button').click(), `دمج: ${Z} في ${X}`);
  await wait(1500);
  check(await has(A, '.card.hist', `تراجع: دمج: ${Z} في ${X}`), 'the undo is in the record');
  await openPerson(A, X, 'الجيل الثالث');
  check(JSON.stringify(await snapshot(A)) === JSON.stringify(xBefore), 'undo: X is exactly as before');
  await openPerson(A, Z, 'الجيل الثالث');
  check(JSON.stringify(await snapshot(A)) === JSON.stringify(zBefore), 'undo: Z is back exactly, with his son and kunya');
  await openKid(A, K);
  check((await textOf(A, '.pc .ns')).startsWith('بن ' + Z), 'undo: the son is under Z again');

  // a daughter entered twice: the duplicate check is off (CHECK_DUPLICATES), so
  // nothing asks; dupcheck-on/ has the version that checks the feminine question
  await openPerson(A, 'سلطان', 'الجيل الثاني');
  await addChild(A, 'f', D);
  await click(A, 'إضافة ابن أو ابنة', '.link');
  await click(A, 'ابنة', '.bigchoice button');
  await click(A, 'التالي', '.foot button');
  await A.type('.addsheet .bigin', D, { delay: 8 });
  await wait(300);
  check(!(await has(A, '.addsheet .warnbox')), 'her sister\'s name: no inline warning');
  await click(A, 'التالي', '.foot button');
  check(!(await has(A, '.modal.dups')) && (await has(A, '.addsheet .q', 'متى')), 'and no question: straight on');
  await click(A, 'إلغاء', '.addsheet .ahead .link');
  // a son with the same name as that daughter is not asked about her
  await click(A, 'إضافة ابن أو ابنة', '.link');
  await click(A, 'ابن', '.bigchoice button');
  await click(A, 'التالي', '.foot button');
  await A.type('.addsheet .bigin', D, { delay: 8 });
  await wait(300);
  check(!(await has(A, '.addsheet .warnbox')), 'a son named like his sister raises no warning');
  await click(A, 'التالي', '.foot button');
  check(!(await has(A, '.modal.dups')) && (await has(A, '.addsheet .q', 'متى')), 'and goes straight on');
  await click(A, 'إلغاء', '.addsheet .ahead .link').catch(() => {});
  if (await has(A, '.addsheet')) await A.evaluate(() => document.querySelector('.addsheet .ahead .link').click());
} catch (e) {
  check(false, 'script error: ' + redact(e.message));
}
await browser.close();
check(errs.length === 0, 'no page or console errors' + (errs.length ? ':\n  ' + errs.map(redact).join('\n  ') : ''));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
