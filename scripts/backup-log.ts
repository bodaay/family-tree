// Keeps a copy of the family log in data/family/log.json: every entry exactly as
// the server stores it, sealed with the family key, so the copy reveals nothing
// the server does not already hold. It is the log itself (the database), so the
// family can be put back on a new server from it (scripts/restore-log.ts), not a
// summary like family.json.
//   node scripts/backup-log.ts                      the family's site (see scripts/site.ts; its family from data/secrets/invite-live.txt)
//   node scripts/backup-log.ts --api http://localhost:8787 --link data/secrets/invite-local.txt --out x.json
// It only reads, and needs only the family's id from the link (read here, never
// printed): no key. Each entry's signature and its link to the one before are
// checked; a log that no longer starts with what was saved before (rewritten,
// or shorter) is refused and the saved copy is left as it was. Run again, it
// adds only what is new.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { needSite, siteUrl } from './site.ts';
import { checkEntry, entryHash, type Envelope } from '../src/core/log.ts';
import { backupText } from '../src/core/backupfile.ts';

const { values } = parseArgs({
  options: {
    api: { type: 'string', ...(siteUrl() ? { default: siteUrl() } : {}) },
    link: { type: 'string' },
    out: { type: 'string', default: 'data/family/log.json' },
  },
});
const api = needSite(values.api);
const local = /^http:\/\/(localhost|127\.)/.test(api);
const linkFile = path.resolve(values.link ?? `data/secrets/invite-${local ? 'local' : 'live'}.txt`);
const fid = (await fs.readFile(linkFile, 'utf8')).match(/#join=([a-z0-9]{6,40})\./)?.[1];
if (!fid) throw new Error(`no family link in ${path.relative('.', linkFile)}`);
const out = path.resolve(values.out!);

export interface Backup {
  /** The family's id on the server. */
  family: string;
  /** When the copy was last brought up to date. */
  saved: string;
  entries: Envelope[];
}

/** The entries in order, each signed and linked to the one before; why not, if not. */
function chainProblem(entries: Envelope[]): string | null {
  let prev = '';
  for (const [i, e] of entries.entries()) {
    if (e.n !== i) return `entry ${i}: out of place`;
    const bad = checkEntry(e, prev);
    if (bad) return `entry ${i}: ${bad}`;
    prev = entryHash(e);
  }
  return null;
}

let saved: Backup | null = null;
try {
  saved = JSON.parse(await fs.readFile(out, 'utf8')) as Backup;
} catch {
  /* the first copy */
}
if (saved && saved.family !== fid) throw new Error(`${path.relative('.', out)} is a copy of another family`);
const have = saved?.entries ?? [];
const bad = chainProblem(have);
if (bad) throw new Error(`the saved copy is damaged (${bad}); left as it is`);

// only what is newer than the copy, then the copy's last entry checked against the server's
const r = await fetch(`${api}/api/f/${fid}/log?after=${have.length - 1}`, { cache: 'no-store' });
if (!r.ok) throw new Error(`server ${r.status}`);
const { entries } = (await r.json()) as { entries: Envelope[] };
if (have.length) {
  const check = await fetch(`${api}/api/f/${fid}/log?after=${have.length - 2}`, { cache: 'no-store' });
  const tip = ((await check.json()) as { entries: Envelope[] }).entries[0];
  if (!tip || entryHash(tip) !== entryHash(have[have.length - 1])) {
    console.error('The log on the server no longer starts with the saved copy (rewritten, or shorter). Nothing was changed; tell the family\'s root admin.');
    process.exit(1);
  }
}
const all = [...have, ...entries];
const problem = chainProblem(all);
if (problem) {
  console.error(`The log on the server does not check out (${problem}). Nothing was changed.`);
  process.exit(1);
}
if (!entries.length && saved) {
  console.log(`${path.relative('.', out)} is already up to date: ${all.length} entries.`);
  process.exit(0);
}
const body = backupText(fid, all);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out + '.tmp', body);
await fs.rename(out + '.tmp', out);
console.log(`wrote ${path.relative('.', out)}: ${all.length} entries (${entries.length} new), ${(body.length / 1024).toFixed(0)} KB.`);
