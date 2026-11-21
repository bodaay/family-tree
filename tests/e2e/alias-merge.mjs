// Merging duplicates, as the root admin:
//   node alias-merge.mjs <BASE url> <admin-link file>
// One son entered twice: the second record has a child and a kunya. Merging
// it into the first moves the child and the names in one change; undoing it
// brings both records back exactly. Merging with an ancestor, or with someone
// under another father, is refused.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [BASE, LINKFILE] = process.argv.slice(2);
if (!BASE || !LINKFILE) {
  console.log('usage: node alias-merge.mjs <BASE url> <admin-link file>');
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
const pickRow = async (p, text) => {
  await p.evaluate(t => [...document.querySelectorAll('.results .prow')].find(r => r.innerText.includes(t)).click(), text);
  await wait(1200);
};
const back = async p => {
  await p.evaluate(() => document.querySelector('.navbtns .round').click());
  await wait(500);
};
const toTree = async p => {
  if (await has(p, '.page.profile')) await back(p);
  if (await has(p, '.searchbar')) await p.evaluate(() => document.querySelector('.searchbar .round').click());
  await wait(400);
};
const openPerson = async (p, q, pickText) => {
  await toTree(p);
  await search(p, q);
  await pickRow(p, pickText);
  await click(p, 'الملف الكامل');
};
// the open profile's children (not its brothers and sisters), as "name year"
const KIDS = () => [...document.querySelectorAll('.fam')].filter(c => !c.querySelector('.famh')?.innerText.includes('إخوت')).flatMap(c => [...c.querySelectorAll('.fp')]);
const kidsShown = p => p.evaluate(`(${KIDS})().map(k => (k.querySelector('b').innerText + ' ' + (k.querySelector('small')?.innerText ?? '')).trim())`);
const addChild = async (p, name, older = 0) => {
  await click(p, 'إضافة ابن أو ابنة', '.link');
  await click(p, 'ابن', '.bigchoice button');
  await click(p, 'التالي', '.foot button');
  await p.type('.addsheet .bigin', name, { delay: 8 });
  await click(p, 'التالي', '.foot button');
  if (await has(p, '.modal.dups')) await click(p, 'متابعة', '.modal.dups button');
  for (let i = 0; i < older; i++) await p.click('.wb[aria-label="إنقاص"]');
  await click(p, 'التالي', '.foot button');
  await click(p, 'إضافة إلى الشجرة', '.foot button');
  await wait(1500);
};
// what the profile says about a person, to compare before and after
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
  const M = uniq();
  const K = uniq();

  // under سلطان: a son M, then M again (born two years earlier), with a child and a kunya
  await openPerson(A, 'سلطان', 'الجيل الثاني');
  await addChild(A, M);
  await addChild(A, M, 2);
  const twins = (await kidsShown(A)).filter(k => k.startsWith(M + ' '));
  check(twins.length === 2, 'two records of the same son under سلطان');
  check((await textOf(A, '.pc h1')) === 'سلطان', 'still on سلطان');
  await A.evaluate((m, y) => [...document.querySelectorAll('.fam .fp')].find(k => k.querySelector('b').innerText.trim() === m && k.querySelector('small')?.innerText.trim() === y).click(), M, String(Y - 2));
  await wait(800);
  await addChild(A, K);
  await click(A, 'تعديل البيانات');
  await A.type('.aliases input', 'أبو ' + K, { delay: 8 });
  await click(A, 'حفظ', '.foot button');
  await wait(1200);
  const dropBefore = await snapshot(A);
  check(dropBefore.name === M && dropBefore.born.includes(String(Y - 2)), 'on the second record');
  check(dropBefore.kids.includes(K) && dropBefore.aka.includes('أبو ' + K), 'the second record has a son and a kunya');

  // the first record: merge the second into it
  await openPerson(A, M, String(Y));
  const keepBefore = await snapshot(A);
  check(keepBefore.born.includes(String(Y)) && !keepBefore.kids, 'the first record has no children');
  await click(A, 'دمج مع…');
  check(await has(A, '.searchpage .hint', 'بالاسم نفسه'), 'the picker suggests records with the same name');
  const offered = await A.evaluate(() => [...document.querySelectorAll('.results .prow')].map(r => r.innerText.replace(/\s+/g, ' ')));
  check(offered.length === 1 && offered[0].includes(String(Y - 2)), 'the other record is offered first, not the person himself');
  await pickRow(A, String(Y - 2));
  check(await has(A, '.modal.merge'), 'the merge sheet opens');
  const rows = () => A.evaluate(() => [...document.querySelectorAll('.modal.merge .prow')].map(r => r.innerText.replace(/\s+/g, ' ')));
  const [k0, d0] = await rows();
  check(k0.includes(String(Y)) && d0.includes(String(Y - 2)), 'it keeps this record and removes the other');
  await click(A, 'تبديل', '.modal.merge button');
  const [k1] = await rows();
  check(k1.includes(String(Y - 2)), 'swap changes which one stays');
  await click(A, 'تبديل', '.modal.merge button');
  const summary = await textOf(A, '.modal.merge .review');
  check(summary.includes('واحد، ينتقل') && summary.includes('أبو ' + K), 'the summary lists the child and the kunya that move');
  await shot(A, 'm1-merge-sheet');
  await click(A, 'دمج', '.modal.merge .btn.primary');
  await wait(1500);
  check(!(await has(A, '.modal.merge')), 'merged');
  const merged = await snapshot(A);
  check(merged.name === M && merged.born.includes(String(Y)), 'the kept record is shown');
  check(merged.kids.includes(K), 'the child moved to it');
  check(merged.aka.includes('أبو ' + K), 'the kunya moved to it');
  await shot(A, 'm2-merged');
  await toTree(A);
  const one = await search(A, M);
  check(one.length === 1, `one ${M} left in the tree (${one.length})`);
  const kunya = await search(A, 'ابو ' + K);
  check(kunya.length === 1 && kunya[0].includes(String(Y)), 'the kunya finds the kept record');

  // undo: both records come back exactly
  await pickRow(A, String(Y));
  await click(A, 'الملف الكامل');
  await A.evaluate(m => [...document.querySelectorAll('.card.hist')].find(c => c.innerText.includes('دمج سجلين: ' + m)).querySelector('button').click(), M);
  await wait(1500);
  check((await snapshot(A)).kids === keepBefore.kids && (await snapshot(A)).aka === keepBefore.aka, 'undo: the kept record is as it was');
  await toTree(A);
  check((await search(A, M)).length === 2, `undo: two records of ${M} again`);
  await pickRow(A, String(Y - 2));
  await click(A, 'الملف الكامل');
  const dropAfter = await snapshot(A);
  check(JSON.stringify(dropAfter) === JSON.stringify(dropBefore), 'undo: the removed record is back exactly, with its child and kunya');
  await A.evaluate(k => [...document.querySelectorAll('.fam .fp')].find(e => e.querySelector('b').innerText.trim() === k).click(), K);
  await wait(800);
  check((await textOf(A, '.pc .ns')).startsWith('بن ' + M), 'undo: the child is under the second record again');

  // refusals: an ancestor, and someone under another father
  await openPerson(A, M, String(Y));
  await click(A, 'دمج مع…');
  await search(A, 'سلطان');
  await pickRow(A, 'الجيل الثاني');
  check(await has(A, '.modal.merge .warnbox', 'أصول'), 'merging with his father is refused');
  check(await A.evaluate(() => document.querySelector('.modal.merge .btn.primary').disabled), 'and the merge button is off');
  await click(A, 'إغلاق', '.modal.merge .mhead button');
  await click(A, 'دمج مع…');
  await search(A, 'موسى بن إسماعيل');
  await pickRow(A, 'موسي');
  check(await has(A, '.modal.merge .warnbox', 'أب مختلف'), 'merging with someone under another father is refused');
  await click(A, 'إغلاق', '.modal.merge .mhead button');
  check(!(await has(A, '.modal.merge')), 'the sheet closes');

  // a record with a personal invite is never the one removed: swapping keeps it
  await toTree(A);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await search(A, M);
  await pickRow(A, String(Y - 2));
  await wait(800);
  if (await has(A, '.modal.invite')) await click(A, 'إغلاق', '.modal.invite .mhead button');
  await click(A, 'الشجرة', '.tab');
  await openPerson(A, M, String(Y));
  await click(A, 'دمج مع…');
  await pickRow(A, String(Y - 2));
  check(await has(A, '.modal.merge .warnbox', 'مرتبط'), 'merging away an invited record is refused');
  await click(A, 'تبديل', '.modal.merge button');
  check(!(await has(A, '.modal.merge .warnbox')) && !(await A.evaluate(() => document.querySelector('.modal.merge .btn.primary').disabled)), 'swapped, the invited record stays and the merge is allowed');
  await click(A, 'إغلاق', '.modal.merge .mhead button');
} catch (e) {
  check(false, 'script error: ' + redact(e.message));
}
await browser.close();
check(errs.length === 0, 'no page or console errors' + (errs.length ? ':\n  ' + errs.map(redact).join('\n  ') : ''));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
