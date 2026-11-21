// Two records of one person (entered twice while the tree is filled in) become
// one: the kept record takes the other's children, marriages and names, and
// the other record is removed. It is a single change, applied all or nothing,
// and undoing it brings both records back exactly as they were.
import type { Alias, Milk, Op, PersonPatch } from './types';
import { milkPeople, personRecord, type Graph } from './graph';
import { aliasesOf, keysOf, nameKey } from './names';
import type { State } from './store';

/** Why `drop` cannot be merged into `keep`, or null. */
export function mergeProblem(s: State, keep: string, drop: string): string | null {
  const g = s.graph;
  const a = g.nodes.get(keep);
  const b = g.nodes.get(drop);
  if (!a || !b) return 'ليس في الشجرة';
  if (keep === drop) return 'اختر سجلًا آخر';
  if (a.familyRoot || b.familyRoot) return 'لا يُدمج الجد الجامع';
  if (a.sex !== b.sex) return 'لا يُدمج ذكر مع أنثى';
  if (!!a.external !== !!b.external) return 'أحدهما من خارج العائلة والآخر منها';
  if (lineage(g, keep).has(drop) || lineage(g, drop).has(keep)) return 'أحدهما من أصول الآخر';
  if (a.father && b.father && a.father !== b.father) return 'لكل منهما أب مختلف في الشجرة. إن كان الأبوان شخصًا واحدًا فادمجهما أولًا.';
  if (a.mother && b.mother && a.mother !== b.mother) return 'لكل منهما أم مختلفة في الشجرة. إن كانت الأم نفسها فغيّرها لأحدهما من «تعديل البيانات» ثم ادمج.';
  // the record that goes must not be anyone's phone, invite, key or main branch
  const linked =
    g.branches.includes(drop) ||
    s.seats.some(x => x.holder === drop) ||
    [...s.devices.values()].includes(drop) ||
    s.invites.some(i => i.person === drop && i.status !== 'revoked') ||
    s.viewAll.has(drop);
  if (linked) return `${b.name} في هذا السجل مرتبط بهاتف أو دعوة أو مفتاح أو فرع رئيسي، فلا يُحذف. بدّل السجلين ليبقى هو.`;
  // nor anyone whose requests, approvals or refusals are in the record
  if (s.txs.some(t => t.by === drop || t.rejectedBy === drop || t.approvals.some(x => x.by === drop))) return `لـ${b.name} في هذا السجل طلبات أو اعتمادات محفوظة باسمه، فلا يُحذف. بدّل السجلين ليبقى هو.`;
  // any field of any change, including kinds added later, may name the record
  const named = JSON.stringify(drop);
  if (s.txs.some(t => t.status === 'pending' && (t.subject === drop || JSON.stringify(t.ops).includes(named)))) return 'عليه طلبات بانتظار الاعتماد. اعتمدها أو ارفضها أولًا.';
  // the merge rewrites the kept record's names; a waiting edit of it would undo that when approved
  if (s.txs.some(t => t.status === 'pending' && t.ops.some(o => o.op === 'updatePerson' && o.id === keep))) return 'على السجل الباقي طلب تعديل بانتظار الاعتماد. اعتمده أو ارفضه أولًا.';
  return null;
}

/** The ops of one merge: children and marriages move, the kept record takes what only the other had, the other goes. */
export function mergeOps(g: Graph, keep: string, drop: string): Op[] {
  const a = personRecord(g, keep);
  const b = personRecord(g, drop);
  const ops: Op[] = [];
  for (const n of g.nodes.values()) {
    if (n.father === drop) ops.push({ op: 'updatePerson', id: n.id, before: { father: drop }, after: { father: keep } });
    if (n.mother === drop) ops.push({ op: 'updatePerson', id: n.id, before: { mother: drop }, after: { mother: keep } });
  }
  // a marriage moves as removed and added again (a marriage change never changes
  // who married whom); the same spouse twice stays one marriage, the kept one's
  const spouses = new Set(g.marriages.flatMap(m => (m.husband === keep ? [m.wife] : m.wife === keep ? [m.husband] : [])));
  for (const m of g.marriages) {
    if (m.husband !== drop && m.wife !== drop) continue;
    const moved = m.husband === drop ? { ...m, husband: keep } : { ...m, wife: keep };
    const spouse = m.husband === drop ? m.wife : m.husband;
    ops.push({ op: 'removeMarriage', marriage: m });
    if (!spouses.has(spouse)) ops.push({ op: 'addMarriage', marriage: moved });
    spouses.add(spouse);
  }
  // milk records move the same way; one that would name the kept record twice, or repeat one it has, goes
  const same = (x: Milk, y: Milk) => x.child === y.child && x.nurse === y.nurse && (x.father ?? '') === (y.father ?? '');
  const kept = g.milk.filter(m => !milkPeople(m).includes(drop));
  for (const m of g.milk) {
    if (!milkPeople(m).includes(drop)) continue;
    ops.push({ op: 'removeMilk', milk: m });
    const sw = (x: string) => (x === drop ? keep : x);
    const moved: Milk = { ...m, child: sw(m.child), nurse: sw(m.nurse), ...(m.father ? { father: sw(m.father) } : {}) };
    if (new Set(milkPeople(moved)).size < milkPeople(moved).length || kept.some(k => same(k, moved))) continue;
    ops.push({ op: 'addMilk', milk: moved });
    kept.push(moved);
  }
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of ['birth', 'death', 'deceased', 'father', 'mother'] as const) {
    if (a[k] == null && b[k] != null) {
      before[k] = null;
      after[k] = b[k];
    }
  }
  // a parent taken from the other record comes with how sure that link is
  if ((after.father || after.mother) && b.uncertain && !a.uncertain) {
    before.uncertain = null;
    after.uncertain = true;
  }
  // names: the other record's name (when it differs) and its aliases, once each
  const names: Alias[] = [...aliasesOf(a)];
  const seen = keysOf(a);
  for (const x of [{ type: 'known' as const, text: b.name }, ...aliasesOf(b)]) {
    const k = nameKey(x.text);
    if (k && !seen.has(k)) {
      seen.add(k);
      names.push({ type: x.type, text: x.text });
    }
  }
  if (names.length > aliasesOf(a).length) {
    before.aliases = a.aliases ?? null;
    after.aliases = names;
  }
  if (Object.keys(after).length) ops.push({ op: 'updatePerson', id: keep, before: before as PersonPatch, after: after as PersonPatch });
  ops.push({ op: 'removePerson', person: b });
  return ops;
}

/** Everyone above a person, through fathers and mothers. */
function lineage(g: Graph, id: string): Set<string> {
  const out = new Set<string>();
  const todo = [id];
  while (todo.length) {
    const n = g.nodes.get(todo.pop()!);
    for (const p of [n?.father, n?.mother]) {
      if (p && !out.has(p)) {
        out.add(p);
        todo.push(p);
      }
    }
  }
  return out;
}
