// Milk kinship (الرضاعة, design document 1.36): "this child was nursed by this
// woman", with her husband at the time as the milk father when known, and
// whether the family is sure of it. A sensitive change (a gold key of the
// child's branch approves it); the root admin records it directly. The app
// shows the relations it makes; it does not rule on them: a marriage that a
// milk relation would bar is sent with a warning, and those who approve it decide.
import type { Milk, Op, Person } from './types';
import { marriagesOf, milkOf, milkPeople, newId, type Graph } from './graph';
import { milkProblem, type Route } from './kinship';
import { change, getState, toast } from './store';

/** Why this record cannot be made (null: it can). `nurse` is someone in the tree, or null for a woman from outside. */
export function milkRecordProblem(g: Graph, child: string, nurse: string | null, father: string | null): string | null {
  const c = g.nodes.get(child);
  if (!c || c.external) return 'اختر شخصًا من الشجرة';
  if (nurse) {
    const w = g.nodes.get(nurse);
    if (!w || w.sex !== 'f' || w.familyRoot) return 'المرضعة امرأة';
    if (nurse === child) return 'اختر امرأة أخرى';
    if (c.mother === nurse) return 'هي أمه';
    if (milkOf(g, child).some(m => m.nurse === nurse)) return 'الرضاعة منها مسجلة أصلًا';
  }
  if (father && (!nurse || !marriagesOf(g, nurse).some(m => m.husband === father))) return 'الأب من الرضاعة زوجها';
  return null;
}

/**
 * Current marriages that a new milk record would put under a warning (a man and
 * his milk sister, …): checked on the tree as it would be, for the request's title.
 */
export function marriagesBarredBy(g: Graph, rec: Milk): { husband: string; wife: string; route: Route }[] {
  const g2: Graph = { ...g, milk: [...g.milk, rec] };
  const near = new Set(milkPeople(rec));
  return g.marriages
    .filter(m => m.status === 'married')
    .flatMap(m => {
      // only marriages this record could touch: someone it names, or their family by birth
      if (![m.husband, m.wife].some(x => near.has(x) || near.has(g.nodes.get(x)?.father ?? '') || near.has(g.nodes.get(x)?.mother ?? '') || descendsFrom(g, x, rec.child))) return [];
      const route = milkProblem(g2, m.husband, m.wife);
      return route ? [{ husband: m.husband, wife: m.wife, route }] : [];
    });
}

function descendsFrom(g: Graph, id: string, top: string): boolean {
  for (let n = g.nodes.get(id), i = 0; n && i < 40; i++) {
    if (n.id === top) return true;
    n = n.parent ? g.nodes.get(n.parent) : undefined;
  }
  return false;
}

/** Whether any milk record along a route is one the family is not sure of. */
export function routeUncertain(g: Graph, r: Route): boolean {
  return (r.milk ?? []).some(([c, p]) => g.milk.some(m => m.child === c && (m.nurse === p || m.father === p) && m.uncertain));
}

/** The warning a marriage between these two carries, if a milk relation would bar it (null: none). */
export function marriageMilkWarning(g: Graph, husband: string, wife: string): string | null {
  const r = milkProblem(g, husband, wife);
  if (!r) return null;
  return `تنبيه: هي ${r.term}${routeUncertain(g, r) ? ' (رضاعة غير مؤكدة)' : ''}`;
}

/**
 * Records that `child` was nursed by `nurse` (someone in the tree, or a woman
 * from outside by name), with her husband at the time as milk father if known.
 */
export function addMilk(child: string, nurse: string | { name: string }, father: string | null, uncertain: boolean) {
  const g = getState().graph;
  const c = g.nodes.get(child)!;
  const why = milkRecordProblem(g, child, typeof nurse === 'string' ? nurse : null, father);
  if (why) {
    toast(why);
    return null;
  }
  const ops: Op[] = [];
  let id: string, name: string;
  if (typeof nurse === 'string') {
    id = nurse;
    name = g.nodes.get(nurse)!.name;
  } else {
    name = nurse.name.trim();
    if (!name) {
      toast('اكتب اسمها');
      return null;
    }
    const person: Person = { id: newId('n'), name, sex: 'f', external: true };
    ops.push({ op: 'addPerson', person });
    id = person.id;
  }
  const rec: Milk = { id: newId('k'), child, nurse: id, ...(father ? { father } : {}), ...(uncertain ? { uncertain: true } : {}) };
  ops.push({ op: 'addMilk', milk: rec });
  const barred = marriagesBarredBy(g, rec);
  // the husband named (a man's name shows to everyone), never the wife: she is not in this change, so its title would not hide her
  const warn = barred.length ? ` — تنبيه: زواج قائم بين قريبين من الرضاعة: ${barred.map(b => `زواج ${g.nodes.get(b.husband)!.name} (هي ${b.route.term})`).join('، ')}` : '';
  const title = `رضاعة: ${c.name} من ${name}${uncertain ? ' (غير مؤكدة)' : ''}${warn}`;
  return change({ title, subject: child, level: 'sensitive', ops }, 'سُجّلت الرضاعة');
}

/** Removes a milk record (and a nurse from outside whom nothing else names). */
export function removeMilk(id: string) {
  const g = getState().graph;
  const rec = g.milk.find(m => m.id === id);
  if (!rec) return null;
  const ops: Op[] = [{ op: 'removeMilk', milk: rec }];
  const w = g.nodes.get(rec.nurse);
  if (w?.external && !marriagesOf(g, rec.nurse).length && g.milk.every(m => m.id === id || !milkPeople(m).includes(rec.nurse))) {
    const { parent, kids, gen, branch, house, desc, by, dead, ...person } = w;
    void parent; void kids; void gen; void branch; void house; void desc; void by; void dead;
    ops.push({ op: 'removePerson', person });
  }
  const title = `حذف رضاعة: ${g.nodes.get(rec.child)!.name} من ${w?.name ?? ''}`;
  return change({ title, subject: rec.child, level: 'sensitive', ops }, 'حُذفت الرضاعة');
}

/** Changes whether the family is sure of a record (one change: removed and added again as it is now). */
export function setMilkCertain(id: string, uncertain: boolean) {
  const g = getState().graph;
  const rec = g.milk.find(m => m.id === id);
  if (!rec || !!rec.uncertain === uncertain) return null;
  const { uncertain: was, ...rest } = rec;
  void was;
  const now: Milk = { ...rest, ...(uncertain ? { uncertain: true } : {}) };
  const title = `رضاعة: ${g.nodes.get(rec.child)!.name} من ${g.nodes.get(rec.nurse)?.name ?? ''} ${uncertain ? 'غير مؤكدة' : 'مؤكدة'}`;
  return change({ title, subject: rec.child, level: 'sensitive', ops: [{ op: 'removeMilk', milk: rec }, { op: 'addMilk', milk: now }] }, 'حُفظ');
}
