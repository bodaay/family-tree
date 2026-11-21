// «الصلاحيات» on a profile after merging feat/permissions into the integration build:
// «جهاز جديد» beside «فصل الجهاز», and every way the profile takes a phone or an invite
// away renews the family key, as the members screen does. On a fresh local family:
//   node merge-perm-device.mjs BASE admin-link-file [screenshots-dir]
// - B (a man) is invited from his profile and joins. «جهاز جديد» there unlinks his
//   phone (it forgets the family), renews the key and shows a fresh invite, which
//   joins on a new phone with the new key and reads everything.
// - «فصل الجهاز» there unlinks the new phone and renews; a new invite cancelled
//   there renews too, and its link then opens nothing.
// - C (a woman): the questions use her forms; a double tap on «جهاز جديد» asks once
//   and makes one change. Cancelling from the members screen still renews.
// - D, recorded as deceased while his phone is linked: no «جهاز جديد» (the deceased
//   are not invited), on the profile or the members screen; unlinking still renews.
// - A wife from outside the family has no permissions section; her husband has.
// Never prints links or keys.
import { setup, click, typeIn, openProfile, closeProfile, wait } from './mar-lib.mjs';

const t = setup();
const { ok } = t;
const shots = process.argv[4] ?? null;
const fid = t.adminLink.match(/join=([a-z0-9]+)\./)[1];
const B = ['ماجد', '1953'];
const C = ['هيلة', '1967'];
const D = ['وليد', '1956'];
const MAN = ['مازن فيصل', '1960'];
const WIFE_OUT = 'وداد بنت ناصر ' + String(Date.now()).slice(-4);

const fetchLog = async () => (await (await fetch(`${t.base}/api/f/${fid}/log?after=-1`)).json()).entries;
const kidCount = async () => new Set((await fetchLog()).map(e => e.kid).filter(Boolean)).size;
async function until(fn, ms = 15000, step = 400) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = null; }
    if (v || Date.now() > end) return v;
    await wait(step);
  }
}

// every confirm() is recorded and accepted
const dialogs = [];
let browser;
async function phone(name, link) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => t.errs.push(name + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') t.errs.push(name + ': ' + m.text()); });
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.goto(link, { waitUntil: 'networkidle0' });
  await until(() => page.evaluate(() => !document.querySelector('.wl-mark.spin')));
  await wait(800);
  return page;
}
const shot = async (p, file) => { if (shots) await p.screenshot({ path: shots + '/' + file }); };
const ready = p => p.evaluate(() => !!document.querySelector('nav.tabs') && !document.querySelector('.join'));
const ended = p => p.evaluate(() => !!document.querySelector('.join h2')?.innerText.includes('انتهى دخولك') && !localStorage.getItem('ft-family'));
const people = p => p.evaluate(() => Number(document.querySelector('.top .sub b')?.innerText.replace(/,/g, '')));
async function copyLink(p) {
  if (!(await until(() => p.evaluate(() => !!document.querySelector('.modal.invite'))))) return null;
  await p.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async x => { window.__copied = x; }; });
  await click(p, 'نسخ الرابط');
  const link = await p.evaluate(() => window.__copied);
  await click(p, 'إغلاق', '.mhead button');
  return link;
}
// the permissions section of the open profile
const perm = p => p.evaluate(() => {
  const sec = document.querySelector('.page.profile section.perms');
  if (!sec) return null;
  const phoneRow = [...sec.querySelectorAll('.permstat .srow')].find(r => r.querySelector('span')?.firstChild?.textContent.trim() === 'الهاتف');
  return { phone: phoneRow?.querySelector('b')?.innerText.trim() ?? null, rows: [...sec.querySelectorAll('.permphone .prow')].map(r => r.innerText.replace(/\s+/g, ' ').trim()) };
});
// a button in the permissions phone card: in the row whose text includes `row`, by its text or aria-label
const permButton = (p, row, label, times = 1) => p.evaluate((row, label, times) => {
  const r = [...document.querySelectorAll('.page.profile section.perms .permphone .prow')].find(e => e.innerText.includes(row));
  const b = r && [...r.querySelectorAll('button')].find(x => x.textContent.includes(label) || x.getAttribute('aria-label') === label);
  for (let i = 0; i < times; i++) b?.click();
  return !!b;
}, row, label, times);

try {
  browser = await t.launch();
  const A = await phone('A', t.adminLink);
  await click(A, 'اربط باسمي');
  await A.type('.sfield input', 'منصور', { delay: 8 });
  await wait(600);
  await A.evaluate(() => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes('1963'))?.click());
  await wait(1500);
  ok(await ready(A), 'the root admin opens the family, linked to his place');
  await click(A, 'الشجرة', '.tab', 600);
  const n = await people(A); // nothing is added before the new phone counts
  const k0 = await kidCount();

  // ---- B: invited from his profile, joins
  ok(await openProfile(A, ...B), "B's profile opens");
  ok(await click(A, 'دعوة', '.page.profile section.perms .permphone button.prow'), 'the profile offers «دعوة»');
  const b1 = await copyLink(A);
  ok(!!b1, 'the invite opens with its link');
  const PB1 = await phone('B1', b1);
  await click(PB1, 'نعم، أنا');
  ok(!!(await until(() => ready(PB1))), "B's first phone joined");
  ok(!!(await until(async () => (await perm(A))?.phone === 'انضم من هاتفه')), 'the profile shows him joined');

  // both buttons sit in his phone's row, side by side under its text, on a 412px phone
  const fit = await A.evaluate(() => {
    const r = [...document.querySelectorAll('.page.profile section.perms .permphone .prow')].find(e => e.innerText.includes('انضم من هاتفه'));
    r?.scrollIntoView({ block: 'center' });
    const box = r.getBoundingClientRect();
    const bs = [...r.querySelectorAll('button')].map(b => ({ t: b.textContent.trim(), ...b.getBoundingClientRect().toJSON() }));
    const txt = r.querySelector('.pt').getBoundingClientRect();
    return { labels: bs.map(b => b.t), inside: bs.every(b => b.left >= box.left - 0.5 && b.right <= box.right + 0.5), oneLine: bs.every(b => Math.abs(b.top - bs[0].top) < 2), under: bs.every(b => b.top >= txt.bottom), gap: Math.round(bs[0].top - txt.bottom), text: Math.round(txt.width), lines: Math.round(txt.height), page: document.documentElement.scrollWidth <= innerWidth };
  });
  ok(JSON.stringify(fit.labels) === JSON.stringify(['جهاز جديد', 'فصل الجهاز']), '«جهاز جديد» stands beside «فصل الجهاز»: ' + JSON.stringify(fit.labels));
  ok(fit.inside && fit.oneLine && fit.under && fit.text >= 200 && fit.lines < 60 && fit.page, 'both fit in the row under its text, which keeps two lines, no sideways scroll: ' + JSON.stringify(fit));
  await shot(A, 'merge-perm-joined.png');

  // ---- «جهاز جديد» from the profile
  dialogs.length = 0;
  ok(await permButton(A, 'انضم من هاتفه', 'جهاز جديد'), 'tap «جهاز جديد» on his profile');
  ok(dialogs.length === 1 && dialogs[0].startsWith('جهاز جديد لـ') && dialogs[0].includes('يُجدَّد مفتاح العائلة') && dialogs[0].includes('هاتفه الحالي') && dialogs[0].includes('له دعوة جديدة يفتحها'), 'it asks first, saying the key is renewed: ' + dialogs[0]);
  const b2 = await copyLink(A);
  ok(!!b2 && b2 !== b1, 'a fresh invite opens with its own link');
  ok(!!(await until(async () => (await kidCount()) === k0 + 1)), 'the family key is renewed');
  ok(!!(await until(() => ended(PB1))), 'his old phone forgets the family');
  ok(!!(await until(async () => (await perm(A))?.phone === 'دعوة بانتظار الانضمام')), 'the profile shows the new invite waiting');
  const PB2 = await phone('B2', b2);
  await click(PB2, 'نعم، أنا');
  ok(!!(await until(() => ready(PB2))), 'the new invite joins on his new phone');
  const lastKid = (await fetchLog()).at(-1).kid;
  ok(Object.keys(JSON.parse(await PB2.evaluate(() => localStorage.getItem('ft-family'))).keys ?? {}).includes(lastKid), 'the new phone holds the newest key');
  await click(PB2, 'الشجرة', '.tab', 600);
  ok(n > 0 && !!(await until(async () => (await people(PB2)) === n)), 'and reads the whole family: ' + n);

  // ---- «فصل الجهاز» from the profile
  ok(await openProfile(A, ...B), "B's profile again");
  ok(!!(await until(async () => (await perm(A))?.phone === 'انضم من هاتفه')), 'he is joined from his new phone');
  dialogs.length = 0;
  ok(await permButton(A, 'انضم من هاتفه', 'فصل الجهاز'), 'tap «فصل الجهاز»');
  ok(dialogs.length === 1 && dialogs[0].startsWith('فصل جهاز') && dialogs[0].includes('يُجدَّد مفتاحها فلا يصله شيء جديد') && dialogs[0].includes('لن يستطيع'), 'it asks first, saying the key is renewed: ' + dialogs[0]);
  ok(!!(await until(async () => (await kidCount()) === k0 + 2)), 'the family key is renewed');
  ok(!!(await until(() => ended(PB2))), 'the unlinked phone forgets the family');
  ok(!!(await until(async () => (await perm(A))?.phone === 'فُصل جهازه')), 'the profile says his phone was unlinked');

  // ---- an invite cancelled from the profile
  ok(await click(A, 'دعوة', '.page.profile section.perms .permphone button.prow'), 'invite him again');
  const b3 = await copyLink(A);
  ok(!!b3, 'the invite opens');
  dialogs.length = 0;
  ok(await permButton(A, 'دعوة بانتظار الانضمام', 'إلغاء الدعوة'), 'cancel it from the profile');
  ok(dialogs.length === 1 && dialogs[0].startsWith('إلغاء دعوة') && dialogs[0].includes('يُجدَّد مفتاح العائلة'), 'it asks first, saying the key is renewed: ' + dialogs[0]);
  ok(!!(await until(async () => (await kidCount()) === k0 + 3)), 'the family key is renewed');
  ok(!!(await until(async () => (await perm(A))?.phone === 'أُلغيت دعوته')), 'the profile says his invite was cancelled');
  const PB3 = await phone('B3', b3);
  ok(!!(await until(() => ended(PB3))), "the cancelled invite's link opens nothing");

  // ---- C, a woman: her forms; a double tap asks once and makes one change
  await closeProfile(A);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await A.type('.sfield input', C[0], { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), C[1]);
  await wait(1500);
  const c1 = await copyLink(A);
  ok(!!c1, 'C is invited from the members screen');
  const PC1 = await phone('C1', c1);
  await click(PC1, 'نعم، أنا');
  ok(!!(await until(() => ready(PC1))), 'C joined');
  ok(await openProfile(A, ...C), "C's profile opens");
  ok(!!(await until(async () => (await perm(A))?.phone === 'انضمت من هاتفها')), 'the profile shows her joined, in her forms');
  dialogs.length = 0;
  ok(await permButton(A, 'انضمت من هاتفها', 'جهاز جديد', 2), 'a double tap on «جهاز جديد»');
  ok(dialogs.length === 1 && dialogs[0].includes('هاتفها الحالي') && dialogs[0].includes('لها دعوة جديدة تفتحها على هاتفها الجديد'), 'it asks once, in her forms: ' + dialogs[0]);
  ok(!!(await copyLink(A)), 'her fresh invite opens');
  ok(!!(await until(async () => (await kidCount()) === k0 + 4)), 'the family key is renewed');
  ok(!!(await until(() => ended(PC1))), 'her old phone forgets the family');
  await wait(1500);
  ok((await kidCount()) === k0 + 4, 'one renewal only');
  await closeProfile(A);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  const cRows = await A.evaluate(n => [...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].filter(r => r.querySelector('.pt.tap b')?.innerText.trim().startsWith(n)).map(r => r.querySelector('.pt.tap > small')?.innerText.trim()), C[0]);
  ok(JSON.stringify(cRows) === JSON.stringify(['بانتظار الانضمام']), 'one new invite for her in the members list: ' + JSON.stringify(cRows));

  // ---- the members screen asks the same way and still renews
  dialogs.length = 0;
  const cancelled = await A.evaluate(n => {
    const r = [...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.querySelector('.pt.tap b')?.innerText.trim().startsWith(n) && e.querySelector('button[aria-label="إلغاء"]'));
    r?.querySelector('button[aria-label="إلغاء"]').click();
    return !!r;
  }, C[0]);
  ok(cancelled && dialogs.length === 1 && dialogs[0].startsWith('إلغاء دعوة') && dialogs[0].includes('يُجدَّد مفتاح العائلة'), 'the members screen cancels her invite after the same question: ' + dialogs[0]);
  ok(!!(await until(async () => (await kidCount()) === k0 + 5)), 'and the family key is renewed');
  const ver = await A.evaluate(async () => { const t = [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')); if (t && !document.querySelector('.page.admin')) { t.click(); await new Promise(r => setTimeout(r, 500)); } return [...document.querySelectorAll('.hint')].map(h => h.innerText.match(/الإصدار (\d+)/)?.[1]).find(Boolean); });
  ok(!!(await until(async () => (await A.evaluate(async () => { const t = [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')); if (t && !document.querySelector('.page.admin')) { t.click(); await new Promise(r => setTimeout(r, 500)); } return [...document.querySelectorAll('.hint')].map(h => h.innerText.match(/الإصدار (\d+)/)?.[1]).find(Boolean); })) === String(k0 + 5))), 'the family key card shows version ' + (k0 + 5) + ' (was ' + ver + ')');

  // ---- D joins, then is recorded as deceased: his phone can be unlinked, not replaced
  await closeProfile(A);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await A.type('.sfield input', D[0], { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), D[1]);
  await wait(1500);
  const d1 = await copyLink(A);
  const PD = await phone('D', d1);
  await click(PD, 'نعم، أنا');
  ok(!!(await until(() => ready(PD))), 'D joined');
  ok(await openProfile(A, ...D), "D's profile opens");
  ok(!!(await until(async () => (await perm(A))?.phone === 'انضم من هاتفه')), 'the profile shows him joined');
  await click(A, 'تعديل البيانات');
  await click(A, 'متوفى', '.seg button');
  await click(A, 'حفظ', '.foot button', 1500);
  const dRow = await A.evaluate(() => {
    const r = [...document.querySelectorAll('.page.profile section.perms .permphone .prow')].find(e => e.innerText.includes('انضم من هاتفه'));
    return r ? [...r.querySelectorAll('button')].map(b => b.textContent.trim()) : null;
  });
  ok(JSON.stringify(dRow) === JSON.stringify(['فصل الجهاز']), 'deceased: his linked phone offers only «فصل الجهاز»: ' + JSON.stringify(dRow));
  await closeProfile(A);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  const dMembers = await A.evaluate(n => {
    const r = [...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.querySelector('.pt.tap b')?.innerText.trim().startsWith(n));
    return r ? [...r.querySelectorAll('button.btn')].map(b => b.textContent.trim() || b.getAttribute('aria-label')) : null;
  }, D[0]);
  ok(JSON.stringify(dMembers) === JSON.stringify(['إلغاء']), 'and the members screen offers him only the unlink button: ' + JSON.stringify(dMembers));
  ok(await openProfile(A, ...D), "D's profile again");
  dialogs.length = 0;
  ok(await permButton(A, 'انضم من هاتفه', 'فصل الجهاز'), 'unlink his phone from the profile');
  ok(!!(await until(async () => (await kidCount()) === k0 + 6)), 'the family key is renewed');
  ok(!!(await until(() => ended(PD))), 'his phone forgets the family');
  ok(!!(await until(async () => !(await perm(A)))), 'nothing is left to manage: the section goes');

  // ---- a wife from outside the family: no permissions section
  ok(await openProfile(A, ...MAN), "a man's profile opens");
  ok(!!(await perm(A)), 'he has the permissions section');
  await click(A, 'إضافة زوجة', '.page.profile button.addsp');
  await typeIn(A, '.addsheet input.bigin[dir="rtl"]', WIFE_OUT);
  ok(await click(A, 'حفظ', '.addsheet .foot button', 1800), 'a wife from outside is added');
  await A.evaluate(w => [...document.querySelectorAll('.page.profile .card.fam .prow')].find(e => e.innerText.includes(w))?.click(), WIFE_OUT);
  await wait(900);
  const wife = await A.evaluate(() => ({ ns: document.querySelector('.page.profile .pc .ns')?.textContent ?? '', perms: !!document.querySelector('.page.profile section.perms') }));
  ok(wife.ns.includes('من خارج العائلة') && !wife.perms, 'her profile has no permissions section: ' + JSON.stringify(wife));
  await closeProfile(A);

  // ---- the log: everything after the last renewal uses the newest key
  const log = await fetchLog();
  const newest = log.at(-1).kid;
  ok(log.slice(log.findIndex(x => x.kid === newest)).every(x => x.kid === newest), 'every entry after the last renewal uses the newest key');
} catch (e) {
  await t.crash(e);
}
await t.finish();
