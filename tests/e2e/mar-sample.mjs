// Marriages in the sample family (opened without a link): it opens without
// errors; a wife is a sensitive request that a gold key of the branch approves,
// then shows in the family; her child is asked for with her as the mother.
//   node mar-sample.mjs BASE admin-link-file [screenshots-dir]   (the link file is not used)
import { setup, click, typeIn, typeYear, openProfile, closeProfile, families, wait } from './mar-lib.mjs';

const t = setup();
const { ok, shot } = t;

try {
  await t.launch();
  const S = await t.phone('S', t.base + '/');
  ok(await click(S, 'جرّب العائلة التجريبية', '.join button', 2500), 'the sample family can be opened');
  ok(await S.evaluate(() => (document.querySelector('.top h1')?.textContent ?? '') === 'آل سالم'), 'the sample family opens');
  const count = await S.evaluate(() => document.querySelector('.top .sub b')?.textContent ?? '');
  ok(+count > 50, 'the tree counts its people: ' + count);
  await shot(S, 's01-sample.png');

  // choose who I am: محمد بن عبدالله (1978)
  await click(S, 'اختر اسمي', 'button', 500);
  await S.type('.sfield input', 'محمد عبدالله', { delay: 8 });
  await wait(600);
  await S.evaluate(() => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes('1978'))?.click());
  await wait(1200);

  ok(await openProfile(S, 'محمد عبدالله', '1978'), 'open my profile');
  ok(await click(S, 'إضافة زوجة', '.page.profile button.addsp'), 'the sample offers «إضافة زوجة»');
  await typeIn(S, '.addsheet input.bigin[dir="rtl"]', 'سارة بنت فهد');
  await typeYear(S, 'سنة الزواج', '2003');
  ok(await click(S, 'إرسال للاعتماد', '.addsheet .foot button', 1500), 'send the wife for approval');
  ok(!(await families(S)).some(f => f.spouse.includes('سارة')), 'not in the family before it is approved');
  await closeProfile(S);

  // approve as a gold key holder of the branch ("view as", sample only)
  await click(S, 'الطلبات', '.tab', 700);
  ok(await S.evaluate(() => [...document.querySelectorAll('.requests .card.req')].some(c => c.innerText.includes('إضافة زوجة لـ محمد') && c.innerText.includes('حساس'))), 'the request is pending, sensitive');
  const viewedAs = await S.evaluate(() => {
    const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.innerText.includes('إضافة زوجة لـ محمد'));
    const chip = [...(c?.querySelectorAll('.eligible .chip') ?? [])].find(b => b.textContent.includes('ذهبي'));
    chip?.click();
    return chip?.textContent ?? '';
  });
  await wait(700);
  ok(viewedAs.includes('ذهبي'), 'a gold key holder of the branch can approve it: ' + viewedAs);
  await S.evaluate(() => [...document.querySelectorAll('.requests .card.req')].find(x => x.innerText.includes('إضافة زوجة لـ محمد'))?.querySelector('.btn.primary')?.click());
  await wait(1500);
  ok(await S.evaluate(() => [...document.querySelectorAll('.requests .card.hist')].some(c => c.innerText.includes('إضافة زوجة لـ محمد') && c.innerText.includes('معتمد من'))), 'approved by one gold key');
  await shot(S, 's02-approved.png');

  // back as myself: she is in the family, and a new child asks for her as mother
  await click(S, 'أنا', '.tab', 600);
  ok(await click(S, 'الرجوع إلى حسابي', '.page button', 500), 'back to my own view');
  ok(await openProfile(S, 'محمد عبدالله', '1978'), 'open my profile again');
  const fams = await families(S);
  ok(fams.some(f => f.spouse.includes('سارة') && f.line === 'متزوجان منذ 2003'), 'the approved wife shows with her marriage');
  await click(S, 'إضافة ابن أو ابنة', '.page.profile button.link');
  const mother = await S.evaluate(() => document.querySelector('.addsheet .card.list .brow.on .pt b')?.textContent ?? '');
  ok(mother.includes('سارة'), 'a new child has his only wife as mother by default');
  await shot(S, 's03-child-mother.png');
  await click(S, 'إلغاء', '.addsheet .ahead button', 400);
  await t.finish();
} catch (e) {
  await t.crash(e);
}
