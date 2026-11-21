// Members under 18 look but do not edit: no edit controls, no requests, no key;
// and a request written straight into the log by an under-18 phone (a changed
// app) is ignored by every phone, while the same from an adult is not.
// Needs a fresh local family (the test family, tests/e2e/fixture).
//   node minors.mjs BASE admin-link-file [screenshots-dir]
// Never prints links or keys: they stay inside the browser pages.
import { setup, click, wait } from './mar-lib.mjs';

const t = setup();
const { ok, shot } = t;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
/** Writes a request straight into the log with this phone's own key, as a changed app could. */
const forgeRequest = (p, txId) => p.evaluate(async txId => {
  const find = path => performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path;
  const [{ makeEntry, entryHash }, { unb64 }, store] = await Promise.all([import(find('/src/core/log.ts')), import(find('/src/core/crypto.ts')), import(find('/src/data/store.ts'))]);
  const m = JSON.parse(localStorage.getItem('ft-family'));
  const dev = JSON.parse(localStorage.getItem('ft-device'));
  const me = store.getState().me;
  const { entries } = await (await fetch(`/api/f/${m.fid}/log?after=-1`)).json();
  const tx = { id: txId, at: Date.now(), by: me, title: 'تجربة', subject: me, level: 'everyday', branch: store.getState().graph.nodes.get(me).branch, ops: [{ op: 'updatePerson', id: me, before: {}, after: { uncertain: true } }], status: 'pending', approvals: [] };
  const e = makeEntry(unb64(m.key), dev, entries.length, entryHash(entries[entries.length - 1]), { type: 'propose', tx });
  return (await fetch(`/api/f/${m.fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) })).status;
}, txId);
/** Makes a personal invite for that person on the admin's phone; returns its link (kept inside the test). */
const inviteFor = async (A, id) => {
  await store(A, (m, id) => m.createInvite(id), id); await wait(2500);
  return store(A, m => { const k = m.getState().inviteOpen; const sk = JSON.parse(localStorage.getItem('ft-invites:' + m.currentMembership().fid) ?? '{}')[k]; m.set({ inviteOpen: null }); return m.inviteLinkFor(sk); });
};
const join = async (link, name) => {
  const p = await t.phone(name, link);
  await wait(1500);
  await p.evaluate(() => [...document.querySelectorAll('.join button')].find(b => b.textContent.startsWith('نعم'))?.click());
  await wait(3000);
  return p;
};
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  // a boy of 12 to 16, and a man of 30 to 60, both living, in a main branch
  const pick = await store(A, m => {
    const g = m.getState().graph, Y = new Date().getFullYear();
    const all = [...g.nodes.values()].filter(n => n.sex === 'm' && !n.dead && !n.external && n.branch && n.by != null);
    return { minor: all.find(n => Y - n.by >= 12 && Y - n.by <= 16)?.id, adult: all.find(n => Y - n.by >= 30 && Y - n.by <= 60)?.id, branch: all.find(n => Y - n.by >= 12 && Y - n.by <= 16)?.branch };
  });
  ok(!!pick.minor && !!pick.adult, 'the family has a boy under 18 and a man over 18 · ' + JSON.stringify(pick));

  // a key for someone under 18 is refused, with the reason
  await store(A, (m, a) => m.appoint('silver', a.branch, a.minor), pick); await wait(1500);
  const seat = await store(A, (m, id) => ({ held: m.getState().seats.some(x => x.holder === id), toast: m.getState().toast }), pick.minor);
  ok(!seat.held && String(seat.toast).includes('دون 18 سنة'), 'no key for someone under 18 · ' + seat.toast);

  const K = await join(await inviteFor(A, pick.minor), 'K');
  const D = await join(await inviteFor(A, pick.adult), 'D');
  const who = await store(K, m => ({ me: m.getState().me, minor: m.isMinorViewer() }));
  ok(who.me === pick.minor && who.minor, 'the boy joined, and the app knows he is under 18');
  ok(await store(D, m => !m.isMinorViewer()), 'the man is not limited');

  // no edit controls for the boy: tree, his own profile, «أنا», requests
  await click(K, 'الشجرة', '.tab', 600);
  ok(await K.evaluate(() => !document.querySelector('.fab')), 'no + on the tree');
  await store(K, (m, id) => m.set({ profile: id }), pick.minor); await wait(900);
  const controls = await K.evaluate(() => [...document.querySelectorAll('.page.profile button')].map(b => b.textContent.trim()).filter(t => /إضافة|تعديل|تراجع|كنية/.test(t)));
  ok(controls.length === 0, 'his own profile: nothing to add or change · ' + JSON.stringify(controls));
  await shot(K, 'minor-profile.png', 'نبذة');
  await store(K, m => m.set({ profile: null, tab: 'me' })); await wait(700);
  const hint = await K.evaluate(() => [...document.querySelectorAll('.page p.hint')].map(p => p.textContent).find(t => t.includes('سن 18')));
  ok(!!hint, '«أنا» says editing opens at 18');
  await shot(K, 'minor-me.png');
  // the same profile on the man's phone still has its controls
  await store(D, (m, id) => m.set({ profile: id }), pick.adult); await wait(900);
  ok(await D.evaluate(() => [...document.querySelectorAll('.page.profile button')].some(b => b.textContent.includes('إضافة ابن'))), 'the man\'s own profile keeps «إضافة ابن أو ابنة»');

  // asking through the app is refused with the reason
  const asked = await store(K, (m, id) => { const tx = m.propose({ title: 'x', subject: id, level: 'everyday', ops: [] }); return { tx, toast: m.getState().toast }; }, pick.minor);
  ok(asked.tx === null && asked.toast === 'التعديل والطلبات متاحة من سن 18', 'a request from the app is refused · ' + asked.toast);

  // a changed app: requests written straight into the log
  ok((await forgeRequest(K, 'tx-minor')) === 201, 'the server stores the boy\'s forged request (it cannot read it)');
  ok((await forgeRequest(D, 'tx-adult')) === 201, 'and the man\'s');
  await wait(4500);
  const seen = await Promise.all([A, K, D].map(p => store(p, m => m.getState().txs.map(t => t.id))));
  ok(seen.every(ids => !ids.includes('tx-minor')), 'every phone ignores the request written by someone under 18');
  ok(seen.every(ids => ids.includes('tx-adult')), 'every phone shows the man\'s request');
  await t.finish();
} catch (e) {
  await t.crash(e);
}
