// A key holder's request that his own key covers is approved as he sends it,
// and never waits on anyone's phone (the root admin's included): a gold his own
// wife (sensitive) and his brother (everyday), a silver only the everyday one;
// the platinum anything. What his key does not cover waits as before, and one
// sent before he held a key he approves by hand. A member with no key still
// approves nothing, his own requests included. The send screens say so.
//   node selfapprove.mjs BASE admin-link-file [shots-dir]
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
const card = (p, name) => p.evaluate(n => { const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes(n)); return c ? { text: c.innerText.replace(/\s+/g, ' '), acts: [...c.querySelectorAll('.acts button')].map(b => b.textContent.trim()) } : null; }, name);
const press = (p, name, label) => p.evaluate((n, l) => { const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes(n)); const b = c && [...c.querySelectorAll('.acts button')].find(x => x.textContent.includes(l)); b?.click(); return !!b; }, name, label);
// by its title as the app shows it (after the move to per-person keys a woman's name is a mark in the raw title)
const status = (p, s) => store(p, async (m, s) => { const H = await import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/history.ts') ?? '/src/data/history.ts'); const st = m.getState(); return st.txs.find(t => t.title.includes(s) || H.titleOf(st, t).includes(s))?.status ?? null; }, s);
const wife = (p, me, name) => mod(p, '/src/data/marriages.ts', (m, a) => m.addSpouse(a.me, { name: a.name }, { status: 'married' }), { me, name });
const child = (p, parent, name) => store(p, (m, a) => !!m.addChildTx(a.parent, { name: a.name, sex: 'm' }, false, null), { parent, name });
// the root admin's phone: seats are his to fill
const seat = async (A, tier, branch, holder) => {
  await store(A, (m, a) => { const s = m.getState(); if (s.seats.some(x => x.holder === a.holder)) m.vacate(a.holder); }, { holder }); await wait(1500);
  await store(A, (m, a) => m.appoint(a.tier, a.branch, a.holder), { tier, branch, holder }); await wait(1800);
};
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
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
  const P = await store(A, (m, me) => { const n = m.getState().graph.nodes.get(me); return { branch: n.branch, father: n.father }; }, me);

  // no key: his own request waits for others
  ok(await child(B, me, 'بلا_مفتاح'), 'with no key, he sends a request');
  await tab(B, 'الطلبات');
  ok(!(await card(B, 'بلا_مفتاح'))?.acts.length, 'and cannot approve it');

  // what the send screens say: the spouse sheet's note and button, for himself
  const sheet = async (p, id) => {
    await store(p, (m, id) => m.set({ spouseFor: id }), id); await wait(700);
    const r = await p.evaluate(() => ({ hint: [...document.querySelectorAll('.overlay p.hint')].pop()?.textContent ?? '', button: document.querySelector('.overlay .foot .btn.primary')?.textContent.trim() ?? '' }));
    await store(p, m => m.set({ spouseFor: null })); await wait(300);
    return r;
  };
  const own = (p, subject, level) => store(p, (m, a) => m.ownKey(m.getState(), a.subject, a.level), { subject, level });
  // pending on the root admin's phone at any check while it is sent
  const watch = (p, s) => p.evaluate(s => { window.__seen = false; window.__watch = setInterval(() => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(m => { if (m.getState().txs.some(t => t.title.includes(s) && t.status === 'pending')) window.__seen = true; }), 100); }, s);
  const seen = p => p.evaluate(() => { clearInterval(window.__watch); return window.__seen; });
  let x = await sheet(B, me);
  ok(x.button === 'إرسال للاعتماد' && !x.hint.includes('بمفتاحك'), 'with no key, the spouse sheet sends a request · ' + x.button);

  // gold: his own wife, and a brother (a son of his father)
  await seat(A, 'gold', P.branch, me);
  ok(await until(() => store(B, m => m.getState().seats.some(x => x.tier === 'gold'))), 'he now holds a gold key in his branch');
  x = await sheet(B, me);
  ok(x.button === 'حفظ' && x.hint.includes('يُعتمد بمفتاحك'), 'the spouse sheet: «حفظ», approved with his key · ' + x.hint);
  if (shots) { await store(B, (m, id) => m.set({ spouseFor: id }), me); await wait(700); await B.screenshot({ path: shots + '/send-approve-sheet.png' }); await store(B, m => m.set({ spouseFor: null })); await wait(300); }
  ok((await own(B, me, 'sensitive')) === 'done' && (await own(B, P.father, 'everyday')) === 'done', 'his key covers his wife and his brother');
  await watch(A, 'شهد');
  await wife(B, me, 'شهد بنت سعد');
  ok(await until(() => status(B, 'شهد').then(x => x === 'approved')), 'his own wife: approved as he sends it, no tap');
  ok(await until(() => store(A, m => m.getState().graph.marriages.some(x => m.getState().graph.nodes.get(x.wife)?.name === 'شهد بنت سعد'))), 'and his wife is in the tree on the root admin\'s phone');
  ok(!(await seen(A)), 'it never waited on the root admin\'s phone');
  await tab(A, 'الطلبات');
  ok(!(await card(A, 'شهد'))?.acts.length, 'nothing for the root admin to approve');
  ok(await child(B, P.father, 'أخ_ذهبي'), 'a brother (his father\'s son)');
  ok(await until(() => status(A, 'أخ_ذهبي').then(x => x === 'approved')), 'approved everywhere at once');
  ok((await status(A, 'بلا_مفتاح')) === 'pending', 'the request he sent before his key still waits');
  await tab(B, 'الشجرة'); await tab(B, 'الطلبات');
  const c = await card(B, 'بلا_مفتاح');
  ok(c && c.acts.some(x => x.includes('اعتماد')), 'and now he may approve it by hand · ' + c?.acts.join('، '));
  ok(await press(B, 'بلا_مفتاح', 'اعتماد'), 'he approves it');
  ok(await until(() => status(A, 'بلا_مفتاح').then(x => x === 'approved')), 'approved everywhere');

  // silver: everyday yes, sensitive no
  await seat(A, 'silver', P.branch, me);
  ok(await until(() => store(B, m => m.getState().seats.some(x => x.tier === 'silver'))), 'now a silver key');
  x = await sheet(B, me);
  ok(x.button === 'إرسال للاعتماد' && x.hint.includes('ذهبي'), 'a wife now needs a gold: the sheet sends a request · ' + x.hint);
  await wife(B, me, 'هند بنت فهد'); await wait(1500);
  await child(B, me, 'ابن_فضي');
  ok(await until(() => status(A, 'ابن_فضي').then(x => x === 'approved')), 'his own son (everyday): approved as he sends it');
  ok((await status(A, 'هند')) === 'pending', 'the wife waits for a gold');
  await tab(B, 'الشجرة'); await tab(B, 'الطلبات');
  const h = await card(B, 'هند');
  ok(h && !h.acts.some(x => x.includes('اعتماد')), 'and is not his to approve · ' + (h?.text.match(/يحتاج[^·]*/)?.[0] ?? h?.acts.join('، ')));

  // platinum: anything
  await seat(A, 'platinum', null, me);
  ok(await until(() => store(B, m => m.getState().seats.some(x => x.tier === 'platinum'))), 'now the platinum key');
  await tab(B, 'الشجرة'); await tab(B, 'الطلبات');
  ok(await press(B, 'هند', 'اعتماد'), 'the platinum holder approves his waiting request');
  ok(await until(() => status(A, 'هند').then(x => x === 'approved')), 'and it is approved at once');
  const far = await store(A, (m, b) => [...m.getState().graph.nodes.values()].find(n => !n.familyRoot && !n.external && n.sex === 'm' && n.branch && n.branch !== b)?.id, P.branch);
  ok(await child(B, far, 'بلاتيني_بعيد'), 'a child in another branch');
  ok(await until(() => status(A, 'بلاتيني_بعيد').then(x => x === 'approved')), 'approved as he sends it, in any branch');
  await t.finish();
} catch (e) { await t.crash(e); }
