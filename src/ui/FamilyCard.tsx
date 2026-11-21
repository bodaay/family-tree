import { canSee, nameOf, type State } from '../data/store';
import { familiesOf, siblingsOf } from '../data/graph';
import { Avatar, kidsCount, yearShort } from './common';

/**
 * A person's close family, drawn over the blurred tree when someone is chosen:
 * the parents above, then the person, their brothers and sisters, and each
 * spouse with that spouse's children. Every name whole, every person a tap away,
 * so the tree can be walked one family at a time.
 */
export function FamilyCard({ s, id, onPick }: { s: State; id: string; onPick: (id: string) => void }) {
  const g = s.graph;
  const n = g.nodes.get(id)!;
  const f = n.sex === 'f';
  const parents = [n.father, n.mother].filter((x): x is string => !!x && g.nodes.has(x) && !g.nodes.get(x)!.familyRoot);
  const sibs = siblingsOf(g, id);
  const fams = familiesOf(g, id);
  const person = (x: string, cls = '', role = '') => {
    const p = g.nodes.get(x)!;
    const year = yearShort(s, x);
    return (
      <button class={'fp ' + cls + (p.external ? ' ext' : '')} onClick={() => x !== id && onPick(x)}>
        <Avatar id={x} s={s} size={cls === 'self' ? 40 : 30} />
        <span>
          <b>{nameOf(s, x)}</b>
          <small>{[role, year].filter(Boolean).join(' · ') || ' '}</small>
        </span>
      </button>
    );
  };
  // a marriage's status is a detail: told only to those who may see both spouses
  const role = (sp: string, m: ReturnType<typeof familiesOf>[number]['marriage']) => {
    const st = m && canSee(s, sp) && canSee(s, id) ? m.status : 'married';
    if (st === 'divorced') return 'انفصال';
    if (st === 'widowed') return 'ترمّل';
    return f ? 'زوجها' : 'زوجته';
  };
  return (
    <div class="fcard">
      {parents.length > 0 && (
        <>
          <div class="frow">{parents.map(x => person(x, '', g.nodes.get(x)!.sex === 'm' ? 'الأب' : 'الأم'))}</div>
          <i class="fstem" />
        </>
      )}
      <div class="frow">{person(id, 'self')}</div>
      {fams.map(fam => (
        <div class="fgroup">
          <div class="fhead">
            {fam.spouse ? person(fam.spouse, 'spouse', role(fam.spouse, fam.marriage)) : <small>{fams.length > 1 ? (f ? 'الأبناء (الأب غير مسجل)' : 'الأبناء (الأم غير مسجلة)') : 'الأبناء'}</small>}
            <small class="cnt">{fam.kids.length ? kidsCount(fam.kids.length) : 'لا أبناء مسجلون'}</small>
          </div>
          {fam.kids.length > 0 && <div class="fkids">{fam.kids.map(k => person(k))}</div>}
        </div>
      ))}
      {sibs.length > 0 && (
        <div class="fgroup">
          <div class="fhead">
            <small>{f ? 'إخوتها وأخواتها' : 'إخوته وأخواته'}</small>
            <small class="cnt">{sibs.length}</small>
          </div>
          <div class="fkids">{sibs.map(x => person(x))}</div>
        </div>
      )}
    </div>
  );
}
