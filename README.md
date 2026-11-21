# Family Tree (شجرة العائلة)

A private, end-to-end encrypted, Arabic-first family tree for one family, installed
on members' phones as a web app (PWA). Every name, year and change is sealed on the
phone before it leaves; the server stores and orders the sealed entries, checks
their signatures, and can read none of them. It has:

- the 3D tree and 2D chart, the family card, profiles, kinship ("what is our
  relation?", with every route between two people, milk kinship included),
  marriages, other names, and search that forgives how a name is spelled;
- governance: a root admin, leadership keys per main branch, and changes that
  wait for the approvals their weight needs (everyday, sensitive, critical);
- privacy by kinship: a woman's details show only to those close enough to her,
  sealed with keys of her own;
- each member on several phones and browsers (أجهزتي), each phone able to lock its
  keys behind Face ID, a recovery kit that is a backup key of its own, and a
  family key that is renewed whenever someone (or one of their devices) is removed.

It runs on Cloudflare (Workers and a Durable Object per family) or on any server
with Node; [docs/deploy.md](docs/deploy.md) shows both. The design, with every
decision and its reasons, is in `docs/design/` (English and Arabic). The code is
free software under the [GNU AGPL 3.0](LICENSE).

The design document is HTML in English and Arabic (`docs/design/design-document*.html`).
After editing it, set its `doc-version` meta and rebuild both PDFs with the system Chrome:
`node scripts/render-docs.mjs` (no install needed; older PDFs are kept as history). Should
Chrome stall printing a document with its structure tags, as it now and then does on the
long Arabic one, it is printed again without them, and the script says so.

## Run it locally

```sh
npm install
npm run dev            # starts the API server (port 8787) and the app (port 5173)
npm run family:init    # once: creates the encrypted family log from data/family/family.json
```

With no family file of your own yet, `npm run family:init -- tests/e2e/fixture/family.json`
starts the made-up family the tests use (800 people, every name invented), and the
app with no link at all shows a small fictional sample. A family file is plain JSON
in the format of `src/core/raw.ts`: the family's name, its founder, and each person
with a name, sex, father (`parent`) and, when known, mother, birth and death years
and other names. Keep a real one out of any public repository.

`family:init` saves the root admin's link to `data/secrets/invite-local.txt` (it
never prints it), and writes `data/secrets/invite-local.html` with its QR code to
scan from a phone on the same Wi-Fi as this Mac:

- **Admin link:** for the root admin (مشرف العائلة) only. It carries the key that
  created the family. That phone can mark the main branches and hand out the
  leadership keys (الإدارة → مفاتيح العائلة).
- **Everyone else** joins through a personal invite that the root admin makes in
  the app (الإدارة → الأعضاء والدعوات, below); an invite never includes the admin key.

The keys travel only in the link's `#` part, which browsers never send to a server.

## The tabs

Five tabs: الشجرة (the tree), القرابة (relations), الطلبات (requests), الإدارة
(running the family) and أنا (me).

- **الإدارة** appears only for the root admin and the platinum key holder. The root
  admin finds members and invites, the key seats, «مشاهدة الكل» and the family key
  there; the platinum key holder, the key seats and «مشاهدة الكل».
- **أنا** keeps what is one's own: one's place in the tree, أجهزتي, installing the
  app, security (Face ID lock, recovery kit), settings, and the family and its sync.
  Members who do not run the family see the key seats here too.
- **الطلبات** filters «الكل · فرعي · طلباتي» (all; about one's own branch; sent or
  approved by oneself), dates every past change, and shows the history thirty at a
  time with «عرض المزيد».
- Text buttons have a finger-sized tap area, and every page ends clear of the tab bar.

## Root admin and leadership keys

- The key that signs the log's first entry is the root admin's. Only entries signed
  with it may change the main branches or the key seats; every phone ignores
  anything else, even though the server (which cannot read entries) stores it.
- Seats are fixed: 1 platinum, and 2 gold + 3 silver per main branch. Holders must
  be living members of their seat's branch, and nobody holds two seats: a new seat
  frees the old one. Changing the main branches empties seats that no longer fit.
- The root admin stays alongside the keys for now. Elections, and how the root
  admin is phased out in a mature family, come later.
- **On a person's profile (الصلاحيات)** the root admin sees and changes everything
  about that person's access in one place: give, hand over or take back their key,
  invite them, give them another device («جهاز إضافي»), unlink one of their devices
  or all of them, replace a phone («جهاز جديد»), and view all. The
  platinum key holder sees the view-all switch there. These write the same log
  entries as the keys and members screens, and renew the family key the same way
  when a phone or invite is taken away; tapping a seat or a member there opens
  this section. Spouses from outside the family have no such section.
- **Acting as a member («العمل بصفته»):** on the profile of a member with a phone,
  the root admin can act as them, to try what they say does not work: the app
  shows what their phone shows (their place, what the privacy rule lets them see,
  their key), and requests, approvals and refusals made there are theirs, counted
  by the rules their phone meets. Each is an `as` entry signed with the root
  admin's key, shown on every phone as «مشرف العائلة بصفة فلان», and the member's
  أنا says how often. Their devices, recovery kit, Face ID lock and keys, and
  whatever only the root admin or the platinum holder may do, are never reached:
  the screens are hidden, the phone refuses to write anything else while acting,
  and every phone ignores it if written anyway. A bar on top says so, with
  «إنهاء»; reopening the app ends it too.

## Who gets in

- **Personal invites:** the root admin invites a person from the tree (الإدارة →
  الأعضاء والدعوات). The link or QR code works once; the first phone to open it
  becomes one of that person's devices, and requests and approvals count only from
  that person's devices. The join screen can also scan an invite's QR code with the
  camera (an app added to the Home Screen never receives a tapped link); on an
  iPhone, an invite offers to copy its link into the installed app first.
- **Members under 18** (by the recorded birth year; none recorded counts as an
  adult) see the tree but send no requests, approve nothing and hold no key; every
  phone's replay checks it. They still manage their own devices and recovery kit.
- **Several devices (أنا → أجهزتي):** a member lists every phone and browser that
  acts as them, each named from its browser and system («Brave · Android»,
  «Safari · iPhone»; renamable) with the day it was added, «هذا الجهاز» on the
  current one. «إضافة جهاز» writes a one-time invite for the same person, signed
  by this device, and shows its link and QR code; the new phone joins through it
  as an added device. A member may remove any of their devices, and, holding no
  key, all of them at once (this phone included: it then forgets the family). A
  key holder keeps at least one phone: removing the last is refused, here and by
  every phone's replay (hand the key over first, or ask the root admin). Only the
  person's own devices can add, rename or remove their devices; anything else in
  the log is ignored. Up to 10 devices and waiting invites a person (2 invites of
  their own waiting at a time); the root admin is not limited. Removing a device
  (by the person, or the root admin's unlink, «جهاز جديد» or «فصل كل أجهزته») also
  cancels every invite that device made and nobody has opened yet, so a stolen
  phone's «إضافة جهاز» link cannot bring it back with the renewed key; the
  confirmation says so.
- **iPhone and iPad: only from the Home Screen.** In any browser there (Safari
  erases a site's storage after seven days without a visit, and never shares it
  with the installed app), the app shows one screen instead of the family: a link
  opened there is not taken up, only copied, to paste in the installed app with
  «لصق رابط»; a member already in the browser taps «نقل حسابي إلى التطبيق» for a
  one-time device link (ending `.m`), and the app, once in with it, removes the
  browser from their devices; the root admin copies the admin link, then removes
  it from the browser. A guest already there may stay; the sample opens there.
- **Only real keys:** a claim links a phone only with a real public key (64 hex
  digits, not a small-order point), and every signature is checked strictly (RFC
  8032, noble's `zip215: false`), by phones and the server, so nobody can sign as
  a "device" without its secret.
- **View all (مشاهدة الكل):** the root admin or the platinum key holder can let a
  member see everyone (the privacy rule is lifted for them), or invite a guest
  who may only look. Either can be stopped at any time.
- **Losing access:** a phone that finds it is no longer linked (unlinked member,
  ended guest) removes the family's key and settings and says so. The family key
  is renewed at the same moment (below), so a copy of the old key opens nothing new.
- **A lost or new phone (جهاز جديد):** in the members list, or under «الصلاحيات» on
  the person's profile, the root admin taps «جهاز جديد» on one of a member's phones.
  One step unlinks that phone (it forgets the family when it next opens), renews
  the family key, and shows a fresh personal invite for the same person. «جهاز
  إضافي» there invites another device without unlinking any, and «فصل كل أجهزته»
  unlinks every phone and backup key of the person with one renewal.

## Renewing the family key (تجديد مفتاح العائلة)

- Every entry names the version of the family key that sealed it. Revoking an
  unused invite, unlinking a phone, ending a guest or deleting a linked person
  renews the key: the root admin's phone (or the platinum holder's, for a guest
  they end) writes a `rekey` entry, sealed with the current key, that hands a new
  key to everyone who keeps access. Each copy is sealed for one reader's existing
  Ed25519 key (a phone, an open invite, a guest, the root admin), converted to
  X25519, with HKDF-SHA256 and AES-256-GCM; no new keys are handed out. A `keys`
  entry, sealed with the new key, then carries every earlier key, so someone who
  joins later with only the newest key in their link reads the whole history.
- Every phone checks the renewal: it counts only from the root admin or the
  platinum holder's phone, only if it reaches every reader who keeps access, and
  entries count only if sealed with the key in force. The ephemeral key of a
  renewal is derived from the new key, so every phone that holds the new key
  checks that the root admin's copy opens: a renewal that would shut the root
  admin out counts nowhere. A phone left out of a renewal stops reading there and
  removes the family; a phone whose own copy does not open keeps the family and
  says so (a new invite link brings it back). The root admin can also
  renew by hand (الإدارة → مفتاح العائلة).
- **A renewal that falls due** (someone who holds the current key lost access
  without one: a member removing one of their own devices, an undo approved
  through requests, a removal from an older version of the app) is made by the
  root admin's phone, or the platinum holder's, by itself: at once when it opens,
  otherwise a few seconds after it sees it (so the phone that removed someone,
  which renews right away, goes first). Two phones doing it at once is harmless:
  the log takes one entry at a time, and the second finds nothing due. Until then
  the member who removed a device reads «سيُجدَّد مفتاح العائلة تلقائيًا عند فتح
  المشرف للتطبيق».
- Phones keep every key version they learn (`keys` in their stored membership;
  older phones that have only `key` are upgraded in place). New links carry the
  newest key. The root admin's link from `family:init` keeps working: the admin key
  always receives each new version.
- What it cannot do: a renewal hides what is written after it. Whatever a removed
  person (or anyone who copied the key) already saw, or copied, stays with them,
  and the old entries stay sealed with the keys they had. An invite that is still
  open is handed every new key too, so cancel invites that went to the wrong place
  (those a removed device made are cancelled with it).
- **A phone never goes back:** each phone remembers how far it has read the log
  (`seen` in its stored membership: how many entries, and the hash of the last).
  A server that later serves fewer entries, or other ones (an old backup restored,
  a fork), is refused with «سجل العائلة على الخادم أقدم مما قرأه هذا الجهاز…»: the
  phone neither opens it nor writes to it, so it never falls back to a key it has
  seen replaced. (Whoever serves the app's code could do worse; this guards
  against storage rolled back.)
- `node scripts/test-rotation.ts` checks the key handling without a browser.

## Locking a phone, and getting back in

- **Face ID lock (أنا → الأمان → قفل البصمة):** optional. It makes a passkey on the
  phone and uses its PRF secret (through HKDF) as an AES-256-GCM key: the
  membership (family and admin keys), the phone's signing key and saved invites
  are then kept only sealed in browser storage (`src/data/vault.ts`), and the app
  opens on «افتح بالبصمة» before anything loads. After five minutes in the
  background it locks again. If the phone's passkeys cannot give a PRF secret,
  the app says so and leaves storage as it was; nothing pretends to be locked.
  Turning the lock off (Face ID again) puts the values back in plain storage.
  With the lock on, Face ID is asked again before anything that hands out lasting
  access: a recovery kit, and any link that carries the family key, made or shown
  again («إضافة جهاز», the root admin's invites, «جهاز إضافي», «جهاز جديد», guest
  invites). A phone borrowed while unlocked cannot hand the family out.
- **Recovery kit (مفتاح الاستعادة):** the member picks a passphrase (four random
  words from a built-in list of 2048 are offered, 44 bits). A typed one needs four
  different words, 12 letters, and the same 44 bits by a cautious estimate (a word
  from the list counts 11 bits, any other at most 8, as one of the names and
  everyday words an insider tries first): «نايف ثامر غازي فهد» is refused. A typed
  passphrase for the root admin's kit, which carries the admin key, needs 55 bits.
  Making a kit adds a new key pair to the person's devices in the log, as
  «مفتاح الاستعادة» (its backup key). The membership (family and admin keys), the
  backup key's secret and (in the root admin's kit only) invites still waiting are
  sealed with Argon2id (64 MiB,
  3 passes: about a second on a mid-range phone; the cost and salt travel with
  the kit) and AES-256-GCM, and handed over as a link `/#restore=…` and its QR
  code, to copy, save as a picture or print. On a new phone the link asks for the
  passphrase; the phone makes its own device key, and an entry signed by the
  backup key adds it to the person's devices (the backup key then leaves the
  phone). So the person's place in the tree and any key seat carry over, and no
  two phones share a key. A new kit can replace the earlier ones («إبطال المفتاح
  السابق», ticked by default). A guest's kit still carries the guest's one phone
  key. Neither the kit nor the passphrase ever reaches the server.
  With the lock on, making a kit asks for Face ID first; a locked phone whose
  passkey is gone can paste its kit on the lock screen.
- **Kits and key renewal:** the kit carries every version of the family key the
  phone has learned, and later renewals are sealed for the backup key like for any
  device, so even a kit made before a renewal opens the whole log. A kit works
  while its backup key is among the person's devices: removing it (from أجهزتي, or
  the root admin's «إبطال» or «فصل كل أجهزته») ends it, and a renewal follows.
  A member's kit carries no invites: one would outlive the backup key.
- **Restoring checks first:** the phone reads the log with the kit's keys before
  anything on it changes. A kit whose backup key was removed says so («لم يعد
  مفتاح الاستعادة هذا يعمل…») and the phone stays as it was; a phone already
  linked to that person keeps its own key («هذا الهاتف مرتبط بك أصلًا»); a phone
  linked to someone else in the family is left alone. «انتهى دخولك» on a phone
  that lost access stays, also across a reload, until «حسنًا» is tapped.
- `node scripts/test-devices.ts` checks the rules for a person's own devices.

## Marriages

- **Wives and husbands:** a profile shows each marriage with its status (متزوجان،
  مطلّقان، أرمل·أرملة) and years, Hijri or Gregorian as entered. «إضافة زوجة» adds a
  daughter already in the tree (picked through search) or a woman from outside the
  family; «إضافة زوج» adds a husband from outside to a daughter (or a man in the tree).
- **From outside the family:** recorded by name (and a birth year, if known) only.
  They are not members: not in the 3D/2D trees, search, invites or key seats. They
  stand with the one they married in the family view, with a dashed outline.
- **Children per wife:** adding a child to a man with wives asks which wife is the
  mother (the only or latest current wife by default; «غير مسجلة» allowed). The root
  admin can change a child's mother later among the father's wives.
- **A death** recorded by the root admin turns that person's current marriages into
  widowhood, ending in the year of death.
- **A daughter's children with an outside husband** are linked to their mother and
  typed with their full name. They sit under her in the trees, on a dashed line.
- **Approvals:** adding a wife or husband, divorce, widowhood and removing a marriage
  are sensitive (one gold key of the husband's branch); correcting a year is everyday.
  The root admin records them directly. Every marriage change can be undone.
- **Privacy:** the wife's name and the marriage's status and years follow the same
  kinship rule as any woman's details, in the change history too.

## Milk kinship (الرضاعة)

- **Recording:** on a profile, «+ إضافة رضاعة»: the woman who nursed them, from the
  family or from outside (by name only, standing with the child, as a spouse from
  outside does); her husband at the time as the milk father, or «غير معروف»; and
  «مؤكدة» or «غير مؤكدة». No year: what counts falls in the child's first two years.
- **Shown:** the child's milk mother and father and milk brothers and sisters on his
  profile; «أرضعت» on hers. In «ما صلة القرابة بيننا؟» each milk relation is a route
  of its own («أخت من الرضاعة», «خال من الرضاعة»), from the child and his descendants
  as by birth, never his own brothers or parents; the ladder marks the step «بالرضاعة».
- **Marriages:** never refused for milk. A marriage that a milk relation would bar by
  birth carries a warning (in the sheet and the request's title), and its approvers
  decide; so does a milk record that puts a current marriage under one.
- **Privacy:** the milk child alone counts his milk family as his own (he sees his
  milk mother and milk sisters; his phone gets her key).
- **Approvals:** sensitive, one gold key of the child's branch; the root admin records
  it directly. Removing someone takes their milk records with them; merging moves them.

## Other names, search and duplicates

- **Other names (أسماء أخرى):** a kunya, a laqab, the name someone is known by, a
  previous name or another spelling. The root admin saves them directly; anyone
  else sends them as an everyday request. Text that looks like a phone or ID
  number, an email or a link is refused. A woman's other names follow her own
  visibility.
- **Search** (and every person picker) matches the name and every other name,
  followed by the nasab («أبو فهد بن سعد»), however hamza, ta marbuta, alef maqsura
  or «عبد الله» is written, without tashkeel; «ال» and «أبو» are optional. Hidden
  women are never matched. Spouses from outside the family are not in search.
- **Duplicate check:** adding a child or a line of names asks «هل هو نفسه …؟» when
  the same name or other name is already under that parent, or the same name with
  the same father's name and a birth year within five years.
- **Merging (root admin):** «دمج مع…» on a profile makes two records of one person
  one, in a single sensitive change that can be undone: the kept record takes the
  other's children, marriages and names, and fills in what only the other had.
  It is refused for ancestors, different parents, or a record linked to a phone,
  invite, key seat or main branch (swap them to keep that one).

## Names in chains, «للتمييز», and whole names in lists

- **Compound given names** are put in brackets wherever a chain of names follows
  them: «بن (محمد سعيد) بن علي» (`unit()` in `src/data/graph.ts`, `unitOf()` in
  `src/data/store.ts`). On its own a name shows as entered (`shownName()`), and a
  spouse from outside the family keeps the full name as entered.
- **«للتمييز»** (the person's `suffix` field) is a word shown after the name to tell
  apart brothers or sisters of the same name: «أحمد الأول», «أحمد الثاني». The root
  admin's editor has the field (up to 20 letters) with quick choices (الأول، الثاني،
  الكبير، الصغير, or the feminine forms). When a child is added with the name of a
  brother or sister under the same parent, the duplicate check offers «لا، أخ آخر
  بالاسم نفسه», which marks both in the same change: the one born first is الأول
  (with a birth year missing, the new one is الثاني); if the brother already has a
  word, or two of the name exist, only the new one gets the next ordinal. Search
  finds «أحمد الثاني» and also «أحمد» followed by the father's name. The plain format
  (`src/core/raw.ts`, `family.json`) carries it, and the entry checks
  (`src/core/wellformed.ts`) take it only as text.
- **Every list** (search and every person picker, members, view-all, one's place in
  أنا, key holders, the duplicate check, merging) shows the name with the whole chain
  of fathers down to the family's name, wrapped, never cut (`PersonRow` and
  `fullLine()` in `src/ui/common.tsx`). Hidden women stay «ابنة» or «امرأة».

## The tree, the chart and the profile

- **3D names:** a name that must show (the root, main-branch heads, «أنت», a
  relation's path) never covers another: it moves out step by step, up to nine
  steps, with a thin line back to its person (`src/tree/render.ts`).
- **Generation rail:** «وما قبله · وحده · وما بعده», «وما بعده» by default,
  remembered per device (`genSpan` in the settings).
- **Family card:** choosing someone in 3D shows their close family as cards
  (parents, the person, each spouse with that spouse's children, brothers and
  sisters), whole names with years; a tap walks the tree (`src/ui/FamilyCard.tsx`;
  it replaced the drawn close-up, Bloom).
- **Relations:** the path is a ladder, the common ancestor at the top and each
  person's line coming down beside the other, one generation per step; «في الشجرة»
  shows the path in 3D (`src/ui/Relation.tsx`).
- **2D chart:** opens on one's own place, or, with none, on the largest family two
  generations above the youngest; long names take two lines, and the lines to the
  children start under the names (`src/tree/ChartCanvas.tsx`).
- **Profile:** figures (with totals of children and of brothers and sisters, each
  split male/female), family (children as cards with years), lineage, other names,
  permissions, photos, history, then the root admin's tools; «تعديل البيانات» is
  also a button at the top for the root admin.
- **Birth years:** adding a child, «سنة الميلاد غير معروفة» records none (the editor
  takes an empty year); the year slider reaches 1700 (1110 هـ). Gregorian and Hijri
  years side by side are each bidi-isolated, so they never run together.

## Keeping a copy of the family (family.json and log.json)

Two scripts read the family's site (`--api`, or `FT_SITE`, or the `url` in
`data/family/site.json`) with the root admin's link from `data/secrets/`:

- `scripts/sync-family.ts` writes `data/family/family.json`, the people and
  marriages in the plain format the family was created from;
- `scripts/backup-log.ts` keeps `data/family/log.json`, the encrypted log itself,
  entry by entry, from which `scripts/restore-log.ts` can put the family back on a
  new server.

```sh
node scripts/sync-family.ts                      # the family's site (admin link in data/secrets/invite-live.txt)
node scripts/sync-family.ts --api http://localhost:8787 --link data/secrets/invite-local.txt --out x.json
node scripts/backup-log.ts                       # the log, sealed as the server holds it
```

- It only reads: it downloads the encrypted log and opens it with the key in the
  root admin's link, read from the link file and never printed; any attempt to write
  is refused. It runs the app's own replay, so the file matches what the app shows,
  and stops unless the link is this family's root admin link.
- It checks that the file reads back to exactly the same family before writing, keeps
  people in their place in the file (new ones go last), and reports what was added,
  changed and removed, and how many requests still awaiting approval are left out.
- It is **not a backup of the log**: it holds people, marriages, other names and
  «للتمييز», not the history, requests, key seats, invites or devices. Starting again
  from it (`family:init`) makes a new family, with every member invited again. It is
  plain text: whoever can read it reads every name in it, women's included, so it
  belongs only in a private place.

## How the data is kept

- Every change is an entry in the family log: encrypted on the phone (AES-256-GCM),
  signed by the phone (Ed25519), and chained to the previous entry. The server
  (`server/`) stores the entries in `data/server/` and checks the chain and
  signatures, but cannot read anything.
- No family data is built into the app. Without an invite link it can only show
  the fictional sample family.
- `data/family/` holds the family's own files (its plain file and the log's copy),
  `data/secrets/` its invite and admin links and tokens, and `data/server/` the
  local server's log. Never commit keys: whoever has them can read the family or
  act as its root admin, and git keeps them forever; and keep a family's names out
  of any public repository.

## Who may add to the log (the write check)

- The server cannot read entries, but it does check that a new one comes from
  someone who holds the **current** family key. Each version of the key has a
  write key: an Ed25519 key made from the family key itself (HKDF-SHA256 with a
  fixed label), so whoever holds that version holds it, and nobody else does.
  Every entry carries a signature by it (`w`). The server keeps only the public
  half of the one in force (in the Durable Object's SQLite, or `write-key.json`
  beside the Node server's log) and refuses any entry not signed with it (403).
- **Registering it:** a family from before the check has none, and the server
  takes entries as before. The root admin's phone (the signer of entry 0) registers
  it by itself the first time it opens the family after the deploy, with an entry
  that names it (`nw`). Only the root admin's entries may register a write key,
  or put it back. If a renewal falls due at that same moment (a removal from
  before the update), the phone makes the renewal first and checks the write key
  after it, so the two never race: a renewal signed with the root admin's key
  names the new key's write key, and the server registers that one with it. A
  renewal the platinum holder's phone makes before then is taken as before, and
  the root admin's phone registers the newest key's write key when it opens.
- **Renewals:** a renewal of the family key names the new key's write key, and the
  server moves to it in the same step as storing that entry. From then on the old
  key is refused: an unlinked phone, a cancelled invite, an ended guest, or anyone
  holding an old link can no longer add anything. A phone that writes before it has
  seen the renewal is refused once, catches up and writes again; nobody notices.
- **If it does not match:** should the server's write key be none the family is on
  (someone who held the key moved it), a phone that tries to save says «مفتاح
  الكتابة على الخادم لا يطابق مفتاح العائلة الحالي…», and the root admin's phone
  puts it right by itself as soon as it opens.
- **Old entries stay valid:** the hash chain and the device signature cover exactly
  the fields they always did, so old and new entries verify the same way, and an
  app version from before the check still reads everything. The new fields (`w`,
  `nw` and the signer's `ns`) are each bound to the entry by a signature over its
  hash. Older app versions can still save until the root admin's phone registers
  the key; after that the server refuses them, and they must reload.
- **Junk never stops a phone:** an entry that does not open, or opens to something
  that is not in the shape the app writes, is set aside like an unreadable one
  (`src/core/wellformed.ts`); if the replay still trips over one, it runs again
  without it (`src/data/skipbad.ts`). A request about someone not in the tree
  (removed since, or never there) is closed, shown in the history as «أُغلق: من
  يخصه الطلب ليس في الشجرة», and no screen trips over it.
- **What it does not stop:** anyone who holds the current key (every member's
  phone, every open invite and guest link) can still add entries with nothing
  useful in them, which phones set aside or ignore, or move the write key with a
  renewal of their own, which locks everyone out of saving until the root admin's
  phone opens and puts it back. It hides nothing either: whoever holds a version of
  the key reads everything written under it.
- `node scripts/test-writegate.ts` checks the server's side (with the Node file
  store, an in-memory store and the Worker's Durable Object on Node's own SQLite),
  and `node scripts/test-junk.ts` checks that phones step over junk.

## Tests

Run both kinds before every release.

- **Unit tests**, without a browser: `node scripts/test-<name>.ts` for the key
  handling (`rotation`), devices, the write check (`writegate`), junk entries,
  kinship, the export's layout and the Node server as a site runs it (`server`).
  Each prints PASS/FAIL lines and exits non-zero on a failure.
- **Browser tests**: `npm run test:e2e` runs `tests/e2e`, 78 scripts that drive the
  system's Chrome (Puppeteer) as the phones of the root admin, key holders, members
  and guests, each on a fresh local family: three lanes side by side, then two on a
  family moved to per-person keys. About 40 minutes and 2,415 checks; one line
  per script, then `ALL PASSED` or the number that failed.
  - `npm run test:e2e -- name [name ...]` runs some; `MOVE=1` runs them on a moved
    family. `CHROME=` points at another Chrome.
  - Each lane starts its own API server and dev server (ports 5210–5250 and
    8810–8850), keeping their data, the family's links and the logs in a temporary
    folder (printed at the end): nothing is written to the repo, nothing touches
    the live site, and no link or key is printed.
  - The family is a made-up one, `tests/e2e/fixture/family.json`: 800 people over
    nine generations, 25 marriages, every name and year invented, written by
    `make-family.mjs` beside it from a fixed seed (`FIXTURE=` picks another file).
    Some of its people are placed by hand because scripts look them up by name and
    year; the generator says which.
  - `offline`, `outdated`, `gate4` and `fix-rollback` need a setup of their own (a
    build served by its own server, an old version beside the new, a stopped API
    server); their headers say how.

## Deploying it

[docs/deploy.md](docs/deploy.md) walks through both ways:

- **Cloudflare** (recommended): Workers serves the app and the API, and each
  family's log is a Durable Object (SQLite), written one entry at a time and never
  overwritten. `worker/index.ts` reuses the local server's API code, security
  headers are in `public/_headers`, and the fonts are served from the site itself,
  so no third party sees who opens it.
- **Your own server**: `server/index.ts` on Node behind a reverse proxy that gives
  it HTTPS (Caddy, for one), with the same API, the same headers and the same
  `CREATE_TOKEN` rule.

Either way, starting a family needs the site's `CREATE_TOKEN`; reading does not,
and appending needs the current family key's write signature once the root
admin's phone has registered it (above).

## What the demo does not do yet

- Without the Face ID lock, the family key and the phone's signing key sit in
  browser storage in plain form. Family recovery (key holders vouching for a
  person who lost everything) comes later.
- "View as" lets any phone act as any key holder, for demos (sample family only).
  In a real family an approval only counts from one of the key holder's own devices.
- Anyone with the invite link can read the family. The real build approves each new
  member before they receive any key.

## License

Copyright (C) 2026 the Family Tree authors. Free software: you can redistribute it
and modify it under the terms of the GNU Affero General Public License, version 3
([LICENSE](LICENSE)). If you run a changed version for others to use over a
network, the license asks you to offer them its source.
