// The sample family (opened without a link), where changes go through requests:
//   node alias-sample.mjs <BASE url> <admin-link file>   (the link file is not used here)
// A member proposes a kunya for his son; it waits for a key holder, is
// approved, then shows on the profile and in search. Adding a child with a
// brother's name asks first and still sends a request when carried on.
import puppeteer from 'puppeteer-core';

const [BASE, LINKFILE] = process.argv.slice(2);
if (!BASE || !LINKFILE) {
  console.log('usage: node alias-sample.mjs <BASE url> <admin-link file>');
  process.exit(2);
}

let failures = 0;
const check = (ok, msg) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + msg);
  if (!ok) failures++;
};
const errs = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const LETTERS = 'بتثجحخدذرزسشصضطظعغفقكلمن';
const uniq = (n = 6) => Array.from({ length: n }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
const SHOTS = process.env.SHOTS;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
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

try {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(1200);
  await click(page, 'جرّب العائلة التجريبية');
  await wait(800);
  check(await has(page, '.top h1', 'آل سالم'), 'the sample family opens');
  await click(page, 'اختر اسمي');
  await search(page, 'محمد');
  await pickRow(page, '1978');
  await click(page, 'أنا', '.tab');
  check((await textOf(page, ':is(.page.me, .page.admin) .card .prow b')).startsWith('محمد'), 'chose محمد (1978) as me');
  await click(page, 'الشجرة', '.tab');

  // his son فهد: propose a kunya
  const U = uniq();
  await search(page, 'فهد محمد');
  await pickRow(page, '2005');
  await click(page, 'الملف الكامل');
  check((await textOf(page, '.pc h1')) === 'فهد', 'opened فهد (2005)');
  await click(page, 'إضافة كنية أو لقب', '.link');
  // since version 1.31 a member corrects the whole record, as a request
  check((await textOf(page, '.ahead b')) === 'تعديل' && (await has(page, '.q.small', 'الاسم')), 'a member edits the record, as a request');
  await page.type('.aliases input', 'أبو ' + U, { delay: 8 });
  await shot(page, 's1-member-aliases');
  await click(page, 'إرسال للاعتماد', '.foot button');
  await wait(1000);
  check(!(await has(page, '.pc .aka')), 'nothing changes before approval');
  await page.evaluate(() => document.querySelector('.navbtns .round').click());
  await wait(500);
  await click(page, 'الطلبات', '.tab');
  check(await has(page, '.card.req h4', 'أسماء أخرى: فهد'), 'the request waits in الطلبات');

  // a key holder of the branch approves it
  await page.evaluate(() => [...document.querySelectorAll('.card.req')].find(c => c.innerText.includes('أسماء أخرى: فهد')).querySelector('.eligible .chip').click());
  await wait(700);
  await page.evaluate(() => [...document.querySelectorAll('.card.req')].find(c => c.innerText.includes('أسماء أخرى: فهد')).querySelector('.btn.primary').click());
  await wait(1200);
  check(await has(page, '.card.hist', 'أسماء أخرى: فهد'), 'approved and in the record');
  await click(page, 'الشجرة', '.tab');
  const r = await search(page, 'ابو ' + U);
  check(r.length === 1 && r[0].includes('فهد') && r[0].includes('أبو ' + U), 'search by the kunya finds فهد');
  await pickRow(page, 'فهد');
  await click(page, 'الملف الكامل');
  check((await textOf(page, '.pc .aka')).includes('أبو ' + U), 'his profile shows the kunya');

  // back as محمد: a child of فهد's father with فهد's name asks first
  await page.evaluate(() => document.querySelector('.navbtns .round').click());
  await wait(400);
  await click(page, 'أنا', '.tab');
  await page.evaluate(() => [...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.innerText.includes('أنا (')).click());
  await wait(500);
  await click(page, 'الشجرة', '.tab');
  await page.evaluate(() => document.querySelector('.searchbar .round')?.click());
  await wait(400);
  await page.click('.fab');
  await wait(600);
  await click(page, 'ابن', '.bigchoice button');
  await click(page, 'التالي', '.foot button');
  await page.type('.addsheet .bigin', 'ابو ' + U, { delay: 8 });
  await click(page, 'التالي', '.foot button');
  // the duplicate check is off (CHECK_DUPLICATES); dupcheck-on/ has the version that asks
  check(!(await has(page, '.modal.dups')) && (await has(page, '.addsheet .q', 'متى')), 'a son named by his brother\'s kunya: no question, straight on');
  await click(page, 'التالي', '.foot button');
  await click(page, 'إرسال للاعتماد', '.foot button');
  await wait(1000);
  check(await has(page, '.card.req h4', 'ابو ' + U), 'carried on: the new son is sent as a request');
} catch (e) {
  check(false, 'script error: ' + e.message);
}
await browser.close();
check(errs.length === 0, 'no page or console errors' + (errs.length ? ':\n  ' + errs.join('\n  ') : ''));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
