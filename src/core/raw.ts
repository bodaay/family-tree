// The plain family format: what the seed entry carries (always encrypted in the log).
import type { Alias, Marriage, Milk, Sex, Year } from '../data/types.ts';

export interface RawPerson {
  id: string;
  name: string;
  sex: Sex;
  parent: string | null;
  birth?: Year;
  death?: Year;
  deceased?: boolean;
  uncertain?: boolean;
  /** When both parents are known: `parent` is the father and this the mother. */
  mother?: string;
  /** A spouse from outside the family, recorded by name only. */
  external?: boolean;
  aliases?: Alias[];
  /** Shown after the name, to tell apart brothers or sisters of the same name. */
  suffix?: string;
}

export interface RawFamily {
  family: { name: string; source?: string };
  root: { id: string; name: string; sex: Sex; familyRoot?: boolean };
  people: RawPerson[];
  marriages?: Marriage[];
  /** Milk kinship records (version 1.36). */
  milk?: Milk[];
}
