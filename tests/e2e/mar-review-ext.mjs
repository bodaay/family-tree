// Review: a spouse from outside the family in every screen (focus in the 3D tree
// and the 2D chart, the family view, the relation screen), a child added from
// the outside wife's own sheet, deleting an outside wife (her children are
// unlinked, undo links them back), and recording a husband's death (his
// marriage becomes widowhood, undo brings it back).
//   node mar-review-ext.mjs BASE admin-link-file
import { setup, click, typeIn, typeYear, openProfile, closeProfile, families, removeAllMarriages, wait } from './mar-lib.mjs';

const t = setup();
const { ok, shot } = t;
const MAN = ['مازن فيصل', '1960'];
const WIFE_OUT = 'لطيفة بنت ناصر المطيري';

/** Opens the profile of someone listed in the open profile's family cards. */
const openSpouse = (p, who) => p.evaluate(w => [...document.querySelectorAll('.page.profile .card.fam .prow')].find(e => e.innerText.includes(w))?.click(), who).then(() => wait(900));
const undoLatest = (p, text) =>
  p.evaluate(x => [...document.querySelectorAll('.page.profile .card.hist')].filter(c => c.innerText.includes(x) && !c.innerText.includes('تراجع:')).at(-1)?.querySelector('button')?.click(), text).then(() => wait(1800));
const errCount = () => t.errs.length;

try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  ok(await openProfile(A, ...MAN), 'open the man\'s profile');
  await removeAllMarriages(A);

  // an outside wife
  await click(A, 'إضافة زوجة', '.page.profile button.addsp');
  await typeIn(A, '.addsheet input.bigin[dir="rtl"]', WIFE_OUT);
  await typeYear(A, 'سنة الزواج', '1990');
  await click(A, 'حفظ', '.addsheet .foot button', 1800);
  ok((await families(A)).some(f => f.spouse.includes(WIFE_OUT)), 'the outside wife is recorded');

  // her own profile → "in the tree": the 3D tree and the family view focus on her
  await openSpouse(A, WIFE_OUT);
  ok(await A.evaluate(w => document.querySelector('.page.profile h1')?.textContent === w, WIFE_OUT), 'her profile opens');
  let before = errCount();
  await A.evaluate(() => document.querySelector('.page.profile .navbtns .round[aria-label="في الشجرة"]')?.click());
  await wait(2500);
  const sheet = await A.evaluate(() => ({ who: document.querySelector('.sheet .who h2')?.textContent ?? '', ns: document.querySelector('.sheet .who .ns')?.textContent ?? '' }));
  await shot(A, 'x00-outside-wife-focus.png');
  ok(sheet.who.includes('لطيفة') && sheet.ns.includes('من خارج العائلة'), 'the 3D tree focuses her without errors: ' + sheet.ns);
  ok(errCount() === before, 'no errors while focusing an outside wife in 3D');

  // the relation screen with her
  before = errCount();
  await A.evaluate(() => document.querySelector('.sheet .acts button[aria-label="صلة القرابة"]')?.click());
  await wait(2500);
  ok(errCount() === before, 'the relation screen opens with an outside wife without errors');
  await click(A, 'الشجرة', '.tab', 800);
  await A.evaluate(() => document.querySelector('.searchbar .round')?.click());
  await wait(600);

  // the 2D chart, focused on her
  before = errCount();
  ok(await click(A, '2D', '.side button', 1200), 'switch to the 2D chart');
  await closeProfile(A);
  await openProfile(A, ...MAN);
  await openSpouse(A, WIFE_OUT);
  await A.evaluate(() => document.querySelector('.page.profile .navbtns .round[aria-label="في الشجرة"]')?.click());
  await wait(2500);
  ok(await A.evaluate(() => !!document.querySelector('canvas.tree') && (document.querySelector('.sheet .who h2')?.textContent ?? '').includes('لطيفة')), 'the 2D chart is focused on her');
  ok(errCount() === before, 'the 2D chart focuses an outside wife without errors');
  await A.evaluate(() => document.querySelector('.searchbar .round')?.click());
  await wait(500);
  await click(A, '3D', '.side button', 1000);

  // a child added from her own profile: the father is her husband, she is the mother
  await openProfile(A, ...MAN);
  await openSpouse(A, WIFE_OUT);
  await click(A, 'إضافة ابن أو ابنة', '.page.profile button.link');
  const step1 = await A.evaluate(() => ({ q: document.querySelector('.addsheet .q')?.textContent ?? '', rows: [...document.querySelectorAll('.addsheet .card.list .brow .pt b')].map(b => b.textContent) }));
  await shot(A, 'x01-addchild-father-step.png');
  ok(step1.q === 'من الأب؟' && step1.rows.length === 1 && step1.rows[0].includes('مازن'), 'adding a child to an outside wife asks for the father, her husband only: ' + step1.rows.join(' / '));
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await click(A, 'ابنة', '.addsheet .bigchoice button', 300);
  await click(A, 'التالي', '.addsheet .foot button', 400);
  const q2 = await A.evaluate(() => document.querySelector('.addsheet .q')?.textContent ?? '');
  ok(q2 === 'ما اسمها؟', 'her daughter with a father in the tree gets a first name only: ' + q2);
  await A.type('.addsheet input.bigin', 'غلا', { delay: 8 });
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await click(A, 'إضافة إلى الشجرة', '.addsheet .foot button', 1800);
  await closeProfile(A);
  await openProfile(A, ...MAN);
  let fams = await families(A);
  ok(fams.find(f => f.spouse.includes(WIFE_OUT))?.kids.includes('غلا'), 'the daughter shows under her mother on the father\'s profile');

  // deleting the outside wife herself: her daughter stays with her father, no longer linked to her
  await openSpouse(A, WIFE_OUT);
  await click(A, 'حذف من الشجرة', '.page.profile button', 1800);
  await openProfile(A, ...MAN);
  fams = await families(A);
  ok(!fams.some(f => f.spouse.includes(WIFE_OUT)), 'the deleted outside wife and her marriage are gone');
  const ghala = fams.find(f => f.kids.includes('غلا'));
  ok(!!ghala && !ghala.spouse, 'her daughter stays, with no mother recorded');
  // her daughter's record no longer points at her (the editor offers no stale mother)
  await A.evaluate(() => [...document.querySelectorAll('.page.profile .fp')].find(e => e.innerText.includes('غلا'))?.click());
  await wait(900);
  await click(A, 'تعديل البيانات', '.page.profile button');
  const picks = await A.evaluate(() => ({ rows: [...document.querySelectorAll('.addsheet .parentpick .brow')].map(b => b.innerText.replace(/\s+/g, ' ')), on: document.querySelector('.addsheet .parentpick .brow.on')?.innerText ?? '' }));
  ok(!picks.rows.length || picks.on.includes('غير مسجلة'), 'the daughter\'s editor shows her mother as not recorded: ' + JSON.stringify(picks));
  await click(A, 'إلغاء', '.addsheet .ahead button', 400);
  await closeProfile(A);
  // undo the deletion: the wife, the marriage and the link come back
  await openProfile(A, ...MAN);
  await click(A, 'الطلبات', '.tab', 600);
  await A.evaluate(w => [...document.querySelectorAll('.requests .card.hist')].find(c => c.innerText.includes('حذف: ' + w) && c.querySelector('button'))?.querySelector('button').click(), WIFE_OUT);
  await wait(1800);
  ok(await openProfile(A, ...MAN), 'reopen the man after undoing');
  fams = await families(A);
  ok(fams.find(f => f.spouse.includes(WIFE_OUT))?.kids.includes('غلا'), 'undoing the deletion brings the wife back with her daughter');

  // recording the husband's death: his marriage becomes widowhood with that year
  await click(A, 'تعديل البيانات', '.page.profile button');
  await click(A, 'متوفى', '.addsheet .seg button', 300);
  await typeIn(A, '.addsheet input[placeholder^="سنة الوفاة"]', '2020');
  ok(await A.evaluate(() => [...document.querySelectorAll('.addsheet .qh')].some(e => e.textContent.includes('ترمّلًا'))), 'the editor says his marriage becomes widowhood');
  await shot(A, 'x02-death-widowhood.png');
  await click(A, 'حفظ', '.addsheet .foot button', 1800);
  fams = await families(A);
  const w = fams.find(f => f.spouse.includes(WIFE_OUT));
  ok(w?.line === 'أرملة · 1990–2020', 'his death turns his marriage into widowhood ending that year: ' + w?.line);
  await undoLatest(A, 'تعديل: مازن');
  fams = await families(A);
  ok(fams.find(f => f.spouse.includes(WIFE_OUT))?.line === 'متزوجان منذ 1990', 'undoing the death brings the marriage back: ' + fams.find(f => f.spouse.includes(WIFE_OUT))?.line);
  ok(!(await A.evaluate(() => [...document.querySelectorAll('.page.profile .tag')].some(x => x.textContent.includes('رحمه')))), 'and he is alive again');

  // clean up: the marriage (and the outside wife with it), and the daughter
  await removeAllMarriages(A);
  await closeProfile(A);
  await click(A, 'الطلبات', '.tab', 600);
  await A.evaluate(() => [...document.querySelectorAll('.requests .card.hist')].find(c => c.innerText.includes('إضافة ابنة: غلا') && c.querySelector('button'))?.querySelector('button').click());
  await wait(1500);
  await openProfile(A, ...MAN);
  fams = await families(A);
  ok(!fams.some(f => f.spouse) && !fams.some(f => f.kids.includes('غلا')), 'clean again for the next run');
  await t.finish();
} catch (e) {
  await t.crash(e);
}
