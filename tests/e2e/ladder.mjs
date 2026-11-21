// The relation ladder: far, near, direct line, and the 3D map toggle. Screenshots for review.
//   node ladder.mjs BASE admin-link-file shots-dir
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
  const set = async (a, b, name) => {
    await store(A, (m, x) => m.set({ tab: 'relation', relA: x[0], relB: x[1] }), [a, b]); await wait(900);
    const r = await A.evaluate(() => ({ rungs: [...document.querySelectorAll('.ladder .rung')].map(x => x.querySelector('b').textContent), legs: document.querySelectorAll('.ladder .legs .leg').length, top: document.querySelector('.ladder .rung.lca')?.getBoundingClientRect().top ?? null, route: document.querySelector('.route')?.getBoundingClientRect().bottom ?? null }));
    if (shots) await A.screenshot({ path: `${shots}/${name}.png` });
    return r;
  };
  let r = await set('p44', 'p127', 'ladder-far');
  ok(r.legs === 2 && r.top > r.route, 'far: two lines under the common ancestor, below the summary · ' + JSON.stringify(r));
  r = await set('p44', 'p43', 'ladder-near');
  ok(r.legs === 2, 'cousins: two short lines · ' + r.rungs.join(' / '));
  const grand = await store(A, m => { const g = m.getState().graph; return g.nodes.get(g.nodes.get(g.nodes.get('p44').parent).parent).parent; });
  r = await set('p1', grand, 'ladder-direct');
  ok(r.legs === 1, 'a forefather: one line · ' + r.rungs.join(' / '));
  await A.evaluate(() => document.querySelector('.page.relation')?.scrollTo(0, 2000)); await wait(300);
  if (shots) await A.screenshot({ path: `${shots}/ladder-direct-end.png` });
  await click(A, 'في الشجرة', '.seg.relview button', 1500);
  ok(await A.evaluate(() => !!document.querySelector('.home canvas') && !!document.querySelector('.result .seg.relview')), 'the 3D map, with the way back');
  if (shots) await A.screenshot({ path: `${shots}/ladder-map.png` });
  await click(A, 'المسار', '.seg.relview button', 800);
  ok(await A.evaluate(() => !!document.querySelector('.ladder')), 'back to the ladder');
  await t.finish();
} catch (e) { await t.crash(e); }
