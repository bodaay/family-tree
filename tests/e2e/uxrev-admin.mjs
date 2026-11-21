// UX walkthrough, part 1: the root admin sets up a branch (link to his name, a
// wife from outside and her children, other names, a duplicate warning, a
// merge), marks main branches and gives keys from profiles, invites a member.
// Saves the member's invite link for part 2 in <shots>/<tag>/.member (never printed).
import fs from 'node:fs';
import { adminLink, base, check, note, phone, shot, click, tab, has, text, until, wait, settle, pickRow, copyLink, closeProfile, openProfile, typeIn, typeYear, timed, dragFrames, scrollTo, dialogs, SHOTS, run } from './uxrev-lib.mjs';

run(async () => {
  const A = await phone('A', adminLink, { auth: true });
  check(await has(A, '.welcome h2', 'أهلًا'), 'the welcome card shows');
  await shot(A, '01-welcome');
  await click(A, 'اربط باسمي', '.welcome button');
  await shot(A, '02-link-search');
  const me = await pickRow(A, 'منصور');
  check((me ?? '').startsWith('منصور'), 'linked to منصور', me);
  await settle(A);
  await shot(A, '03-tree-3d-after-link');
  await tab(A, 'أنا');
  await shot(A, '04-me-top');
  await shot(A, '05-me-devices', { at: 'أجهزتي' });
  await shot(A, '06-me-security', { at: 'الأمان' });
  await shot(A, '07-me-members', { at: 'الأعضاء والدعوات' });
  await shot(A, '08-me-viewall', { at: 'مشاهدة الكل' });
  await shot(A, '09-me-familykey', { at: 'مفتاح العائلة' });
  await shot(A, '10-me-keys', { at: 'مفاتيح العائلة' });

  // main branches: the sons of the eldest line (first two shown)
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'الفروع الرئيسية', ':is(.page.me, .page.admin) button');
  await shot(A, '11-branches');
  const picked = await A.evaluate(() => {
    const rows = [...document.querySelectorAll('.searchpage .results .brow')];
    // gen-2 rows (indented once): pick up to three with descendants
    const g2 = rows.filter(r => r.style.paddingInlineStart === '26px').slice(0, 3);
    g2.forEach(r => r.click());
    return g2.map(r => r.querySelector('b')?.innerText.replace(/\s+/g, ' ').trim());
  });
  await wait(500);
  await shot(A, '12-branches-picked');
  await click(A, 'حفظ', '.searchpage .bfoot button', 1500);
  check(picked.length > 0, 'main branches picked: ' + picked.join(' | '));

  // his own profile
  await tab(A, 'أنا');
  await A.evaluate(() => document.querySelector(':is(.page.me, .page.admin) .card .prow')?.click());
  await wait(1000);
  check(await has(A, '.page.profile h1', 'منصور'), 'his profile opens');
  await shot(A, '13-own-profile');
  await shot(A, '14-own-permissions', { at: 'الصلاحيات' });
  await shot(A, '15-own-family', { at: 'الأسرة' });

  // a wife from outside the family
  const addWife = async (name, year) => {
    await click(A, 'إضافة زوجة', '.page.profile .addsp');
    await until(() => has(A, '.addsheet .ahead b', 'إضافة زوجة'));
    await typeIn(A, '.addsheet input.bigin', name);
    if (year) await typeYear(A, 'سنة الزواج', year);
    return true;
  };
  await addWife('جواهر بنت فالح العتيبي', '1990');
  await shot(A, '16-add-wife');
  await click(A, 'حفظ', '.addsheet .foot button', 1500);
  await addWife('شهد بنت سعيد القحطاني', '2001');
  await click(A, 'حفظ', '.addsheet .foot button', 1500);
  await shot(A, '17-profile-two-wives', { at: 'الأسرة' });

  // a child: which wife is the mother
  await click(A, 'إضافة ابن أو ابنة', '.page.profile button.link');
  await shot(A, '18-addchild-mother');
  const mothers = await A.evaluate(() => [...document.querySelectorAll('.addsheet .card.list .brow')].map(b => b.innerText.replace(/\s+/g, ' ')));
  check(mothers.length >= 3, 'the mother step lists the wives and «غير مسجلة»: ' + mothers.join(' | '));
  await click(A, 'جواهر', '.addsheet .card.list .brow', 300);
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await click(A, 'ابنة', '.addsheet .bigchoice button', 300);
  await shot(A, '19-addchild-sex');
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await A.type('.addsheet input.bigin', 'لولوة', { delay: 8 });
  await shot(A, '20-addchild-name');
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await shot(A, '21-addchild-birth');
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await shot(A, '22-addchild-review');
  await click(A, 'إضافة إلى الشجرة', '.addsheet .foot button', 1800);
  await click(A, 'متابعة', '.modal button', 800);

  // the same name again under the same father: the duplicate question
  const tabNow = await A.evaluate(() => document.querySelector('.tab.on')?.innerText.trim());
  note('after adding a child the app shows tab: ' + tabNow + ' (profile open: ' + (await A.evaluate(() => !!document.querySelector('.page.profile'))) + ')');
  await openProfile(A, 'منصور بن');
  await shot(A, '23-profile-after-child', { at: 'الأسرة' });
  await click(A, 'إضافة ابن أو ابنة', '.page.profile button.link');
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await click(A, 'ابنة', '.addsheet .bigchoice button', 300);
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await A.type('.addsheet input.bigin', 'لولوه', { delay: 8 });
  await shot(A, '24-dup-inline');
  await click(A, 'التالي', '.addsheet .foot button', 600);
  const dupNow = await has(A, '.modal.dups', '');
  await shot(A, '25-dup-sheet');
  // the duplicate question is off (CHECK_DUPLICATES, since 1.13); dupcheck-on/ has the version that asks
  check(!dupNow, 'no duplicate question for «لولوه» next to «لولوة» (the check is off)');
  if (dupNow) await click(A, 'متابعة', '.modal.dups button', 600);
  await click(A, 'التالي', '.addsheet .foot button', 400);
  await click(A, 'إضافة إلى الشجرة', '.addsheet .foot button', 1200);
  if (await has(A, '.modal.dups', '')) {
    await shot(A, '26-dup-sheet-final');
    await click(A, 'متابعة', '.modal.dups button', 1500);
  }
  await wait(1000);

  // other names: the second record, opened from her father's profile
  const openKid = async (kid, nth) => {
    await closeProfile(A);
    await tab(A, 'أنا');
    await A.evaluate(() => document.querySelector(':is(.page.me, .page.admin) .card .prow')?.click());
    await wait(900);
    return A.evaluate((k, n) => {
      const b = [...document.querySelectorAll('.page.profile .card.fam .fp')].filter(x => x.querySelector('b')?.innerText.trim() === k)[n];
      b?.click();
      return !!b;
    }, kid, nth);
  };
  check(await openKid('لولوه', 0), 'the second record opens from the father');
  await wait(900);
  await click(A, 'تعديل البيانات', '.page.profile button', 900);
  await shot(A, '27-edit-person');
  await scrollTo(A, 'أسماء أخرى', '.q');
  await A.type('.aliases input', 'أم فهد', { delay: 8 });
  await click(A, 'إضافة', '.aliases button');
  await click(A, 'لقب', '.akinds button', 300);
  await A.type('.aliases input', 'لولو', { delay: 8 });
  await shot(A, '28-edit-aliases');
  await click(A, 'حفظ', '.foot button', 1500);
  await shot(A, '29-profile-aliases');
  await closeProfile(A);
  await tab(A, 'الشجرة');
  await A.evaluate(() => document.querySelector('.home .search')?.click());
  await wait(400);
  await A.type('.sfield input', 'ام فهد منصور', { delay: 10 });
  await wait(700);
  const found = await A.evaluate(() => [...document.querySelectorAll('.results .prow')].map(r => r.innerText.replace(/\s+/g, ' ')));
  await shot(A, '30-search-alias');
  check(found.some(r => r.includes('لولوه')), 'search «ام فهد منصور» finds her: ' + found.slice(0, 3).join(' | '));
  await A.evaluate(() => document.querySelector('.shead .round')?.click());
  await wait(400);

  // merge the two records
  check(await openKid('لولوه', 0), 'the second record opens again');
  await wait(900);
  await click(A, 'دمج مع', '.page.profile button', 800);
  await shot(A, '31-merge-search');
  await pickRow(A, 'لولوة بن منصور', { skip: ['لولوه'] });
  await shot(A, '32-merge-sheet');
  const mergeWhy = await text(A, '.modal.merge .warnbox');
  note('merge with different mothers: ' + mergeWhy);
  if (mergeWhy) {
    // put her under the same mother, then merge
    await click(A, 'إغلاق', '.modal.merge .mhead button');
    await click(A, 'تعديل البيانات', '.page.profile button', 900);
    await scrollTo(A, 'الأم', '.q.small');
    await shot(A, '32b-edit-mother');
    await click(A, 'جواهر', '.parentpick .brow', 300);
    await click(A, 'حفظ', '.foot button', 1500);
    await click(A, 'دمج مع', '.page.profile button', 800);
    await pickRow(A, 'لولوة بن منصور', { skip: ['لولوه'] });
    await shot(A, '32c-merge-sheet-same-mother');
  }
  check(!(await text(A, '.modal.merge .warnbox')), 'the merge is allowed', await text(A, '.modal.merge .warnbox'));
  await click(A, 'دمج', '.modal.merge .btn.primary', 1800);
  await shot(A, '33-after-merge');
  if (await has(A, '.modal.merge')) await click(A, 'إغلاق', '.modal.merge .mhead button');
  await closeProfile(A);

  // Permissions on a member's profile: a living man in a main branch
  await openProfile(A, 'يحيى');
  const who = await text(A, '.page.profile h1');
  await shot(A, '34-member-profile', { at: 'الصلاحيات' });
  const perm = await text(A, '.page.profile section.perms');
  note('perms of ' + who + ': ' + perm.replace(/\s+/g, ' ').slice(0, 400));
  await shot(A, '35-member-perm-devices', { at: 'الدخول من الأجهزة' });

  // a gold key from the profile
  const gave = await A.evaluate(() => {
    const b = document.querySelector('.page.profile section.perms button[aria-label="منح المفتاح الذهبي"]');
    b?.click();
    return !!b;
  });
  await wait(1500);
  check(gave, 'a gold key is given from his profile');
  await shot(A, '36-member-perm-after-key', { at: 'الصلاحيات' });

  // invite him from the profile
  const invited = await click(A, 'دعوة', '.page.profile section.perms .permphone button.prow', 1500);
  check(invited, '«دعوة» on the profile');
  await shot(A, '37-invite-sheet');
  const link = await copyLink(A);
  check(!!link && link.includes('#join='), 'the invite link can be copied');
  await shot(A, '38-member-perm-pending', { at: 'الدخول من الأجهزة' });

  // ---- the member (a key holder) joins, adds a second phone, removes one
  const M = await phone('M', link);
  await shot(M, '40-join-personal');
  await click(M, 'نعم، أنا', '.join button');
  await until(() => M.evaluate(() => !!document.querySelector('nav.tabs')), 20000);
  await settle(M);
  await shot(M, '41-member-first-open');
  await M.evaluate(() => document.querySelector('.welcome .btn:not(.primary)')?.click());
  await tab(M, 'أنا');
  await shot(M, '42-member-me');
  await shot(M, '43-member-devices', { at: 'أجهزتي' });
  await click(M, 'إضافة جهاز', '.mydevs .card.cta', 1500);
  await shot(M, '44-member-add-device-sheet');
  const link2 = await copyLink(M);
  check(!!link2 && link2.includes('#join='), 'the add-device link can be copied');
  const M2 = await phone('M2', link2);
  await shot(M2, '45-join-extra-device');
  await click(M2, 'نعم، أنا', '.join button');
  await until(() => M2.evaluate(() => !!document.querySelector('nav.tabs')), 20000);
  await settle(M2);
  await M2.evaluate(() => document.querySelector('.welcome .btn:not(.primary)')?.click());
  await tab(M2, 'أنا');
  await shot(M2, '46-second-phone-devices', { at: 'أجهزتي' });
  await M.reload({ waitUntil: 'networkidle0' });
  await settle(M);
  await tab(M, 'أنا');
  await shot(M, '47-member-two-devices', { at: 'أجهزتي' });
  // rename the second one
  await M.evaluate(() => [...document.querySelectorAll('.mydevs .devlist .prow')].filter(r => !r.querySelector('.tag.here'))[0]?.querySelector('button')?.click());
  await wait(500);
  await shot(M, '48-member-rename', { at: 'أجهزتي' });
  await M.evaluate(() => { const i = document.querySelector('.mydevs .devedit input'); i.select(); });
  await M.keyboard.type('هاتف العمل', { delay: 8 });
  await click(M, 'حفظ', '.mydevs .devedit button', 1500);
  // remove it
  const nd = dialogs.length;
  await M.evaluate(() => [...document.querySelectorAll('.mydevs .devlist .prow')].filter(r => !r.querySelector('.tag.here'))[0]?.querySelectorAll('button')[1]?.click());
  await wait(2000);
  check(dialogs.length > nd, 'removing a device asks first: ' + (dialogs.at(-1)?.msg ?? ''));
  await shot(M, '49-member-after-remove', { at: 'أجهزتي' });
  // the last phone of a key holder
  await M.evaluate(() => document.querySelector('.mydevs .devlist .prow.here')?.querySelectorAll('button')[1]?.click());
  await wait(800);
  await shot(M, '50-member-last-phone', { at: 'أجهزتي' });
  check(await has(M, '.mydevs .warnbox', 'المفتاح'), 'a key holder is told to keep one phone');
  // the removed phone, opened again
  await M2.reload({ waitUntil: 'networkidle0' });
  await settle(M2);
  await wait(2500);
  await shot(M2, '51-removed-phone-reopens');

  // ---- a woman member: invite, lock, recovery kit
  await closeProfile(A);
  await openProfile(A, 'نوال بنت منصور');
  await shot(A, '52-woman-perm', { at: 'الصلاحيات' });
  await click(A, 'دعوة', '.page.profile section.perms .permphone button.prow', 1500);
  await shot(A, '53-woman-invite-sheet');
  const wlink = await copyLink(A);
  const Wp = await phone('W', wlink, { auth: true });
  await shot(Wp, '54-woman-join');
  await click(Wp, 'نعم، أنا', '.join button');
  await until(() => Wp.evaluate(() => !!document.querySelector('nav.tabs')), 20000);
  await settle(Wp);
  await Wp.evaluate(() => document.querySelector('.welcome .btn:not(.primary)')?.click());
  await tab(Wp, 'أنا');
  await shot(Wp, '55-woman-me');
  await shot(Wp, '56-woman-devices', { at: 'أجهزتي' });
  await Wp.evaluate(() => document.querySelector('.mydevs .btn.small')?.click());
  await wait(500);
  await shot(Wp, '57-woman-removeall-box', { at: 'إزالة كل الأجهزة', sel: '.removeall b' });
  await click(Wp, 'تراجع', '.removeall button');
  // Face ID lock
  await scrollTo(Wp, 'الأمان', 'h3');
  await click(Wp, 'مفعّل', ':is(.page.me, .page.admin) .seg button', 4000);
  await shot(Wp, '58-woman-lock-on', { at: 'الأمان' });
  const sealed = await Wp.evaluate(() => !localStorage.getItem('ft-family'));
  check(sealed, 'with the lock on the membership is not in plain storage');
  await Wp.reload({ waitUntil: 'networkidle0' });
  await wait(1500);
  await shot(Wp, '59-lock-screen');
  await click(Wp, 'لا أستطيع الفتح', '.join button');
  await shot(Wp, '60-lock-help');
  await click(Wp, 'افتح بالبصمة', '.join button', 3000);
  await settle(Wp);
  check(await Wp.evaluate(() => !!document.querySelector('nav.tabs')), 'Face ID opens the app');
  // recovery kit
  await tab(Wp, 'أنا');
  await scrollTo(Wp, 'الأمان', 'h3');
  await click(Wp, 'مفتاح الاستعادة', ':is(.page.me, .page.admin) .card.cta', 1000);
  await shot(Wp, '61-kit-sheet');
  await click(Wp, 'أكتب عبارتي', '.modal.kit button', 400);
  await Wp.type('.modal.kit input.pass', 'قمر', { delay: 8 });
  await shot(Wp, '62-kit-own-weak');
  await click(Wp, 'كلمات مقترحة', '.modal.kit button', 400);
  const words = await Wp.evaluate(() => [...document.querySelectorAll('.modal.kit .words span')].map(s => s.childNodes[1]?.textContent ?? s.innerText.replace(/^\d+/, '')).join(' '));
  await Wp.evaluate(() => document.querySelector('.modal.kit label.opt input')?.click());
  await wait(300);
  const t0 = Date.now();
  await click(Wp, 'إنشاء المفتاح', '.modal.kit button', 300);
  await until(() => Wp.evaluate(() => !!document.querySelector('.modal.kit .qr, .modal.kit.invite')), 30000, 200);
  note('kit made in ' + (Date.now() - t0) + ' ms');
  await shot(Wp, '63-kit-result');
  await Wp.evaluate(() => { window.__copied = null; });
  await click(Wp, 'نسخ', '.modal.kit button.primary', 600);
  const kit = await Wp.evaluate(() => window.__copied);
  check(!!kit && kit.includes('#restore='), 'the kit link can be copied');
  await click(Wp, 'إغلاق', '.modal.kit .mhead button');
  await shot(Wp, '64-woman-devices-with-kit', { at: 'أجهزتي' });
  // restore on a new phone
  const R = await phone('R', kit);
  await shot(R, '65-restore-screen');
  await R.type('.join input.pass', 'خطأ خطأ خطأ خطأ', { delay: 5 });
  await click(R, 'استعادة', '.join button', 300);
  await until(() => R.evaluate(() => !!document.querySelector('.join .warnbox')), 30000, 300);
  await shot(R, '66-restore-wrong');
  await R.evaluate(() => { const i = document.querySelector('.join input.pass'); i.select(); });
  await R.keyboard.type(words, { delay: 5 });
  const t1 = Date.now();
  await click(R, 'استعادة', '.join button', 300);
  await until(() => R.evaluate(() => !!document.querySelector('nav.tabs')), 40000, 300);
  note('restore took ' + (Date.now() - t1) + ' ms');
  await settle(R);
  await R.evaluate(() => document.querySelector('.welcome .btn:not(.primary)')?.click());
  await tab(R, 'أنا');
  await shot(R, '67-restored-me');
  await shot(R, '68-restored-devices', { at: 'أجهزتي' });
  // the lock off again
  await Wp.reload({ waitUntil: 'networkidle0' });
  await wait(1200);
  if (await has(Wp, '.join h2', 'مقفل')) await click(Wp, 'افتح بالبصمة', '.join button', 3000);
  await settle(Wp);
  await tab(Wp, 'أنا');
  await scrollTo(Wp, 'الأمان', 'h3');
  const nd2 = dialogs.length;
  await click(Wp, 'موقوف', ':is(.page.me, .page.admin) .seg button', 4000);
  check(dialogs.length > nd2, 'turning the lock off asks first');
  check(await Wp.evaluate(() => !!localStorage.getItem('ft-family')), 'the lock off puts the membership back');
  await shot(Wp, '69-woman-lock-off', { at: 'الأمان' });

  // ---- the root admin sees all of it on her profile
  await A.reload({ waitUntil: 'networkidle0' });
  await settle(A);
  await openProfile(A, 'نوال بنت منصور');
  await shot(A, '70-woman-perm-devices', { at: 'الدخول من الأجهزة' });
  // view all on her profile
  await scrollTo(A, 'الصلاحيات', 'h3');
  await click(A, 'مفعّلة', '.page.profile .perms .seg button', 1500);
  await shot(A, '71-woman-viewall-on', { at: 'الصلاحيات' });
  // a new phone for يحيى
  await closeProfile(A);
  await openProfile(A, 'يحيى');
  await shot(A, '72-fahd-perm-devices', { at: 'الدخول من الأجهزة' });
  const nd3 = dialogs.length;
  await click(A, 'جهاز جديد', '.page.profile .perms .permphone button', 2500);
  check(dialogs.length > nd3, '«جهاز جديد» asks first: ' + (dialogs.at(-1)?.msg ?? ''));
  await shot(A, '73-fahd-new-device-sheet');
  if (await has(A, '.modal.invite')) await click(A, 'إغلاق', '.modal.invite .mhead button');
  await shot(A, '74-fahd-after-new-device', { at: 'الدخول من الأجهزة' });
  await M.reload({ waitUntil: 'networkidle0' });
  await settle(M);
  await wait(2000);
  await shot(M, '75-fahd-old-phone');

  // ---- a guest
  await closeProfile(A);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await scrollTo(A, 'مشاهدة الكل', 'h3');
  await A.type('.guestnew input', 'أبو فيصل', { delay: 8 });
  await click(A, 'دعوة زائر', '.guestnew button', 1500);
  await shot(A, '76-guest-invite-sheet');
  const glink = await copyLink(A);
  const G = await phone('G', glink);
  await shot(G, '77-guest-join');
  await click(G, 'قبول الدعوة', '.join button');
  await until(() => G.evaluate(() => !!document.querySelector('nav.tabs')), 20000);
  await settle(G);
  await shot(G, '78-guest-tree');
  await G.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await shot(G, '79-guest-me');
  await openProfile(G, 'يحيى');
  await shot(G, '80-guest-profile');
  await closeProfile(G);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await shot(A, '81-admin-viewall-list', { at: 'مشاهدة الكل' });
  const nd4 = dialogs.length;
  await A.evaluate(() => [...document.querySelectorAll(':is(.page.me, .page.admin) button[aria-label="إنهاء"]')][0]?.click());
  await wait(2500);
  check(dialogs.length > nd4, 'ending a guest asks first');
  await G.reload({ waitUntil: 'networkidle0' });
  await settle(G);
  await wait(2000);
  await shot(G, '82-guest-ended');
  await shot(A, '83-admin-familykey-after', { at: 'مفتاح العائلة' });

  // ---- the trees, with outside spouses present
  await tab(A, 'الشجرة');
  await wait(1500);
  await shot(A, '84-tree-3d');
  note('3D drag frames: ' + JSON.stringify(await dragFrames(A)));
  await A.evaluate(() => [...document.querySelectorAll('.home .side button')][0]?.click());
  await wait(1500);
  await shot(A, '85-tree-2d');
  note('2D drag frames: ' + JSON.stringify(await dragFrames(A)));
  // focus on حمود: wives in the family view
  await A.evaluate(() => document.querySelector('.home .search')?.click());
  await wait(400);
  await pickRow(A, 'حمود بن تركي');
  await wait(1200);
  await shot(A, '86-2d-focus-husband');
  await A.evaluate(() => [...document.querySelectorAll('.home .side button')][0]?.click());
  await wait(1500);
  await shot(A, '87-3d-focus-husband');
  note('dialogs: ' + dialogs.map(d => d.who + ': ' + d.msg).join(' || '));
});
