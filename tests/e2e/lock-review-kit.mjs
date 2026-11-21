// Review: what a recovery link can and cannot do.
// - Kits crafted outside the app (right format, right passphrase) whose content
//   is malformed are refused as damaged, and nothing is written: a family id
//   that would point the app at another server path, a bad device key.
// - A device key in a kit is taken from its secret, never from the kit's word.
// - A raised cost in the header (checksum recomputed) is refused before any work.
// - The suggested words always satisfy the passphrase rule (the button is never
//   left disabled with no reason).
// - After «جهاز جديد», the kit (a backup key of its own) still brings him back;
//   once the root admin takes the backup key away, it no longer does.
// - A member's kit restored on the root admin's own phone keeps the admin key.
//   node lock-review-kit.mjs <BASE url> <admin-link file>
import { argon2id } from '@noble/hashes/argon2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { BASE, adminLink, phone, click, pick, check, wait, text, meName, openMe, openAdmin, lastInvite, run } from './locklib.mjs';

const b64 = u8 => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
const PASS = 'شمس قمر نجم هلال';
/** A kit in the app's format (version 1, not deflated), sealed with PASS at a cheap cost. */
function craft(kit, { t = 1, m = 8 * 1024, tamper } = {}) {
  const head = new Uint8Array(36);
  head[0] = 1;
  head[1] = 0;
  head[2] = t;
  head[3] = 1;
  new DataView(head.buffer).setUint32(4, m);
  head.set(randomBytes(16), 8);
  head.set(randomBytes(12), 24);
  const key = argon2id(utf8ToBytes(PASS), head.subarray(8, 24), { t, m, p: 1, dkLen: 32 });
  const ct = gcm(key, head.subarray(24, 36), head).encrypt(utf8ToBytes(JSON.stringify(kit)));
  const all = new Uint8Array(36 + ct.length + 4);
  all.set(head);
  all.set(ct, 36);
  tamper?.(all);
  all.set(sha256(all.subarray(0, all.length - 4)).subarray(0, 4), all.length - 4);
  return b64(all);
}
const newKey = () => {
  const sk = ed25519.utils.randomSecretKey();
  return { sk: bytesToHex(sk), pk: bytesToHex(ed25519.getPublicKey(sk)) };
};

/** Opens a restore link on a fresh phone, types the passphrase; returns the message shown or 'opened'. */
async function tryRestore(name, blob, pass = PASS, setup, auth = null) {
  const p = await phone(name, null, auth);
  if (setup) {
    await setup(p);
    await p.goto('about:blank'); // a new document, not just a new "#" on the same page
  }
  const paths = [];
  p.on('request', r => paths.push(new URL(r.url()).pathname));
  await p.goto(BASE + '/#restore=' + blob, { waitUntil: 'networkidle0' });
  await wait(800);
  await p.type('.join .bigin', pass, { delay: 2 });
  await click(p, 'استعادة', '.join button');
  await p.waitForFunction(() => !!document.querySelector('.join .warnbox') || !!document.querySelector('.tabs') || /انتهى|تعذّر/.test(document.querySelector('.join h2')?.innerText ?? ''), { timeout: 30000 });
  await wait(1200);
  const warn = await text(p, '.join .warnbox');
  return { p, paths, said: warn || ((await p.evaluate(() => !!document.querySelector('.tabs'))) ? 'opened' : await text(p, '.join h2')) };
}

await run(async () => {
  // the real family's link, read from inside a phone that opened it (never printed)
  const A = await phone('A', adminLink);
  await click(A, 'تصفّح');
  const real = await A.evaluate(() => JSON.parse(localStorage.getItem('ft-family')));

  // 1. a well-sealed kit whose family id would send the app to another path on the server
  {
    const blob = craft({ v: 2, m: { fid: '../../admin', key: real.key }, d: newKey(), i: {} });
    const { p, paths, said } = await tryRestore('F1', blob);
    check(said.includes('ناقص أو تالف'), 'kit with a malformed family id is refused as damaged', said);
    check(await p.evaluate(() => !localStorage.getItem('ft-family') && !localStorage.getItem('ft-device')), 'nothing written from a malformed kit');
    check(paths.every(x => !x.includes('admin') && !x.includes('..')), 'no request to a crafted path', paths.join(' '));
  }
  // 2. a bad device secret, and invites that are not keys
  {
    const blob = craft({ v: 2, m: { fid: real.fid, key: real.key }, d: { sk: 'zz', pk: 'x' }, i: {} });
    check((await tryRestore('F2', blob)).said.includes('ناقص أو تالف'), 'kit with a malformed device key is refused');
    const blob2 = craft({ v: 2, m: { fid: real.fid, key: real.key }, d: newKey(), i: { '<b>': 'x' } });
    check((await tryRestore('F3', blob2)).said.includes('ناقص أو تالف'), 'kit with malformed saved invites is refused');
    // (feat/multidevice) a backup key that is not a key, and the older kit format (one shared device key)
    const blob3 = craft({ v: 2, m: { fid: real.fid, key: real.key }, b: 'zz', i: {} });
    check((await tryRestore('F3b', blob3)).said.includes('ناقص أو تالف'), 'kit with a malformed backup key is refused');
    const blob4 = craft({ v: 1, m: { fid: real.fid, key: real.key }, d: newKey(), i: {} });
    check((await tryRestore('F3c', blob4)).said.includes('ناقص أو تالف'), 'a kit in the earlier format is refused');
  }
  // 3. the device key comes from its secret, not from what the kit claims
  {
    const k = newKey();
    const blob = craft({ v: 2, m: { fid: real.fid, key: real.key }, d: { sk: k.sk, pk: newKey().pk }, i: {} });
    const { p } = await tryRestore('F4', blob);
    // (fix-review) the kit is checked against the log first: a guest key that is no guest's is refused, and
    // nothing is written; a device key that is written is always the one its secret makes
    check(await p.evaluate(pk => { const d = localStorage.getItem('ft-device'); return !d || JSON.parse(d).pk === pk; }, k.pk), 'restored device key is derived from its secret (or none written)');
  }
  // 4. a cost raised past what a phone can bear, checksum recomputed: refused before any work
  {
    const blob = craft({ v: 2, m: { fid: real.fid, key: real.key }, d: newKey(), i: {} }, { tamper: all => new DataView(all.buffer).setUint32(4, 4 * 1024 * 1024) });
    const t0 = Date.now();
    const { said } = await tryRestore('F5', blob);
    check(said.includes('ناقص أو تالف') && Date.now() - t0 < 15000, 'kit with an absurd cost is refused quickly', said);
    // the cost is authenticated: lowering it (checksum recomputed) does not open the kit
    const blob2 = craft({ v: 2, m: { fid: real.fid, key: real.key }, d: newKey(), i: {} }, { t: 2, tamper: all => (all[2] = 1) });
    check((await tryRestore('F6', blob2)).said.includes('غير صحيحة'), 'a header changed after sealing does not open');
  }

  // 5. the suggested words always pass the rule: the button opens once the box is ticked
  await openMe(A);
  await click(A, 'مفتاح الاستعادة', '.card.cta');
  const stuck = await A.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const btn = t => [...document.querySelectorAll('.modal.kit button')].find(b => b.textContent.includes(t));
    let bad = 0;
    for (let i = 0; i < 400; i++) {
      btn('كلمات أخرى').click();
      await sleep(5);
      const box = document.querySelector('.modal.kit .opt input');
      if (!box.checked) box.click();
      await sleep(5);
      if (btn('إنشاء المفتاح').disabled) bad++;
    }
    return bad;
  });
  check(stuck === 0, 'suggested words never leave «إنشاء المفتاح» disabled', stuck + ' of 400');
  const typed = await A.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.modal.kit button')].find(b => b.textContent.includes('أكتب عبارتي')).click();
    await sleep(50);
    const inp = document.querySelector('.modal.kit .bigin');
    const set = v => { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); };
    set('شمس شمس شمس شمسشمسشمس');
    await sleep(50);
    return document.querySelector('.modal.kit .warnbox')?.innerText ?? '';
  });
  check(typed.includes('مختلفة'), 'a passphrase of one word repeated is refused', typed);
  await click(A, 'إغلاق', '.mhead button');

  // 6. a member joins and makes a kit; the admin then replaces his phone; the old kit no longer opens the family
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await A.evaluate(() => [...document.querySelectorAll('.keyblock button.keyrow.empty')][0]?.click());
  await wait(700);
  const pickable = await A.evaluate(() => !!document.querySelector('.results .prow'));
  let name, year;
  if (pickable) {
    name = await A.evaluate(() => document.querySelector('.results .prow b').innerText.split('\n')[0].split(' ')[0]);
    year = await A.evaluate(() => document.querySelector('.results .prow .pt small').innerText.slice(0, 4));
    await A.evaluate(() => document.querySelector('.searchpage .round')?.click());
    await wait(500);
  } else {
    [name, year] = ['محمد', ''];
  }
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await pick(A, name, year);
  const invite = await lastInvite(A);
  await click(A, 'إغلاق', '.mhead button');
  const B = await phone('B', invite, { prf: true });
  await click(B, 'نعم، أنا');
  await wait(1500);
  await openMe(B);
  const who = await meName(B);
  check(!!who, 'member joined', who);
  // B locks his phone; the passkey's user id is this browser's own
  const lockSeg = (p, i) => p.evaluate(i => [...document.querySelectorAll('section')].find(s => s.querySelector('h3')?.textContent === 'الأمان').querySelectorAll('.seg button')[i].click(), i);
  const handles = async p => (await p.cdp.send('WebAuthn.getCredentials', { authenticatorId: p.authenticatorId })).credentials.map(c => c.userHandle);
  await lockSeg(B, 0);
  await wait(2500);
  check(await B.evaluate(() => !!localStorage.getItem('ft-lock')), 'member locked his phone');
  const [bHandle] = await handles(B);
  await lockSeg(B, 1);
  await wait(2500);
  await lockSeg(B, 0);
  await wait(2500);
  const bHandles = await handles(B);
  check(await B.evaluate(() => !!localStorage.getItem('ft-lock')), 'member locked his phone again');
  // a resident passkey with the same user id overwrites the old one
  check(bHandles.length >= 1 && bHandles.every(h => h === bHandle), 'locking again in the same browser reuses its passkey user id (so it replaces its own passkey)', JSON.stringify(bHandles.map(h => h === bHandle)));
  await click(B, 'مفتاح الاستعادة', '.card.cta');
  const words = await B.evaluate(() => [...document.querySelectorAll('.modal.kit .words span')].map(s => s.lastChild.textContent.trim()).join(' '));
  await B.evaluate(() => document.querySelector('.modal.kit .opt input').click());
  await click(B, 'إنشاء المفتاح');
  await B.waitForFunction(() => [...document.querySelectorAll('.modal.kit button')].some(b => b.textContent.trim() === 'نسخ'), { timeout: 30000 });
  await click(B, 'نسخ', '.modal.kit button');
  const kitLink = await B.evaluate(() => window.__copied);
  const kitBlob = kitLink.slice(kitLink.indexOf('restore=') + 8);

  // the installed app has its own storage: the kit link pasted in its join box leads to the restore screen
  {
    const J = await phone('J', BASE + '/');
    await J.type('.join .bigin', kitLink, { delay: 0 });
    await click(J, 'انضمام', '.join button');
    check((await text(J, '.join h2')).includes('مفتاح الاستعادة'), 'a kit link pasted in the join box asks for its passphrase');
  }

  // the same person restored on another browser (same device key) and locked there: a different passkey user id,
  // so in a synced passkey list it cannot replace B's passkey and leave B's lock unopenable
  {
    const { p, said } = await tryRestore('C2', kitBlob, words, null, { prf: true });
    check(said === 'opened', 'kit opens on a second browser', said);
    await openMe(p);
    await lockSeg(p, 0);
    await wait(2500);
    check(await p.evaluate(() => !!localStorage.getItem('ft-lock')), 'second browser locked too');
    const [cHandle] = await handles(p);
    check(!!cHandle && cHandle !== bHandle, 'its passkey has its own user id', String(cHandle === bHandle));
  }

  // 7. the kit restored on the root admin's own phone (same family): the admin key stays
  {
    const { p, said } = await tryRestore('AD', kitBlob, words, async p => {
      await p.goto(adminLink, { waitUntil: 'networkidle0' });
      await wait(1200);
    });
    check(said === 'opened', 'member kit opens on the admin phone', said);
    await openMe(p);
    check((await p.evaluate(() => [...document.querySelectorAll('.tab')].some(e => e.textContent.includes('الإدارة')) || (document.querySelector('.page.me')?.innerText ?? '').includes('مشرف العائلة'))), 'admin phone keeps the admin key after restoring a member kit');
    check((await meName(p)) === who, 'admin phone now also signs as that member', await meName(p));
  }

  await wait(3500);
  await openAdmin(A);
  await A.evaluate(n => [...[...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.querySelector('.pt b')?.innerText.replace(/\s+/g, ' ').trim() === n && e.querySelector('.pt small.ok')).querySelectorAll('button')].find(b => b.textContent.includes('جهاز جديد')).click(), who);
  await wait(2500);
  check(await A.evaluate(() => !!document.querySelector('.modal.invite .qr svg')), '«جهاز جديد» done');
  await click(A, 'إغلاق', '.mhead button');
  // (feat/multidevice) «جهاز جديد» replaces only the phone it was tapped for: the kit is a backup key of its
  // own among his devices, so it still brings him back, on a phone with a key of its own
  {
    const { p, said } = await tryRestore('KIT', kitBlob, words);
    check(said === 'opened', 'after «جهاز جديد» on his phone, his kit (a key of its own) still restores him', said);
    await openMe(p);
    check((await meName(p)) === who, 'as the same person', await meName(p));
  }
  // the root admin takes the backup key away from his profile (الصلاحيات → مفتاح الاستعادة → إبطال)
  await wait(3500);
  await openAdmin(A);
  await A.evaluate(n => [...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.querySelector('.pt b')?.innerText.replace(/\s+/g, ' ').trim() === n)?.querySelector('button.pt').click(), who);
  await wait(1200);
  const revoked = await A.evaluate(() => {
    const r = [...document.querySelectorAll('.page.profile section.perms .permphone .prow')].find(e => e.innerText.includes('مفتاح الاستعادة'));
    const b = r && [...r.querySelectorAll('button')].find(x => x.textContent.includes('إبطال'));
    b?.click();
    return !!b;
  });
  check(revoked, 'the root admin sees his backup key on his profile and takes it away');
  await wait(3000);
  {
    const { p, said } = await tryRestore('OLD', kitBlob, words);
    // (fix-review) refused before the phone changes, saying why
    check(said.includes('لم يعد مفتاح الاستعادة هذا يعمل'), 'once his backup key is taken away, the kit no longer opens the family', said);
    check(!(await text(p, '.toast')).includes('عاد دخولك'), 'and does not claim access came back');
    check(await p.evaluate(() => !localStorage.getItem('ft-family')), 'and leaves no family key behind');
  }
});
