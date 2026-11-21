// Reads a family's log with the family keys a phone holds, as anyone with that
// phone's storage could: which entries open, and whether any opened entry holds
// one of these names outside a woman's seal. Never prints keys or names.
//   FT_REPO: the worktree whose log code to use
const REPO = process.env.FT_REPO!;
const { openEntry } = await import(REPO + '/src/core/log.ts');
const { unb64, keyId } = await import(REPO + '/src/core/crypto.ts');

export async function readWith(base: string, fid: string, keys: string[], names: string[]): Promise<{ total: number; opened: number[]; leaks: number; epochAt: number }> {
  const ring = new Map<string, Uint8Array>();
  for (const k of keys) {
    try {
      const u = unb64(k);
      ring.set(keyId(u), u);
    } catch {
      /* not a key */
    }
  }
  const { entries } = (await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json()) as { entries: { kid: string; nonce: string; ct: string }[] };
  const opened: number[] = [];
  let leaks = 0;
  let epochAt = -1;
  entries.forEach((e, i) => {
    const key = ring.get(e.kid);
    if (!key) return;
    let p: { type: string };
    try {
      p = openEntry(key, e);
    } catch {
      return;
    }
    opened.push(i);
    if (p.type === 'epoch' && epochAt < 0) epochAt = i;
    const text = JSON.stringify(p);
    if (names.some(n => text.includes(n))) leaks++;
  });
  return { total: entries.length, opened, leaks, epochAt };
}
