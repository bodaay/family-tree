// How names are written and compared. One Arabic name is spelled several ways
// (أحمد / احمد, فاطمة / فاطمه, عيسى / عيسي, عائشة / عايشة, عبد الله / عبدالله),
// and many people are better known by a kunya or a laqab. Search and the
// duplicate check both compare folded words of the name and of every alias.
import type { Alias, Person, Sex, Year } from './types';
import { gYear } from './dates';
import { nasab, type Graph } from './graph';

export const ALIAS_AR: Record<Alias['type'], string> = {
  kunya: 'كنية',
  laqab: 'لقب',
  known: 'اسم يُعرف به',
  previous: 'اسم سابق',
  spelling: 'كتابة أخرى',
};
export const ALIAS_TYPES = Object.keys(ALIAS_AR) as Alias['type'][];
const ALIAS_MAX = 40;

/** A person's aliases, skipping anything malformed. */
export function aliasesOf(p: Pick<Person, 'aliases'> | undefined): Alias[] {
  const list = p?.aliases;
  if (!Array.isArray(list)) return [];
  return list.filter(a => a && typeof a.text === 'string' && a.text.trim() !== '' && Object.hasOwn(ALIAS_AR, a.type));
}

/** Why an alias cannot be kept: free text never holds phone or ID numbers, emails or links. */
export function aliasProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return 'اكتب الاسم أولًا';
  if (t.length > ALIAS_MAX) return 'الاسم أطول من اللازم';
  const digits = t.replace(/[٠-٩۰-۹]/g, '0').replace(/\D/g, '');
  if (digits.length >= 5 || /@|https?:|www\./i.test(t)) return 'لا تُكتب هنا أرقام الهواتف أو الهويات ولا البريد أو الروابط';
  return null;
}

/** Folds the ways a name is written into one form. */
export function normName(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD') // a hamza or madda written as a separate mark is dropped with the tashkeel
    .replace(/[\p{M}ـ]/gu, '') // tashkeel and tatweel
    .replace(/[أإآٱٲٳٵ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[ئىی]/g, 'ي')
    .replace(/ء/g, '')
    .replace(/ة/g, 'ه')
    .replace(/ک/g, 'ك')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/(^|\s)عبد\s+/g, '$1عبد') // «عبد الله» is «عبدالله»
    .replace(/\s+/g, ' ')
    .trim();
}

const LINKS = new Set(['بن', 'بنت', 'ابن', 'ابنه']);

/** The words of a name or a name chain, without بن and بنت. */
export function nameWords(t: string): string[] {
  return normName(t).split(' ').filter(w => w && !LINKS.has(w));
}

/** A word without «ال», and «أبو» as «بو», so «الجوهرة» meets «جوهرة» and «بو فهد» meets «أبو فهد». */
function bare(w: string): string {
  if (w === 'ابو') return 'بو';
  return w.length > 3 && w.startsWith('ال') ? w.slice(2) : w;
}

/** One key per name, for "is this the same name?". */
export function nameKey(t: string): string {
  return nameWords(t).map(bare).join(' ');
}

/** Typed words against a name chain: each typed word starts the word in its place. */
export function matchWords(chain: string[], typed: string[]): boolean {
  return typed.every((p, i) => {
    const w = chain[i];
    return !!w && (w.startsWith(p) || bare(w).startsWith(bare(p)));
  });
}

/** The ways to find someone: the name, then each alias, each followed by the nasab. */
export function searchChains(g: Graph, id: string): { words: string[]; alias: Alias | null }[] {
  const n = g.nodes.get(id)!;
  const line = nameWords(nasab(g, id, 4, true));
  // «أحمد الثاني» as well as «أحمد» followed by the father's name
  const marked = n.suffix ? [{ words: [...nameWords(n.name), ...nameWords(n.suffix), ...line], alias: null }] : [];
  return [{ words: [...nameWords(n.name), ...line], alias: null }, ...marked, ...aliasesOf(n).map(a => ({ words: [...nameWords(a.text), ...line], alias: a }))];
}

/** Every name a person goes by, as keys. */
export function keysOf(p: Pick<Person, 'name' | 'aliases'>): Set<string> {
  return new Set([p.name, ...aliasesOf(p).map(a => a.text)].map(nameKey).filter(Boolean));
}

/**
 * People in the tree a full name typed for a spouse from outside may be: the
 * words are the name (or an alias) and the fathers' names, whole and in order,
 * and the family's name at the end may be left out. Two words at least (a name
 * and a father's), since a given name alone is shared by too many; a word still
 * being typed matches nothing yet.
 */
export function namedLike(g: Graph, typed: string, sex: Sex): string[] {
  let words = nameWords(typed).map(bare);
  // the family's name at the end: one word («السالم»), or «آل» and a name («آل مبارك», or «مبارك» alone)
  const fam = nameWords(g.family.name).map(bare).filter(w => w !== 'ال');
  if (words.length > 2 && words.at(-1) === nameKey(g.family.name)) words = words.slice(0, -1);
  else if (fam.length && words.length >= fam.length + 2 && fam.every((w, i) => words[words.length - fam.length + i] === w)) {
    words = words.slice(0, -fam.length);
    if (words.length > 2 && words.at(-1) === 'ال') words = words.slice(0, -1);
  }
  if (words.length < 2) return [];
  const same = (chain: string[]) => words.every((w, i) => chain[i] != null && bare(chain[i]) === w);
  return [...g.nodes.values()].filter(n => !n.familyRoot && !n.external && n.sex === sex && searchChains(g, n.id).some(c => same(c.words))).map(n => n.id);
}

/** Birth years this close count as "close" for the duplicate check. */
const NEAR = 5;

/**
 * People who may already be the one about to be added: the same name or alias
 * under the same parent, or anywhere with the same father's name and a birth
 * year within a few years; a son is never his sister. `parent` is someone in
 * the tree, or only a name (a father who is being added too).
 */
export function likelyDuplicates(g: Graph, name: string, parent: { id?: string; name?: string }, birth?: Year, sex?: Sex): string[] {
  const key = nameKey(name);
  if (!key) return [];
  const par = parent.id ? g.nodes.get(parent.id) : undefined;
  const same = (id: string) => (!sex || g.nodes.get(id)!.sex === sex) && keysOf(g.nodes.get(id)!).has(key);
  const out = par ? par.kids.filter(same) : [];
  const fathers = par ? keysOf(par) : new Set([nameKey(parent.name ?? '')].filter(Boolean));
  const y = gYear(birth);
  if (y == null || !fathers.size) return out;
  for (const n of g.nodes.values()) {
    if (n.familyRoot || !n.parent || n.parent === par?.id || n.by == null || Math.abs(n.by - y) > NEAR) continue;
    if (!same(n.id)) continue;
    if ([...keysOf(g.nodes.get(n.parent)!)].some(k => fathers.has(k))) out.push(n.id);
  }
  return out;
}
