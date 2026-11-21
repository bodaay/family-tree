// Review: the old root-admin flows with marriages in the tree. Deleting a cousin
// wife (her child stays with his father, unlinked from her; undo links him
// back), moving a child and undoing it (his mother comes back), deleting a line
// with descendants and undoing it (the people count comes back), and the checks
// of the add-spouse sheet (close blood relatives, a wife's current husband,
// four current wives).
//   node mar-review-regress.mjs BASE admin-link-file
import { setup, click, typeIn, typeYear, openProfile, closeProfile, families, removeAllMarriages, addChild, wait } from './mar-lib.mjs';

const t = setup();
const { ok } = t;
const MAN = ['مازن فيصل', '1960'];
const COUSIN = ['هيلة', '1967'];
const DAUGHTER = ['نوف عبدالمحسن', '1973'];
const KID = 'ليلى';

const people = async p => {
  await closeProfile(p);
  await click(p, 'الشجرة', '.tab', 600);
  // leave the focused person, back to the whole tree
  for (let i = 0; i < 3 && (await p.evaluate(() => !document.querySelector('.top .sub b'))); i++) {
    await p.evaluate(() => document.querySelector('.searchbar .round')?.click());
    await wait(500);
  }
  return p.evaluate(() => document.querySelector('.top .sub b')?.innerText ?? '');
};
const undo = (p, text) =>
  p.evaluate(x => [...document.querySelectorAll('.requests .card.hist')].find(c => c.innerText.includes(x) && !c.innerText.includes('تراجع:') && c.querySelector('button'))?.querySelector('button').click(), text).then(() => wait(1800));
/** The names the spouse search lists for a query. */
const spouseSearch = async (p, q) => {
  await p.evaluate(() => (document.querySelector('.addsheet .picked1 .prow') ?? [...document.querySelectorAll('.addsheet button')].find(b => b.textContent.includes('من الشجرة')))?.click());
  await wait(500);
  await p.type('.sfield input', q, { delay: 8 });
  await wait(600);
  return p.evaluate(() => [...document.querySelectorAll('.results .prow')].map(e => e.innerText.replace(/\s+/g, ' ')));
};
const outsideWife = async (p, name) => {
  await click(p, 'إضافة زوجة', '.page.profile button.addsp');
  await typeIn(p, '.addsheet input.bigin[dir="rtl"]', name);
  await click(p, 'حفظ', '.addsheet .foot button', 1800);
};

try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  const start = await people(A);
  ok(/\d/.test(start), 'the people count shows: ' + start);
  ok(await openProfile(A, ...MAN), 'open the man');
  await removeAllMarriages(A);

  // the spouse search: a grand-niece (4th degree, through his brother) is not offered, a cousin is
  await click(A, 'إضافة زوجة', '.page.profile button.addsp');
  await click(A, 'من العائلة', '.addsheet .seg button', 400);
  const niece = await spouseSearch(A, 'العنود ياسر');
  ok(!niece.some(r => r.includes('2017')), 'a grand-niece is not offered as a wife: ' + niece.join(' / '));
  await A.evaluate(() => document.querySelector('.searchpage .round')?.click());
  await wait(400);
  const cousin = await spouseSearch(A, COUSIN[0]);
  ok(cousin.some(r => r.includes(COUSIN[1])), 'a cousin is offered');
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), COUSIN[1]);
  await wait(600);
  await typeYear(A, 'سنة الزواج', '1992');
  await click(A, 'حفظ', '.addsheet .foot button', 1800);
  await addChild(A, { sex: 'f', name: KID });
  let fams = await families(A);
  ok(fams.find(f => f.spouse.includes(COUSIN[0]))?.kids.includes(KID), 'the cousin wife and her daughter are recorded');
  const withKid = await people(A);

  // deleting the cousin wife: her daughter stays with her father, unlinked from her
  ok(await openProfile(A, ...COUSIN), 'open the cousin wife');
  await click(A, 'حذف من الشجرة', '.page.profile button', 1800);
  ok(await openProfile(A, ...MAN), 'reopen the man');
  fams = await families(A);
  ok(!fams.some(f => f.spouse.includes(COUSIN[0])) && fams.some(f => !f.spouse && f.kids.includes(KID)), 'her marriage is gone and her daughter stays with him, no mother recorded');
  const less = await people(A);
  ok(parseInt(less) === parseInt(withKid) - 1, `one person less: ${withKid} → ${less}`);
  await click(A, 'الطلبات', '.tab', 600);
  await undo(A, 'حذف: ' + COUSIN[0]);
  ok(await openProfile(A, ...MAN), 'reopen the man after undoing');
  fams = await families(A);
  ok(fams.find(f => f.spouse.includes(COUSIN[0]))?.kids.includes(KID), 'undoing brings the wife, the marriage and her daughter\'s link back');

  // moving the daughter under another father, then undoing: her mother comes back
  await A.evaluate(k => [...document.querySelectorAll('.page.profile .fp')].find(e => e.innerText.includes(k))?.click(), KID);
  await wait(900);
  await click(A, 'نقل إلى أب آخر', '.page.profile button', 600);
  await A.type('.sfield input', 'عبدالمحسن', { delay: 8 });
  await wait(600);
  await A.evaluate(() => document.querySelector('.results .prow')?.click());
  await wait(1800);
  await closeProfile(A);
  await openProfile(A, ...MAN);
  ok(!(await families(A)).some(f => f.kids.includes(KID)), 'the moved daughter left his family');
  await click(A, 'الطلبات', '.tab', 600);
  await undo(A, 'نقل: ' + KID);
  await openProfile(A, ...MAN);
  ok((await families(A)).find(f => f.spouse.includes(COUSIN[0]))?.kids.includes(KID), 'undoing the move puts her back under her mother');

  // the sheet's checks: a woman with a current husband, four current wives
  ok(await openProfile(A, ...DAUGHTER), 'open the daughter');
  await removeAllMarriages(A);
  await click(A, 'إضافة زوج', '.page.profile button.addsp');
  await typeIn(A, '.addsheet input.bigin[dir="rtl"]', 'بدر بن سالم العنزي');
  await click(A, 'حفظ', '.addsheet .foot button', 1800);
  await click(A, 'إضافة زوج', '.page.profile button.addsp');
  await typeIn(A, '.addsheet input.bigin[dir="rtl"]', 'سالم بن بدر العنزي');
  const second = await A.evaluate(() => ({ warn: document.querySelector('.addsheet .warnbox')?.textContent ?? '', off: document.querySelector('.addsheet .foot .btn.primary')?.disabled }));
  ok(second.warn.includes('لها زوج حالي') && second.off, 'a second current husband is refused: ' + second.warn);
  await click(A, 'مطلّقان', '.addsheet .seg button', 300);
  ok(await A.evaluate(() => !document.querySelector('.addsheet .warnbox') && !document.querySelector('.addsheet .foot .btn.primary').disabled), 'an earlier, ended marriage can be recorded');
  await click(A, 'إلغاء', '.addsheet .ahead button', 400);
  await removeAllMarriages(A);
  ok(await openProfile(A, ...MAN), 'open the man for four wives');
  for (const w of ['أ بنت س', 'ب بنت س', 'ج بنت س']) await outsideWife(A, w);
  await click(A, 'إضافة زوجة', '.page.profile button.addsp');
  await typeIn(A, '.addsheet input.bigin[dir="rtl"]', 'د بنت س');
  const fifth = await A.evaluate(() => document.querySelector('.addsheet .warnbox')?.textContent ?? '');
  ok(fifth.includes('أربع زوجات'), 'a fifth current wife is refused: ' + fifth);
  await click(A, 'إلغاء', '.addsheet .ahead button', 400);

  // deleting a line with descendants and undoing it (as before marriages)
  const before = await people(A);
  ok(await openProfile(A, 'راشد', 'الجيل الرابع'), 'open راشد');
  await click(A, 'حذف من الشجرة', '.page.profile button', 1800);
  const after = await people(A);
  ok(parseInt(after) < parseInt(before), `his line is deleted: ${before} → ${after}`);
  await click(A, 'الطلبات', '.tab', 600);
  await undo(A, 'حذف: راشد');
  const back = await people(A);
  ok(back === before, `undoing brings the line back: ${back}`);

  // clean up
  ok(await openProfile(A, ...MAN), 'open the man to clean up');
  await removeAllMarriages(A);
  await click(A, 'الطلبات', '.tab', 600);
  await undo(A, 'إضافة ابنة: ' + KID);
  const end = await people(A);
  ok(end === start, `clean again: ${end}`);
  await t.finish();
} catch (e) {
  await t.crash(e);
}
