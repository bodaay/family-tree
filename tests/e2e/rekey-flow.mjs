// Family key renewal, end to end on a local family:
//   node rekey-flow.mjs <BASE url> <admin-link file>
// Root admin A, members B and C (personal invites) and a guest G. A unlinks C:
// the key is renewed; B and G keep reading (B keeps writing); C's phone forgets
// the family, and C's old keys cannot open anything after the renewal. A new
// invite made afterwards reads the whole history. A renewal forged by B is
// ignored by everyone. Prints PASS/FAIL lines; exits non-zero on any failure.
// Never prints links or keys.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [BASE, LINKFILE] = process.argv.slice(2);
if (!BASE || !LINKFILE) {
  console.log('usage: node rekey-flow.mjs <BASE url> <admin-link file>');
  process.exit(2);
}
const base = BASE.replace(/\/+$/, '');
const repo = process.env.FT_REPO ?? path.resolve(path.dirname(path.resolve(LINKFILE)), '../..');
const { openLog, addKeys } = await import(path.join(repo, 'src/core/keyring.ts'));
const { makeEntry, entryHash, openEntry } = await import(path.join(repo, 'src/core/log.ts'));
const C$ = await import(path.join(repo, 'src/core/crypto.ts'));

const adminLink = (() => {
  const line = fs.readFileSync(LINKFILE, 'utf8').split('\n').find(l => /^https?:\/\/localhost[:/]/.test(l));
  if (!line) throw new Error('no local admin link in the file');
  return base + line.slice(new URL(line).origin.length);
})();
const fid = adminLink.match(/join=([a-z0-9]+)\./)[1];

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' - ' + detail : ''}`);
  return ok;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 400) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = null; }
    if (v || Date.now() > end) return v;
    await wait(step);
  }
}
const fetchLog = async () => (await (await fetch(`${base}/api/f/${fid}/log?after=-1`)).json()).entries;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars'] });
const errs = [];
async function phone(name, link) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errs.push(name + ': ' + e.message + (process.env.STACK ? ' @ ' + (e.stack || '').split('\n').slice(1, 6).join(' <- ') : '')));
  page.on('console', m => { if (m.type() === 'error') errs.push(name + ': ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(link, { waitUntil: 'networkidle0' });
  await settle(page);
  return page;
}
const settle = async p => { await until(() => p.evaluate(() => !document.querySelector('.wl-mark.spin'))); await wait(600); };
const click = async (p, text, sel = 'button') => {
  const ok = await p.evaluate((t, s) => { const b = [...document.querySelectorAll(s)].find(e => e.textContent.includes(t)); b?.click(); return !!b; }, text, sel);
  if (!ok) console.log('  (button not found: ' + text + ')');
  await wait(700);
  return ok;
};
const tab = (p, label) => click(p, label, '.tab');
const ready = p => p.evaluate(() => !!document.querySelector('nav.tabs') && !document.querySelector('.join'));
const people = p => p.evaluate(() => document.querySelector('.top .sub b')?.innerText);
// picks a search result not used before; returns the row's name line
async function pickRow(p, q, skip) {
  await p.type('.sfield input', q, { delay: 10 });
  await wait(600);
  const who = await p.evaluate(sk => {
    const r = [...document.querySelectorAll('.results .prow')].find(e => !sk.includes(e.querySelector('b').innerText.trim()));
    r?.click();
    return r?.querySelector('b').innerText.trim();
  }, skip);
  await wait(1500);
  return who;
}
// the link the app itself hands out (its copy button), not one built here
async function copyLink(p) {
  await until(() => p.evaluate(() => !!document.querySelector('.modal.invite')));
  await p.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async t => { window.__copied = t; }; });
  await click(p, 'نسخ الرابط');
  const link = await p.evaluate(() => window.__copied);
  await click(p, 'إغلاق', '.mhead button');
  return link;
}
async function invite(p, q, skip) {
  await p.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await p.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(p, 'دعوة فرد');
  const who = await pickRow(p, q, skip);
  return { who, link: await copyLink(p) };
}
async function addChild(p, name, direct) {
  await tab(p, 'الشجرة');
  await p.evaluate(() => document.querySelector('.fab').click());
  await wait(600);
  // someone with a wife recorded is first asked who the mother is: the one already chosen
  if (await p.evaluate(() => document.querySelector('.addsheet .q')?.textContent === 'من الأم؟')) await click(p, 'التالي');
  await click(p, 'ابن', '.bigchoice button');
  await click(p, 'التالي');
  await p.type('.bigin', name, { delay: 10 });
  await click(p, 'التالي');
  await click(p, 'التالي');
  // a key holder whose key covers it adds at once (since 1.19): «إضافة إلى الشجرة» then too
  const send = direct || !(await p.evaluate(() => [...document.querySelectorAll('.addsheet .foot button')].some(b => b.textContent.includes('إرسال للاعتماد')))) ? 'إضافة إلى الشجرة' : 'إرسال للاعتماد';
  await click(p, send);
  await wait(1500);
}
const kidOfLink = link => C$.keyId(C$.unb64(link.match(/join=[a-z0-9]+\.([A-Za-z0-9_-]+)\./)[1]));
const store = (p, k) => p.evaluate(k => localStorage.getItem(k), k);
// names unique to this run, so the script can run again on the same family
const tag = String(Date.now()).slice(-4);

try {
  // ---- the sample family (no link) still works: act as a key holder and send a request
  {
    const S = await phone('S', base + '/');
    await click(S, 'جرّب العائلة التجريبية');
    await settle(S);
    await click(S, 'تصفّح أولًا');
    await S.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
    await S.evaluate(() => [...document.querySelectorAll('h3')].find(h => h.textContent.includes('عرض التطبيق'))?.closest('section').querySelector('.prow')?.click());
    await wait(500);
    await addChild(S, 'تجريبي' + tag, false);
    await tab(S, 'الطلبات');
    check('the sample family still works (a request is sent and listed)', !!(await until(() => S.evaluate(t => document.body.innerText.includes(t), 'تجريبي' + tag))));
    check('the sample family shows no family-key section', !(await S.evaluate(() => [...document.querySelectorAll('h3')].some(h => h.textContent.includes('مفتاح العائلة') && !h.textContent.includes('مفاتيح')))));
  }

  // ---- set up: A links to the tree, gives the platinum key, invites B, C and a guest
  const A = await phone('A', adminLink);
  await click(A, 'اربط باسمي');
  const me = await pickRow(A, 'منصور', []);
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  // the platinum holder: the eldest suggestion (or whoever holds it already, on a rerun)
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  let platinum = await A.evaluate(() => { const k = document.querySelector('button.keyrow.platinum'); return k.classList.contains('empty') ? null : k.querySelector('.kn').innerText.trim(); });
  if (!platinum) {
    await click(A, 'بلاتيني', 'button.keyrow');
    platinum = await A.evaluate(() => { const r = document.querySelector('.results .prow'); const t = r.querySelector('b').innerText.trim(); r.click(); return t; });
    await wait(1500);
  }
  const used = [me, ...(await A.evaluate(() => [...document.querySelectorAll('.prow b')].map(b => b.innerText.trim())))];
  const b = await invite(A, 'محمد', used); used.push(b.who);
  const c = await invite(A, 'محمد', used); used.push(c.who);
  check('A made personal invites for B and C', !!(b.link && c.link && b.who && c.who && b.who !== c.who));
  const B = await phone('B', b.link);
  await click(B, 'نعم، أنا');
  const C = await phone('C', c.link);
  await click(C, 'نعم، أنا');
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.type('.guestnew input', 'زائر الاختبار', { delay: 10 });
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة زائر للمشاهدة');
  const gLink = await copyLink(A);
  const G = await phone('G', gLink);
  await click(G, 'قبول الدعوة');
  check('B, C and the guest joined', (await until(() => ready(B))) && (await until(() => ready(C))) && (await until(() => ready(G))));

  // C's keys as they were before being unlinked (someone could have copied them)
  const cOld = { m: JSON.parse(await store(C, 'ft-family')), d: JSON.parse(await store(C, 'ft-device')) };
  // where the family stands (the version A shows: the log may also hold key ids from forged renewals)
  const before = await fetchLog();
  const known = new Set(before.map(e => e.kid));
  const kid1 = before.at(-1).kid;
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  const v0 = Number(await A.evaluate(async () => { const t = [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')); if (t && !document.querySelector('.page.admin')) { t.click(); await new Promise(r => setTimeout(r, 500)); } return [...document.querySelectorAll('.hint')].map(h => h.innerText.match(/الإصدار (\d+)/)?.[1]).find(Boolean); }));
  check('A shows the family key version', v0 >= 1);

  // ---- A unlinks C: the key is renewed
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  const unlinked = await A.evaluate(name => {
    const row = [...document.querySelectorAll('.prow')].find(e => e.querySelector('b')?.innerText.trim() === name && e.innerText.includes('انضم'));
    row?.querySelector('button[aria-label="إلغاء"]').click();
    return !!row;
  }, c.who);
  check('A unlinks C from the members list', unlinked);
  const after = await until(async () => { const l = await fetchLog(); return l.some(e => !known.has(e.kid)) && !known.has(l.at(-1).kid) ? l : null; });
  check('a renewal appears in the log: entries after it use a new key version', !!after);
  const kid2 = after?.at(-1).kid;
  const rekeyAt = after ? after.findIndex(e => e.kid === kid2) - 1 : -1;
  const vText = 'الإصدار ' + (v0 + 1);
  check(`A sees the family key at version ${v0 + 1}`, !!(await until(() => A.evaluate(t => [...document.querySelectorAll('.hint')].some(h => h.innerText.includes(t)), vText))));

  // ---- C's phone forgets the family
  const cGone = await until(() => C.evaluate(() => document.querySelector('.join h2')?.innerText.includes('انتهى دخولك') && !localStorage.getItem('ft-family')), 15000);
  check("C's phone removed the family and its keys", !!cGone);

  // ---- C's old keys cannot open anything after the renewal
  {
    const log = await fetchLog();
    const ring = new Map();
    addKeys(ring, [cOld.m.key, ...Object.values(cOld.m.keys ?? {})]);
    const opened = [];
    openLog(log, opened, ring, [cOld.d.sk, cOld.m.invite].filter(Boolean));
    const later = log.slice(rekeyAt + 1);
    const readable = later.filter((e, i) => opened[rekeyAt + 1 + i]);
    let direct = 0;
    for (const e of later) { try { openEntry(C$.unb64(cOld.m.key), e); direct++; } catch { /* sealed */ } }
    check(`C's old keys open nothing after the renewal (${later.length} entries)`, later.length > 0 && readable.length === 0 && direct === 0 && !ring.has(kid2));
    check("C's old keys still open what C already saw", ring.has(kid1) && log.slice(0, rekeyAt + 1).every((e, i) => !ring.has(e.kid) || opened[i]));
  }

  // ---- B and the guest keep reading; B and A keep writing, with the new key
  check('B and the guest are still in', (await ready(B)) && (await ready(G)));
  await tab(A, 'الشجرة');
  const n0 = Number((await people(A))?.replace(/,/g, ''));
  check('A sees the people count', n0 > 0);
  await addChild(A, 'مختبر' + tag, true);
  let n1 = n0 + 1;
  const seen = async p => { await tab(p, 'الشجرة'); return until(async () => Number((await people(p))?.replace(/,/g, '')) === n1); };
  check('A adds a person after the renewal', Number((await people(A))?.replace(/,/g, '')) === n1);
  check('B reads it', !!(await seen(B)));
  check('the guest reads it', !!(await seen(G)));
  await addChild(B, 'مقترح' + tag, false);
  await tab(A, 'الطلبات');
  check("B's request reaches A", !!(await until(() => A.evaluate(t => [...document.querySelectorAll('.req, .card')].some(e => e.innerText.includes(t)), 'مقترح' + tag))));
  // a key holder's own request his key covers is added at once (since 1.19): one more in the tree
  if (await A.evaluate(async t => (await window.__mod?.('/src/data/store.ts') ?? await import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts'))).getState().txs.some(x => x.title.includes(t) && x.status === 'approved'), 'مقترح' + tag)) n1++;
  check('new entries use the new key', (await fetchLog()).slice(rekeyAt + 1).every(e => e.kid === kid2));

  // ---- an invite made after the renewal carries the new key and reads the whole history
  const d = await invite(A, 'محمد', used); used.push(d.who);
  check("a new invite's link carries the newest key", !!d.link && kidOfLink(d.link) === kid2);
  const D = await phone('D', d.link);
  await click(D, 'نعم، أنا');
  check('D joined with it', !!(await until(() => ready(D))));
  await D.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await D.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  const dPlat = await D.evaluate(() => document.querySelector('button.keyrow.platinum .kn')?.innerText.trim());
  check('D sees what was done before the renewal (the platinum key holder)', !!dPlat && platinum.startsWith(dPlat));
  await tab(D, 'الشجرة');
  check('D sees everyone, including the person added after it', !!(await until(async () => Number((await people(D))?.replace(/,/g, '')) === n1)));
  const dm = JSON.parse(await store(D, 'ft-family'));
  // after the move to per-person keys (MOVE=1), a member who joins later reads the log from the move on: never the versions before it
  const moved = await D.evaluate(() => import(performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/data/store.ts') ?? '/src/data/store.ts').then(m => m.getState().sealedEra));
  if (moved) check("D's phone learned the key versions since the move, and none before it", !dm.keys?.[before[0].kid] && !!dm.keys?.[kid1] && !!dm.keys?.[kid2]);
  else check("D's phone learned the earlier key versions", !!dm.keys?.[before[0].kid] && !!dm.keys?.[kid1] && !!dm.keys?.[kid2]);
  const counts = async p => { await tab(p, 'أنا'); return p.evaluate(() => [...document.querySelectorAll('.srow')].find(r => r.innerText.includes('التغييرات'))?.querySelector('b').innerText); };
  // the row reads «people · changes»: the changes
  const changes = t => Number(String(t).split('·').pop().replace(/[^0-9]/g, ''));
  const [td, ta] = [await counts(D), await counts(A)];
  const [cd, ca] = [changes(td), changes(ta)];
  if (moved) check('D reads the entries since the move, A those before it too', cd > 0 && cd < ca, `${cd} / ${ca}`);
  else check('D reads every entry A reads', td === ta);

  // ---- B forges a renewal (signed with B's own phone key, claiming to be the platinum holder)
  {
    const bm = JSON.parse(await store(B, 'ft-family'));
    const bd = JSON.parse(await store(B, 'ft-device'));
    const log = await fetchLog();
    const ring = new Map();
    addKeys(ring, [bm.key, ...Object.values(bm.keys ?? {})]);
    const opened = [];
    openLog(log, opened, ring, [bd.sk]);
    const plat = opened.filter(p => p?.type === 'admin' && p.act.kind === 'appoint' && p.act.tier === 'platinum').pop().act.holder;
    // the new key goes to every phone and key B can find, so only the rule about who may renew stops it
    const pubs = new Set([log[0].pub]);
    for (const p of opened) {
      if (p?.type === 'claim') pubs.add(p.device);
      if (p?.type === 'admin' && p.act.kind === 'invite') pubs.add(p.act.key);
      if (p?.type === 'access' && p.act.kind === 'guest') pubs.add(p.act.key);
    }
    const k3 = C$.newFamilyKey();
    const cur = ring.get(kid2);
    const dev = { sk: bd.sk, pk: bd.pk };
    const put = async e => (await fetch(`${base}/api/f/${fid}/log/${e.n}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) })).status;
    const e1 = makeEntry(cur, dev, log.length, entryHash(log.at(-1)), { type: 'rekey', kid: C$.keyId(k3), ...C$.wrapKey(k3, [...pubs]), by: plat });
    const s1 = await put(e1);
    const tx = { id: 'tx-forged-' + tag, at: Date.now(), by: opened.find(p => p?.type === 'propose')?.tx.by ?? plat, title: 'طلب بمفتاح مزوّر', subject: plat, level: 'everyday', branch: null, ops: [], status: 'pending', approvals: [] };
    const e2 = makeEntry(k3, dev, log.length + 1, entryHash(e1), { type: 'propose', tx });
    const s2 = await put(e2);
    // what follows under B's own key: stored, or refused by the server's write check (feat/writegate)
    check('the server stores the forged renewal (it cannot read it)', s1 === 201 && (s2 === 201 || s2 === 403), `${s1} ${s2}`);
  }
  await wait(4500);
  check('after the forgery, A, B, the guest and D are all still in', (await ready(A)) && (await ready(B)) && (await ready(G)) && (await ready(D)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  check(`A still sees version ${v0 + 1}`, await A.evaluate(t => [...document.querySelectorAll('.hint')].some(h => h.innerText.includes(t)), vText));
  await tab(A, 'الطلبات');
  check("the request sealed with B's key is ignored", !(await A.evaluate(() => document.body.innerText.includes('بمفتاح مزوّر'))));
  await addChild(A, 'بعدالتزوير' + tag, true);
  const last = (await fetchLog()).at(-1);
  check('A keeps writing with the real current key', last.kid === kid2);
  check('the guest and B read it', !!(await seen2(G)) && !!(await seen2(B)));
  async function seen2(p) { await tab(p, 'الشجرة'); return until(async () => Number((await people(p))?.replace(/,/g, '')) === n1 + 1); }
  // B's own app is not swayed by the key it forged
  await addChild(B, 'مقترحثان' + tag, false);
  const bLast = (await fetchLog()).at(-1);
  await tab(A, 'الطلبات');
  check('B keeps writing with the real current key, and A reads it', bLast.kid === kid2 && !!(await until(() => A.evaluate(t => document.body.innerText.includes(t), 'مقترحثان' + tag))));

  // ---- at the end, C's old keys still open nothing written after the renewal
  {
    const log = await fetchLog();
    const ring = new Map();
    addKeys(ring, [cOld.m.key, ...Object.values(cOld.m.keys ?? {})]);
    const opened = [];
    openLog(log, opened, ring, [cOld.d.sk, cOld.m.invite].filter(Boolean));
    const later = log.slice(rekeyAt + 1);
    check(`at the end, C's old keys open none of the ${later.length} entries after the renewal`, later.length > 5 && later.every((e, i) => !opened[rekeyAt + 1 + i]));
  }
} catch (e) {
  check('script ran to the end', false, e.stack);
}
await browser.close();
check('no page or console errors', errs.length === 0, errs.join(' | '));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
