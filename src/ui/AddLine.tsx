import { useState } from 'preact/hooks';
import { set, addLine, type State } from '../data/store';
import { nasab, surname, unit } from '../data/graph';
import { THIS_YEAR, gToH } from '../data/dates';
import { likelyDuplicates } from '../data/names';
import type { Sex } from '../data/types';
import { Icon } from './icons';
import { Seg } from './common';
import { useDuplicateCheck } from './Duplicates';
import { useBack } from './back';

/**
 * Root admin, while setting up: the names from a person already in the tree
 * down to you (son, grandson, … you), in one go.
 */
export function AddLine({ s, from }: { s: State; from: string }) {
  useBack(() => set({ lineFrom: null }));
  const g = s.graph;
  const a = g.nodes.get(from)!;
  const [rows, setRows] = useState([{ name: '', year: '' }]);
  const [lastSex, setLastSex] = useState<Sex>('m');
  const [isMe, setIsMe] = useState(!s.me);
  const cal = s.settings.cal;
  const max = cal === 'g' ? THIS_YEAR : gToH(THIS_YEAR)[1];
  const put = (i: number, k: 'name' | 'year', v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const ready = rows.every(r => r.name.trim());
  const year = (y: string) => {
    const v = parseInt(y.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))), 10);
    return v > (cal === 'g' ? 1700 : 1100) && v <= max ? { v, cal } : undefined;
  };
  const dups = useDuplicateCheck(s, id => set({ lineFrom: null, profile: id }));
  // the first name may already be a son of the person chosen; any name may be
  // someone with the same father's name, born about the same year
  const likely = () => rows.flatMap((r, i) => likelyDuplicates(g, r.name, i ? { name: rows[i - 1].name } : { id: from }, year(r.year), i === rows.length - 1 ? lastSex : 'm'));
  const names = rows.map(r => r.name.trim() || '…');
  const chain = [...names].reverse().map(x => unit({ name: x })).join(' بن ') + ' بن ' + unit(a) + ' ' + nasab(g, from, 2) + ' ' + surname(g, from);
  const save = () =>
    void addLine(
      from,
      rows.map((r, i) => ({ name: r.name, birth: year(r.year), sex: i === rows.length - 1 ? lastSex : 'm' })),
      isMe,
    );
  return (
    <div class="overlay full">
      <div class="addsheet">
        <div class="ahead">
          <button class="link" onClick={() => set({ lineFrom: null })}>
            إلغاء
          </button>
          <b>إضافة سلسلة نسب</b>
          <span />
        </div>
        <div class="q">من {a.name} إليك</div>
        <div class="qh">اكتب الأسماء جيلًا بعد جيل، من ابن {a.name} حتى تصل إلى نفسك. سنة الميلاد اختيارية.</div>
        <div class="lines">
          {rows.map((r, i) => (
            <div class="linerow">
              <small>{i === rows.length - 1 && lastSex === 'f' ? 'ابنة' : 'ابن'} {i ? names[i - 1] : a.name}</small>
              <div class="lineins">
                <input class="bigin" dir="rtl" value={r.name} placeholder="الاسم" onInput={e => put(i, 'name', (e.target as HTMLInputElement).value)} />
                <input class="bigin yr" dir="ltr" inputMode="numeric" value={r.year} placeholder={cal === 'g' ? 'سنة' : 'سنة هـ'} onInput={e => put(i, 'year', (e.target as HTMLInputElement).value)} />
                {rows.length > 1 && i === rows.length - 1 && (
                  <button class="btn sq" aria-label="حذف" onClick={() => setRows(rows.slice(0, -1))}>
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <button class="btn small" onClick={() => setRows([...rows, { name: '', year: '' }])}>
          <Icon name="plus" size={16} /> جيل آخر
        </button>
        <div class="card review">
          <div>
            <small>الأخير</small>
            <Seg value={lastSex} options={[['m', 'ابن'], ['f', 'ابنة']]} onChange={setLastSex} />
          </div>
          <div>
            <small>النسب</small>
            <b>{chain}</b>
          </div>
        </div>
        <label class="opt">
          <span>
            <b>الاسم الأخير هو أنا</b>
            <small>يرتبط هذا الهاتف به، فتطلب وتعتمد باسمك.</small>
          </span>
          <input type="checkbox" checked={isMe} onChange={e => setIsMe((e.target as HTMLInputElement).checked)} />
        </label>
        <p class="hint">تُضاف مباشرة لأنك مشرف العائلة، وتُحفظ في السجل باسمك ويمكن التراجع عنها.</p>
        <div class="foot">
          <button class="btn primary" disabled={!ready} onClick={() => dups.check(likely(), save)}>
            إضافة إلى الشجرة
          </button>
        </div>
        {dups.sheet}
      </div>
    </div>
  );
}
