// The root admin decides members' requests alone, with no keys handed out yet:
// approves one (it takes effect at once), rejects another, and the record says
// so on every phone. A decision signed with any other key counts nowhere.
//   node decide.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const { forgeDecide } = await import('./decide-forge.mts');
const t = setup();
const { ok } = t;
// run fn(module, arg) in the page with one of the app's own modules
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const shots = process.argv[4];
const MEMBER = ['مشاري', '1985'];
const until = async (fn, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(500)) if (await fn()) return true;
  return false;
};
const tab = async (p, name) => {
  await p.evaluate(n => [...document.querySelectorAll('.tab')].find(e => e.textContent.includes(n))?.click(), name);
  await wait(600);
};
const card = (p, name) => p.evaluate(n => { const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes(n)); return c ? { text: c.innerText.replace(/\s+/g, ' '), acts: [...c.querySelectorAll('.acts button')].map(b => b.textContent.trim()) } : null; }, name);
const press = (p, name, label) => p.evaluate((n, l) => { const c = [...document.querySelectorAll('.requests .card.req')].find(x => x.querySelector('h4')?.innerText.includes(n)); const b = c && [...c.querySelectorAll('.acts button')].find(x => x.textContent.includes(l)); b?.click(); return !!b; }, name, label);
const hist = p => p.evaluate(() => [...document.querySelectorAll('.requests .card.hist')].map(c => c.innerText.replace(/\s+/g, ' ')));
// by its title as the app shows it (after the move to per-person keys a woman's name is a mark in the raw title)
const txOf = (p, title) => store(p, async (m, s) => { const H = await import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/history.ts') ?? '/src/data/history.ts'); const st = m.getState(); const x = st.txs.find(t => t.title.includes(s) || H.titleOf(st, t).includes(s)); return x ? { id: x.id, status: x.status, byAdmin: !!x.byAdmin, approvals: x.approvals.length } : null; }, title);
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);
  ok(await store(A, m => m.getState().seats.length === 0), 'no keys handed out yet');

  // a personal invite for the member
  await tab(A, 'الإدارة');
  ok(await click(A, 'دعوة فرد', '.page button', 600), 'root admin starts a personal invite');
  await A.type('.sfield input', MEMBER[0], { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), MEMBER[1]);
  await wait(1500);
  const link = await A.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('ft-family'));
    const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}');
    const sk = Object.values(inv).pop();
    return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null;
  });
  ok(!!link, 'the invite link is ready');
  await click(A, 'إغلاق', '.mhead button', 400);
  const B = await t.phone('B', link);
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'the member joins');
  const me = await store(B, m => m.getState().me);

  // two requests from the member: a wife (sensitive) and a son (everyday)
  await mod(B, '/src/data/marriages.ts', (m, id) => m.addSpouse(id, { name: 'أمل بنت ناصر' }, { status: 'married' }), me); await wait(1500);
  await store(B, (m, id) => m.addChildTx(id, { name: 'نايف', sex: 'm' }, false, null), me); await wait(1500);
  ok((await txOf(B, 'أمل'))?.status === 'pending' && (await txOf(B, 'نايف'))?.status === 'pending', 'the member\'s two requests are waiting');
  await tab(B, 'الطلبات');
  ok(!(await card(B, 'أمل'))?.acts.length, 'the member cannot approve his own request');

  // the root admin's phone: both waiting, his to decide
  ok(await until(() => store(A, m => m.getState().txs.filter(t => t.status === 'pending').length === 2)), 'the root admin\'s phone has both requests');
  await tab(A, 'الطلبات');
  const badge = await A.evaluate(() => { const b = [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الطلبات'))?.querySelector('.badge'); return b ? { n: b.textContent, quiet: b.classList.contains('quiet') } : null; });
  ok(badge?.n === '2' && !badge.quiet, 'the tab\'s badge counts both as his to act on · ' + JSON.stringify(badge));
  ok(await A.evaluate(() => document.querySelector('.requests .card.cta')?.innerText.includes('تعتمد الطلبات بنفسك')), 'with no keys yet, the page says the root admin decides');
  const cw = await card(A, 'أمل');
  ok(cw && cw.acts.some(x => x.includes('اعتماد')) && cw.acts.includes('رفض') && cw.text.includes('بصفتك مشرف العائلة'), 'the wife\'s request offers «اعتماد» and «رفض» · ' + cw?.acts.join('/'));
  ok((await card(A, 'نايف'))?.acts.length === 2, 'so does the son\'s');
  if (shots) await A.screenshot({ path: shots + '/decide-card.png' });

  // a decision signed with another key: stored by the server, counted nowhere
  const fid = t.adminLink.match(/join=([a-z0-9]+)\./)[1];
  const famKey = await A.evaluate(() => JSON.parse(localStorage.getItem('ft-family')).key);
  const st = await forgeDecide(t.base, fid, famKey, 'نايف', true);
  ok(st === 200 || st === 201, 'the server stores a forged decision (it cannot read it) · ' + st);
  await wait(4500);
  ok((await txOf(A, 'نايف'))?.status === 'pending' && (await txOf(B, 'نايف'))?.status === 'pending', 'the forged decision counts on neither phone');

  // he approves the wife: in the tree at once
  ok(await press(A, 'أمل', 'اعتماد'), 'he taps «اعتماد»');
  await wait(1800);
  let w = await txOf(A, 'أمل');
  ok(w?.status === 'approved' && w.byAdmin && w.approvals === 0, 'the request is approved, by the root admin · ' + JSON.stringify(w));
  ok(await store(A, (m, id) => m.getState().graph.marriages.some(x => x.husband === id && m.getState().graph.nodes.get(x.wife)?.name === 'أمل بنت ناصر'), me), 'the marriage is in the tree');
  // and rejects the son
  ok(await press(A, 'نايف', 'رفض'), 'he taps «رفض»');
  await wait(1800);
  const n = await txOf(A, 'نايف');
  ok(n?.status === 'rejected' && n.byAdmin, 'the son\'s request is rejected, by the root admin');
  ok(!(await store(A, (m, id) => [...m.getState().graph.nodes.values()].some(x => x.name === 'نايف' && x.father === id), me)), 'the son is not added');
  let h = await hist(A);
  ok(h.some(x => x.includes('أمل') && x.includes('اعتمده مشرف العائلة')) && h.some(x => x.includes('نايف') && x.includes('رفضه مشرف العائلة')), 'the record says who decided');
  ok(await A.evaluate(() => !document.querySelector('.tab .badge')), 'nothing left waiting');
  if (shots) { await A.evaluate(() => document.querySelector('.requests .card.hist')?.scrollIntoView({ block: 'center' })); await wait(400); await A.screenshot({ path: shots + '/decide-record.png' }); }

  // the member's phone sees the same
  await B.reload({ waitUntil: 'networkidle0' }); await wait(2500);
  w = await txOf(B, 'أمل');
  ok(w?.status === 'approved' && w.byAdmin && (await txOf(B, 'نايف'))?.status === 'rejected', 'on the member\'s phone too');
  await tab(B, 'الطلبات');
  h = await hist(B);
  ok(h.some(x => x.includes('اعتمده مشرف العائلة')) && h.some(x => x.includes('رفضه مشرف العائلة')), 'his record says the root admin decided');

  // undone directly, like any of the root admin's changes
  await store(A, (m, id) => m.proposeRevert(id), w.id); await wait(1800);
  ok(!(await store(A, (m, id) => m.getState().graph.marriages.some(x => x.husband === id), me)), '«تراجع» takes the marriage back out');
  await t.finish();
} catch (e) { await t.crash(e); }
