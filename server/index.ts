// Node entry point: serves the API and, when built, the app itself.
//   node server/index.ts            (port 8787, data in data/server)
//
// The same server can run a family's own site (README, "Deploying it"), behind a
// reverse proxy that gives it HTTPS:
//   PORT, HOST        where it listens (default 8787 on every interface; HOST=127.0.0.1 behind a proxy)
//   FT_DATA           where the logs are kept (default data/server)
//   FT_DIST           the built app (default dist, from npm run build)
//   CREATE_TOKEN      the secret that starting a family needs (as on Cloudflare);
//                     unset, anyone who reaches the server can start one: fine on
//                     this Mac, never on a public address
// The security headers in the build's _headers file (public/_headers, written for
// Cloudflare) are sent here too.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { handleApi, sameSecret } from './handler.ts';
import { fileStore } from './fsstore.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST || undefined;
const store = fileStore(path.resolve(process.env.FT_DATA ?? 'data/server'));
const DIST = path.resolve(process.env.FT_DIST ?? 'dist');
const TOKEN = process.env.CREATE_TOKEN || '';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};

/** The rules of a Cloudflare-style _headers file: a path (a trailing * matches the rest), then its indented headers. */
export function parseHeaders(text: string): { path: string; headers: [string, string][] }[] {
  const rules: { path: string; headers: [string, string][] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: [] });
    else if (rules.length) {
      const at = line.indexOf(':');
      if (at > 0) rules.at(-1)!.headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
    }
  }
  return rules;
}

let rules: ReturnType<typeof parseHeaders> | null = null;
async function headersFor(pathname: string): Promise<[string, string][]> {
  rules ??= parseHeaders(await fs.readFile(path.join(DIST, '_headers'), 'utf8').catch(() => ''));
  return rules.filter(r => (r.path.endsWith('*') ? pathname.startsWith(r.path.slice(0, -1)) : pathname === r.path)).flatMap(r => r.headers);
}

async function serveStatic(pathname: string): Promise<Response> {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let f = path.join(DIST, safe);
  if (!f.startsWith(DIST) || path.basename(f) === '_headers') f = path.join(DIST, 'index.html');
  try {
    if ((await fs.stat(f)).isDirectory()) f = path.join(f, 'index.html');
  } catch {
    f = path.join(DIST, 'index.html'); // single-page app
  }
  try {
    const body = await fs.readFile(f);
    const headers = new Headers({ 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
    for (const [k, v] of await headersFor(pathname)) headers.set(k, v);
    return new Response(body, { headers });
  } catch {
    return new Response('Build the app first: npm run build', { status: 404 });
  }
}

const mayCreate = TOKEN ? (r: Request) => sameSecret(r.headers.get('authorization') ?? '', 'Bearer ' + TOKEN) : undefined;

http
  .createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const url = `http://${req.headers.host ?? 'localhost'}${req.url}`;
      const body = chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body });
      const response = (await handleApi(request, store, { mayCreate })) ?? (await serveStatic(new URL(url).pathname));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error(err);
      res.writeHead(500).end('server error');
    }
  })
  .listen(PORT, HOST, () => {
    console.log(`Family tree server on http://${HOST ?? 'localhost'}:${PORT}`);
    if (!TOKEN && HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('  (no CREATE_TOKEN: anyone who reaches this server can start a family on it)');
  });
