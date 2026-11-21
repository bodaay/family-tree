// The history follows the same privacy rule as the tree: a change's title
// names the people it touches, so the names of women this viewer may not see
// are left out of it.
import type { Marriage, Person, Tx } from './types';
import { canApprove } from './governance';
import { milkPeople } from './graph';
import { canSee, nameOf, sealedName, viewer, type State } from './store';

/** People and marriages as the log recorded them: they may have been removed since. */
const recorded = new WeakMap<Tx[], { people: Map<string, Person>; marriages: Map<string, Marriage> }>();
function inLog(txs: Tx[]) {
  let r = recorded.get(txs);
  if (!r) {
    r = { people: new Map(), marriages: new Map() };
    for (const t of txs) {
      for (const op of t.ops) {
        if (op.op === 'addPerson' || op.op === 'removePerson') r.people.set(op.person.id, op.person);
        else if (op.op === 'addMarriage' || op.op === 'removeMarriage') r.marriages.set(op.marriage.id, op.marriage);
      }
    }
    recorded.set(txs, r);
  }
  return r;
}

/**
 * A woman's mark in a title (after the move to per-person keys): her name where
 * this phone may show it. Someone not in the tree (a daughter a request would
 * add, or someone removed since) is named from her own sealed record, only
 * where `others` allows it and this phone holds her key.
 */
function marks(s: State, t: string, tx: Tx, others: boolean): string {
  return t.replace(/⟦([^⟧]+)⟧/g, (_, id: string) => {
    if (s.graph.nodes.has(id)) return nameOf(s, id);
    const rec = tx.ops.flatMap(o => (o.op === 'addPerson' || o.op === 'removePerson') && o.person.id === id ? [o.person] : [])[0] ?? inLog(s.txs).people.get(id);
    return (others && sealedName(rec)) || 'امرأة';
  });
}

/** A change's title as this viewer may read it. */
export function titleOf(s: State, tx: Tx): string {
  // who asked, and the key holders handling the request, see whom it is about
  const v = viewer(s);
  if (v === tx.by || (tx.status === 'pending' && canApprove(s.graph, s.seats, v, tx).ok)) return marks(s, tx.title, tx, true);
  const log = inLog(s.txs);
  const hidden = new Map<string, string>();
  const check = (id: string, also: (string | null | undefined)[] = []) => {
    const n = s.graph.nodes.get(id);
    const p = n ?? log.people.get(id) ?? s.base.people.find(x => x.id === id);
    if (!p) return;
    // someone no longer in the tree: a woman's name stays hidden unless this viewer sees everyone
    const shown = n ? canSee(s, id) : p.sex !== 'f' || s.seesAll || s.reach === null || (s.isSample && !s.settings.privacy);
    if (!shown) for (const name of [p.name, ...also]) if (name) hidden.set(name, n ? nameOf(s, id) : 'امرأة');
  };
  // the one it is about: a daughter's child's title names his mother
  check(tx.subject);
  for (const op of tx.ops) {
    if (op.op === 'addPerson' || op.op === 'removePerson') check(op.person.id, [op.person.name]);
    else if (op.op === 'updatePerson') {
      check(op.id, [op.before.name, op.after.name]);
      // a move names the new parent: under a daughter of the family
      for (const x of [op.before.mother, op.after.mother, op.before.father, op.after.father]) if (x) check(x);
    } else if (op.op === 'addMilk' || op.op === 'removeMilk') {
      for (const id of milkPeople(op.milk)) check(id);
    } else {
      const m = op.op === 'updateMarriage' ? (s.graph.marriages.find(x => x.id === op.id) ?? log.marriages.get(op.id)) : op.marriage;
      if (m) for (const id of [m.husband, m.wife]) check(id);
    }
  }
  let t = tx.title;
  // longest first, so a full name goes before a first name inside it
  for (const [name, as] of [...hidden].sort((a, b) => b[0].length - a[0].length)) t = t.split(name).join(as);
  return marks(s, t, tx, s.seesAll || s.reach === null);
}

/** Not years recorded in the clear going into the wife's seal (the root admin's phone does it once): nothing to undo there. */
export function undoable(tx: Tx): boolean {
  const sealing = (op: Tx['ops'][number]) =>
    op.op === 'updateMarriage' && (op.before.year != null || op.before.end != null) && Object.keys(op.after).every(k => k === 'sealed' || ((k === 'year' || k === 'end') && op.after[k] == null));
  return !tx.ops.length || !tx.ops.every(sealing);
}
