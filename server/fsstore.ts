// Stores each log entry as a numbered file: data/server/<family>/log/000123.json,
// and the family's write key (if one is registered) in data/server/<family>/write-key.json.
// "Create only if absent" writes make two simultaneous submissions safe:
// one gets the number, the other retries with the next.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Envelope } from '../src/core/log.ts';
import type { Store } from './handler.ts';

export function fileStore(root: string): Store {
  const dir = (fid: string) => path.join(root, fid, 'log');
  const file = (fid: string, n: number) => path.join(dir(fid), String(n).padStart(6, '0') + '.json');
  const wkFile = (fid: string) => path.join(root, fid, 'write-key.json');

  async function get(fid: string, n: number): Promise<Envelope | null> {
    try {
      return JSON.parse(await fs.readFile(file(fid, n), 'utf8')) as Envelope;
    } catch {
      return null;
    }
  }
  async function writeKey(fid: string): Promise<string | null> {
    try {
      return (JSON.parse(await fs.readFile(wkFile(fid), 'utf8')) as { wk: string }).wk;
    } catch {
      return null;
    }
  }
  // one write at a time per family, so the write key checked is the one in force when the entry lands
  const queues = new Map<string, Promise<unknown>>();
  function locked<T>(fid: string, fn: () => Promise<T>): Promise<T> {
    const run = (queues.get(fid) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    queues.set(fid, tail);
    void tail.then(() => queues.get(fid) === tail && queues.delete(fid));
    return run;
  }

  return {
    async read(fid, after) {
      let names: string[] = [];
      try {
        names = await fs.readdir(dir(fid));
      } catch {
        return { entries: [], wk: null };
      }
      const ns = names.map(f => parseInt(f, 10)).filter(n => Number.isInteger(n) && n > after).sort((a, b) => a - b);
      const entries = await Promise.all(ns.map(async n => JSON.parse(await fs.readFile(file(fid, n), 'utf8')) as Envelope));
      return { entries, wk: await writeKey(fid) };
    },
    async tip(fid, n) {
      return { prev: n > 0 ? await get(fid, n - 1) : null, admin: (await get(fid, 0))?.pub ?? null, wk: await writeKey(fid) };
    },
    putIfAbsent(fid, e, write) {
      return locked(fid, async () => {
        if (write && (await writeKey(fid)) !== write.wk) return false;
        await fs.mkdir(dir(fid), { recursive: true });
        try {
          await fs.writeFile(file(fid, e.n), JSON.stringify(e), { flag: 'wx' });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
          throw err;
        }
        if (write?.next) {
          // replaced whole (write, then rename), never half written; `n` names the entry that set it.
          // Should the server stop between the entry and this file, the old key stays in force
          // until the root admin's phone notices and registers the right one.
          const tmp = wkFile(fid) + '.tmp';
          await fs.writeFile(tmp, JSON.stringify({ wk: write.next, n: e.n }));
          await fs.rename(tmp, wkFile(fid));
        }
        return true;
      });
    },
  };
}
