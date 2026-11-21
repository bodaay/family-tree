// Fix check (UX review): restoring a kit checks it first; women are spoken to as
// women; «انتهى دخولك» survives a reload; narrow-screen layout of the invite row
// and the kit sheet; a typed passphrase of names is refused.
//   node fix-ux-kit.mjs <BASE url> <admin-link file>
// الجوهرة is invited by the root admin, joins, gets view all, and makes kit #1 and
// then kit #2 («إبطال المفتاح السابق»). On her own working phone kit #1 changes
// nothing and says it no longer works; kit #2 changes nothing either (no second
// device entry). On a new phone kit #1 is refused before anything is written;
// kit #2 brings her in. Her phone removes that new phone while it is open: it
// shows «انتهى دخولك», still after a reload, until «حسنًا».
import {
  check, run, wait, until, phone, click, tab, ready, ended, rootAdmin, meName, copyLink, myDevices, deviceButton,
  openProfile, perm, permButton, store, dialogs, keyVersions,
} from './multidev-lib.mjs';

const toastText = p => p.evaluate(() => document.querySelector('.toast')?.innerText ?? '');
async function makeKit(p, { own } = {}) {
  await tab(p, 'أنا');
  await click(p, 'مفتاح الاستعادة', '.card.cta');
  const words = await p.evaluate(() => [...document.querySelectorAll('.modal.kit .words span')].map(s => s.lastChild.textContent.trim()).join(' '));
  if (own) await own(p);
  await p.evaluate(() => document.querySelector('.modal.kit label.opt input').click());
  await wait(200);
  await click(p, 'إنشاء المفتاح');
  await p.waitForFunction(() => [...document.querySelectorAll('.modal.kit button')].some(b => b.textContent.trim() === 'نسخ'), { timeout: 30000 });
  const hint = await p.evaluate(() => [...document.querySelectorAll('.modal.kit .hint')].map(e => e.innerText).join(' '));
  await p.evaluate(() => { window.__copied = null; });
  await click(p, 'نسخ', '.modal.kit button');
  const link = await p.evaluate(() => window.__copied);
  const copied = await toastText(p);
  await click(p, 'إغلاق', '.mhead button');
  await wait(1000);
  return { link, words, hint, copied };
}
async function restoreOn(p, kit) {
  // a link with only a new "#" part does not load the page again by itself
  await p.goto(kit.link, { waitUntil: 'networkidle0' });
  await wait(500);
  if (!(await p.evaluate(() => !!document.querySelector('.join input.pass')))) await p.reload({ waitUntil: 'networkidle0' });
  await until(() => p.evaluate(() => !!document.querySelector('.join input.pass')));
  await p.type('.join input.pass', kit.words, { delay: 5 });
  await click(p, 'استعادة', '.join button', 300);
  await until(() => p.evaluate(() => !document.querySelector('.join input.pass') || !!document.querySelector('.join .warnbox')), 40000, 300);
  await wait(1500);
}

await run(async () => {
  const A = await rootAdmin();
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await A.type('.sfield input', 'الجوهرة', { delay: 10 });
  await wait(700);
  await A.evaluate(() => document.querySelector('.results .prow').click());
  await until(() => A.evaluate(() => !!document.querySelector('.modal.invite .qr svg')));
  const sheet = await A.evaluate(() => document.querySelector('.modal.invite .hint').innerText);
  check(sheet.includes('تفتح الرابط على هاتفها') && sheet.includes('يصبح هاتفها'), 'her invite sheet speaks of her as a woman', sheet);
  const link = await copyLink(A);

  const W = await phone('W', link);
  const asks = await W.evaluate(() => document.querySelector('.join')?.innerText ?? '');
  check(asks.includes('هل أنتِ هي؟') && asks.includes('يُنسب إليكِ'), 'her phone asks «هل أنتِ هي؟»', asks.slice(0, 160));
  await click(W, 'نعم، أنا');
  await until(() => ready(W));
  const who = await meName(W);
  check(await ready(W), 'الجوهرة joined', who);

  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  const row = await until(() => A.evaluate(n => [...document.querySelectorAll(':is(.page.me, .page.admin) .prow')].find(e => e.innerText.includes(n.split(' ')[0]) && e.innerText.includes('انضم'))?.innerText ?? null, who));
  check(!!row && row.includes('انضمت'), 'the members list says «انضمت»', row);
  check(await openProfile(A, who), 'the root admin opens her profile');
  await A.evaluate(() => [...document.querySelectorAll('.page.profile section.perms .seg.viewall button')].find(b => b.textContent.includes('مفعّلة')).click());
  const t = await until(async () => ((await toastText(A)).includes('الكل') ? toastText(A) : null));
  check(!!t && t.includes('أصبحت') && t.includes('ترى الكل'), 'turning view all on says «أصبحت … ترى الكل»', t);

  // her own «إضافة جهاز» speaks to her as a woman
  await tab(W, 'أنا');
  const cta = await W.evaluate(() => document.querySelector('.mydevs .card.cta small')?.innerText ?? '');
  await click(W, 'إضافة جهاز', '.mydevs .card.cta');
  const own = await until(() => W.evaluate(() => document.querySelector('.modal.invite .hint')?.innerText ?? null));
  check(cta.includes('افتحي الرابط') && !!own && own.includes('افتحي الرابط') && own.includes('أجهزتكِ'), 'her «إضافة جهاز» card and sheet say «افتحي الرابط»', cta + ' / ' + own);
  await click(W, 'إغلاق', '.mhead button');

  // the waiting-invite row on her profile, at 360 px: the label whole, the date on one or two lines
  await A.setViewport({ width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await wait(500);
  check(await permButton(A, 'جهاز إضافي', ''), 'the root admin taps «جهاز إضافي» (360 px wide)');
  const link2 = await copyLink(A);
  const pend = await until(() => A.evaluate(() => {
    const r = [...document.querySelectorAll('.page.profile .permphone .prow')].find(e => e.innerText.includes('دعوة بانتظار الانضمام'));
    if (!r) return null;
    const b = r.querySelector('.pt b'), sm = r.querySelector('.pt small'), pt = r.querySelector('.pt');
    const lines = Math.round(sm.getBoundingClientRect().height / parseFloat(getComputedStyle(sm).lineHeight || '20'));
    return { cut: b.scrollWidth > b.clientWidth + 1, ptw: pt.getBoundingClientRect().width, roww: r.getBoundingClientRect().width, lines, text: b.innerText };
  }));
  check(!!pend && !pend.cut && pend.text === 'دعوة بانتظار الانضمام', 'the waiting invite\'s label is not cut off', JSON.stringify(pend));
  check(!!pend && pend.ptw > pend.roww * 0.6 && pend.lines <= 2, 'its text keeps the row\'s width (buttons on their own line)', JSON.stringify(pend));
  await A.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  // kit #1, at 360 px: the checkbox keeps its size and a gap; a passphrase of names is refused
  await W.setViewport({ width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  let weak = '', box = null;
  const k1 = await makeKit(W, {
    own: async p => {
      box = await p.evaluate(() => {
        const o = document.querySelector('.modal.kit label.opt'), i = o.querySelector('input'), sp = o.querySelector('span');
        const ri = i.getBoundingClientRect(), rs = sp.getBoundingClientRect();
        return { w: Math.round(ri.width), gap: Math.round(Math.min(Math.abs(rs.left - ri.right), Math.abs(ri.left - rs.right))) };
      });
      await click(p, 'أكتب عبارتي', '.modal.kit button');
      await p.type('.modal.kit input.pass', 'نايف ثامر غازي فهد', { delay: 5 });
      await wait(300);
      weak = await p.evaluate(() => document.querySelector('.modal.kit .warnbox')?.innerText ?? '');
      await click(p, 'كلمات مقترحة', '.modal.kit button');
    },
  });
  check(!!box && box.w >= 21 && box.gap >= 10, 'the kit sheet\'s checkbox keeps its size, with a gap before the text (360 px)', JSON.stringify(box));
  check(weak.includes('سهلة التخمين'), 'a passphrase of names («نايف ثامر غازي فهد») is refused', weak);
  check(/#restore=/.test(k1.link ?? ''), 'الجوهرة made kit #1');
  check(k1.hint.includes('احفظي الرابط') && k1.hint.includes('أزلتِه') && k1.copied.includes('احفظيه'), 'the kit result speaks to her as a woman', k1.hint.slice(0, 80) + ' / ' + k1.copied);
  await W.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const v0 = await keyVersions();
  const k2 = await makeKit(W);
  check(/#restore=/.test(k2.link ?? ''), 'and kit #2, which ends kit #1');
  check(!!(await until(async () => (await keyVersions()) > v0, 25000)), 'the family key was renewed');
  const devs0 = (await myDevices(W)).filter(d => !d.name.startsWith('دعوة'));
  const dev0 = (await store(W, 'ft-device')).pk;

  // the old kit on her own working phone
  const nd = dialogs.length;
  await restoreOn(W, k1);
  check(dialogs.length === nd, 'nothing to confirm: the phone is not replaced', dialogs.slice(nd).join(' | '));
  const said1 = await toastText(W);
  check(said1.includes('مرتبط بكِ أصلًا') && said1.includes('لم يعد يعمل'), 'kit #1 on her own phone: «هذا الهاتف مرتبط بكِ أصلًا… ومفتاح الاستعادة هذا لم يعد يعمل»', said1);
  check((await ready(W)) && !!(await store(W, 'ft-family')) && (await store(W, 'ft-device')).pk === dev0, 'her phone keeps the family and its own key');
  // the current kit on her own phone: no second entry for the same phone
  await restoreOn(W, k2);
  const said2 = await toastText(W);
  check(said2.includes('مرتبط بكِ أصلًا') && !said2.includes('لم يعد'), 'kit #2 on her own phone: already linked, nothing changes', said2);
  await wait(2000);
  const devs1 = (await myDevices(W)).filter(d => !d.name.startsWith('دعوة'));
  check(devs1.length === devs0.length && (await store(W, 'ft-device')).pk === dev0, 'her devices are as they were (no new entry, same key)', devs1.map(d => d.name).join(' | '));

  // a new phone: kit #1 refused before anything is written; kit #2 works
  const N1 = await phone('N1');
  await restoreOn(N1, k1);
  const said3 = await N1.evaluate(() => document.querySelector('.join .warnbox')?.innerText ?? '');
  check(said3.includes('لم يعد مفتاح الاستعادة هذا يعمل'), 'kit #1 on a new phone says it no longer works', said3);
  check(!(await store(N1, 'ft-family')) && !(await store(N1, 'ft-device')), 'and writes nothing there');
  const N2 = await phone('N2');
  await restoreOn(N2, k2);
  await until(() => ready(N2), 30000);
  check((await ready(N2)) && (await meName(N2)) === who, 'kit #2 brings her in on a new phone', await meName(N2));

  // removed while it is open: «انتهى دخولك», also after a reload, until «حسنًا»
  await tab(N2, 'الشجرة');
  await tab(W, 'أنا');
  // the other phone's row (both phones carry the same browser name here)
  const removed = await W.evaluate(() => {
    const r = [...document.querySelectorAll('.mydevs .devlist .prow')].find(e => !e.querySelector('.tag.here') && !/^(مفتاح الاستعادة|دعوة)/.test(e.querySelector('.pt b')?.innerText.trim() ?? ''));
    const b = r && [...r.querySelectorAll('button')].find(x => x.textContent.includes('إزالة'));
    b?.click();
    return !!b;
  });
  await wait(900);
  check(removed, 'her phone removes the new phone', JSON.stringify(await myDevices(W)));
  check(!!(await until(() => ended(N2), 20000)), 'the open phone shows «انتهى دخولك»');
  await N2.reload({ waitUntil: 'networkidle0' });
  await wait(1500);
  check(await ended(N2), 'still «انتهى دخولك» after a reload');
  await click(N2, 'حسنًا', '.join button');
  await N2.reload({ waitUntil: 'networkidle0' });
  await wait(1200);
  check(!(await ended(N2)) && (await N2.evaluate(() => !!document.querySelector('.join h1'))), 'after «حسنًا» (and a reload) the plain join screen');
});
