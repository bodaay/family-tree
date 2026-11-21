// Fix check: a phone refuses a server that serves an older log (secrev-rollback).
//   FT_DATA=<the API server's data dir> FT_REPO=<worktree> API_PORT=<port> node fix-rollback.mjs <BASE url> <admin-link file>
// Run it on its own (not through run.sh): it stops the API server on API_PORT
// (default 8809) and serves a forked copy of the log from this process, as a
// server operator could (or a restore from an old backup).
// 1. B and C join. The root admin unlinks C's phone; the key is renewed; C's
//    phone forgets the family. C kept a copy of what his phone stored.
// 2. The "server" now serves the log as it was before the unlink, with the
//    write key of that time, and takes new entries on top of it.
// 3. B's phone, which had learned the new key, reloads: it says the server's log
//    is older than what it has read, keeps the new key, and writes nothing.
// The script stops the API server on API_PORT; start it again afterwards.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';
import {
  check, run, wait, until, join, click, tab, ready, ended, rootAdmin, invite, keysOf, fetchLog, keyVersions, opensAfter, meName, fid, store, addChild, fresh, openProfile, permButton, closeApp, forge,
} from './multidev-lib.mjs';

const DATA = process.env.FT_DATA;
const PORT = Number(process.env.API_PORT ?? 8809);
const repo = process.env.FT_REPO;
if (!DATA || !repo) {
  console.log('FAIL set FT_DATA and FT_REPO');
  process.exit(2);
}
const { handleApi } = await import(path.join(repo, 'server/handler.ts'));
const { fileStore } = await import(path.join(repo, 'server/fsstore.ts'));

await run(async () => {
  const A = await rootAdmin();
  const used = [await meName(A)];
  const b = await invite(A, 'محمد', used);
  const B1 = await join('B1', b.link);
  used.push(await meName(B1));
  const c = await invite(A, 'عبدالله', used);
  const C1 = await join('C1', c.link);
  const cName = await meName(C1);
  check((await ready(B1)) && (await ready(C1)), 'B and C joined');
  const cKeys = await keysOf(C1);
  const before = (await fetchLog()).length;
  const v0 = await keyVersions();

  // the root admin unlinks C's phone from C's profile («الصلاحيات» → «فصل الجهاز»); the key is renewed
  check(await openProfile(A, cName), 'the root admin opens C\'s profile');
  check(await permButton(A, '', 'فصل الجهاز'), 'and taps «فصل الجهاز»');
  check(!!(await until(async () => (await keyVersions()) > v0, 20000)), 'the root admin unlinked C\'s phone and the key was renewed');
  check(!!(await until(() => ended(C1), 15000)), 'C\'s phone forgets the family');
  await addChild(A, fresh('بعدالفصل'), true);
  const real = await fetchLog();
  const renewedAt = real.findIndex(e => e.kid === real.at(-1).kid) - 1;
  const o1 = await opensAfter(cKeys.m, [cKeys.d.sk], renewedAt);
  check(o1.opened === 0, `C's old copy opens none of the ${o1.later} entries written after the renewal`, JSON.stringify(o1));
  // the root admin's app is closed from here on (it would only keep failing to write on the fork)
  await closeApp(A);
  const bKeyBefore = (await store(B1, 'ft-family')).key;

  // the operator forks: the log before the unlink, with the write key in force then
  const fork = path.join(DATA, '..', 'fork-' + Date.now());
  fs.mkdirSync(path.join(fork, fid, 'log'), { recursive: true });
  let wk = null;
  for (const e of real.slice(0, before)) {
    fs.writeFileSync(path.join(fork, fid, 'log', String(e.n).padStart(6, '0') + '.json'), JSON.stringify(e));
    if (e.nw) wk = e.nw;
  }
  if (wk) fs.writeFileSync(path.join(fork, fid, 'write-key.json'), JSON.stringify({ wk }));
  try {
    execSync(`lsof -ti tcp:${PORT} | xargs kill`);
  } catch {
    /* not running */
  }
  await wait(800);
  const st = fileStore(fork);
  const srv = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const url = `http://${req.headers.host ?? 'localhost'}${req.url}`;
    const r = await handleApi(new Request(url, { method: req.method, headers: req.headers, body: chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined }), st);
    res.writeHead(r?.status ?? 404, Object.fromEntries(r?.headers ?? []));
    res.end(Buffer.from(r ? await r.arrayBuffer() : new ArrayBuffer(0)));
  });
  await new Promise(r => srv.listen(PORT, r));

  // B's phone opens again: it refuses the older log, keeps the new key and writes nothing
  await B1.reload({ waitUntil: 'networkidle0' });
  await until(() => B1.evaluate(() => /تعذّر فتح سجل العائلة/.test(document.querySelector('.join h2')?.innerText ?? '')), 20000);
  const said = await B1.evaluate(() => document.querySelector('.join')?.innerText ?? '');
  check(said.includes('أقدم مما قرأه هذا الجهاز'), 'B\'s phone refuses the log: older than what it has read', said.slice(0, 120));
  const bm = await store(B1, 'ft-family');
  check(bm.key === bKeyBefore, 'and keeps the newer key as the key new links carry');
  check(!!bm.seen && bm.seen.n >= real.length, 'it remembers how far it read the log', JSON.stringify(bm.seen?.n));
  await wait(4000);
  const forked = await fetchLog();
  check(forked.length === before, 'nothing was written to the forked log', forked.length + ' vs ' + before);
  // a fork that grows past what B had read, with other entries (C still holds the old key and its write key): refused too
  while ((await fetchLog()).length <= real.length) {
    if ((await forge(cKeys.m, cKeys.d, [cKeys.d.sk], { type: 'keys', keys: {} })) !== 201) break;
  }
  check((await fetchLog()).length > real.length, 'the fork grows past the length B had read, with other entries');
  await B1.reload({ waitUntil: 'networkidle0' });
  await until(() => B1.evaluate(() => /تعذّر فتح سجل العائلة/.test(document.querySelector('.join h2')?.innerText ?? '')), 20000);
  check((await B1.evaluate(() => document.querySelector('.join')?.innerText ?? '')).includes('أقدم مما قرأه هذا الجهاز أو يختلف عنه'), 'B\'s phone refuses that log too (it differs from what it read)');
  check((await store(B1, 'ft-family')).key === bKeyBefore, 'still with the newer key');
  await new Promise(r => srv.close(r));

  // the real log is served again: B's phone opens as before
  const real2 = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const url = `http://${req.headers.host ?? 'localhost'}${req.url}`;
    const r = await handleApi(new Request(url, { method: req.method, headers: req.headers, body: chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined }), fileStore(DATA));
    res.writeHead(r?.status ?? 404, Object.fromEntries(r?.headers ?? []));
    res.end(Buffer.from(r ? await r.arrayBuffer() : new ArrayBuffer(0)));
  });
  await new Promise(r => real2.listen(PORT, r));
  await B1.reload({ waitUntil: 'networkidle0' });
  check(!!(await until(() => ready(B1), 20000)), 'with the real log back, B\'s phone opens the family again');
  await new Promise(r => real2.close(r));
});
