// The move to per-person keys for women's details (design document 1.25, Section 6).
// Before it every phone holds every woman's name; the root admin moves once from
// «الإدارة» (a waiting invite is cancelled: its link carries the old key). After:
// the root admin opens every woman's details; a member from before keeps the
// history before the move and opens only the women within the family's reach of
// him; a member invited after reads nothing before the move, and the log as his
// keys open it holds no woman's name outside her seal. A daughter added after
// the move goes in sealed: named in titles only where her key is.
//   FT_REPO=<worktree> node pkeys.mjs BASE admin-link-file [shots-dir]
import { setup, click, wait } from './mar-lib.mjs';
const { readWith } = await import('./pkeys-read.mts');
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
// what a phone holds of these women: opened (with her key), and the name its tree carries
const holds = (p, ids) => store(p, (m, ids) => { const s = m.getState(); return { era: s.sealedEra, before: s.before.length, opened: s.opened.size, of: ids.map(id => ({ id, opened: s.opened.has(id), name: s.graph.nodes.get(id)?.name ?? null, shown: m.nameOf(s, id) })) }; }, ids);
try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await click(A, 'تصفّح أولًا', 'button', 500);
  const fid = await A.evaluate(() => JSON.parse(localStorage.getItem('ft-family')).fid);

  // B joins before the move
  const B = await t.phone('B', await invite(A, 'مشاري', 1985));
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'B joins before the move');
  const bMe = await store(B, m => m.getState().me);
  // women near B (within the 3rd degree) and far from him, with names no man carries; and C, a man to invite
  const P = await mod(A, '/src/data/kinship.ts', (K, me) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts')).then(S => {
    const g = S.getState().graph;
    const men = [...g.nodes.values()].filter(n => n.sex === 'm').map(n => n.name);
    const ok = n => n.name.length >= 3 && !men.some(m => m.includes(n.name));
    const women = [...g.nodes.values()].filter(n => n.sex === 'f' && !n.familyRoot && !n.external && ok(n));
    const deg = id => K.kin(g, me, id)?.deg ?? 99;
    const near = women.filter(n => deg(n.id) <= 3).slice(0, 3);
    const far = women.filter(n => deg(n.id) >= 6).slice(0, 6);
    const c = [...g.nodes.values()].find(n => n.sex === 'm' && !n.dead && n.birth && n.id !== me && n.branch === g.nodes.get(me).branch && deg(n.id) >= 5 && !g.marriages.some(x => x.husband === n.id));
    return { near: near.map(n => n.id), nearNames: near.map(n => n.name), far: far.map(n => n.id), farNames: far.map(n => n.name), c: c?.id, cName: c?.name, cYear: c?.birth?.v, women: [...g.nodes.values()].filter(n => n.sex === 'f' && !n.familyRoot).length };
  }), bMe);
  ok(P.near.length && P.far.length >= 3 && P.c, `women near B (${P.near.length}) and far (${P.far.length}), and a man to invite`);

  // before: B's phone holds every woman's name, and C's invite waits
  let b0 = await holds(B, P.far);
  ok(!b0.era && b0.of.every((x, i) => x.name === P.farNames[i]), 'before the move, B\'s phone holds the names of women far from him');
  await invite(A, P.cName, P.cYear);
  // a change before the move: B asks for a son, the root admin approves it
  ok(await store(B, (m, me) => !!m.addChildTx(me, { name: 'ابن_قبل', sex: 'm' }, false, null), bMe), 'B asks to add a son, before the move');
  ok(await until(() => store(A, m => m.getState().txs.some(t => t.title.includes('ابن_قبل') && t.status === 'pending'))), 'it waits on the root admin\'s phone');
  await store(A, m => m.approve(m.getState().txs.find(t => t.title.includes('ابن_قبل')).id)); await wait(1500);
  ok(await until(() => store(B, m => m.getState().txs.some(t => t.title.includes('ابن_قبل') && t.status === 'approved'))), 'and is approved');

  // the move, from «الإدارة»
  await tab(A, 'الإدارة');
  const sec = await A.evaluate(() => { const h = [...document.querySelectorAll('.page.admin h3')].find(x => x.textContent.includes('مفاتيح النساء')); h?.scrollIntoView({ block: 'start' }); return h?.closest('section')?.innerText ?? ''; });
  ok(sec.includes('الانتقال إلى مفاتيح النساء') && sec.includes('دعوات تنتظر'), 'the root admin sees the move, and that a waiting invite will be cancelled');
  if (shots) await A.screenshot({ path: shots + '/pkeys-before.png' });
  await click(A, 'الانتقال إلى مفاتيح النساء', 'button', 500);
  ok(await until(() => store(A, m => m.getState().sealedEra), 60000), 'the move is made');
  const a1 = await holds(A, [...P.near, ...P.far]);
  ok(a1.opened === P.women && a1.of.every(x => x.opened), `the root admin opens every woman's details · ${a1.opened} of ${P.women}`);
  ok(a1.of.map(x => x.name).join() === [...P.nearNames, ...P.farNames].join(), 'with the same names as before');
  if (shots) { await tab(A, 'الإدارة'); await A.evaluate(() => [...document.querySelectorAll('.page.admin h3')].find(x => x.textContent.includes('مفاتيح النساء'))?.scrollIntoView({ block: 'start' })); await wait(300); await A.screenshot({ path: shots + '/pkeys-after.png' }); }

  // B, from before: the history before the move; only the women within reach of him
  ok(await until(() => holds(B, []).then(x => x.era)), 'B\'s phone has the move');
  const b1 = await holds(B, [...P.near, ...P.far]);
  const nearB = b1.of.slice(0, P.near.length), farB = b1.of.slice(P.near.length);
  ok(nearB.every((x, i) => x.opened && x.name === P.nearNames[i]), 'B opens the women near him, with their names');
  ok(farB.every(x => !x.opened && x.name === '' && x.shown !== '' && !P.farNames.includes(x.shown)), 'and not those far from him: no name in his tree · ' + farB.map(x => x.shown).join('، '));
  ok(b1.before > 0, `B keeps the history before the move · ${b1.before} changes`);

  // C's waiting invite was cancelled; the root admin invites him again from the list
  ok(await store(A, (m, c) => m.getState().invites.filter(i => i.person === c).every(i => i.status === 'revoked'), P.c), 'C\'s waiting invite was cancelled');
  await tab(A, 'الإدارة');
  ok(await A.evaluate(c => { const h = [...document.querySelectorAll('.page.admin h3')].find(x => x.textContent.includes('مفاتيح النساء')); const row = [...(h?.closest('section')?.querySelectorAll('.prow') ?? [])].find(r => r.innerText.includes('دعوة جديدة')); row?.click(); return !!row; }), 'the list offers C a new invite');
  await wait(1800);
  const link2 = await lastLink(A);
  await A.evaluate(() => [...document.querySelectorAll('.mhead button')].find(b => b.textContent.includes('إغلاق'))?.click());
  const C = await t.phone('C', link2);
  ok(await click(C, 'نعم، أنا', '.join button', 2000), 'C joins after the move');
  ok(await until(() => holds(C, []).then(x => x.era && x.opened > 0), 30000), 'C\'s phone has the women\'s keys handed to it');
  const c1 = await holds(C, P.far);
  ok(c1.before === 0, 'C reads no change from before the move');
  const cKeys = await C.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); return [m.key, ...Object.values(m.keys ?? {})]; });
  const read = await readWith(t.base, fid, cKeys, [...P.nearNames, ...P.farNames]);
  ok(read.epochAt > 0 && read.opened.every(i => i >= read.epochAt), `C's keys open nothing before the move · ${read.opened.length} of ${read.total} entries, from ${read.epochAt}`);
  ok(read.leaks === 0, 'and no entry they open holds a woman\'s name outside her seal');

  // after the move: B adds a daughter; she goes in sealed
  ok(await store(B, (m, me) => !!m.addChildTx(me, { name: 'ابنة_مختومة', sex: 'f' }, false, null), bMe), 'B asks to add a daughter');
  ok(await until(() => store(A, m => m.getState().txs.some(t => t.ops.some(o => o.op === 'addPerson' && o.person.sex === 'f' && o.person.name === '' && o.person.sealed)))), 'her record goes in with an empty name and her seal');
  const titles = await store(A, async m => { const H = await import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/history.ts')); const s = m.getState(); const tx = s.txs.find(t => t.ops.some(o => o.op === 'addPerson' && o.person.sex === 'f' && o.person.name === '')); return { raw: tx.title, shown: H.titleOf(s, tx) }; });
  ok(!titles.raw.includes('ابنة_مختومة') && titles.shown.includes('ابنة_مختومة'), 'its title carries her mark, and the root admin reads her name in it · ' + titles.shown);
  const after = await readWith(t.base, fid, cKeys, ['ابنة_مختومة']);
  ok(after.leaks === 0, 'C\'s keys find her name nowhere in the log');
  await t.finish();
} catch (e) { await t.crash(e); }
