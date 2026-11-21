// Review: what a distant member sees of a daughter's marriage. The root admin
// gives a daughter (9th degree from the member) an outside husband and a son,
// and moves a test child under her. The member's change history and her
// profile must never show her name, and he is not offered to add a husband
// to a woman whose details he may not see.
//   node mar-review-privacy.mjs BASE admin-link-file
import { setup, click, typeIn, typeYear, openProfile, closeProfile, families, removeAllMarriages, addChild, wait } from './mar-lib.mjs';

const t = setup();
const { ok } = t;
const DAUGHTER = ['نوف عبدالمحسن', '1973'];
const MAN = ['مازن فيصل', '1960'];
const MEMBER = ['مشاري', '1985'];
const HUSBAND_OUT = 'منصور بن علي الهاجري';
const SON = 'فيصل بن منصور الهاجري';
const HIDDEN = 'نوف';

/** Leaf texts on the page that include `w`. */
const leaks = (p, w, sel = 'body') => p.evaluate((x, s) => [...document.querySelectorAll(s + ' *')].filter(e => !e.children.length && e.textContent.includes(x)).map(e => e.textContent.trim()), w, sel);

try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);

  // the root admin: an outside husband and a son for the daughter
  ok(await openProfile(A, ...DAUGHTER), 'root admin opens the daughter');
  await removeAllMarriages(A);
  await click(A, 'إضافة زوج', '.page.profile button.addsp');
  await typeIn(A, '.addsheet input.bigin[dir="rtl"]', HUSBAND_OUT);
  await typeYear(A, 'سنة الزواج', '1998');
  await click(A, 'حفظ', '.addsheet .foot button', 1800);
  ok((await families(A)).some(f => f.spouse.includes(HUSBAND_OUT)), 'the outside husband is recorded');
  await addChild(A, { sex: 'm', name: SON });
  ok((await families(A)).some(f => f.kids.includes(SON)), 'their son is added under her');
  // a test child of مازن, moved under her (a "move" title names her)
  ok(await openProfile(A, ...MAN), 'root admin opens مازن');
  await addChild(A, { sex: 'm', name: 'نبيل' });
  await A.evaluate(() => [...document.querySelectorAll('.page.profile .fp')].find(e => e.innerText.includes('نبيل'))?.click());
  await wait(900);
  await click(A, 'نقل إلى أب آخر', '.page.profile button', 600);
  await A.type('.sfield input', DAUGHTER[0], { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), DAUGHTER[1]);
  await wait(1800);
  await closeProfile(A);
  ok(await openProfile(A, ...DAUGHTER), 'root admin reopens the daughter');
  ok((await families(A)).some(f => f.kids.includes('نبيل')), 'the test child is now under her');
  await closeProfile(A);

  // a personal invite for the member
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد', '.page button', 600);
  await A.type('.sfield input', MEMBER[0], { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), MEMBER[1]);
  await wait(1500);
  const link = await A.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('ft-family'));
    const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}');
    const sk = Object.values(inv).pop();
    return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null;
  });
  ok(!!link, 'the invite link is ready');
  await click(A, 'إغلاق', '.mhead button', 400);
  const B = await t.phone('B', link);
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'the member joins');

  // the member's change history never names her
  await click(B, 'الطلبات', '.tab', 900);
  const hist = await B.evaluate(() => [...document.querySelectorAll('.requests .card.hist b')].map(b => b.textContent));
  ok(hist.some(h => h.includes(SON)), 'the member sees the son\'s addition in the history');
  const named = hist.filter(h => h.includes(HIDDEN));
  ok(!named.length, 'no history title names the hidden daughter' + (named.length ? ': ' + named.slice(0, 4).join(' | ') : ''));

  // her son's profile, then hers through his nasab chain
  ok(await openProfile(B, 'فيصل منصور', 'الهاجري'), 'the member opens the son\'s profile');
  const sonLine = await B.evaluate(() => document.querySelector('.page.profile .pc .ns')?.textContent ?? '');
  ok(!sonLine.includes(HIDDEN) && sonLine.startsWith('أمه'), 'the son\'s line does not name his mother: ' + sonLine);
  ok(!(await leaks(B, HIDDEN, '.page.profile')).length, 'her name is nowhere on her son\'s profile');
  await B.evaluate(() => [...document.querySelectorAll('.page.profile .chainline button')].at(-1)?.click());
  await wait(900);
  const her = await B.evaluate(() => document.querySelector('.page.profile h1')?.textContent ?? '');
  ok(her === 'ابنة', 'her profile shows her only as «ابنة»: ' + her);
  ok(!(await leaks(B, HIDDEN, '.page.profile')).length, 'her name is nowhere on her profile');
  const offered = await B.evaluate(() => !!document.querySelector('.page.profile button.addsp'));
  ok(!offered, 'the member is not offered to add a husband to a woman he may not see');
  if (offered) {
    await click(B, 'إضافة زوج', '.page.profile button.addsp');
    const l = await leaks(B, HIDDEN, '.addsheet');
    ok(!l.length, 'the add-husband sheet does not name her' + (l.length ? ': ' + l.join(' | ') : ''));
    await click(B, 'إلغاء', '.addsheet .ahead button', 400);
  }
  // adding a child to her (a member's request) does not name her either
  await click(B, 'إضافة ابن أو ابنة', '.page.profile button.link', 700);
  const add = await leaks(B, HIDDEN, '.addsheet');
  ok(!add.length, 'the add-child sheet does not name her' + (add.length ? ': ' + add.join(' | ') : ''));
  await click(B, 'إلغاء', '.addsheet .ahead button', 400);
  await closeProfile(B);

  // clean up: the test child, the son, the marriage (and the outside husband)
  await click(A, 'الطلبات', '.tab', 600);
  for (const k of ['نقل: نبيل', 'إضافة ابن: نبيل', 'إضافة ابن: ' + SON]) {
    await A.evaluate(x => [...document.querySelectorAll('.requests .card.hist')].find(c => c.innerText.includes(x) && !c.innerText.includes('تراجع:') && c.querySelector('button'))?.querySelector('button').click(), k);
    await wait(1500);
  }
  ok(await openProfile(A, ...DAUGHTER), 'root admin opens the daughter to clean up');
  await removeAllMarriages(A);
  const fams = await families(A);
  ok(!fams.some(f => f.spouse) && !fams.some(f => f.kids.includes(SON) || f.kids.includes('نبيل')), 'clean again for the next run');
  await t.finish();
} catch (e) {
  await t.crash(e);
}
