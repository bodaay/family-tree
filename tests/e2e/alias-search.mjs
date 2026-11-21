// Aliases and Arabic search, as the root admin:
//   node alias-search.mjs <BASE url> <admin-link file>
// Spelling variants (hamza, ta marbuta, alef maqsura, «عبد الله») find the
// stored names; aliases are added, shown on the profile and in results, found
// by search, refused when they look like a phone number, and undone.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [BASE, LINKFILE] = process.argv.slice(2);
if (!BASE || !LINKFILE) {
  console.log('usage: node alias-search.mjs <BASE url> <admin-link file>');
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
// search from the tree screen (or retype in the open search)
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
  return p.evaluate(() =>
    [...document.querySelectorAll('.results .prow')].map(r => ({
      name: r.querySelector('.pt b').innerText.split('\n')[0].trim(),
      text: r.innerText.replace(/\s+/g, ' '),
      aka: r.querySelector('.aka')?.innerText ?? '',
    })),
  );
};
const closeSearch = async p => {
  if (await has(p, '.searchpage')) await p.evaluate(() => document.querySelector('.searchpage .round').click());
  await wait(300);
};
const openFirst = async (p, q, pickText = '') => {
  await search(p, q);
  await p.evaluate(t => [...document.querySelectorAll('.results .prow')].find(r => r.innerText.includes(t)).click(), pickText);
  await wait(1200);
  await click(p, 'الملف الكامل');
};
const back = async p => {
  await p.evaluate(() => document.querySelector('.navbtns .round').click());
  await wait(500);
};

try {
  const A = await phone('admin', adminLink);
  if (await has(A, '.welcome')) await click(A, 'تصفّح');
  check(await has(A, '.top h1'), 'the family opens with the admin link');

  // spelling variants find the names as they are stored
  const variants = [
    ['عيسي', 'عيسى'],
    ['يحيي', 'يحيى'],
    ['موضى', 'موضي'],
    ['عايشه', 'عائش'],
    ['فاطمة', 'فاطمه'],
    ['عبد الله', 'عبدالله'],
    ['إبراهيم', 'إبراهيم'],
    ['ابراهيم', 'إبراهيم'],
  ];
  for (const [q, stored] of variants) {
    const r = await search(A, q);
    check(r.length > 0 && r.some(x => x.name.startsWith(stored)), `«${q}» finds «${stored}» (${r.length} results)`);
  }
  const chain = await search(A, 'موسى بن إسماعيل');
  check(chain.length > 0 && chain.every(x => x.name === 'موسي' && x.text.includes('بن اسماعيل')), `a name chain with variants («موسى بن إسماعيل») finds ${chain.length}`);
  await closeSearch(A);

  // add a kunya and a laqab (the laqab left in the box is saved too)
  const U = uniq();
  const L = uniq();
  await openFirst(A, 'موسى بن إسماعيل');
  const who = await textOf(A, '.pc .ns');
  const akaBefore = await textOf(A, '.pc .aka');
  await click(A, 'تعديل البيانات');
  check(await has(A, '.q.small', 'أسماء أخرى'), 'the edit screen has «أسماء أخرى»');
  await A.type('.aliases input', 'أبو ' + U, { delay: 8 });
  await click(A, 'إضافة', '.aliases button');
  check(await has(A, '.aliases .arow', 'أبو ' + U), 'the kunya is listed in the editor');
  await click(A, 'لقب', '.akinds button');
  await A.type('.aliases input', L, { delay: 8 });
  await click(A, 'حفظ', '.foot button');
  await wait(1200);
  const aka = await textOf(A, '.pc .aka');
  check(aka.includes('أبو ' + U) && aka.includes(L), 'the profile shows both names under the nasab');
  check(await A.evaluate(() => [...document.querySelectorAll('.aliases .arow')].map(r => r.innerText).join('|')).then(t => t.includes('كنية') && t.includes('لقب')), 'the «أسماء أخرى» section lists them with their kinds');

  // search by alias, with and without the hamza, and by the laqab
  await back(A);
  for (const q of ['ابو ' + U, 'أبو ' + U, 'بو ' + U, L, 'ابو ' + U + ' اسماعيل']) {
    const r = await search(A, q);
    check(r.length === 1 && r[0].name === 'موسي' && r[0].aka.includes('أبو ' + U), `«${q}» finds him, with «يُعرف بـ» in the result`);
  }
  await closeSearch(A);

  // a phone number is refused as an alias
  await openFirst(A, 'ابو ' + U);
  check((await textOf(A, '.pc .ns')) === who, 'the alias result opens the same person');
  await click(A, 'تعديل البيانات');
  await A.type('.aliases input', '0501234567', { delay: 8 });
  check(await has(A, '.aliases .warnbox', 'الهواتف'), 'a phone number shows a warning');
  check(await A.evaluate(() => document.querySelector('.foot .btn.primary').disabled), 'and cannot be saved');
  await click(A, 'إلغاء', '.ahead button');

  // undo the change from the person's record
  await A.evaluate(() => [...document.querySelectorAll('.card.hist')].find(c => c.innerText.includes('تعديل: موسي')).querySelector('button').click());
  await wait(1500);
  const akaAfter = await textOf(A, '.pc .aka');
  check(akaAfter === akaBefore && !akaAfter.includes(U), 'undo puts his names back as they were');
  await back(A);
  const gone = await search(A, 'ابو ' + U);
  check(gone.length === 0, 'after undo the alias finds nobody');
  await closeSearch(A);
} catch (e) {
  check(false, 'script error: ' + redact(e.message));
}
await browser.close();
check(errs.length === 0, 'no page or console errors' + (errs.length ? ':\n  ' + errs.map(redact).join('\n  ') : ''));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
