// Aliases and the privacy rule, on a real family with a member's phone:
//   node alias-review-privacy.mjs <BASE url> <admin-link file>
// The root admin adds a son of سلطان (the member to be), his sister, and a far
// cousin's daughter (beyond the 3rd degree), each woman with a kunya. On the
// member's phone the far woman is never found by name, kunya or chain, never
// shown, and never offered as a likely duplicate; his sister is found by her
// kunya with «تُعرف بـ». The member can send his own kunya as a request.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [BASE, LINKFILE] = process.argv.slice(2);
if (!BASE || !LINKFILE) {
  console.log('usage: node alias-review-privacy.mjs <BASE url> <admin-link file>');
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
const bodyHas = (p, t) => p.evaluate(x => document.body.innerText.includes(x), t);
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
  if (await has(p, '.searchbar')) await p.evaluate(() => document.querySelector('.searchbar .round').click());
  await click(p, 'الشجرة', '.tab');
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
// adds a child from the open profile; returns whether the duplicate sheet showed
const addChild = async (p, sex, name, { submit = true, onDup = 'متابعة', inspect = null } = {}) => {
  await click(p, 'إضافة ابن أو ابنة', '.link');
  await click(p, sex === 'f' ? 'ابنة' : 'ابن', '.bigchoice button');
  await click(p, 'التالي', '.foot button');
  await p.type('.addsheet .bigin', name, { delay: 8 });
  await wait(300);
  const inline = await has(p, '.addsheet .warnbox');
  await click(p, 'التالي', '.foot button');
  const sheet = await has(p, '.modal.dups');
  if (sheet && inspect) await inspect();
  if (sheet && onDup) await click(p, onDup, '.modal.dups button');
  if (!submit) {
    if (await has(p, '.modal.dups')) await click(p, 'إغلاق', '.modal.dups .mhead button');
    await click(p, 'إلغاء', '.addsheet .ahead .link');
    return { inline, sheet };
  }
  // born in 1990: under 18, a member may not edit (members under 18 look but do not edit)
  await p.evaluate(() => {
    const r = document.querySelector('.addsheet input.range');
    if (!r) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, '1990');
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(p, 'التالي', '.foot button');
  await p.evaluate(() => document.querySelector('.addsheet .foot .btn.primary').click());
  await wait(1500);
  return { inline, sheet };
};
const addKunya = async (p, text) => {
  await click(p, 'تعديل البيانات');
  await p.type('.aliases input', text, { delay: 8 });
  await click(p, 'حفظ', '.foot button');
  await wait(1200);
};

try {
  const A = await phone('admin', adminLink);
  if (await has(A, '.welcome')) await click(A, 'تصفّح');
  const S = uniq(), SIS = uniq(), FAR = uniq(), KS = uniq(), KF = uniq(), KM = uniq();

  // under سلطان: the member-to-be and his sister (with a kunya)
  await openPerson(A, 'سلطان', 'الجيل الثاني');
  await addChild(A, 'm', S);
  await addChild(A, 'f', SIS);
  await openKid(A, SIS);
  await addKunya(A, 'أم ' + KS);
  check((await textOf(A, '.pc .aka')) === 'تُعرف بـ أم ' + KS, 'a woman\'s profile says «تُعرف بـ»');
  // a daughter of عبدالرحمن بن صالح, far from سلطان's line, with a kunya
  await openPerson(A, 'عبدالرحمن صالح', 'الجيل الثالث');
  await addChild(A, 'f', FAR);
  await openKid(A, FAR);
  await addKunya(A, 'أم ' + KF);
  await toTree(A);
  const adminFar = await search(A, 'ام ' + KF);
  check(adminFar.length === 1 && adminFar[0].includes('تُعرف بـ أم ' + KF), 'the root admin finds the far woman by her kunya, «تُعرف بـ»');
  await closeSearch(A);

  // invite the son, and open the invite on his phone
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await search(A, S);
  await pickRow(A, S);
  await wait(800);
  const link = await A.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('ft-family'));
    const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid));
    const sk = Object.values(inv).pop();
    return `${location.origin}/#join=${m.fid}.${m.key}.i${sk}`;
  });
  if (await has(A, '.modal.invite')) await click(A, 'إغلاق', '.modal.invite .mhead button');
  const B = await phone('member', link);
  await click(B, 'نعم، أنا');
  await wait(2000);
  await click(B, 'أنا', '.tab');
  check((await textOf(B, ':is(.page.me, .page.admin) .card .prow b')).startsWith(S), 'the member joined as the new son of سلطان');
  await click(B, 'الشجرة', '.tab');

  // the far woman: never found by name, kunya, or chain
  for (const q of [FAR, 'ام ' + KF, 'أم ' + KF, 'بو ' + KF, FAR + ' عبدالرحمن', FAR + ' بنت عبدالرحمن']) {
    check((await search(B, q)).length === 0, `the member finds nobody by «${q}»`);
  }
  // his sister: found by her kunya, shown with «تُعرف بـ»
  const sis = await search(B, 'ام ' + KS);
  check(sis.length === 1 && sis[0].includes(SIS) && sis[0].includes('تُعرف بـ أم ' + KS), 'the member finds his sister by her kunya');
  await closeSearch(B);

  // the far woman's father: his family cards never show her name, and nothing shows her kunya
  // (change titles in the record carry names, as before this feature)
  const elder = () => openPerson(B, 'عبدالرحمن صالح', 'الجيل الثالث');
  await elder();
  const cards = await B.evaluate(() => [...document.querySelectorAll('.fam')].map(c => c.innerText).join(' '));
  check(!cards.includes(FAR) && !(await bodyHas(B, KF)), 'her father\'s profile hides her in the family cards, and her kunya everywhere');
  const hiddenKids = await B.evaluate(() => [...document.querySelectorAll('.fam .fp b')].filter(b => b.innerText.trim() === 'ابنة').length);
  let leaked = false;
  for (let i = 0; i < hiddenKids; i++) {
    if (i) await elder();
    await B.evaluate(j => [...document.querySelectorAll('.fam .fp')].filter(k => k.querySelector('b').innerText.trim() === 'ابنة')[j].click(), i);
    await wait(500);
    if ((await textOf(B, '.pc h1')).includes(FAR) || (await bodyHas(B, KF)) || (await has(B, '.pc .aka')) || (await has(B, '.page.profile h3', 'أسماء أخرى'))) leaked = true;
  }
  check(hiddenKids > 0 && !leaked, `no hidden daughter's profile shows her name, kunya or other names (${hiddenKids} checked)`);
  await elder();

  // adding a daughter there with the far woman's name or kunya asks nothing
  const d1 = await addChild(B, 'f', FAR, { submit: false, onDup: null });
  check(!d1.inline && !d1.sheet, 'a daughter named like the hidden woman raises no warning');
  const d2 = await addChild(B, 'f', 'أم ' + KF, { submit: false, onDup: null });
  check(!d2.inline && !d2.sheet, 'nor one named by her kunya');
  // a daughter of سلطان named by the sister's kunya: the duplicate check is off
  // (CHECK_DUPLICATES), so nothing asks; dupcheck-on/ has the version that asks
  await openPerson(B, 'سلطان', 'الجيل الثاني');
  const d3 = await addChild(B, 'f', 'ام ' + KS, { submit: false, onDup: null });
  check(!d3.inline && !d3.sheet, 'a daughter of سلطان named by his sister\'s kunya: no question');

  // the member sends his own kunya as a request
  await openPerson(B, S, 'الجيل الثالث');
  await click(B, 'إضافة كنية أو لقب', '.link');
  // since version 1.31 a member corrects the whole record, as a request
  check((await textOf(B, '.ahead b')) === 'تعديل', 'the member edits the record, as a request');
  await B.type('.aliases input', 'أبو ' + KM, { delay: 8 });
  await click(B, 'إرسال للاعتماد', '.foot button');
  await wait(1500);
  check(!(await has(B, '.pc .aka')), 'nothing changes before approval');
  await toTree(B);
  await click(B, 'الطلبات', '.tab');
  check(await has(B, '.card.req h4', 'أسماء أخرى: ' + S), 'his request waits in الطلبات');
  // a second request for the same names waits until the first is decided
  await openPerson(B, S, 'الجيل الثالث');
  await click(B, 'إضافة كنية أو لقب', '.link');
  await B.type('.aliases input', 'أبو ' + uniq(), { delay: 8 });
  check(await has(B, '.addsheet .warnbox', 'بانتظار الاعتماد'), 'his names already wait: the editor says so');
  check(await B.evaluate(() => document.querySelector('.addsheet .foot .btn.primary').disabled), 'and a second request cannot be sent');
  await click(B, 'إلغاء', '.addsheet .ahead .link');
  // he asks for a kunya for his sister too
  const KS2 = uniq();
  await toTree(B);
  await search(B, SIS);
  await pickRow(B, SIS);
  await click(B, 'الملف الكامل');
  await click(B, 'تعديل', '.link');
  await B.type('.aliases input', 'أم ' + KS2, { delay: 8 });
  await click(B, 'إرسال للاعتماد', '.foot button');
  await wait(1200);
  await toTree(B);
  // and the root admin sees it
  await wait(3500);
  await click(A, 'الطلبات', '.tab');
  check(await has(A, '.card.req h4', 'أسماء أخرى: ' + S), 'the root admin sees the request');
  // the sister entered twice, while her names wait: merging is refused either way round
  await wait(2000);
  await openPerson(A, 'سلطان', 'الجيل الثاني');
  await click(A, 'إضافة ابن أو ابنة', '.link');
  await click(A, 'ابنة', '.bigchoice button');
  await click(A, 'التالي', '.foot button');
  await A.type('.addsheet .bigin', SIS, { delay: 8 });
  await click(A, 'التالي', '.foot button');
  await click(A, 'التالي', '.foot button');
  await A.evaluate(() => document.querySelector('.addsheet .foot .btn.primary').click());
  await wait(1500);
  await toTree(A);
  await search(A, 'ام ' + KS);
  await pickRow(A, SIS);
  await click(A, 'الملف الكامل');
  await click(A, 'دمج مع…');
  const twins = await A.evaluate(() => [...document.querySelectorAll('.results .prow')].length);
  check(twins === 1, 'the picker offers her second record');
  await A.evaluate(() => document.querySelector('.results .prow').click());
  await wait(1000);
  check(await has(A, '.modal.merge .warnbox', 'على السجل الباقي طلب تعديل'), 'keeping her while her names wait is refused');
  await click(A, 'تبديل', '.modal.merge button');
  check(await has(A, '.modal.merge .warnbox', 'عليه طلبات بانتظار الاعتماد'), 'removing her while her names wait is refused');
  await click(A, 'إغلاق', '.modal.merge .mhead button');
  // a record linked to a phone is never merged away
  await openPerson(A, S, 'الجيل الثالث');
  await click(A, 'دمج مع…');
  check((await search(A, S)).length === 0, 'the merge picker never offers the person himself');
  await closeSearch(A);
} catch (e) {
  check(false, 'script error: ' + redact(e.message));
}
await browser.close();
check(errs.length === 0, 'no page or console errors' + (errs.length ? ':\n  ' + errs.map(redact).join('\n  ') : ''));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
