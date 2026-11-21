import type { ComponentChildren } from 'preact';
import { getState, nameOf, unitOf, canSee, set, type State } from '../data/store';
import { showYear } from '../data/dates';
import { marriagesOf, nasab, surname, viaMother } from '../data/graph';
import { branchColor } from '../tree/render';
import { seatOf, TIER_AR } from '../data/governance';
import { Icon } from './icons';
import { useBack } from './back';

/** Wide screens (tablets, unfolded foldables, desktops) keep a side panel. */
export const PANEL = 440;
export function isWide(): boolean {
  return window.innerWidth >= 720;
}

export function themeOf(s: State): 'dark' | 'light' {
  if (s.settings.theme !== 'system') return s.settings.theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function Avatar({ id, size = 40, s }: { id: string; size?: number; s: State }) {
  const n = s.graph.nodes.get(id);
  if (!n) return null;
  const col = branchColor(s.graph, id, themeOf(s));
  const vis = canSee(s, id);
  const letter = vis ? n.name.replace(/^(عبد|ال)/, m => (m === 'عبد' ? 'ع' : '')).charAt(0) : '';
  const style = { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px', '--c': col } as Record<string, string>;
  return (
    <div class={'av' + (n.sex === 'f' ? ' f' : '') + (n.dead && !n.familyRoot ? ' dead' : '')} style={style}>
      {vis ? letter : <Icon name="lock" size={Math.round(size * 0.42)} />}
    </div>
  );
}

export function YearText({ s, y }: { s: State; y: Parameters<typeof showYear>[0] }) {
  const t = showYear(y, s.settings.cal);
  return (
    <span class="yr">
      <b>{t.main}</b>
      {t.alt && <i>{t.alt}</i>}
    </span>
  );
}

export function yearShort(s: State, id: string): string {
  const n = s.graph.nodes.get(id);
  if (!n || !n.birth) return '';
  if (!canSee(s, id)) return '';
  const b = showYear(n.birth, s.settings.cal).main;
  if (n.death) return `${b}–${showYear(n.death, s.settings.cal).main}`;
  return b;
}

/**
 * The line under a name: the nasab and the family's name; for a daughter's
 * child, their father from outside (when recorded) and their mother; for a
 * spouse from outside, whom they married.
 */
export function lineOf(s: State, id: string): string {
  const g = s.graph;
  const n = g.nodes.get(id)!;
  if (n.external) {
    const m = marriagesOf(g, id)[0];
    const sp = m && (m.husband === id ? m.wife : m.husband);
    return (sp ? `${n.sex === 'f' ? 'زوجة' : 'زوج'} ${nameOf(s, sp)} · ` : '') + 'من خارج العائلة';
  }
  if (viaMother(n)) return [nasab(g, id, 4), motherLine(s, id)].filter(Boolean).join(' · ');
  return [nasab(g, id, 4), n.familyRoot ? '' : surname(g, id)].filter(Boolean).join(' ');
}

/** A daughter's child's tie to the family: «أمه» and her whole name. */
export function motherLine(s: State, id: string): string {
  const g = s.graph;
  const n = g.nodes.get(id)!;
  const mo = n.mother!;
  const mother = canSee(s, mo) ? [unitOf(s, mo), nasab(g, mo, 3), surname(g, mo)].filter(Boolean).join(' ') : 'ابنة من ' + g.family.name;
  return (n.sex === 'm' ? 'أمه ' : 'أمها ') + mother;
}

/** How many children, in Arabic: «ابن واحد», «ابنان», «5 أبناء», «15 ابنًا». */
export function kidsCount(n: number): string {
  return n === 1 ? 'ابن واحد' : n === 2 ? 'ابنان' : n <= 10 ? n + ' أبناء' : n + ' ابنًا';
}

export function deadMark(s: State, id: string): string {
  const n = s.graph.nodes.get(id)!;
  if (!n.dead || n.familyRoot) return '';
  return n.sex === 'm' ? 'رحمه الله' : 'رحمها الله';
}

export function SeatBadge({ s, id }: { s: State; id: string }) {
  const seat = seatOf(s.seats, id);
  if (!seat) return null;
  return (
    <span class={'key ' + seat.tier}>
      <Icon name="key" size={13} /> {TIER_AR[seat.tier]}
      {seat.branch ? ' · فرع ' + s.graph.nodes.get(seat.branch)!.name : ''}
    </span>
  );
}

/** `aka`: the names the person is also known by, shown under the years (search results). */
/** The whole chain of fathers after a name, down to the family's name: what lists show, never cut. */
export function fullLine(s: State, id: string): string {
  const n = s.graph.nodes.get(id)!;
  if (!canSee(s, id) || n.familyRoot || n.external) return '';
  return [nasab(s.graph, id, 40), viaMother(n) ? '' : surname(s.graph, id)].filter(Boolean).join(' ');
}

/**
 * A person in a list: the name with the whole chain of fathers after it, down to
 * the family's name (wrapped, never cut), then the years. Every list shows the
 * same full name, so one person reads the same everywhere.
 */
export function PersonRow({ s, id, onClick, right, aka, full = true }: { s: State; id: string; onClick?: () => void; right?: ComponentChildren; aka?: string; full?: boolean }) {
  const n = s.graph.nodes.get(id)!;
  const vis = canSee(s, id);
  const chain = !vis || n.familyRoot ? '' : full ? fullLine(s, id) : nasab(s.graph, id, 2);
  const about = [yearShort(s, id), n.external ? 'من خارج العائلة' : '', n.dead && !n.familyRoot ? deadMark(s, id) : ''].filter(Boolean).join(' · ');
  return (
    <button class="prow" onClick={onClick}>
      <Avatar id={id} s={s} size={38} />
      <span class="pt">
        <b>
          {chain ? unitOf(s, id) : nameOf(s, id)} {chain && <small class="mut">{chain}</small>}
        </b>
        <small>{about || (n.familyRoot ? 'العائلة' : '')}</small>
        {aka && canSee(s, id) && (
          <small class="aka">
            {n.sex === 'f' ? 'تُعرف بـ' : 'يُعرف بـ'} {aka}
          </small>
        )}
      </span>
      {right}
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange, cls = '' }: { value: T; options: [T, string][]; onChange: (v: T) => void; cls?: string }) {
  return (
    <div class={'seg ' + cls}>
      {options.map(([v, label]) => (
        <button class={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function CalSeg({ s }: { s: State }) {
  return (
    <Seg
      value={s.settings.cal}
      options={[['g', 'ميلادي'], ['h', 'هجري']]}
      onChange={cal => set({ settings: { ...getState().settings, cal } })}
    />
  );
}

export function Sheet({ children, onClose, title, cls = '' }: { children: ComponentChildren; onClose: () => void; title?: string; cls?: string }) {
  useBack(onClose);
  return (
    <div class="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div class={'modal ' + cls}>
        <div class="mhead">
          <button class="link" onClick={onClose}>
            إغلاق
          </button>
          <b>{title}</b>
          <span />
        </div>
        {children}
      </div>
    </div>
  );
}

export function genLabel(g: number): string {
  const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر'];
  return 'الجيل ' + (ORD[g] ?? g + 1);
}

/** Folds Arabic spellings for comparing names (see data/names.ts). */
export { normName as norm } from '../data/names';

/** What the root admin did as this member (design document 1.38): it is in the family's record for all to see, and said here too. */
export function ActedFor({ s, id }: { s: State; id: string }) {
  const a = s.acted.get(id);
  if (!a) return null;
  const f = s.graph.nodes.get(id)?.sex === 'f';
  const you = s.me === id && !s.actingAs;
  const day = new Date(a.at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium' });
  const times = a.n === 1 ? 'مرة واحدة' : a.n === 2 ? 'مرتين' : `${a.n} مرات`;
  return (
    <p class="hint acted">
      <Icon name="eye" size={14} /> {you ? `عمل مشرف العائلة بصفت${f ? 'كِ' : 'ك'}` : `عمل مشرف العائلة بصفة ${nameOf(s, id)}`} {times}، آخرها {day}. يظهر كل ذلك في سجل الطلبات باسم «مشرف العائلة بصفة {nameOf(s, id)}».
    </p>
  );
}
