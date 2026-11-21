// A request's level and branch are worked out by every phone from its changes,
// never taken as its sender wrote them. A key holder with a modified app labels
// a change of father «everyday», a request in another branch as his own, a
// death and a removal as everyday, a change in two branches as one: every phone
// counts each at what it really needs, his own key approves none of them alone,
// and the root admin's card says how it was sent. What the app itself sends is
// unchanged: his own everyday request is approved as he sends it.
//   node assess.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const t = setup();
const { ok } = t;
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const shots = process.argv[4];
const MEMBER = ['مشاري', '1985'];
const until = async (fn, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(500)) if (await fn()) return true;
  return false;
};
const tab = async (p, name) => { await p.evaluate(n => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes(n))?.click(), name); await wait(600); };
// one entry signed by this phone's own device key, as a modified app could write it
const forge = (p, payload) => p.evaluate(async payload => {
  const url = path => performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path;
  const b = await import(url('/src/data/backend.ts'));
  const log = new b.RemoteLog(b.membership(), items => items.findLast(i => i.p)?.kid ?? null);
  try { await log.append(payload); return 'stored'; } catch (e) { return 'refused: ' + (e instanceof Error ? e.message : String(e)); }
}, payload);
const sync = async (...ps) => { await wait(1500); for (const p of ps) await store(p, m => m.sync()); await wait(800); };
const txOf = (p, id) => store(p, (m, id) => { const x = m.getState().txs.find(t => t.id === id); return x ? { level: x.level, branch: x.branch, status: x.status, approvals: x.approvals.length, declared: x.declared ?? null } : null; }, id);
let n = 0;
const request = (me, title, subject, level, branch, ops) => ({ type: 'propose', tx: { id: 'txforge' + ++n + Date.now().toString(36), at: Date.now(), by: me, title, subject, level, branch, ops, status: 'pending', approvals: [] } });
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(A, 'تصفّح أولًا', 'button', 500);

  await tab(A, 'الإدارة');
  await click(A, 'دعوة فرد', '.page button', 600);
  await A.type('.sfield input', MEMBER[0], { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), MEMBER[1]);
  await wait(1500);
  const link = await A.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}'); const sk = Object.values(inv).pop(); return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null; });
  await click(A, 'إغلاق', '.mhead button', 400);
  const B = await t.phone('B', link);
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'the member joins');
  const me = await store(B, m => m.getState().me);

  // people in his branch and in another: a man with children, a childless man under
  // another father (to move), a living man, and a man elsewhere
  const P = await store(A, (m, me) => {
    const g = m.getState().graph;
    const mine = g.nodes.get(me);
    const men = [...g.nodes.values()].filter(n => !n.familyRoot && !n.external && n.sex === 'm' && n.branch && !g.branches.includes(n.id) && n.id !== me);
    const inB = men.filter(n => n.branch === mine.branch);
    const leaf = inB.find(n => !n.kids.length && n.father && !g.marriages.some(x => x.husband === n.id));
    const other = inB.find(n => n.id !== leaf?.father && n.id !== leaf?.id && !n.dead && n.kids.length);
    const parent = inB.find(n => n.kids.length > 0 && n.id !== other?.id && n.father);
    const alive = inB.find(n => !n.dead && !n.kids.length && n.id !== leaf?.id);
    const far = men.find(n => n.branch !== mine.branch && !n.dead);
    return { branch: mine.branch, leaf: leaf?.id, leafFather: leaf?.father, other: other?.id, parent: parent?.id, alive: alive?.id, far: far?.id, farBranch: far?.branch };
  }, me);
  ok(P.leaf && P.other && P.parent && P.alive && P.far, 'people to change: in his branch and in another · ' + JSON.stringify(P));

  await store(A, (m, a) => m.appoint('silver', a.branch, a.me), { branch: P.branch, me }); await wait(1800);
  ok(await until(() => store(B, m => m.getState().seats.some(x => x.tier === 'silver'))), 'he holds a silver key in his branch');

  // what the app sends is unchanged: his own everyday request, approved as he sends it
  ok(await store(B, (m, me) => !!m.addChildTx(me, { name: 'ابن_عادي', sex: 'm' }, false, null), me), 'the app sends an everyday request about his own son');
  ok(await until(() => store(A, m => m.getState().txs.some(t => t.title.includes('ابن_عادي') && t.status === 'approved' && !t.declared))), 'approved as he sends it, labelled as every phone works it out');

  const cases = [
    ['a change of father', request(me, 'تعديل بسيط', P.leaf, 'everyday', P.branch, [{ op: 'updatePerson', id: P.leaf, before: { father: P.leafFather }, after: { father: P.other } }]), 'critical', P.branch],
    ['a child in another branch, addressed to his', request(me, 'إضافة ابن: بعيد_مزور', P.far, 'everyday', P.branch, [{ op: 'addPerson', person: { id: 'nforge1', name: 'بعيد_مزور', sex: 'm', father: P.far } }]), 'everyday', P.farBranch],
    ['a death', request(me, 'تعديل اسم', P.alive, 'everyday', P.branch, [{ op: 'updatePerson', id: P.alive, before: { deceased: null }, after: { deceased: true } }]), 'death', P.branch],
    ['removing a man with children', request(me, 'تراجع', P.parent, 'everyday', P.branch, [{ op: 'removePerson', person: { id: P.parent, name: 'x', sex: 'm' } }]), 'critical', P.branch],
    ['a change in two branches', request(me, 'أسماء أخرى', P.leaf, 'everyday', P.branch, [{ op: 'updatePerson', id: P.leaf, before: { aliases: null }, after: { aliases: [{ type: 'kunya', text: 'أبو أ' }] } }, { op: 'updatePerson', id: P.far, before: { aliases: null }, after: { aliases: [{ type: 'kunya', text: 'أبو ب' }] } }]), 'trunk', null],
  ];
  for (const [what, entry, level, branch] of cases) {
    ok((await forge(B, entry)) === 'stored', `${what}: the modified app sends it as everyday in his branch`);
    // and approves it with his own key at once
    await forge(B, { type: 'approve', txId: entry.tx.id, by: me });
    await sync(A, B);
    const a = await txOf(A, entry.tx.id), b = await txOf(B, entry.tx.id);
    ok(a && a.level === level && a.branch === branch && a.declared?.level === 'everyday', `${what}: every phone counts it as ${level} · ${JSON.stringify(a)}`);
    ok(a?.status === 'pending' && b?.status === 'pending' && JSON.stringify(a) === JSON.stringify(b), `${what}: his own approval does not settle it, on either phone`);
  }
  ok((await txOf(A, cases[2][1].tx.id)).approvals === 1, 'the death: his approval counts as one of the two silvers it needs');
  ok((await txOf(A, cases[0][1].tx.id)).approvals === 0, 'the change of father: a silver key counts nothing toward it');

  // the root admin's card says how it was sent
  await tab(A, 'الشجرة'); await tab(A, 'الطلبات');
  const note = await A.evaluate(() => { const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes('تعديل بسيط')); return c ? { lvl: c.querySelector('.lvl')?.textContent, warn: c.querySelector('.need.warn')?.textContent ?? '' } : null; });
  ok(note && note.lvl === 'حرج' && note.warn.includes('أُرسل على أنه يومي'), 'the root admin sees «حرج», and that it was sent as everyday · ' + JSON.stringify(note));
  if (shots) { await A.evaluate(() => [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes('تعديل بسيط'))?.scrollIntoView({ block: 'center' })); await wait(300); await A.screenshot({ path: shots + '/assess-card.png' }); }
  const far = await A.evaluate(() => [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes('بعيد_مزور'))?.querySelector('.need.warn')?.textContent ?? '');
  ok(far.includes('من فرع'), 'the one addressed to his branch: the card names the branch it was sent to · ' + far);
  await t.finish();
} catch (e) { await t.crash(e); }
