// How far one woman's details are seen, wider than the family's rule (design
// document, Section 5, explicit grants): set by herself, or for a woman with no
// phone in the family by her close relatives or a gold of her branch; the root
// admin's phone then hands her key to whoever it now reaches.
import { set, viewer, widen, type State } from '../data/store';
import { REACHES, type Own } from '../data/types';
import { degreeWord } from '../data/kinship';
import { PersonRow, Seg } from './common';

export function WhoSees({ s, id }: { s: State; id: string }) {
  const cur: Own = s.own.get(id) ?? { reach: 'family', people: [] };
  const self = viewer(s) === id;
  // everyone sees every woman's details already: nothing to widen
  if (s.reach === null) return null;
  // short, to fit a phone: the family's rule, the wider degrees, everyone
  const options: [string, string][] = [
    ['family', 'كالعائلة'],
    ...REACHES.filter(d => d > s.reach!).map((d): [string, string] => [String(d), degreeWord(d)]),
    ['all', 'الكل'],
  ];
  const value = cur.reach === 'family' || cur.reach === 'all' ? cur.reach : String(cur.reach);
  const pick = (v: string) => {
    if (v === value) return;
    const reach: Own['reach'] = v === 'family' || v === 'all' ? v : Number(v);
    const who = self ? 'تفاصيلك' : 'تفاصيلها';
    const ask =
      reach === 'family'
        ? `تعود ${who} إلى حدود العائلة. من وصله مفتاحها يبقى معه. متابعة؟`
        : reach === 'all'
          ? `تظهر ${who} لكل العائلة. من يصله مفتاحها يبقى معه وإن عادت بعدُ إلى حدود العائلة. متابعة؟`
          : `تظهر ${who} لأقاربها حتى الدرجة ${degreeWord(reach)}. من يصله مفتاحها يبقى معه وإن ضُيّقت بعدُ. متابعة؟`;
    if (confirm(ask)) void widen(id, { ...cur, reach }, 'حُفظ');
  };
  const drop = (p: string) => void widen(id, { ...cur, people: cur.people.filter(x => x !== p) }, 'أُزيل من القائمة');
  return (
    <section>
      <h3>{self ? 'من يرى تفاصيلي' : 'من يرى تفاصيلها'}</h3>
      <p class="hint">
        {self ? 'اسمك وأسماؤك الأخرى وسنواتك' : 'اسمها وأسماؤها الأخرى وسنواتها'} تظهر في العائلة {self ? 'لأقاربك' : 'لأقاربها'} حتى الدرجة {degreeWord(s.reach)}.{' '}
        {self ? 'لك أن توسّعي ذلك، أو تسمّي من يراها.' : 'ولها أن توسّع ذلك، ويتولاه عنها ما دامت بلا هاتف في العائلة أقاربها المقربون أو ذهبي فرعها.'}
      </p>
      <div class="q small">إلى أي درجة قرابة</div>
      <Seg cls="reach" value={value} options={options} onChange={pick} />
      {cur.people.length > 0 && <div class="q small">ويراها أيضًا</div>}
      {cur.people.length > 0 && (
        <div class="card list">
          {cur.people.map(p => (
            <PersonRow s={s} id={p} onClick={() => drop(p)} right={<small class="mut">إزالة</small>} />
          ))}
        </div>
      )}
      <button class="btn wide" onClick={() => set({ searchOpen: 'grant', grantFor: id })}>
        + شخص بعينه يرى {self ? 'تفاصيلي' : 'تفاصيلها'}
      </button>
    </section>
  );
}
