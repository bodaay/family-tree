// Relations by marriage no one marries, checked when a marriage is recorded
// within the tree: a father's or grandfather's wife and a son's wife (even after
// a divorce), a wife's mother, a wife's daughter once that marriage is current or
// has children; and never two at once: two sisters, or a woman and her aunt.
// The spouse sheet says why and does not save; the spouse search leaves out
// those no one ever marries. Cousins and the unrelated stay allowed.
//   node inlaws.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const shots = process.argv[4];
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const mar = (p, fn, arg) => mod(p, '/src/data/marriages.ts', fn, arg);
const until = async (fn, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(400)) if (await fn()) return true;
  return false;
};
// the root admin records directly
const wed = async (A, h, w, status = 'married') => { await mar(A, (m, a) => m.addSpouse(a.h, a.w, { status: a.status }), { h, w, status }); await wait(1200); };
const problem = (A, of, spouse, status = 'married') => A.evaluate(async (of, spouse, status) => {
  const url = p => performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === p) ?? p;
  const S = await import(url('/src/data/store.ts'));
  const M = await import(url('/src/data/marriages.ts'));
  return M.spouseProblem(S.getState().graph, of, spouse, status);
}, of, spouse, status);
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(A, 'تصفّح أولًا', 'button', 500);

  // people with no marriages recorded: a father and his son, unrelated women,
  // two sisters and their brother's daughter, a woman to have a daughter
  const P = await store(A, m => {
    const g = m.getState().graph;
    const free = id => !g.marriages.some(x => x.husband === id || x.wife === id);
    const all = [...g.nodes.values()].filter(n => !n.external && !n.familyRoot && free(n.id));
    // deep enough in the tree that women of other lines are not his close blood
    const sonOf = all.find(f => f.sex === 'm' && f.gen >= 5 && g.nodes.get(f.id).kids.some(k => g.nodes.get(k).sex === 'm' && free(k)));
    const son = sonOf && sonOf.kids.find(k => g.nodes.get(k).sex === 'm' && free(k));
    const fam = all.filter(n => n.sex === 'f' && n.father);
    // two sisters (same father) and a brother of theirs with a daughter
    let sisters = null, niece = null;
    for (const f of [...g.nodes.values()]) {
      const girls = f.kids.filter(k => g.nodes.get(k).sex === 'f' && free(k));
      const boyWithGirl = f.kids.map(k => g.nodes.get(k)).find(b => b.sex === 'm' && b.kids.some(k => g.nodes.get(k).sex === 'f' && free(k)));
      if (girls.length >= 2 && boyWithGirl) { sisters = girls.slice(0, 2); niece = boyWithGirl.kids.find(k => g.nodes.get(k).sex === 'f' && free(k)); break; }
    }
    return { father: sonOf?.id, son, fam: fam.map(n => n.id), sisters, niece, branches: g.branches };
  });
  ok(P.father && P.son && P.sisters && P.niece, 'a father and son, two sisters and their niece · ' + JSON.stringify({ ...P, fam: P.fam.length }));
  // women who are not close blood to anyone here, from the list, picked by the check itself
  const pick = (n, skip) => A.evaluate(async (P, n, skip) => {
    const url = p => performance.getEntriesByType('resource').map(e => e.name).find(x => new URL(x).pathname === p) ?? p;
    const S = await import(url('/src/data/store.ts'));
    const M = await import(url('/src/data/marriages.ts'));
    const g = S.getState().graph;
    const men = [P.father, P.son];
    return P.fam.filter(w => !skip.includes(w) && !P.sisters.includes(w) && w !== P.niece && men.every(h => !M.closeBlood(g, h, w)) && !g.marriages.some(x => x.wife === w)).slice(0, n);
  }, P, n, skip);
  const [D1, D2, X] = await pick(3, []);
  ok(D1 && D2 && X, 'three unrelated women');

  // a father's wife: even divorced, never his son's
  await wed(A, P.father, D1, 'divorced');
  ok((await problem(A, P.son, D1)) === 'كانت زوجة لأبيه أو أحد أجداده', 'his father\'s former wife: refused · ' + (await problem(A, P.son, D1)));
  // a son's wife: never his father's
  await wed(A, P.son, D2);
  ok((await problem(A, P.father, D2)) === 'كانت زوجة لابنه أو أحد أحفاده', 'his son\'s wife: refused');
  ok((await problem(A, D2, P.father)) === 'كانت زوجة لابنه أو أحد أحفاده', 'the same, recorded from her side');

  // a woman and her daughter: X marries someone from outside and has a girl
  await mar(A, (m, x) => m.addSpouse(x, { name: 'زوج من الخارج' }, { status: 'married' }), X); await wait(1200);
  const outside = await store(A, (m, x) => m.getState().graph.marriages.find(y => y.wife === x)?.husband, X);
  await store(A, (m, a) => m.addChildTx(a.x, { name: 'بنتها', sex: 'f' }, true, a.h), { x: X, h: outside }); await wait(1500);
  const Y = await store(A, (m, x) => [...m.getState().graph.nodes.values()].find(n => n.name === 'بنتها' && n.mother === x)?.id, X);
  ok(!!Y, 'her daughter is in the tree');
  const man = await A.evaluate(async (P, X, Y) => {
    const url = p => performance.getEntriesByType('resource').map(e => e.name).find(x => new URL(x).pathname === p) ?? p;
    const S = await import(url('/src/data/store.ts'));
    const M = await import(url('/src/data/marriages.ts'));
    const g = S.getState().graph;
    return [...g.nodes.values()].find(n => n.sex === 'm' && !n.external && !n.familyRoot && n.id !== P.father && n.id !== P.son && !g.marriages.some(x => x.husband === n.id) && !M.closeBlood(g, n.id, X) && !M.closeBlood(g, n.id, Y))?.id;
  }, P, X, Y);
  // he marries the daughter: her mother is then never his
  await wed(A, man, Y);
  ok((await problem(A, man, X, 'divorced')) === 'أم إحدى زوجاته أو جدتها', 'his wife\'s mother: refused, whatever the status');
  // the other way: a man married to the mother may not marry her daughter while it lasts
  const man2 = await A.evaluate(async (P, X, Y, man) => {
    const url = p => performance.getEntriesByType('resource').map(e => e.name).find(x => new URL(x).pathname === p) ?? p;
    const S = await import(url('/src/data/store.ts'));
    const M = await import(url('/src/data/marriages.ts'));
    const g = S.getState().graph;
    return [...g.nodes.values()].find(n => n.sex === 'm' && !n.external && !n.familyRoot && ![P.father, P.son, man].includes(n.id) && !g.marriages.some(x => x.husband === n.id) && !M.closeBlood(g, n.id, X) && !M.closeBlood(g, n.id, Y))?.id;
  }, P, X, Y, man);
  // X's marriage from outside ends first, so she may marry again
  await store(A, (m, x) => { const g = m.getState().graph; const mm = g.marriages.find(y => y.wife === x && y.status === 'married'); return import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/marriages.ts')).then(M => M.editMarriage(mm.id, { status: 'divorced' })); }, X); await wait(1200);
  await wed(A, man2, X);
  ok((await problem(A, man2, Y, 'divorced')) === 'بنت إحدى زوجاته أو حفيدتها', 'his current wife\'s daughter: refused');

  // two at once: a sister of his current wife, and her brother's daughter
  const [h3] = await A.evaluate(async (P, used) => {
    const url = p => performance.getEntriesByType('resource').map(e => e.name).find(x => new URL(x).pathname === p) ?? p;
    const S = await import(url('/src/data/store.ts'));
    const M = await import(url('/src/data/marriages.ts'));
    const g = S.getState().graph;
    return [...g.nodes.values()].filter(n => n.sex === 'm' && !n.external && !n.familyRoot && !used.includes(n.id) && !g.marriages.some(x => x.husband === n.id) && [...P.sisters, P.niece].every(w => !M.closeBlood(g, n.id, w))).map(n => n.id);
  }, P, [P.father, P.son, man, man2]);
  await wed(A, h3, P.sisters[0]);
  ok((await problem(A, h3, P.sisters[1])) === 'أخت زوجته الحالية: لا يُجمع بين الأختين', 'her sister, while she is his wife: refused');
  ok((await problem(A, h3, P.niece)) === 'لا يُجمع بين المرأة وعمتها أو خالتها', 'her brother\'s daughter, while she is his wife: refused');
  ok((await problem(A, h3, P.sisters[1], 'divorced')) === null, 'a past marriage to her sister is not refused (only two at once)');
  // once that marriage ends, her sister may be married
  await store(A, (m, a) => { const g = m.getState().graph; const mm = g.marriages.find(y => y.husband === a.h && y.wife === a.w); return import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/marriages.ts')).then(M => M.editMarriage(mm.id, { status: 'divorced' })); }, { h: h3, w: P.sisters[0] }); await wait(1200);
  ok((await problem(A, h3, P.sisters[1])) === null, 'after a divorce, her sister: allowed');

  // the sheet says why, and does not save; the search leaves the son's wife out for the father
  await store(A, (m, id) => m.set({ spouseFor: id }), P.father); await wait(700);
  await A.evaluate(() => [...document.querySelectorAll('.addsheet .seg button, .overlay .seg button')].find(b => b.textContent.includes('من العائلة'))?.click()); await wait(400);
  await store(A, (m, id) => m.set({ spousePick: id }), D2); await wait(600);
  const sheet = await A.evaluate(() => ({ warn: document.querySelector('.overlay .warnbox')?.textContent ?? '', disabled: document.querySelector('.overlay .foot .btn.primary')?.disabled ?? null }));
  ok(sheet.warn.includes('كانت زوجة لابنه') && sheet.disabled === true, 'the sheet says why, and «حفظ» stays off · ' + sheet.warn);
  if (shots) await A.screenshot({ path: shots + '/inlaws-sheet.png' });
  await store(A, m => m.set({ spouseFor: null, spousePick: null })); await wait(400);
  const d2name = await store(A, (m, id) => m.getState().graph.nodes.get(id).name, D2);
  await store(A, (m, id) => m.set({ spouseFor: id, searchOpen: 'spouse' }), P.father); await wait(700);
  await A.type('.sfield input', d2name, { delay: 8 }); await wait(800);
  const found = await A.evaluate(() => [...document.querySelectorAll('.results .prow')].length);
  // her row: her name over her father's line, as the search shows it
  const line = await mod(A, '/src/data/graph.ts', (G, d2) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => G.nasab(S.getState().graph, d2, 2)), D2);
  const has = await A.evaluate((name, line) => [...document.querySelectorAll('.results .prow')].some(r => r.innerText.replace(/\s+/g, ' ').includes(name) && r.innerText.replace(/\s+/g, ' ').includes(line)), d2name, line);
  ok(!has, `the spouse search leaves his son's wife out · ${found} others by that name`);
  await t.finish();
} catch (e) { await t.crash(e); }
