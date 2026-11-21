// View all and guests (the older access.mjs flow, on the integration build):
//   node int-old-access.mjs <BASE url> <admin-link file>
// The root admin gives the platinum key and invites its holder P. Women beyond
// the 3rd degree are hidden from P until the root admin gives him view all. P
// invites a guest G, who sees everyone but cannot add. P ends the guest: G's
// phone forgets the family, and the key is renewed (by the platinum phone). The
// root admin unlinks P: P's phone forgets the family, and the key is renewed.
import { adminLink, check, click, ended, keyVersions, lastLink, phone, pick, run, tab, until, wait } from './int-lib.mjs';

const womenFound = async p => {
  await tab(p, 'الشجرة');
  await p.evaluate(() => document.querySelector('.home .search')?.click());
  await wait(400);
  await p.type('.sfield input', 'لطيفة', { delay: 10 });
  await wait(600);
  const n = await p.evaluate(() => document.querySelectorAll('.results .prow').length);
  await p.evaluate(() => document.querySelector('.searchpage .round').click());
  await wait(300);
  return n;
};

await run(async () => {
  const A = await phone('A', adminLink);
  await click(A, 'اربط باسمي');
  await pick(A, 'منصور', '1963');
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  // the platinum key: the eldest suggestion
  await click(A, 'بلاتيني', 'button.keyrow');
  const plat = await A.evaluate(() => {
    const r = document.querySelector('.results .prow');
    const out = { name: r.querySelector('b').innerText.split('\n')[0].trim(), year: r.querySelector('.pt > small').innerText.slice(0, 4) };
    r.click();
    return out;
  });
  await wait(1500);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  check(!!(await A.evaluate(() => document.querySelector('button.keyrow.platinum:not(.empty)'))), 'platinum key given', plat.name);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await pick(A, plat.name, plat.year);
  const pLink = await lastLink(A);
  await click(A, 'إغلاق', '.mhead button');
  const P = await phone('P', pLink);
  await click(P, 'نعم، أنا');
  await wait(1500);
  check(await P.evaluate(() => !!document.querySelector('nav.tabs')), 'P joined');
  const before = await womenFound(P);

  // the root admin gives P view all
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'منح فرد مشاهدة الكل');
  await pick(A, plat.name, plat.year);
  await wait(4000);
  const after = await womenFound(P);
  check(after > before, 'view all shows P women he could not see before', `${before} -> ${after}`);

  // P (platinum) invites a guest
  await P.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await P.type('.guestnew input', 'أبو فهد', { delay: 10 });
  await P.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(P, 'دعوة زائر للمشاهدة', 'button', 1500);
  const gLink = await lastLink(P);
  await click(P, 'إغلاق', '.mhead button');
  const G = await phone('G', gLink);
  await click(G, 'قبول الدعوة');
  await wait(1800);
  check(await G.evaluate(() => !!document.querySelector('nav.tabs')), 'the guest joined');
  check(!(await G.evaluate(() => !!document.querySelector('.fab'))), 'the guest has no add button');
  check((await womenFound(G)) === after, 'the guest sees everyone', String(after));

  // P ends the guest: G forgets the family, and the key is renewed
  const v0 = await keyVersions();
  await P.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await P.evaluate(() => [...document.querySelectorAll('.prow')].find(e => e.innerText.includes('أبو فهد'))?.querySelector('button[aria-label="إنهاء"]')?.click());
  check(!!(await until(() => ended(G), 20000)), 'the ended guest forgets the family');
  check(!!(await until(async () => (await keyVersions()) > v0, 15000)), 'ending the guest renewed the family key (platinum phone)');

  // the root admin unlinks P: P forgets the family, and the key is renewed again
  const v1 = await keyVersions();
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  const unlinked = await A.evaluate(() => {
    const row = [...document.querySelectorAll('.prow')].find(e => e.innerText.includes('انضم') && e.querySelector('button[aria-label="إلغاء"]'));
    row?.querySelector('button[aria-label="إلغاء"]').click();
    return !!row;
  });
  check(unlinked, 'the root admin unlinks P');
  check(!!(await until(() => ended(P), 20000)), 'the unlinked phone forgets the family');
  check(!!(await until(async () => (await keyVersions()) > v1, 15000)), 'unlinking renewed the family key');
  await tab(A, 'الشجرة');
  check(await A.evaluate(() => !!document.querySelector('nav.tabs')), 'the root admin keeps reading after both renewals');
});
