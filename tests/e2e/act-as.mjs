// The root admin acting as a member (design document 1.38): «العمل بصفته» on a
// member's profile. The app shows what that member's phone shows (their place,
// what the privacy rule lets them see, their key), and what the root admin sends,
// approves or refuses there counts as theirs, recorded as «مشرف العائلة بصفة …» on
// every phone, theirs included. Their devices, security and keys are never
// reached, nor anything only the root admin or the platinum holder may do.
//   node act-as.mjs <BASE url> <admin-link file>
// - G (a gold of his branch) and M (in the same branch) join; M sends requests.
// - Acting as G: the banner; أنا without أجهزتي, the lock or «إزالة العائلة»; no
//   permissions sheet on profiles; a woman G may not see is hidden. M's request
//   approved and another refused with G's key; G's own son approved as sent.
//   Everywhere: «مشرف العائلة بصفة G». Devices, view all, seats, renewals and
//   hidden marriages are refused, and nothing is written.
// - «إنهاء»: the root admin's phone again. G's phone says the root admin acted
//   as him, how often. Reopening the app ends acting.
// - Forged: an acting entry signed by a member's phone, one about a device, one
//   as someone with no phone, one whose approver is not the one acted as: all
//   stored, none counts; the same with the admin key counts. An entry of the
//   older format after these is refused by the server.
import {
  C$, K$, L$, base, fid, check, run, wait, until, phone, click, tab, rootAdmin, keysOf, forge, fetchLog, closeApp, reopen, shot,
} from './multidev-lib.mjs';

const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const st = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const txBy = (p, name) => st(p, (m, n) => { const t = m.getState().txs.find(x => x.title.includes(n)); return t ? { id: t.id, status: t.status, by: t.by, via: !!t.via, approvals: t.approvals.map(a => ({ by: a.by, via: !!a.via })), rejectedBy: t.rejectedBy ?? null, rejectedVia: !!t.rejectedVia } : null; }, name);
const card = (p, name) => p.evaluate(n => { const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes(n)); return c ? { text: c.innerText.replace(/\s+/g, ' '), acts: [...c.querySelectorAll('.acts button')].map(b => b.textContent.trim()) } : null; }, name);
const press = (p, name, label) => p.evaluate((n, l) => { const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes(n)); const b = c && [...c.querySelectorAll('.acts button')].find(x => x.textContent.includes(l)); b?.click(); return !!b; }, name, label);
const histRow = (p, name) => p.evaluate(n => [...document.querySelectorAll('.requests .card.hist')].find(x => x.innerText.includes(n))?.innerText.replace(/\s+/g, ' ') ?? null, name);
const child = (p, parent, name) => st(p, (m, a) => !!m.addChildTx(a.parent, { name: a.name, sex: 'm' }, false, null), { parent, name });
const LETTERS = 'ابتثجحخدذر';
let k = 0;
const fresh = prefix => prefix + String(Date.now() + k++).slice(-5).split('').map(d => LETTERS[+d]).join('');

/** The root admin makes a personal invite for this person; its link (never printed). */
async function inviteFor(A, id) {
  await st(A, (m, id) => m.createInvite(id), id);
  await wait(2000);
  const link = await st(A, (m, id) => {
    const s = m.getState();
    const saved = JSON.parse(localStorage.getItem('ft-invites:' + m.currentMembership().fid) ?? '{}');
    const key = s.invites.filter(i => i.person === id && i.status === 'pending').map(i => i.key).find(x => saved[x]);
    m.set({ inviteOpen: null });
    return key ? m.inviteLinkFor(saved[key]) : null;
  }, id);
  return link;
}
async function joinAs(name, link) {
  const p = await phone(name, link);
  await click(p, 'نعم، أنا', '.join button', 2500);
  await until(() => p.evaluate(() => !!document.querySelector('nav.tabs')));
  return p;
}

await run(async () => {
  const A = await rootAdmin();
  const admin = await st(A, m => m.getState().me);
  // G: the member of the cast (1985); M: another grown man of his branch
  const G = 'p30';
  const pick = await st(A, (m, a) => {
    const g = m.getState().graph;
    const b = g.nodes.get(a.G).branch;
    const men = [...g.nodes.values()].filter(n => n.sex === 'm' && !n.external && !n.familyRoot && !n.dead && n.branch === b && n.id !== a.G && n.id !== a.admin && n.birth && n.birth.v < 1995 && n.birth.v > 1940);
    const far = [...g.nodes.values()].filter(n => n.sex === 'f' && !n.external && n.branch && n.branch !== b).map(n => n.id);
    const nobody = [...g.nodes.values()].find(n => n.sex === 'm' && !n.external && !n.familyRoot && !n.dead && n.branch === b && n.id !== a.G && n.id !== a.admin && n.id !== men[0]?.id)?.id;
    return { branch: b, M: men[0]?.id, far, nobody };
  }, { G, admin });
  check(!!pick.M && !!pick.nobody && pick.far.length > 10, 'the cast: G, a man of his branch, someone with no phone, and women of other branches');
  const M = pick.M;

  const Gp = await joinAs('G', await inviteFor(A, G));
  const Mp = await joinAs('M', await inviteFor(A, M));
  check((await st(Gp, m => m.getState().me)) === G && (await st(Mp, m => m.getState().me)) === M, 'G and M joined on their own phones');
  await st(A, (m, a) => m.appoint('gold', a.branch, a.G), { branch: pick.branch, G });
  check(!!(await until(() => st(Gp, m => m.getState().seats.some(x => x.tier === 'gold')))), 'G holds the gold key of his branch');

  const r1 = fresh('طلب'), r2 = fresh('رفض'), r3 = fresh('مزور');
  for (const r of [r1, r2, r3]) await child(Mp, M, r);
  check(!!(await until(async () => (await txBy(A, r3))?.status === 'pending')), 'M sent three requests, waiting for a key');

  // ---- no acting as the root admin's own place, or as someone with no phone
  const offer = async id => {
    await st(A, (m, id) => m.set({ profile: id }), id);
    await wait(1200);
    const has = await A.evaluate(() => !!document.querySelector('.page.profile section.perms .card.actas'));
    await st(A, m => m.set({ profile: null }));
    return has;
  };
  check(!(await offer(admin)) && !(await offer(pick.nobody)), 'never offered for the root admin\'s own place, nor for someone with no phone');
  check(await offer(G), '«العمل بصفته» is on the profile of a member with a phone');

  // ---- acting as G
  await st(A, (m, id) => m.set({ profile: id }), G);
  await wait(1200);
  await A.evaluate(() => document.querySelector('.page.profile section.perms .card.actas')?.scrollIntoView({ block: 'center' }));
  await wait(400);
  await shot(A, 'act-start');
  check(await click(A, 'ابدأ', '.page.profile section.perms .card.actas button', 2500), 'the root admin starts acting as G');
  const bar = await A.evaluate(() => document.querySelector('.actbar')?.innerText.replace(/\s+/g, ' ') ?? '');
  const gName = await st(A, (m, id) => m.nameOf(m.getState(), id), G);
  check(bar.includes('تعمل بصفة') && bar.includes(gName.split(' ')[0]) && bar.includes('إنهاء'), 'a bar on every screen: acting as G, everything recorded, «إنهاء»', bar);
  const as = await st(A, m => { const s = m.getState(); return { acting: s.actingAs, me: s.me, root: s.rootAdmin, sees: s.seesAll }; });
  check(as.acting === G && as.me === G && !as.root && !as.sees, 'the app is G\'s phone: his place, no root admin, no view all', JSON.stringify(as));

  await shot(A, 'act-tree');
  await tab(A, 'أنا');
  await shot(A, 'act-me');
  // the page without the note that says they are not reached
  const me = await A.evaluate(() => {
    const page = document.querySelector('.page.me').cloneNode(true);
    const note = page.querySelector('.acting-note');
    const said = note?.innerText ?? '';
    note?.remove();
    return { text: page.textContent ?? '', said, devs: !!page.querySelector('.mydevs') };
  });
  check(!me.devs && !me.text.includes('إضافة جهاز') && !me.text.includes('قفل البصمة') && !me.text.includes('مفتاح الاستعادة') && !me.text.includes('إزالة العائلة من هذا الجهاز'), 'أنا: no devices, no lock or kit, no removing the family');
  check(me.said.includes('لا تُفتح بصفة غيرك'), 'it says his devices and security are not reached this way');
  await st(A, (m, id) => m.set({ profile: id }), M);
  await wait(1200);
  check(await A.evaluate(() => !document.querySelector('.page.profile section.perms')), 'no permissions sheet on profiles while acting');
  await st(A, m => m.set({ profile: null }));
  const hidden = await st(A, (m, far) => far.filter(id => !m.canSee(m.getState(), id)).length, pick.far);
  check(hidden > 0, 'women G may not see are hidden, as on his phone · ' + hidden + ' of ' + pick.far.length);

  // M's request: approved with G's key
  await tab(A, 'الطلبات');
  await shot(A, 'act-requests');
  const c1 = await card(A, r1);
  check(!!c1 && c1.acts.some(x => x.includes('اعتماد')) && !c1.text.includes('بقرارك وحدك'), 'M\'s request: G may approve it (not the root admin\'s own decision)', c1?.text);
  await press(A, r1, 'اعتماد');
  check(!!(await until(async () => (await txBy(Mp, r1))?.status === 'approved')), 'approved with G\'s key, on M\'s phone too');
  const t1 = await txBy(Mp, r1);
  check(t1.approvals.length === 1 && t1.approvals[0].by === G && t1.approvals[0].via, 'recorded as G\'s approval, by the root admin acting as him', JSON.stringify(t1.approvals));
  await tab(Mp, 'الشجرة'); await tab(Mp, 'الطلبات');
  await shot(Mp, 'act-member-history');
  const h1 = await histRow(Mp, r1);
  check(!!h1 && h1.includes('مشرف العائلة بصفة ' + gName.split(' ')[0]), 'M\'s history: «معتمد من مشرف العائلة بصفة G»', h1);

  // another one refused
  await tab(A, 'الشجرة'); await tab(A, 'الطلبات');
  await press(A, r2, 'رفض');
  check(!!(await until(async () => (await txBy(Gp, r2))?.status === 'rejected')), 'another refused with G\'s key');
  const t2 = await txBy(Gp, r2);
  check(t2.rejectedBy === G && t2.rejectedVia, 'recorded as G\'s refusal, by the root admin acting as him');

  // G's own son: his key covers it, approved as it is sent
  const own = fresh('ابن');
  await child(A, G, own);
  check(!!(await until(async () => (await txBy(Gp, own))?.status === 'approved')), 'a son of G sent as him: approved with his key as it is sent');
  const t3 = await txBy(Gp, own);
  check(t3.by === G && t3.via && t3.approvals[0]?.by === G && t3.approvals[0]?.via, 'sent and approved as G, by the root admin');
  await tab(Gp, 'الشجرة'); await tab(Gp, 'الطلبات');
  const h3 = await histRow(Gp, own);
  check(!!h3 && h3.includes('أرسله مشرف العائلة بصفة'), 'G\'s own phone: «أرسله مشرف العائلة بصفة G»', h3);

  // ---- never his devices, security or keys, nor a manager's acts
  const n0 = (await fetchLog()).length;
  const gDevice = await st(A, (m, id) => [...m.getState().devices].find(([, p]) => p === id)?.[0], G);
  await st(A, m => m.addDevice());
  await st(A, (m, d) => m.removeMyDevices([d], 'x'), gDevice);
  await st(A, (m, id) => m.setViewAll(id, true), M);
  await st(A, (m, a) => m.appoint('silver', a.branch, a.M), { branch: pick.branch, M });
  await st(A, m => m.renewKeyNow());
  await st(A, (m, id) => m.hideMarriage({ name: 'سلمى' }, {}, id), M);
  await wait(3000);
  check((await fetchLog()).length === n0, 'adding or removing his devices, view all, seats, renewing the key, a hidden marriage: nothing written');
  check((await st(A, (m, d) => m.getState().devices.get(d), gDevice)) === G, 'his phone is still his');

  // ---- «إنهاء»
  await click(A, 'إنهاء', '.actbar button', 2000);
  const back = await st(A, m => { const s = m.getState(); return { acting: s.actingAs, me: s.me, root: s.rootAdmin, sees: s.seesAll }; });
  check(!back.acting && back.me === admin && back.root && back.sees && !(await A.evaluate(() => !!document.querySelector('.actbar'))), 'ended: the root admin\'s own phone again');
  check((await st(A, (m, far) => far.filter(id => !m.canSee(m.getState(), id)).length, pick.far)) === 0, 'seeing everyone again');

  // G's phone says so
  await tab(Gp, 'أنا');
  await shot(Gp, 'act-acted-for');
  const said = await Gp.evaluate(() => document.querySelector('.page.me .hint.acted')?.innerText.replace(/\s+/g, ' ') ?? '');
  check(said.includes('عمل مشرف العائلة بصفتك') && said.includes('4 مرات'), 'G\'s أنا: the root admin acted as him, 4 times', said);
  await st(A, (m, id) => m.set({ profile: id }), G);
  await wait(1200);
  check((await A.evaluate(() => document.querySelector('.page.profile section.perms .hint.acted')?.innerText ?? '')).includes('4 مرات'), 'and his profile on the root admin\'s phone');
  await st(A, m => m.set({ profile: null }));

  // ---- forged
  const { m: am, d: ad } = await keysOf(A);
  const adminKey = C$.deviceFromSecret(am.admin);
  const { d: md } = await keysOf(Mp);
  const r3id = (await txBy(A, r3)).id;
  const secrets = [am.admin, ad.sk];
  const forged = [
    [md, { type: 'as', person: G, p: { type: 'approve', txId: r3id, by: G } }],
    [adminKey, { type: 'as', person: G, p: { type: 'device', act: { kind: 'remove', keys: [gDevice] }, by: G } }],
    [adminKey, { type: 'as', person: pick.nobody, p: { type: 'approve', txId: r3id, by: pick.nobody } }],
    [adminKey, { type: 'as', person: G, p: { type: 'approve', txId: r3id, by: M } }],
  ];
  let stored = 0;
  for (const [signer, p] of forged) stored += (await forge(am, signer, secrets, p)) === 201 ? 1 : 0;
  check(stored === forged.length, 'the server stores the forged entries (it cannot read them)', stored);
  await wait(4000);
  const after = await Promise.all([A, Gp, Mp].map(p => txBy(p, r3)));
  check(after.every(t => t?.status === 'pending' && !t.approvals.length), 'none counts on any phone: signed by a member\'s phone, about a device, as someone with no phone, or for another approver');
  check((await st(Gp, (m, d) => m.getState().devices.get(d), gDevice)) === G, 'G\'s phone is still his');
  check((await forge(am, adminKey, secrets, { type: 'as', person: G, p: { type: 'approve', txId: r3id, by: G } })) === 201, 'the same with the root admin\'s key');
  check(!!(await until(async () => (await txBy(Mp, r3))?.status === 'approved')), 'counts, as G\'s approval');

  // the older format after these: refused
  const log = await fetchLog();
  const ring = new Map();
  K$.addKeys(ring, [am.key, ...Object.values(am.keys ?? {})]);
  K$.openLog(log, [], ring, secrets);
  const e = L$.makeEntry(ring.get(log.at(-1).kid), ad, log.length, L$.entryHash(log.at(-1)), { type: 'approve', txId: 'none', by: admin });
  e.app = 5;
  const old = await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
  check(old.status === 426, 'an older version cannot write after the root admin has acted as someone: told to update', old.status);

  // ---- reopening the app ends it
  await st(A, (m, id) => m.set({ profile: id }), G);
  await wait(1200);
  await click(A, 'ابدأ', '.page.profile section.perms .card.actas button', 2500);
  check((await st(A, m => m.getState().actingAs)) === G, 'acting again');
  const ctx = await closeApp(A);
  const A2 = await reopen(ctx, 'A2');
  const again = await st(A2, m => ({ acting: m.getState().actingAs, root: m.getState().rootAdmin, me: m.getState().me }));
  check(!again.acting && again.root && again.me === admin && !(await A2.evaluate(() => !!document.querySelector('.actbar'))), 'reopened: the root admin\'s phone, not acting');
});
