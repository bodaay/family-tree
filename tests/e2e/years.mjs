// A marriage's years under the wife's key (design document 1.29). Run on a family
// after the move (MOVE=1). The root admin's phone seals the years recorded before
// (one change); a member reads the years of marriages of women within his reach,
// and not of the others; a marriage he adds goes in with its years sealed; a
// death recorded by someone without the widow's key leaves her end year out.
//   FT_REPO=<worktree> node years.mjs BASE admin-link-file
import { setup, click, wait } from './mar-lib.mjs';
import fs from 'node:fs';
const { readWith } = await import('./pkeys-read.mts');
const t = setup();
const { ok } = t;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const until = async (fn, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(500)) if (await fn().catch(() => false)) return true;
  return false;
};
const tab = async (p, name) => { await p.evaluate(n => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes(n))?.click(), name); await wait(600); };
const lastLink = p => p.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}'); const sk = Object.values(inv).pop(); return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null; });
const keysOf = p => p.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); return [m.key, ...Object.values(m.keys ?? {})]; });
const invite = async (A, name, year) => {
  await tab(A, 'الإدارة');
  await click(A, 'دعوة فرد', '.page button', 600);
  await A.type('.sfield input', name, { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), String(year));
  await wait(1500);
  const link = await lastLink(A);
  await click(A, 'إغلاق', '.mhead button', 400);
  return link;
};
const Y = x => JSON.stringify(x ?? null);
// the years recorded in the file the test family started from
const file = JSON.parse(fs.readFileSync(process.env.FT_REPO + '/tests/e2e/fixture/family.json', 'utf8'));
const dated = file.marriages.filter(m => m.year || m.end);
// what a phone shows of these marriages
const shows = (p, ids) => store(p, (m, ids) => { const s = m.getState(); return ids.map(id => { const x = s.graph.marriages.find(y => y.id === id); return x ? { year: x.year ?? null, end: x.end ?? null, sealed: !!x.sealed, wifeOpen: s.opened.has(x.wife) } : null; }); }, ids);
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  const fid = await A.evaluate(() => JSON.parse(localStorage.getItem('ft-family')).fid);
  ok(await store(A, m => m.getState().sealedEra), 'the family has moved to per-person keys');
  ok(dated.length > 0, `marriages with years in the family file · ${dated.length}`);

  // the root admin's phone seals the years recorded before, in one change
  ok(await until(() => store(A, m => m.getState().txs.some(t => t.title === 'ختم سنوات الزواج بمفاتيح الزوجات' && t.status === 'approved'))), "the root admin's phone seals the years recorded before");
  const seal = await store(A, m => { const t = m.getState().txs.find(t => t.title === 'ختم سنوات الزواج بمفاتيح الزوجات'); return t.ops.map(o => ({ id: o.id, after: Object.keys(o.after).filter(k => o.after[k] != null), clearAfter: o.after.year != null || o.after.end != null })); });
  ok(seal.length === dated.length && seal.every(o => !o.clearAfter && o.after.includes('sealed')), `one change, every marriage's years into its seal · ${seal.length}`);
  const a1 = await shows(A, dated.map(m => m.id));
  ok(a1.every((x, i) => x && x.sealed && Y(x.year) === Y(dated[i].year) && Y(x.end) === Y(dated[i].end)), 'the root admin reads them, as they were');
  await wait(2000);
  ok(await store(A, m => m.getState().txs.filter(t => t.title === 'ختم سنوات الزواج بمفاتيح الزوجات').length === 1), 'and does it once');

  // B: the years of marriages of women within his reach, not of the others
  const B = await t.phone('B', await invite(A, 'مشاري', 1985));
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'B joins');
  const bMe = await store(B, m => m.getState().me);
  await until(() => store(B, m => m.getState().opened.size > 0), 30000);
  await wait(2000);
  const b1 = await shows(B, dated.map(m => m.id));
  const near = b1.filter(x => x?.wifeOpen), far = b1.filter(x => x && !x.wifeOpen);
  ok(near.every(x => x.year || x.end) && far.every(x => !x.year && !x.end), `B reads the years where he holds the wife's key (${near.length}), and not elsewhere (${far.length})`);

  // a husband of one of those marriages reads its years (he holds his wife's key)
  const H = await store(A, (m, ids) => { const g = m.getState().graph; const x = ids.map(id => g.marriages.find(y => y.id === id)).find(y => y && g.nodes.get(y.husband) && !g.nodes.get(y.husband).external && !g.nodes.get(y.husband).dead && g.nodes.get(y.husband).birth); return x ? { mid: x.id, name: g.nodes.get(x.husband).name, year: g.nodes.get(x.husband).birth.v } : null; }, dated.map(m => m.id));
  ok(!!H, 'a husband in one of them, to invite');
  if (H) {
    const D = await t.phone('D', await invite(A, H.name, H.year));
    ok(await click(D, 'نعم، أنا', '.join button', 2000), 'he joins');
    const want = dated.find(m => m.id === H.mid);
    ok(await until(async () => { const x = (await shows(D, [H.mid]))[0]; return !!x && x.wifeOpen && Y(x.year) === Y(want.year) && Y(x.end) === Y(want.end); }, 30000), 'he reads the years of his marriage');
  }

  // a marriage B adds: its years go in sealed
  const MARK = '"v":1404,"cal":"h","approx":true';
  const before = await readWith(t.base, fid, await keysOf(A), [MARK]);
  ok(before.leaks === 0, 'that year is nowhere in the log yet');
  ok(await mod(B, '/src/data/marriages.ts', (M, me) => !!M.addSpouse(me, { name: 'هيا_زوجة_جديدة' }, { status: 'married', year: { v: 1404, cal: 'h', approx: true } }), bMe), 'B asks to record a wife from outside, with the year of the marriage');
  ok(await until(() => store(A, m => m.getState().txs.some(t => t.status === 'pending' && t.ops.some(o => o.op === 'addMarriage')))), 'it reaches the root admin');
  const addOp = await store(A, m => { const t = m.getState().txs.find(t => t.status === 'pending' && t.ops.some(o => o.op === 'addMarriage')); const o = t.ops.find(o => o.op === 'addMarriage'); return { id: t.id, mid: o.marriage.id, year: o.marriage.year ?? null, sealed: !!o.marriage.sealed }; });
  ok(!addOp.year && addOp.sealed, 'the marriage goes in with no year in the clear, and its seal');
  await store(A, (m, id) => m.approve(id), addOp.id);
  ok(await until(async () => (await shows(A, [addOp.mid]))[0]?.year?.v === 1404), 'approved: the root admin reads its year');
  ok(await until(async () => (await shows(B, [addOp.mid]))[0]?.year?.v === 1404), 'and so does B (she is his wife: he holds her key)');
  const after = await readWith(t.base, fid, await keysOf(A), [MARK]);
  ok(after.leaks === 0, 'the year is nowhere in the log in the clear');

  // a death recorded by someone without the widow's key: her end year is left out, the status says it
  const M = await store(B, (m, me) => {
    const s = m.getState();
    const g = s.graph;
    const x = g.marriages.find(y => y.status === 'married' && !s.opened.has(y.wife) && g.nodes.get(y.husband) && !g.nodes.get(y.husband).dead && !g.nodes.get(y.husband).external && y.husband !== me && m.canAsk(s, y.husband));
    return x ? { id: x.id, husband: x.husband } : null;
  }, bMe);
  ok(!!M, 'a married man whose wife B may not see');
  if (M) {
    await store(B, (m, h) => m.recordDeath(h, { v: 2025, cal: 'g' }), M.husband);
    ok(await until(() => store(A, (m, mid) => m.getState().txs.some(t => t.status === 'pending' && t.ops.some(o => o.op === 'updateMarriage' && o.id === mid)), M.id)), 'B asks to record his death, with the widowhood');
    const w = await store(A, (m, mid) => { const t = m.getState().txs.find(t => t.status === 'pending' && t.ops.some(o => o.op === 'updateMarriage' && o.id === mid)); const o = t.ops.find(o => o.op === 'updateMarriage' && o.id === mid); return { id: t.id, after: o.after }; }, M.id);
    ok(w.after.status === 'widowed' && w.after.end == null && w.after.sealed === undefined, 'the widowhood goes without her end year (B does not hold her key)');
    await store(A, (m, id) => m.approve(id), w.id);
    ok(await until(async () => (await store(A, (m, mid) => m.getState().graph.marriages.find(x => x.id === mid)?.status, M.id)) === 'widowed'), 'approved: widowed');
    // the root admin, who holds her key, adds the year: sealed
    await mod(A, '/src/data/marriages.ts', (Mm, mid) => Mm.editMarriage(mid, { end: { v: 2025, cal: 'g' } }), M.id);
    ok(await until(async () => (await shows(A, [M.id]))[0]?.end?.v === 2025), 'the root admin records the end year');
    const e = await store(A, mid => null, M.id);
    void e;
    ok(await store(A, (m, mid) => { const t = [...m.getState().txs].reverse().find(t => t.ops.some(o => o.op === 'updateMarriage' && o.id === mid && 'sealed' in o.after)); const o = t?.ops.find(o => o.id === mid); return !!o && o.after.end == null && !!o.after.sealed; }, M.id), 'sealed with her key, never in the clear');
    ok((await shows(B, [M.id]))[0]?.end == null, 'B still does not read it');
  }
  await t.finish();
} catch (e) { await t.crash(e); }
