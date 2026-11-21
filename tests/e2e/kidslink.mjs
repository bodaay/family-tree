// «ربط أبناء»: a wife added after her children are in the tree; the root admin
// ticks which children are hers, in one change, undone as one. Also a wife from
// the family (her brother becomes the children's «خال»), and a daughter of the
// family with a husband from outside (the father is what gets set).
//   node kidslink.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
// run fn(module, arg) in the page with one of the app's own modules
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const shots = process.argv[4];
const sheetRows = p => p.evaluate(() => [...document.querySelectorAll('.addsheet .parentpick .brow')].map(b => ({ name: b.querySelector('b').textContent, on: b.classList.contains('on'), note: b.querySelector('small').textContent })));
const tickRow = (p, name) => p.evaluate(n => { const b = [...document.querySelectorAll('.addsheet .parentpick .brow')].find(x => x.querySelector('b').textContent === n); b?.click(); return !!b; }, name);
const openSheet = async (p, who, spouseName) => {
  await store(p, (m, id) => m.set({ profile: id }), who); await wait(800);
  const found = await p.evaluate(n => { const c = [...document.querySelectorAll('.page.profile .card.fam')].find(x => x.textContent.includes(n)); const b = c && [...c.querySelectorAll('button.link')].find(x => x.textContent.includes('ربط أبناء')); b?.click(); return !!b; }, spouseName);
  await wait(700);
  return found;
};
const save = async p => { await click(p, 'حفظ', '.addsheet .foot button', 1500); };
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(A, 'تصفّح أولًا', 'button', 500);

  // 1. a man with several children and no wife recorded
  const M = await store(A, m => { const g = m.getState().graph; return [...g.nodes.values()].find(n => !n.familyRoot && !n.external && n.sex === 'm' && n.kids.length >= 4 && !g.marriages.some(x => x.husband === n.id)).id; });
  const kidsM = await store(A, (m, id) => { const s = m.getState(); return s.graph.nodes.get(id).kids.map(k => ({ id: k, name: m.nameOf(s, k), mother: s.graph.nodes.get(k).mother ?? null })).filter(k => s.graph.nodes.get(k.id).parent === id); }, M);
  await mod(A, '/src/data/marriages.ts', (m, id) => m.addSpouse(id, { name: 'جواهر' }, { status: 'married' }), M); await wait(1500);
  const W = await store(A, (m, id) => m.getState().graph.marriages.find(x => x.husband === id)?.wife ?? null, M);
  ok(!!W, 'an outside wife جواهر is added');
  const txs0 = await store(A, m => m.getState().txs.length);

  ok(await openSheet(A, M, 'جواهر'), 'her card on his profile has «ربط أبناء»');
  let rows = await sheetRows(A);
  ok(rows.length === kidsM.length && rows.every(r => !r.on), 'the sheet lists all his children, none ticked · ' + rows.length + '/' + kidsM.length);
  ok(rows.every(r => /الأم/.test(r.note)), 'each says where the child stands now · ' + rows[0]?.note);
  ok(await A.evaluate(() => document.querySelector('.addsheet .foot button').disabled), 'nothing to save before a tick');
  await tickRow(A, rows[0].name); await tickRow(A, rows[1].name); await wait(300);
  if (shots) await A.screenshot({ path: shots + '/kids-sheet.png' });
  await save(A);
  let st = await store(A, (m, a) => { const s = m.getState(); return { mothers: a.kids.map(k => s.graph.nodes.get(k.id).mother ?? null), txs: s.txs.length, last: s.txs.at(-1)?.title, open: s.kidsFor }; }, { kids: kidsM });
  ok(st.mothers[0] === W && st.mothers[1] === W && st.mothers.slice(2).every((x, i) => x === kidsM[i + 2].mother), 'the two ticked now have جواهر as their mother; the rest are as they were');
  ok(st.txs === txs0 + 1 && /^أبناء /.test(st.last), 'one change in the log · ' + st.last);
  ok(!st.open, 'the sheet closes');
  const cardKids = await A.evaluate(() => { const c = [...document.querySelectorAll('.page.profile .card.fam')].find(x => x.textContent.includes('جواهر')); return c ? c.querySelectorAll('.fkids .fp').length : -1; });
  ok(cardKids === 2, 'her card on his profile shows the two · ' + cardKids);
  if (shots) { await A.evaluate(() => [...document.querySelectorAll('.page.profile .card.fam')].find(x => x.textContent.includes('جواهر'))?.scrollIntoView({ block: 'center' })); await wait(3500); await A.screenshot({ path: shots + '/kids-profile.png' }); }

  // her own profile shows him and the two
  await store(A, (m, id) => m.set({ profile: id }), W); await wait(800);
  const hers = await A.evaluate(() => document.querySelectorAll('.page.profile .card.fam .fkids .fp').length);
  ok(hers === 2, 'her own profile shows the two children · ' + hers);

  // 2. again: one moved out, another in
  ok(await openSheet(A, M, 'جواهر'), 'the sheet opens again');
  rows = await sheetRows(A);
  ok(rows.filter(r => r.on).length === 2 && rows[0].on && rows[1].on, 'the two are ticked');
  await tickRow(A, rows[1].name); await tickRow(A, rows[2].name); await wait(200);
  await save(A);
  st = await store(A, (m, a) => { const s = m.getState(); return a.kids.map(k => s.graph.nodes.get(k.id).mother ?? null); }, { kids: kidsM });
  ok(st[0] === W && st[1] === kidsM[1].mother && st[2] === W, 'untick one, tick another: both saved');

  // 3. undone as one
  const lastId = await store(A, m => m.getState().txs.at(-1).id);
  await store(A, (m, id) => m.proposeRevert(id), lastId); await wait(1500);
  st = await store(A, (m, a) => { const s = m.getState(); return a.kids.map(k => s.graph.nodes.get(k.id).mother ?? null); }, { kids: kidsM });
  ok(st[0] === W && st[1] === W && st[2] === kidsM[2].mother, 'one «تراجع» undoes the whole change');

  // 4. it holds after a reload (the log replays it)
  await A.reload({ waitUntil: 'networkidle0' }); await wait(2500);
  st = await store(A, (m, a) => { const s = m.getState(); return a.kids.map(k => s.graph.nodes.get(k.id).mother ?? null); }, { kids: kidsM });
  ok(st[0] === W && st[1] === W && st[2] === kidsM[2].mother, 'after a reload the links are the same');

  // 5. a wife from the family: her brother becomes the children's «خال»
  const pair = await mod(A, '/src/data/marriages.ts', m => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts').then(S => {
    const g = S.getState().graph;
    const men = [...g.nodes.values()].filter(n => !n.familyRoot && !n.external && n.sex === 'm' && n.kids.length >= 2 && n.gen >= 3 && !g.marriages.some(x => x.husband === n.id));
    for (const h of men) for (const w of g.nodes.values()) {
      if (w.sex !== 'f' || w.external || w.familyRoot || !w.father) continue;
      const bro = [...g.nodes.values()].find(b => b.sex === 'm' && b.father === w.father && b.id !== w.id);
      if (!bro || m.spouseProblem(g, h.id, w.id, 'married')) continue;
      return { h: h.id, w: w.id, bro: bro.id, wname: S.nameOf(S.getState(), w.id) };
    }
    return null;
  }));
  ok(!!pair, 'a man and a woman of the family who may marry, she with a brother');
  if (pair) {
    await mod(A, '/src/data/marriages.ts', (m, a) => m.addSpouse(a.h, a.w, { status: 'married' }), pair); await wait(1500);
    ok(await openSheet(A, pair.h, pair.wname), 'her card on his profile has «ربط أبناء»');
    rows = await sheetRows(A);
    await tickRow(A, rows[0].name); await wait(200);
    await save(A);
    const r = await store(A, (m, a) => { const s = m.getState(); const k = s.graph.nodes.get(a.h).kids.find(x => s.graph.nodes.get(x).mother === a.w); return k ? import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/kinship.ts') ?? '/src/data/kinship.ts').then(K => { const kk = K.kin(s.graph, k, a.bro); return kk ? K.termFor(s.graph, k, a.bro, kk) : null; }) : null; }, pair);
    ok(r === 'خال', 'her brother is the child\'s «خال» · ' + r);
  }

  // 6. a daughter of the family with a husband from outside: the father gets set
  const D = await store(A, m => { const g = m.getState().graph; return [...g.nodes.values()].find(n => n.sex === 'f' && !n.external && !n.familyRoot && n.by && n.by < 1990 && !g.marriages.some(x => x.wife === n.id))?.id; });
  await mod(A, '/src/data/marriages.ts', (m, id) => m.addSpouse(id, { name: 'سالم' }, { status: 'married' }), D); await wait(1200);
  await store(A, (m, id) => m.addChildTx(id, { name: 'ريم', sex: 'f' }, true, null), D); await wait(1200);
  ok(await openSheet(A, D, 'سالم'), 'her card for سالم has «ربط أبناء»');
  rows = await sheetRows(A);
  ok(rows.length === 1 && rows[0].name === 'ريم' && /الأب غير مسجل/.test(rows[0].note), 'her child is listed, father not recorded · ' + JSON.stringify(rows));
  await tickRow(A, 'ريم'); await save(A);
  const f = await store(A, (m, id) => { const s = m.getState(); const k = [...s.graph.nodes.values()].find(n => n.name === 'ريم' && n.mother === id); return k ? { father: k.father ? s.graph.nodes.get(k.father).name : null, parent: k.parent === id } : null; }, D);
  ok(f && f.father === 'سالم' && f.parent, 'ريم\'s father is now سالم, and she stays under her mother in the tree · ' + JSON.stringify(f));

  // 7. only the root admin sees it
  await store(A, (m, id) => m.set({ profile: id, rootAdmin: false }), M); await wait(700);
  ok(!(await A.evaluate(() => [...document.querySelectorAll('.page.profile button.link')].some(b => b.textContent.includes('ربط أبناء')))), 'not shown to anyone but the root admin');
  await store(A, m => m.set({ rootAdmin: true, profile: null }));
  await t.finish();
} catch (e) { await t.crash(e); }
