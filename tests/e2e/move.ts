// Makes the move to per-person keys for women's details on a LOCAL server only
// (a test family, or a rehearsal on a copy of the live log), as the root admin's
// phone does from «الإدارة». Never prints keys or links; refuses any other server.
//   node tests/e2e/move.ts --api http://localhost:5210 --link <folder>/data/secrets/invite-local.txt  (from the repo root)
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';

const { values } = parseArgs({ options: { api: { type: 'string' }, link: { type: 'string' } } });
const api = (values.api ?? '').replace(/\/+$/, '');
if (!/^http:\/\/(localhost|127\.)/.test(api)) throw new Error('only a local server');
const linkFile = path.resolve(values.link ?? 'data/secrets/invite-local.txt');
const link = (await fs.readFile(linkFile, 'utf8')).split('\n').map(l => l.trim()).find(l => l.includes('/#join='));
if (!link) throw new Error(`no admin link in ${path.relative('.', linkFile)}`);

// just enough of a browser for the app's store: storage in memory, the link in the address
const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  clear: () => mem.clear(),
  get length() {
    return mem.size;
  },
};
g.location = { hash: link.slice(link.indexOf('#')), pathname: '/', origin: api, href: api + '/' };
g.history = { replaceState() {} };
g.document = { hidden: true, addEventListener() {}, removeEventListener() {} };
g.window = globalThis;
g.addEventListener = () => {};
const realFetch = globalThis.fetch;
g.fetch = (url: string, init?: RequestInit) => realFetch(url.startsWith('/') ? api + url : url, init);

const vite = await createServer({ configFile: false, root: path.resolve('.'), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
const store = await vite.ssrLoadModule('/src/data/store.ts');
const until = Date.now() + 60_000;
while (!store.getState().base.family.name && Date.now() < until) await new Promise(r => setTimeout(r, 200));
const s0 = store.getState();
if (!s0.rootAdmin) {
  console.error('not the root admin link of this family');
  process.exit(1);
}
if (s0.sealedEra) {
  console.log('already moved');
  await vite.close();
  process.exit(0);
}
const t0 = Date.now();
const ok = await store.moveToPersonKeys();
const s = store.getState();
console.log(ok && s.sealedEra ? `moved: ${s.opened.size} women sealed, in ${((Date.now() - t0) / 1000).toFixed(1)} s` : 'the move failed: ' + (s.toast ?? ''));
await vite.close();
process.exit(ok ? 0 : 1);
