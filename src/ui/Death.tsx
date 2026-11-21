import { useState } from 'preact/hooks';
import { set, recordDeath, ownKey, type State } from '../data/store';
import { marriagesOf, nasab, surname, unit, viaMother } from '../data/graph';
import { gYear, parseYear } from '../data/dates';
import { NEED } from '../data/governance';
import type { Cal } from '../data/types';
import { Seg, lineOf, motherLine } from './common';
import { useBack } from './back';

/**
 * Recording a death, from anyone who may send requests about the person: the
 * year if known (never the cause or the place). Two silvers of the branch
 * approve it; a key holder's death needs the whole trunk, or the root admin.
 */
export function DeathSheet({ s, id }: { s: State; id: string }) {
  const g = s.graph;
  const n = g.nodes.get(id)!;
  const close = () => set({ deathFor: null });
  useBack(close);
  const [cal, setCal] = useState<Cal>(s.settings.cal);
  const [year, setYear] = useState('');
  const [approx, setApprox] = useState(false);
  const y = year.trim() ? parseYear(year, cal, approx) : null;
  const born = gYear(n.birth);
  const problem = year.trim() && !y ? 'سنة الوفاة غير صحيحة' : y && born && gYear(y)! < born ? 'سنة الوفاة قبل سنة الميلاد' : null;
  const current = marriagesOf(g, id).filter(m => m.status === 'married');
  const holder = s.seats.some(x => x.holder === id);
  const own = holder ? null : ownKey(s, id, 'death');
  const b = n.branch ? g.nodes.get(n.branch)?.name : null;
  const she = n.sex === 'f';
  const save = () => {
    if (problem) return;
    if (recordDeath(id, y)) set({ deathFor: null, tab: own === 'done' ? s.tab : 'requests', profile: own === 'done' ? id : null });
  };
  return (
    <div class="overlay full">
      <div class="addsheet">
        <div class="ahead">
          <button class="link" onClick={close}>
            إلغاء
          </button>
          <b>تسجيل وفاة</b>
          <span />
        </div>
        <div class="who2">
          <div>
            <b>
              {unit(n)} {nasab(g, id, 3)}
            </b>
            <small>{n.external ? 'من خارج العائلة' : surname(g, id) || (viaMother(n) ? motherLine(s, id) : lineOf(s, id))}</small>
          </div>
        </div>
        <div class="q small">سنة الوفاة</div>
        <div class="qh">اختيارية. لا يُسجَّل سبب الوفاة ولا مكانها.</div>
        <Seg cls="bigseg" value={cal} options={[['g', 'ميلادي'], ['h', 'هجري']]} onChange={setCal} />
        <input class="bigin" dir="ltr" inputMode="numeric" placeholder={cal === 'g' ? 'مثل 2024' : 'مثل 1445'} value={year} onInput={e => setYear((e.target as HTMLInputElement).value)} />
        <label class="opt">
          <span>
            <b>السنة تقريبية</b>
          </span>
          <input type="checkbox" checked={approx} onChange={e => setApprox((e.target as HTMLInputElement).checked)} />
        </label>
        {current.length > 0 && <div class="qh">{she ? 'ويصبح زواجها الحالي ترمّلًا في سنة الوفاة.' : current.length > 1 ? 'وتصبح زيجاته الحالية ترمّلًا في سنة الوفاة.' : 'ويصبح زواجه الحالي ترمّلًا في سنة الوفاة.'}</div>}
        {problem && <div class="warnbox">{problem}</div>}
        <p class="hint">
          {holder
            ? `${she ? 'تحمل' : 'يحمل'} مفتاحًا: لا تثبت ${she ? 'وفاتها' : 'وفاته'} إلا بالبلاتيني وذهبي من كل فرع، أو بمشرف العائلة، فلا يُعلَن موت أحد ليُزاح عن مقعده.`
            : own === 'done'
              ? 'يُعتمد بمفتاحك ويُحفظ فور إرساله، ويُسجَّل في السجل ويمكن التراجع عنه.'
              : own === 'one'
                ? `يُرسل ومعه اعتمادك، وينتظر اعتمادًا آخر من فرع ${b ?? g.family.name}. ويمكن التراجع عنه بالاعتمادات نفسها.`
                : `يُرسل كطلب، ويعتمده ${NEED.death.text} من فرع ${b ?? g.family.name}. ويمكن التراجع عنه بالاعتمادات نفسها.`}
        </p>
        <div class="foot">
          <button class="btn" onClick={close}>
            إلغاء
          </button>
          <button class="btn primary" disabled={!!problem} onClick={save}>
            {own === 'done' ? 'حفظ' : 'إرسال للاعتماد'}
          </button>
        </div>
      </div>
    </div>
  );
}
