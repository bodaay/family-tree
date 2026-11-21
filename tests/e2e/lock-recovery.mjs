// Recovery kit: a member with a key seat makes a kit (with the Face ID lock on,
// so it needs Face ID again); its restore link, opened on a fresh phone, refuses
// a wrong passphrase and with the right one brings back the same person, seat
// and device key. The link never reaches the server and leaves the address bar.
// The root admin's kit carries the admin key too.
//   node lock-recovery.mjs <BASE url> <admin-link file>
import { adminLink, phone, click, pick, check, wait, text, meName, openMe, openAdmin, lastInvite, storageDump, run } from './locklib.mjs';

/** Makes a kit on this phone and returns [link, passphrase]. */
async function makeKit(p) {
  await openMe(p);
  await click(p, 'مفتاح الاستعادة', '.card.cta');
  const words = await p.evaluate(() => [...document.querySelectorAll('.modal.kit .words span')].map(s => s.lastChild.textContent.trim()).join(' '));
  check(words.split(' ').length === 4, 'four suggested words', words.split(' ').length + ' words');
  const disabled = await p.evaluate(() => [...document.querySelectorAll('.modal.kit button')].find(b => b.textContent.includes('إنشاء المفتاح')).disabled);
  check(disabled, 'cannot create before confirming the words are written down');
  await p.evaluate(() => document.querySelector('.modal.kit .opt input').click());
  await wait(200);
  const t0 = Date.now();
  await click(p, 'إنشاء المفتاح');
  await p.waitForFunction(() => [...document.querySelectorAll('.modal.kit button')].some(b => b.textContent.trim() === 'نسخ'), { timeout: 30000 });
  console.log(`  (kit sealed in ${Date.now() - t0} ms incl. Face ID)`);
  check(await p.evaluate(() => !!document.querySelector('.modal.kit .qr svg')), 'kit shows a QR code');
  await click(p, 'نسخ', '.modal.kit button');
  const link = await p.evaluate(() => window.__copied);
  check(/\/#restore=[A-Za-z0-9_-]{100,}$/.test(link ?? ''), '«نسخ» copies a restore link');
  console.log(`  (restore link: ${link?.length} characters)`);
  await click(p, 'حفظ صورة', '.modal.kit button');
  await wait(800);
  const img = await p.evaluate(() => window.__shared);
  check(img?.type === 'image/png' && img.size > 5000, '«حفظ صورة» makes a picture of the code', JSON.stringify(img));
  await click(p, 'إغلاق', '.mhead button');
  return [link, words];
}

await run(async () => {
  // the root admin appoints a silver key holder and invites him
  const A = await phone('A', adminLink);
  await click(A, 'تصفّح');
  await openAdmin(A);
  // reruns fill the seats: free one silver seat if none is empty
  const emptySilver = () => A.evaluate(() => !![...document.querySelectorAll('.keyblock button.keyrow.empty')].find(e => e.innerText.includes('فضي')));
  if (!(await emptySilver())) {
    await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
    await A.evaluate(() => [...document.querySelectorAll('.keyblock button.keyrow.silver')].find(e => !e.classList.contains('empty')).click());
    await wait(500);
    await click(A, 'إخلاء المقعد', '.modal button');
    await wait(1500);
  }
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await A.evaluate(() => [...document.querySelectorAll('.keyblock button.keyrow.empty')].find(e => e.innerText.includes('فضي')).click());
  await wait(700);
  const name = await A.evaluate(() => document.querySelector('.results .prow b').innerText.split('\n')[0].split(' ')[0]);
  const year = await A.evaluate(() => document.querySelector('.results .prow .pt small').innerText.slice(0, 4));
  await A.evaluate(() => document.querySelector('.results .prow').click());
  await wait(1500);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await pick(A, name, year);
  const invite = await lastInvite(A);
  await click(A, 'إغلاق', '.mhead button');

  // B joins, turns the Face ID lock on, and makes a kit
  const B = await phone('B', invite, { prf: true });
  await click(B, 'نعم، أنا');
  await wait(1500);
  await openMe(B);
  const who = await meName(B);
  const seat = await text(B, ':is(.page.me, .page.admin) .card .key');
  check(!!who && seat.includes('فضي'), 'member joined, holding a silver key', who + ' / ' + seat);
  const bDevice = await B.evaluate(() => JSON.parse(localStorage.getItem('ft-device')));
  // the kit carries the whole membership, including fields a later version may add
  await B.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('ft-family'));
    localStorage.setItem('ft-family', JSON.stringify({ ...m, futureField: { kept: [1, 2] } }));
  });
  const bFamily = await B.evaluate(() => JSON.parse(localStorage.getItem('ft-family')));
  await B.evaluate(() => [...document.querySelectorAll('section')].find(s => s.querySelector('h3')?.textContent === 'الأمان').querySelector('.seg button').click());
  await wait(2500);
  check(await B.evaluate(() => !!localStorage.getItem('ft-lock')), 'member turned the lock on');
  const [link, words] = await makeKit(B);
  check(!link.includes(bFamily.key) && !link.includes(bDevice.sk), 'the link does not carry the keys in plain');

  // a fresh phone opens the restore link
  const C = await phone('C', null);
  const sent = [];
  // what goes over the wire: puppeteer shows the "#" part, which browsers never send
  C.on('request', r => sent.push(r.url().split('#')[0] + ' ' + JSON.stringify(r.headers()) + ' ' + (r.postData() ?? '')));
  await C.goto(link, { waitUntil: 'networkidle0' });
  await wait(1200);
  check((await text(C, '.join h2')).includes('مفتاح الاستعادة'), 'restore link asks for the passphrase');
  check(await C.evaluate(() => location.hash === ''), 'the kit is gone from the address bar');
  await C.type('.join .bigin', 'نخلة بحر صقر قهوة', { delay: 5 });
  await click(C, 'استعادة', '.join button');
  await C.waitForFunction(() => !!document.querySelector('.join .warnbox') || !document.querySelector('.join .bigin'), { timeout: 30000 });
  check((await text(C, '.join .warnbox')).includes('غير صحيحة'), 'wrong passphrase refused with a clear message');
  check(await C.evaluate(() => !localStorage.getItem('ft-family')), 'nothing restored with a wrong passphrase');
  // the right one, typed loosely (extra spaces, ه for ة, a fatha, Persian ی for ي)
  await C.evaluate(() => { document.querySelector('.join .bigin').value = ''; });
  const fatha = String.fromCharCode(0x64e);
  const loose = '  ' + words.replace(/ة/g, 'ه').replace(/ي/g, String.fromCharCode(0x6cc)).split(' ').map(w => w[0] + fatha + w.slice(1)).join('   ') + ' ';
  await C.type('.join .bigin', loose, { delay: 5 });
  await click(C, 'استعادة', '.join button');
  await C.waitForFunction(() => !!document.querySelector('.tabs'), { timeout: 30000 });
  await wait(1500);
  await openMe(C);
  check((await meName(C)) === who, 'restored to the same person', await meName(C));
  check((await text(C, ':is(.page.me, .page.admin) .card .key')).includes('فضي'), 'the key seat carries over');
  // (feat/multidevice) the restored phone has a device key of its own, which the kit's backup key added to his devices
  check(await C.evaluate(pk => { const d = JSON.parse(localStorage.getItem('ft-device')); return !!d.pk && d.pk !== pk; }, bDevice.pk), 'the restored phone has a device key of its own, not the old phone\'s');
  const devs = await C.evaluate(() => [...document.querySelectorAll('.mydevs .devlist .prow')].map(r => r.innerText.replace(/\s+/g, ' ')));
  check(devs.length === 3 && devs.filter(x => x.includes('هذا الجهاز')).length === 1 && devs.some(x => x.includes('مفتاح الاستعادة')) && devs.some(x => x.includes('هذا الجهاز') && x.includes('بمفتاح الاستعادة')), 'أجهزتي lists the old phone, the backup key and this phone (added with the kit)', devs.join(' | '));
  // (fix-review) besides `seen`, how far the phone has read the log, which only grows
  check(await C.evaluate(m => { const { seen: a, ...now } = JSON.parse(localStorage.getItem('ft-family')); const { seen: b, ...was } = m; return JSON.stringify(now) === JSON.stringify(was) && (!b || a.n >= b.n); }, bFamily), 'the whole membership came back as it was');
  check(await C.evaluate(() => !localStorage.getItem('ft-lock')), 'restored phone starts without a lock (it has no passkey yet)');
  const blob = link.slice(link.indexOf('restore=') + 8);
  check(sent.every(u => !u.includes(blob.slice(0, 40))), 'the kit never reached the server', sent.length + ' requests');
  // and it can act as that person: approve-capable phone, sees the requests tab
  check(!(await text(C, ':is(.page.me, .page.admin)')).includes('تحتاج دعوة'), 'restored phone is not asked for an invite');

  // the root admin's kit carries the admin key: the restored phone is the root admin
  const [aLink, aWords] = await makeKit(A);
  const D = await phone('D', aLink);
  await D.type('.join .bigin', aWords, { delay: 5 });
  await click(D, 'استعادة', '.join button');
  await D.waitForFunction(() => !!document.querySelector('.tabs'), { timeout: 30000 });
  await wait(1000);
  await openMe(D);
  check((await D.evaluate(() => [...document.querySelectorAll('.tab')].some(e => e.textContent.includes('الإدارة')) || (document.querySelector('.page.me')?.innerText ?? '').includes('مشرف العائلة'))), 'admin kit restores the root admin');
  check((await D.evaluate(async () => { ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click(); await new Promise(r => setTimeout(r, 600)); return (document.querySelector('.page')?.innerText ?? '').includes('الأعضاء والدعوات'); })), 'restored admin can manage invites');

  // a damaged link says so
  const E = await phone('E', aLink.slice(0, -30));
  await E.type('.join .bigin', aWords, { delay: 5 });
  await click(E, 'استعادة', '.join button');
  await E.waitForFunction(() => !!document.querySelector('.join .warnbox'), { timeout: 30000 });
  check((await text(E, '.join .warnbox')).includes('ناقص أو تالف'), 'a cut-off link is reported as damaged');
  // the lock screen of a locked phone accepts a pasted restore link (the way out when Face ID is gone)
  await B.reload({ waitUntil: 'networkidle0' });
  await wait(1000);
  check((await text(B, '.join h2')).includes('مقفل'), 'member phone opens locked');
  await click(B, 'لا أستطيع الفتح');
  await B.type('.lockhelp .bigin', link, { delay: 0 });
  await click(B, 'متابعة', '.lockhelp button');
  check((await text(B, '.join h2')).includes('مفتاح الاستعادة'), 'lock screen hands a pasted kit to the restore screen');
  await B.type('.join .bigin', words, { delay: 5 });
  await click(B, 'استعادة', '.join button');
  await B.waitForFunction(() => !!document.querySelector('.tabs'), { timeout: 30000 });
  await wait(1000);
  await openMe(B);
  check((await meName(B)) === who, 'locked phone restored from its kit without Face ID');
  const dump = await storageDump(B);
  check(!dump.includes('ftlock1:') && !dump.includes('ft-lock='), 'the old sealed values were replaced');
});
