import { useState } from 'preact/hooks';
import { set, addChildTx, nameOf, canSee, getState, ownKey, hiddenWith, type State } from '../data/store';
import { marriagesOf, nasab, shownName, surname, typedInFull, unit } from '../data/graph';
import { gToH, hToG, THIS_YEAR } from '../data/dates';
import { NEED, approversFor, TIER_AR } from '../data/governance';
import { defaultSpouse, marriageText, spouseIn, spousesOf } from '../data/marriages';
import { likelyDuplicates, nameKey } from '../data/names';
import type { Cal, Op, Sex } from '../data/types';
import { Icon } from './icons';
import { Seg } from './common';
import { CHECK_DUPLICATES, useDuplicateCheck } from './Duplicates';
import { useBack, useBackSteps } from './back';

type Step = 'other' | 'sex' | 'name' | 'birth' | 'review';

export function AddChild({ s, parent }: { s: State; parent: string }) {
  const g = s.graph;
  const p = g.nodes.get(parent)!;
  // the other parent: one of a man's wives, or a woman's husbands
  const spouses = spousesOf(g, parent);
  const [other, setOther] = useState<string | null>(() => defaultSpouse(g, parent));
  const [step, setStep] = useState(0);
  const [sex, setSex] = useState<Sex>('m');
  const [name, setName] = useState('');
  const [cal, setCal] = useState<Cal>(s.settings.cal);
  const hNow = gToH(THIS_YEAR)[1];
  const [year, setYear] = useState<number>(cal === 'g' ? THIS_YEAR : hNow);
  const [approx, setApprox] = useState(false);
  // not known yet: no year is recorded, and one can be added later from the person's details
  const [unknown, setUnknown] = useState(false);
  const close = () => set({ addFor: null });
  // back closes the sheet from its first page, and returns a page from the others
  useBack(close);
  useBackSteps(step, setStep);
  const o = other ? g.nodes.get(other) : undefined;
  const father = p.sex === 'm' ? p : o;
  const mother = p.sex === 'm' ? o : p;
  // under the father when he is in the tree; otherwise under the mother
  const fromFather = !!father && !father.external;
  // the given name alone, followed by the father's, whenever he is recorded (from outside, by his full
  // name); with no father recorded the full name is typed
  const named = !!father;
  const below = fromFather ? father : mother ?? p;
  const steps: Step[] = [...(spouses.length ? ['other' as const] : []), 'sex', 'name', 'birth', 'review'];
  const at = steps[step];
  const ward = sex === 'm' ? 'ابن' : 'ابنة';
  const motherName = mother ? nameOf(s, mother.id) : 'غير مسجلة';
  const fatherName = father ? nameOf(s, father.id) + (father.external ? ' (من خارج العائلة)' : '') : 'غير مسجل';
  // brothers and sisters already under the same parent by this name or one of their aliases
  const sibs = CHECK_DUPLICATES && name.trim() ? likelyDuplicates(g, name, { id: below.id }, undefined, sex).filter(k => canSee(s, k)) : [];
  // a brother or sister by the same name (an older one who died, say): both get «للتمييز»
  const [namesake, setNamesake] = useState<string | null>(null);
  const dups = useDuplicateCheck(s, id => set({ addFor: null, profile: id }), { ok: id => g.nodes.get(id)?.parent === below.id, pick: setNamesake });
  const ordinal = (k: number) => (sex === 'f' ? ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة'] : ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس'])[k] ?? String(k + 1);
  const twins = namesake && name.trim() ? below.kids.filter(k => nameKey(g.nodes.get(k)!.name) === nameKey(name)) : [];
  const marks = ((): { mine?: string; also: Op[] } => {
    if (!twins.length) return { also: [] };
    const old = g.nodes.get(twins[0])!;
    if (twins.length > 1 || old.suffix) return { mine: ordinal(twins.length), also: [] };
    // the one born first is «الأول»; with no year for the new one, it comes second
    const first = !unknown && old.by != null && (cal === 'g' ? year : hToG(year)[0]) < old.by;
    return { mine: ordinal(first ? 0 : 1), also: [{ op: 'updatePerson', id: old.id, before: { suffix: null }, after: { suffix: ordinal(first ? 1 : 0) } }] };
  })();
  const chain = (named && (fromFather || !typedInFull(name)) ? `${name.trim() ? unit({ name, suffix: marks.mine }) : '…'} ${sex === 'm' ? 'بن' : 'بنت'} ${unit(father)} ${fromFather ? nasab(g, father.id, 2) + ' ' + surname(g, father.id) : ''}` : name || '…').replace(/\s+/g, ' ').trim();
  const switchCal = (c: Cal) => {
    if (c === cal) return;
    setYear(c === 'h' ? gToH(year)[0] : hToG(year)[0]);
    setCal(c);
  };
  const conv = cal === 'g' ? gToH(year) : hToG(year);
  const convText = conv[0] === conv[1] ? String(conv[0]) : `${conv[0]} – ${conv[1]}`;
  const max = cal === 'g' ? THIS_YEAR : hNow;
  // the root admin may add directly while setting up (e.g. a branch with no key holders yet)
  const direct = s.rootAdmin && !s.isSample;
  // a key holder whose key covers it: added as it is sent
  const own = direct ? null : ownKey(s, below.id, 'everyday');
  const submit = (now = false) => {
    const tx = addChildTx(parent, { name: name.trim(), sex, ...(marks.mine ? { suffix: marks.mine } : {}), ...(unknown ? {} : { birth: { v: year, cal, approx: approx || undefined } }) }, now, other, marks.also);
    if (tx) set({ addFor: null, tab: now || own === 'done' ? 'tree' : 'requests' });
  };
  const fakeTx = { id: '', at: 0, by: getState().persona ?? getState().me ?? '', title: '', subject: below.id, level: 'everyday' as const, branch: below.branch, ops: [], status: 'pending' as const, approvals: [] };
  const who = approversFor(g, s.seats, fakeTx).slice(0, 3);
  // a spouse from outside can only have children with the one they married
  const unknownOk = !p.external;
  const label = (sp: string, i: number) => (canSee(s, sp) ? nameOf(s, sp) : (p.sex === 'm' ? 'الزوجة ' : 'الزوج ') + (i + 1));
  return (
    <div class="overlay full">
      <div class="addsheet">
        <div class="ahead">
          <button class="link" onClick={close}>
            إلغاء
          </button>
          <b>إضافة {ward}</b>
          <span>
            {step + 1} من {steps.length}
          </span>
        </div>
        <div class="prog">
          {steps.map((_, i) => (
            <i class={i <= step ? 'on' : ''} />
          ))}
        </div>
        <div class="who2">
          <div class="ph0">
            <Icon name="cam" />
          </div>
          <div>
            <b>{chain}</b>
            <small>{named ? 'الأم: ' + motherName : 'الأب: ' + fatherName}</small>
          </div>
        </div>

        {at === 'other' && (
          <>
            <div class="q">{p.sex === 'm' ? 'من الأم؟' : 'من الأب؟'}</div>
            <div class="qh">{p.sex === 'm' ? `من زوجات ${p.name}` : `من أزواج ${nameOf(s, parent)}`}</div>
            <div class="card list">
              {spouses.map((sp, i) => {
                const m = marriagesOf(g, parent).filter(x => spouseIn(x, parent) === sp).at(-1)!;
                return (
                  <button class={'brow' + (other === sp ? ' on' : '')} onClick={() => setOther(sp)}>
                    <span class="tick">{other === sp && <Icon name="check" size={16} />}</span>
                    <span class="pt">
                      <b>{label(sp, i)}</b>
                      <small>{canSee(s, sp) && canSee(s, parent) ? marriageText(s, m) : ''}</small>
                    </span>
                  </button>
                );
              })}
              {unknownOk && (
                <button class={'brow' + (other === null ? ' on' : '')} onClick={() => setOther(null)}>
                  <span class="tick">{other === null && <Icon name="check" size={16} />}</span>
                  <span class="pt">
                    <b>{p.sex === 'm' ? 'غير مسجلة' : 'غير مسجل'}</b>
                    <small>{p.sex === 'm' ? 'لمن لا تُعرف أمه' : 'لمن لا يُعرف أبوه'}، في الأجيال القديمة</small>
                  </span>
                </button>
              )}
            </div>
          </>
        )}
        {at === 'sex' && (
          <>
            <div class="q">ابن أم ابنة؟</div>
            <div class="bigchoice">
              <button class={sex === 'm' ? 'on' : ''} onClick={() => setSex('m')}>
                ابن
              </button>
              <button class={sex === 'f' ? 'on' : ''} onClick={() => setSex('f')}>
                ابنة
              </button>
            </div>
          </>
        )}
        {at === 'name' && (
          <>
            {named ? (
              <>
                <div class="q">{sex === 'm' ? 'ما اسمه؟' : 'ما اسمها؟'}</div>
                <div class="qh">{fromFather ? 'الاسم الأول فقط، ويُبنى النسب تلقائيًا من الشجرة.' : `الاسم الأول فقط، ويُتبع باسم ${sex === 'm' ? 'أبيه' : 'أبيها'} كما سُجّل.`}</div>
              </>
            ) : (
              <>
                <div class="q">{sex === 'm' ? 'ما اسمه كاملًا؟' : 'ما اسمها كاملًا؟'}</div>
                <div class="qh">{sex === 'm' ? 'أبوه غير مسجل' : 'أبوها غير مسجل'}: اكتب الاسم مع اسم الأب والعائلة إن عُرفا، أو الاسم الأول وحده إن كان الأب سيُضاف لاحقًا فيُتبع باسمه.</div>
              </>
            )}
            <input
              class="bigin"
              value={name}
              onInput={e => setName((e.target as HTMLInputElement).value)}
              placeholder={named ? (sex === 'm' ? 'مثل: سلمان' : 'مثل: جود') : `مثل: ${sex === 'm' ? 'عبدالله بن' : 'جود بنت'} سعد القحطاني`}
              dir="rtl"
              autoFocus
            />
            {sibs.length > 0 && (
              <div class="warnbox">
                بين أبناء {nameOf(s, below.id)} من يحمل هذا الاسم أو يُعرف به. هل {sex === 'm' ? 'هو نفسه' : 'هي نفسها'}؟
              </div>
            )}
          </>
        )}
        {at === 'birth' && (
          <>
            <div class="q">{sex === 'f' ? 'متى وُلدت؟' : 'متى وُلد؟'}</div>
            <div class="qh">تكفي السنة. اليوم والشهر اختياريان.</div>
            <label class="opt">
              <span>
                <b>سنة الميلاد غير معروفة</b>
                <small>يمكن إضافتها لاحقًا متى عُرفت</small>
              </span>
              <input type="checkbox" checked={unknown} onChange={e => setUnknown((e.target as HTMLInputElement).checked)} />
            </label>
            {!unknown && (
              <>
                <Seg cls="bigseg" value={cal} options={[['g', 'ميلادي'], ['h', 'هجري']]} onChange={switchCal} />
                <div class="wheel">
                  <button class="wb" onClick={() => setYear(Math.min(max, year + 1))} aria-label="زيادة">
                    ▲
                  </button>
                  <div class="wv">
                    {year} {cal === 'h' && <small>هـ</small>}
                  </div>
                  <button class="wb" onClick={() => setYear(year - 1)} aria-label="إنقاص">
                    ▼
                  </button>
                </div>
                <input class="range" type="range" min={cal === 'g' ? 1700 : 1110} max={max} value={year} onInput={e => setYear(+(e.target as HTMLInputElement).value)} />
                <div class="conv">
                  <Icon name="cal" size={18} /> يوافق <b>{convText} {cal === 'g' ? 'هـ' : 'م'}</b>
                </div>
                {cal === 'h' && <div class="keep">✓ تُحفظ السنة الهجرية كما أدخلتها</div>}
                <label class="opt">
                  <span>
                    <b>السنة تقريبية</b>
                    <small>مثلًا: وُلد حوالي {cal === 'g' ? 1950 : 1370}</small>
                  </span>
                  <input type="checkbox" checked={approx} onChange={e => setApprox((e.target as HTMLInputElement).checked)} />
                </label>
              </>
            )}
          </>
        )}
        {at === 'review' && (
          <>
            <div class="q">مراجعة</div>
            <div class="card review">
              <div>
                <small>الاسم</small>
                <b>{chain}</b>
                {marks.also.length > 0 && (
                  <small>
                    {sex === 'f' ? 'وأختها المسجلة تصبح' : 'وأخوه المسجل يصبح'} «{shownName({ name: g.nodes.get(twins[0])!.name, suffix: (marks.also[0] as Extract<Op, { op: 'updatePerson' }>).after.suffix ?? undefined })}»
                  </small>
                )}
              </div>
              {!fromFather && (
                <div>
                  <small>الأب</small>
                  <b>{fatherName}</b>
                </div>
              )}
              <div>
                <small>الأم</small>
                <b>{motherName}</b>
              </div>
              <div>
                <small>الميلاد</small>
                <b>
                  {unknown ? 'غير معروفة' : `${approx ? 'حوالي ' : ''}${year} ${cal === 'h' ? 'هـ ' : ''}· ${convText} ${cal === 'g' ? 'هـ' : 'م'}`}
                </b>
              </div>
              <div>
                <small>يعتمده</small>
                {own === 'done' ? (
                  <b>أنت، بمفتاحك</b>
                ) : (
                  <>
                    <b>
                      {NEED.everyday.text} من فرع {below.branch ? g.nodes.get(below.branch)!.name : g.family.name}
                    </b>
                    <small>{who.map(w => nameOf(s, w.holder) + ' (' + TIER_AR[w.tier] + ')').join('، ')}</small>
                  </>
                )}
              </div>
            </div>
            {father && mother && hiddenWith(s, father.id, mother.id) && <div class="warnbox">زواج أبويه مخفي: يُعلن للعائلة مع إضافة الابن، في طلب واحد يعتمده ذهبي الفرع، ولا رجعة في الإعلان.</div>}
            <p class="hint">
              {direct
                ? 'يُضاف مباشرة لأنك مشرف العائلة، ويُسجَّل في السجل ويمكن التراجع عنه.'
                : own === 'done'
                  ? 'يُعتمد بمفتاحك ويُضاف فور إرساله، ويُسجَّل في السجل ويمكن التراجع عنه.'
                  : own === 'one'
                    ? 'يُرسل كطلب ومعه اعتمادك، ويُحفظ بعد بقية الاعتمادات. كل تغيير يُحفظ في السجل ويمكن التراجع عنه.'
                    : 'يُرسل كطلب، ويُضاف إلى الشجرة بعد الاعتماد. كل تغيير يُحفظ في السجل ويمكن التراجع عنه.'}
            </p>
          </>
        )}
        <div class="foot">
          <button class="btn" onClick={() => (step ? setStep(step - 1) : close())}>
            {step ? 'السابق' : 'إلغاء'}
          </button>
          {at !== 'review' ? (
            <button
              class="btn primary"
              disabled={(at === 'name' && !name.trim()) || (at === 'other' && !other && !unknownOk)}
              onClick={() => (at === 'name' ? dups.check(sibs, () => setStep(step + 1)) : setStep(step + 1))}
            >
              التالي
            </button>
          ) : (
            <button class="btn primary" onClick={() => dups.check(likelyDuplicates(g, name, { id: below.id }, unknown ? undefined : { v: year, cal }, sex), () => submit(direct))}>
              {direct || own === 'done' ? 'إضافة إلى الشجرة' : 'إرسال للاعتماد'}
            </button>
          )}
        </div>
        {dups.sheet}
      </div>
    </div>
  );
}
