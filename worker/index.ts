// Cloudflare entry point: the same API as server/index.ts. Each family's log lives
// in its own Durable Object, which handles one request at a time and keeps the
// entries in SQLite. The app's files are served as static assets; only /api/*
// reaches this code.
import { DurableObject } from 'cloudflare:workers';
import { handleApi, sameSecret, type Store } from '../server/handler.ts';
import type { Envelope } from '../src/core/log.ts';

interface Env {
  LOGS: DurableObjectNamespace<FamilyLog>;
  ASSETS: Fetcher;
  /** Secret that allows starting a family. Unset: nobody can. */
  CREATE_TOKEN?: string;
}

export class FamilyLog extends DurableObject<Env> {
  /** Reading never creates storage, so looking up an unknown family costs nothing. */
  private has(table: 'log' | 'meta'): boolean {
    return this.ctx.storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", table).toArray().length > 0;
  }

  private get(n: number): Envelope | null {
    if (!this.has('log')) return null;
    const [r] = this.ctx.storage.sql.exec<{ e: string }>('SELECT e FROM log WHERE n = ?', n).toArray();
    return r ? (JSON.parse(r.e) as Envelope) : null;
  }

  /** The write key new entries must be signed with; null until the root admin registers one (the meta table appears then). */
  private writeKey(): string | null {
    if (!this.has('meta')) return null;
    const [r] = this.ctx.storage.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'wk'").toArray();
    return r?.v ?? null;
  }

  read(after: number): { entries: Envelope[]; wk: string | null } {
    if (!this.has('log')) return { entries: [], wk: null };
    const entries = this.ctx.storage.sql
      .exec<{ e: string }>('SELECT e FROM log WHERE n > ? ORDER BY n', after)
      .toArray()
      .map(r => JSON.parse(r.e) as Envelope);
    return { entries, wk: this.writeKey() };
  }

  tip(n: number): { prev: Envelope | null; admin: string | null; wk: string | null } {
    return { prev: n > 0 ? this.get(n - 1) : null, admin: this.get(0)?.pub ?? null, wk: this.writeKey() };
  }

  /** The entry and a new write key are stored together, or neither is. */
  putIfAbsent(e: Envelope, write?: { wk: string | null; next?: string }): boolean {
    const sql = this.ctx.storage.sql;
    return this.ctx.storage.transactionSync(() => {
      if (write && this.writeKey() !== write.wk) return false;
      sql.exec('CREATE TABLE IF NOT EXISTS log (n INTEGER PRIMARY KEY, e TEXT NOT NULL)');
      if (sql.exec('INSERT INTO log (n, e) VALUES (?, ?) ON CONFLICT (n) DO NOTHING', e.n, JSON.stringify(e)).rowsWritten === 0) return false;
      if (write?.next) {
        sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
        sql.exec("INSERT INTO meta (k, v) VALUES ('wk', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", write.next);
      }
      return true;
    });
  }
}

export default {
  async fetch(req, env) {
    const log = (fid: string) => env.LOGS.getByName(fid);
    const store: Store = {
      read: (fid, after) => log(fid).read(after),
      tip: (fid, n) => log(fid).tip(n),
      putIfAbsent: (fid, e, write) => log(fid).putIfAbsent(e, write),
    };
    const mayCreate = (r: Request) => !!env.CREATE_TOKEN && sameSecret(r.headers.get('authorization') ?? '', 'Bearer ' + env.CREATE_TOKEN);
    return (await handleApi(req, store, { mayCreate })) ?? env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
