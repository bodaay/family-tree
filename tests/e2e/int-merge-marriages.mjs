// Integration: merging duplicates when the record merged away has a marriage.
//   node int-merge-marriages.mjs <BASE url> <admin-link file>
// The root admin enters a man a second time under his father (the duplicate
// check asks first), gives that second record a wife from outside and a son by
// her, then merges it into the original: the wife, the marriage and the son move
// to the kept record in one change. Undoing it brings both records back exactly.
import { setup, click, typeIn, openProfile, closeProfile, families, wait } from './mar-lib.mjs';

const t = setup();
const { ok } = t;
const MAN = ['مازن فيصل', '1960'];
const WIFE = 'هيا بنت سعد العتيبي';
const SON = 'ثامر';
const NOW = String(new Date().getFullYear());

/** Results of a search, as row texts. */
async function search(p, q) {
  await closeProfile(p);
  await click(p, 'الشجرة', '.tab', 500);
  await p.evaluate(() => (document.querySelector('.searchbar .search') ?? document.querySelector('.home .search'))?.click());
  await wait(400);
  await p.type('.sfield input', q, { delay: 8 });
  await wait(700);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.results .prow')].map(e => e.innerText.replace(/\s+/g, ' ')));
  await p.evaluate(() => document.querySelector('.searchpage .round')?.click());
  await wait(300);
  return rows;
}

try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  const before = (await search(A, MAN[0])).length;

  // the same man entered again under his father: the duplicate check asks, then carries on
  ok(await openProfile(A, ...MAN), 'open the man\'s profile');
  await A.evaluate(() => [...document.querySelectorAll('.page.profile .chainline button')].pop()?.click());
  await wait(900);
  await click(A, 'إضافة ابن أو ابنة', '.page.profile button.link');
  await click(A, 'ابن', '.addsheet .bigchoice button', 300);
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await A.type('.addsheet input.bigin', MAN[0].split(' ')[0], { delay: 8 });
  await wait(300);
  // the duplicate question is off (CHECK_DUPLICATES, since 1.13); dupcheck-on/ has the version that asks
  ok(await A.evaluate(() => !document.querySelector('.addsheet .warnbox')), 'the name step does not warn (the duplicate check is off)');
  await click(A, 'التالي', '.addsheet .foot button', 600);
  ok(await A.evaluate(() => !document.querySelector('.modal.dups')), 'and asks nothing: straight on');
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await click(A, 'إضافة إلى الشجرة', '.addsheet .foot button', 1800);
  const rows = await search(A, MAN[0]);
  ok(rows.length === before + 1 && rows.some(r => r.includes(NOW)), 'the second record is in the tree', rows.join(' | '));

  // the second record: a wife from outside and a son by her
  ok(await openProfile(A, MAN[0], NOW), 'open the second record');
  ok(await click(A, 'إضافة زوجة', '.page.profile button.addsp'), 'the second record can take a wife');
  await typeIn(A, '.addsheet input.bigin[dir="rtl"]', WIFE);
  await click(A, 'حفظ', '.addsheet .foot button', 1800);
  await click(A, 'إضافة ابن أو ابنة', '.page.profile button.link');
  await click(A, 'التالي', '.addsheet .foot button', 400); // the mother: his only wife
  await click(A, 'ابن', '.addsheet .bigchoice button', 300);
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await A.type('.addsheet input.bigin', SON, { delay: 8 });
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await click(A, 'متابعة', '.modal button', 300);
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await click(A, 'إضافة إلى الشجرة', '.addsheet .foot button', 1800);
  await click(A, 'متابعة', '.modal button', 1500);
  await openProfile(A, MAN[0], NOW);
  let fams = await families(A);
  ok(fams.some(f => f.spouse.includes(WIFE) && f.kids.includes(SON)), 'the second record has the wife and her son', JSON.stringify(fams));

  // merge the second record into the first
  ok(await openProfile(A, ...MAN), 'open the original record');
  ok(await click(A, 'دمج مع', '.page.profile .prow'), 'the profile offers «دمج مع…»');
  const offered = await A.evaluate(n => [...document.querySelectorAll('.results .prow')].map(e => e.innerText).filter(x => x.includes(n)).length, NOW);
  ok(offered === 1, 'the merge picker offers the record with the same name first');
  await A.evaluate(n => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(n))?.click(), NOW);
  await wait(800);
  const sheet = await A.evaluate(() => document.querySelector('.modal.merge')?.innerText.replace(/\s+/g, ' ') ?? '');
  ok(sheet.includes('الزواج') && sheet.includes('واحد، ينتقل'), 'the merge sheet says the marriage and the son move', sheet);
  ok(!sheet.includes('warnbox') && (await A.evaluate(() => !document.querySelector('.modal.merge .btn.primary').disabled)), 'the merge is allowed');
  await click(A, 'دمج', '.modal.merge .btn.primary', 2000);
  const kept = await A.evaluate(() => document.querySelector('.page.profile .pc .tags')?.innerText ?? '');
  void kept;
  fams = await families(A);
  ok(fams.some(f => f.spouse.includes(WIFE) && f.kids.includes(SON)), 'the kept record now has the wife and her son', JSON.stringify(fams));
  ok(fams.some(f => !f.spouse && f.kids.length > 0), 'his own children (mother not recorded) stay with him');
  const afterRows = await search(A, MAN[0]);
  ok(afterRows.length === before && !afterRows.some(r => r.includes(NOW)), 'the second record is gone', afterRows.join(' | '));
  // the wife's profile names the kept husband
  await openProfile(A, ...MAN);
  await A.evaluate(w => [...document.querySelectorAll('.page.profile .card.fam .prow')].find(e => e.innerText.includes(w))?.click(), WIFE);
  await wait(900);
  const wifeLine = await A.evaluate(() => document.querySelector('.page.profile .pc .ns')?.textContent ?? '');
  ok(wifeLine.includes('زوجة مازن'), 'the wife\'s profile names the kept record as her husband', wifeLine);

  // undo the merge from the record
  await closeProfile(A);
  await click(A, 'الطلبات', '.tab', 600);
  const undone = await A.evaluate(() => {
    const c = [...document.querySelectorAll('.card.hist')].find(e => e.innerText.includes('دمج سجلين'));
    const b = c?.querySelector('button');
    b?.click();
    return !!b;
  });
  ok(undone, 'the merge can be undone from the record');
  await wait(2000);
  const back = await search(A, MAN[0]);
  ok(back.length === before + 1 && back.some(r => r.includes(NOW)), 'undo brings the second record back', back.join(' | '));
  await openProfile(A, MAN[0], NOW);
  fams = await families(A);
  ok(fams.some(f => f.spouse.includes(WIFE) && f.kids.includes(SON)), 'the wife and her son are back with the second record', JSON.stringify(fams));
  await openProfile(A, ...MAN);
  fams = await families(A);
  ok(!fams.some(f => f.spouse.includes(WIFE)), 'and no longer with the original');
  await t.finish();
} catch (e) {
  await t.crash(e);
}
