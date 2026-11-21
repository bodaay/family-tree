// The departed at a glance: a black mourning band across the corner of the
// avatar (the profile, lists, family cards), and across the node in the 3D tree
// and the 2D chart once it is big enough (seen in the shots); never on the
// living. «رحمه الله» still says it in words.
//   node mourning.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const shots = process.argv[4];
const shot = async (p, name) => { if (shots) await p.screenshot({ path: shots + '/' + name + '.png' }); };
const theme = (p, th, view) => store(p, (m, a) => m.set({ settings: { ...m.getState().settings, theme: a.th, ...(a.view ? { view: a.view } : {}) } }), { th, view });
// the band: the avatar's ::after, dark, and present only on the departed
const band = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(sel)].map(a => { const st = getComputedStyle(a, '::after'); return { dead: a.classList.contains('dead'), band: st.content !== 'none' && st.content !== '' && st.backgroundColor === 'rgb(21, 22, 27)' }; }), sel);
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(A, 'تصفّح أولًا', 'button', 500);
  // a departed man with children, some living and some departed
  const P = await store(A, m => {
    const g = m.getState().graph;
    const n = [...g.nodes.values()].find(n => n.dead && !n.familyRoot && !n.external && n.sex === 'm' && n.kids.some(k => g.nodes.get(k).dead) && n.kids.some(k => !g.nodes.get(k).dead));
    const living = [...g.nodes.values()].find(x => !x.dead && !x.familyRoot && !x.external && x.sex === 'm' && x.by && x.by > 1970);
    return n ? { id: n.id, name: n.name, living: living?.id } : null;
  });
  ok(!!P, 'a departed man with living and departed children');

  for (const th of ['light', 'dark']) {
    await theme(A, th);
    await store(A, (m, id) => m.set({ profile: id }), P.id); await wait(900);
    const head = await band(A, '.page.profile .pc .av');
    ok(head.length === 1 && head[0].dead && head[0].band, th + ': his profile picture carries the band');
    ok((await A.evaluate(() => document.querySelector('.page.profile .pc')?.textContent ?? '')).includes('رحمه الله'), th + ': and «رحمه الله» in words');
    await shot(A, 'mourning-profile-' + th);
    await A.evaluate(() => document.querySelector('.page.profile .fkids')?.scrollIntoView({ block: 'center' })); await wait(400);
    const kids = await band(A, '.page.profile .fkids .av');
    ok(kids.length > 1 && kids.every(k => k.dead === k.band) && kids.some(k => k.band) && kids.some(k => !k.band), th + ': among his children, only the departed carry it · ' + kids.filter(k => k.band).length + ' of ' + kids.length);
    await shot(A, 'mourning-kids-' + th);
    await store(A, m => m.set({ profile: null })); await wait(300);
  }
  await store(A, (m, id) => m.set({ profile: id }), P.living); await wait(900);
  ok((await band(A, '.page.profile .pc .av')).every(x => !x.band), 'a living man\'s profile picture has none');
  await store(A, m => m.set({ profile: null }));

  // a list: search by his name
  await store(A, m => m.set({ searchOpen: 'focus' })); await wait(500);
  await A.type('.sfield input', P.name, { delay: 8 }); await wait(800);
  const rows = await band(A, '.results .av');
  ok(rows.length > 0 && rows.every(r => r.dead === r.band), 'in search results, the band marks exactly the departed · ' + rows.filter(r => r.band).length + ' of ' + rows.length);
  await shot(A, 'mourning-search');
  await store(A, m => m.set({ searchOpen: false })); await wait(300);

  // the trees: drawn on canvas; seen in the shots
  await theme(A, 'dark', '3d');
  await store(A, (m, id) => m.set({ focus: id }), P.id); await wait(2500);
  await shot(A, 'mourning-3d-dark');
  await store(A, m => m.set({ focus: null }));
  await theme(A, 'light', '2d'); await wait(1500);
  await store(A, (m, id) => m.set({ focus: id }), P.id); await wait(2500);
  await shot(A, 'mourning-2d-light');
  await theme(A, 'dark', '2d'); await wait(1500);
  await shot(A, 'mourning-2d-dark');
  await t.finish();
} catch (e) { await t.crash(e); }
