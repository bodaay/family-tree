// The app's version 4 (design document 1.30): a page of the version live today
// (3) and an updated one, on one family. The old page writes as before until an
// updated one has written (an export); then the server refuses it and it says to
// update, while it still reads the family. The updated page writes on.
//   OLD_BASE=… NEW_BASE=… node gate4.mjs <any BASE> admin-link-file
import { setup, wait } from './mar-lib.mjs';
import fs from 'node:fs';
const t = setup();
const { ok } = t;
const raw = fs.readFileSync(process.argv[3], 'utf8').split('\n').find(l => l.includes('#join=')).trim();
const hash = raw.slice(raw.indexOf('/#join='));
const mod = (p, path, fn, arg) => p.evaluate((path, src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === path) ?? path).then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), path, fn.toString(), arg);
const store = (p, fn, arg) => mod(p, '/src/data/store.ts', fn, arg);
const until = async (fn, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(500)) if (await fn().catch(() => false)) return true;
  return false;
};
const toastNow = p => p.evaluate(() => [...document.querySelectorAll('.toast')].map(x => x.textContent).join(' '));
try {
  await t.launch();
  const O = await t.phone('old', process.env.OLD_BASE + hash);
  const N = await t.phone('new', process.env.NEW_BASE + hash);
  ok(await store(O, m => m.getState().status === 'ready'), 'the old page opens the family');
  ok(await store(N, m => m.getState().status === 'ready'), 'so does the updated one');
  // before any updated write: the old page writes as before
  await store(O, m => m.setReach(4));
  ok(await until(() => store(N, m => m.getState().reach === 4)), 'the old page writes (a setting), the updated one reads it');
  // the updated page exports
  const code = await store(N, m => m.recordExport({ from: m.getState().graph.root, kind: 'down', mode: 'poster', paper: 'A3', sheets: 1, women: 'daughter', years: true }));
  ok(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(code ?? ''), 'the updated page records an export: ' + code);
  ok(await until(() => store(O, m => m.getState().entries === undefined || m.getState().status === 'ready')), 'the old page still reads the family after it');
  await wait(4000);
  // now the old page is refused, and told to update
  await store(O, m => m.setReach(5));
  let said = '';
  ok(await until(async () => /صدر إصدار أحدث من التطبيق/.test((said = await toastNow(O))), 15000), 'the old page is told to update: ' + said);
  await wait(3000);
  ok(await store(N, m => m.getState().reach === 4), 'and what it tried did not get in');
  // the updated page writes on
  await store(N, m => m.setReach(5));
  ok(await until(() => store(N, m => m.getState().reach === 5)), 'the updated page writes on');
} catch (e) {
  ok(false, 'threw: ' + (e?.stack ?? e));
}
await t.finish();
