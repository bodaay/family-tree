// Creates an encrypted family log from data/family/family.json.
//   node scripts/init-family.ts                                  local server (data/server)
//   node scripts/init-family.ts --remote https://your-family.example  the family's site
// The key that signs the first entry is the family's root admin key. The links
// are written to data/secrets (never printed): the family key, and in the admin
// link the admin key, travel only inside the link's "#" part, which browsers
// never send to any server.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { renderSVG } from 'uqr';
import { b64, newDeviceKey, newFamilyKey, randomBytes, bytesToHex } from '../src/core/crypto.ts';
import { makeEntry } from '../src/core/log.ts';
import type { RawFamily } from '../src/core/raw.ts';
import { fileStore } from '../server/fsstore.ts';

const { values, positionals } = parseArgs({ options: { remote: { type: 'string' } }, allowPositionals: true });
const remote = values.remote?.replace(/\/+$/, '');
const src = path.resolve(positionals[0] ?? 'data/family/family.json');
const secrets = path.resolve('data/secrets');
await fs.mkdir(secrets, { recursive: true, mode: 0o700 });

const family = JSON.parse(await fs.readFile(src, 'utf8')) as RawFamily;
const fid = bytesToHex(randomBytes(6));
const key = newFamilyKey();
const admin = newDeviceKey();
const seed = makeEntry(key, admin, 0, '', { type: 'seed', family });

let hosts: string[];
if (remote) {
  // starting a family on the live site needs the token set with `wrangler secret put CREATE_TOKEN`
  const token = (await fs.readFile(path.join(secrets, 'create-token'), 'utf8')).trim();
  const r = await fetch(`${remote}/api/f/${fid}/log/0`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(seed),
  });
  if (r.status !== 201) throw new Error(`the site refused the family: ${r.status} ${await r.text()}`);
  hosts = [remote];
} else {
  const store = fileStore(path.resolve(process.env.FT_DATA ?? 'data/server'));
  if (!(await store.putIfAbsent(fid, seed))) throw new Error('family id already taken');
  const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
  hosts = ['http://localhost:5173', lan ? `http://${lan}:5173` : null].filter((h): h is string => !!h);
}

// Only the root admin's link: everyone else joins through a personal invite
// that the root admin makes in the app (الإدارة → الأعضاء والدعوات).
const join = `#join=${fid}.${b64(key)}`;
const links = hosts.map(h => ['Admin link (root admin: only for you)', `${h}/${join}.${admin.sk}`]);
const name = remote ? 'live' : 'local';
await fs.writeFile(path.join(secrets, `invite-${name}.txt`), links.map(([label, url]) => `${label}\n${url}\n`).join('\n'), { mode: 0o600 });

// a page to scan from the phone's camera; phones need a reachable address, not localhost
const phone = links.filter(([, url]) => !url.startsWith('http://localhost'));
const card = ([label, url]: string[]) => `<figure><figcaption>${label}</figcaption>${renderSVG(url, { border: 2 })}</figure>`;
const page = `<!doctype html><meta charset="utf-8"><title>Family invite</title>
<style>body{font:16px system-ui;margin:24px;background:#fff;color:#111}figure{display:inline-block;margin:0 32px 32px 0;vertical-align:top}svg{width:300px;height:300px}figcaption{font-weight:600;margin-bottom:8px}p{max-width:640px;color:#555}</style>
<h1>${family.family.name}: open on your phone</h1>
<p>Scan with the phone's camera${remote ? '' : ' while it is on the same Wi-Fi as this Mac'}. This code makes that phone the family's root admin: scan it only on your own phone, then close this page and keep it private. Invite everyone else from the app.</p>
${phone.map(card).join('\n')}`;
await fs.writeFile(path.join(secrets, `invite-${name}.html`), page, { mode: 0o600 });

console.log(`Family "${family.family.name}" created${remote ? ' on ' + remote : ''}: ${family.people.length} people, id ${fid}.`);
console.log('The server holds only encrypted data.');
console.log(`Links saved to data/secrets/invite-${name}.txt; phone QR codes in data/secrets/invite-${name}.html (both private).`);
