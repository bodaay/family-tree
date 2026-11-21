// The type of each entry of a family's log, as phones holding these keys open it
// (null where they cannot). Never prints keys or contents.
//   FT_REPO: the worktree whose log code to use
const REPO = process.env.FT_REPO!;
const { openEntry } = await import(REPO + '/src/core/log.ts');
const { unb64, keyId } = await import(REPO + '/src/core/crypto.ts');

export async function typesWith(base: string, fid: string, keys: string[]): Promise<(string | null)[]> {
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
  return entries.map(e => {
    const key = ring.get(e.kid);
    if (!key) return null;
    try {
      return (openEntry(key, e) as { type: string }).type;
    } catch {
      return null;
    }
  });
}
