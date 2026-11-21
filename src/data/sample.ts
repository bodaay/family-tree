// A fictional sample family, used when no private family file is present.
import type { RawFamily, RawPerson } from '../core/raw.ts';
import type { AdminAct } from './types';
import { buildGraph } from './graph';
import { fromRaw } from './load';
import { THIS_YEAR } from './dates';

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MEN = ['محمد', 'عبدالله', 'فهد', 'سعد', 'ناصر', 'خالد', 'سلطان', 'فيصل', 'تركي', 'بندر', 'سلمان', 'عبدالعزيز', 'إبراهيم', 'يوسف', 'عمر', 'حمد', 'راشد', 'ماجد', 'نايف', 'بدر', 'مشعل', 'سعود', 'منصور', 'عادل', 'طلال', 'نواف', 'زياد', 'عبدالرحمن', 'صالح', 'حمود'];
const WOMEN = ['نورة', 'سارة', 'منيرة', 'لطيفة', 'هيا', 'ريم', 'الجوهرة', 'مها', 'أمل', 'دانة', 'لولوة', 'شيخة', 'العنود', 'جود', 'لمى', 'ريما', 'غادة', 'هند', 'نوف', 'حصة', 'موضي'];

export function sampleFamily(): RawFamily {
  const rnd = rng(20261031);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const people: RawPerson[] = [];
  const add = (name: string, sex: 'm' | 'f', year: number, parent: string | null) => {
    const id = 's' + people.length;
    people.push({ id, name, sex, parent, birth: { v: year, cal: 'g' }, deceased: year < 1935 ? true : undefined });
    return id;
  };
  const kids = (parent: string, list: [string, number, ('m' | 'f')?][]) => list.map(([n, y, s]) => add(n, s ?? 'm', y, parent));
  const [saleh, , hamad, nasser] = kids('root', [['صالح', 1866], ['نورة', 1868, 'f'], ['حمد', 1870], ['ناصر', 1874]]);
  const done = new Set(['root', saleh]);
  const [fahd, , saad] = kids(saleh, [['فهد', 1897], ['هيا', 1899, 'f'], ['سعد', 1901]]);
  done.add(fahd);
  const [, , abdullah] = kids(fahd, [['سالم', 1925], ['لطيفة', 1934, 'f'], ['عبدالله', 1940]]);
  done.add(abdullah);
  const [, me] = kids(abdullah, [['خالد', 1972], ['محمد', 1978], ['نورة', 1980, 'f'], ['سلطان', 1983]]);
  done.add(me);
  kids(me, [['فهد', 2005], ['جود', 2008, 'f'], ['عبدالله', 2011]]);
  void saad; void hamad; void nasser;
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    if (p.sex !== 'm' || done.has(p.id)) continue;
    const by = p.birth!.v;
    if (by > 1997) continue;
    const n = by < 1915 ? pick([3, 4, 5, 6]) : by < 1965 ? pick([2, 3, 3, 4, 5]) : pick([0, 1, 2, 2, 3]);
    let y = by + 22 + Math.floor(rnd() * 8);
    for (let k = 0; k < n && y <= 2025; k++) {
      const sex = rnd() < 0.53 ? 'm' : 'f';
      add(pick(sex === 'm' ? MEN : WOMEN), sex, y, p.id);
      y += 1 + Math.floor(rnd() * 4);
    }
  }
  return {
    family: { name: 'آل سالم', source: 'عائلة تجريبية' },
    root: { id: 'root', name: 'سالم', sex: 'm' },
    people,
  };
}

/** The sample's key holders, as if its root admin had appointed the eldest men of each branch. */
export function sampleKeys(raw: RawFamily): AdminAct[] {
  const g = buildGraph(fromRaw(raw));
  const living = (id: string) => {
    const n = g.nodes.get(id)!;
    return n.sex === 'm' && !n.dead && !n.familyRoot && n.by != null && THIS_YEAR - n.by >= 25;
  };
  const byAge = (ids: string[]) => ids.filter(living).sort((a, b) => g.nodes.get(a)!.by! - g.nodes.get(b)!.by!);
  const [plat] = byAge([...g.nodes.keys()]);
  const acts: AdminAct[] = plat ? [{ kind: 'appoint', tier: 'platinum', branch: null, holder: plat }] : [];
  for (const b of g.branches) {
    const members = byAge([...g.nodes.values()].filter(n => n.branch === b && n.id !== plat).map(n => n.id));
    members.slice(0, 5).forEach((holder, i) => acts.push({ kind: 'appoint', tier: i < 2 ? 'gold' : 'silver', branch: b, holder }));
  }
  return acts;
}
