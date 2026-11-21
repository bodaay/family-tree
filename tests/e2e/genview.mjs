// A generation chosen on the 3D rail («وحده», «وما بعده», «وما قبله») shows only
// those generations: the others' people and names are not drawn (the family's
// anchor, branch founders and «أنت» too), cannot be tapped, and only a faint trace
// of their lines keeps the tree's shape. With no generation chosen, everyone shows.
//   node genview.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const shots = process.argv[4];
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(A, 'تصفّح أولًا', 'button', 500);

  // the renderer itself, with the labels «الشجرة» gives it
  const R = await A.evaluate(async () => {
    const url = p => performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === p) ?? p;
    const S = await import(url('/src/data/store.ts'));
    const Rn = await import(url('/src/tree/render.ts'));
    const Ly = await import(url('/src/tree/layout.ts'));
    const g = S.getState().graph;
    const pos = Ly.layout(g);
    const W = 390, H = 844;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const cam = { yaw: 0.6, pitch: 0.2, dist: 300, f: 700, tx: 0, ty: Ly.levelY(g.maxGen / 2), tz: 0, cx: 0.5, cy: 0.53 };
    const me = [...g.nodes.values()].find(n => n.gen === 7 && !n.external)?.id;
    const labels = [{ id: g.root, text: 'الجد الجامع', big: true, force: true }, ...g.branches.map(b => ({ id: b, dot: true, force: true })), { id: me, text: 'أنت', accent: true, force: true }];
    const sel = 4;
    const out = {};
    for (const span of ['none', 'only', 'down', 'up']) {
      const gens = span === 'none' ? null : [...Array(g.maxGen + 1).keys()].filter(i => (span === 'down' ? i >= sel : span === 'up' ? i <= sel : i === sel));
      const r = Rn.render(ctx, W, H, g, pos, { theme: 'dark', cam, me, gens, genSel: gens ? sel : null, labels, autoLabel: gens ? { g: sel, max: 14 } : undefined, levels: true, visible: () => true, nameOf: id => g.nodes.get(id).name });
      const inG = id => !gens || gens.includes(g.nodes.get(id).gen);
      const hidden = [...g.nodes.keys()].filter(id => !inG(id));
      const onScreen = id => { const q = r.pr.get(id); return q && q[2] > 1 && q[0] > 10 && q[0] < W - 10 && q[1] > 10 && q[1] < H - 10; };
      const taps = hidden.filter(onScreen).slice(0, 80);
      const tapped = taps.filter(id => { const q = r.pr.get(id); return Rn.hitTestAll(r, q[0], q[1]).some(h => h.id === id); });
      const seen = [...g.nodes.keys()].filter(id => inG(id) && onScreen(id)).slice(0, 20);
      const reach = seen.filter(id => { const q = r.pr.get(id); return Rn.hitTestAll(r, q[0], q[1]).length > 0; });
      out[span] = {
        hiddenOk: hidden.length === r.hidden.size && hidden.every(id => r.hidden.has(id)),
        hidden: r.hidden.size,
        tagsOut: r.tags.filter(x => !inG(x.id)).map(x => g.nodes.get(x.id).name),
        tags: r.tags.length,
        taps: taps.length, tapped: tapped.length,
        seen: seen.length, reach: reach.length,
        rootTag: r.tags.some(x => x.id === g.root), meTag: r.tags.some(x => x.id === me),
      };
    }
    return out;
  });
  ok(R.none.hidden === 0 && R.none.rootTag && R.none.meTag, 'no generation chosen: everyone drawn, the anchor and «أنت» named · ' + JSON.stringify(R.none));
  for (const [span, word] of [['only', 'وحده'], ['down', 'وما بعده'], ['up', 'وما قبله']]) {
    const x = R[span];
    ok(x.hiddenOk && x.hidden > 0, `«${word}»: every person of another generation is left out · ${x.hidden}`);
    ok(x.tagsOut.length === 0 && x.tags > 0, `«${word}»: no name from another generation · ${x.tags} names, outside: ${x.tagsOut.join('، ')}`);
    ok(x.taps > 0 && x.tapped === 0, `«${word}»: a tap where a hidden person stands finds no one · ${x.taps} tried`);
    ok(x.seen > 0 && x.reach === x.seen, `«${word}»: the chosen generations can still be tapped · ${x.reach}/${x.seen}`);
  }
  ok(!R.only.rootTag && !R.only.meTag && R.up.rootTag, 'the anchor and «أنت» only when their generation is shown');

  // on the phone: the rail
  const tap = n => A.evaluate(n => [...document.querySelectorAll('.gstop')].find(b => b.textContent.trim() === n)?.click(), n);
  const pick = label => A.evaluate(l => [...document.querySelectorAll('.gflag .seg button')].find(b => b.textContent === l)?.click(), label);
  for (const th of ['dark', 'light']) {
    await A.evaluate(th => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(m => m.set({ settings: { ...m.getState().settings, theme: th, view: '3d' } })), th);
    await wait(800);
    await tap('5'); await wait(900);
    for (const [label, name] of [['وحده', 'only'], ['وما بعده', 'down'], ['وما قبله', 'up']]) {
      await pick(label); await wait(1200);
      if (shots) await A.screenshot({ path: `${shots}/gen5-${name}-${th}.png` });
    }
    await A.evaluate(() => [...document.querySelectorAll('.gflag .x')][0]?.click()); await wait(800);
  }
  ok(await A.evaluate(() => !document.querySelector('.gflag')), 'closing the generation brings everyone back');
  await t.finish();
} catch (e) { await t.crash(e); }
