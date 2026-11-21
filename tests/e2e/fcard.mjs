// The family card in 3D: a person with parents, wives and many children; tap to walk.
//   node fcard.mjs BASE admin-link-file shots-dir
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const store = (p, fn, arg) => p.evaluate((src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts').then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), fn.toString(), arg);
const shots = process.argv[4];
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(A, 'تصفّح أولًا', 'button', 500);
  await store(A, m => m.set({ settings: { ...m.getState().settings, theme: 'dark', view: '3d' } }));
  const many = await store(A, m => [...m.getState().graph.nodes.values()].filter(n => !n.familyRoot).sort((a, b) => b.kids.length - a.kids.length)[0].id);
  await store(A, (m, id) => m.set({ focus: id }), many); await wait(1500);
  const card = await A.evaluate(() => ({ people: document.querySelectorAll('.fcard .fp').length, groups: document.querySelectorAll('.fcard .fgroup').length, self: document.querySelector('.fcard .fp.self b')?.textContent }));
  ok(card.people > 10 && card.groups >= 1, 'the card shows the family · ' + JSON.stringify(card));
  if (shots) await A.screenshot({ path: shots + '/fcard-many.png' });
  // a young person: parents above
  await store(A, m => m.set({ focus: 'p44' })); await wait(1200);
  if (shots) await A.screenshot({ path: shots + '/fcard-young.png' });
  const parent = await A.evaluate(() => document.querySelector('.fcard .frow .fp:not(.self) b')?.textContent);
  await A.evaluate(() => document.querySelector('.fcard .frow .fp:not(.self)')?.click()); await wait(1200);
  const now = await A.evaluate(() => document.querySelector('.fcard .fp.self b')?.textContent);
  ok(!!parent && now === parent, 'tapping the father walks up to him · ' + parent + ' → ' + now);
  await store(A, m => m.set({ settings: { ...m.getState().settings, theme: 'light' } })); await wait(800);
  if (shots) await A.screenshot({ path: shots + '/fcard-light.png' });
  await t.finish();
} catch (e) { await t.crash(e); }
