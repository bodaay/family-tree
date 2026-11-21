// Replacing a lost phone: the root admin taps «جهاز جديد» on a linked member.
// One step unlinks the old phone (which then forgets the family) and shows a
// fresh personal invite for the same person, which claims him on the new phone.
//   node lock-newphone.mjs <BASE url> <admin-link file>
import { adminLink, phone, click, pick, check, wait, text, meName, memberRows, openMe, openAdmin, lastInvite, run } from './locklib.mjs';

await run(async () => {
  const A = await phone('A', adminLink);
  await click(A, 'تصفّح');
  await openAdmin(A);
  // invite someone from the tree: the eldest suggestion for an empty seat (nobody is appointed)
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await A.evaluate(() => [...document.querySelectorAll('.keyblock button.keyrow.empty')].sort((a, b) => b.innerText.includes('ذهبي') - a.innerText.includes('ذهبي'))[0].click());
  await wait(700);
  const name = await A.evaluate(() => document.querySelector('.results .prow b').innerText.split('\n')[0].split(' ')[0]);
  const year = await A.evaluate(() => document.querySelector('.results .prow .pt small').innerText.slice(0, 4));
  await A.evaluate(() => document.querySelector('.searchpage .round')?.click());
  await wait(500);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await pick(A, name, year);
  const first = await lastInvite(A);
  await click(A, 'إغلاق', '.mhead button');

  const B = await phone('B', first);
  await click(B, 'نعم، أنا');
  await wait(1500);
  await openMe(B);
  const who = await meName(B);
  check(!!who, 'member joined on his first phone', who);
  await wait(3500); // the admin's phone syncs

  // the member's row: «جهاز جديد» unlinks the old phone and shows a new invite at once
  // (newest first; earlier runs may have left other phones for the same person)
  await openAdmin(A);
  const before = await memberRows(A, who);
  const start = [before.filter(x => x.includes('بانتظار الانضمام')).length, before.filter(x => !x.includes('بانتظار')).length];
  const buttons = await A.evaluate(n => {
    const row = [...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.querySelector('.pt b')?.innerText.replace(/\s+/g, ' ').trim() === n && e.querySelector('.pt small.ok'));
    return row ? [...row.querySelectorAll('button')].map(b => b.textContent.trim()) : null;
  }, who);
  check(!!buttons?.includes('جهاز جديد'), 'joined member has «جهاز جديد»', JSON.stringify(buttons));
  const invitesBefore = await A.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ft-invites:' + JSON.parse(localStorage.getItem('ft-family')).fid))).length);
  await A.evaluate(n => [...[...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.querySelector('.pt b')?.innerText.replace(/\s+/g, ' ').trim() === n && e.querySelector('.pt small.ok')).querySelectorAll('button')].find(b => b.textContent.includes('جهاز جديد')).click(), who);
  await wait(2500);
  check(await A.evaluate(() => !!document.querySelector('.modal.invite .qr svg')), 'the new invite QR is shown in the same step');
  const title = await text(A, '.modal.invite .mhead b');
  check(title.includes(who.split(' ')[0]), 'the new invite is for the same person', title);
  const invitesAfter = await A.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ft-invites:' + JSON.parse(localStorage.getItem('ft-family')).fid))).length);
  check(invitesAfter === invitesBefore + 1, 'one new invite saved');
  const second = await lastInvite(A);
  await click(A, 'إغلاق', '.mhead button');
  const rows = await memberRows(A, who);
  const count = r => [r.filter(x => x.includes('بانتظار الانضمام')).length, r.filter(x => !x.includes('بانتظار')).length];
  const [waiting, joined] = count(rows);
  check(waiting === start[0] + 1 && joined === start[1] - 1, 'members list: old phone gone, new invite waiting', rows.join(' | '));

  // the old phone forgets the family on its next sync
  await wait(4000);
  const oldPhone = await B.evaluate(() => (document.querySelector('.join h2')?.innerText ?? '-') + '|' + !!localStorage.getItem('ft-family'));
  check(oldPhone.startsWith('انتهى دخولك') && oldPhone.endsWith('false'), 'old phone is unlinked and wiped', oldPhone);

  // the new phone claims the same person with the new invite
  const C = await phone('C', second);
  check((await text(C, '.join .who3 b')) === who.split(' ')[0], 'new invite names the same person');
  await click(C, 'نعم، أنا');
  await wait(1500);
  await openMe(C);
  check((await meName(C)) === who, 'new phone is the same person', await meName(C));
  // the first invite cannot be used again
  const D = await phone('D', first);
  check(!(await D.evaluate(() => !!document.querySelector('.tabs'))) && !(await D.evaluate(() => !!localStorage.getItem('ft-family'))), 'the old invite no longer opens the family');
  await wait(3500);
  await openAdmin(A);
  const now = count(await memberRows(A, who));
  check(now[0] === start[0] && now[1] === start[1], 'admin sees the member joined again', JSON.stringify([start, now]));
});
