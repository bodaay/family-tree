// Personal invites and approvals (the older invites.mjs flow, on the integration build):
//   node int-old-invites.mjs <BASE url> <admin-link file>
// The root admin links his phone, gives two silver keys in one branch and invites
// both holders. The first link claims its person once (a second phone is refused);
// a member cannot choose who he is nor "view as". One holder, his seat emptied
// first (his own key would approve it as he sends it), asks to add a child;
// an approval forged in the other's name from an unlinked device is stored by the
// server but counts nowhere; the real approval from his phone completes it.
import { adminLink, base, fid, check, click, lastLink, phone, pick, run, tab, until, wait } from './int-lib.mjs';
const { forgeApproval, appointed } = await import('./int-forge.mts');

const tag = String(Date.now()).slice(-4);
const kids = ['سلمان', 'فيصل', 'مشعل', 'نايف', 'تركي'];
const child = kids[Number(tag) % kids.length];

await run(async () => {
  // A: the root admin, linked to his place in the tree
  const A = await phone('A', adminLink);
  await click(A, 'اربط باسمي');
  const me = await pick(A, 'منصور', '1963');
  await tab(A, 'أنا');
  check(!!me && (await A.evaluate(() => document.querySelector(':is(.page.me, .page.admin) .card .prow b')?.innerText ?? '')).includes(me), 'root admin linked to his place in the tree', me);

  // two silver keys in the first branch with free silver seats: the eldest suggestions
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  const block = await A.evaluate(() => [...document.querySelectorAll('.keyblock')].findIndex(b => [...b.querySelectorAll('button.keyrow.empty')].some(e => e.innerText.includes('فضي'))));
  const appoint = async () => {
    await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
    await A.evaluate(i => [...document.querySelectorAll('.keyblock')][i].querySelectorAll('button.keyrow.empty').forEach((e, j, all) => { if ([...all].find(x => x.innerText.includes('فضي')) === e) e.click(); }), block);
    await wait(800);
    const r = await A.evaluate(() => {
      const row = document.querySelector('.results .prow');
      if (!row) return null;
      const out = { name: row.querySelector('b').innerText.split('\n')[0].trim(), year: row.querySelector('.pt > small')?.innerText.slice(0, 4) ?? '' };
      row.click();
      return out;
    });
    await wait(1500);
    return r;
  };
  const S = await appoint();
  const S2 = await appoint();
  check(!!S && !!S2 && S.name + S.year !== S2.name + S2.year, 'two silver keys given in one branch', JSON.stringify([S, S2]));

  // invite both holders
  const invite = async who => {
    await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
    await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
    await click(A, 'دعوة فرد');
    const got = await pick(A, who.name, who.year);
    const link = await lastLink(A);
    await click(A, 'إغلاق', '.mhead button');
    return { got, link };
  };
  const iS = await invite(S);
  const iS2 = await invite(S2);
  check(iS.got === S.name && iS2.got === S2.name, 'invites made for both holders');

  // B: opens the first holder's invite
  const B = await phone('B', iS.link);
  check(await B.evaluate(() => !!document.querySelector('.join')), 'invite asks to confirm who it is for');
  await click(B, 'نعم، أنا');
  await wait(1800);
  await tab(B, 'أنا');
  check((await B.evaluate(() => document.querySelector(':is(.page.me, .page.admin) .card .prow b')?.innerText ?? '')).includes(S.name), 'B joined as the invited person');
  check(!(await B.evaluate(() => [...document.querySelectorAll(':is(.page.me, .page.admin) button')].some(b => b.textContent.trim() === 'تغيير'))), 'B cannot change who he is');
  check(!(await B.evaluate(() => [...document.querySelectorAll('h3')].some(h => h.textContent.includes('عرض التطبيق')))), 'B has no "view as"');

  // C: the same link on another phone is refused
  const C = await phone('C', iS.link);
  check(await C.evaluate(() => !!document.querySelector('.join h2') && !document.querySelector('nav.tabs')), 'a used invite does not open the family on a second phone');

  // D: the second holder joins and asks to add a child under himself
  const D = await phone('D', iS2.link);
  await click(D, 'نعم، أنا');
  await wait(1800);
  // D's seat is emptied first: a request his own silver key covers would be approved as he sends it
  const st = (p, fn, arg) => p.evaluate((src, a) => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts').then(m => new Function('m', 'a', 'return (' + src + ')(m, a)')(m, a)), fn.toString(), arg);
  const dMe = await st(D, m => m.getState().me);
  await st(A, (m, id) => m.vacate(id), dMe);
  await until(() => st(D, m => !m.getState().seats.some(x => x.holder === m.getState().me)));
  await tab(D, 'الشجرة');
  await D.evaluate(() => document.querySelector('.fab').click());
  await wait(700);
  // a holder with a wife recorded is first asked who the mother is: the one already chosen
  if (await D.evaluate(() => document.querySelector('.addsheet .q')?.textContent === 'من الأم؟')) await click(D, 'التالي');
  await click(D, 'ابن', '.bigchoice button');
  await click(D, 'التالي');
  await D.type('.bigin', child, { delay: 10 });
  await click(D, 'التالي');
  // a brother by the same name: carry on
  await click(D, 'متابعة', '.modal button', 500);
  await click(D, 'التالي');
  await click(D, 'إرسال للاعتماد', '.foot button', 1500);
  await click(D, 'متابعة', '.modal button', 1500);
  await tab(B, 'الطلبات');
  check(!!(await until(() => B.evaluate(c => [...document.querySelectorAll('.card.req h4')].some(h => h.innerText.includes(c)), child))), 'B sees the request waiting');

  // an approval forged in the name of B's person (the first silver appointed), from a device linked to no one
  const famKey = await A.evaluate(() => JSON.parse(localStorage.getItem('ft-family')).key);
  const [holder] = await appointed(base, fid, famKey, 'silver');
  const status = await forgeApproval(base, fid, famKey, holder ?? '');
  check(status === 201 || status === 200, 'the server stores the forged approval (it cannot read it)', String(status));
  await wait(4000);
  await tab(B, 'الطلبات');
  const pending = await B.evaluate(c => [...document.querySelectorAll('.card.req')].some(r => r.querySelector('h4')?.innerText.includes(c) && r.innerText.includes('تم 0 من')), child);
  check(pending, 'the forged approval counts nowhere: still 0 approvals');

  // B approves for real (D's request needs a silver key of the branch)
  const can = await B.evaluate(c => {
    const r = [...document.querySelectorAll('.card.req')].find(x => x.querySelector('h4')?.innerText.includes(c));
    const b = r?.querySelector('.btn.primary');
    b?.click();
    return !!b;
  }, child);
  check(can, 'B may approve the request', 'B and D may be close family');
  await wait(4000);
  await tab(A, 'الطلبات');
  const done = await until(() => A.evaluate(c => [...document.querySelectorAll('.card.hist')].some(e => e.innerText.includes(c) && e.innerText.includes('معتمد من')), child), 12000);
  check(!!done, 'the request is approved and in the record on the admin phone');

});
