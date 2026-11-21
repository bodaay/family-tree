// The family log as this phone last read it, kept on the phone (IndexedDB), so
// the family opens with no connection and later fetches only what is new. It
// holds the entries exactly as the server stores them: sealed with the family
// key, which this phone already holds, so it reveals nothing the phone could
// not read anyway. It goes when the family leaves the phone. Every entry is
// checked again (signature and chain) whenever it is read back.
import type { Envelope } from '../core/log.ts';

const DB = 'ft-log';
const STORE = 'logs';

function db(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null); // no IndexedDB (a private window, blocked storage)
    }
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return db().then(
    d =>
      new Promise(resolve => {
        if (!d) return resolve(null);
        try {
          const t = d.transaction(STORE, mode);
          const req = fn(t.objectStore(STORE));
          t.oncomplete = () => {
            d.close();
            resolve(req.result ?? null);
          };
          t.onerror = t.onabort = () => {
            d.close();
            resolve(null);
          };
        } catch {
          d.close();
          resolve(null);
        }
      }),
  );
}

/** The entries kept for this family, if any. */
export async function loadLog(fid: string): Promise<Envelope[] | null> {
  const v = await run('readonly', s => s.get(fid) as IDBRequest<Envelope[] | undefined>);
  return Array.isArray(v) ? v : null;
}

/** Keeps the entries read so far (the whole list: it only grows). */
export async function saveLog(fid: string, entries: Envelope[]): Promise<void> {
  await run('readwrite', s => s.put(entries, fid));
}

/** Forgets what is kept for any family but this one (a family this phone no longer holds). */
export async function keepOnly(fid: string): Promise<void> {
  const keys = await run('readonly', s => s.getAllKeys());
  for (const k of keys ?? []) if (k !== fid) await run('readwrite', s => s.delete(k));
}

/** Forgets the entries kept for this family. */
export async function dropLog(fid: string): Promise<void> {
  await run('readwrite', s => s.delete(fid));
}
