// In the 3D tree a tap on a drawn name chooses that person (not only a tap on the dot).
// The canvas calls are watched to learn where each name pill was drawn.
//   node tap3d.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const store = (p, fn, arg) => p.evaluate((src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts').then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), fn.toString(), arg);
const shots = process.argv[4];
const WATCH = () => {
  // each frame starts by filling the whole canvas; a name is a rounded pill, then its text
  window.__frame = [];
  const P = CanvasRenderingContext2D.prototype;
  const isTree = c => c.canvas && c.canvas.classList && c.canvas.classList.contains('tree');
  const pt = (c, x, y) => { const m = c.getTransform(); const d = c.canvas.width / c.canvas.clientWidth; const p = m.transformPoint({ x, y }); return [p.x / d, p.y / d]; };
  const fr = P.fillRect, rr = P.roundRect, ft = P.fillText;
  let pill = null;
  P.fillRect = function (x, y, w, h) { if (isTree(this) && x === 0 && y === 0) { window.__last = window.__frame; window.__frame = []; } return fr.apply(this, arguments); };
  P.roundRect = function (x, y, w, h) { if (isTree(this)) { const a = pt(this, x, y), b = pt(this, x + w, y + h); pill = [a[0], a[1], b[0], b[1]]; } return rr.apply(this, arguments); };
  P.fillText = function (text) { if (isTree(this) && pill) { window.__frame.push({ text, r: pill }); pill = null; } return ft.apply(this, arguments); };
};
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await A.evaluate(WATCH);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(A, 'تصفّح أولًا', 'button', 500);
  await store(A, m => m.set({ settings: { ...m.getState().settings, view: '3d', theme: 'dark' }, focus: null })); await wait(1500);
  // a short drag stops the slow turn, so the names stay where they were drawn
  const drag = async () => {
    await A.mouse.move(200, 520); await A.mouse.down(); await A.mouse.move(214, 520, { steps: 4 }); await A.mouse.up();
    await wait(1800);
  };
  const names = () => A.evaluate(() => {
    const L = (window.__frame && window.__frame.length ? window.__frame : window.__last) || [];
    return L.filter(x => x.text !== 'أنت' && !x.text.includes(' · ')).map(x => ({ ...x, cx: (x.r[0] + x.r[2]) / 2, cy: (x.r[1] + x.r[3]) / 2 }))
      .filter(x => { const e = document.elementFromPoint(x.cx, x.cy); return e && e.tagName === 'CANVAS'; });
  });
  let tried = 0, good = 0;
  for (let i = 0; i < 3; i++) {
    await store(A, m => m.set({ focus: null })); await wait(900);
    await drag();
    if (shots && i === 0) await A.screenshot({ path: shots + '/tap3d-before.png' });
    // tap only once the names hold still (the tree may still be easing to a stop)
    let L = await names();
    for (let k = 0; k < 10; k++) {
      await wait(400);
      const L2 = await names();
      const same = L2.length === L.length && L2.every((x, j) => x.text === L[j].text && Math.abs(x.cx - L[j].cx) < 0.5 && Math.abs(x.cy - L[j].cy) < 0.5);
      L = L2;
      if (same) break;
    }
    if (!L.length) { ok(false, 'names are drawn in the 3D tree to tap'); break; }
    const pick = L[Math.min(L.length - 1, i * 3)];
    await A.touchscreen.tap(pick.cx, pick.cy); await wait(1300);
    const got = await A.evaluate(() => document.querySelector('.fcard .fp.self b')?.textContent ?? null);
    tried++;
    if (got === pick.text) good++;
    ok(got === pick.text, `a tap on the name «${pick.text}» chooses that person · ${got}`);
    if (shots && i === 0) await A.screenshot({ path: shots + '/tap3d-after.png' });
  }
  ok(tried === 3 && good === 3, `all three names answered · ${good}/${tried}`);

  // a crowded spot: «من تقصد؟» opens and stays open (the click after the tap used to close it)
  await store(A, m => m.set({ focus: null })); await wait(900);
  let menu = null;
  for (const [x, y] of [[60, 560], [80, 600], [100, 580], [60, 620], [120, 620], [140, 600], [90, 640], [70, 520], [160, 640], [200, 640], [240, 620], [280, 600]]) {
    await A.touchscreen.tap(x, y); await wait(900);
    const st = await A.evaluate(() => ({ menu: document.querySelectorAll('.pickmany .prow').length, card: !!document.querySelector('.fcard') }));
    if (st.menu > 1) { menu = st.menu; break; }
    if (st.card) { await store(A, m => m.set({ focus: null })); await wait(700); }
  }
  ok(menu > 1, 'a tap on a crowded spot opens «من تقصد؟», and it stays open · ' + menu);
  if (menu) {
    if (shots) await A.screenshot({ path: shots + '/tap3d-many.png' });
    const want = await A.evaluate(() => { const b = document.querySelectorAll('.pickmany .prow')[1]; const r = b.getBoundingClientRect(); return { name: b.querySelector('b').textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await A.touchscreen.tap(want.x, want.y); await wait(1200);
    const got = await A.evaluate(() => document.querySelector('.fcard .fp.self b')?.textContent ?? null);
    ok(got === want.name, 'choosing from it opens that person · ' + want.name + ' → ' + got);
  }

  // the 2D chart: a tap on a name chooses that person
  await store(A, m => m.set({ focus: null, settings: { ...m.getState().settings, view: '2d' } })); await wait(1800);
  await A.evaluate(() => {
    // the chart draws a name as plain text under its dot: keep the texts of the last frame
    window.__texts = [];
    const P = CanvasRenderingContext2D.prototype, ft = P.fillText, fr = P.fillRect;
    P.fillText = function (text, x, y) { if (this.canvas.classList.contains('tree')) { const m = this.getTransform(), d = this.canvas.width / this.canvas.clientWidth, p = m.transformPoint({ x, y }); window.__texts.push({ text, x: p.x / d, y: p.y / d, font: this.font }); } return ft.apply(this, arguments); };
    P.fillRect = function (x, y) { if (this.canvas.classList.contains('tree') && x === 0 && y === 0) window.__texts = []; return fr.apply(this, arguments); };
  });
  await A.mouse.move(200, 500); await A.mouse.down(); await A.mouse.move(200, 512, { steps: 3 }); await A.mouse.up(); await wait(1500);
  const names2 = await A.evaluate(() => (window.__texts || []).filter(t => /^(bold|700) 13px/.test(t.font) && t.text.length > 1)
    .filter(t => { const e = document.elementFromPoint(t.x, t.y - 5); return e && e.tagName === 'CANVAS'; }));
  ok(names2.length > 0, 'the chart shows names to tap · ' + names2.length);
  if (names2.length) {
    const pick = names2[Math.floor(names2.length / 2)];
    await A.touchscreen.tap(pick.x, pick.y - 5); await wait(1300);
    // the chart has no family card: the chosen person is the one in the sheet
    const got = await store(A, m => { const s = m.getState(); return s.focus ? m.nameOf(s, s.focus) : null; });
    ok(!!got && got.startsWith(pick.text.replace('…', '').trim().split(' ')[0]), 'in the chart, a tap on «' + pick.text + '» chooses that person · ' + got);
  }
  await t.finish();
} catch (e) { await t.crash(e); }
