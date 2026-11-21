// Root admin: edit, move, delete with descendants, and undo (the older edit.mjs
// flow, on the integration build):
//   node int-old-edit.mjs <BASE url> <admin-link file>
import { adminLink, check, click, people, phone, run, tab, wait } from './int-lib.mjs';

await run(async () => {
  const page = await phone('A', adminLink);
  const openProfile = async (q, has) => {
    await tab(page, 'الشجرة');
    await page.evaluate(() => document.querySelector('.home .search')?.click());
    await wait(400);
    await page.type('.sfield input', q, { delay: 10 });
    await wait(600);
    const ok = await page.evaluate(y => {
      const r = [...document.querySelectorAll('.results .prow')].find(e => e.innerText.includes(y));
      r?.click();
      return !!r;
    }, has);
    await wait(1200);
    await click(page, 'الملف الكامل');
    return ok;
  };
  await click(page, 'تصفّح');
  const start = await people(page);
  check(start > 600, 'the family opens with its people', String(start));

  // يزيد (2024, link not confirmed): confirm the link and make the year approximate
  check(await openProfile('يزيد', '2024'), 'found يزيد (2024)');
  check((await page.evaluate(() => [...document.querySelectorAll('.pc .tag')].map(t => t.innerText).join('|'))).includes('غير مؤكد'), 'his link to the father is marked not confirmed');
  await click(page, 'تعديل البيانات');
  await page.evaluate(() => [...document.querySelectorAll('.opt')].find(e => e.innerText.includes('غير مؤكد')).querySelector('input').click());
  await page.evaluate(() => [...document.querySelectorAll('.opt')].find(e => e.innerText.includes('تقريبية')).querySelector('input').click());
  await click(page, 'حفظ', '.foot button', 1800);
  const tags = await page.evaluate(() => [...document.querySelectorAll('.pc .tag')].map(t => t.innerText).join('|'));
  check(!tags.includes('غير مؤكد'), 'after the edit the link is confirmed', tags);
  check((await page.evaluate(() => document.querySelector('.stats')?.innerText ?? '')).includes('حوالي'), 'the birth year shows as approximate');

  // move him under another father
  await click(page, 'نقل إلى أب آخر');
  await page.type('.sfield input', 'عيسى', { delay: 10 });
  await wait(600);
  const target = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.results .prow')];
    const r = rows.find(e => !e.innerText.includes('1988')) ?? rows[0];
    r?.click();
    return r?.querySelector('b').innerText.split('\n')[0].trim();
  });
  await wait(1800);
  const chain = await page.evaluate(() => document.querySelector('.pc .ns')?.innerText ?? '');
  check(!!target && chain.includes('بن ' + target), 'moved under the new father: the nasab follows', chain);

  // delete someone with descendants, then undo from the record
  await page.evaluate(() => document.querySelector('.navbtns .round').click());
  await wait(500);
  check(await openProfile('راشد', 'الجيل الرابع'), 'found راشد (4th generation)');
  const desc = Number((await page.evaluate(() => [...document.querySelectorAll('.prow')].find(e => e.innerText.includes('حذف من الشجرة'))?.innerText ?? '')).match(/\((\d+)\)/)?.[1] ?? 0);
  check(desc > 0, 'he has descendants to delete with him', String(desc));
  await click(page, 'حذف من الشجرة', 'button', 2000);
  await tab(page, 'الشجرة');
  const afterDelete = await people(page);
  check(afterDelete === start - 1 - desc, 'deleting him and his line takes them out', `${start} -> ${afterDelete} (desc ${desc})`);
  await tab(page, 'الطلبات');
  await page.evaluate(() => [...document.querySelectorAll('.card.hist')].find(e => e.innerText.includes('حذف: راشد'))?.querySelector('button')?.click());
  await wait(2000);
  await tab(page, 'الشجرة');
  check((await people(page)) === start, 'undo brings them all back', String(await people(page)));
});
