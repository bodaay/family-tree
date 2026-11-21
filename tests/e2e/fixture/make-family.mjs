// The made-up family the tests run on: 800 people, every name, year and marriage
// invented. Written to tests/e2e/fixture/family.json, which is committed so the
// tests never move under each other; run this again only to change the family
// on purpose (then fix the scripts that look for its people):
//
//   node tests/e2e/fixture/make-family.mjs
//
// Most of it is drawn at random from a fixed seed. Some people are placed by
// hand because scripts look for them by name and year, or need a shape (twelve
// sons, a cousin marriage, a baby whose birth year is uncertain): the CAST below
// says who they are and which scripts use them.
import fs from 'node:fs';

// (منصور is left out: the root admin's place in the tree is «منصور» (1963), the only one)
export const MEN = [
  'محمد', 'عبدالله', 'سعد', 'ناصر', 'خالد', 'سلطان', 'فيصل', 'تركي', 'بندر', 'سلمان', 'عبدالعزيز', 'إبراهيم', 'يوسف',
  'عمر', 'حمد', 'راشد', 'ماجد', 'نايف', 'بدر', 'مشعل', 'سعود', 'عبدالرحمن', 'صالح', 'حمود', 'مبارك', 'سالم',
  'عثمان', 'زيد', 'عيسى', 'موسى', 'طلال', 'وليد', 'هشام', 'سامي', 'مشاري', 'عبدالمحسن', 'عبدالكريم', 'عبدالمجيد',
  'فواز', 'نواف', 'متعب', 'غازي', 'ثامر', 'رائد', 'زياد', 'مازن', 'معاذ', 'يزيد', 'ياسر', 'عادل', 'جاسم', 'حسن',
  'علي', 'عامر', 'مساعد', 'منيف', 'شاكر', 'ضاري', 'صقر',
];
export const WOMEN = [
  'نورة', 'سارة', 'منيرة', 'لطيفة', 'هيا', 'ريم', 'الجوهرة', 'مها', 'أمل', 'دانة', 'لولوة', 'شيخة', 'العنود', 'جود',
  'لمى', 'ريما', 'غادة', 'هند', 'نوف', 'حصة', 'موضي', 'فاطمة', 'مريم', 'عائشة', 'خديجة', 'هيلة', 'البندري', 'الهنوف',
  'نوال', 'هدى', 'وفاء', 'أسماء', 'بشاير', 'شهد', 'رهف', 'غلا', 'جواهر', 'مشاعل', 'سلمى', 'ليلى', 'منى', 'عبير',
];
// outside spouses (a name and the family they come from)
const OUT_MEN = ['سعد بن فالح العتيبي', 'محمد بن ناصر القحطاني', 'فهد بن سالم الدوسري', 'خالد بن علي الشمري', 'عبدالله بن حمد المطيري', 'ناصر بن سعيد الزهراني', 'سلطان بن مبارك الحربي'];
const OUT_WOMEN = ['نورة بنت سعد العتيبي', 'سارة بنت ماجد القحطاني', 'هيا بنت ناصر الدوسري', 'مها بنت فهد الشمري', 'منيرة بنت سلطان المطيري', 'ريم بنت خالد الزهراني', 'لطيفة بنت حمد الحربي', 'العنود بنت سالم السبيعي', 'حصة بنت علي الغامدي'];

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeFamily() {
  const rnd = rng(20261121);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = a => a[Math.floor(rnd() * a.length)];
  const people = [];
  const byId = new Map();
  let next = 1;
  const add = (name, sex, birth, parent, o = {}) => {
    const id = o.id ?? 'p' + next++;
    const p = { id, name, sex, parent };
    if (birth != null) p.birth = { v: birth, cal: 'g' };
    if (o.dead || (birth != null ? birth < 1940 : true)) p.deceased = true;
    if (o.death) p.death = { v: o.death, cal: 'g' };
    for (const k of ['mother', 'external', 'suffix', 'uncertain', 'aliases']) if (o[k] != null) p[k] = o[k];
    if (o.living) delete p.deceased;
    people.push(p);
    byId.set(id, p);
    return id;
  };
  const kidsOf = id => people.filter(p => p.parent === id);
  // a child's name, not one a living brother or sister already has
  // (and never the name and year of someone placed by hand, whom the scripts look up by both)
  const fresh = (parent, sex, year) => {
    const taken = new Set(kidsOf(parent).map(k => k.name));
    let n;
    // محمد first, as in any family here (the invite scripts need several living ones)
    do n = sex === 'm' && rnd() < 0.16 ? 'محمد' : pick(sex === 'm' ? MEN : WOMEN);
    while ((taken.has(n) && taken.size < 30) || cast.has(n + '|' + year));
    return n;
  };
  const cast = new Set();
  // kids(parent, [[name|null, sex, year, opts?], …]): children placed by hand
  const named = new Set(); // placed by hand under a name: the random part leaves their children alone
  const kids = (parent, list) => list.map(([name, sex, year, o]) => {
    const id = add(name ?? fresh(parent, sex, year), sex, year, parent, o);
    if (name) named.add(id), cast.add(name + '|' + year);
    return id;
  });
  const below = id => kidsOf(id).flatMap(k => [k.id, ...below(k.id)]);
  // grow(id, n): about n more people below id, at random, generation by generation
  const grow = (top, n) => {
    let left = n;
    // the men with no children yet: the top itself, and those placed without a name
    let wave = [top, ...below(top)].filter(id => byId.get(id).sex === 'm' && !kidsOf(id).length && (id === top || !named.has(id)));
    while (left > 0 && wave.length) {
      const nextWave = [];
      for (const id of wave) {
        const f = byId.get(id);
        if (f.sex !== 'm' || left <= 0) continue;
        const by = f.birth?.v ?? 1880;
        if (by > 1998) continue;
        const want = by < 1930 ? int(3, 7) : by < 1970 ? int(3, 8) : by < 1990 ? int(1, 4) : int(0, 2);
        let y = by + int(22, 30);
        for (let k = 0; k < want && y <= 2025 && left > 0; k++) {
          const sex = rnd() < 0.52 ? 'm' : 'f';
          nextWave.push(add(fresh(id, sex, y), sex, y, id));
          left--;
          y += int(1, 4);
        }
      }
      wave = nextWave;
    }
    return n - left;
  };

  // ---- the founder and the four branches
  const root = { id: 'root', name: 'مبارك', sex: 'm', familyRoot: true };
  byId.set('root', root);
  const main = add('صالح', 'm', null, 'root', { id: 'b_saleh' });
  // counts: twelve sons, no daughters, three brothers
  const second = add('سلطان', 'm', null, 'root', { id: 'b_sultan' });
  add('حمد', 'm', null, 'root', { id: 'b_hamad' });
  add('ناصر', 'm', null, 'root', { id: 'b_nasser' });

  // ---- the main branch, with the people the scripts look for
  const [ar] = kids(main, [['عبدالرحمن', 'm', null]]); // alias-review-privacy: «عبدالرحمن صالح», the third generation
  const [ibr, rashed, saad] = kids(ar, [['إبراهيم', 'm', null], ['راشد', 'm', null], ['سعد', 'm', null], ['نورة', 'f', null], ['هيا', 'f', null]]);
  // under إبراهيم
  const [, nasser, faisal, , , zaid, yousef] = kids(ibr, [
    [null, 'f', 1897], ['ناصر', 'm', 1909], ['فيصل', 'm', 1915], [null, 'f', 1911], [null, 'm', 1918], ['زيد', 'm', 1932], ['يوسف', 'm', 1934, { living: true }], [null, 'f', 1936, { living: true }],
    [null, 'm', 1920], [null, 'm', 1923], [null, 'm', 1925], [null, 'f', 1928], [null, 'm', 1930],
  ]);
  const [aziz] = kids(nasser, [['عبدالعزيز', 'm', 1938, { living: true }], [null, 'm', 1946], [null, 'f', 1944], [null, 'm', 1951]]);
  // the root admin's man in perm and lock scripts: 7 sons and 5 daughters
  const [mansour] = kids(aziz, [['منصور', 'm', 1963], [null, 'm', 1961], [null, 'm', 1960], [null, 'f', 1959], [null, 'f', 1965], [null, 'm', 1979]]);
  // the member most scripts sign in as (2 sons), and his brother بندر (the ladder's p1 is بندر's daughter)
  const [meshari, , bandar] = kids(mansour, [
    ['مشاري', 'm', 1985], ['فواز', 'm', 1987], ['بندر', 'm', 1988], ['نواف', 'm', 1995], ['متعب', 'm', 1997], ['غازي', 'm', 2000], ['ثامر', 'm', 2006],
    ['الجوهرة', 'f', 1989], ['نوال', 'f', 1991], ['دانة', 'f', 1992], ['ريما', 'f', 2002], ['غلا', 'f', 2003],
  ]);
  kids(meshari, [['رائد', 'm', 2017], ['زياد', 'm', 2020]]);
  kids(bandar, [['جود', 'f', 2022], ['يزيد', 'm', 2018], ['لمى', 'f', 2016]]);
  // the man the marriage scripts use («مازن فيصل», 1960: a son and four daughters), and ماجد (1953)
  const [khaled, majed] = kids(faisal, [['مازن', 'm', 1960], ['ماجد', 'm', 1953], ['حصة', 'f', 1958], [null, 'm', 1964], [null, 'f', 1950]]);
  kids(khaled, [['مها', 'f', 1988], ['منيرة', 'f', 1989], ['شهد', 'f', 1998], ['رهف', 'f', 2003], ['معاذ', 'm', 1993]]);
  const [, , yasser] = kids(majed, [['هند', 'f', 1977], ['رائد', 'm', 1983], ['ياسر', 'm', 1985], ['عامر', 'm', 1986], ['شاكر', 'm', 1991]]);
  kids(yasser, [['العنود', 'f', 2017]]); // his brother's granddaughter, whom the spouse search leaves out
  // names stored in another spelling, for the search: «موسى بن إسماعيل» finds «موسي بن اسماعيل»
  const [ismail, compound] = kids(ibr, [['اسماعيل', 'm', 1926], ['محمد سعيد', 'm', 1927]]); // a compound given name, with sons (namesake)
  kids(compound, [['سالم', 'm', 1956], ['حمد', 'm', 1959]]);
  kids(ismail, [['موسي', 'm', 1955], ['يحيى', 'm', 1958], ['فاطمه', 'f', 1960], ['موضي', 'f', 1962]]);
  // هيلة (1967), a daughter of another house
  kids(zaid, [['هيلة', 'f', 1967], [null, 'm', 1959], [null, 'f', 1955], [null, 'm', 1974]]);
  // وليد (1956: two daughters) and هشام (1958: three sons and a daughter)
  const [walid, hisham] = kids(yousef, [['وليد', 'm', 1956], ['هشام', 'm', 1958], [null, 'f', 1963], [null, 'm', 1978]]);
  kids(walid, [['البندري', 'f', 1989], ['الهنوف', 'f', 1996]]);
  kids(hisham, [['مساعد', 'm', 1985], ['عبير', 'f', 1989], ['منيف', 'm', 1996], ['ضاري', 'm', 2002]]);
  // under راشد: a line with a cousin marriage, outside wives and the youngest
  const [abdulmajeed, , abdulkarim] = kids(rashed, [['عبدالمجيد', 'm', 1890], [null, 'f', 1907], ['عبدالكريم', 'm', null], [null, 'm', 1895], [null, 'f', null], [null, 'm', 1898], [null, 'm', 1902]]);
  const [turki] = kids(abdulmajeed, [['تركي', 'm', 1928], [null, 'm', 1925], [null, 'f', null]]);
  const [hamoud, , , , turkiD1, turkiD2] = kids(turki, [
    ['حمود', 'm', 1958], [null, 'm', 1955], [null, 'm', 1967], [null, 'm', 1965], ['نوال', 'f', 1971], ['وفاء', 'f', 1973], [null, 'm', 1969],
  ]);
  // حمود's children are his wife's (she is of the family): the eldest has the baby whose link
  // to him is not confirmed (int-old-edit), another an outside wife and a baby of hers
  const [hamoudSon, , , , outSon] = kids(hamoud, [['سعود', 'm', 1986], ['نايف', 'm', 1987], ['عيسى', 'm', 1989], ['موسى', 'm', 1992, { dead: true, death: 2015 }], ['يوسف', 'm', 1995], ['لطيفة', 'f', 1998], ['هيا', 'f', 2004]]);
  kids(hamoudSon, [['يزيد', 'm', 2024, { uncertain: true }], ['سعد', 'm', 2025]]);
  const [outBaby] = kids(outSon, [['علي', 'm', 2024]]);
  const [samiF] = kids(abdulkarim, [['عثمان', 'm', 1933], [null, 'm', 1943], [null, 'm', 1945], [null, 'f', null]]);
  // سامي (1955: a son and five daughters)
  const [sami] = kids(samiF, [['سامي', 'm', 1955], [null, 'm', 1962], [null, 'f', 1964], [null, 'm', 1966], [null, 'f', 1968]]);
  const [samiSon] = kids(sami, [['عمر', 'm', 1995], ['مريم', 'f', 1981], ['خديجة', 'f', 1983], ['عائشة', 'f', 1986, { dead: true, death: 2010 }], ['أسماء', 'f', 1987], ['سلمى', 'f', 1990]]);
  const [youngest] = kids(samiSon, [['سلمان', 'm', 2023]]); // ladder: the far one
  // under سعد: عبدالمحسن (1945) and طلال (1954, married to his cousin حصة)
  const [abdullah] = kids(saad, [['عبدالله', 'm', 1907], [null, 'm', 1904], [null, 'm', 1912]]);
  const [abdulmohsen, talal] = kids(abdullah, [['عبدالمحسن', 'm', 1945], ['طلال', 'm', 1954], [null, 'm', 1950], [null, 'm', 1955], [null, 'f', null]]);
  kids(abdulmohsen, [['نوف', 'f', 1973], [null, 'm', 1970], [null, 'm', 1978], [null, 'm', 1984], [null, 'f', 1977]]); // «نوف عبدالمحسن», the daughter in the marriage scripts
  kids(talal, [[null, 'm', 1980], [null, 'm', 1984], [null, 'f', 1977], [null, 'f', 1982], [null, 'f', 1987]]);

  // ---- the second branch: twelve sons, one of whom has a line of his own
  const sons = kids(second, [
    ['محمد', 'm', 1850], ['عبدالله', 'm', 1850], ['فهد', 'm', 1851], ['سعد', 'm', 1850], ['ناصر', 'm', 1861], ['خالد', 'm', 1854],
    ['سليمان', 'm', 1854], ['عيسى', 'm', 1853], ['موسى', 'm', 1855], ['حمد', 'm', 1853], ['زيد', 'm', 1853], ['يوسف', 'm', 1854],
  ]);

  // a line down to the living in it (scripts need living men in a branch other than the main one)
  const [l1] = kids(sons[4], [[null, 'm', 1888]]);
  const [l2] = kids(l1, [[null, 'm', 1916], [null, 'm', 1921]]);
  const [l3, l3b] = kids(l2, [[null, 'm', 1944], [null, 'm', 1949], [null, 'f', 1952]]);
  kids(l3, [[null, 'm', 1970], [null, 'm', 1974], [null, 'f', 1977]]);
  kids(l3b, [[null, 'm', 1976], [null, 'm', 1981]]);

  // ---- everyone else, at random
  const target = 784; // and 16 from outside: 800
  const spread = [
    [sons[4], 64], [nasser, 70], [aziz, 30], [ibr, 120], [yousef, 6], [abdulmajeed, 40], [turki, 30],
    [abdulkarim, 60], [samiF, 20], [abdullah, 50], [faisal, 10], [rashed, 40], [zaid, 10], [sons[0], 12], [sons[3], 10],
  ];
  for (const [id, n] of spread) grow(id, n);
  // then give children to men who have none yet (not those placed by hand), until the family has its size
  const mainLine = new Set(below(main));
  while (people.length < target) {
    const free = people.filter(p => p.sex === 'm' && mainLine.has(p.id) && !named.has(p.id) && p.birth && p.birth.v <= 1990 && kidsOf(p.id).length < 4);
    if (!free.length) break;
    const f = pick(free);
    const last = Math.max(0, ...kidsOf(f.id).map(k => k.birth?.v ?? 0));
    let y = last ? last + int(1, 3) : f.birth.v + int(22, 30);
    for (let k = int(1, 4); k > 0 && y <= 2025 && people.length < target; k--, y += int(1, 4)) {
      const sex = rnd() < 0.52 ? 'm' : 'f';
      mainLine.add(add(fresh(f.id, sex, y), sex, y, f.id));
    }
  }
  people.length = Math.min(people.length, target);

  // ---- marriages, with the outside spouses
  const marriages = [];
  const married = new Set();
  const out = (name, sex, birth) => add(name, sex, birth, null, { external: true, living: true });
  const marry = (husband, wife, status = 'married', year) => {
    marriages.push({ id: 'm' + (marriages.length + 1), husband, wife, status, ...(year ? { year: { v: year, cal: 'g' } } : {}) });
    married.add(husband).add(wife);
  };
  // a mother for some of a man's children: those born while she was 18 to 45
  const mothers = (husband, wife, all) => {
    const wb = byId.get(wife).birth?.v ?? byId.get(husband).birth?.v ?? 1950;
    const list = kidsOf(husband).filter(k => k.birth && k.birth.v - wb >= 18 && k.birth.v - wb <= 45);
    for (const k of all ? list : list.slice(0, Math.ceil(list.length / 2))) k.mother = wife;
  };
  const living = p => !p.deceased && !p.external;
  const age = p => (p.birth ? 2026 - p.birth.v : 0);
  // by hand: the cousins طلال and حصة, and حمود's wife from the family
  marry(talal, people.find(p => p.parent === faisal && p.name === 'حصة').id);
  const hamoudWife = people.find(p => p.sex === 'f' && living(p) && p.birth && p.birth.v >= 1960 && p.birth.v <= 1966 && !married.has(p.id) && byId.get(p.parent)?.parent !== turki && p.parent !== turki);
  marry(hamoud, hamoudWife.id);
  mothers(hamoud, hamoudWife.id, true);
  // outside wives
  marry(turki, out(OUT_WOMEN[0], 'f', 1932));
  const tSons = kidsOf(turki).filter(k => k.sex === 'm' && k.id !== hamoud);
  const youngDad = byId.get(outSon);
  const pool = people.filter(p => p.sex === 'm' && living(p) && age(p) >= 28 && age(p) <= 70 && !married.has(p.id) && kidsOf(p.id).length);
  const extHusbands = [tSons[0].id, tSons[1].id, ...(youngDad ? [youngDad.id] : [])];
  while (extHusbands.length < 8) {
    const m = pick(pool);
    if (!extHusbands.includes(m.id)) extHusbands.push(m.id);
  }
  extHusbands.forEach((h, i) => {
    const w = out(OUT_WOMEN[i % OUT_WOMEN.length], 'f', byId.get(h).birth.v + int(1, 6));
    marry(h, w, i === 5 ? 'widowed' : 'married', [3, 4, 6].includes(i) ? byId.get(h).birth.v + int(24, 30) : undefined);
    if (i >= 2) mothers(h, w, i % 2 === 0);
  });
  byId.get(outBaby).mother = marriages.find(m => m.husband === outSon).wife;
  // outside husbands, of daughters of the family
  const extWives = [turkiD1, turkiD2];
  const wpool = people.filter(p => p.sex === 'f' && living(p) && age(p) >= 22 && age(p) <= 65 && !married.has(p.id));
  while (extWives.length < 7) {
    const w = pick(wpool);
    if (!extWives.includes(w.id)) extWives.push(w.id);
  }
  extWives.forEach((w, i) => {
    const h = out(OUT_MEN[i], 'm', byId.get(w).birth.v - int(1, 6));
    marry(h, w, i === 3 || i === 6 ? 'widowed' : 'married', [1, 4, 5].includes(i) ? byId.get(w).birth.v + int(20, 26) : undefined);
  });
  // more marriages within the family
  for (let tries = 0; marriages.filter(m => !byId.get(m.husband).external && !byId.get(m.wife).external).length < 9 && tries < 500; tries++) {
    const h = pick(pool), w = pick(wpool);
    if (married.has(h.id) || married.has(w.id) || Math.abs(h.birth.v - w.birth.v) > 8 || w.birth.v < h.birth.v - 2) continue;
    if (h.parent === w.parent || byId.get(h.parent)?.parent === byId.get(w.parent)?.parent) continue; // not brother and sister, nor first cousins
    marry(h.id, w.id);
    mothers(h.id, w.id, tries % 3 !== 0);
  }

  // ---- other names, a namesake, an uncertain year, years of death
  const fathers = people.filter(p => p.sex === 'm' && living(p) && !p.external && kidsOf(p.id).some(k => k.sex === 'm'));
  const kunya = new Set();
  while (kunya.size < 8) kunya.add(pick(fathers));
  [...kunya].forEach((p, i) => {
    const son = kidsOf(p.id).filter(k => k.sex === 'm').sort((a, b) => (a.birth?.v ?? 0) - (b.birth?.v ?? 0))[0];
    p.aliases = [{ type: 'kunya', text: 'أبو ' + son.name }];
    if (i === 0) p.aliases.push({ type: 'kunya', text: 'أبو ' + pick(MEN) });
  });
  // two brothers of the same name, told apart
  const dad = people.find(p => p.parent === nasser && p.sex === 'm' && kidsOf(p.id).filter(k => k.sex === 'm').length >= 2 && p.id !== aziz);
  if (dad) {
    const [a, b] = kidsOf(dad.id).filter(k => k.sex === 'm');
    b.name = a.name;
    b.suffix = 'الثاني';
  }
  void youngest;
  people.filter(p => p.deceased && p.birth && p.birth.v > 1880).slice(0, 44).forEach(p => (p.death = { v: Math.min(2025, p.birth.v + int(45, 85)), cal: 'g' }));

  return {
    family: { name: 'آل مبارك', source: 'عائلة مصطنعة للاختبارات: كل اسم فيها متخيل' },
    root,
    people,
    marriages,
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const fam = makeFamily();
  const file = new URL('./family.json', import.meta.url);
  fs.writeFileSync(file, JSON.stringify(fam, null, 1) + '\n');
  const ext = fam.people.filter(p => p.external).length;
  console.log(`family.json: ${fam.people.length} people (${ext} from outside), ${fam.marriages.length} marriages`);
}
