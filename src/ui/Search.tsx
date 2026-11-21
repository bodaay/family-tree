import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { set, canSee, nameOf, unitOf, appoint, linkSelf, createInvite, setViewAll, movePerson, widen, type State } from '../data/store';
import { seatOf, seatProblem, TIER_AR } from '../data/governance';
import { nasab } from '../data/graph';
import { aliasesOf, keysOf, matchWords, nameWords, searchChains } from '../data/names';
import type { Alias } from '../data/types';
import { closeBlood, inLawProblem } from '../data/marriages';
import { milkRecordProblem } from '../data/milk';
import { Icon } from './icons';
import { PersonRow, SeatBadge, genLabel } from './common';
import { useBack } from './back';
import { mayExport } from '../export/build';

interface Found {
  id: string;
  gen: number;
  /** The alias the typed words matched, if not the name. */
  alias?: Alias | null;
}

/**
 * Search by name or any alias, or by a name chain ("سامر بن نبيل", "أبو فهد بن
 * سعد"), however the hamza or ta marbuta is written. Hidden women are never
 * matched, by name or alias.
 */
export function Search({ s }: { s: State }) {
  useBack(() => set({ searchOpen: false, pickSeat: null, mergeFor: null }));
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const mode = s.searchOpen;
  const index = useMemo(() => {
    // spouses from outside are recorded by name only: they are found through the one they married
    return [...s.graph.nodes.values()]
      .filter(n => !n.familyRoot && !n.external)
      .map(n => ({ id: n.id, chains: searchChains(s.graph, n.id), gen: n.gen }));
  }, [s.graph]);
  const seat = mode === 'seat' ? s.pickSeat : null;
  const merging = mode === 'merge' && s.mergeFor && s.graph.nodes.has(s.mergeFor) ? s.mergeFor : null;
  // choosing a wife or husband from the tree: the other sex, and not a close blood relative
  const spouseOf = mode === 'spouse' && s.spouseFor ? s.graph.nodes.get(s.spouseFor) ?? null : null;
  const marriable = (id: string) => {
    if (!spouseOf) return true;
    if (s.graph.nodes.get(id)!.sex === spouseOf.sex || closeBlood(s.graph, spouseOf.id, id)) return false;
    // relations by marriage no one ever marries (two at once are the sheet's to say)
    const [h, w] = spouseOf.sex === 'm' ? [spouseOf.id, id] : [id, spouseOf.id];
    return !inLawProblem(s.graph, h, w, 'divorced');
  };
  const results = useMemo((): Found[] => {
    const t = nameWords(q);
    const by = (id: string) => s.graph.nodes.get(id)!.by ?? 9999;
    // filling a key seat: living members of that branch who are not in this group yet;
    // until a name is typed, those without a key first, the eldest first
    const eligible = (id: string) => {
      if (!seat || id === seat.replaces || seatProblem(s.graph, seat.tier, seat.branch, id)) return false;
      const cur = seatOf(s.seats, id);
      return !cur || cur.tier !== seat.tier || cur.branch !== seat.branch;
    };
    if (seat && !t.length) {
      const held = (id: string) => (seatOf(s.seats, id) ? 1 : 0);
      return index
        .filter(e => canSee(s, e.id) && eligible(e.id))
        .sort((x, y) => held(x.id) - held(y.id) || by(x.id) - by(y.id))
        .slice(0, 40);
    }
    // merging: until a name is typed, others with the same name or alias, the same parent first
    if (merging && !t.length) {
      const m = s.graph.nodes.get(merging)!;
      const mine = keysOf(m);
      return index
        .filter(e => e.id !== merging && canSee(s, e.id) && [...keysOf(s.graph.nodes.get(e.id)!)].some(k => mine.has(k)))
        .sort((x, y) => +(s.graph.nodes.get(y.id)!.parent === m.parent) - +(s.graph.nodes.get(x.id)!.parent === m.parent) || x.gen - y.gen || by(x.id) - by(y.id))
        .slice(0, 40);
    }
    if (!t.length) return [];
    const found: Found[] = [];
    for (const e of index) {
      if (!canSee(s, e.id) || e.id === merging) continue;
      const hit = e.chains.find(c => matchWords(c.words, t));
      if (hit) found.push({ id: e.id, gen: e.gen, alias: hit.alias });
    }
    return found
      .filter(e => (mode !== 'me' && mode !== 'invite') || !s.graph.nodes.get(e.id)!.dead)
      .filter(e => !seat || eligible(e.id))
      .filter(e => marriable(e.id))
      // exporting: only whom this phone may export
      .filter(e => mode !== 'export' || mayExport(s, e.id))
      // the woman who nursed someone: a woman, not the child nor his mother
      .filter(e => mode !== 'milk' || !s.milkFor || !milkRecordProblem(s.graph, s.milkFor, e.id, null))
      .sort((x, y) => x.gen - y.gen || by(x.id) - by(y.id))
      .slice(0, 60);
  }, [q, index, s.settings.privacy, s.persona, s.me, mode, seat, s.seats, merging, spouseOf, s.milkFor]);
  // the alias that matched first, then the others
  const aka = (r: Found) => {
    const list = aliasesOf(s.graph.nodes.get(r.id));
    return [...(r.alias ? [r.alias] : []), ...list.filter(a => a !== r.alias)].map(a => a.text).join(' · ');
  };

  const pick = (id: string) => {
    if (mode === 'relation') set({ searchOpen: false, relB: id, tab: 'relation' });
    else if (mode === 'relationA') set({ searchOpen: false, relA: id, tab: 'relation' });
    else if (mode === 'me' && !s.isSample) {
      // a real family: only the root admin links their own phone; members join by invite
      set({ searchOpen: false });
      if (s.rootAdmin) linkSelf(id);
    } else if (mode === 'me') set({ searchOpen: false, me: id, persona: null, relA: id });
    else if (mode === 'invite') {
      set({ searchOpen: false });
      void createInvite(id);
    } else if (mode === 'move' && s.moveFor) {
      const who = s.graph.nodes.get(s.moveFor)!;
      set({ searchOpen: false, moveFor: null });
      if (id !== s.moveFor && confirm(`نقل ${who.name} ليكون من أبناء ${s.graph.nodes.get(id)!.name}؟`)) movePerson(who.id, id);
    } else if (mode === 'merge') {
      set({ searchOpen: false, mergeWith: id });
    } else if (mode === 'line') {
      set({ searchOpen: false, lineFrom: id });
    } else if (mode === 'spouse') {
      set({ searchOpen: false, spousePick: id });
    } else if (mode === 'milk') {
      set({ searchOpen: false, milkPick: id });
    } else if (mode === 'viewall') {
      set({ searchOpen: false });
      setViewAll(id, true);
    } else if (mode === 'export' && s.exportFor) {
      set({ searchOpen: false, exportFor: { from: id, kind: s.graph.nodes.get(id)?.familyRoot ? 'down' : s.exportFor.kind } });
    } else if (mode === 'grant' && s.grantFor) {
      const woman = s.grantFor;
      const cur = s.own.get(woman) ?? { reach: 'family' as const, people: [] };
      set({ searchOpen: false, grantFor: null });
      if (id !== woman && !cur.people.includes(id)) void widen(woman, { ...cur, people: [...cur.people, id] }, `يرى ${nameOf(s, id)} تفاصيلها الآن`);
    }
    else if (seat) {
      const cur = seatOf(s.seats, id);
      if (cur && !confirm(`${nameOf(s, id)} يحمل مفتاحًا ${TIER_AR[cur.tier]}. لا يحمل أحد مفتاحين، فسيُخلى مقعده الحالي. متابعة؟`)) return;
      set({ searchOpen: false, pickSeat: null });
      appoint(seat.tier, seat.branch, id, seat.replaces);
    }
    else set({ searchOpen: false, focus: id, tab: 'tree', gen: null });
  };
  const title = seat
    ? `تسليم مفتاح ${TIER_AR[seat.tier]}${seat.branch ? ' · فرع ' + s.graph.nodes.get(seat.branch)!.name : ''}`
    : mode === 'me' ? 'من أنت في الشجرة؟' : mode === 'invite' ? 'دعوة فرد' : mode === 'viewall' ? 'منح مشاهدة الكل' : mode === 'grant' ? 'من يرى تفاصيلها' : mode === 'export' ? 'تصدير شجرة من' : mode === 'milk' ? 'المرضعة من العائلة' : mode === 'line' ? 'أقرب جد موجود في الشجرة' : mode === 'move' ? 'الأب أو الأم الصحيح' : mode === 'merge' ? 'السجل المكرر' : spouseOf ? (spouseOf.sex === 'm' ? 'زوجته من العائلة' : 'زوجها من العائلة') : mode === 'relation' || mode === 'relationA' ? 'اختر شخصًا' : 'بحث';
  return (
    <div class="overlay full">
      <div class="searchpage">
        <div class="shead">
          <button class="round" onClick={() => set({ searchOpen: false, pickSeat: null, mergeFor: null })} aria-label="إغلاق">
            <Icon name="chevR" />
          </button>
          <b>{title}</b>
        </div>
        <label class="sfield">
          <Icon name="search" />
          <input ref={input} value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} placeholder="اكتب الاسم، أو الاسم واسم الأب…" dir="rtl" />
        </label>
        {mode === 'me' && !q && <p class="hint">اكتب اسمك ثم اسم أبيك، مثل «سامر نبيل».</p>}
        {mode === 'invite' && !q && <p class="hint">اكتب اسم من تدعوه ثم اسم أبيه، مثل «سامر نبيل».</p>}
        {spouseOf && !q && <p class="hint">{spouseOf.sex === 'm' ? 'اكتب اسمها ثم اسم أبيها، مثل «غادة نبيل».' : 'اكتب اسمه ثم اسم أبيه، مثل «سامر نبيل».'}</p>}
        {mode === 'line' && !q && <p class="hint">اكتب اسم أقرب جد لك موجود في الشجرة، مثل «علي». ستكتب بعده الأسماء حتى تصل إليك.</p>}
        {merging && !q && (
          <p class="hint">
            اختر السجل الآخر لـ {unitOf(s, merging)} {nasab(s.graph, merging, 2)}. {results.length ? 'بالاسم نفسه في الشجرة:' : 'اكتب اسمه للبحث.'}
          </p>
        )}
        {seat && !q && <p class="hint">{seat.branch ? 'من أحياء الفرع' : 'من أحياء العائلة'}، الأكبر سنًا أولًا. اكتب اسمًا للبحث.</p>}
        <div class="results">
          {results.map(r => (
            <PersonRow s={s} id={r.id} full aka={aka(r)} onClick={() => pick(r.id)} right={seat && seatOf(s.seats, r.id) ? <SeatBadge s={s} id={r.id} /> : <small class="mut">{genLabel(r.gen)}</small>} />
          ))}
          {q && results.length === 0 && <p class="hint">لا نتائج. جرّب جزءًا من الاسم.</p>}
        </div>
      </div>
    </div>
  );
}
