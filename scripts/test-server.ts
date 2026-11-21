// Checks the Node server as a family's own site would run it:
//   node scripts/test-server.ts
// Starts server/index.ts twice on this Mac, with a small build of its own: with
// CREATE_TOKEN set, starting a family needs it (as on Cloudflare); without it,
// anyone may (this Mac's default). The security headers of public/_headers are
// sent with the app's files, and nothing outside the build is served.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bytesToHex, newDeviceKey, newFamilyKey, randomBytes } from '../src/core/crypto.ts';
import { makeEntry } from '../src/core/log.ts';
import type { RawFamily } from '../src/core/raw.ts';

let failed = 0;
const ok = (cond: unknown, what: string) => {
  console.log(cond ? 'PASS' : 'FAIL', what);
  if (!cond) failed++;
};

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-server-'));
const dist = path.join(tmp, 'dist');
await fs.mkdir(path.join(dist, 'assets'), { recursive: true });
await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
await fs.writeFile(path.join(dist, 'assets', 'a.js'), 'export {}');
await fs.copyFile('public/_headers', path.join(dist, '_headers'));

const family: RawFamily = { family: { name: 'آل تجربة' }, root: { id: 'root', name: 'سالم', sex: 'm' }, people: [{ id: 'p1', name: 'سعد', sex: 'm', parent: 'root' }] };
const seed = () => makeEntry(newFamilyKey(), newDeviceKey(), 0, '', { type: 'seed', family });
const TOKEN = 'a-test-token-' + bytesToHex(randomBytes(8));

async function start(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['server/index.ts'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', FT_DATA: path.join(tmp, 'data' + port), FT_DIST: dist, CREATE_TOKEN: '', ...env },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return child;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  throw new Error('the server did not start');
}
const put = (port: number, auth?: string) =>
  fetch(`http://127.0.0.1:${port}/api/f/${bytesToHex(randomBytes(6))}/log/0`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(seed()),
  }).then(r => r.status);

const a = await start(8791, { CREATE_TOKEN: TOKEN });
const b = await start(8792, {});
try {
  ok((await put(8791)) === 403, 'with CREATE_TOKEN: a family cannot be started without it');
  ok((await put(8791, 'Bearer wrong-' + TOKEN)) === 403, 'nor with another token');
  ok((await put(8791, 'Bearer ' + TOKEN)) === 201, 'and can with it');
  ok((await put(8792)) === 201, 'without CREATE_TOKEN (this Mac): anyone may');

  const home = await fetch('http://127.0.0.1:8791/');
  const csp = home.headers.get('content-security-policy') ?? '';
  ok(home.status === 200 && csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"), 'the page carries the security policy of public/_headers');
  ok(home.headers.get('x-content-type-options') === 'nosniff' && home.headers.get('referrer-policy') === 'no-referrer', 'and the other security headers');
  const js = await fetch('http://127.0.0.1:8791/assets/a.js');
  ok(js.headers.get('content-type') === 'text/javascript' && (js.headers.get('cache-control') ?? '').includes('immutable'), 'built files are kept by browsers for good');
  const hdr = await (await fetch('http://127.0.0.1:8791/_headers')).text();
  ok(!hdr.includes('Content-Security-Policy'), 'the _headers file itself is not served');
  const up = await (await fetch('http://127.0.0.1:8791/%2e%2e/%2e%2e/package.json')).text();
  ok(!up.includes('"dependencies"'), 'nothing outside the build is served');
  const api = await fetch('http://127.0.0.1:8791/api/f/abcdef/log?after=-1');
  ok(api.headers.get('cache-control') === 'no-store', 'the API is never cached');
} finally {
  a.kill();
  b.kill();
  await fs.rm(tmp, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
