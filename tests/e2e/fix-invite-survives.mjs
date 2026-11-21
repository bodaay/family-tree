// Fix check: a removed phone's waiting invites go with it (secrev-invite-survives).
//   node fix-invite-survives.mjs <BASE url> <admin-link file>
// B joins on B1, adds B2 with «إضافة جهاز», and B1 makes one more device invite
// that is never used. B removes B1 from أجهزتي on B2: the confirmation says the
// invites it made are cancelled, the waiting row disappears, the root admin's
// phone renews the key without a copy for the invite, and the link (or the
// secret B1 stored) opens nothing: «أُلغيت هذه الدعوة». Then the root admin's
// «فصل الجهاز» on B2 cancels the invite B2 made the same way.
import {
  check, run, wait, until, phone, join, click, tab, ready, ended, rootAdmin, addChild, fresh, people, copyLink,
  myDevices, deviceButton, addDeviceLink, keysOf, fetchLog, keyVersions, opensAfter, meName, store, fid, dialogs,
  openProfile, perm, permButton,
} from './multidev-lib.mjs';

async function renameHere(p, name) {
  await deviceButton(p, 'هذا الجهاز', 'تسمية');
  await p.evaluate(n => {
    const inp = document.querySelector('.mydevs .devedit input');
    inp.value = n;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, name);
  await click(p, 'حفظ', '.mydevs .devedit button');
  await wait(1200);
}
const waitingRows = async p => (await myDevices(p)).filter(d => d.name.startsWith('دعوة جهاز')).length;

await run(async () => {
  const A = await rootAdmin();
  const used = [await meName(A)];
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()).then(() => new Promise(r => setTimeout(r, 600)));
  await A.evaluate(() => ([...document.querySelectorAll('.tab')].find(e => e.textContent.includes('الإدارة')) ?? [...document.querySelectorAll('.tab')].find(e => e.textContent.includes('أنا')))?.click()); await new Promise(r => setTimeout(r, 400));
  await click(A, 'دعوة فرد');
  await A.type('.sfield input', 'محمد', { delay: 10 });
  await wait(600);
  await A.evaluate(sk => [...document.querySelectorAll('.results .prow')].find(e => !sk.includes(e.querySelector('b').innerText.split('\n')[0].trim())).click(), used);
  await wait(1500);
  const B1 = await join('B1', await copyLink(A));
  const who = await meName(B1);
  check(await ready(B1), 'B joined on B1', who);
  await renameHere(B1, 'الهاتف القديم');
  const B2 = await join('B2', await addDeviceLink(B1));
  check(await ready(B2), 'B added B2');

  const spare = await addDeviceLink(B1);
  check(!!spare, 'B1 made a second device invite, still waiting');
  const stolen = { ...(await keysOf(B1)), invites: await store(B1, 'ft-invites:' + fid) };
  check(Object.keys(stolen.invites ?? {}).length >= 1, 'B1 keeps the invite secrets it made in its storage (what a thief takes)');
  check(!!(await until(async () => (await waitingRows(B2)) === 1)), 'B2 lists the waiting invite B1 made');

  await until(async () => (await myDevices(B2)).some(d => d.name === 'الهاتف القديم'));
  const v0 = await keyVersions();
  check(await deviceButton(B2, 'الهاتف القديم', 'إزالة'), 'B taps «إزالة» on the stolen phone (from B2)');
  check(/وتُلغى الدعوات التي أنشأها ولم تُفتح/.test(dialogs.at(-1) ?? ''), 'the confirmation says the invites it made are cancelled too', dialogs.at(-1));
  check(!!(await until(() => ended(B1), 15000)), 'B1 forgets the family');
  check(!!(await until(async () => (await keyVersions()) > v0, 25000)), "the root admin's phone renewed the family key");
  check(!!(await until(async () => (await waitingRows(B2)) === 0)), 'the waiting invite is gone from B2\'s أجهزتي');
  const log = await fetchLog();
  const kid = log.at(-1).kid;
  const renewal = log.findIndex(e => e.kid === kid) - 1;
  const spareSk = spare.match(/\.i([0-9a-f]{64})/)[1];
  const C$ = await import(process.env.FT_REPO + '/src/core/crypto.ts');
  const sparePk = C$.deviceFromSecret(spareSk).pk;
  // the renewal (a 'rekey' entry, sealed with the key before it) hands no copy to the cancelled invite
  const L$ = await import(process.env.FT_REPO + '/src/core/log.ts');
  const K$ = await import(process.env.FT_REPO + '/src/core/keyring.ts');
  const ring = new Map();
  K$.addKeys(ring, [stolen.m.key, ...Object.values(stolen.m.keys ?? {})]);
  const rekey = L$.openEntry(ring.get(log[renewal].kid), log[renewal]);
  check(rekey.type === 'rekey' && !Object.hasOwn(rekey.wraps, sparePk), 'the renewal has no copy for the cancelled invite', rekey.type);

  const n0 = await people(A);
  await addChild(A, fresh('سري'), true);
  check(!!(await until(async () => (await people(B2)) === n0 + 1)), 'B2 reads the entry written after the renewal');
  const withInv = await opensAfter(stolen.m, [stolen.d.sk, ...Object.values(stolen.invites)], renewal);
  check(withInv.opened === 0, `with everything B1 stored (its invite secrets too) nothing after the renewal opens (${withInv.opened} of ${withInv.later})`, JSON.stringify(withInv));

  // the thief opens the cancelled invite on a fresh phone
  const T = await phone('T', spare);
  await wait(1500);
  // left out of the renewal, it reads nothing after it and forgets the family at once
  const said = await T.evaluate(() => document.querySelector('.join')?.innerText ?? '');
  check(!(await ready(T)) && /أُلغيت هذه الدعوة|انتهى دخولك/.test(said) && !(await store(T, 'ft-family')), 'the thief\'s new phone cannot join, and keeps nothing', said.slice(0, 80));
  const listed = await myDevices(B2);
  check(listed.length === 1 && listed[0].here, 'B2 lists only itself', listed.map(d => d.name).join(' | '));

  // the root admin's «فصل الجهاز» does the same to an invite B2 made
  const spare2 = await addDeviceLink(B2);
  check(!!spare2, 'B2 makes a device invite of its own');
  const v1 = await keyVersions();
  check(await openProfile(A, who), 'the root admin opens B\'s profile');
  await until(async () => (await perm(A))?.rows.some(r => r.includes('دعوة بانتظار الانضمام')));
  check(await permButton(A, '', 'فصل الجهاز'), 'and taps «فصل الجهاز» on B2');
  check(/وتُلغى الدعوات التي أنشأها ولم تُفتح/.test(dialogs.at(-1) ?? ''), 'his confirmation names the invite too', dialogs.at(-1));
  check(!!(await until(async () => (await keyVersions()) > v1, 25000)), 'the key is renewed');
  check(!!(await until(() => ended(B2), 15000)), 'B2 forgets the family');
  check(!!(await until(async () => !(await perm(A))?.rows.some(r => r.includes('دعوة بانتظار الانضمام')))), 'no invite of B is left waiting on his profile');
  const T2 = await phone('T2', spare2);
  await wait(1500);
  check(!(await ready(T2)) && /أُلغيت هذه الدعوة|انتهى دخولك/.test(await T2.evaluate(() => document.querySelector('.join')?.innerText ?? '')), 'B2\'s invite opens nothing either');
});
