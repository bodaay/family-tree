// Milk kinship (design document 1.36), on a made-up line added for the test:
// W, a daughter of the family, married to H from outside, with S and D; X and Y
// in another branch. The root admin records that W nursed X (H the milk father),
// and that a woman from outside nursed Y, unsure. X's profile shows his milk
// mother and father and his milk brother and sister, W's those she nursed; the
// relation names «أخت من الرضاعة» and marks the step; a marriage of X and D is
// sent with a warning, never refused; Y's record changes, goes, and comes back
// with an undo; removing X takes his record with him. Made-up names only.
//   node milk.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const shots = process.argv[4];
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const until = async (fn, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(400)) if (await fn().catch(() => false)) return true;
  return false;
};
const text = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(sel)].map(e => e.innerText.replace(/\s+/g, ' ').trim()), sel);
const tap = (p, sel, has) => p.evaluate((sel, has) => { const e = [...document.querySelectorAll(sel)].find(x => x.innerText.includes(has)); e?.click(); return !!e; }, sel, has);
const NW = 'رضيةتجريبية', NH = 'زوجتجريبي', NS = 'ساعدتجريبي', ND = 'دانةتجريبية', NX = 'خالدتجريبي', NY = 'يزيدتجريبي', NO = 'هيا بنت سعد التجريبية';
const shot = async (p, name) => shots && p.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
const openProfile = async (p, id) => {
  await store(p, (m, id) => m.set({ profile: id, tab: 'tree' }), id);
  await wait(700);
};
const milkOf = (p, id) => store(p, (m, id) => m.getState().graph.milk.filter(r => r.child === id), id);
const has = (p, id) => store(p, (m, id) => m.getState().graph.nodes.has(id), id);
const seen = (p, id) => store(p, (m, id) => m.canSee(m.getState(), id), id);
const lastLink = p => p.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}'); const sk = Object.values(inv).pop(); return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null; });
const invite = async (A, id) => {
  await store(A, (m, id) => m.createInvite(id, 'x', true), id);
  await wait(1200);
  await store(A, m => m.set({ inviteOpen: null }));
  return lastLink(A);
};

try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  // two living men in two different main branches
  const P = await store(A, m => {
    const g = m.getState().graph;
    const live = b => [...g.nodes.values()].filter(n => n.sex === 'm' && !n.dead && n.branch === b && n.gen >= 3 && n.birth && n.birth.v < 1990);
    const [b1, b2] = [...g.branches].sort((a, b) => g.nodes.get(b).desc - g.nodes.get(a).desc);
    return { p: live(b1)[0]?.id, q: live(b2)[0]?.id };
  });
  ok(P.p && P.q, 'two men in two branches');
  const id = x => 'tmilk' + x + Date.now().toString(36);
  const I = { w: id('w'), h: id('h'), m: id('m'), s: id('s'), d: id('d'), x: id('x'), y: id('y') };
  const made = await store(A, (m, a) => m.adminEdit({
    title: 'سطر تجريبي للرضاعة', subject: a.P.p, level: 'everyday',
    ops: [
      { op: 'addPerson', person: { id: a.I.w, name: a.N.W, sex: 'f', father: a.P.p, birth: { v: 1975, cal: 'g' } } },
      { op: 'addPerson', person: { id: a.I.h, name: a.N.H, sex: 'm', external: true } },
      { op: 'addMarriage', marriage: { id: a.I.m, husband: a.I.h, wife: a.I.w, status: 'married' } },
      { op: 'addPerson', person: { id: a.I.s, name: a.N.S, sex: 'm', father: a.I.h, mother: a.I.w, birth: { v: 1998, cal: 'g' } } },
      { op: 'addPerson', person: { id: a.I.d, name: a.N.D, sex: 'f', father: a.I.h, mother: a.I.w, birth: { v: 2001, cal: 'g' } } },
      { op: 'addPerson', person: { id: a.I.x, name: a.N.X, sex: 'm', father: a.P.q, birth: { v: 2000, cal: 'g' } } },
      { op: 'addPerson', person: { id: a.I.y, name: a.N.Y, sex: 'm', father: a.P.q, birth: { v: 2003, cal: 'g' } } },
    ],
  }), { P, I, N: { W: NW, H: NH, S: NS, D: ND, X: NX, Y: NY } });
  ok(made && (await until(() => store(A, (m, x) => m.getState().graph.nodes.has(x), I.y))), 'the made-up line is in the tree');

  // ---- X, nursed by W, with H as the milk father
  await openProfile(A, I.x);
  ok((await text(A, '.page.profile section.milk h3')).includes('الرضاعة'), 'his profile has «الرضاعة»');
  ok(await tap(A, '.page.profile section.milk .link', 'إضافة رضاعة'), '«+ إضافة رضاعة»');
  await wait(500);
  ok(await A.evaluate(() => !!document.querySelector('.milksheet')), 'the milk sheet opens');
  await tap(A, '.milksheet button', 'اختر المرضعة من الشجرة');
  await wait(500);
  await A.type('.searchpage input', NW, { delay: 8 });
  await wait(700);
  const found = await text(A, '.searchpage .results .prow');
  ok(found.length === 1 && found[0].includes(NW), 'the search finds her (women only): ' + found.length);
  await tap(A, '.searchpage .results .prow', NW);
  await wait(600);
  ok((await text(A, '.milksheet .picked1')).join().includes(NW), 'she is picked');
  const fathers = await text(A, '.milksheet .parentpick .brow');
  ok(fathers.length === 2 && fathers[0].includes(NH) && fathers[1].includes('غير معروف'), 'her husband offered as the milk father, or «غير معروف»: ' + fathers.join(' | '));
  ok((await text(A, '.milksheet .parentpick .brow.on')).join().includes(NH), 'her only husband chosen already');
  await shot(A, 'milk1-sheet');
  await tap(A, '.milksheet .foot .btn.primary', 'حفظ');
  let said = null;
  ok(await until(async () => { said = (await store(A, m => m.getState().toast)) ?? said; return (await milkOf(A, I.x)).length === 1; }), 'recorded at once (the root admin)' + (said ? ' · ' + said : ''));
  const rec = (await milkOf(A, I.x))[0];
  ok(rec.nurse === I.w && rec.father === I.h && !rec.uncertain, 'W the nurse, H the milk father, sure');
  ok(await store(A, (m, x) => m.getState().txs.some(t => t.title.startsWith('رضاعة: ') && t.ops.some(o => o.op === 'addMilk' && o.milk.child === x)), I.x), 'in the record as «رضاعة: …»');
  const level = await A.evaluate(async rec => {
    const gv = await import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/governance.ts') ?? '/src/data/governance.ts');
    const st = await import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts');
    const g = st.getState().graph;
    const r = gv.assess(g, [{ op: 'addMilk', milk: rec }]);
    return r.level + ' ' + (r.branch === g.nodes.get(rec.child).branch);
  }, rec);
  ok(level === 'sensitive true', 'a sensitive change, in the child\'s branch: ' + level);

  // the profiles
  await openProfile(A, I.x);
  const card = (await text(A, '.page.profile section.milk .milkrec')).join(' ');
  ok(card.includes(NW) && card.includes('أرضعته') && card.includes(NH) && card.includes('الأب من الرضاعة') && card.includes('رضاعة مؤكدة'), 'his profile: his milk mother and milk father, sure');
  const sibs = (await text(A, '.page.profile section.milk .fam')).find(c => c.includes('إخوته وأخواته من الرضاعة')) ?? '';
  ok(sibs.includes(NS) && sibs.includes(ND), 'his milk brother and sister');
  await shot(A, 'milk2-profile');
  await openProfile(A, I.w);
  ok((await text(A, '.page.profile section.milk .fam')).some(c => c.includes('أرضعت') && c.includes(NX)), 'her profile: «أرضعت» him');

  // the relation: «أخت من الرضاعة», and the step marked
  await store(A, (m, a) => m.set({ profile: null, relA: a.x, relB: a.d, tab: 'relation' }), I);
  await wait(1200);
  const h = (await text(A, '.relsum h2'))[0] ?? '';
  ok(h.includes('أخت من الرضاعة'), 'the relation: ' + h);
  const rows = await text(A, '.kinroutes .prow');
  const mi = rows.findIndex(r => r.includes('أخت من الرضاعة'));
  ok(rows.length === 0 || mi >= 0, 'a route of its own, among ' + rows.length);
  if (mi >= 0 && rows.length > 1) await A.evaluate(i => document.querySelectorAll('.kinroutes .prow')[i].click(), mi);
  await wait(500);
  ok((await text(A, '.ladder .rung')).some(r => r.includes(NX) && r.includes('بالرضاعة')), 'the ladder marks his step «بالرضاعة»');
  await shot(A, 'milk3-relation');

  // a marriage of X and D: a warning, sent all the same
  await openProfile(A, I.x);
  await A.evaluate(() => document.querySelector('.page.profile .addsp')?.click());
  await wait(500);
  await tap(A, '.addsheet .bigseg button', 'من العائلة');
  await wait(300);
  await tap(A, '.addsheet button', 'اختر الزوجة من الشجرة');
  await wait(500);
  await A.type('.searchpage input', ND, { delay: 8 });
  await wait(700);
  ok(await tap(A, '.searchpage .results .prow', ND), 'she can be chosen (not refused)');
  await wait(600);
  const warn = (await text(A, '.addsheet .warnbox')).join(' ');
  ok(warn.includes('تنبيه: هي أخت من الرضاعة') && warn.includes('يقرر من يعتمده'), 'the sheet warns: ' + warn);
  ok(await A.evaluate(() => !document.querySelector('.addsheet .foot .btn.primary').disabled), 'and may still send it');
  await shot(A, 'milk4-marriage');
  await tap(A, '.addsheet .ahead .link', 'إلغاء');
  await wait(400);

  // ---- what they see: X his milk mother and milk sister, as his own family; his brother Y neither
  const XP = await t.phone('X', await invite(A, I.x));
  ok(await click(XP, 'نعم، أنا', '.join button', 2000), 'X joins');
  ok((await until(() => seen(XP, I.w))) && (await until(() => seen(XP, I.d))), 'X sees his milk mother and his milk sister');
  const YP = await t.phone('Y', await invite(A, I.y));
  ok(await click(YP, 'نعم، أنا', '.join button', 2000), 'Y joins');
  await wait(2500);
  ok(!(await seen(YP, I.w)) && !(await seen(YP, I.d)), 'his brother sees neither (for him only)');
  await store(A, m => m.set({ profile: null }));

  // ---- Y: a woman from outside, unsure
  await openProfile(A, I.y);
  await tap(A, '.page.profile section.milk .link', 'إضافة رضاعة');
  await wait(500);
  await tap(A, '.milksheet .bigseg button', 'من خارج العائلة');
  await wait(300);
  await A.type('.milksheet input.bigin', NO, { delay: 8 });
  await tap(A, '.milksheet .bigseg button', 'غير مؤكدة');
  await wait(300);
  await tap(A, '.milksheet .foot .btn.primary', 'حفظ');
  ok(await until(async () => (await milkOf(A, I.y)).length === 1), 'recorded');
  const ry = (await milkOf(A, I.y))[0];
  const nurseY = await store(A, (m, id) => { const n = m.getState().graph.nodes.get(id); return n && { external: !!n.external, sex: n.sex, gen: n.gen, branch: n.branch }; }, ry.nurse);
  const yNode = await store(A, (m, id) => { const n = m.getState().graph.nodes.get(id); return { gen: n.gen, branch: n.branch }; }, I.y);
  ok(ry.uncertain && nurseY?.external && nurseY.sex === 'f' && nurseY.gen === yNode.gen - 1 && nurseY.branch === yNode.branch, 'a woman from outside, by name, placed with him; unsure');
  await openProfile(A, I.y);
  const cy = (await text(A, '.page.profile section.milk .milkrec')).join(' ');
  ok(cy.includes('من خارج العائلة') && cy.includes('غير مؤكدة'), 'his profile shows her from outside, unsure');
  // made sure
  await tap(A, '.page.profile section.milk .milkrec .link', 'اجعلها مؤكدة');
  ok(await until(async () => { const r = await milkOf(A, I.y); return r.length === 1 && !r[0].uncertain; }), 'marked sure');
  // removed: she goes with it (nothing else names her), and an undo brings both back
  await openProfile(A, I.y);
  await tap(A, '.page.profile section.milk .milkrec .link.danger', 'حذف');
  ok(await until(async () => (await milkOf(A, I.y)).length === 0 && !(await store(A, (m, id) => m.getState().graph.nodes.has(id), ry.nurse))), 'removed, and the woman from outside with it');
  ok((await text(A, '.page.profile section.milk .hint')).join().includes('لا رضاعة مسجلة'), 'his profile: none recorded');
  const del = await store(A, m => m.getState().txs.filter(t => t.title.startsWith('حذف رضاعة')).at(-1)?.id);
  await store(A, (m, id) => m.proposeRevert(id), del);
  ok(await until(async () => (await milkOf(A, I.y)).length === 1 && (await store(A, (m, id) => m.getState().graph.nodes.has(id), ry.nurse))), 'undone: the record and the woman back');

  // removing someone takes his milk record with him: V, nursed by W too
  const V = id('v');
  await store(A, (m, a) => m.adminEdit({ title: 'ابن تجريبي', subject: a.q, level: 'everyday', ops: [{ op: 'addPerson', person: { id: a.v, name: a.n, sex: 'm', father: a.q, birth: { v: 2005, cal: 'g' } } }] }), { q: P.q, v: V, n: 'وليدتجريبي' });
  ok(await until(() => has(A, V)), 'V in the tree');
  await mod(A, '/src/data/milk.ts', (m, a) => m.addMilk(a.v, a.w, null, false), { v: V, w: I.w });
  ok(await until(async () => (await milkOf(A, V)).length === 1), 'V recorded, nursed by W');
  await store(A, (m, x) => m.deletePerson(x, false), V);
  ok(await until(async () => !(await has(A, V)) && (await milkOf(A, V)).length === 0 && (await has(A, I.w)) && (await milkOf(A, I.x)).length === 1), 'V removed, with his record; W and X\'s record stay');
  await openProfile(A, I.w);
  const nursedNow = (await text(A, '.page.profile section.milk .fam')).find(c => c.includes('أرضعت')) ?? '';
  ok(!nursedNow.includes('وليدتجريبي') && nursedNow.includes(NX), 'her profile lists X, not V');
} catch (e) {
  ok(false, 'threw: ' + (e?.stack ?? e));
}
await t.finish();
