// Corrections by anyone, as requests (design document 1.31). A member corrects
// a man's birth year from his profile: a request that the gold of the branch
// approves. The gold's own correction in his branch is saved at once (his key
// covers it); in the other branch it waits for the root admin. Nobody marks
// himself dead, nobody edits a woman whose details he does not see, and a year
// mistyped is refused rather than taken as clearing the year.
//   node edit-req.mjs BASE admin-link-file
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const until = async (fn, ms = 20000) => {
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
const profile = async (p, id) => {
  await store(p, (m, id) => m.set({ profile: id, editFor: null }), id);
  await wait(700);
};
const pencil = p => p.evaluate(() => !!document.querySelector('button[aria-label="تعديل البيانات"]'));
const openEdit = async p => {
  await p.evaluate(() => document.querySelector('button[aria-label="تعديل البيانات"]')?.click());
  await wait(600);
  return p.evaluate(() => !!document.querySelector('.addsheet input.bigin'));
};
const typeIn = (p, placeholder, value) => p.evaluate((ph, v) => { const i = [...document.querySelectorAll('.addsheet input')].find(x => (x.placeholder ?? '').includes(ph)); if (!i) return false; i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); return true; }, placeholder, value);
const nameInput = (p, v) => p.evaluate(v => { const i = document.querySelector('.addsheet input.bigin'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, v);
const hint = p => p.evaluate(() => document.querySelector('.addsheet .hint')?.textContent ?? '');
const send = async p => {
  const r = await p.evaluate(() => { const b = document.querySelector('.addsheet .foot .btn.primary'); if (!b || b.disabled) return null; const t = b.textContent; b.click(); return t; });
  await wait(1200);
  return r;
};
const txOf = (p, a) => store(p, (m, a) => { const t = [...m.getState().txs].reverse().find(x => x.subject === a.id && x.ops.some(o => o.op === 'updatePerson' && o.id === a.id)); return t ? { status: t.status, level: t.level, by: t.by, title: t.title } : null; }, a);

try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  const P = await mod(A, '/src/data/kinship.ts', (K, _) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => {
    const g = S.getState().graph;
    const [B, Sm] = [...g.branches].sort((a, b) => g.nodes.get(b).desc - g.nodes.get(a).desc);
    const men = [...g.nodes.values()].filter(n => n.sex === 'm' && !n.dead && !n.external && n.birth && n.birth.v < 1995 && n.branch === B && n.id !== B);
    const G = men.find(n => n.kids.length >= 2);
    const M = men.find(n => n.id !== G.id && n.parent !== G.id && G.parent !== n.id);
    const rest = men.filter(n => ![G.id, M.id].includes(n.id) && n.parent !== M.id && M.parent !== n.id);
    const X = rest[0], Y = rest[1];
    const Z = [...g.nodes.values()].find(n => n.sex === 'm' && !n.dead && n.branch === Sm && n.id !== Sm && n.birth);
    const W = [...g.nodes.values()].find(n => n.sex === 'f' && !n.familyRoot && !n.external && n.branch === B && (K.kin(g, M.id, n.id)?.deg ?? 99) > 3);
    return { B, G: G.id, M: M.id, X: X.id, xBirth: X.birth.v, Y: Y.id, yName: Y.name, Z: Z.id, zBirth: Z.birth.v, W: W.id };
  }));
  ok(P.G && P.M && P.X && P.Y && P.Z && P.W, 'people picked from the tree');
  await store(A, (m, a) => m.appoint('gold', a.B, a.G), P);
  ok(await until(() => store(A, (m, a) => m.getState().seats.some(x => x.tier === 'gold' && x.holder === a.G), P)), 'G is gold of the branch');
  const G = await t.phone('G', await invite(A, P.G));
  ok(await click(G, 'نعم، أنا', '.join button', 2000), 'G joins');
  const M = await t.phone('M', await invite(A, P.M));
  ok(await click(M, 'نعم، أنا', '.join button', 2000), 'M joins');

  // 1. a member corrects a birth year: a request, for the gold of the branch
  await profile(M, P.X);
  ok(await pencil(M), "a member sees «تعديل البيانات» on a man's profile");
  ok(await openEdit(M), 'and the whole edit screen opens');
  ok(/يُرسل كطلب يعتمده فضي واحد/.test(await hint(M)), 'it says a key of the branch approves it');
  ok(await typeIn(M, 'مثل 1965', '19x2'), 'a year mistyped');
  ok(await M.evaluate(() => [...document.querySelectorAll('.addsheet .warnbox')].some(w => w.textContent.includes('سنة الميلاد غير صحيحة')) && document.querySelector('.addsheet .foot .btn.primary').disabled), 'is refused, not taken as clearing the year');
  await typeIn(M, 'مثل 1965', String(P.xBirth - 1));
  ok((await send(M)) === 'إرسال للاعتماد', 'sent for approval');
  ok(await until(() => store(G, (m, a) => m.getState().txs.some(t => t.status === 'pending' && t.subject === a.X), P), 30000), "on G's phone, waiting for him");
  let t1 = null;
  await until(async () => !!(t1 = await txOf(A, { id: P.X })), 30000);
  ok(t1?.level === 'everyday' && t1.status === 'pending', 'an everyday request: ' + JSON.stringify(t1));
  await store(G, (m, a) => { const t = m.getState().txs.find(t => t.status === 'pending' && t.subject === a.X); m.approve(t.id); }, P);
  ok(await until(() => store(A, (m, a) => m.getState().graph.nodes.get(a.X).birth?.v === a.xBirth - 1, P), 30000), 'G approves: the year is corrected');

  // 2. the gold's own correction in his branch: saved at once
  await profile(G, P.Y);
  ok(await openEdit(G), "G opens a man's edit screen in his branch");
  ok(/يُعتمد بمفتاحك/.test(await hint(G)), 'it says his key approves it as it is sent');
  await nameInput(G, P.yName + 'ي');
  ok((await send(G)) === 'حفظ', 'saved');
  ok(await until(() => store(A, (m, a) => m.getState().graph.nodes.get(a.Y).name === a.yName + 'ي', P), 30000), 'the name changed for everyone, no one else asked');
  const t2 = await txOf(A, { id: P.Y });
  ok(t2?.status === 'approved' && t2.by === P.G, 'an approved request of his');

  // 3. in the other branch his key does not work: it waits (for the root admin here)
  await profile(G, P.Z);
  ok(await openEdit(G), 'G opens the edit screen of a man in the other branch');
  ok(/يُرسل كطلب/.test(await hint(G)), 'sent as a request there');
  await typeIn(G, 'مثل 1965', String(P.zBirth + 1));
  ok((await send(G)) === 'إرسال للاعتماد', 'sent');
  ok(await until(async () => (await txOf(A, { id: P.Z }))?.status === 'pending', 30000), 'it waits');
  await store(A, (m, a) => { const t = m.getState().txs.find(t => t.status === 'pending' && t.subject === a.Z); m.approve(t.id); }, P);
  ok(await until(() => store(A, (m, a) => m.getState().graph.nodes.get(a.Z).birth?.v === a.zBirth + 1, P), 30000), 'the root admin decides it');

  // 4. never one's own death; never a woman one does not see
  await profile(M, P.M);
  ok(await openEdit(M), 'M opens his own edit screen');
  ok(!(await M.evaluate(() => [...document.querySelectorAll('.addsheet .q')].some(q => q.textContent.trim() === 'الحالة'))), 'with no «الحالة»: nobody marks himself dead');
  await profile(M, P.W);
  ok(!(await store(M, (m, w) => m.canSee(m.getState(), w), P.W)), 'M does not see W');
  ok(!(await pencil(M)), 'and has no edit on her profile');
  // the root admin's edits stay direct
  await profile(A, P.X);
  ok(await openEdit(A), "the root admin's edit screen");
  ok(/يُحفظ مباشرة/.test(await hint(A)), 'saves directly');
} catch (e) {
  ok(false, 'threw: ' + (e?.stack ?? e));
}
await t.finish();
