// Marriages, root admin: an outside wife and a cousin wife for one man, children
// per wife, a daughter's outside husband and their child, divorce with an end
// year then undone, a marriage removed, and a child's mother changed.
//   node mar-admin.mjs BASE admin-link-file [screenshots-dir]
import { setup, click, typeIn, typeYear, openProfile, closeProfile, families, history, editMarriageOf, removeAllMarriages, addChild, wait } from './mar-lib.mjs';

const t = setup();
const { ok, shot } = t;
// the test family (tests/e2e/fixture): a man, a cousin of his, a daughter of another house
const MAN = ['مازن فيصل', '1960'];
const COUSIN = ['هيلة', '1967'];
const DAUGHTER = ['نوف عبدالمحسن', '1973'];
const WIFE_OUT = 'هيا بنت سعد العتيبي';
const HUSBAND_OUT = 'خالد بن فهد الدوسري';

try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  ok(await A.evaluate(() => !!document.querySelector('.home')), 'root admin opens the family');

  // start clean if an earlier run stopped half way
  ok(await openProfile(A, ...MAN), 'open the man\'s profile');
  await removeAllMarriages(A);
  ok(await openProfile(A, ...DAUGHTER), 'open the daughter\'s profile');
  await removeAllMarriages(A);

  // ---- an outside wife
  ok(await openProfile(A, ...MAN), 'open the man\'s profile again');
  ok(await click(A, 'إضافة زوجة', '.page.profile button.addsp'), 'the profile offers «إضافة زوجة» for a man');
  ok(await A.evaluate(() => document.querySelector('.addsheet .ahead b')?.textContent === 'إضافة زوجة'), 'the add-wife sheet opens');
  await typeIn(A, '.addsheet input.bigin[dir="rtl"]', WIFE_OUT);
  await typeYear(A, 'سنة الميلاد', '1966');
  await typeYear(A, 'سنة الزواج', '1988');
  await shot(A, 'm01-add-outside-wife.png');
  ok(await click(A, 'حفظ', '.addsheet .foot button', 1800), 'save the outside wife');
  let fams = await families(A);
  let wifeCard = fams.find(f => f.spouse.includes(WIFE_OUT));
  ok(!!wifeCard, 'the outside wife shows in the family');
  ok(wifeCard?.line === 'متزوجان منذ 1988', 'her marriage shows its status and year: ' + wifeCard?.line);

  // ---- a cousin wife, picked from the tree, year in Hijri
  await click(A, 'إضافة زوجة', '.page.profile button.addsp');
  await click(A, 'من العائلة', '.addsheet .seg button', 400);
  ok(await click(A, 'اختر الزوجة من الشجرة', '.addsheet button', 500), 'pick a wife from the tree');
  await A.type('.sfield input', COUSIN[0], { delay: 8 });
  await wait(600);
  const onlyWomen = await A.evaluate(() => [...document.querySelectorAll('.results .prow .av')].every(a => a.classList.contains('f')));
  ok(onlyWomen, 'the spouse search lists women only');
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), COUSIN[1]);
  await wait(600);
  ok(await A.evaluate(n => (document.querySelector('.addsheet .picked1')?.innerText ?? '').includes(n), COUSIN[0]), 'the cousin is picked');
  await click(A, 'هجري', '.addsheet .seg button', 300);
  await typeYear(A, 'سنة الزواج', '1415');
  await shot(A, 'm02-add-cousin-wife.png');
  await click(A, 'حفظ', '.addsheet .foot button', 1800);
  fams = await families(A);
  const cousinCard = fams.find(f => f.spouse.includes(COUSIN[0]));
  ok(!!cousinCard && cousinCard.line.startsWith('متزوجان منذ 199'), 'the cousin wife shows, her Hijri year in Gregorian: ' + cousinCard?.line);

  // ---- children per wife
  const c1 = await addChild(A, { other: 'هيا', sex: 'm', name: 'ثامر' });
  ok(c1.hasOther, 'adding a child to a man with wives asks for the mother');
  ok(c1.defaultPick?.includes(COUSIN[0]), 'the latest current wife is chosen by default: ' + c1.defaultPick);
  ok(c1.review.includes('الأم') && c1.review.includes('هيا'), 'the review names the mother');
  const c2 = await addChild(A, { sex: 'f', name: 'ريم' });
  ok(c2.question.includes('اسمها'), 'a child of a father in the tree is asked for her first name only');
  await closeProfile(A);
  await openProfile(A, ...MAN);
  fams = await families(A);
  await shot(A, 'm03-wives-and-children.png', 'الأسرة');
  ok(fams.find(f => f.spouse.includes(WIFE_OUT))?.kids.includes('ثامر'), 'ثامر is under the outside wife');
  ok(fams.find(f => f.spouse.includes(COUSIN[0]))?.kids.includes('ريم'), 'ريم is under the cousin wife');
  ok(fams.some(f => !f.spouse && f.head.includes('الأم غير مسجلة') && f.kids.length > 0), 'children with no mother recorded keep their own group');
  // the family view: each wife with her own children
  await A.evaluate(() => document.querySelector('.page.profile .navbtns .round[aria-label="في الشجرة"]')?.click());
  await wait(1800);
  await shot(A, 'm03b-man-bloom.png');
  await A.evaluate(() => document.querySelector('.searchbar .round')?.click());
  await wait(400);
  await openProfile(A, ...MAN);

  // the outside wife's own profile: from outside, her husband and her son
  await A.evaluate(w => [...document.querySelectorAll('.page.profile .card.fam .prow')].find(e => e.innerText.includes(w))?.click(), WIFE_OUT);
  await wait(900);
  const wifeLine = await A.evaluate(() => document.querySelector('.page.profile .pc .ns')?.textContent ?? '');
  ok(wifeLine.includes('من خارج العائلة') && wifeLine.includes('زوجة مازن'), 'the outside wife is shown as from outside, wife of her husband: ' + wifeLine);
  const wifeFams = await families(A);
  ok(wifeFams.some(f => f.spouse.includes('مازن') && f.kids.includes('ثامر')), 'her profile shows her husband and their son');
  ok(!(await A.evaluate(() => [...document.querySelectorAll('.page.profile h3')].some(h => h.textContent === 'النسب'))), 'no nasab chain for someone from outside');
  await closeProfile(A);

  // she is not a member: search does not find her, the tree count is unchanged
  await click(A, 'الشجرة', '.tab', 400);
  await A.evaluate(() => document.querySelector('.home .search')?.click());
  await wait(300);
  await A.type('.sfield input', 'هيا بنت سعد', { delay: 8 });
  await wait(500);
  ok(!(await A.evaluate(w => [...document.querySelectorAll('.results .prow')].some(e => e.innerText.includes(w)), WIFE_OUT)), 'search does not list a spouse from outside');
  await A.evaluate(() => document.querySelector('.searchpage .round')?.click());
  await wait(300);

  // ---- a daughter with an outside husband, and their son
  ok(await openProfile(A, ...DAUGHTER), 'open the daughter\'s profile');
  ok(await click(A, 'إضافة زوج', '.page.profile button.addsp'), 'the profile offers «إضافة زوج» for a woman');
  await typeIn(A, '.addsheet input.bigin[dir="rtl"]', HUSBAND_OUT);
  await typeYear(A, 'سنة الزواج', '2000');
  await click(A, 'حفظ', '.addsheet .foot button', 1800);
  fams = await families(A);
  ok(fams.some(f => f.spouse.includes(HUSBAND_OUT) && f.line === 'متزوجان منذ 2000'), 'the outside husband shows with the marriage');
  const c3 = await addChild(A, { sex: 'm', name: 'سعد بن خالد الدوسري' });
  ok(c3.defaultPick?.includes('خالد'), 'her husband is the default father');
  // since 1.14: the given name alone, his father's name following it; a name typed in full anyway stays as typed
  ok(!c3.question.includes('كاملًا'), 'a child of an outside father is asked for his given name · ' + c3.question);
  fams = await families(A);
  await shot(A, 'm04-daughter-outside-husband.png', 'الأسرة');
  ok(fams.find(f => f.spouse.includes(HUSBAND_OUT))?.kids.includes('سعد بن خالد الدوسري'), 'the son shows under his mother, with his father');
  await A.evaluate(() => [...document.querySelectorAll('.page.profile .fp')].find(e => e.innerText.includes('سعد بن خالد'))?.click());
  await wait(900);
  const son = await A.evaluate(() => ({ h: document.querySelector('.page.profile h1')?.textContent ?? '', ns: document.querySelector('.page.profile .pc .ns')?.textContent ?? '' }));
  ok(son.h === 'سعد بن خالد الدوسري' && son.ns.startsWith('أمه نوف'), 'his full typed name, and his mother under it: ' + son.ns);
  // in the tree: under his mother
  await A.evaluate(() => document.querySelector('.page.profile .navbtns .round[aria-label="في الشجرة"]')?.click());
  await wait(1500);
  const crumbs = await A.evaluate(() => document.querySelector('.crumbs')?.innerText.replace(/\s+/g, ' ') ?? '');
  ok(crumbs.includes('نوف') && crumbs.trim().endsWith('سعد بن خالد الدوسري'), 'in the tree he sits under his mother');
  await shot(A, 'm05-son-in-tree.png');
  await A.evaluate(() => [...document.querySelectorAll('.crumbs button')].find(b => b.textContent.trim() === 'نوف')?.click());
  await wait(1500);
  const facts = await A.evaluate(() => document.querySelector('.sheet .facts2')?.innerText ?? '');
  ok(facts.includes('ابن واحد'), 'the family view counts him among her children');
  await shot(A, 'm06-daughter-bloom.png');
  await A.evaluate(() => document.querySelector('.searchbar .round')?.click());
  await wait(500);
  // the 2D chart: outside spouses have no place in it; the son hangs from his mother
  ok(await click(A, '2D', '.side button', 1200), 'switch to the 2D chart');
  await A.evaluate(() => document.querySelector('.home .search')?.click());
  await wait(300);
  await A.type('.sfield input', 'سعد بن خالد', { delay: 8 });
  await wait(500);
  await A.evaluate(() => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes('سعد بن خالد الدوسري'))?.click());
  await wait(1800);
  ok(await A.evaluate(() => !!document.querySelector('canvas.tree') && document.querySelector('.crumbs')?.innerText.includes('نوف')), 'the 2D chart focuses the son under his mother');
  await shot(A, 'm06b-son-2d.png');
  await A.evaluate(() => document.querySelector('.searchbar .round')?.click());
  await wait(500);
  await click(A, '3D', '.side button', 1000);

  // deleting the daughter takes her son and her outside husband with her; undoing brings all back
  await openProfile(A, ...DAUGHTER);
  await click(A, 'حذف من الشجرة', '.page.profile button', 1800);
  await click(A, 'الشجرة', '.tab', 400);
  await A.evaluate(() => document.querySelector('.home .search')?.click());
  await wait(300);
  await A.type('.sfield input', DAUGHTER[0], { delay: 8 });
  await wait(500);
  ok(!(await A.evaluate(y => [...document.querySelectorAll('.results .prow')].some(e => e.innerText.includes(y)), DAUGHTER[1])), 'the deleted daughter is gone from the tree');
  await A.evaluate(() => document.querySelector('.searchpage .round')?.click());
  await wait(300);
  await click(A, 'الطلبات', '.tab', 600);
  await A.evaluate(() => [...document.querySelectorAll('.requests .card.hist')].find(c => c.innerText.includes('حذف: نوف') && c.querySelector('button'))?.querySelector('button').click());
  await wait(1800);
  ok(await openProfile(A, ...DAUGHTER), 'undoing the deletion brings her back');
  fams = await families(A);
  ok(fams.some(f => f.spouse.includes(HUSBAND_OUT) && f.line === 'متزوجان منذ 2000' && f.kids.includes('سعد بن خالد الدوسري')), 'with her outside husband, their marriage and their son');
  await closeProfile(A);

  // ---- divorce with an end year, then undo
  await openProfile(A, ...MAN);
  ok(await editMarriageOf(A, WIFE_OUT), 'open the marriage editor');
  await click(A, 'مطلّقان', '.addsheet .seg button', 300);
  ok(await typeYear(A, 'سنة الانفصال', '2010'), 'an end year can be typed for a divorce');
  await shot(A, 'm07-divorce.png');
  await click(A, 'حفظ', '.addsheet .foot button', 1800);
  fams = await families(A);
  ok(fams.find(f => f.spouse.includes(WIFE_OUT))?.line === 'مطلّقان · 1988–2010', 'the marriage shows divorced with its years: ' + fams.find(f => f.spouse.includes(WIFE_OUT))?.line);
  const hist = await history(A);
  ok(hist.some(h => h.includes('انفصال') && h.includes('معتمد')), 'the divorce is in the profile\'s history');
  // the latest divorce (an earlier run's may be listed too)
  await A.evaluate(() => [...document.querySelectorAll('.page.profile .card.hist')].filter(c => c.innerText.includes('انفصال') && !c.innerText.includes('تراجع:')).at(-1)?.querySelector('button')?.click());
  await wait(1800);
  fams = await families(A);
  ok(fams.find(f => f.spouse.includes(WIFE_OUT))?.line === 'متزوجان منذ 1988', 'undoing the divorce brings the marriage back: ' + fams.find(f => f.spouse.includes(WIFE_OUT))?.line);

  // ---- a child's mother changed later (root admin's editor)
  await A.evaluate(() => [...document.querySelectorAll('.page.profile .fp')].find(e => e.innerText.includes('ريم'))?.click());
  await wait(900);
  await click(A, 'تعديل البيانات', '.page.profile button');
  const choices = await A.evaluate(() => [...document.querySelectorAll('.addsheet .parentpick .brow b')].map(b => b.textContent));
  ok(choices.length === 3 && choices.some(c => c.includes('هيا')) && choices.some(c => c.includes(COUSIN[0])), 'the editor offers the father\'s wives as mother: ' + choices.join(' / '));
  await click(A, 'هيا', '.addsheet .parentpick .brow', 300);
  await click(A, 'حفظ', '.addsheet .foot button', 1800);
  await closeProfile(A);
  await openProfile(A, ...MAN);
  fams = await families(A);
  ok(fams.find(f => f.spouse.includes(WIFE_OUT))?.kids.includes('ريم'), 'ريم now shows under her new mother');

  // ---- remove a marriage: the outside wife goes with it, her children stay
  ok(await editMarriageOf(A, WIFE_OUT), 'open the marriage editor to remove it');
  await click(A, 'حذف الزواج', '.addsheet button', 1800);
  fams = await families(A);
  ok(!fams.some(f => f.spouse.includes(WIFE_OUT)), 'the removed marriage and the outside wife are gone');
  const rest = fams.find(f => !f.spouse);
  ok(rest?.kids.includes('ثامر') && rest?.kids.includes('ريم'), 'her children stay, with no mother recorded');
  ok(fams.some(f => f.spouse.includes(COUSIN[0]) && f.line.startsWith('متزوجان')), 'the other marriage is untouched');
  await shot(A, 'm08-after-remove.png', 'الأسرة');
  const undoLatest = text => A.evaluate(x => [...document.querySelectorAll('.page.profile .card.hist')].filter(c => c.innerText.includes(x) && !c.innerText.includes('تراجع:')).at(-1)?.querySelector('button')?.click(), text);
  await undoLatest('حذف زواج');
  await wait(1800);
  fams = await families(A);
  const back = fams.find(f => f.spouse.includes(WIFE_OUT));
  ok(back?.line === 'متزوجان منذ 1988' && back.kids.includes('ثامر') && back.kids.includes('ريم'), 'undoing the removal brings the wife back, with her children');
  await undoLatest('إضافة زوجة لـ مازن: هيلة');
  await wait(1800);
  fams = await families(A);
  ok(!fams.some(f => f.spouse.includes(COUSIN[0])), 'undoing the cousin wife\'s addition removes that marriage');

  // ---- clean up for the next run: the remaining marriages, and the children added here
  await removeAllMarriages(A);
  await openProfile(A, ...DAUGHTER);
  await removeAllMarriages(A);
  await closeProfile(A);
  await click(A, 'الطلبات', '.tab', 600);
  for (const kid of ['سعد بن خالد الدوسري', 'ريم', 'ثامر']) {
    await A.evaluate(k => [...document.querySelectorAll('.requests .card.hist')].find(c => c.innerText.includes('إضافة') && c.innerText.includes(': ' + k) && c.querySelector('button'))?.querySelector('button').click(), kid);
    await wait(1500);
  }
  await openProfile(A, ...MAN);
  fams = await families(A);
  ok(!fams.some(f => f.spouse) && !fams.some(f => f.kids.includes('ثامر')), 'clean again for the next run');
  await t.finish();
} catch (e) {
  await t.crash(e);
}
