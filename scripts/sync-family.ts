// Writes data/family/family.json from the live family: every approved change
// made in the app, in the plain format the family was created from.
//   node scripts/sync-family.ts                      the family's site (see scripts/site.ts; admin link in data/secrets/invite-live.txt)
//   node scripts/sync-family.ts --api http://localhost:8787 --link data/secrets/invite-local.txt --out x.json
// It only reads: it downloads the encrypted log and opens it here with the key
// in the root admin's link (read inside this script, never printed), and any
// attempt to write is refused. It runs the app's own code, the same replay every
// phone runs, so the file matches what the app shows.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { needSite, siteUrl } from './site.ts';
import { createServer } from 'vite';
import type { FamilyData, Marriage } from '../src/data/types.ts';
import type { RawFamily } from '../src/core/raw.ts';

const { values } = parseArgs({
  options: {
    api: { type: 'string', ...(siteUrl() ? { default: siteUrl() } : {}) },
    link: { type: 'string' },
    out: { type: 'string', default: 'data/family/family.json' },
  },
});
const api = needSite(values.api);
const local = /^http:\/\/(localhost|127\.)/.test(api);
const linkFile = path.resolve(values.link ?? `data/secrets/invite-${local ? 'local' : 'live'}.txt`);
const link = (await fs.readFile(linkFile, 'utf8')).split('\n').map(l => l.trim()).find(l => l.includes('/#join='));
if (!link) throw new Error(`no admin link in ${path.relative('.', linkFile)}`);

// just enough of a browser for the app's store: storage in memory, the link in
// the address, and requests sent to the site. Only reads go out.
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
let refused = 0;
g.fetch = (url: string, init?: RequestInit) => {
  if ((init?.method ?? 'GET') !== 'GET') {
    refused++;
    return Promise.reject(new Error('sync-family only reads'));
  }
  return realFetch(url.startsWith('/') ? api + url : url, init);
};

const vite = await createServer({ configFile: false, root: path.resolve('.'), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
const fail = async (msg: string) => {
  await vite.close();
  console.error(msg);
  process.exit(1);
};
const store = await vite.ssrLoadModule('/src/data/store.ts');
const { applyTxs } = await vite.ssrLoadModule('/src/data/graph.ts');
const { fromRaw, toRaw } = await vite.ssrLoadModule('/src/data/load.ts');

// the store opens the family from the link as it loads; wait for the replay
const until = Date.now() + 60_000;
while (!store.getState().base.family.name && Date.now() < until) await new Promise(r => setTimeout(r, 200));
const s = store.getState();
if (!s.base.family.name) await fail(`the family did not open${s.toast ? ': ' + s.toast : ''}`);
if (!s.rootAdmin) await fail('the link in that file is not the root admin link of this family');

let data: FamilyData = applyTxs(s.base, s.txs);
// after the move to per-person keys: each woman's details opened with the keys handed to the root admin
if (s.sealedEra) {
  const shut = data.people.filter(p => p.sealed && !s.opened.has(p.id)).length;
  if (shut) await fail(`${shut} women's details did not open with the root admin's keys; nothing written`);
  // and each marriage's years, sealed with the wife's key (version 1.29); a hidden marriage the
  // root admin approved is on the phone's tree, never in the family's: only the tree's marriages count
  const years = new Map<string, Marriage>(s.graph.marriages.map((m: Marriage) => [m.id, m]));
  const closed = data.marriages.filter(m => m.sealed && !years.get(m.id)?.year && !years.get(m.id)?.end).length;
  if (closed) await fail(`${closed} marriages' years did not open with the root admin's keys; nothing written`);
  const { personRecord } = await vite.ssrLoadModule('/src/data/graph.ts');
  data = {
    ...data,
    people: data.people.map(p => {
      if (!p.sealed) return p;
      const { sealed: _s, ...open } = personRecord(s.graph, p.id);
      return open;
    }),
    marriages: data.marriages.map(m => {
      if (!m.sealed) return m;
      const { sealed: _s, ...rest } = m;
      const d = years.get(m.id)!;
      return { ...rest, ...(d.year ? { year: d.year } : {}), ...(d.end ? { end: d.end } : {}) };
    }),
  };
}
const raw: RawFamily = toRaw(data);

// the file must give back exactly this family when read again
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? (v.length ? v.map(canon) : undefined)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().flatMap(k => { const x = canon((v as Record<string, unknown>)[k]); return x === undefined || x === false ? [] : [[k, x]]; }))
  : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
if (!same(fromRaw(raw), data)) await fail('internal error: the family does not survive the plain format; nothing written');

const out = path.resolve(values.out!);
const old = await fs.readFile(out, 'utf8').catch(() => null);
// people keep their place in the file (an undone removal adds a person back at
// the end of the app's list); new people go last, in the order they were added
const before = old ? new Map((JSON.parse(old) as RawFamily).people.map((p, i) => [p.id, { p, i }])) : new Map();
raw.people.sort((a, b) => (before.get(a.id)?.i ?? 1e9) - (before.get(b.id)?.i ?? 1e9));
const text = JSON.stringify(raw, null, 1);
const pending = s.txs.filter((t: { status: string }) => t.status === 'pending').length;
await vite.close();

const count = `${raw.people.length} people${raw.marriages ? `, ${raw.marriages.length} marriages` : ''}`;
const note = pending ? ` (${pending} request${pending === 1 ? '' : 's'} still awaiting approval are not in it)` : '';
if (old === text) console.log(`${path.relative('.', out)} is already up to date: ${count}${note}.`);
else {
  if (old) {
    const now = new Map(raw.people.map(p => [p.id, p]));
    const added = [...now.keys()].filter(id => !before.has(id)).length;
    const removed = [...before.keys()].filter(id => !now.has(id)).length;
    const changed = [...now.keys()].filter(id => before.has(id) && !same(before.get(id)!.p, now.get(id))).length;
    console.log(`changes: ${added} added, ${changed} changed, ${removed} removed`);
  }
  await fs.writeFile(out, text);
  console.log(`wrote ${path.relative('.', out)}: ${count}${note}.`);
}
if (refused) console.log(`(the app tried to write ${refused} time${refused === 1 ? '' : 's'}; refused, nothing was sent)`);
process.exit(0);
