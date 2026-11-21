// The profile's totals (children; brothers and sisters, each with its male and
// female count) and adding a child whose birth year is not known.
// Uses سلطان's twelve sons in the test family (tests/e2e/fixture).
//   node counts.mjs BASE admin-link-file [screenshots-dir]
import { setup, click, wait } from './mar-lib.mjs';

const t = setup();
const { ok, shot } = t;
// the store module the app loaded (its URL may carry a version after a hot update)
const store = (p, fn, arg) => p.evaluate((src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts').then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), fn.toString(), arg);
const stats = p => p.evaluate(() => [...document.querySelectorAll('.page.profile .stats.two .stat')].map(s => s.innerText.replace(/\s+/g, ' ').trim()));
const open = async (p, id) => { await store(p, (m, id) => m.set({ profile: id }), id); await wait(900); };
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  await open(A, 'b_sultan');
  let st = await stats(A);
  ok(st[0] === 'الأبناء 12 ذكور 12 · إناث 0', 'سلطان: 12 children, all sons · ' + st[0]);
  ok(st[1] === 'الإخوة والأخوات 3 ذكور 3 · إناث 0', 'سلطان: 3 brothers · ' + st[1]);
  await shot(A, 'branch-stats.png', 'نبذة');

  // a daughter whose birth year is not known
  await click(A, 'إضافة ابن أو ابنة', '.page.profile button.link');
  await click(A, 'ابنة', '.addsheet .bigchoice button', 300);
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await A.type('.addsheet input.bigin', 'نورة', { delay: 8 });
  await click(A, 'التالي', '.addsheet .foot button', 400);
  const yearStep = await A.evaluate(() => ({ wheel: !!document.querySelector('.addsheet .wheel'), min: document.querySelector('.addsheet input.range')?.min }));
  ok(yearStep.wheel && yearStep.min === '1700', 'the year step goes back to 1700 · ' + JSON.stringify(yearStep));
  await A.evaluate(() => [...document.querySelectorAll('.addsheet label.opt')].find(l => l.innerText.includes('غير معروفة'))?.querySelector('input').click());
  await wait(300);
  const hidden = await A.evaluate(() => ({ wheel: !!document.querySelector('.addsheet .wheel'), approx: [...document.querySelectorAll('.addsheet label.opt')].some(l => l.innerText.includes('تقريبية')) }));
  ok(!hidden.wheel && !hidden.approx, '«غير معروفة» hides the year controls');
  await shot(A, 'birth-unknown.png');
  await click(A, 'التالي', '.addsheet .foot button', 400);
  const review = await A.evaluate(() => document.querySelector('.addsheet .card.review')?.innerText.replace(/\s+/g, ' ') ?? '');
  ok(review.includes('الميلاد غير معروفة'), 'review: birth unknown · ' + review.slice(0, 120));
  await click(A, 'إضافة إلى الشجرة', '.addsheet .foot button', 1800);
  const rec = await store(A, m => {
    const s = m.getState();
    const id = s.graph.nodes.get('b_sultan').kids.find(k => s.graph.nodes.get(k).name === 'نورة');
    const p = s.txs.flatMap(t => t.ops).find(o => o.op === 'addPerson' && o.person.id === id)?.person;
    return p ? { id, birth: p.birth ?? null } : null;
  });
  ok(rec && rec.birth === null, 'نورة is recorded with no birth year · ' + JSON.stringify(rec));

  await open(A, 'b_sultan');
  st = await stats(A);
  ok(st[0] === 'الأبناء 13 ذكور 12 · إناث 1', 'سلطان now: 13 children · ' + st[0]);
  await open(A, rec.id);
  st = await stats(A);
  const born = await A.evaluate(() => document.querySelector('.page.profile .stats .stat')?.innerText.replace(/\s+/g, ' '));
  ok(born === 'الميلاد —', 'her birth shows as — · ' + born);
  ok(st[0] === 'الأبناء 0' && st[1] === 'الإخوة والأخوات 12 ذكور 12 · إناث 0', 'نورة: no children, 12 brothers · ' + st.join(' | '));
  await shot(A, 'noura-stats.png', 'نبذة');
  // the family's anchor has no parent in the tree: siblings are not known
  await open(A, 'root');
  st = await stats(A);
  ok(st[1] === 'الإخوة والأخوات —', 'the anchor: siblings unknown · ' + st[1]);
  // editing: the year may be left empty
  await open(A, rec.id);
  await click(A, 'تعديل البيانات', '.page.profile button', 600);
  const hint = await A.evaluate(() => [...document.querySelectorAll('.qh')].some(q => q.textContent.includes('فارغة إن لم تكن معروفة')));
  ok(hint, 'the editor says the year may be left empty');
  await t.finish();
} catch (e) {
  await t.crash(e);
}
