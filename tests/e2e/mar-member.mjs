// Marriages, a member: joins through a personal invite, proposes a wife (a
// pending sensitive request, not applied), and does not see a distant
// relative's wife or the marriage's details.
//   node mar-member.mjs BASE admin-link-file [screenshots-dir]
import { setup, click, typeIn, typeYear, openProfile, closeProfile, families, history, removeAllMarriages, wait } from './mar-lib.mjs';

const t = setup();
const { ok, shot } = t;
const MAN = ['مازن فيصل', '1960'];
const MEMBER = ['مشاري', '1985']; // far from مازن (6th degree)
const WIFE_OUT = 'هيا بنت سعد العتيبي';
const PROPOSED = 'أمل بنت ناصر الشمري';

try {
  await t.launch();
  const A = await t.phone('A', t.adminLink);
  await click(A, 'تصفّح أولًا', 'button', 500);

  // the root admin records a wife for مازن (to check what the member may see)
  ok(await openProfile(A, ...MAN), 'root admin opens مازن');
  await removeAllMarriages(A);
  await click(A, 'إضافة زوجة', '.page.profile button.addsp');
  await typeIn(A, '.addsheet input.bigin[dir="rtl"]', WIFE_OUT);
  await typeYear(A, 'سنة الزواج', '1988');
  await click(A, 'حفظ', '.addsheet .foot button', 1800);
  ok((await families(A)).some(f => f.spouse.includes(WIFE_OUT)), 'the root admin\'s wife is recorded directly');
  await closeProfile(A);

  // a personal invite for the member
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  ok(await click(A, 'دعوة فرد', '.page button', 600), 'root admin starts a personal invite');
  await A.type('.sfield input', MEMBER[0], { delay: 8 });
  await wait(600);
  await A.evaluate(y => [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y))?.click(), MEMBER[1]);
  await wait(1500);
  const link = await A.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('ft-family'));
    const inv = JSON.parse(localStorage.getItem('ft-invites:' + m.fid) ?? '{}');
    const sk = Object.values(inv).pop();
    return sk ? `${location.origin}/#join=${m.fid}.${m.key}.i${sk}` : null;
  });
  ok(!!link, 'the invite link is ready');
  await click(A, 'إغلاق', '.mhead button', 400);

  const B = await t.phone('B', link);
  ok(await click(B, 'نعم، أنا', '.join button', 2000), 'the member accepts the invite');
  ok(await B.evaluate(() => !!document.querySelector('.home')), 'the member is in the family');

  // the member proposes a wife for himself
  ok(await openProfile(B, ...MEMBER), 'the member opens his own profile');
  ok(await click(B, 'إضافة زوجة', '.page.profile button.addsp'), 'a member is offered «إضافة زوجة»');
  const sheet = await B.evaluate(() => ({ submit: document.querySelector('.addsheet .foot .btn.primary')?.textContent ?? '', hint: document.querySelector('.addsheet p.hint')?.textContent ?? '' }));
  ok(sheet.submit === 'إرسال للاعتماد', 'the member sends it for approval');
  ok(sheet.hint.includes('ذهبي واحد'), 'adding a wife needs a gold key: ' + sheet.hint);
  await typeIn(B, '.addsheet input.bigin[dir="rtl"]', PROPOSED);
  await typeYear(B, 'سنة الزواج', '2015');
  await shot(B, 'n01-member-proposes.png');
  await click(B, 'إرسال للاعتماد', '.addsheet .foot button', 1800);
  ok(!(await B.evaluate(() => !!document.querySelector('.addsheet'))), 'the sheet closes after sending');
  let fams = await families(B);
  ok(!fams.some(f => f.spouse.includes('أمل')), 'the proposed wife is not in the tree yet');
  const hist = await history(B);
  ok(hist.some(h => h.includes('إضافة زوجة لـ مشاري') && h.includes('بانتظار الاعتماد')), 'his profile shows the request as pending');
  await closeProfile(B);
  await click(B, 'الطلبات', '.tab', 700);
  const req = await B.evaluate(() => [...document.querySelectorAll('.requests .card.req')].map(c => c.innerText.replace(/\s+/g, ' ')).find(x => x.includes('إضافة زوجة لـ مشاري')) ?? '');
  ok(req.includes('حساس') && req.includes('ذهبي واحد'), 'the request is sensitive, for one gold key');
  await shot(B, 'n02-member-request.png');

  // the root admin's phone gets it on its next sync, still pending
  await wait(3500);
  await click(A, 'الطلبات', '.tab', 700);
  const pendingA = await A.evaluate(() => [...document.querySelectorAll('.requests .card.req h4')].some(h => h.textContent.includes('إضافة زوجة لـ مشاري')));
  ok(pendingA, 'the root admin sees the pending request');
  ok(await openProfile(A, ...MEMBER), 'root admin opens the member\'s profile');
  ok(!(await families(A)).some(f => f.spouse.includes('أمل')), 'not applied on the root admin\'s phone either');
  await closeProfile(A);

  // privacy: a 6th-degree relative's wife, and the marriage's status, stay hidden
  ok(await openProfile(B, ...MAN), 'the member opens مازن\'s profile');
  fams = await families(B);
  await shot(B, 'n03-member-sees-hidden-wife.png', 'الأسرة');
  const wifeCard = fams.find(f => f.spouse);
  ok(!!wifeCard && wifeCard.spouse.startsWith('زوجة') && !wifeCard.line, 'the wife shows only as «زوجة», without status or years');
  const leaks = await B.evaluate(w => [...document.querySelectorAll('.page.profile *')].filter(e => !e.children.length && e.textContent.includes(w)).map(e => e.textContent), 'هيا');
  ok(!leaks.length, 'her name is nowhere on the page' + (leaks.length ? ': ' + leaks.join(' | ') : ''));
  ok(!(await B.evaluate(() => !!document.querySelector('.page.profile .mline .link'))), 'no edit link for a marriage he cannot see');
  await closeProfile(B);

  // clean up for the next run
  await openProfile(A, ...MAN);
  await removeAllMarriages(A);
  ok(!(await families(A)).some(f => f.spouse), 'clean again for the next run');
  await t.finish();
} catch (e) {
  await t.crash(e);
}
