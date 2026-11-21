import { useState } from 'preact/hooks';
import { set, nameOf, unitOf, canSee, ownKey, viewer, hideApprovers, hideMarriage, type State } from '../data/store';
import { nasab, surname, viaMother, type Graph } from '../data/graph';
import { namedLike } from '../data/names';
import { parseYear } from '../data/dates';
import { NEED, TIER_AR, seatOf } from '../data/governance';
import { marriageMilkWarning } from '../data/milk';
import { addSpouse, editMarriage, kidsLine, linkKids, marriageText, outsideOnlyIn, removeMarriage, spouseProblem, widowWord, yearsProblem, type Status } from '../data/marriages';
import type { Cal, Level, MarriagePatch, Year } from '../data/types';
import { Icon } from './icons';
import { PersonRow, Seg, lineOf, motherLine, yearShort } from './common';
import { useBack } from './back';

/** What the form holds while typing: years stay text until saved. */
interface Rec {
  status: Status;
  cal: Cal;
  year: string;
  end: string;
}

function checked(rec: Rec): { year: Year | null; end: Year | null; why: string | null } {
  const year = rec.year.trim() ? parseYear(rec.year, rec.cal) : null;
  const end = rec.status !== 'married' && rec.end.trim() ? parseYear(rec.end, rec.cal) : null;
  const bad = (rec.year.trim() && !year) || (rec.status !== 'married' && rec.end.trim() && !end);
  return { year, end, why: bad ? 'سنة غير صحيحة' : yearsProblem(year, end) };
}

/**
 * Status, then the years (one calendar for all of them), as in the person
 * editor. The years are the wife's details: without her key (`years` false)
 * they are left to someone who holds it.
 */
function RecFields({ g, rec, put, husband, wife, birth, years = true, married = false }: { g: Graph; rec: Rec; put: (r: Partial<Rec>) => void; husband: string | null; wife: string | null; birth?: { value: string; set: (v: string) => void }; years?: boolean; married?: boolean }) {
  const statuses: [Status, string][] = [['married', 'متزوجان'], ['divorced', 'مطلّقان'], ['widowed', widowWord(g, husband, wife)]];
  const yearIn = (label: string, value: string, onInput: (v: string) => void) => (
    <label class="fld">
      <small>{label}</small>
      <input class="bigin" dir="ltr" inputMode="numeric" placeholder={rec.cal === 'g' ? 'مثل 1990' : 'مثل 1410'} value={value} onInput={e => onInput((e.target as HTMLInputElement).value)} />
    </label>
  );
  return (
    <>
      {!married && (
        <>
          <div class="q small">الحالة</div>
          <Seg cls="bigseg" value={rec.status} options={statuses} onChange={status => put({ status })} />
        </>
      )}
      <div class="q small">السنوات</div>
      {years ? (
        <>
          <div class="qh">اختيارية، والسنة وحدها تكفي.</div>
          <Seg cls="bigseg" value={rec.cal} options={[['g', 'ميلادي'], ['h', 'هجري']]} onChange={cal => put({ cal })} />
          {birth && yearIn('سنة الميلاد', birth.value, birth.set)}
          {yearIn('سنة الزواج', rec.year, year => put({ year }))}
          {rec.status !== 'married' && yearIn(rec.status === 'divorced' ? 'سنة الانفصال' : 'سنة الترمّل', rec.end, end => put({ end }))}
        </>
      ) : (
        <div class="qh">سنوات الزواج من تفاصيلها، تُختم بمفتاحها: يسجلها بعد الاعتماد من يحمل مفتاحها.</div>
      )}
    </>
  );
}

export function Approval({ s, direct, level, subject }: { s: State; direct: boolean; level: Level; subject: string }) {
  const g = s.graph;
  const b = g.nodes.get(subject)?.branch;
  const own = direct ? null : ownKey(s, subject, level);
  return (
    <p class="hint">
      {direct
        ? 'يُحفظ مباشرة لأنك مشرف العائلة، ويُسجَّل في السجل ويمكن التراجع عنه.'
        : own === 'done'
          ? 'يُعتمد بمفتاحك ويُحفظ فور إرساله، ويُسجَّل في السجل ويمكن التراجع عنه.'
          : own === 'one'
            ? 'يُرسل كطلب ومعه اعتمادك، ويُحفظ بعد بقية الاعتمادات. كل تغيير يُحفظ في السجل ويمكن التراجع عنه.'
            : `يُرسل كطلب، ويعتمده ${NEED[level].text} من فرع ${b ? g.nodes.get(b)!.name : g.family.name}. كل تغيير يُحفظ في السجل ويمكن التراجع عنه.`}
    </p>
  );
}

/** A wife for a man, or a husband for a woman: from the tree, or from outside the family (name only). */
export function SpouseSheet({ s, id }: { s: State; id: string }) {
  const g = s.graph;
  const p = g.nodes.get(id)!;
  const forMan = p.sex === 'm';
  const [from, setFrom] = useState<'out' | 'in'>('out');
  const [name, setName] = useState('');
  const [born, setBorn] = useState('');
  const [rec, setRec] = useState<Rec>({ status: 'married', cal: s.settings.cal, year: '', end: '' });
  const put = (r: Partial<Rec>) => setRec({ ...rec, ...r });
  const picked = from === 'in' && s.spousePick && g.nodes.has(s.spousePick) ? s.spousePick : null;
  const close = () => set({ spouseFor: null, spousePick: null });
  useBack(close);
  // a man hiding a marriage of his own: only he, she and the one he asks to approve it see it
  const approvers = forMan && viewer(s) === id ? hideApprovers(s) : [];
  const [hide, setHide] = useState(false);
  const [approver, setApprover] = useState<string | null>(null);
  const direct = s.rootAdmin && !s.isSample && !hide;
  // the years are hers: sealed with her key, so only a phone holding it records them
  const wife = forMan ? (from === 'in' ? picked : null) : id;
  const years = !s.sealedEra || !wife || s.opened.has(wife);
  const chk = checked(years ? rec : { ...rec, year: '', end: '' });
  const birth = from === 'out' && born.trim() ? parseYear(born, rec.cal) : null;
  const why =
    from === 'in'
      ? picked && spouseProblem(g, id, picked, rec.status)
      : born.trim() && !birth
        ? 'سنة الميلاد غير صحيحة'
        : spouseProblem(g, id, null, rec.status);
  const problem = why || chk.why;
  // the name typed for someone from outside may be someone in the tree: offered, to choose from the
  // family instead (only those the phone may see, and who could be married whatever the status)
  const likely = from === 'out' ? namedLike(g, name, forMan ? 'f' : 'm').filter(x => canSee(s, x) && !spouseProblem(g, id, x, 'divorced')).slice(0, 5) : [];
  const ready = (from === 'in' ? !!picked : !!name.trim()) && !problem && (!hide || !!approver);
  // approved in the husband's branch, or the wife's when he is from outside
  const subject = !forMan && picked ? picked : id;
  const save = () => {
    if (hide) {
      void hideMarriage(picked ?? { name, birth }, { year: chk.year }, approver!).then(ok => ok && close());
      return;
    }
    const done = addSpouse(id, picked ?? { name, birth }, { status: rec.status, year: chk.year, end: chk.end });
    if (done) close();
  };
  return (
    <div class="overlay full">
      <div class="addsheet">
        <div class="ahead">
          <button class="link" onClick={close}>
            إلغاء
          </button>
          <b>{forMan ? 'إضافة زوجة' : 'إضافة زوج'}</b>
          <span />
        </div>
        <div class="who2">
          <div>
            <b>
              {canSee(s, id) ? `${unitOf(s, id)} ${nasab(g, id, 3)}` : nameOf(s, id)}
            </b>
            <small>{p.external ? 'من خارج العائلة' : surname(g, id) || (viaMother(p) ? motherLine(s, id) : lineOf(s, id))}</small>
          </div>
        </div>
        <div class="q small">{forMan ? 'من هي؟' : 'من هو؟'}</div>
        <Seg cls="bigseg" value={from} options={[['out', 'من خارج العائلة'], ['in', 'من العائلة']]} onChange={setFrom} />
        {from === 'out' ? (
          <>
            <input class="bigin" dir="rtl" value={name} placeholder={forMan ? 'مثل: هيا بنت سعد العتيبي' : 'مثل: سعد بن محمد القحطاني'} onInput={e => setName((e.target as HTMLInputElement).value)} />
            <div class="qh">{forMan ? 'اسمها كاملًا. تُسجَّل بالاسم فقط، ولا تكون عضوًا في الشجرة.' : 'اسمه كاملًا. يُسجَّل بالاسم فقط، ولا يكون عضوًا في الشجرة.'}</div>
            {likely.length > 0 && (
              <>
                <div class="warnbox">{forMan ? 'في الشجرة من تحمل هذا الاسم. إن كانت هي فاختَرها من العائلة:' : 'في الشجرة من يحمل هذا الاسم. إن كان هو فاختَره من العائلة:'}</div>
                <div class="card list likely">
                  {likely.map(x => (
                    <PersonRow
                      s={s}
                      id={x}
                      onClick={() => {
                        set({ spousePick: x });
                        setFrom('in');
                      }}
                      right={<span class="link">اختيار</span>}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : picked ? (
          <div class="card list picked1">
            <PersonRow s={s} id={picked} onClick={() => set({ searchOpen: 'spouse' })} right={<small class="mut">تغيير</small>} />
          </div>
        ) : (
          <button class="btn wide pickbtn" onClick={() => set({ searchOpen: 'spouse' })}>
            <Icon name="search" size={18} /> {forMan ? 'اختر الزوجة من الشجرة' : 'اختر الزوج من الشجرة'}
          </button>
        )}
        {approvers.length > 0 && (
          <>
            <div class="q small">من يعلم به</div>
            <Seg
              cls="bigseg"
              value={hide ? 'hidden' : 'open'}
              options={[['open', 'العائلة'], ['hidden', 'زواج مخفي']]}
              onChange={v => {
                setHide(v === 'hidden');
                put({ status: 'married' });
              }}
            />
            {hide && (
              <>
                <div class="qh">لا يراه إلا أنت وهي، ومن تختاره ليعتمده وحده. يُعلن للعائلة متى أُضيف له ابن، وعند وفاتك، أو متى أعلنته أنت أو معتمده، ولا رجعة في الإعلان.</div>
                <div class="card list parentpick">
                  {approvers.map(a => (
                    <button class={'brow' + (approver === a ? ' on' : '')} onClick={() => setApprover(a)}>
                      <span class="tick">{approver === a && <Icon name="check" size={16} />}</span>
                      <span class="pt">
                        <b>{nameOf(s, a)}</b>
                        <small>{a === s.adminPerson ? 'مشرف العائلة' : (() => { const t = seatOf(s.seats, a); return t ? 'المفتاح ' + TIER_AR[t.tier] : ''; })()}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <RecFields
          g={g}
          rec={rec}
          put={put}
          husband={forMan ? id : picked}
          wife={forMan ? picked : id}
          birth={from === 'out' ? { value: born, set: setBorn } : undefined}
          years={years}
          married={hide}
        />
        {problem && <div class="warnbox">{problem}</div>}
        {!problem && picked && (() => {
          // a milk relation that would bar it by birth: sent with the warning, those who approve it decide (design document 1.36)
          const w = marriageMilkWarning(g, forMan ? id : picked, forMan ? picked : id);
          return w && <div class="warnbox">{w}. يُرسل مع التنبيه، ويقرر من يعتمده.</div>;
        })()}
        {hide ? (
          <p class="hint">يُرسل طلبًا خاصًا إلى {approver ? nameOf(s, approver) : 'من تختاره'} وحده، ولا يظهر لغيرهما في الطلبات ولا في الشجرة.</p>
        ) : (
          <Approval s={s} direct={direct} level="sensitive" subject={subject} />
        )}
        <div class="foot">
          <button class="btn" onClick={close}>
            إلغاء
          </button>
          <button class="btn primary" disabled={!ready} onClick={save}>
            {hide ? 'إرسال' : direct || ownKey(s, subject, 'sensitive') === 'done' ? 'حفظ' : 'إرسال للاعتماد'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A marriage's status and years; the root admin can also remove one recorded by mistake. */
export function MarriageSheet({ s, id }: { s: State; id: string }) {
  const g = s.graph;
  const m = g.marriages.find(x => x.id === id)!;
  const [rec, setRec] = useState<Rec>({
    status: m.status,
    cal: m.year?.cal ?? m.end?.cal ?? s.settings.cal,
    year: m.year ? String(m.year.v) : '',
    end: m.end ? String(m.end.v) : '',
  });
  const put = (r: Partial<Rec>) => setRec({ ...rec, ...r });
  const close = () => set({ marriageFor: null });
  useBack(close);
  const direct = s.rootAdmin && !s.isSample;
  const chk = checked(rec);
  const problem = (rec.status === 'married' && m.status !== 'married' && spouseProblem(g, m.husband, m.wife, 'married')) || chk.why;
  const same = (a: Year | undefined, b: Year | null) => JSON.stringify(a ?? null) === JSON.stringify(b);
  const after: MarriagePatch = {};
  if (rec.status !== m.status) after.status = rec.status;
  if (!same(m.year, chk.year)) after.year = chk.year;
  if (!same(m.end, rec.status === 'married' ? null : chk.end)) after.end = rec.status === 'married' ? null : chk.end;
  const level: Level = after.status ? 'sensitive' : 'everyday';
  const subject = g.nodes.get(m.husband)!.external ? m.wife : m.husband;
  const save = () => {
    if (Object.keys(after).length && !editMarriage(id, after)) return;
    close();
  };
  const remove = () => {
    const out = outsideOnlyIn(g, m);
    const also = out ? ` ويُحذف معه اسم ${g.nodes.get(out)!.name} لأنه من خارج العائلة.` : '';
    if (!confirm(`حذف زواج ${g.nodes.get(m.husband)!.name} و${g.nodes.get(m.wife)!.name}؟${also} يمكن التراجع عنه من السجل.`)) return;
    if (!removeMarriage(id)) return;
    set({ marriageFor: null, ...(out && s.profile === out ? { profile: null } : {}) });
  };
  return (
    <div class="overlay full">
      <div class="addsheet">
        <div class="ahead">
          <button class="link" onClick={close}>
            إلغاء
          </button>
          <b>الزواج</b>
          <span />
        </div>
        <div class="who2">
          <div>
            <b>
              {nameOf(s, m.husband)} و{nameOf(s, m.wife)}
            </b>
            <small>{marriageText(s, m)}</small>
          </div>
        </div>
        <RecFields g={g} rec={rec} put={put} husband={m.husband} wife={m.wife} />
        {problem && <div class="warnbox">{problem}</div>}
        <Approval s={s} direct={direct} level={level} subject={subject} />
        {direct && (
          <button class="btn wide" onClick={remove}>
            <Icon name="x" size={18} /> <span class="danger">حذف الزواج</span>
          </button>
        )}
        <div class="foot">
          <button class="btn" onClick={close}>
            إلغاء
          </button>
          <button class="btn primary" disabled={!!problem || !Object.keys(after).length} onClick={save}>
            {direct || ownKey(s, subject, level) === 'done' ? 'حفظ' : 'إرسال للاعتماد'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Root admin: which of the children are this marriage's, ticked from one list
 * (for a wife added after her children were). Saved directly, as one change.
 */
export function KidsSheet({ s, id }: { s: State; id: string }) {
  const g = s.graph;
  const m = g.marriages.find(x => x.id === id)!;
  const { other, field, kids } = kidsLine(g, m);
  const mine = (k: string) => g.nodes.get(k)![field] === other;
  const [on, setOn] = useState(() => new Set(kids.filter(mine)));
  const close = () => set({ kidsFor: null });
  useBack(close);
  const flip = (k: string) => {
    const next = new Set(on);
    if (!next.delete(k)) next.add(k);
    setOn(next);
  };
  const changed = kids.some(k => on.has(k) !== mine(k));
  const mother = field === 'mother';
  // where each child stands now, when not with this spouse
  const now = (k: string) => {
    const cur = g.nodes.get(k)![field];
    if (cur === other) return '';
    if (cur && g.nodes.has(cur)) return (mother ? 'الأم: ' : 'الأب: ') + nameOf(s, cur);
    return mother ? 'الأم غير مسجلة' : 'الأب غير مسجل';
  };
  return (
    <div class="overlay full">
      <div class="addsheet">
        <div class="ahead">
          <button class="link" onClick={close}>
            إلغاء
          </button>
          <b>ربط أبناء</b>
          <span />
        </div>
        <div class="who2">
          <div>
            <b>
              {nameOf(s, m.husband)} و{nameOf(s, m.wife)}
            </b>
            <small>{mother ? 'علّم أبناءه منها' : 'علّم أبناءها منه'}</small>
          </div>
        </div>
        {kids.length ? (
          <div class="card list parentpick">
            {kids.map(k => (
              <button class={'brow' + (on.has(k) ? ' on' : '')} onClick={() => flip(k)}>
                <span class="tick">{on.has(k) && <Icon name="check" size={16} />}</span>
                <span class="pt">
                  <b>{nameOf(s, k)}</b>
                  <small>{[yearShort(s, k), now(k)].filter(Boolean).join(' · ') || ' '}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p class="hint">{mother ? 'لا أبناء مسجلون له بعد.' : 'لا أبناء مسجلون لها بعد.'}</p>
        )}
        <p class="hint">
          {mother
            ? 'من كانت أمه مسجلة غيرها ينتقل إليها، ومن تُزال علامته تصبح أمه غير مسجلة.'
            : 'من كان أبوه مسجلًا غيره ينتقل إليه، ومن تُزال علامته يصبح أبوه غير مسجل.'}{' '}
          يُحفظ مباشرة تغييرًا واحدًا في السجل، ويمكن التراجع عنه.
        </p>
        <div class="foot">
          <button class="btn primary" disabled={!changed} onClick={() => { linkKids(id, [...on]); close(); }}>
            حفظ
          </button>
        </div>
      </div>
    </div>
  );
}
