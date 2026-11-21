// The move on a slow connection (design document 1.27): the snapshot (about
// 400 KB for the family) takes seconds to upload, and the phone syncs meanwhile.
// On the live site that wrote the snapshot twice, each sealing every woman with
// keys of its own, the second also one key version too far. FIXED=1 expects
// one snapshot and the right version; FIXED=0 expects the double, and checks
// that phones still settle on the last one: a member from before opens the
// women within reach, a member invited after opens his and nothing earlier.
//   FIXED=1|0 FT_REPO=<worktree> node double.mjs BASE admin-link-file
import { setup, click, wait } from './mar-lib.mjs';
const { readWith } = await import('./pkeys-read.mts');
const { typesWith } = await import('./outdated-read.mts');
const FIXED = process.env.FIXED === '1';
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
  await click(A, 'تصفّح أولًا', 'button', 500);
  const fid = await A.evaluate(() => JSON.parse(localStorage.getItem('ft-family')).fid);
  const B = await t.phone('B', await invite(A, 'مشاري', 1985));
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'B joins before the move');
  const bMe = await store(B, m => m.getState().me);
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
  const v0 = await store(A, m => m.getState().familyKey.version);
  // a change before the move, so there is history to keep
  ok(await store(B, (m, me) => !!m.addChildTx(me, { name: 'ابن_قبل', sex: 'm' }, false, null), bMe), 'B asks to add a son, before the move');
  ok(await until(() => store(A, m => m.getState().txs.some(t => t.title.includes('ابن_قبل') && t.status === 'pending'))), 'it waits on the root admin\'s phone');
  await store(A, m => m.approve(m.getState().txs.find(t => t.title.includes('ابن_قبل')).id)); await wait(1500);
  ok(await until(() => store(B, m => m.getState().txs.some(t => t.title.includes('ابن_قبل') && t.status === 'approved'))), 'and is approved');

  // the move, uploading slowly; the phone syncs as soon as the renewal is in
  const n0 = (await (await fetch(`${t.base}/api/f/${fid}/log?after=-1`)).json()).entries.length;
  const cdp = await A.target().createCDPSession();
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 4e6, uploadThroughput: 50e3 });
  await tab(A, 'الإدارة');
  await A.evaluate(() => [...document.querySelectorAll('.page.admin h3')].find(x => x.textContent.includes('مفاتيح النساء'))?.scrollIntoView({ block: 'start' }));
  await click(A, 'الانتقال إلى مفاتيح النساء', 'button', 100);
  const rekeyIn = await until(async () => (await (await fetch(`${t.base}/api/f/${fid}/log?after=-1`)).json()).entries.length > n0, 30000);
  ok(rekeyIn, 'the renewal is in; the snapshot still uploading');
  void store(A, m => m.sync()).catch(() => {});
  ok(await until(() => store(A, m => m.getState().sealedEra), 90000), 'the move is made');
  await wait(15000);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await store(A, m => m.sync()).catch(() => {});
  await wait(3000);
  const types = await typesWith(t.base, fid, await A.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); return [m.key, ...Object.values(m.keys ?? {})]; }));
  const epochs = types.filter(x => x === 'epoch').length;
  const v1 = await store(A, m => m.getState().familyKey.version);
  if (FIXED) {
    ok(epochs === 1, `one snapshot · ${epochs}`);
    ok(v1 === v0 + 1, `the key version goes on by one · ${v0} → ${v1}`);
  } else {
    ok(epochs === 2, `as on the live site: two snapshots · ${epochs}`);
    ok(v1 === v0 + 2, `and the version one too far · ${v0} → ${v1}`);
  }
  const a1 = await holds(A, [...P.near, ...P.far]);
  ok(a1.opened === P.women && a1.of.map(x => x.name).join() === [...P.nearNames, ...P.farNames].join(), `the root admin opens every woman, with her name · ${a1.opened} of ${P.women}`);
  await store(B, m => m.sync()).catch(() => {});
  ok(await until(() => holds(B, []).then(x => x.era)), "B's phone has the move");
  await wait(2000);
  const b1 = await holds(B, [...P.near, ...P.far]);
  ok(b1.of.slice(0, P.near.length).every((x, i) => x.opened && x.name === P.nearNames[i]), 'B opens the women near him, with their names');
  ok(b1.of.slice(P.near.length).every(x => !x.opened && x.name === ''), 'and not those far from him');
  ok(b1.before > 0, `B keeps the history before the move · ${b1.before}`);
  ok(await store(B, m => !m.getState().movedDiffers), "B's phone finds the snapshot agrees with its own reading");
  const C = await t.phone('C', await invite(A, P.cName, P.cYear));
  ok(await click(C, 'نعم، أنا', '.join button', 2000), 'C joins after the move');
  ok(await until(() => holds(C, []).then(x => x.era && x.opened > 0), 30000), "C's phone opens the women handed to it");
  const cKeys = await C.evaluate(() => { const m = JSON.parse(localStorage.getItem('ft-family')); return [m.key, ...Object.values(m.keys ?? {})]; });
  const read = await readWith(t.base, fid, cKeys, [...P.nearNames, ...P.farNames]);
  ok(read.epochAt > 0 && read.opened.every(i => i >= read.epochAt) && read.leaks === 0, `C's keys open nothing before the move, and no name outside a seal · ${read.opened.length} of ${read.total}`);
  await t.finish();
} catch (e) { await t.crash(e); }
