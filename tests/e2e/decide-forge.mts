// A root admin's decision ("decide") signed by a device that is not the root
// admin's, built with the worktree's own log code. Used by decide.mjs: the
// server stores it (it cannot read it) and every phone ignores it. Never prints keys.
// FT_REPO: the worktree whose code builds the entry
import type { Envelope, Payload } from '../../src/core/log.ts';
const REPO = process.env.FT_REPO ?? new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { makeEntry, entryHash, openEntry } = (await import(REPO + '/src/core/log.ts')) as typeof import('../../src/core/log.ts');
const { newDeviceKey, unb64, keyId } = (await import(REPO + '/src/core/crypto.ts')) as typeof import('../../src/core/crypto.ts');

/** Approves (ok) or rejects the proposal whose title includes `title`, from a device that is not the root admin's. Returns the server's status. */
export async function forgeDecide(base: string, fid: string, keyB64: string, title: string, ok: boolean): Promise<number> {
  const key = unb64(keyB64);
  const kid = keyId(key);
  const { entries } = (await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json()) as { entries: Envelope[] };
  const ps = entries.map(e => (e.kid === kid ? openEntry(key, e) : null)) as (Payload | null)[];
  const tx = ps.filter(p => p?.type === 'propose' && p.tx.title.includes(title)).pop() as Extract<Payload, { type: 'propose' }> | undefined;
  if (!tx) return 0;
  const e = makeEntry(key, newDeviceKey(), entries.length, entryHash(entries[entries.length - 1]), { type: 'admin', act: { kind: 'decide', txId: tx.tx.id, ok }, by: null });
  const r = await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
  return r.status;
}

/** Sets how far women's details are seen, in the name of `by`, from a device that is neither the root admin's nor anyone's. Returns the server's status. */
export async function forgeReach(base: string, fid: string, keyB64: string, deg: number | null, by: string | null): Promise<number> {
  const key = unb64(keyB64);
  const { entries } = (await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json()) as { entries: Envelope[] };
  const e = makeEntry(key, newDeviceKey(), entries.length, entryHash(entries[entries.length - 1]), { type: 'setting', act: { kind: 'reach', deg }, by } as Payload);
  const r = await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) });
  return r.status;
}
