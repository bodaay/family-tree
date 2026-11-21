// Removing someone, as a request (design document 1.32). A member asks to
// remove a childless man: one key of the branch approves it. The gold removes
// one in his branch at once. Removing a man with children takes his line with
// him and needs both golds (here the root admin decides); undoing brings it
// all back. Nobody removes himself, a key holder, or anyone with a phone.
//   node delete-req.mjs BASE admin-link-file
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const until = async (fn, ms = 30000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(500)) if (await fn().catch(() => false)) return true;
  return false;
};
const lastLink = p => p.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}'); const sk = Object.values(inv).pop(); return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null; });
const invite = async (A, id) => {
  await store(A, (m, id) => m.createInvite(id, 'x', true), id);
  await wait(1200);
  await store(A, m => m.set({ inviteOpen: null }));
  return lastLink(A);
};
const openEdit = async (p, id) => {
  await store(p, (m, id) => m.set({ profile: id, editFor: null }), id);
  await wait(600);
  await p.evaluate(() => document.querySelector('button[aria-label="تعديل البيانات"]')?.click());
  await wait(600);
  return p.evaluate(() => !!document.querySelector('.addsheet'));
};
const delLink = p => p.evaluate(() => document.querySelector('.addsheet .delask')?.textContent ?? null);
const pressDelete = async p => {
  // the confirm dialog is accepted by the test's phone; what it said is kept
  const said = new Promise(r => p.once('dialog', d => r(d.message())));
  await p.evaluate(() => document.querySelector('.addsheet .delask').click());
  const msg = await Promise.race([said, wait(3000).then(() => '')]);
  await wait(1200);
  return msg;
};
const has = (p, id) => store(p, (m, id) => m.getState().graph.nodes.has(id), id);
const pending = (p, id) => store(p, (m, id) => { const t = m.getState().txs.find(t => t.status === 'pending' && t.ops.some(o => o.op === 'removePerson' && o.person.id === id)); return t ? { id: t.id, level: t.level } : null; }, id);

try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  const P = await store(A, m => {
    const g = m.getState().graph;
    const [B] = [...g.branches].sort((a, b) => g.nodes.get(b).desc - g.nodes.get(a).desc);
    const men = [...g.nodes.values()].filter(n => n.sex === 'm' && !n.dead && n.birth && n.birth.v < 1995 && n.branch === B && n.id !== B);
    const G = men.find(n => n.kids.length >= 2);
    const M = men.find(n => n.id !== G.id && n.parent !== G.id && G.parent !== n.id && n.kids.length === 0);
    const near = id => { for (let c = g.nodes.get(id); c; c = c.parent ? g.nodes.get(c.parent) : null) if (c.id === G.id || c.id === M.id) return true; return false; };
    const tips = [...g.nodes.values()].filter(n => n.branch === B && n.sex === 'm' && !n.kids.length && !near(n.id) && n.id !== M.id);
    const D = [...g.nodes.values()].find(n => n.branch === B && n.sex === 'm' && n.kids.length >= 1 && n.desc <= 6 && !near(n.id) && ![G.id, M.id].includes(n.id) && !n.kids.includes(M.id));
    return { B, G: G.id, M: M.id, C1: tips[0].id, C2: tips[1].id, D: D.id, dDesc: D.desc, dKid: D.kids[0] };
  });
  ok(P.G && P.M && P.C1 && P.C2 && P.D, 'people picked: a gold, a member, two childless men, a man with ' + P.dDesc + ' after him');
  await store(A, (m, a) => m.appoint('gold', a.B, a.G), P);
  ok(await until(() => store(A, (m, a) => m.getState().seats.some(x => x.tier === 'gold' && x.holder === a.G), P)), 'G is gold of the branch');
  const G = await t.phone('G', await invite(A, P.G));
  ok(await click(G, 'نعم، أنا', '.join button', 2000), 'G joins');
  const M = await t.phone('M', await invite(A, P.M));
  ok(await click(M, 'نعم، أنا', '.join button', 2000), 'M joins');

  // 1. a member asks to remove a childless man: one key of the branch
  ok(await openEdit(M, P.C1), "M opens a childless man's edit screen");
  ok((await delLink(M)) === 'حذف من الشجرة…', 'it offers «حذف من الشجرة…»');
  const m1 = await pressDelete(M);
  ok(/يعتمده فضي واحد/.test(m1), 'saying a key of the branch approves it: ' + m1);
  let p1 = null;
  ok(await until(async () => !!(p1 = await pending(G, P.C1))), 'a request, waiting on G\'s phone');
  ok(p1?.level === 'everyday', 'an everyday one');
  await store(G, (m, id) => m.approve(id), p1.id);
  ok(await until(async () => !(await has(A, P.C1))), 'G approves: he is removed');

  // 2. the gold removes one in his branch: at once
  ok(await openEdit(G, P.C2), "G opens another's");
  const m2 = await pressDelete(G);
  ok(/يُحذف فورًا بمفتاحك/.test(m2), 'his key does it: ' + m2);
  ok(await until(async () => !(await has(A, P.C2))), 'removed for everyone');

  // 3. a man with children: his line goes with him; both golds, or the root admin
  ok(await openEdit(M, P.D), "M opens the edit screen of a man with children");
  ok(/وذريته/.test((await delLink(M)) ?? ''), 'it offers removing him and his line');
  const m3 = await pressDelete(M);
  ok(/الذهبيان معًا/.test(m3) && new RegExp(String(P.dDesc).replace(/\d/g, d => '[' + d + '٠١٢٣٤٥٦٧٨٩'[d] + ']')).test(m3), 'saying both golds approve it, and how many go with him: ' + m3);
  let p3 = null;
  ok(await until(async () => !!(p3 = await pending(A, P.D))) && p3.level === 'critical', 'a critical request');
  await store(G, (m, id) => m.approve(id), p3.id);
  await wait(3000);
  ok(await has(A, P.D) && !!(await pending(A, P.D)), "G's key alone is not enough");
  await store(A, (m, id) => m.approve(id), p3.id);
  ok(await until(async () => !(await has(A, P.D)) && !(await has(A, P.dKid))), 'the root admin decides: he and his line are gone');
  // undone, it all comes back
  const done = await store(A, (m, d) => m.getState().txs.find(t => t.status === 'approved' && t.ops.some(o => o.op === 'removePerson' && o.person.id === d))?.id, P.D);
  await store(A, (m, id) => m.proposeRevert(id), done);
  ok(await until(async () => (await has(A, P.D)) && (await has(A, P.dKid))), 'undone: he and his children are back');

  // 4. never oneself, a key holder, or anyone with a phone
  ok(/نفسه/.test(await store(M, (m, id) => m.deleteProblem(m.getState(), id), P.M)), 'M cannot remove himself');
  ok(/مفتاحًا/.test(await store(M, (m, id) => m.deleteProblem(m.getState(), id), P.G)), 'nor the gold');
  ok(/مفتاحًا|هاتف/.test(await store(M, (m, id) => m.deleteProblem(m.getState(), m.getState().graph.nodes.get(id).parent), P.G)), "nor his father (the gold goes with him)");
  ok(await openEdit(M, P.M) && (await delLink(M)) === null, 'and his own edit screen offers no removal');
} catch (e) {
  ok(false, 'threw: ' + (e?.stack ?? e));
}
await t.finish();
