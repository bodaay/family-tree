// An entry signed by a device that is not linked to anyone, built with the
// integration worktree's own log code. Used by int-old-invites.mjs: a forged
// approval must be stored by the server (it cannot read it) and ignored by
// every phone. Never prints keys.
// FT_REPO: another worktree's code (as the rekey-* scripts take it)
import type { Envelope, Payload } from '../../src/core/log.ts';
const REPO = process.env.FT_REPO ?? new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { makeEntry, entryHash, openEntry } = (await import(REPO + '/src/core/log.ts')) as typeof import('../../src/core/log.ts');
const { newDeviceKey, unb64, keyId } = (await import(REPO + '/src/core/crypto.ts')) as typeof import('../../src/core/crypto.ts');

/** Approves the last proposal in the log in the name of `by`, from an unlinked device. Returns the server's status. */
export async function forgeApproval(base: string, fid: string, keyB64: string, by: string): Promise<number> {
  const key = unb64(keyB64);
  const kid = keyId(key);
  const { entries } = (await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json()) as { entries: Envelope[] };
  const ps = entries.map(e => (e.kid === kid ? openEntry(key, e) : null)) as (Payload | null)[];
  const tx = ps.filter(p => p?.type === 'propose').pop() as Extract<Payload, { type: 'propose' }> | undefined;
  if (!tx) return 0;
  const e = makeEntry(key, newDeviceKey(), entries.length, entryHash(entries[entries.length - 1]), { type: 'approve', txId: tx.tx.id, by });
  const r = await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
  return r.status;
}

/** The people given a key of that tier, in the order the root admin appointed them. */
export async function appointed(base: string, fid: string, keyB64: string, tier: string): Promise<string[]> {
  const key = unb64(keyB64);
  const kid = keyId(key);
  const { entries } = (await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json()) as { entries: Envelope[] };
  const ps = entries.map(e => (e.kid === kid ? openEntry(key, e) : null)) as (Payload | null)[];
  return ps.flatMap(p => (p?.type === 'admin' && p.act.kind === 'appoint' && p.act.tier === tier ? [p.act.holder] : []));
}
