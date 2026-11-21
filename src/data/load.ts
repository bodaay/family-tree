// Turns the plain family format (carried, encrypted, in the log's first entry)
// into the app's data model. No family data is ever built into the app itself.
import type { FamilyData, Person, Sex } from './types';
import type { RawFamily, RawPerson } from '../core/raw.ts';

export type { RawFamily, RawPerson } from '../core/raw.ts';

export function fromRaw(raw: RawFamily): FamilyData {
  const sexOf = new Map<string, Sex>([[raw.root.id, raw.root.sex], ...raw.people.map(p => [p.id, p.sex] as [string, Sex])]);
  const people: Person[] = [{ id: raw.root.id, name: raw.root.name, sex: raw.root.sex, familyRoot: true, deceased: true }];
  for (const p of raw.people) {
    const q: Person = { id: p.id, name: p.name, sex: p.sex };
    if (p.parent) {
      if (sexOf.get(p.parent) === 'f') q.mother = p.parent;
      else q.father = p.parent;
    }
    if (p.birth) q.birth = p.birth;
    if (p.death) q.death = p.death;
    if (p.deceased) q.deceased = true;
    if (p.uncertain) q.uncertain = true;
    if (p.mother) q.mother = p.mother;
    if (p.external) q.external = true;
    if (p.aliases?.length) q.aliases = p.aliases;
    if (p.suffix) q.suffix = p.suffix;
    people.push(q);
  }
  return { family: raw.family, root: raw.root.id, people, marriages: raw.marriages ?? [], ...(raw.milk?.length ? { milk: raw.milk } : {}) };
}

/** The other way: the family as the app holds it, in the plain format (family.json). */
export function toRaw(data: FamilyData): RawFamily {
  const root = data.people.find(p => p.id === data.root)!;
  const people: RawPerson[] = [];
  for (const p of data.people) {
    if (p.id === data.root) continue;
    const q: RawPerson = { id: p.id, name: p.name, sex: p.sex, parent: p.father ?? p.mother ?? null };
    if (p.birth) q.birth = p.birth;
    if (p.death) q.death = p.death;
    if (p.deceased) q.deceased = true;
    if (p.uncertain) q.uncertain = true;
    if (p.father && p.mother) q.mother = p.mother;
    if (p.external) q.external = true;
    if (p.aliases?.length) q.aliases = p.aliases;
    if (p.suffix) q.suffix = p.suffix;
    people.push(q);
  }
  const raw: RawFamily = { family: data.family, root: { id: root.id, name: root.name, sex: root.sex, familyRoot: true }, people };
  if (data.marriages.length) raw.marriages = data.marriages;
  if (data.milk?.length) raw.milk = data.milk;
  return raw;
}
