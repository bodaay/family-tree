// Fix check: a member's recovery kit carries no waiting invites, and a kit whose
// backup key was removed is refused before the phone changes (secrev-kit-invite).
//   node fix-kit-invite.mjs <BASE url> <admin-link file>
// B joins on B1, starts «إضافة جهاز» (never used), then makes a recovery kit.
// Opened outside the app with its passphrase, the kit holds no invite secret.
// B removes «مفتاح الاستعادة»; the key is renewed. On a new phone the kit now
// says it no longer works, and leaves the phone as it was (no family, no device
// key written). The root admin's kit still carries his waiting invites.
import zlib from 'node:zlib';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { gcm } from '@noble/ciphers/aes.js';
import {
  check, run, wait, until, phone, join, click, tab, ready, rootAdmin, invite, addChild, fresh, people,
  myDevices, deviceButton, addDeviceLink, keyVersions, meName, store, C$, copyLink,
} from './multidev-lib.mjs';

async function makeKit(p) {
  await tab(p, 'أنا');
  await click(p, 'مفتاح الاستعادة', '.card.cta');
  const words = await p.evaluate(() => [...document.querySelectorAll('.modal.kit .words span')].map(s => s.lastChild.textContent.trim()).join(' '));
  await p.evaluate(() => document.querySelector('.modal.kit .opt input').click());
  await wait(200);
  await click(p, 'إنشاء المفتاح');
  await p.waitForFunction(() => [...document.querySelectorAll('.modal.kit button')].some(b => b.textContent.trim() === 'نسخ'), { timeout: 30000 });
  await p.evaluate(() => { window.__copied = null; });
  await click(p, 'نسخ', '.modal.kit button');
  const link = await p.evaluate(() => window.__copied);
  await click(p, 'إغلاق', '.mhead button');
  await wait(1000);
  return { link, words };
}
function normPass(p) {
  return p.normalize('NFKC').replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/[ىیي]/g, 'ي').replace(/ة/g, 'ه').replace(/ک/g, 'ك')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0)).toLowerCase().replace(/\s+/g, ' ').trim();
}
async function openKitOutside(link, pass) {
  const all0 = C$.unb64(link.match(/restore=([A-Za-z0-9_-]+)/)[1]);
  const all = all0.subarray(0, all0.length - 4);
  const head = all.subarray(0, 36);
  const cost = { t: head[2], p: head[3], m: new DataView(head.buffer, head.byteOffset).getUint32(4) };
  const key = await argon2idAsync(new TextEncoder().encode(normPass(pass)), head.subarray(8, 24), { ...cost, dkLen: 32 });
  let body = gcm(key, head.subarray(24, 36), head).decrypt(all.subarray(36));
  if (head[1] & 1) body = zlib.inflateRawSync(body);
  return JSON.parse(new TextDecoder().decode(body));
}

await run(async () => {
  const A = await rootAdmin();
  const b = await invite(A, 'محمد', [await meName(A)]);
  const B1 = await join('B1', b.link);
  const who = await meName(B1);
  check(await ready(B1), 'B joined', who);
  const spare = await addDeviceLink(B1);
  check(!!spare, 'B1 started «إضافة جهاز» (the invite is never used)');
  const kit = await makeKit(B1);
  check(/#restore=/.test(kit.link ?? ''), 'B made a recovery kit');
  const opened = await openKitOutside(kit.link, kit.words);
  check(Object.keys(opened.i ?? {}).length === 0, 'the member\'s kit, opened outside the app, carries no invite secret', Object.keys(opened.i ?? {}).length);
  check(!!opened.b && !!opened.m?.key, 'it carries his backup key and the family keys, as before');

  const v0 = await keyVersions();
  await until(async () => (await myDevices(B1)).some(d => d.name === 'مفتاح الاستعادة'));
  check(await deviceButton(B1, 'مفتاح الاستعادة', 'إزالة'), 'B removes «مفتاح الاستعادة» from أجهزتي');
  check(!!(await until(async () => (await keyVersions()) > v0, 25000)), 'the root admin\'s phone renewed the family key');
  const n0 = await people(A);
  await addChild(A, fresh('بعدالإبطال'), true);
  check(!!(await until(async () => (await people(B1)) === n0 + 1)), 'B1 reads what is added after the renewal');

  // the kit on a new phone: refused before anything is written there
  const R = await phone('R', kit.link);
  await R.type('.join .bigin', kit.words, { delay: 5 });
  await click(R, 'استعادة', '.join button');
  await R.waitForFunction(() => !!document.querySelector('.join .warnbox') || !!document.querySelector('.tabs') || /انتهى/.test(document.querySelector('.join h2')?.innerText ?? ''), { timeout: 40000 });
  await wait(800);
  const said = await R.evaluate(() => document.querySelector('.join .warnbox')?.innerText ?? document.querySelector('.join h2')?.innerText ?? '');
  check(said.includes('لم يعد مفتاح الاستعادة هذا يعمل'), 'the new phone says the kit no longer works (not «انتهى دخولك»)', said);
  check(!(await store(R, 'ft-family')) && !(await store(R, 'ft-device')), 'and nothing was written on it: no family, no device key');
  check(!(await R.evaluate(() => localStorage.getItem('ft-ended'))), 'nor an ended family to explain');

  // the root admin's kit still carries his waiting invites, to share them again
  const c = await invite(A, 'عبدالله', [await meName(A), who]);
  check(!!c.link, 'the root admin has an invite waiting');
  const akit = await makeKit(A);
  const aopen = await openKitOutside(akit.link, akit.words);
  check(Object.keys(aopen.i ?? {}).length >= 1 && !!aopen.m?.admin, 'the root admin\'s kit carries the admin key and his waiting invites', Object.keys(aopen.i ?? {}).length);
});
