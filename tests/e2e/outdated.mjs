// The move to per-person keys while some phones still have a page open from the
// version before it (design document 1.27). Every phone first runs the old app;
// the root admin's phone updates and makes the move; a member's page and a
// second page of the root admin's stay on the old version. Phones share one
// address through outdated-proxy.mjs, which serves each page the version it asks for.
//   GATE=1: the server refuses entries from an older version once a newer one
//           has written (version 1.27): nothing of the old pages gets in.
//   GATE=0: today's server (1.26): what the old pages write gets in.
//   GATE=1|0 FT_REPO=<worktree> node outdated.mjs BASE admin-link-file
import { setup, click, wait } from './mar-lib.mjs';
const { readWith } = await import('./pkeys-read.mts');
const { typesWith } = await import('./outdated-read.mts');
const GATE = process.env.GATE === '1';
const t = setup();
const { ok } = t;
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
let browser;
/** A phone running one version of the app; it keeps it until it reloads with the other. */
const phone = async (name, link, app) => {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setExtraHTTPHeaders({ 'x-ft-test-app': app });
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => t.errs.push(name + ': ' + e.message));
  page.on('console', m => m.type() === 'error' && t.errs.push(name + ': ' + m.text()));
  page.on('dialog', d => d.accept());
  await page.goto(link, { waitUntil: 'networkidle0' });
  await wait(1800);
  return page;
};
const update = async p => {
  await p.setExtraHTTPHeaders({ 'x-ft-test-app': 'new' });
  await p.reload({ waitUntil: 'networkidle0' });
  await wait(2500);
};
const isNew = p => store(p, m => 'sealedEra' in m.getState());
const logLength = async fid => (await (await fetch(`${t.base}/api/f/${fid}/log?after=-1`)).json()).entries.length;
const toast = p => p.evaluate(() => document.querySelector('.toast')?.innerText ?? '');
try {
  browser = await t.launch();
  // before the update: the root admin (two pages: phone and laptop) and B, all on the old app
  const A = await phone('A', t.adminLink, 'old');
  await click(A, 'تصفّح أولًا', 'button', 500);
  const A2 = await phone('A2', t.adminLink, 'old');
  await click(A2, 'تصفّح أولًا', 'button', 500);
  const fid = await A.evaluate(() => JSON.parse(localStorage.getItem('ft-family')).fid);
  const B = await phone('B', await invite(A, 'مشاري', 1985), 'old');
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'B joins, on the old app');
  ok(!(await isNew(A)) && !(await isNew(A2)) && !(await isNew(B)), 'every page runs the old app');
  const bMe = await store(B, m => m.getState().me);
  const P = await mod(A, '/src/data/kinship.ts', (K, me) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => {
    const g = S.getState().graph;
    const men = [...g.nodes.values()].filter(n => n.sex === 'm').map(n => n.name);
    const fine = n => n.name.length >= 3 && !men.some(m => m.includes(n.name));
    const women = [...g.nodes.values()].filter(n => n.sex === 'f' && !n.familyRoot && !n.external && fine(n));
    const deg = id => K.kin(g, me, id)?.deg ?? 99;
    const far = women.filter(n => deg(n.id) >= 6).slice(0, 6);
    const c = [...g.nodes.values()].find(n => n.sex === 'm' && !n.dead && n.birth && n.id !== me && n.branch === g.nodes.get(me).branch && deg(n.id) >= 5 && !g.marriages.some(x => x.husband === n.id));
    return { far: far.map(n => n.id), farNames: far.map(n => n.name), c: c?.id, cName: c?.name, cYear: c?.birth?.v };
  }), bMe);
  ok(P.far.length >= 3 && P.c, `women far from B (${P.far.length}), and a man to invite after the move`);

  // the root admin's phone updates and makes the move; A2 and B keep their open pages
  await update(A);
  ok(await isNew(A), "the root admin's phone runs the new app");
  await tab(A, 'الإدارة');
  await A.evaluate(() => [...document.querySelectorAll('.page.admin h3')].find(x => x.textContent.includes('مفاتيح النساء'))?.scrollIntoView({ block: 'start' }));
  await click(A, 'الانتقال إلى مفاتيح النساء', 'button', 500);
  ok(await until(() => store(A, m => m.getState().sealedEra), 60000), 'the move is made');
  const aKeys = await keysOf(A);
  const types0 = await typesWith(t.base, fid, aKeys);
  const epochAt = types0.indexOf('epoch');
  ok(epochAt > 0, `the log holds the move · snapshot at entry ${epochAt}`);

  // the old pages read the move as an ordinary renewal of the family key
  for (const p of [A2, B]) await store(p, m => m.sync()).catch(() => {});
  await wait(6000);
  for (const p of [A2, B]) await store(p, m => m.sync()).catch(() => {});
  await wait(4000);
  ok(!(await isNew(A2)) && !(await isNew(B)), 'A2 and B still run the old app');
  const bOld = await store(B, (m, far) => { const s = m.getState(); return { has: !!s.me && s.graph.nodes.size > 0, names: far.map(id => s.graph.nodes.get(id)?.name ?? null) }; }, P.far);
  ok(bOld.has && (await B.evaluate(() => !!document.querySelector('.tabs, .tab'))), "B's old page keeps working: no error, the tree still there");
  ok(bOld.names.join() === P.farNames.join(), "it still shows what it read before the move, women far from B too (nothing takes that back from an open page)");
  const types1 = await typesWith(t.base, fid, aKeys);
  const carried = types1.slice(epochAt).filter(x => x === 'keys').length;
  if (GATE) ok(carried === 0, "the root admin's old page could not hand the earlier keys on: refused by the server");
  else ok(carried > 0, `today: the root admin's old page hands every earlier key on under the new one, unasked · ${carried} entry`);

  // B, on the old page, adds a daughter
  const n0 = await logLength(fid);
  await store(B, (m, me) => m.addChildTx(me, { name: 'ابنة_قديمة', sex: 'f' }, false, null), bMe).catch(() => {});
  await wait(5000);
  const n1 = await logLength(fid);
  const bToast = await toast(B);
  if (GATE) {
    ok(n1 === n0, `B's old page cannot write: refused · «${bToast}»`);
  } else {
    ok(n1 > n0, 'today: B\'s old page writes the daughter, her name in the open');
    ok(!(await store(A, m => m.getState().txs.some(t => t.title.includes('ابنة_قديمة')))), 'updated phones refuse it: it never shows');
  }
  const curKey = await A.evaluate(() => JSON.parse(localStorage.getItem('ft-family')).key);
  const plain = await readWith(t.base, fid, [curKey], ['ابنة_قديمة']);
  if (GATE) ok(plain.leaks === 0, 'her name is nowhere in the log');
  else ok(plain.leaks > 0, 'and her name stays in the log, readable with the current family key');

  // C joins after the move
  const C = await phone('C', await invite(A, P.cName, P.cYear), 'new');
  ok(await click(C, 'نعم، أنا', '.join button', 2000), 'C joins after the move, on the new app');
  await until(() => store(C, m => m.getState().sealedEra), 30000);
  await wait(3000);
  const cRead = await readWith(t.base, fid, await keysOf(C), [...P.farNames, 'ابنة_قديمة']);
  const before = cRead.opened.filter(i => i < epochAt).length;
  if (GATE) {
    ok(before === 0, `C's keys open nothing before the move · ${cRead.opened.length} of ${cRead.total} entries`);
    ok(cRead.leaks === 0, "and no entry they open holds a woman's name outside her seal");
  } else {
    ok(before > 0, `today: C's keys open the entries before the move too · ${before} of them`);
    ok(cRead.leaks > 0, `so C reads the names the move sealed · ${cRead.leaks} entries`);
  }

  // B reloads: the new app, and writing works again
  await update(B);
  ok(await isNew(B), "B's phone reloads to the new app");
  ok(await until(() => store(B, m => m.getState().sealedEra), 20000), 'and has the move');
  const m0 = await logLength(fid);
  ok(await store(B, (m, me) => !!m.addChildTx(me, { name: 'ابنة_بعد', sex: 'f' }, false, null), bMe), 'B asks to add a daughter');
  ok(await until(async () => (await logLength(fid)) > m0), 'and it is written');
  ok(await until(() => store(A, m => m.getState().txs.some(t => t.ops.some(o => o.op === 'addPerson' && o.person.sex === 'f' && o.person.name === '' && o.person.sealed)))), 'sealed, as the move intends');

  // old pages report the refused writes as failed requests: expected with the version check
  const refused = t.errs.filter(e => /status of 426/.test(e));
  console.log(`note: ${refused.length} writes refused (${[...new Set(refused.map(e => e.split(':')[0]))].join(', ') || 'none'})`);
  if (GATE) t.errs.splice(0, t.errs.length, ...t.errs.filter(e => !/status of 426/.test(e)));
  await t.finish();
} catch (e) { await t.crash(e); }
