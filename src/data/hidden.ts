// Hidden marriages (design document, Section 4): a marriage a man does not want
// known to the wider family for a while. What is hidden is the marriage, and a
// wife from outside the family with it; a wife from the family still shows as
// her father's daughter. It lives in private entries only three people's phones
// can open: the husband's, the wife's (if she has one in the family), and those
// of the one he asks to approve it: a gold of his main branch, the platinum
// holder, or the root admin. Never a silver, never himself. Everyone else sees
// that some private entry exists, not whose or what. Every phone works the tree
// out without it, so the family's checks run the same everywhere; the three
// see it on top. It comes out, for good, as an ordinary marriage in the tree:
// when its approver or the husband reveals it, when a child of it is added (one
// request for both), and when the husband dies.
import type { Marriage, Person, Seat } from './types';
import type { Graph } from './graph';
import { branchOf } from './governance';
import { isWoman } from './snapshot';
import { utf8ToBytes, verify } from '../core/crypto.ts';

/** What a private entry carries: a hidden marriage asked for, or its approver's answer. */
export type Private =
  | {
      kind: 'hide';
      /** The marriage's id, which it keeps when revealed. */
      id: string;
      marriage: Marriage;
      /** A wife from outside the family: her record (it goes into the tree only with the marriage). */
      wife?: Person;
      /** Women's keys its readers need: the wife's, to see her and, revealing it, to seal her details. */
      keys?: Record<string, string>;
      approver: string;
      by: string;
      at: number;
      title: string;
    }
  | { kind: 'decide'; id: string; ok: boolean; by: string; at: number };

/** One thing written, as it travels in each box: signed by the device that wrote it; `to` says which phones got this copy. */
export interface Wrapped {
  body: Private;
  from: string;
  sig: string;
  to: string[];
}

export const privateBytes = (body: Private) => utf8ToBytes(JSON.stringify(['ft-private:v1', body]));

/** Whether a wrapped thing is signed by the device it names. */
export function signedPrivate(w: Wrapped): boolean {
  return !!w && typeof w.from === 'string' && typeof w.sig === 'string' && !!w.body && verify(w.from, privateBytes(w.body), w.sig);
}

export interface Hidden {
  id: string;
  marriage: Marriage;
  wife?: Person;
  approver: string;
  by: string;
  at: number;
  title: string;
  status: 'pending' | 'approved' | 'rejected';
  /** Every phone this phone knows got it (public keys): for handing it to a phone added since. */
  to: Set<string>;
  /** What was written, to hand on as it is. */
  wrapped: Wrapped[];
}

/** The root admin's own place in the tree: the person their own phone is linked to. */
export function adminPerson(info: Iterable<{ person: string; via: string; at: number }>): string | null {
  let best: { person: string; at: number } | null = null;
  for (const d of info) if (d.via === 'self' && (!best || d.at >= best.at)) best = d;
  return best?.person ?? null;
}

/** Who may approve hiding a man's marriage: a gold of his main branch, the platinum holder, the root admin; never himself. */
export function approversFor(g: Graph, seats: Seat[], admin: string | null, husband: string): string[] {
  const b = branchOf(g, husband);
  const out = seats.filter(x => (x.tier === 'gold' && x.branch === b) || x.tier === 'platinum').map(x => x.holder);
  if (admin) out.push(admin);
  return [...new Set(out)].filter(x => x !== husband && g.nodes.has(x));
}

/** A private thing as the replay met it: what it says, and whether its writer could write it there and then. */
export interface Met {
  w: Wrapped;
  at: number;
  /** Signed by a device of the person it names, and allowed as the tree and the seats stood. */
  ok: boolean;
}

/** Whether a 'hide' can stand, as the tree and the seats stood when it was written. */
export function hideProblem(g: Graph, seats: Seat[], admin: string | null, b: Extract<Private, { kind: 'hide' }>): string | null {
  const m = b.marriage;
  const h = g.nodes.get(m.husband);
  if (!m || m.id !== b.id || b.by !== m.husband || !h || h.sex !== 'm' || h.external || h.familyRoot || h.dead) return 'الزوج';
  if (g.marriages.some(x => x.id === b.id)) return 'مسجل أصلًا';
  if (b.wife) {
    const w = b.wife;
    if (w.id !== m.wife || g.nodes.has(w.id) || w.sex !== 'f' || !w.external) return 'الزوجة';
  } else if (!isWoman(g.nodes.get(m.wife))) return 'الزوجة';
  if (!approversFor(g, seats, admin, m.husband).includes(b.approver)) return 'المعتمد';
  return null;
}

/**
 * The hidden marriages this phone can see, from the private things it opened,
 * in the log's order: asked for by the husband's own phone, answered once by
 * the approver he named (while still one who may), and gone from here for good
 * once the tree has had the marriage (`ever`: revealed, even if undone since).
 */
export function hiddenOf(met: Met[], g: Graph, ever: Set<string>): Hidden[] {
  const out = new Map<string, Hidden>();
  for (const { w, ok } of met) {
    const b = w.body;
    const h = out.get(b.id);
    // the same thing handed on again, to a phone added since: who else got it
    if (h?.wrapped.some(x => x.sig === w.sig)) {
      w.to.forEach(x => h.to.add(x));
      continue;
    }
    if (!ok) continue;
    if (b.kind === 'hide') {
      if (!h) out.set(b.id, { id: b.id, marriage: b.marriage, wife: b.wife, approver: b.approver, by: b.by, at: b.at, title: b.title, status: 'pending', to: new Set(w.to), wrapped: [w] });
      continue;
    }
    if (!h || h.status !== 'pending' || b.by !== h.approver) continue;
    h.status = b.ok ? 'approved' : 'rejected';
    h.wrapped.push(w);
    w.to.forEach(x => h.to.add(x));
  }
  // revealed: an ordinary marriage of the tree, never hidden again
  return [...out.values()].filter(h => !ever.has(h.id) && !g.marriages.some(m => m.id === h.id));
}
