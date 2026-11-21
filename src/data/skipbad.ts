// The replay must never stop at one entry. Entries in a shape the app does not
// write are already set aside when they are opened (core/wellformed.ts); should
// one still make the replay fail, it is left out like an entry that does not
// open, and the replay runs again without it, so every later entry still counts.

/**
 * Runs `replay` on the log; if it throws, finds the entry that makes it fail
 * (the end of the shortest start of the log that fails), leaves that one out
 * (its payload becomes null) and runs again.
 */
export function skipBad<I extends { p: unknown }, T>(items: I[], replay: (items: I[]) => T): T {
  let list = items;
  for (;;) {
    try {
      return replay(list);
    } catch (err) {
      const fails = (k: number) => {
        try {
          replay(list.slice(0, k));
          return false;
        } catch {
          return true;
        }
      };
      let lo = 1;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fails(mid)) hi = mid;
        else lo = mid + 1;
      }
      // nothing left to leave out: it is not one entry's doing
      if (!list.length || list[lo - 1].p === null) throw err;
      list = list.map((x, i) => (i === lo - 1 ? { ...x, p: null } : x));
    }
  }
}
