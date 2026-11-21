// Fix check: with the Face ID lock on, links that carry the family key need Face ID again (secrev-lock-adddevice).
//   node fix-lock-invites.mjs <BASE url> <admin-link file>
// B turns the lock on and unlocks. «إضافة جهاز» asks Face ID (one WebAuthn
// call) before it writes the invite or shows its link; showing the waiting
// invite again («عرض») asks again; when Face ID is cancelled no link is shown
// and no invite is written. The root admin's lock asks the same before a
// personal invite and a guest invite.
import {
  check, run, wait, until, phone, join, click, tab, ready, rootAdmin, invite, myDevices, deviceButton, meName, copyLink, fetchLog,
} from './multidev-lib.mjs';

async function withFaceId(p) {
  const cdp = await p.createCDPSession();
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
  });
}
// counts the app's WebAuthn assertions (each one is a Face ID prompt on a phone); `cancel`: the person cancels them
const countGets = (p, cancel = false) => p.evaluate(cancel => {
  window.__gets = 0;
  window.__get ??= navigator.credentials.get.bind(navigator.credentials);
  navigator.credentials.get = o => {
    window.__gets++;
    return cancel ? Promise.reject(new DOMException('cancelled', 'NotAllowedError')) : window.__get(o);
  };
}, cancel);
const gets = p => p.evaluate(() => window.__gets);
const sheet = p => p.evaluate(() => !!document.querySelector('.modal.invite'));
async function lockOn(p) {
  await withFaceId(p);
  await tab(p, 'أنا');
  await p.evaluate(() => [...document.querySelectorAll('section')].find(s => s.querySelector('h3')?.textContent === 'الأمان').querySelector('.seg button').click());
  await wait(2500);
  const on = await p.evaluate(() => !!localStorage.getItem('ft-lock') && !localStorage.getItem('ft-family').startsWith('{'));
  await p.reload({ waitUntil: 'networkidle0' });
  await wait(1200);
  await click(p, 'افتح بالبصمة');
  await wait(2500);
  return on && (await ready(p));
}

await run(async () => {
  const A = await rootAdmin();
  const b = await invite(A, 'محمد', [await meName(A)]);
  const B1 = await join('B1', b.link);
  const who = await meName(B1);
  check(await ready(B1), 'B joined', who);
  check(await lockOn(B1), 'B turned the Face ID lock on and unlocked the app');

  // someone borrows the open phone and cancels Face ID
  const n0 = (await fetchLog()).length;
  await countGets(B1, true);
  await tab(B1, 'أنا');
  await click(B1, 'إضافة جهاز', '.mydevs .card.cta');
  await wait(1500);
  check((await gets(B1)) === 1, '«إضافة جهاز» asks Face ID first', await gets(B1));
  check(!(await sheet(B1)), 'cancelled: no link is shown');
  check((await fetchLog()).length === n0, 'and no invite is written');
  check((await B1.evaluate(() => document.querySelector('.toast')?.innerText ?? '')).includes('البصمة'), 'the phone says why');

  // B himself, with Face ID
  await countGets(B1);
  await click(B1, 'إضافة جهاز', '.mydevs .card.cta');
  await until(() => sheet(B1));
  check((await gets(B1)) === 1 && (await sheet(B1)), 'with Face ID, the link is shown (one WebAuthn call)', await gets(B1));
  const link = await copyLink(B1);
  check(/#join=/.test(link ?? ''), 'and it works as before');
  await countGets(B1);
  check(await deviceButton(B1, 'دعوة جهاز', 'عرض'), 'B taps «عرض» on the waiting invite');
  await until(() => sheet(B1));
  check((await gets(B1)) === 1, 'showing it again asks Face ID again', await gets(B1));
  await click(B1, 'إغلاق', '.mhead button');
  await countGets(B1, true);
  await deviceButton(B1, 'دعوة جهاز', 'عرض');
  await wait(1200);
  check(!(await sheet(B1)), 'cancelled, it stays hidden');
  const B2 = await join('B2', link);
  check((await meName(B2)) === who, 'B\'s new phone joins with the link');

  // the root admin, with his own lock on: a personal invite and a guest invite ask too
  check(await lockOn(A), 'the root admin turned his lock on');
  await countGets(A, true);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await A.type('.sfield input', 'عبدالله', { delay: 10 });
  await wait(600);
  await A.evaluate(() => document.querySelector('.results .prow').click());
  await wait(1500);
  check((await gets(A)) === 1 && !(await sheet(A)), 'his personal invite asks Face ID; cancelled, nothing is shown', await gets(A));
  await countGets(A);
  await A.evaluate(() => {
    const inp = document.querySelector('.guestnew input');
    inp.value = 'أبو فهد';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(300);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة زائر للمشاهدة');
  await until(() => sheet(A));
  check((await gets(A)) === 1 && (await sheet(A)), 'a guest invite asks Face ID, then shows its link', await gets(A));
  await click(A, 'إغلاق', '.mhead button');
});
