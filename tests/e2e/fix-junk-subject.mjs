// Fix check: a request about someone not in the tree breaks nothing (secrev-junk-subject).
//   node fix-junk-subject.mjs <BASE url> <admin-link file>
// With a platinum key holder in the family, member B writes a request about
// «nobody». Every phone shows it closed in the history («أُغلق: …»), not
// waiting, and the requests tab and badge work. Then B sends a real request
// (another name for his son); the root admin deletes the son: the request is
// closed the same way, on every phone, and nothing throws.
import {
  check, run, wait, until, join, click, tab, ready, rootAdmin, invite, keysOf, forge, meName, meId,
} from './multidev-lib.mjs';

async function seat(A, tier, skip) {
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await A.evaluate(t => [...document.querySelectorAll('button.keyrow.empty')].find(e => e.innerText.includes(t)).click(), tier);
  await wait(800);
  const name = await A.evaluate(sk => {
    const row = [...document.querySelectorAll('.results .prow')].find(e => !sk.includes(e.querySelector('b').innerText.split('\n')[0].trim()));
    row.click();
    return row.querySelector('b').innerText.split('\n')[0].trim();
  }, skip);
  await wait(1500);
  return name;
}
const requests = p => p.evaluate(() => ({
  pending: document.querySelectorAll('.page.requests .card.req').length,
  history: [...document.querySelectorAll('.page.requests .card.hist small')].map(e => e.innerText.trim()),
  badge: document.querySelector('.tab .badge')?.innerText ?? '',
}));

await run(async () => {
  const A = await rootAdmin();
  const used = [await meName(A)];
  used.push(await seat(A, 'بلاتيني', used));
  const b = await invite(A, 'محمد', used);
  const B1 = await join('B1', b.link);
  check(await ready(B1), 'B (no key) joined');
  const bId = await meId(B1);
  const bk = await keysOf(B1);
  const tx = { id: 'txjunk1', at: Date.now(), by: bId, title: 'طلب', subject: 'nobody', level: 'everyday', branch: null, ops: [], status: 'pending', approvals: [] };
  check((await forge(bk.m, bk.d, [bk.d.sk], { type: 'propose', tx })) === 201, 'B writes one request about someone not in the tree');
  await wait(4000);
  for (const [p, who] of [[A, 'the root admin'], [B1, 'B']]) {
    await tab(p, 'الطلبات');
    await wait(1200);
    const r = await requests(p);
    check(r.pending === 0, `${who}: it is not listed as waiting`, JSON.stringify(r));
    check(r.history.some(t => t.includes('أُغلق: من يخصه الطلب ليس في الشجرة')), `${who}: it is in the history, closed («أُغلق: من يخصه الطلب ليس في الشجرة»)`, JSON.stringify(r.history));
    await tab(p, 'الشجرة');
    await wait(800);
    check(await p.evaluate(() => !!document.querySelector('nav.tabs') && document.body.innerText.length > 100), `${who}: the app still works`);
  }
  await A.reload({ waitUntil: 'networkidle0' });
  await wait(2500);
  await tab(A, 'الطلبات');
  await wait(1000);
  check((await requests(A)).pending === 0, 'the same after a reload');

  // a real request about a person the root admin then deletes
  const son = { id: 'nfix' + Date.now(), name: 'تجربة', sex: 'm', father: bId };
  const add = { id: 'txfix-add', at: Date.now(), by: '', title: 'إضافة ابن: تجربة', subject: bId, level: 'everyday', branch: null, ops: [{ op: 'addPerson', person: son }], status: 'approved', approvals: [] };
  const ak = await keysOf(A);
  const C$ = await import(process.env.FT_REPO + '/src/core/crypto.ts');
  check((await forge(ak.m, C$.deviceFromSecret(ak.m.admin), [ak.d.sk, ak.m.admin], { type: 'admin', act: { kind: 'edit', tx: add }, by: null })) === 201, 'the root admin adds a son to B (directly)');
  await wait(3500);
  const ask = { id: 'txfix-alias', at: Date.now(), by: bId, title: 'اسم آخر: تجربة', subject: son.id, level: 'everyday', branch: null, ops: [{ op: 'updatePerson', id: son.id, before: { aliases: null }, after: { aliases: [{ type: 'kunya', text: 'أبو سعد' }] } }], status: 'pending', approvals: [] };
  check((await forge(bk.m, bk.d, [bk.d.sk], { type: 'propose', tx: ask })) === 201, 'B asks for another name for his son');
  await wait(3500);
  await tab(A, 'الطلبات');
  await wait(1000);
  check((await requests(A)).pending === 1, 'the request waits on the root admin\'s phone');
  const del = { id: 'txfix-del', at: Date.now(), by: '', title: 'حذف: تجربة', subject: bId, level: 'everyday', branch: null, ops: [{ op: 'removePerson', person: son }], status: 'approved', approvals: [] };
  check((await forge(ak.m, C$.deviceFromSecret(ak.m.admin), [ak.d.sk, ak.m.admin], { type: 'admin', act: { kind: 'edit', tx: del }, by: null })) === 201, 'the root admin deletes the son');
  await wait(4000);
  for (const [p, who] of [[A, 'the root admin'], [B1, 'B']]) {
    await tab(p, 'الشجرة');
    await tab(p, 'الطلبات');
    await wait(1200);
    const r = await requests(p);
    check(r.pending === 0 && r.history.filter(t => t.includes('أُغلق')).length === 2, `${who}: that request is closed too`, JSON.stringify(r));
  }
});
