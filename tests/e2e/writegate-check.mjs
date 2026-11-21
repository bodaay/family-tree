// After another script, on the family it left behind (run.sh name+): the write
// check held all along.
//   node writegate-check.mjs <BASE url> <admin-link file>
// The log verifies; replaying the server's rule over it gives the write key the
// server holds; that key is the write key of a version of the family key the
// root admin holds (not one someone moved it to); and an entry sealed with any
// older version is refused now. Prints PASS/FAIL lines; exits non-zero on any
// failure. Never prints links or keys.
import fs from 'node:fs';
import path from 'node:path';

const [BASE, LINKFILE] = process.argv.slice(2);
if (!BASE || !LINKFILE) {
  console.log('usage: node writegate-check.mjs <BASE url> <admin-link file>');
  process.exit(2);
}
const base = BASE.replace(/\/+$/, '');
const repo = process.env.FT_REPO ?? path.resolve(path.dirname(path.resolve(LINKFILE)), '../..');
const L$ = await import(path.join(repo, 'src/core/log.ts'));
const C$ = await import(path.join(repo, 'src/core/crypto.ts'));
const K$ = await import(path.join(repo, 'src/core/keyring.ts'));
const { writeCheck } = await import(path.join(repo, 'server/handler.ts'));

const line = fs.readFileSync(LINKFILE, 'utf8').split('\n').find(l => /^https?:\/\/localhost[:/]/.test(l));
const m = line.match(/join=([a-z0-9]+)\.([A-Za-z0-9_-]+)\.([0-9a-f]{64})/);
const [fid, key0, adminSk] = [m[1], m[2], m[3]];

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' - ' + detail : ''}`);
  return ok;
};

const { entries, wk } = await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json();
let prev = '';
check(`the log verifies (${entries.length} entries)`, entries.every(e => { const ok = !L$.checkEntry(e, prev); prev = L$.entryHash(e); return ok; }));
check('the root admin registered a write key', typeof wk === 'string');

// the server's rule, replayed over what it stored
let sim = null;
let refused = 0;
for (const e of entries.slice(1)) {
  const r = writeCheck(e, entries[0].pub, sim);
  if (typeof r === 'string') refused++;
  else if (r.next) sim = r.next;
}
check('every stored entry passed the write check when it was stored', refused === 0, String(refused));
check('the write key the server holds is the one its rule leads to', sim === wk);

// every version of the family key: the root admin is handed each one
const ring = new Map();
K$.addKeys(ring, [key0]);
K$.openLog(entries, [], ring, [adminSk]);
const writeKeys = new Map([...ring].map(([kid, k]) => [C$.writeKeyOf(k).pk, kid]));
check(`it is the write key of a version of the family key (${ring.size} known to the root admin)`, writeKeys.has(wk));
const current = writeKeys.get(wk);
const older = [...ring.keys()].filter(kid => kid !== current);
let refusedOld = 0;
for (const kid of older) {
  const e = L$.makeEntry(ring.get(kid), C$.newDeviceKey(), entries.length, L$.entryHash(entries.at(-1)), { type: 'keys', keys: {} });
  const r = await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
  if (r.status === 403) refusedOld++;
}
check(`an entry sealed with an older version (${older.length}) is refused`, refusedOld === older.length, `${refusedOld}/${older.length}`);
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
