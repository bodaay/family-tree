// Puts a family's log back on a server from the copy scripts/backup-log.ts keeps,
// entry by entry in order, exactly as they were: the server checks each one as
// it would any new entry (its signature, its link to the one before, the write
// key), so a copy that was tampered with is refused, and nothing can be added
// that the family did not write. For a server that lost the log, or a new home.
//   node scripts/restore-log.ts --to https://new.example                    (from data/family/log.json)
//   node scripts/restore-log.ts --to http://localhost:8787 --from x.json
// A server that already has some of the log goes on from where it stops, after
// checking that what it has is the start of the copy. Starting a family on a
// server that asks for its token (Cloudflare) needs --token-file (default
// data/secrets/create-token; read here, never printed).
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { entryHash, type Envelope } from '../src/core/log.ts';

const { values } = parseArgs({
  options: {
    to: { type: 'string' },
    from: { type: 'string', default: 'data/family/log.json' },
    'token-file': { type: 'string', default: 'data/secrets/create-token' },
  },
});
if (!values.to) throw new Error('--to: the server to put the log on');
const api = values.to.replace(/\/+$/, '');
const copy = JSON.parse(await fs.readFile(path.resolve(values.from!), 'utf8')) as { family: string; entries: Envelope[] };
const fid = copy.family;

const r = await fetch(`${api}/api/f/${fid}/log?after=-1`, { cache: 'no-store' });
if (!r.ok) throw new Error(`server ${r.status}`);
const there = ((await r.json()) as { entries: Envelope[] }).entries;
for (const [i, e] of there.entries()) {
  if (!copy.entries[i] || entryHash(e) !== entryHash(copy.entries[i])) {
    console.error(`The server already holds a different log for this family (from entry ${i}). Nothing was written.`);
    process.exit(1);
  }
}
if (there.length >= copy.entries.length) {
  console.log(`The server already holds all ${there.length} entries.`);
  process.exit(0);
}

let token = '';
if (!there.length) token = (await fs.readFile(path.resolve(values['token-file']!), 'utf8').catch(() => '')).trim();
for (const e of copy.entries.slice(there.length)) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (e.n === 0 && token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(`${api}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers, body: JSON.stringify(e) });
  if (res.status !== 201) {
    console.error(`Entry ${e.n} was refused (${res.status}: ${(await res.text()).slice(0, 120)}). ${e.n} of ${copy.entries.length} entries are on the server.`);
    process.exit(1);
  }
}
console.log(`Put back ${copy.entries.length - there.length} entries; the server holds all ${copy.entries.length}.`);
