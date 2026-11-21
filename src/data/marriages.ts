// Marriages: a man's wives, a daughter's husband from outside the family, and
// each wife's children. Adding a wife or husband, and divorce or widowhood, are
// sensitive changes (a gold key of the husband's branch approves them); the root
// admin records them directly while setting up. Status and years only, never reasons.
import type { Marriage, MarriagePatch, Op, Person, PersonPatch, Year } from './types';
import { marriagesOf, newId, type Graph } from './graph';
import { blood } from './kinship';
import { gYear, showYear } from './dates';
import { canSee, change, getState, recordOf, toast, type State } from './store';
import { marriageMilkWarning } from './milk';

export type Status = Marriage['status'];

/** The other one in a marriage. */
export function spouseIn(m: Marriage, id: string): string {
  return m.husband === id ? m.wife : m.husband;
}

/** A person's husbands or wives, each once, in the order they married. */
export function spousesOf(g: Graph, id: string): string[] {
  return [...new Set(marriagesOf(g, id).map(m => spouseIn(m, id)))];
}

/** The usual other parent of a new child: the only spouse, or the latest current one. */
export function defaultSpouse(g: Graph, id: string): string | null {
  const ms = marriagesOf(g, id);
  const cur = ms.filter(m => m.status === 'married');
  const m = (cur.length ? cur : ms).at(-1);
  return m ? spouseIn(m, id) : null;
}

/** The word for a widowed marriage: his widow, her widower, or either while no death is recorded. */
export function widowWord(g: Graph, husband: string | null, wife: string | null): string {
  if (husband && g.nodes.get(husband)?.dead) return 'أرملة';
  if (wife && g.nodes.get(wife)?.dead) return 'أرمل';
  return 'أرمل·أرملة';
}

function statusWord(g: Graph, m: Pick<Marriage, 'status' | 'husband' | 'wife'>): string {
  if (m.status === 'married') return 'متزوجان';
  if (m.status === 'divorced') return 'مطلّقان';
  const w = widowWord(g, m.husband, m.wife);
  return w === 'أرمل·أرملة' ? 'ترمّل' : w;
}

/** "متزوجان منذ 1990", "مطلّقان · 1990–2005": shown only to those who may see both spouses. */
export function marriageText(s: State, m: Marriage): string {
  const y = (v: Year) => showYear(v, s.settings.cal).main;
  const word = statusWord(s.graph, m);
  if (m.status === 'married') return m.year ? `${word} منذ ${y(m.year)}` : word;
  const years = m.year && m.end ? `${y(m.year)}–${y(m.end)}` : m.end ? 'حتى ' + y(m.end) : m.year ? 'من ' + y(m.year) : '';
  return years ? `${word} · ${years}` : word;
}

export function marriageVisible(s: State, m: Marriage): boolean {
  return canSee(s, m.husband) && canSee(s, m.wife);
}

/**
 * Blood relatives no one marries: ancestors and descendants, the descendants of
 * one's parents (brothers, sisters, their children and grandchildren), and the
 * children of any grandparent (aunts and uncles, the parents' too). Cousins may marry.
 */
export function closeBlood(g: Graph, a: string, b: string): boolean {
  const bl = blood(g, a, b);
  return !!bl && Math.min(bl.A.get(bl.lca)!.d, bl.B.get(bl.lca)!.d) <= 1;
}

/** Someone's parents and their parents, up the tree, as recorded (fathers and mothers). */
function forebears(g: Graph, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (x: string) => {
    const n = g.nodes.get(x);
    for (const p of [n?.father, n?.mother]) if (p && g.nodes.has(p) && !out.has(p)) (out.add(p), walk(p));
  };
  walk(id);
  return out;
}

/** Two women (or men) with a father or a mother in common. */
function siblings(g: Graph, a: string, b: string): boolean {
  const x = g.nodes.get(a), y = g.nodes.get(b);
  return a !== b && !!x && !!y && ((!!x.father && x.father === y.father) || (!!x.mother && x.mother === y.mother));
}

/**
 * Relations by marriage no one marries (المحرّمات بالمصاهرة): a father's or
 * grandfather's wife, a son's or grandson's wife, a wife's mother or
 * grandmother, and a wife's daughter or granddaughter once that marriage is
 * more than a contract (it is current, or has children; the app cannot know
 * otherwise). And while married, never two at once: two sisters, or a woman and
 * her aunt (عمتها أو خالتها). Within the tree only: the relatives of a spouse
 * from outside are not recorded.
 */
export function inLawProblem(g: Graph, husband: string, wife: string, status: Status): string | null {
  const his = forebears(g, husband);
  const hers = forebears(g, wife);
  for (const m of g.marriages) {
    if (m.husband === husband && m.wife === wife) continue;
    // she was the wife of one of his fathers, or of one of his sons
    if (m.wife === wife && his.has(m.husband)) return 'كانت زوجة لأبيه أو أحد أجداده';
    if (m.wife === wife && forebears(g, m.husband).has(husband)) return 'كانت زوجة لابنه أو أحد أحفاده';
    if (m.husband !== husband) continue;
    // one of his wives is her daughter or granddaughter, or her mother or grandmother
    if (forebears(g, m.wife).has(wife)) return 'أم إحدى زوجاته أو جدتها';
    const kids = [...g.nodes.values()].some(k => k.father === husband && k.mother === m.wife);
    if (hers.has(m.wife) && (m.status === 'married' || kids)) return 'بنت إحدى زوجاته أو حفيدتها';
  }
  if (status !== 'married') return null;
  for (const m of g.marriages) {
    if (m.husband !== husband || m.status !== 'married' || m.wife === wife) continue;
    if (siblings(g, m.wife, wife)) return 'أخت زوجته الحالية: لا يُجمع بين الأختين';
    const aunt = (a: string, of: string) => [...forebears(g, of)].some(p => siblings(g, a, p));
    if (aunt(m.wife, wife) || aunt(wife, m.wife)) return 'لا يُجمع بين المرأة وعمتها أو خالتها';
  }
  return null;
}

/** Why this marriage cannot be recorded, or null. `spouse` is null for someone from outside. */
export function spouseProblem(g: Graph, of: string, spouse: string | null, status: Status): string | null {
  const p = g.nodes.get(of)!;
  const husband = p.sex === 'm' ? of : spouse;
  const wife = p.sex === 'm' ? spouse : of;
  const current = (id: string | null) => (id ? marriagesOf(g, id).filter(m => m.status === 'married') : []);
  if (spouse) {
    const q = g.nodes.get(spouse);
    if (!q || q.familyRoot || spouse === of) return 'اختر شخصًا آخر';
    if (q.sex === p.sex) return p.sex === 'm' ? 'الزوجة امرأة' : 'الزوج رجل';
    if (status === 'married' && current(of).some(m => spouseIn(m, of) === spouse)) return 'الزواج مسجل أصلًا';
    if (closeBlood(g, of, spouse)) return 'قرابة لا يصح معها الزواج';
    const inLaw = inLawProblem(g, husband!, wife!, status);
    if (inLaw) return inLaw;
  }
  if (status !== 'married') return null;
  if (wife && current(wife).length) return 'لها زوج حالي: سجّل انفصال زواجها أولًا';
  if (husband && current(husband).length >= 4) return 'له أربع زوجات حاليًا';
  return null;
}

/** The husband's branch approves a marriage, or the wife's when he is from outside. */
function subjectOf(g: Graph, m: Pick<Marriage, 'husband' | 'wife'>): string {
  return g.nodes.get(m.husband)?.external ? m.wife : m.husband;
}

const names = (g: Graph, m: Pick<Marriage, 'husband' | 'wife'>) => `${g.nodes.get(m.husband)!.name} و${g.nodes.get(m.wife)!.name}`;

/**
 * A wife for a man, or a husband for a woman: someone already in the tree, or
 * someone from outside the family (a name and, if known, a birth year).
 */
export function addSpouse(of: string, spouse: string | { name: string; birth?: Year | null }, rec: { status: Status; year?: Year | null; end?: Year | null }) {
  const g = getState().graph;
  const p = g.nodes.get(of)!;
  const ops: Op[] = [];
  let id: string;
  let name: string;
  if (typeof spouse === 'string') {
    id = spouse;
    name = g.nodes.get(spouse)!.name;
  } else {
    name = spouse.name.trim();
    const person: Person = { id: newId('n'), name, sex: p.sex === 'm' ? 'f' : 'm', external: true, ...(spouse.birth ? { birth: spouse.birth } : {}) };
    ops.push({ op: 'addPerson', person });
    id = person.id;
  }
  const why = spouseProblem(g, of, typeof spouse === 'string' ? spouse : null, rec.status);
  if (why) {
    toast(why);
    return null;
  }
  const marriage: Marriage = {
    id: newId('m'),
    husband: p.sex === 'm' ? of : id,
    wife: p.sex === 'm' ? id : of,
    status: rec.status,
    ...(rec.year ? { year: rec.year } : {}),
    ...(rec.status !== 'married' && rec.end ? { end: rec.end } : {}),
  };
  ops.push({ op: 'addMarriage', marriage });
  // a milk relation that would bar it by birth: sent with a warning, those who approve it decide (design document 1.36)
  const warn = typeof spouse === 'string' ? marriageMilkWarning(g, marriage.husband, marriage.wife) : null;
  const title = (p.sex === 'm' ? `إضافة زوجة لـ ${p.name}: ${name}` : `إضافة زوج لـ ${p.name}: ${name}`) + (warn ? ` — ${warn}` : '');
  const subject = typeof spouse === 'string' ? subjectOf(g, marriage) : of;
  return change({ title, subject, level: 'sensitive', ops }, p.sex === 'm' ? 'أُضيفت الزوجة' : 'أُضيف الزوج');
}

/**
 * The children a marriage can hold: those in the tree under the husband, or
 * under the wife when he is from outside the family; and the field on each
 * child that names the other parent (the mother, or the father from outside).
 */
export function kidsLine(g: Graph, m: Marriage): { line: string; other: string; field: 'mother' | 'father'; kids: string[] } {
  const viaWife = !!g.nodes.get(m.husband)?.external;
  const line = viaWife ? m.wife : m.husband;
  const kids = [...g.nodes.values()]
    .filter(k => k.parent === line && (viaWife ? k.mother : k.father) === line)
    .sort((a, b) => (a.by ?? 9999) - (b.by ?? 9999))
    .map(k => k.id);
  return { line, other: viaWife ? m.husband : m.wife, field: viaWife ? 'father' : 'mother', kids };
}

/**
 * Root admin: which of those children are this marriage's. The chosen take this
 * spouse as their other parent (moving from another wife if need be); those
 * left out who had this spouse are left with none recorded. One change, undone as one.
 */
export function linkKids(id: string, chosen: string[]) {
  const g = getState().graph;
  const m = g.marriages.find(x => x.id === id);
  if (!m) return null;
  const { line, other, field, kids } = kidsLine(g, m);
  const pick = new Set(chosen);
  const patch = (v: string | null): PersonPatch => (field === 'mother' ? { mother: v } : { father: v });
  const ops: Op[] = [];
  for (const k of kids) {
    const cur = g.nodes.get(k)![field] ?? null;
    const want = pick.has(k) ? other : cur === other ? null : cur;
    if (want !== cur) ops.push({ op: 'updatePerson', id: k, before: patch(cur), after: patch(want) });
  }
  if (!ops.length) return null;
  return change({ title: 'أبناء ' + names(g, m), subject: line, level: 'everyday', ops }, 'حُفظ');
}

/** Status and years. Divorce or widowhood is sensitive; correcting a year is everyday. */
export function editMarriage(id: string, after: MarriagePatch) {
  const g = getState().graph;
  const m = g.marriages.find(x => x.id === id);
  if (!m) return null;
  const before: MarriagePatch = {};
  for (const k of Object.keys(after) as (keyof MarriagePatch)[]) (before as Record<string, unknown>)[k] = m[k] ?? null;
  const status = after.status && after.status !== m.status ? after.status : null;
  const what = status === 'divorced' ? 'انفصال' : status === 'widowed' ? 'ترمّل' : 'تعديل زواج';
  return change({ title: `${what}: ${names(g, m)}`, subject: subjectOf(g, m), level: status ? 'sensitive' : 'everyday', ops: [{ op: 'updateMarriage', id, before, after }] }, 'حُفظ التعديل');
}

/** A spouse from outside who goes with this marriage (married to no one else in the tree). */
export function outsideOnlyIn(g: Graph, m: Marriage): string | null {
  return [m.husband, m.wife].find(x => g.nodes.get(x)?.external && marriagesOf(g, x).length === 1) ?? null;
}

/**
 * Removes a marriage recorded by mistake. A spouse from outside goes with it,
 * and their children stay in the tree, no longer linked to them.
 */
export function removeMarriage(id: string) {
  const g = getState().graph;
  const m = g.marriages.find(x => x.id === id);
  if (!m) return null;
  const out = outsideOnlyIn(g, m);
  const ops: Op[] = [];
  if (out) {
    const field = g.nodes.get(out)!.sex === 'f' ? 'mother' : 'father';
    for (const k of g.nodes.values()) if (k[field] === out) ops.push({ op: 'updatePerson', id: k.id, before: { [field]: out }, after: { [field]: null } });
  }
  ops.push({ op: 'removeMarriage', marriage: m });
  if (out) ops.push({ op: 'removePerson', person: recordOf(out) });
  return change({ title: `حذف زواج: ${names(g, m)}`, subject: subjectOf(g, m), level: 'sensitive', ops }, 'حُذف الزواج');
}

/** The years a marriage can hold, checked: an error, or null. */
export function yearsProblem(year: Year | null, end: Year | null): string | null {
  const a = gYear(year ?? undefined), b = gYear(end ?? undefined);
  return a != null && b != null && b < a ? 'سنة الانتهاء قبل سنة الزواج' : null;
}
