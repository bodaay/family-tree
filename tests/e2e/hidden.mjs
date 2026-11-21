// Hidden marriages (design document 1.29), after the move (MOVE=1). B hides a
// marriage to a wife from outside, asked of G (a gold of his branch) alone: a
// private entry nobody else can open, signed with a key that is nobody's. G
// approves it from his requests; B and G see it, the root admin and C do not,
// and her name is nowhere they can read. A child of it is one request that
// reveals the marriage with it. A second hidden marriage is revealed by G's
// phone when B's death is recorded. A phone B adds later gets it from his first.
//   FT_REPO=<worktree> node hidden.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait, typeYear } from './mar-lib.mjs';
const { readWith } = await import('./pkeys-read.mts');
const { typesWith } = await import('./outdated-read.mts');
const t = setup();
const { ok } = t;
const shots = process.argv[4];
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
// what a phone holds of the hidden marriages, and whether its tree shows a marriage or a person
const hid = p => store(p, m => m.getState().hidden.map(h => ({ id: h.id, status: h.status, approver: h.approver, wife: h.marriage.wife, title: h.title })));
const has = (p, mid, wid) => store(p, (m, a) => { const g = m.getState().graph; const x = g.marriages.find(y => y.id === a.mid); return { marriage: !!x, hidden: !!x?.hidden, status: x?.status ?? null, year: x?.year?.v ?? null, wife: g.nodes.has(a.wid), name: g.nodes.get(a.wid)?.name ?? null }; }, { mid, wid });
const W1 = 'نورة_مخفية', W2 = 'هند_مخفية';
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  const fid = await A.evaluate(() => JSON.parse(localStorage.getItem('ft-family')).fid);
  const B = await t.phone('B', await invite(A, 'مشاري', 1985));
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'B joins');
  const bMe = await store(B, m => m.getState().me);
  // G, a man of B's branch, to hold its gold key; C, another member
  const who = await mod(A, '/src/data/kinship.ts', (K, me) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => {
    const g = S.getState().graph;
    const br = g.nodes.get(me).branch;
    const men = [...g.nodes.values()].filter(n => n.sex === 'm' && !n.dead && n.birth && n.id !== me && !n.external && !n.familyRoot && n.birth.v < 1990 && n.birth.v > 1940);
    const gold = men.find(n => n.branch === br && (K.kin(g, me, n.id)?.deg ?? 99) >= 4);
    const c = men.find(n => n.id !== gold?.id && (K.kin(g, me, n.id)?.deg ?? 99) >= 5);
    return { branch: br, g: gold && { id: gold.id, name: gold.name, year: gold.birth.v }, c: c && { id: c.id, name: c.name, year: c.birth.v } };
  }), bMe);
  ok(!!who.g && !!who.c, 'a man of B\'s branch for the gold key, and another member');
  const G = await t.phone('G', await invite(A, who.g.name, who.g.year));
  ok(await click(G, 'نعم، أنا', '.join button', 2000), 'G joins');
  await store(A, (m, a) => m.appoint('gold', a.branch, a.holder), { branch: who.branch, holder: who.g.id });
  ok(await until(() => store(B, (m, h) => m.getState().seats.some(x => x.holder === h && x.tier === 'gold'), who.g.id)), 'the root admin gives G the gold key of B\'s branch');
  const C = await t.phone('C', await invite(A, who.c.name, who.c.year));
  ok(await click(C, 'نعم، أنا', '.join button', 2000), 'C joins');

  // B: «زواج مخفي» in the add-wife sheet, asked of G alone
  await store(B, (m, me) => m.set({ spouseFor: me }), bMe);
  await wait(800);
  ok(await click(B, 'زواج مخفي', '.overlay button', 500), 'B chooses «زواج مخفي»');
  const list = await B.evaluate(() => [...document.querySelectorAll('.overlay .parentpick .brow')].map(b => b.innerText.replace(/\s+/g, ' ')));
  ok(list.some(x => x.includes('ذهبي')) && list.length >= 1, 'it offers who may approve: G, with his key · ' + list.join(' | '));
  await B.evaluate(n => [...document.querySelectorAll('.overlay .parentpick .brow')].find(b => b.innerText.includes(n))?.click(), who.g.name.split(' ')[0]);
  await wait(300);
  await B.type('.overlay input.bigin[dir="rtl"]', W1, { delay: 8 });
  await typeYear(B, 'سنة الزواج', '2020');
  if (shots) await B.screenshot({ path: shots + '/hidden-sheet.png' });
  const n0 = (await typesWith(t.base, fid, await keysOf(A))).length;
  ok(await click(B, 'إرسال', '.overlay .foot button', 1500), 'B sends it');
  ok(await until(async () => (await hid(B)).length === 1), 'B\'s phone has it, waiting');
  const types = await typesWith(t.base, fid, await keysOf(A));
  ok(types.length === n0 + 1 && types.at(-1) === 'private', 'the log holds one private entry');
  const env = (await (await fetch(`${t.base}/api/f/${fid}/log?after=-1`)).json()).entries.at(-1);
  const known = await store(A, m => [...m.getState().devices.keys()]);
  ok(!known.includes(env.pub), 'signed by a key that is nobody\'s');
  const h1 = (await hid(B))[0];
  ok(await until(async () => (await hid(G)).some(x => x.id === h1.id && x.status === 'pending')), 'G\'s phone has it, asking him');
  ok((await hid(A)).length === 0 && (await hid(C)).length === 0, 'the root admin\'s and C\'s phones have nothing');
  for (const [p, n] of [[A, 'the root admin'], [C, 'C']]) {
    const r = await readWith(t.base, fid, await keysOf(p), [W1]);
    ok(r.leaks === 0, `her name is nowhere ${n}'s keys open`);
  }

  // G approves it from his requests
  await tab(G, 'الطلبات');
  await wait(800);
  const gCard = await G.evaluate(() => [...document.querySelectorAll('.requests .card.req')].find(c => c.querySelector('.lvl')?.textContent.includes('مخفي'))?.innerText.replace(/\s+/g, ' ') ?? '');
  ok(gCard.includes(W1) && gCard.includes('اعتماد'), 'G sees the request, with her name, and «اعتماد»');
  if (shots) await G.screenshot({ path: shots + '/hidden-requests.png' });
  await G.evaluate(() => [...[...document.querySelectorAll('.requests .card.req')].find(c => c.querySelector('.lvl')?.textContent.includes('مخفي'))?.querySelectorAll('.acts button') ?? []].find(b => b.textContent.includes('اعتماد'))?.click());
  ok(await until(async () => (await hid(B)).some(x => x.id === h1.id && x.status === 'approved')), 'approved: B\'s phone has it');
  const b1 = await has(B, h1.id, h1.wife);
  ok(b1.marriage && b1.hidden && b1.wife && b1.name === W1 && b1.year === 2020, 'B\'s tree shows the marriage, marked hidden, his wife and its year');
  const g1 = await has(G, h1.id, h1.wife);
  ok(g1.marriage && g1.hidden, 'so does G\'s');
  for (const [p, n] of [[A, 'root admin'], [C, 'C']]) {
    const x = await has(p, h1.id, h1.wife);
    ok(!x.marriage && !x.wife, `the ${n}'s tree has neither`);
  }
  await store(B, (m, me) => m.set({ profile: me }), bMe);
  await wait(800);
  const prof = await B.evaluate(() => [...document.querySelectorAll('.page.profile .card.fam')].map(c => c.innerText.replace(/\s+/g, ' ')).join(' | '));
  ok(prof.includes('مخفي') && prof.includes('إعلان'), 'B\'s profile marks it «مخفي», with «إعلان»');
  if (shots) await B.screenshot({ path: shots + '/hidden-profile.png' });
  await store(B, m => m.set({ profile: null }));

  // B adds a phone: his first phone hands the hidden marriage on to it
  await store(B, m => m.addDevice());
  await wait(2000);
  const B2 = await t.phone('B2', await lastLink(B));
  ok(await click(B2, 'نعم، أنا', '.join button', 2000), 'B adds a second phone');
  ok(await until(async () => (await hid(B2)).some(x => x.id === h1.id && x.status === 'approved'), 30000), 'his first phone hands the hidden marriage on: the new one sees it, approved');
  ok((await has(B2, h1.id, h1.wife)).name === W1, 'with his wife\'s name');

  // a child of it: one request, revealing the marriage with it
  ok(await store(B, (m, a) => !!m.addChildTx(a.me, { name: 'ابن_الزواج_المخفي', sex: 'm' }, false, a.w), { me: bMe, w: h1.wife }), 'B adds a son of that marriage');
  ok(await until(() => store(A, (m, id) => m.getState().txs.some(t => t.status === 'pending' && t.ops.some(o => o.op === 'addMarriage' && o.marriage.id === id)), h1.id)), 'one request goes out, with the marriage in it');
  const rq = await store(A, (m, id) => { const t = m.getState().txs.find(t => t.status === 'pending' && t.ops.some(o => o.op === 'addMarriage' && o.marriage.id === id)); return { id: t.id, level: t.level, ops: t.ops.map(o => o.op), year: t.ops.find(o => o.op === 'addMarriage').marriage.year ?? null, sealed: !!t.ops.find(o => o.op === 'addMarriage').marriage.sealed }; }, h1.id);
  ok(rq.level === 'sensitive' && rq.ops.join() === 'addPerson,addMarriage,addPerson' && !rq.year && rq.sealed, 'her, the marriage (its year sealed with her key) and the son; sensitive · ' + rq.ops.join());
  ok(await until(() => store(G, (m, id) => m.getState().txs.some(t => t.id === id && t.status === 'pending'), rq.id)), 'it reaches G');
  await store(G, (m, id) => m.approve(id), rq.id);
  ok(await until(async () => (await has(A, h1.id, h1.wife)).marriage), 'G approves it: the marriage is in the tree');
  const a2 = await has(A, h1.id, h1.wife);
  ok(!a2.hidden && a2.wife && a2.name === W1 && a2.year === 2020, 'the root admin reads her and its year (her key handed to him)');
  ok(await until(async () => (await hid(B)).length === 0), 'B\'s phone holds it as an ordinary marriage now');

  // a second, revealed when B's death is recorded: by G's phone, as a widowhood
  await store(B, (m, a) => m.hideMarriage({ name: a.w }, {}, a.g), { w: W2, g: who.g.id });
  ok(await until(async () => (await hid(G)).some(x => x.status === 'pending' && x.title.includes(W2))), 'B hides a second marriage');
  const h2 = (await hid(G)).find(x => x.title.includes(W2));
  await store(G, (m, id) => m.decideHidden(id, true), h2.id);
  ok(await until(async () => (await hid(B)).some(x => x.id === h2.id && x.status === 'approved')), 'G approves it');
  await store(A, (m, me) => m.recordDeath(me, { v: 2026, cal: 'g' }), bMe);
  ok(await until(async () => (await has(A, h2.id, h2.wife)).status === 'widowed', 40000), 'the root admin records B\'s death: G\'s phone reveals the marriage, a widowhood');
  const a3 = await has(A, h2.id, h2.wife);
  ok(a3.wife && a3.name === W2, 'with his widow in the tree');
  await t.finish();
} catch (e) { await t.crash(e); }
