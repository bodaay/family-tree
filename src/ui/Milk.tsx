// Recording milk kinship (الرضاعة, design document 1.36): whom this person was
// nursed by, from the family or from outside (by name only), her husband at the
// time as the milk father, and whether the family is sure of it.
import { useEffect, useState } from 'preact/hooks';
import { set, nameOf, unitOf, canSee, ownKey, type State } from '../data/store';
import { marriagesOf, nasab, surname, viaMother } from '../data/graph';
import { addMilk, marriagesBarredBy, milkRecordProblem } from '../data/milk';
import { Icon } from './icons';
import { PersonRow, Seg, lineOf, motherLine } from './common';
import { Approval } from './Marriage';
import { useBack } from './back';

export function MilkSheet({ s, id }: { s: State; id: string }) {
  const g = s.graph;
  const p = g.nodes.get(id)!;
  const him = p.sex === 'm';
  const [from, setFrom] = useState<'in' | 'out'>('in');
  const [name, setName] = useState('');
  const [father, setFather] = useState<string | null>(null);
  const [unsure, setUnsure] = useState(false);
  const picked = from === 'in' && s.milkPick && g.nodes.has(s.milkPick) ? s.milkPick : null;
  const close = () => set({ milkFor: null, milkPick: null });
  useBack(close);
  // the milk father: one of her husbands (her husband at the time)
  const husbands = picked ? [...new Set(marriagesOf(g, picked).map(m => m.husband))].filter(h => g.nodes.has(h)) : [];
  useEffect(() => setFather(husbands.length === 1 ? husbands[0] : null), [picked]);
  const why = from === 'in' && picked ? milkRecordProblem(g, id, picked, father) : null;
  // marriages it would put under a warning (a man and his milk sister): the approvers decide
  const barred = picked && !why ? marriagesBarredBy(g, { id: '', child: id, nurse: picked, ...(father ? { father } : {}) }) : [];
  const direct = s.rootAdmin && !s.isSample;
  const ready = (from === 'in' ? !!picked : !!name.trim()) && !why;
  const save = () => {
    const done = addMilk(id, picked ?? { name }, from === 'in' ? father : null, unsure);
    if (done) close();
  };
  return (
    <div class="overlay full">
      <div class="addsheet milksheet">
        <div class="ahead">
          <button class="link" onClick={close}>
            إلغاء
          </button>
          <b>رضاعة</b>
          <span />
        </div>
        <div class="who2">
          <div>
            <b>{canSee(s, id) ? `${unitOf(s, id)} ${nasab(g, id, 3)}` : nameOf(s, id)}</b>
            <small>{surname(g, id) || (viaMother(p) ? motherLine(s, id) : lineOf(s, id))}</small>
          </div>
        </div>
        <div class="q small">{him ? 'من أرضعته؟' : 'من أرضعتها؟'}</div>
        <Seg cls="bigseg" value={from} options={[['in', 'من العائلة'], ['out', 'من خارج العائلة']]} onChange={setFrom} />
        {from === 'out' ? (
          <>
            <input class="bigin" dir="rtl" value={name} placeholder="مثل: هيا بنت سعد العتيبي" onInput={e => setName((e.target as HTMLInputElement).value)} />
            <div class="qh">اسمها كاملًا. تُسجَّل بالاسم فقط، ولا تكون عضوًا في الشجرة.</div>
          </>
        ) : picked ? (
          <div class="card list picked1">
            <PersonRow s={s} id={picked} onClick={() => set({ searchOpen: 'milk' })} right={<small class="mut">تغيير</small>} />
          </div>
        ) : (
          <button class="btn wide pickbtn" onClick={() => set({ searchOpen: 'milk' })}>
            <Icon name="search" size={18} /> اختر المرضعة من الشجرة
          </button>
        )}
        {husbands.length > 0 && (
          <>
            <div class="q small">الأب من الرضاعة</div>
            <div class="qh">زوجها وقت الرضاعة؛ أبناؤه من زوجاته كلهن إخوة {him ? 'له' : 'لها'} من الرضاعة.</div>
            <div class="card list parentpick">
              {[...husbands, null].map(h => (
                <button class={'brow' + (father === h ? ' on' : '')} onClick={() => setFather(h)}>
                  <span class="tick">{father === h && <Icon name="check" size={16} />}</span>
                  <span class="pt">
                    <b>{h ? nameOf(s, h) : 'غير معروف'}</b>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <div class="q small">هل الرضاعة مؤكدة؟</div>
        <Seg cls="bigseg" value={unsure ? 'unsure' : 'sure'} options={[['sure', 'مؤكدة'], ['unsure', 'غير مؤكدة']]} onChange={v => setUnsure(v === 'unsure')} />
        <div class="qh">تختلف المذاهب في شروط الرضاعة التي تُحرِّم. يعرض التطبيق القرابة التي تنشأ عنها، ولا يحكم.</div>
        {barred.length > 0 && (
          <div class="warnbox">
            تنبيه: {barred.length === 1 ? 'يجعل هذا زواجًا قائمًا' : 'يجعل هذا زيجات قائمة'} بين قريبين من الرضاعة: {barred.map(b => `زواج ${nameOf(s, b.husband)} (هي ${b.route.term})`).join('، ')}. يُرسل مع التنبيه، ويقرر من يعتمده.
          </div>
        )}
        {why && <div class="warnbox">{why}</div>}
        <Approval s={s} direct={direct} level="sensitive" subject={id} />
        <div class="foot">
          <button class="btn" onClick={close}>
            إلغاء
          </button>
          <button class="btn primary" disabled={!ready} onClick={save}>
            {direct || ownKey(s, id, 'sensitive') === 'done' ? 'حفظ' : 'إرسال للاعتماد'}
          </button>
        </div>
      </div>
    </div>
  );
}
