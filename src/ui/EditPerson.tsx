import { useState } from 'preact/hooks';
import { set, editPerson, ownKey, viewer, askDelete, deleteLevel, deleteProblem, type State } from '../data/store';
import { marriagesOf, nasab, surname, unit, viaMother } from '../data/graph';
import { parseYear } from '../data/dates';
import { NEED, assess } from '../data/governance';
import { spousesOf } from '../data/marriages';
import { aliasesOf } from '../data/names';
import type { Alias, Cal, Op, PersonPatch, Sex, Year } from '../data/types';
import { Icon } from './icons';
import { Seg, lineOf, motherLine } from './common';
import { AliasEditor, draftProblem, withDraft } from './Aliases';
import { useBack } from './back';

/**
 * A person's details, all on one screen. The root admin's are saved directly;
 * anyone else's are a request (design document 1.31), which the keys approve
 * at the level every phone works out from it: a name, other names or a birth
 * year needs one key of the branch, a change of sex a gold, a child moved to
 * another line both golds. What the sender's own key covers is saved as it is
 * sent. Never one's own death.
 */
export function EditPerson({ s, id }: { s: State; id: string }) {
  useBack(() => set({ editFor: null }));
  const g = s.graph;
  const n = g.nodes.get(id)!;
  const direct = s.rootAdmin && !s.isSample;
  const self = viewer(s) === id;
  const [aliases, setAliases] = useState<Alias[]>(aliasesOf(n));
  const [draft, setDraft] = useState<Alias>({ type: 'kunya', text: '' });
  const [name, setName] = useState(n.name);
  const [suffix, setSuffix] = useState(n.suffix ?? '');
  const [sex, setSex] = useState<Sex>(n.sex);
  const [cal, setCal] = useState<Cal>(n.birth?.cal ?? s.settings.cal);
  const [born, setBorn] = useState(n.birth ? String(n.birth.v) : '');
  const [approx, setApprox] = useState(!!n.birth?.approx);
  const [dead, setDead] = useState(!!n.deceased || !!n.death);
  const [died, setDied] = useState(n.death ? String(n.death.v) : '');
  const [unsure, setUnsure] = useState(!!n.uncertain);
  // the parent outside the tree line: the mother among the father's wives or,
  // for a daughter's child, the father among her husbands from outside
  const f = n.father ? g.nodes.get(n.father) : undefined;
  const linkBy = f && !f.external && n.parent === f.id ? 'mother' : viaMother(n) ? 'father' : null;
  const cur = linkBy ? (n[linkBy] ?? null) : null;
  const choices = linkBy ? spousesOf(g, linkBy === 'mother' ? n.father! : n.mother!).filter(x => linkBy === 'mother' || g.nodes.get(x)!.external) : [];
  if (cur && !choices.includes(cur) && g.nodes.has(cur)) choices.push(cur);
  const [link, setLink] = useState<string | null>(cur);
  // a death ends the marriages that were current: they become widowhood, in the year of death
  const wasDead = !!n.deceased || !!n.death;
  const marriages = marriagesOf(g, id);
  const current = marriages.filter(m => m.status === 'married');
  const year = parseYear;
  const same = (a: Year | null | undefined, b: Year | null) => JSON.stringify(a ?? null) === JSON.stringify(b);
  const names = withDraft(aliases, draft);
  const namesChanged = JSON.stringify(names) !== JSON.stringify(aliasesOf(n));
  // a request with the whole list already waits; approving a second one would drop what the first adds
  const waiting = s.txs.some(t => t.status === 'pending' && t.ops.some(o => o.op === 'updatePerson' && o.id === id && ('aliases' in o.after || 'sealed' in o.after)));
  // a year typed that is not one: never taken as clearing the year that was there
  const badBorn = !!born.trim() && !year(born, cal, approx);
  const badDied = dead && !!died.trim() && !year(died, cal);
  /** The change as it stands: the fields that differ, and the marriages a death makes widowhood. */
  const changes = (): { after: PersonPatch; also: Op[] } => {
    const after: PersonPatch = {};
    if (namesChanged) after.aliases = names.length ? names : null;
    if (name.trim() && name.trim() !== n.name) after.name = name.trim();
    if (suffix.trim() !== (n.suffix ?? '')) after.suffix = suffix.trim() || null;
    if (sex !== n.sex) after.sex = sex;
    const b = year(born, cal, approx);
    if (!same(n.birth, b)) after.birth = b;
    if (dead !== (!!n.deceased || !!n.death)) after.deceased = dead ? true : null;
    const d = dead ? year(died, cal) : null;
    if (!same(n.death, d)) after.death = d;
    if (unsure !== !!n.uncertain) after.uncertain = unsure ? true : null;
    if (linkBy && link !== cur) after[linkBy] = link;
    const also: Op[] =
      dead && !wasDead ? current.map(m => ({ op: 'updateMarriage', id: m.id, before: { status: m.status, end: m.end ?? null }, after: { status: 'widowed', end: d } })) : [];
    return { after, also };
  };
  const { after, also } = changes();
  const changed = Object.keys(after).length > 0;
  // the level every phone will work out from it, and whether this phone's own key covers it
  const level = assess(g, [{ op: 'updatePerson', id, before: {}, after }, ...also], x => s.linked.has(x), s.seats).level;
  const own = direct ? null : ownKey(s, id, level);
  const branchName = n.branch ? g.nodes.get(n.branch)?.name : null;
  const save = () => {
    if (!changed) return void set({ editFor: null });
    const onlyNames = Object.keys(after).every(k => k === 'aliases');
    const died0 = 'deceased' in after && after.deceased;
    // a request says what it asks for; the root admin's own change keeps the plain «تعديل: …»
    editPerson(id, after, { also, title: direct ? undefined : onlyNames ? 'أسماء أخرى: ' + n.name : died0 ? 'وفاة: ' + n.name : undefined });
    set({ editFor: null });
  };
  return (
    <div class="overlay full">
      <div class="addsheet">
        <div class="ahead">
          <button class="link" onClick={() => set({ editFor: null })}>
            إلغاء
          </button>
          <b>تعديل</b>
          <span />
        </div>
        <div class="who2">
          <div>
            <b>{unit({ ...n, name: name || n.name, suffix: suffix.trim() || undefined })} {nasab(g, id, 3)}</b>
            <small>{n.external ? 'من خارج العائلة' : surname(g, id) || (viaMother(n) ? motherLine(s, id) : lineOf(s, id))}</small>
          </div>
        </div>
        <div class="q small">الاسم</div>
        <input class="bigin" dir="rtl" value={name} onInput={e => setName((e.target as HTMLInputElement).value)} />
        <div class="q small">للتمييز</div>
        <div class="qh">إن {sex === 'f' ? 'كانت لها أخت بالاسم نفسه' : 'كان له أخ بالاسم نفسه'}: كلمة تُكتب بعد الاسم في كل مكان.</div>
        <input class="bigin" dir="rtl" maxLength={20} placeholder="اختياري" value={suffix} onInput={e => setSuffix((e.target as HTMLInputElement).value)} />
        <div class="chips2">
          {(sex === 'f' ? ['الأولى', 'الثانية', 'الكبرى', 'الصغرى'] : ['الأول', 'الثاني', 'الكبير', 'الصغير']).map(w => (
            <button class={'chip' + (suffix.trim() === w ? ' on' : '')} onClick={() => setSuffix(suffix.trim() === w ? '' : w)}>
              {w}
            </button>
          ))}
        </div>
        {/* a husband stays a man while he is married (remove the marriage first to correct it) */}
        {!marriages.length && <Seg cls="bigseg" value={sex} options={[['m', 'ذكر'], ['f', 'أنثى']]} onChange={setSex} />}
        <div class="q small">أسماء أخرى</div>
        <div class="qh">الكنية واللقب وما يُعرف به، فيجده من يبحث بها.</div>
        <AliasEditor list={aliases} onList={setAliases} draft={draft} onDraft={setDraft} />
        {waiting && (
          <div class="warnbox">
            {direct
              ? 'عليه طلب أسماء أخرى بانتظار الاعتماد. إن اعتُمد بعد حفظك حلّت أسماؤه محل ما تحفظه الآن.'
              : 'عليه طلب أسماء أخرى بانتظار الاعتماد. بعد اعتماده أو رفضه يمكن طلب تغيير جديد.'}
          </div>
        )}
        <div class="q small">الميلاد</div>
        <div class="qh">اترك السنة فارغة إن لم تكن معروفة.</div>
        <Seg cls="bigseg" value={cal} options={[['g', 'ميلادي'], ['h', 'هجري']]} onChange={setCal} />
        <input class="bigin" dir="ltr" inputMode="numeric" placeholder={cal === 'g' ? 'مثل 1965' : 'مثل 1385'} value={born} onInput={e => setBorn((e.target as HTMLInputElement).value)} />
        <label class="opt">
          <span>
            <b>السنة تقريبية</b>
          </span>
          <input type="checkbox" checked={approx} onChange={e => setApprox((e.target as HTMLInputElement).checked)} />
        </label>
        {badBorn && <div class="warnbox">سنة الميلاد غير صحيحة</div>}
        {/* never one's own death */}
        {(!self || wasDead) && (
          <>
            <div class="q small">الحالة</div>
            <Seg cls="bigseg" value={dead ? 'd' : 'a'} options={[['a', 'حيّ'], ['d', 'متوفى']]} onChange={v => setDead(v === 'd')} />
          </>
        )}
        {dead && <input class="bigin" dir="ltr" inputMode="numeric" placeholder={'سنة الوفاة (اختياري، ' + (cal === 'g' ? 'ميلادي' : 'هجري') + ')'} value={died} onInput={e => setDied((e.target as HTMLInputElement).value)} />}
        {badDied && <div class="warnbox">سنة الوفاة غير صحيحة</div>}
        {dead && !wasDead && current.length > 0 && (
          <div class="qh">{n.sex === 'f' ? 'ويصبح زواجها الحالي ترمّلًا في سنة الوفاة.' : current.length > 1 ? 'وتصبح زيجاته الحالية ترمّلًا في سنة الوفاة.' : 'ويصبح زواجه الحالي ترمّلًا في سنة الوفاة.'}</div>
        )}
        {linkBy && choices.length > 0 && (
          <>
            <div class="q small">{linkBy === 'mother' ? 'الأم' : 'الأب'}</div>
            <div class="card list parentpick">
              {[...choices, null].map(x => (
                <button class={'brow' + (link === x ? ' on' : '')} onClick={() => setLink(x)}>
                  <span class="tick">{link === x && <Icon name="check" size={16} />}</span>
                  <span class="pt">
                    <b>{x ? g.nodes.get(x)!.name : linkBy === 'mother' ? 'غير مسجلة' : 'غير مسجل'}</b>
                    {x && <small>{g.nodes.get(x)!.external ? 'من خارج العائلة' : nasab(g, x, 2)}</small>}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        {!n.external && (
          <label class="opt">
            <span>
              <b>الارتباط بالأب غير مؤكد</b>
              <small>يظهر خطه متقطعًا حتى يتأكد</small>
            </span>
            <input type="checkbox" checked={unsure} onChange={e => setUnsure((e.target as HTMLInputElement).checked)} />
          </label>
        )}
        {/* removing them, as a request too (the root admin's own is in «أدوات المشرف») */}
        {!direct && !deleteProblem(s, id) && (
          <button
            class="link danger delask"
            onClick={() => {
              const { level, own } = deleteLevel(s, id);
              const desc = n.desc;
              const who = `حذف ${n.name}${desc ? ` و${desc} من ${n.sex === 'f' ? 'ذريتها' : 'ذريته'}` : ''} من الشجرة؟`;
              const how =
                own === 'done'
                  ? 'يُحذف فورًا بمفتاحك.'
                  : level === 'trunk'
                    ? `يُرسل طلبًا يعتمده ${NEED.trunk.text}، أو مشرف العائلة.`
                    : `يُرسل طلبًا يعتمده ${NEED[level].text}${branchName ? ' من فرع ' + branchName : ''}، أو حامل المفتاح البلاتيني، أو مشرف العائلة.`;
              if (confirm(`${who} ${how} ويمكن التراجع عنه من السجل.`)) {
                askDelete(id);
                set({ editFor: null, ...(own === 'done' ? { profile: null, focus: null } : {}) });
              }
            }}
          >
            {n.desc ? (n.sex === 'f' ? 'حذفها وذريتها من الشجرة…' : 'حذفه وذريته من الشجرة…') : 'حذف من الشجرة…'}
          </button>
        )}
        <p class="hint">
          {direct
            ? 'يُحفظ مباشرة لأنك مشرف العائلة، ويُسجَّل في السجل ويمكن التراجع عنه.'
            : own === 'done'
              ? 'يُعتمد بمفتاحك ويُحفظ فور إرساله، ويُسجَّل في السجل ويمكن التراجع عنه.'
              : own === 'one'
                ? `يُرسل ومعه اعتمادك، وينتظر اعتمادًا آخر من ${NEED[level].text}${branchName ? ' في فرع ' + branchName : ''}. ويُسجَّل في السجل ويمكن التراجع عنه.`
                : level === 'trunk'
                  ? `يُرسل كطلب يعتمده ${NEED.trunk.text}، أو مشرف العائلة. ويُسجَّل في السجل ويمكن التراجع عنه.`
                  : `يُرسل كطلب يعتمده ${NEED[level].text}${branchName ? ' من فرع ' + branchName : ''}، أو حامل المفتاح البلاتيني، أو مشرف العائلة. ويُسجَّل في السجل ويمكن التراجع عنه.`}
        </p>
        <div class="foot">
          <button class="btn primary" disabled={!name.trim() || !!draftProblem(aliases, draft) || badBorn || badDied || (!direct && (!changed || (namesChanged && waiting)))} onClick={save}>
            {direct || own === 'done' ? 'حفظ' : 'إرسال للاعتماد'}
          </button>
        </div>
      </div>
    </div>
  );
}
