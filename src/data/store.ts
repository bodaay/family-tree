// App state. The family and every change come from the family log (shared,
// encrypted and signed on the server, or kept in this browser for the sample
// family). Who you are, who you are viewing as, and display settings stay on
// this device.
import { useEffect, useState } from 'preact/hooks';
import type { AccessAct, AdminAct, Cal, ExportRec, ExportWhat, FamilyData, Level, Marriage, Op, Own, Person, PersonPatch, Seat, Tier, Tx, Year } from './types';
import { ASKS, REACHES } from './types';
import { applyTxs, buildGraph, milkPeople, newId, personRecord, shownName, typedInFull, unit, type Graph } from './graph';
import { keyFor, openDetails, openYears, sealFor } from '../core/personkeys.ts';
import { mergeOps, mergeProblem } from './merge';
import { fromRaw } from './load';
import { THIS_YEAR } from './dates';
import { applySeatAct, assess, asksAbout, canApprove, isComplete, isMinor, branchOf, mainBranchProblem, mayAsk, validSeats } from './governance';
import { degreeWord, kin } from './kinship';
import type { Payload } from '../core/log.ts';
import type { FontKey } from '../font';
import { RemoteLog, SampleLog, device, membership, parseInvite, personalLink, rememberMembership, saveInvite, savedInvites, storedDevice, type Backend, type Item, type Membership } from './backend';
import { b64, canReceiveKey, deviceFromSecret, keyId, newDeviceKey, newFamilyKey, sign, unb64, wrapKey, type DeviceKey } from '../core/crypto.ts';
import { KeyChain, adminCopyOpens } from './keychain';
import { confirmPresence, forget, isLocked, lockOn } from './vault';
import { restoreBlob, type Kit } from './recovery';
import { BACKUP_LABEL, DeviceBook, MAX_DEVICES, MAX_WAITING, deviceLabel, deviceProof, realKey, type DeviceInfo, type Invite } from './devices';
import type { DeviceAct } from './types';
import { skipBad } from './skipbad';
import { clearWomen, detailsOf, handOut, isWoman, reachOf, readersOf, sealOps, sealPerson, snapshotAgrees, tokenTitle, type Readership, type Snapshot } from './snapshot';
import { newPersonKey } from '../core/personkeys.ts';
import { adminPerson, approversFor, hideProblem, hiddenOf, privateBytes, type Hidden, type Met, type Private, type Wrapped } from './hidden';
import { backupText } from '../core/backupfile.ts';
import { dropLog, keepOnly } from './logcache';

export type { DeviceInfo, Invite };

export type Tab = 'tree' | 'relation' | 'requests' | 'admin' | 'me';
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  theme: Theme;
  cal: Cal;
  privacy: boolean;
  /** the tree screen: the 3D tree or the 2D chart */
  view: '3d' | '2d';
  font: FontKey;
  /** the generation rail in 3D: the chosen generation alone, or with those after or before it */
  genSpan: 'only' | 'down' | 'up';
}

interface Prefs {
  me: string | null;
  persona: string | null;
  settings: Settings;
}

export interface State extends Prefs {
  /** none: not in a family yet; locked: waiting for Face ID; loading: opening the log; ready; error */
  status: 'none' | 'locked' | 'loading' | 'ready' | 'error';
  /** This device's keys are sealed behind its passkey (the Face ID lock). */
  lock: boolean;
  /** A recovery kit opened from a link, waiting for its passphrase. */
  restore: string | null;
  /** The recovery kit sheet is open. */
  kitOpen: boolean;
  error: string | null;
  online: boolean;
  /** Opened from the log this phone kept, and the server not reached since (women's details wait for it). */
  kept: boolean;
  mode: 'remote' | 'sample' | null;
  fid: string | null;
  base: FamilyData;
  txs: Tx[];
  isSample: boolean;
  graph: Graph;
  seats: Seat[];
  /** This device holds the root admin key (مشرف العائلة). */
  rootAdmin: boolean;
  /** The person the root admin last acted as, if they chose one. */
  adminBy: string | null;
  /** Personal invites and which devices belong to whom (real families). */
  invites: Invite[];
  devices: Map<string, string>;
  /** What the log says about each device: its name, the day it was added, how. */
  deviceInfo: Map<string, DeviceInfo>;
  /** People who have (or had) a phone of their own. */
  linked: Set<string>;
  guests: Guest[];
  /** The family has moved to per-person keys for women's details. */
  /** The hidden marriages this phone can open: asked for, approved, or refused (data/hidden.ts). */
  hidden: Hidden[];
  /** The root admin's own place in the tree, if their phone is linked to one. */
  adminPerson: string | null;
  /** The charts exported (src/export), each with its code and whether it was allowed. */
  exports: ExportRec[];
  /** The export sheet: whom the chart is of, and which way. */
  exportFor: { from: string; kind: 'down' | 'up' } | null;
  sealedEra: boolean;
  /** Women whose details this phone opened with her key. */
  opened: Set<string>;
  /** Changes made before the move, as this phone read them: to show only. */
  before: Tx[];
  /** The waiting invites the move cancelled (invite keys): whom to invite again. */
  cancelled: string[];
  /** When the move to per-person keys was made. */
  movedAt: number | null;
  /** The move's snapshot did not agree with this phone's own reading of the log before it. */
  movedDiffers: boolean;
  /** Members who see everyone (view all). */
  viewAll: Set<string>;
  /** This device is a guest's: view only. */
  guest: { label: string } | null;
  /** This device sees everyone: a guest, or a member given view all. */
  seesAll: boolean;
  /** How far a woman's details are seen in this family (a kinship degree), or null: by everyone. */
  reach: number | null;
  /** Women whose details are seen wider than the family's rule (data/types.ts, Own). */
  own: Map<string, Own>;
  reachSet: ReachSet | null;
  /** About whom a member may send requests: relatives within this degree, no one (0), or anyone (null). */
  asks: number | null;
  asksSet: ReachSet | null;
  /** This family was removed from the device because its access ended (the family's name). */
  ended: string | null;
  /** This device opened an invite and has not joined with it yet. */
  /**
   * This device opened an invite and has not joined with it yet (`extra`: the
   * person has a device already, so it adds one), or was restored from a
   * recovery kit and is being added to the person's devices (`kit`).
   */
  claim: { kind: 'member' | 'guest' | 'kit'; person: string; label: string; status: 'ok' | 'used' | 'revoked' | 'unknown'; extra?: boolean } | null;
  /**
   * The family key (real families): its version, when it was made, and how many
   * who hold it have lost access since; `mine`: one of them was a device or an
   * invite of this person, so its renewal is still to come.
   */
  familyKey: { version: number; at: number | null; stale: number; mine: boolean };
  /** Root admin: adding a line of names below this person. */
  lineFrom: string | null;
  /** The browser offers to install the app (Chrome, Brave, Edge). */
  installable: boolean;
  /** Root admin: the person being edited, or moved to another parent. */
  editFor: string | null;
  /** Recording someone's death (the sheet). */
  deathFor: string | null;
  moveFor: string | null;
  /** Root admin: merging another record into this person, and the record picked. */
  mergeFor: string | null;
  mergeWith: string | null;
  /** Adding a wife or husband to this person; the one picked from the tree, if any. */
  spouseFor: string | null;
  spousePick: string | null;
  /** The marriage being edited. */
  marriageFor: string | null;
  /** Recording whom this person was nursed by (milk kinship, design document 1.36); the woman picked from the tree, if any. */
  milkFor: string | null;
  milkPick: string | null;
  /** Root admin: the marriage whose children are being ticked. */
  kidsFor: string | null;
  /** The invite whose link and QR code are on screen (root admin). */
  inviteOpen: string | null;
  /** The seat being filled while the person picker is open. */
  pickSeat: { tier: Tier; branch: string | null; replaces?: string } | null;
  /** Root admin overlays: a filled seat's actions, the main-branch editor. */
  keySheet: Seat | null;
  branchEditor: boolean;
  tab: Tab;
  focus: string | null;
  profile: string | null;
  addFor: string | null;
  searchOpen: false | 'focus' | 'relation' | 'relationA' | 'me' | 'seat' | 'invite' | 'viewall' | 'line' | 'move' | 'merge' | 'spouse' | 'grant' | 'export' | 'milk';
  /** The woman someone is being named for, to see her details (WhoSees). */
  grantFor: string | null;
  gen: number | null;
  relA: string | null;
  relB: string | null;
  toast: string | null;
}

const EMPTY: FamilyData = { family: { name: '' }, root: 'root', people: [{ id: 'root', name: '', sex: 'm', familyRoot: true }], marriages: [] };
const DEFAULT_SETTINGS: Settings = { theme: 'system', cal: 'g', privacy: true, view: '3d', font: 'almarai', genSpan: 'down' };

let backend: Backend | null = null;
let prefsKey = 'ft-prefs:none';

function loadPrefs(key: string): Prefs {
  const fallback: Prefs = { me: null, persona: null, settings: DEFAULT_SETTINGS };
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Prefs> | null;
    return p ? { ...fallback, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } } : fallback;
  } catch {
    return fallback;
  }
}

// «انتهى دخولك» stays until the person taps «حسنًا», also when the page reloads
// meanwhile (a phone that kills and restores the app in the background)
const ENDED = 'ft-ended';
function keepEnded(name: string | null) {
  try {
    if (name) localStorage.setItem(ENDED, name);
    else localStorage.removeItem(ENDED);
  } catch {
    /* private mode: shown for this session */
  }
}
function endedBefore(): string | null {
  try {
    return localStorage.getItem(ENDED);
  } catch {
    return null;
  }
}

let state: State = {
  ...loadPrefs(prefsKey),
  status: isLocked() ? 'locked' : 'none',
  lock: lockOn(),
  restore: null,
  kitOpen: false,
  error: null,
  online: true,
  kept: false,
  mode: null,
  fid: null,
  base: EMPTY,
  txs: [],
  isSample: false,
  graph: buildGraph(EMPTY),
  seats: [],
  rootAdmin: false,
  adminBy: null,
  pickSeat: null,
  invites: [],
  devices: new Map(),
  deviceInfo: new Map(),
  linked: new Set(),
  guests: [],
  sealedEra: false,
  hidden: [],
  adminPerson: null,
  exports: [],
  exportFor: null,
  opened: new Set(),
  before: [],
  cancelled: [],
  movedAt: null,
  movedDiffers: false,
  viewAll: new Set(),
  guest: null,
  seesAll: false,
  reach: 3,
  own: new Map(),
  reachSet: null,
  asks: null,
  asksSet: null,
  ended: endedBefore(),
  claim: null,
  familyKey: { version: 1, at: null, stale: 0, mine: false },
  inviteOpen: null,
  lineFrom: null,
  installable: false,
  editFor: null,
  deathFor: null,
  moveFor: null,
  milkFor: null,
  milkPick: null,
  mergeFor: null,
  mergeWith: null,
  spouseFor: null,
  spousePick: null,
  grantFor: null,
  marriageFor: null,
  kidsFor: null,
  keySheet: null,
  branchEditor: false,
  tab: 'tree',
  focus: null,
  profile: null,
  addFor: null,
  searchOpen: false,
  gen: null,
  relA: null,
  relB: null,
  toast: null,
};

const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

function savePrefs() {
  try {
    const p: Prefs = { me: state.me, persona: state.persona, settings: state.settings };
    localStorage.setItem(prefsKey, JSON.stringify(p));
  } catch {
    /* private mode: works for this session */
  }
}

export function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if ('me' in patch || 'persona' in patch || 'settings' in patch) savePrefs();
  if ('ended' in patch) keepEnded(patch.ended ?? null);
  listeners.forEach(l => l());
}

export function useStore(): State {
  const [, setTick] = useState(0);
  useEffect(() => {
    const force = () => setTick(x => x + 1);
    listeners.add(force);
    return () => void listeners.delete(force);
  }, []);
  return state;
}

let toastTimer = 0;
export function toast(msg: string) {
  set({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => set({ toast: null }), 3200);
}

// ---- rebuilding the family from the log

/** A guest's view-only invite. */
export interface Guest {
  key: string;
  label: string;
  at: number;
  status: 'pending' | 'joined' | 'revoked';
  device?: string;
}

/** Who last set how far women's details are seen: the root admin, or the platinum holder (`by`), and when. */
export interface ReachSet {
  admin: boolean;
  by: string | null;
  at: number;
}

interface Replayed {
  base: FamilyData;
  txs: Tx[];
  graph: Graph;
  seats: Seat[];
  adminPub: string;
  adminBy: string | null;
  invites: Invite[];
  /** device key -> the person it belongs to */
  devices: Map<string, string>;
  deviceInfo: Map<string, DeviceInfo>;
  /** Every key ever handed to a person (device or invite): whose it was. */
  owners: Map<string, string>;
  guests: Guest[];
  /** device key -> the guest invite it joined with */
  guestDevices: Map<string, string>;
  /** members who see everyone */
  viewAll: Set<string>;
  /** How far a woman's details are seen (a kinship degree), or null: by everyone. */
  reach: number | null;
  /** Who set it last: the root admin, or the platinum holder (`by`), and when. */
  reachSet: ReachSet | null;
  /** About whom a member may send requests (a kinship degree, 0 for no one), or null: anyone; and who set it. */
  asks: number | null;
  asksSet: ReachSet | null;
  /** The family key's versions (key ids, oldest first) and when the current one was made. */
  kids: string[];
  keyAt: number | null;
  /** Everyone who keeps access (public keys): whom a renewal must reach. */
  readers: string[];
  /** Who holds the current key but has lost access since it was made (public keys). */
  stale: string[];
  /** A renewal was cut short before the entry carrying the earlier keys. */
  backfill: boolean;
  /** This device was left out of a renewal: it can read nothing after it. */
  cut: boolean;
  /** A renewal sealed a copy for this device that does not open: it can read nothing after it, but was not removed. */
  broken: boolean;
  /** Entries that count (readable, and sealed with the key in force when written). */
  entries: number;
  /** The move to per-person keys, once made: when. */
  epoch: { at: number } | null;
  /** The changes this phone read before the move (members from before it): to show, never to apply again. */
  before: Tx[];
  /** Which women's keys the root admin's phone has handed each reader (public key -> person ids). */
  given: Map<string, Set<string>>;
  /** A cut renewal is in the log and its snapshot is not yet: the root admin's phone writes it. */
  awaiting: boolean;
  /** The main branches the root admin marked, if any. */
  mains: string[] | null;
  /** The current family key's version number, counting from the family's start. */
  keyVersion: number;
  /** Whether the move's snapshot agreed with this phone's own replay of the log before it (null: nothing to compare). */
  epochCheck: boolean | null;
  /** The waiting invites the move cancelled. */
  cancelled: string[];
  /** Women whose details are seen wider than the family's rule, and how. */
  own: Map<string, Own>;
  /** The hidden marriages this phone can open (data/hidden.ts): never part of the tree above. */
  hidden: Hidden[];
  /** The root admin's own place in the tree, if their phone is linked to one. */
  adminPerson: string | null;
  /** The charts exported, in the log's order (src/export). */
  exports: ExportRec[];
}

/**
 * Replays the log in order. Seats, main branches and invites change only
 * through entries signed with the root admin's key (the key that created the
 * family). In a real family every request and approval must come from a device
 * linked to that person, by a personal invite or the admin's own link. An
 * approval counts only if, at that point in the log, the approver held a key
 * that may approve it; the root admin may decide any request alone. Every
 * device checks all of this. Entries count only if
 * sealed with the family's current key; `keys` says which versions this device
 * holds and its own public keys, so it knows when a renewal left it out.
 */
function replay(items: Item[], strict: boolean, keys?: Held): Replayed | null {
  let base: FamilyData | null = null;
  // the signer of the first entry: every phone sees it, even one that cannot open that entry (it joined after a cut)
  let adminPub = items[0]?.pub ?? '';
  let adminBy: string | null = null;
  let mains: string[] | undefined;
  const txs: Tx[] = [];
  const byId = new Map<string, Tx>();
  const guests = new Map<string, Guest>();
  const guestDevices = new Map<string, string>();
  // members' devices and personal invites: never the root admin key or a guest's
  const book = new DeviceBook(k => k === adminPub || guests.has(k) || guestDevices.has(k));
  const { invites, owner: devices } = book;
  const viewAll = new Set<string>();
  let reach: number | null = 3;
  let reachSet: ReachSet | null = null;
  let asks: number | null = null;
  let asksSet: ReachSet | null = null;
  let graph: Graph | null = null;
  let seats: Seat[] = [];
  // a request about someone not in the tree (removed since, or never there) is
  // closed: nobody could approve it, and it would wait for ever
  const closeIfGone = (tx: Tx) => {
    if (tx.status !== 'pending' || graph!.nodes.has(tx.subject)) return;
    tx.status = 'rejected';
    tx.closed = true;
  };
  const refresh = () => {
    graph = buildGraph(applyTxs(base!, txs), mains);
    seats = validSeats(graph, seats);
    txs.forEach(closeIfGone);
  };
  // someone in the tree (a spouse from outside is recorded by name only, and is not a member)
  const isPerson = (id: string) => {
    const n = graph!.nodes.get(id);
    return !!n && !n.familyRoot && !n.external;
  };
  const signedBy = (pub: string, person: string) => !strict || devices.get(pub) === person;
  // under 18 when it was written (and now, for an entry dated ahead): no requests, approvals or refusals
  const minorAt = (person: string, at: number) => isMinor(graph!, person, Math.min(new Date(at).getUTCFullYear(), THIS_YEAR));
  // the root admin, or the phone of whoever holds the platinum key now
  const manager = (pub: string, by: string | null) => {
    const platinum = seats.find(x => x.tier === 'platinum')?.holder;
    return pub === adminPub || (!!by && by === platinum && devices.get(pub) === by);
  };
  // who keeps access (by public key): the root admin, linked phones and guests'
  // phones, and invites not yet used or cancelled, of people still in the tree
  const readers = () => {
    const out = new Set([adminPub]);
    for (const i of invites.values()) if (i.status === 'pending' && graph!.nodes.has(i.person)) out.add(i.key);
    for (const [d, person] of devices) if (graph!.nodes.has(person)) out.add(d);
    for (const g of guests.values()) if (g.status === 'pending') out.add(g.key);
    for (const d of guestDevices.keys()) out.add(d);
    return out;
  };
  const chain = new KeyChain();
  let cut = false;
  let broken = false;
  let entries = 0;
  // after the move to per-person keys: when, the changes this phone read before it (to show), and which women's keys each reader was handed
  let epoch: { at: number } | null = null;
  let before: Tx[] = [];
  let given = new Map<string, Set<string>>();
  // a cut renewal made, its snapshot not yet written: nothing counts until it is (a phone that joins later starts there)
  let awaiting = false;
  // whether the snapshot agreed with this phone's own replay (null: it joined after the move, with nothing to compare)
  let epochCheck: boolean | null = null;
  let cancelled: string[] = [];
  // how far each woman's details are seen, where wider than the family's rule
  let own = new Map<string, Own>();
  // who may set it: her own phone; for a woman with no phone in the family, her close
  // relatives (1st or 2nd degree) or a gold of her branch; the root admin or the platinum holder always
  const widener = (pub: string, by: string, woman: string, at: number) => {
    if (manager(pub, by)) return true;
    if (!signedBy(pub, by) || minorAt(by, at)) return false;
    if (by === woman) return true;
    if ([...devices.values()].includes(woman)) return false;
    const k = kin(graph!, by, woman);
    return (!!k && k.deg <= 2) || seats.some(x => x.tier === 'gold' && x.holder === by && x.branch === branchOf(graph!, woman));
  };
  // a chart exported: by the root admin or the platinum holder, of anyone; by a gold, of their own main branch
  const exports: ExportRec[] = [];
  const exporter = (pub: string, by: string | null, from: string, at: number) => {
    const n = graph!.nodes.get(from);
    if (!n || n.external) return false;
    if (manager(pub, by)) return true;
    if (!by || !signedBy(pub, by) || minorAt(by, at)) return false;
    return !n.familyRoot && seats.some(x => x.tier === 'gold' && x.holder === by && x.branch === branchOf(graph!, from));
  };
  // the private things this phone opened (hidden marriages), each checked as the tree and the seats stood when written
  const met: Met[] = [];
  const asked = new Map<string, string>();
  for (const { p, at, pub, kid, priv } of items) {
    // sealed with an older or unknown key (e.g. by someone a renewal left out), or unreadable
    if (!chain.counts(kid) || !p) continue;
    if (awaiting && p.type !== 'epoch') continue;
    entries++;
    if (p.type === 'seed') {
      if (!base) {
        base = fromRaw(p.family);
        adminPub = pub;
        if (kid) chain.start(kid, pub, at);
        refresh();
      }
      continue;
    }
    if (p.type === 'epoch') {
      // the family as the root admin's phone wrote it at the cut: every phone works on from here
      if (pub !== adminPub || !kid) continue;
      const sn = p.snapshot;
      // a phone that read the log before the move checks the snapshot against its own replay
      const had = graph as Graph | null;
      if (had) epochCheck = snapshotAgrees(sn, { people: [...had.nodes.keys()].map(id => personRecord(had, id)), marriages: had.marriages, milk: had.milk, seats, viewAll, reach, asks });
      before = [...before, ...txs];
      txs.length = 0;
      byId.clear();
      base = sn.family;
      mains = sn.mains ?? undefined;
      seats = sn.seats.map(x => ({ ...x }));
      adminBy = sn.adminBy;
      book.restore(sn.devices, sn.invites, sn.ever);
      guests.clear();
      guestDevices.clear();
      for (const gu of sn.guests) {
        guests.set(gu.key, { ...gu });
        if (gu.device) guestDevices.set(gu.device, gu.key);
      }
      viewAll.clear();
      for (const x of sn.viewAll) viewAll.add(x);
      reach = sn.reach;
      reachSet = sn.reachSet;
      asks = sn.asks;
      asksSet = sn.asksSet;
      chain.restart(kid, sn.holders, at, sn.keyVersion);
      given = new Map(Object.entries(sn.keys).map(([r, v]) => [r, new Set(v.ids)]));
      epoch = { at };
      cancelled = sn.cancelled;
      own = new Map(sn.own ?? []);
      awaiting = false;
      refresh();
      continue;
    }
    if (!base || !graph) continue;
    if (p.type === 'private') {
      const g0 = graph as Graph;
      const admin = adminPerson(book.info.values());
      for (const w of priv ?? []) {
        const b = w.body;
        let ok = devices.get(w.from) === b.by && !minorAt(b.by, at);
        if (ok && b.kind === 'hide') ok = !hideProblem(g0, seats, admin, b);
        if (ok && b.kind === 'decide') ok = asked.has(b.id) && approversFor(g0, seats, admin, asked.get(b.id)!).includes(b.by);
        if (ok && b.kind === 'hide' && !asked.has(b.id)) asked.set(b.id, b.marriage.husband);
        met.push({ w, at, ok });
      }
      continue;
    }
    if (p.type === 'pkeys') {
      // what the root admin's phone has handed out (others may hand keys they hold, too; they are not counted here)
      if (epoch && pub === adminPub) for (const [r, v] of Object.entries(p.to)) given.set(r, new Set([...(given.get(r) ?? []), ...v.ids]));
      continue;
    }
    if (p.type === 'admin') {
      if (pub !== adminPub) continue;
      const a = p.act;
      if (a.kind === 'branches') {
        if (mainBranchProblem(graph, a.ids)) continue;
        mains = a.ids;
        refresh();
      } else if (a.kind === 'invite') {
        if (!isPerson(a.person) || invites.has(a.key)) continue;
        book.invite(a.key, a.person, at);
        chain.gave(a.key);
      } else if (a.kind === 'revoke') {
        // an unused invite, or any device of anyone (a phone, a recovery kit's backup key)
        const inv = invites.get(a.key);
        if (inv?.status === 'pending') inv.status = 'revoked';
        book.unlink(a.key);
      } else if (a.kind === 'self') {
        if (!isPerson(a.person)) continue;
        book.link(a.device, a.person, at, 'self', a.label);
        chain.gave(a.device);
      } else if (a.kind === 'edit') {
        if (byId.has(a.tx.id) || (epoch && clearWomen(graph, a.tx.ops))) continue;
        const tx: Tx = { ...a.tx, status: 'approved', approvals: [], direct: true };
        txs.push(tx);
        byId.set(tx.id, tx);
        refresh();
      } else if (a.kind === 'decide') {
        const tx = byId.get(a.txId);
        if (!tx || tx.status !== 'pending') continue;
        tx.status = a.ok ? 'approved' : 'rejected';
        tx.byAdmin = true;
        if (a.ok) refresh();
      } else {
        const next = applySeatAct(graph, seats, a);
        if (typeof next === 'string') continue;
        seats = next;
      }
      adminBy = p.by ?? adminBy;
      continue;
    }
    if (p.type === 'access') {
      if (!manager(pub, p.by)) continue;
      const a = p.act;
      if (a.kind === 'viewall') {
        if (!isPerson(a.person)) continue;
        if (a.on) viewAll.add(a.person);
        else viewAll.delete(a.person);
      } else if (a.kind === 'guest') {
        if (guests.has(a.key) || invites.has(a.key)) continue;
        guests.set(a.key, { key: a.key, label: a.label.slice(0, 60), at, status: 'pending' });
        chain.gave(a.key);
      } else {
        const gu = guests.get(a.key) ?? [...guests.values()].find(x => x.device === a.key);
        if (!gu) continue;
        gu.status = 'revoked';
        if (gu.device) guestDevices.delete(gu.device);
      }
      continue;
    }
    if (p.type === 'setting') {
      if (!manager(pub, p.by)) continue;
      const a = p.act;
      const who = { admin: pub === adminPub, by: p.by, at };
      if (a.kind === 'reach' && (a.deg === null || (REACHES as readonly number[]).includes(a.deg))) {
        reach = a.deg;
        reachSet = who;
      } else if (a.kind === 'asks' && (a.deg === null || (ASKS as readonly number[]).includes(a.deg))) {
        asks = a.deg;
        asksSet = who;
      }
      continue;
    }
    if (p.type === 'export') {
      // recorded whatever it shows, so a poster's code always finds who made it; `ok` whether they could
      exports.push({ code: p.code, by: p.by, at, admin: pub === adminPub, what: p.what, ok: exporter(pub, p.by, p.what.from, at) });
      continue;
    }
    if (p.type === 'widen') {
      const n = (graph as Graph).nodes.get(p.person);
      const o = p.own;
      if (!isWoman(n) || !(o.reach === 'family' || o.reach === 'all' || (REACHES as readonly number[]).includes(o.reach)) || !widener(pub, p.by, p.person, at)) continue;
      const people = [...new Set(o.people)].filter(x => x !== p.person && isPerson(x)).slice(0, 50);
      if (o.reach === 'family' && !people.length) own.delete(p.person);
      else own.set(p.person, { reach: o.reach, people });
      continue;
    }
    if (p.type === 'claim') {
      // a guest invite: view only
      const gu = guests.get(pub);
      if (gu) {
        if (gu.status !== 'pending' || devices.has(p.device) || !realKey(p.device)) continue;
        gu.status = 'joined';
        gu.device = p.device;
        guestDevices.set(p.device, gu.key);
        chain.handOver(pub, p.device);
        if (given.has(pub)) given.set(p.device, new Set(given.get(pub)));
        continue;
      }
      // signed with the invite's own key; each invite links one device, once (a
      // person may have several, each joined with its own invite), and only a
      // real public key that is nobody else's
      const inv = invites.get(pub);
      if (!inv || inv.status !== 'pending') continue;
      if (devices.has(p.device) ? devices.get(p.device) !== inv.person : !book.claimable(p.device)) continue;
      book.link(p.device, inv.person, at, 'invite', p.label);
      inv.status = 'joined';
      inv.device = p.device;
      chain.handOver(pub, p.device);
      // the women's keys handed to the invite are the phone's now (it keeps what it learned with it)
      if (given.has(pub)) given.set(p.device, new Set([...(given.get(p.device) ?? []), ...given.get(pub)!]));
      continue;
    }
    if (p.type === 'rekey') {
      if (!manager(pub, p.by)) continue;
      // the root admin's copy must open, and whoever holds the new key can check
      // that it does: so the platinum holder cannot shut the root admin out
      const k = keys?.key(p.kid);
      if (keys && k && !adminCopyOpens(k, p, adminPub)) continue;
      // without the new key: the root admin's own phone knows its copy did not
      // open; and a phone the log does not know yet (it joined later, with a newer
      // link) cannot check, while every renewal that counts reaches it through
      // its link or a 'keys' entry
      if (keys && !k && (keys.mine.includes(adminPub) || !keys.mine.some(x => chain.holders.has(x)))) continue;
      if (!chain.renew(p, readers(), at)) continue;
      // the move to per-person keys: this version starts afresh, and the earlier ones are never carried to it
      if (p.cut && pub === adminPub) {
        chain.restart(p.kid, Object.keys(p.wraps), at);
        awaiting = true;
      }
      if (keys && !k) {
        // a copy sealed for this device that does not open: a broken renewal, not a removal
        if (keys.mine.some(x => Object.hasOwn(p.wraps, x))) broken = true;
        // left out: nothing after this point can be read here
        else cut = true;
        break;
      }
      continue;
    }
    if (p.type === 'keys') {
      chain.backfill(p);
      continue;
    }
    if (p.type === 'device') {
      // a person's own devices: signed by one of them, and only ever their own
      if (!strict || !isPerson(p.by)) continue;
      const gave = book.apply(p.act, pub, p.by, at, { adminPub, keyHolder: seats.some(x => x.holder === p.by) });
      gave?.forEach(k => chain.gave(k));
      continue;
    }
    // for the server only (the write key in the envelope)
    if (p.type === 'writekey') continue;
    if (p.type === 'propose') {
      if (byId.has(p.tx.id) || !signedBy(pub, p.tx.by) || minorAt(p.tx.by, at)) continue;
      // after the cut, a woman's details travel only sealed with her key
      if (epoch && clearWomen(graph, p.tx.ops)) continue;
      // beyond the family's limit on requests, as it stood when sent: never a request
      if (!mayAsk(graph!, seats, asks, p.tx.by, p.tx.ops)) continue;
      // what the replay works out (how it ended) is never taken from the entry
      const { closed: _c, direct: _d, rejectedBy: _r, byAdmin: _a, declared: _x, ...asked } = p.tx;
      // its level and branch are worked out here from its changes, never as its sender wrote them
      const owners = new Set(book.ever.values());
      const { level, branch } = assess(graph!, asked.ops, id => owners.has(id), seats);
      const tx: Tx = { ...asked, level, branch, status: 'pending', approvals: [] };
      if (level !== asked.level || branch !== asked.branch) tx.declared = { level: asked.level, branch: asked.branch };
      txs.push(tx);
      byId.set(tx.id, tx);
      closeIfGone(tx);
      continue;
    }
    const tx = byId.get(p.txId);
    if (!tx || tx.status !== 'pending' || !signedBy(pub, p.by) || minorAt(p.by, at)) continue;
    const c = canApprove(graph, seats, p.by, tx);
    if (!c.ok) continue;
    if (p.type === 'reject') {
      tx.status = 'rejected';
      tx.rejectedBy = p.by;
      continue;
    }
    tx.approvals.push({ by: p.by, at, override: c.override });
    if (isComplete(graph, seats, tx)) {
      tx.status = 'approved';
      refresh();
    }
  }
  if (!base || !graph) return null;
  const now = readers();
  return {
    base, txs, graph, seats, adminPub, adminBy, invites: [...invites.values()], devices, deviceInfo: book.info, owners: book.ever,
    guests: [...guests.values()], guestDevices, viewAll, reach, reachSet, asks, asksSet,
    kids: chain.kids, keyAt: chain.at, readers: [...now], stale: chain.stale(now), backfill: !chain.backfilled, cut, broken, entries,
    epoch, before, given, awaiting, mains: mains ?? null, keyVersion: chain.version, epochCheck, cancelled, own,
    hidden: hiddenOf(met, graph, new Set([...base.marriages.map(m => m.id), ...txs.flatMap(t => (t.status === 'approved' ? t.ops.flatMap(o => (o.op === 'addMarriage' ? [o.marriage.id] : [])) : []))])),
    adminPerson: adminPerson(book.info.values()),
    exports,
  };
}

/** The family key versions this device holds, and its own public keys (its phone, and any admin or invite key). */
interface Held {
  key(kid: string): Uint8Array | undefined;
  mine: string[];
}

/** A real family's log replays once per version of it (each pull, or newly learned key, gives a new list). */
const replays = new WeakMap<Item[], Replayed | null>();
function replayOf(b: Backend, items = b.items): Replayed | null {
  // an entry the replay trips over is left out, never the rest of the log
  if (!(b instanceof RemoteLog)) return skipBad(items, list => replay(list, false));
  if (!replays.has(items)) replays.set(items, skipBad(items, list => replay(list, true, { key: kid => b.key(kid), mine: b.mine() })));
  return replays.get(items)!;
}

function remoteLog(m: Membership): RemoteLog {
  // new entries are sealed with the key the log's renewals agree on
  const b: RemoteLog = new RemoteLog(m, items => replayOf(b, items)?.kids.at(-1) ?? null);
  return b;
}

/** The log as the state shown was last rebuilt from. */
let built: Item[] | null = null;

/** `opened`: the first rebuild after the family opened on this phone. */
function rebuild(opened = false) {
  if (!backend) return;
  built = backend.items;
  const r = replayOf(backend);
  if (!r) throw new Error(backend.items[0] && !backend.items[0].p ? 'مفتاح هذا الرابط لا يفتح سجل العائلة' : 'سجل العائلة فارغ');
  const { base, txs, graph, seats, adminPub, adminBy, invites, devices, deviceInfo, guests, guestDevices, viewAll, reach, reachSet, asks, asksSet } = r;
  const rootAdmin = backend.adminPub() === adminPub;
  const familyKey = { version: r.keyVersion || 1, at: r.keyAt, stale: r.stale.length, mine: false };
  const patch: Partial<State> = { base, txs, graph, seats, adminBy, invites, devices, deviceInfo, linked: new Set(r.owners.values()), guests, viewAll, reach, own: r.own, reachSet, asks, asksSet, rootAdmin, guest: null, seesAll: false, familyKey };
  let kitFor: string | null = null;
  if (backend instanceof RemoteLog) {
    // a renewal this phone cannot read past, though it was not removed: a copy
    // sealed for it that does not open (the root admin is always handed one).
    // Keep the family here and say so, also when it shows up during a sync.
    const stuck = r.broken
      ? 'لم يُفتح مفتاح العائلة الجديد على هذا الجهاز. اطلب من مشرف العائلة دعوة جديدة.'
      : r.cut && rootAdmin
        ? 'لم يصل مفتاح العائلة الجديد إلى جهاز المشرف'
        : null;
    if (stuck) return set({ status: 'error', error: stuck });
    // new links carry the newest key
    if (!r.cut && r.kids.length) backend.adopt(r.kids[r.kids.length - 1]);
    // in a real family you are who your invite says, never a choice (and not
    // someone the root admin has since removed from the tree)
    const linked = devices.get(device().pk);
    const mine = linked && graph.nodes.has(linked) ? linked : null;
    const guestKey = guestDevices.get(device().pk);
    patch.me = mine;
    patch.persona = null;
    patch.guest = guestKey ? { label: guests.find(x => x.key === guestKey)!.label } : null;
    // the root admin manages and invites everyone, so sees every name
    patch.seesAll = rootAdmin || !!guestKey || (!!mine && viewAll.has(mine));
    const m = currentMembership();
    patch.claim = null;
    if (m?.invite) {
      const pub = deviceFromSecret(m.invite).pk;
      const inv = invites.find(i => i.key === pub);
      const gu = guests.find(x => x.key === pub);
      const mineNow = (inv && inv.device === device().pk) || (gu && gu.device === device().pk);
      const status = (st?: string) => (st === 'pending' ? 'ok' : st === 'joined' ? 'used' : st === 'revoked' ? 'revoked' : 'unknown') as 'ok' | 'used' | 'revoked' | 'unknown';
      if (mineNow) backend.joined();
      else if (gu) patch.claim = { kind: 'guest', person: '', label: gu.label, status: status(gu.status) };
      else {
        // an invite for someone who has a device already adds this one to theirs
        const extra = !!inv && [...devices.values()].includes(inv.person);
        patch.claim = { kind: 'member', person: inv?.person ?? '', label: '', status: status(inv?.status), extra };
      }
    }
    // restored from a recovery kit: while the kit's backup key is still one of
    // the person's devices, it adds this phone to them (registerKit)
    if (m?.kit) {
      const owner = devices.get(deviceFromSecret(m.kit).pk);
      if (mine || !owner || !graph.nodes.has(owner)) backend.kitDone();
      else patch.claim = { kind: 'kit', person: (kitFor = owner), label: kitStuck ?? '', status: 'ok' };
    }
    // no longer linked (unlinked, revoked, or never invited), or left out of a
    // renewal of the family key: forget this family here
    if (!rootAdmin && (r.cut || (!mine && !guestKey && patch.claim?.status !== 'ok'))) {
      wipeFamily(base.family.name);
      return;
    }
    // a device or an invite of this person was removed, and the key it holds is not renewed yet
    familyKey.mine = !!mine && r.stale.some(k => r.owners.get(k) === mine);
  }
  // after the move to per-person keys: each woman's details as far as this phone holds her key
  patch.sealedEra = !!r.epoch;
  patch.movedAt = r.epoch?.at ?? null;
  patch.cancelled = r.cancelled;
  patch.movedDiffers = r.epochCheck === false;
  patch.before = r.before;
  patch.opened = new Set();
  patch.hidden = r.hidden;
  patch.adminPerson = r.adminPerson;
  patch.exports = r.exports;
  if (r.epoch && backend instanceof RemoteLog) Object.assign(patch, decorate(r.graph, backend.pkeys, r.hidden));
  set(patch);
  if (kitFor) registerKit(kitFor);
  if (r.epoch && rootAdmin) void handOutMissing();
  if (r.epoch && rootAdmin) void sealMarriageYears();
  if (r.epoch && r.hidden.length) void keepHidden(r);
  if (r.awaiting && rootAdmin) void finishMove();
  // a renewal cut short before carrying the earlier keys forward: finish it
  if (r.backfill && canGrantAccess() && !moving) void carryKeys();
  renewIfDue(r, opened);
}

/**
 * The tree as this phone may show it: each woman's details, and the years of her
 * marriages, opened with her key where it holds one (the replay works from the
 * structure alone, the same on every phone); the others keep an empty name, as a
 * woman this phone may not see, and marriages without their years.
 */
function decorate(g: Graph, held: Map<string, string>, hidden: Hidden[] = []): { graph: Graph; opened: Set<string> } {
  const opened = new Set<string>();
  const people = [...g.nodes.keys()].map(id => {
    const p = personRecord(g, id);
    if (!p.sealed) return p;
    const k = keyFor(p.sealed, held.get(id));
    const d = k ? openDetails(k, p.sealed) : null;
    if (!d) return p;
    opened.add(id);
    return { ...p, ...d };
  });
  const marriages = g.marriages.map(m => {
    if (!m.sealed) return m;
    const k = keyFor(m.sealed, held.get(m.wife));
    const y = k ? openYears(k, m.sealed) : null;
    return y ? { ...m, ...y } : m;
  });
  // the hidden marriages this phone may see, on top of the tree (and a wife from outside with hers)
  for (const h of hidden) {
    if (h.status !== 'approved') continue;
    if (h.wife && !g.nodes.has(h.wife.id)) people.push({ ...h.wife });
    marriages.push({ ...h.marriage, hidden: true });
  }
  return { graph: buildGraph({ family: g.family, root: g.root, people, marriages, milk: g.milk }, g.branches), opened };
}

/** No connection (or the server not answering), as opposed to a log that is wrong. */
function unreachable(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && /^server 5\d\d$/.test(e.message));
}

/** Removes the family from this device: its key, settings, the log it kept, and everything shown. */
function wipeFamily(name: string) {
  const fid = state.fid;
  for (const k of ['ft-family', 'ft-mode', 'ft-prefs:' + fid, 'ft-invites:' + fid]) forget(k);
  if (fid) void dropLog(fid);
  backend = null;
  set({
    status: 'none', mode: null, fid: null, ended: name, base: EMPTY, graph: buildGraph(EMPTY), txs: [], seats: [], invites: [], guests: [],
    devices: new Map(), deviceInfo: new Map(), linked: new Set(), viewAll: new Set(), reach: 3, own: new Map(), reachSet: null, asks: null, asksSet: null, me: null, persona: null, guest: null, seesAll: false, claim: null, rootAdmin: false,
    sealedEra: false, opened: new Set(), before: [], cancelled: [], movedAt: null, movedDiffers: false, hidden: [], adminPerson: null, exports: [], exportFor: null,
    focus: null, profile: null, addFor: null, searchOpen: false, inviteOpen: null, kitOpen: false, tab: 'tree',
    editFor: null, deathFor: null, moveFor: null, lineFrom: null, spouseFor: null, spousePick: null, grantFor: null, marriageFor: null, kidsFor: null, milkFor: null, milkPick: null, mergeFor: null, mergeWith: null,
  });
}

async function open(b: Backend, fid: string | null) {
  backend = b;
  prefsKey = 'ft-prefs:' + (fid ?? 'sample');
  const prefs = loadPrefs(prefsKey);
  // a family opening says no more that an earlier one ended (unless this one ends too, as it opens)
  set({ ...prefs, status: 'loading', error: null, ended: null, kept: false, mode: b.kind, fid, isSample: b.kind === 'sample', relA: prefs.persona ?? prefs.me });
  try {
    // what this phone kept from its last read: with no connection, the family opens from it
    if (fid && b instanceof RemoteLog) void keepOnly(fid);
    const kept = b instanceof RemoteLog && (await b.restore());
    let online = true;
    try {
      await b.pull();
    } catch (e) {
      if (!kept || !unreachable(e)) throw e;
      online = false;
    }
    rebuild(true);
    // unless access had ended and the family was removed, or it cannot be read on here
    if (backend === b && state.status === 'loading') set({ status: 'ready', online, kept: !online });
    if (online) keepWriteKey();
  } catch (e) {
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Root admin: the server takes new entries only with the current family key's
 * write key. Registers it the first time this phone opens the family, and puts
 * it back if it no longer matches (the next sync shows the entry). A renewal
 * under way (one that fell due as the family opened) names the new key's write
 * key itself, so this waits for it rather than racing it.
 */
function keepWriteKey() {
  const b = backend;
  if (!(b instanceof RemoteLog) || !state.rootAdmin || state.status !== 'ready') return;
  void (renewing ?? Promise.resolve())
    .then(() => (backend === b ? b.ensureWriteKey() : false))
    .catch(() => {});
}

/** Fetches new entries from the server; called on a timer and after every write. */
export async function sync() {
  if (!backend || backend.kind !== 'remote' || state.status !== 'ready') return;
  try {
    const changed = await backend.pull();
    // also anything fetched while writing without a rebuild after (a renewal that was not needed after all)
    if (changed || backend.items !== built) rebuild();
    else {
      // nothing new, but a renewal may have fallen due a moment ago, or adding this phone may not have gone out
      const r = replayOf(backend);
      if (r) renewIfDue(r);
      if (state.claim?.kind === 'kit') registerKit(state.claim.person);
    }
    if (!state.online || state.kept) set({ online: true, kept: false });
    keepWriteKey();
  } catch {
    if (state.online) set({ online: false });
  }
}

export function joinFamily(link: string): boolean {
  const kit = restoreBlob(link);
  if (kit) {
    set({ restore: kit, ended: null });
    return true;
  }
  const m = parseInvite(link);
  if (!m) return false;
  set({ ended: null });
  rememberMembership(m);
  // with any key versions this device already holds for this family
  void open(remoteLog(membership() ?? m), m.fid);
  return true;
}

export function trySample() {
  localStorage.setItem('ft-mode', 'sample');
  void open(new SampleLog(), null);
}

export function leaveFamily() {
  if (state.fid) void dropLog(state.fid);
  rememberMembership(null);
  localStorage.removeItem('ft-mode');
  backend = null;
  set({ status: 'none', mode: null, fid: null, focus: null, profile: null, tab: 'tree' });
}

export function currentMembership(): Membership | null {
  return backend instanceof RemoteLog ? backend.m : null;
}

/** The family log exactly as the server stores it (sealed), for the root admin to keep elsewhere (core/backupfile.ts). */
export function logBackup(): { name: string; text: string; count: number } | null {
  if (!(backend instanceof RemoteLog) || !backend.envelopes.length) return null;
  const now = new Date();
  return { name: `family-log-${now.toLocaleDateString('en-CA')}.json`, text: backupText(backend.m.fid, backend.envelopes, now), count: backend.envelopes.length };
}

export function serverView() {
  return backend instanceof RemoteLog ? backend.envelopes.slice(-4).reverse() : [];
}

/** Entries in the family log that count (not ones sealed with a key that was not in force). */
export function logSize(): number {
  if (!(backend instanceof RemoteLog)) return backend?.items.length ?? 0;
  return replayOf(backend)?.entries ?? 0;
}

// start: with the Face ID lock on, nothing opens until it is unlocked (Lock.tsx);
// then an invite in the address, a remembered family, or the sample. A recovery
// link in the address asks for its passphrase first.
let startLink = location.hash;
if (/(?:join|restore)=/.test(startLink)) history.replaceState(null, '', location.pathname); // keys must not linger in the address bar
{
  const kit = restoreBlob(startLink);
  if (kit) set({ restore: kit });
  else if (!isLocked()) void startFamily();
}

/** Opens this device's family, once its keys can be read. */
export async function startFamily() {
  const m = membership(startLink);
  startLink = '';
  set({ status: 'none', lock: lockOn() });
  if (m) await open(remoteLog(m), m.fid);
  else if (localStorage.getItem('ft-mode') === 'sample') await open(new SampleLog(), null);
}
// back online: fetch what is new at once
addEventListener('online', () => void sync());
setInterval(() => {
  if (!document.hidden) void sync();
}, 3000);

// ---- who is looking, and what they may see

/** The person whose eyes we are looking through. */
export function viewer(s: State = state): string | null {
  return s.persona ?? s.me;
}

/** Women's details follow the kinship-degree rule: within the family's limit (the 3rd degree unless changed), or seen by everyone. */
export function canSee(s: State, id: string): boolean {
  const n = s.graph.nodes.get(id);
  if (!n) return false;
  // switching the rule off is a demo comparison, so only the sample family honours it
  if ((s.isSample && !s.settings.privacy) || n.sex === 'm' || n.familyRoot) return true;
  // after the move to per-person keys: only with her key
  if (n.sealed && !s.opened.has(id)) return false;
  const v = viewer(s);
  if (v && v === id) return true;
  // opened with no connection: the male line and the family's structure only (women's details show only online)
  if (s.kept) return false;
  // the family's degree, or hers when she has widened it; anyone she names
  const own = s.own.get(id);
  const lim = reachOf(s.reach, own);
  if (s.seesAll || lim === null) return true;
  if (!v) return false;
  if (own?.people.includes(v)) return true;
  const k = kin(s.graph, v, id);
  return !!k && k.deg <= lim;
}

/** The degree a woman's details reach (null: everyone): the family's, or hers when wider. */
export function reachFor(s: State, id: string): number | null {
  return reachOf(s.reach, s.own.get(id));
}

/**
 * Whether this phone may set how far her details are seen: her own phone; for a
 * woman with no phone in the family, her close relatives (1st or 2nd degree) or
 * a gold of her branch; the root admin and the platinum holder always. As the
 * replay checks it.
 */
export function mayWiden(s: State, woman: string): boolean {
  const n = s.graph.nodes.get(woman);
  if (!isWoman(n) || s.isSample || s.guest || isMinorViewer(s)) return false;
  if (canGrantAccess(s)) return true;
  const v = viewer(s);
  if (!v) return false;
  if (v === woman) return true;
  if ([...s.devices.values()].includes(woman)) return false;
  const k = kin(s.graph, v, woman);
  return (!!k && k.deg <= 2) || s.seats.some(x => x.tier === 'gold' && x.holder === v && x.branch === branchOf(s.graph, woman));
}

// ---- exporting the tree (src/export)

const CODE_LETTERS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** A new export's code: eight letters and digits that cannot be mistaken for one another (core/wellformed.ts, CODE). */
function newCode(): string {
  const c = [...crypto.getRandomValues(new Uint8Array(8))].map(x => CODE_LETTERS[x % CODE_LETTERS.length]).join('');
  return c.slice(0, 4) + '-' + c.slice(4);
}

/**
 * Records an export in the log before its file is made, and gives the code to
 * print on it. Online only: no file leaves the phone without its record.
 */
export async function recordExport(what: ExportWhat): Promise<string> {
  if (!(backend instanceof RemoteLog)) throw new Error('عائلة حقيقية فقط');
  if (!state.online) throw new Error('التصدير يحتاج اتصالًا بالإنترنت');
  const code = newCode();
  if (!(await backend.append({ type: 'export', code, by: viewer() ?? null, what }, state.rootAdmin ? 'admin' : undefined))) throw new Error('لم يُحفظ سجل التصدير');
  rebuild();
  return code;
}

/** Sets how far her details are seen; the root admin's phone then hands her key to whoever it now reaches. */
export async function widen(woman: string, own: Own, done: string): Promise<boolean> {
  if (!backend || !mayWiden(state, woman)) return false;
  try {
    await backend.append({ type: 'widen', person: woman, own, by: viewer() ?? '' }, state.rootAdmin ? 'admin' : undefined);
    rebuild();
    toast(done);
    return true;
  } catch (e) {
    toast('تعذّر الحفظ: ' + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

export function nameOf(s: State, id: string): string {
  const n = s.graph.nodes.get(id);
  if (!n) return '؟';
  return canSee(s, id) ? shownName(n) : n.parent ? 'ابنة' : n.external && s.graph.marriages.some(m => m.wife === id) ? 'زوجة' : 'امرأة';
}

/** A woman's name from her sealed record (one not in the tree, such as a daughter a request would add), where this phone holds her key. */
export function sealedName(p: Person | undefined): string | null {
  if (!p?.sealed) return null;
  const k = heldKey(p.id, p.sealed);
  const d = k ? openDetails(k, p.sealed) : null;
  return d ? shownName({ ...p, ...d }) : null;
}

/** A name that a chain of names follows: a compound name in brackets («(محمد سعيد) بن علي»). */
export function unitOf(s: State, id: string): string {
  const n = s.graph.nodes.get(id);
  return n && canSee(s, id) ? unit(n) : nameOf(s, id);
}

// ---- proposing and approving changes: each is a signed entry in the log

async function write(p: Payload, done: string | null): Promise<boolean> {
  if (!backend) return false;
  try {
    await backend.append(p);
    rebuild();
    if (done) toast(done);
    return true;
  } catch (e) {
    toast('تعذّر الحفظ: ' + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

/** Under 18: sees the tree, but sends no requests and approves nothing. The root admin's own phone is never limited. */
export function isMinorViewer(s: State = state): boolean {
  return !(s.rootAdmin && !s.isSample) && isMinor(s.graph, viewer(s));
}
export const MINOR_NOTE = 'التعديل والطلبات متاحة من سن 18';

/** Whether this phone may send requests about this person: the family's limit on requests (the root admin edits directly). */
export function canAsk(s: State, id: string): boolean {
  if (s.rootAdmin && !s.isSample) return true;
  const v = viewer(s);
  return !v || asksAbout(s.graph, s.seats, s.asks, v, id);
}

/** Whether this phone may send a request with these changes (an undo, say). */
export function canAskOps(s: State, ops: Op[]): boolean {
  if (s.rootAdmin && !s.isSample) return true;
  const v = viewer(s);
  return !v || mayAsk(s.graph, s.seats, s.asks, v, ops);
}

/** Why a request cannot be sent, under the family's limit. */
export function asksNote(s: State = state): string {
  return s.asks === 0 ? 'لا يرسل الأفراد طلبات الآن' : `الطلبات عن الأقارب حتى الدرجة ${degreeWord(s.asks ?? 0)} فقط`;
}

export function propose(opts: Change, done = 'أُرسل الطلب للاعتماد') {
  if (state.guest) {
    toast('دعوتك للمشاهدة فقط');
    return null;
  }
  if (isMinorViewer()) {
    toast(MINOR_NOTE);
    return null;
  }
  const by = viewer();
  if (!by) {
    toast('اختر من تكون من تبويب «أنا» أولًا');
    return null;
  }
  if (!mayAsk(state.graph, state.seats, state.asks, by, opts.ops)) {
    toast(asksNote());
    return null;
  }
  // once the family uses per-person keys: women's details sealed, their names in the title marked
  let fresh: Map<string, Uint8Array>;
  let women: string[];
  try {
    ({ opts, fresh, women } = sealChange(opts));
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
    return null;
  }
  // the level and branch every phone will work out from the changes
  const { level, branch } = assess(state.graph, opts.ops, id => state.linked.has(id), state.seats);
  const tx: Tx = {
    id: newId('tx'),
    at: Date.now(),
    by,
    title: opts.title,
    subject: opts.subject,
    level,
    branch,
    ops: opts.ops,
    status: 'pending',
    approvals: [],
    revertOf: opts.revertOf,
  };
  // a key that may approve the request approves it as it is sent: what the
  // sender's own key covers waits for no one (and reaches no one else)
  const own = canApprove(state.graph, state.seats, by, tx);
  if (!own.ok) {
    void write({ type: 'propose', tx }, done).then(sent => (sent ? handOverFresh(fresh, tx, women) : undefined));
    return tx;
  }
  const complete = isComplete(state.graph, state.seats, { ...tx, approvals: [{ by, at: tx.at, override: own.override }] });
  void write({ type: 'propose', tx }, null).then(
    async sent =>
      sent &&
      (await handOverFresh(fresh, tx, women),
      write({ type: 'approve', txId: tx.id, by, override: own.override }, complete ? 'اعتُمد بمفتاحك وحُفظ في السجل' : 'أُرسل الطلب ومعه اعتمادك، وينتظر بقية المعتمدين')),
  );
  return tx;
}

/**
 * What this phone's own key does to a request it would send about `subject`:
 * approves it outright ('done'), gives one of the approvals it needs ('one'),
 * or nothing (null: no key, or not one that covers it).
 */
export function ownKey(s: State, subject: string, level: Level): 'done' | 'one' | null {
  const by = viewer(s);
  if (!by || (s.rootAdmin && !s.isSample)) return null;
  const tx: Tx = { id: '', at: 0, by, title: '', subject, level, branch: branchOf(s.graph, subject), ops: [], status: 'pending', approvals: [] };
  const c = canApprove(s.graph, s.seats, by, tx);
  if (!c.ok) return null;
  return isComplete(s.graph, s.seats, { ...tx, approvals: [{ by, at: 0, override: c.override }] }) ? 'done' : 'one';
}

/** The root admin decides a request alone, at once: while the keys are being handed out, nobody else could. */
export function decides(s: State = state): boolean {
  return s.rootAdmin && !s.isSample;
}

export function approve(txId: string) {
  if (decides()) return decide(txId, true);
  const v = viewer();
  const tx = state.txs.find(t => t.id === txId);
  if (!tx || !v) return;
  if (isMinorViewer()) return toast(MINOR_NOTE);
  const c = canApprove(state.graph, state.seats, v, tx);
  if (!c.ok) return toast(c.why ?? 'لا يمكنك اعتماد هذا الطلب');
  const next: Tx = { ...tx, approvals: [...tx.approvals, { by: v, at: Date.now(), override: c.override }] };
  const complete = isComplete(state.graph, state.seats, next);
  void write({ type: 'approve', txId, by: v, override: c.override }, complete ? 'اعتُمد الطلب وأُضيف إلى السجل' : 'سُجّل اعتمادك، والطلب ينتظر بقية المعتمدين');
}

export function reject(txId: string) {
  if (decides()) return decide(txId, false);
  const v = viewer();
  const tx = state.txs.find(t => t.id === txId);
  if (!tx || !v) return;
  if (isMinorViewer()) return toast(MINOR_NOTE);
  const c = canApprove(state.graph, state.seats, v, tx);
  if (!c.ok) return toast(c.why ?? 'لا يمكنك رفض هذا الطلب');
  void write({ type: 'reject', txId, by: v }, 'رُفض الطلب');
}

function decide(txId: string, ok: boolean) {
  const tx = state.txs.find(t => t.id === txId);
  if (!tx || tx.status !== 'pending') return;
  void adminWrite({ kind: 'decide', txId, ok }, ok ? 'اعتُمد الطلب وأُضيف إلى السجل' : 'رُفض الطلب');
}

/** Undoing is itself a new change that needs the same approvals (the root admin may undo directly). */
export function proposeRevert(txId: string) {
  const tx = state.txs.find(t => t.id === txId);
  if (!tx) return;
  const inverse: Op[] = [...tx.ops].reverse().map((op): Op => {
    if (op.op === 'addPerson') return { op: 'removePerson', person: op.person };
    if (op.op === 'removePerson') return { op: 'addPerson', person: op.person };
    if (op.op === 'updatePerson') return { op: 'updatePerson', id: op.id, before: op.after, after: op.before };
    if (op.op === 'addMarriage') return { op: 'removeMarriage', marriage: op.marriage };
    if (op.op === 'removeMarriage') return { op: 'addMarriage', marriage: op.marriage };
    if (op.op === 'updateMarriage') return { op: 'updateMarriage', id: op.id, before: op.after, after: op.before };
    if (op.op === 'addMilk') return { op: 'removeMilk', milk: op.milk };
    if (op.op === 'removeMilk') return { op: 'addMilk', milk: op.milk };
    return op;
  });
  const opts = { title: 'تراجع: ' + tx.title, subject: tx.subject, level: tx.level, ops: inverse, revertOf: tx.id };
  // undoing an addition can remove someone with a linked phone or an open invite: renew the key then
  if (!state.rootAdmin || state.isSample) return void propose(opts, 'أُرسل طلب التراجع للاعتماد');
  void adminEdit(opts, 'تم التراجع').then(ok => {
    if (ok) void renewAfter('تم التراجع');
  });
}

/** `reveal`: hidden marriages this change puts into the tree (data/hidden.ts); any other is kept out of it. */
type Change = { title: string; subject: string; level: Level; ops: Op[]; revertOf?: string; reveal?: string[] };

/** The root admin's change takes effect at once; anyone else's is a request for approval. */
export function change(opts: Change, done?: string): Tx | true | null {
  if (state.rootAdmin && !state.isSample) {
    void adminEdit(opts, done);
    return true;
  }
  return propose(opts);
}

/**
 * A new child. `other` is the other parent when recorded: one of a man's wives,
 * or a woman's husband. The child sits under the father in the tree, or under
 * the mother when the father is from outside the family (or not recorded).
 */
export function addChildTx(parent: string, child: Omit<Person, 'id'>, direct = false, other: string | null = null, also: Op[] = []) {
  const g = state.graph;
  const p = g.nodes.get(parent)!;
  const o = other ? g.nodes.get(other) : undefined;
  const [father, mother] = p.sex === 'm' ? [p, o] : [o, p];
  const person: Person = { ...child, id: newId('n') };
  if (father) person.father = father.id;
  if (mother) person.mother = mother.id;
  const word = child.sex === 'm' ? 'ابن' : 'ابنة';
  const fromFather = !!father && !father.external;
  const title = fromFather
    ? `إضافة ${word}: ${unit(child)} ${child.sex === 'f' ? 'بنت' : 'بن'} ${unit(father)}`
    : `إضافة ${word}: ${father && !typedInFull(child.name) ? `${unit(child)} ${child.sex === 'f' ? 'بنت' : 'بن'} ${unit(father)}` : shownName(child)} · ${mother?.name ?? p.name}`;
  // a child of a hidden marriage cannot be added on its own: one request reveals the marriage with it
  const h = father && mother ? hiddenWith(state, father.id, mother.id) : undefined;
  const opts: Change = h
    ? { title: title + ' · وإعلان زواج أبويه', subject: father!.id, level: 'sensitive', ops: [...revealOps(h), { op: 'addPerson', person }, ...also], reveal: [h.id] }
    : { title, subject: fromFather ? father.id : (mother ?? p).id, level: 'everyday', ops: [{ op: 'addPerson', person }, ...also] };
  if (direct) {
    void adminEdit(opts);
    return person;
  }
  return propose(opts);
}

/**
 * Root admin, while setting up: a change that takes effect at once, without
 * approvals (e.g. filling in a branch that has no key holders yet). It is
 * signed, kept in the record like any other, and can be reverted.
 */
export async function adminEdit(opts: Change, done = 'أُضيف إلى الشجرة'): Promise<boolean> {
  let fresh: Map<string, Uint8Array>;
  try {
    ({ opts, fresh } = sealChange(opts));
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
    return false;
  }
  const tx: Tx = {
    id: newId('tx'), at: Date.now(), by: state.me ?? '', title: opts.title, subject: opts.subject, level: opts.level,
    branch: branchOf(state.graph, opts.subject), ops: opts.ops, status: 'approved', approvals: [], revertOf: opts.revertOf,
  };
  const ok = await adminWrite({ kind: 'edit', tx }, done);
  if (ok) await handOverFresh(fresh, null);
  return ok;
}

// ---- women's details, once the family uses per-person keys (core/personkeys.ts, data/snapshot.ts)

/** The structure as every phone holds it: the replay's tree, before any woman's details are opened. */
function structureGraph(): Graph | null {
  return backend ? (replayOf(backend)?.graph ?? null) : null;
}

/** A woman's key as this phone holds it (checked against her seal when she has one). */
function heldKey(id: string, sealed?: Person['sealed']): Uint8Array | null {
  const k = backend instanceof RemoteLog ? backend.pkeys.get(id) : undefined;
  if (!k) return null;
  if (sealed) return keyFor(sealed, k);
  try {
    const u = unb64(k);
    return u.length === 32 ? u : null;
  } catch {
    return null;
  }
}

/**
 * A change as it goes into the log once the family uses per-person keys: every
 * woman's details sealed with her key (a new woman's key is made here, to hand
 * out), and her names in its title turned into marks only her readers fill in.
 */
function sealChange<T extends { title: string; ops: Op[]; subject: string; reveal?: string[] }>(opts: T): { opts: T; fresh: Map<string, Uint8Array>; women: string[] } {
  if (!state.sealedEra || !(backend instanceof RemoteLog)) return { opts, fresh: new Map(), women: [] };
  const sg = structureGraph();
  // a hidden marriage never goes into a change everyone reads, unless the change reveals it
  // (the tree this phone shows has it, so a death's widowhood or a removal would name it)
  const hid = new Set(state.hidden.map(h => h.id));
  const revealing = new Set(opts.reveal ?? []);
  const hiddenWives = new Set(state.hidden.filter(h => h.wife && !revealing.has(h.id)).map(h => h.wife!.id));
  const kept = opts.ops.filter(op => {
    const mid = op.op === 'updateMarriage' ? op.id : op.op === 'addMarriage' || op.op === 'removeMarriage' ? op.marriage.id : null;
    if (mid && hid.has(mid) && !revealing.has(mid) && !sg?.marriages.some(m => m.id === mid)) return false;
    return !((op.op === 'addPerson' || op.op === 'removePerson') && hiddenWives.has(op.person.id));
  });
  for (const op of kept) {
    const refs = op.op === 'addPerson' ? [op.person.mother, op.person.father] : op.op === 'updatePerson' ? [op.after.mother, op.after.father] : [];
    if (refs.some(x => x && hiddenWives.has(x))) throw new Error('زوجة من زواج مخفي: يُعلن الزواج مع إضافة الابن');
  }
  opts = { ...opts, ops: kept };
  const names = new Map<string, Set<string>>();
  const note = (id: string, p?: Partial<Person>) => {
    if (!p || !isWoman(p as Person)) return;
    const s = names.get(id) ?? new Set<string>();
    if (p.name) for (const x of [shownName(p as Person), unit(p as Person), p.name]) s.add(x);
    names.set(id, s);
  };
  const shown = (id: string) => (state.graph.nodes.has(id) ? personRecord(state.graph, id) : undefined);
  // every woman the change names: the one it is about, those it adds, changes or removes, their parents (a move
  // under a daughter of the family, a daughter's child), and a marriage's two
  const also = (...ids: (string | null | undefined)[]) => ids.forEach(id => id && note(id, shown(id)));
  also(opts.subject);
  for (const op of opts.ops) {
    if (op.op === 'addPerson' || op.op === 'removePerson') {
      note(op.person.id, op.person.name ? op.person : shown(op.person.id));
      also(op.person.father, op.person.mother);
    } else if (op.op === 'updatePerson') {
      note(op.id, shown(op.id));
      note(op.id, { ...shown(op.id), ...(op.before as Partial<Person>), name: op.before.name ?? shown(op.id)?.name });
      note(op.id, { ...shown(op.id), ...(op.after as Partial<Person>), name: op.after.name ?? shown(op.id)?.name });
      also(op.before.father, op.before.mother, op.after.father, op.after.mother, shown(op.id)?.father, shown(op.id)?.mother);
    } else if (op.op === 'addMilk' || op.op === 'removeMilk') {
      also(...milkPeople(op.milk));
    } else {
      const m = op.op === 'updateMarriage' ? state.graph.marriages.find(x => x.id === op.id) : op.marriage;
      if (m) also(m.husband, m.wife);
    }
  }
  const { ops, fresh } = sealOps(opts.ops, {
    structure: id => (sg?.nodes.has(id) ? personRecord(sg, id) : undefined),
    key: id => heldKey(id, sg?.nodes.get(id)?.sealed),
    details: id => (state.opened.has(id) ? detailsOf(personRecord(state.graph, id)) : null),
    marriage: id => sg?.marriages.find(m => m.id === id),
    years: id => {
      const m = state.graph.marriages.find(x => x.id === id);
      return m && (m.year || m.end) ? { ...(m.year ? { year: m.year } : {}), ...(m.end ? { end: m.end } : {}) } : null;
    },
  });
  for (const [id, k] of fresh) backend.rememberPersonKey(id, b64(k));
  const title = tokenTitle(opts.title, [...names].map(([id, s]) => ({ id, names: [...s] })));
  return { opts: { ...opts, ops, title }, fresh, women: [...names.keys()] };
}

/** Who may read whom, as the replay worked it out. */
function readershipOf(r: Replayed): Readership {
  return {
    adminPub: r.adminPub,
    reach: r.reach,
    viewAll: r.viewAll,
    devices: r.devices,
    invites: r.invites,
    guests: [...r.guests.filter(x => x.status === 'pending').map(x => x.key), ...r.guestDevices.keys()],
    own: r.own,
  };
}

/**
 * Hands out the keys of women this phone just added: to her relatives within
 * the family's reach (as the tree will be once the change counts), to the key
 * holders who may approve the request, to the root admin, and to this phone.
 * The key holders who may approve a request also get the keys of the other
 * women it names (`women`) that this phone holds, so they see whom it is about.
 */
async function handOverFresh(fresh: Map<string, Uint8Array>, tx: Tx | null, women: string[] = []) {
  if (!(backend instanceof RemoteLog) || (!fresh.size && !(tx && women.length))) return;
  const b = backend;
  const r = replayOf(b);
  if (!r) return;
  const pending = tx ? (r.txs.find(t => t.id === tx.id) ?? tx) : null;
  const sg = pending && pending.status === 'pending' ? buildGraph(applyTxs(structureData(r.graph), [{ ...pending, status: 'approved' }]), r.graph.branches) : r.graph;
  const ids = [...fresh.keys()];
  const readers = fresh.size ? readersOf(sg, readershipOf(r), ids) : new Map<string, Set<string>>();
  const all = new Set(ids);
  const keyOf = (id: string) => fresh.get(id) ?? heldKey(id, r.graph.nodes.get(id)?.sealed);
  const named = women.filter(id => !fresh.has(id) && keyOf(id));
  if (pending?.status === 'pending')
    for (const seat of r.seats) if (canApprove(r.graph, r.seats, seat.holder, pending).ok) for (const [d, p] of r.devices) if (p === seat.holder) readers.set(d, new Set([...all, ...named]));
  if (fresh.size) readers.set(device().pk, all);
  if (!readers.size) return;
  try {
    await b.append({ type: 'pkeys', to: handOut(keyOf, readers) }, state.rootAdmin ? 'admin' : undefined);
    rebuild();
  } catch (e) {
    toast('تعذّر تسليم مفتاحها: ' + (e instanceof Error ? e.message : String(e)));
  }
}

/**
 * The snapshot the move to per-person keys writes: the family as it stands
 * (this phone reads every woman's details: it is the root admin's), each woman
 * sealed with a new key of her own, and everything else every phone needs to
 * work on from here; each reader's women's keys sealed for them.
 */
function buildSnapshot(r: Replayed, cancelled: string[] = []): Snapshot {
  const g = r.graph;
  const keys = new Map<string, Uint8Array>();
  const people = [...g.nodes.keys()].map(id => {
    const p = personRecord(g, id);
    if (!isWoman(p)) return p;
    const k = newPersonKey();
    keys.set(id, k);
    return sealPerson(p, k);
  });
  const family: FamilyData = { family: g.family, root: g.root, people, marriages: g.marriages, ...(g.milk.length ? { milk: g.milk } : {}) };
  const sealedGraph = buildGraph(family, r.mains ?? undefined);
  const readers = readersOf(sealedGraph, readershipOf(r), [...keys.keys()]);
  return {
    v: 1,
    family,
    mains: r.mains,
    seats: r.seats,
    adminBy: r.adminBy,
    invites: r.invites,
    devices: [...r.deviceInfo.values()],
    ever: [...r.owners],
    guests: r.guests,
    viewAll: [...r.viewAll],
    reach: r.reach,
    reachSet: r.reachSet,
    asks: r.asks,
    asksSet: r.asksSet,
    holders: r.readers,
    // the version the cut makes: one after this (already counted once the cut is in the log)
    keyVersion: r.awaiting ? r.keyVersion : r.keyVersion + 1,
    cancelled,
    keys: handOut(id => keys.get(id) ?? null, readers),
    own: [...r.own],
  };
}

/**
 * Root admin, once: the move to per-person keys for women's details (design
 * document, Section 6). Invites still waiting are cancelled first (their links
 * carry the old key: they are made again after); then the family key is renewed
 * without carrying the earlier versions, and the snapshot is written under the
 * new one. Members who join later read only from here.
 */
let moving = false;
export async function moveToPersonKeys(): Promise<boolean> {
  const b = backend;
  if (!(b instanceof RemoteLog) || !state.rootAdmin || state.isSample || moving) return false;
  const r0 = replayOf(b);
  if (!r0 || r0.epoch || r0.awaiting) return false;
  if (r0.txs.some(t => t.status === 'pending')) {
    toast('احسم الطلبات المنتظرة أولًا');
    return false;
  }
  // nothing else renews the key or hands out keys while it runs
  moving = true;
  try {
    const cancelled = r0.invites.filter(x => x.status === 'pending').map(x => x.key);
    for (const key of cancelled) await b.append({ type: 'admin', act: { kind: 'revoke', key }, by: state.me }, 'admin');
    for (const gu of r0.guests.filter(x => x.status === 'pending')) await b.append({ type: 'access', act: { kind: 'end', key: gu.key }, by: state.me }, 'admin');
    const key = newFamilyKey();
    const kid = keyId(key);
    let snapshot: Snapshot | null = null;
    // built from the log exactly as it stands where the entry lands
    const wrote = await b.append(
      items => {
        const r = replayOf(b, items);
        if (!r || r.epoch || r.awaiting) return null;
        snapshot = buildSnapshot(r, cancelled);
        return { type: 'rekey', kid, ...wrapKey(key, r.readers), by: state.me, cut: true };
      },
      'admin',
      key,
    );
    if (!wrote || !snapshot) return false;
    b.remember(key);
    // only while the cut still waits for it: another of the root admin's pages may have finished it
    const epoch = snapshot;
    await b.append(items => (replayOf(b, items)?.awaiting ? { type: 'epoch', snapshot: epoch } : null), 'admin');
    rebuild();
    toast('انتقلت العائلة إلى مفاتيح النساء');
    return true;
  } catch (e) {
    toast('تعذّر الانتقال: ' + (e instanceof Error ? e.message : String(e)));
    return false;
  } finally {
    moving = false;
  }
}

/** Root admin: a move cut short after its renewal (the snapshot never went out): written now, from the family as it stood. */
let finishing = false;
async function finishMove() {
  const b = backend;
  // the move itself writes its snapshot: a sync while it uploads (seconds, at the
  // family's size) must not write a second one
  if (finishing || moving || !(b instanceof RemoteLog) || !state.rootAdmin) return;
  if (!replayOf(b)?.awaiting) return;
  finishing = true;
  try {
    // built from the log as it stands where the entry lands, so it is written once
    await b.append(items => {
      const r = replayOf(b, items);
      return r?.awaiting ? { type: 'epoch', snapshot: buildSnapshot(r) } : null;
    }, 'admin');
    rebuild();
  } catch {
    /* tried again at the next rebuild */
  } finally {
    finishing = false;
  }
}

/** The family as a tree's records: what a snapshot or a test change starts from. */
function structureData(g: Graph): FamilyData {
  return { family: g.family, root: g.root, people: [...g.nodes.keys()].map(id => personRecord(g, id)), marriages: g.marriages, ...(g.milk.length ? { milk: g.milk } : {}) };
}

/**
 * Root admin: hands each reader the women's keys they should hold and do not
 * yet (a member who joined, an invite made, a wider reach), from the keys this
 * phone holds. Runs whenever the family is rebuilt here, after the move.
 */
let handing = false;
async function handOutMissing() {
  const b = backend;
  if (handing || moving || !(b instanceof RemoteLog) || !state.rootAdmin || !state.online) return;
  const r = replayOf(b);
  if (!r?.epoch || r.awaiting) return;
  const women = [...r.graph.nodes.values()].filter(n => isWoman(n) && n.sealed).map(n => n.id);
  const missing = new Map<string, Set<string>>();
  for (const [reader, ids] of readersOf(r.graph, readershipOf(r), women)) {
    if (!canReceiveKey(reader)) continue;
    const got = r.given.get(reader);
    const need = [...ids].filter(id => !got?.has(id) && heldKey(id, r.graph.nodes.get(id)?.sealed));
    if (need.length) missing.set(reader, new Set(need));
  }
  if (!missing.size) return;
  handing = true;
  try {
    await b.append({ type: 'pkeys', to: handOut(id => heldKey(id, r.graph.nodes.get(id)?.sealed), missing) }, 'admin');
    rebuild();
  } catch {
    /* tried again at the next rebuild */
  } finally {
    handing = false;
  }
}

/**
 * Root admin, once: the years of marriages recorded before they were sealed
 * (version 1.29) go under each wife's key, in one change. They stay readable in
 * the move's snapshot to whoever holds the family key; what is shown, and every
 * change since, follows her key. And whenever a death made a widowhood without
 * its end year (sent from a phone without the wife's key), it puts in the year
 * of that death, sealed.
 */
let sealingYears = false;
async function sealMarriageYears() {
  const b = backend;
  if (sealingYears || moving || !(b instanceof RemoteLog) || !state.rootAdmin || !state.online || state.isSample) return;
  const r = replayOf(b);
  if (!r?.epoch || r.awaiting) return;
  const held = (m: Marriage) => !!heldKey(m.wife, r.graph.nodes.get(m.wife)?.sealed);
  const open = r.graph.marriages.filter(m => (m.year || m.end) && held(m));
  // the tree's marriages only (never a hidden one this phone approved), with their years as this phone reads them
  const shown = new Map(state.graph.marriages.map(m => [m.id, m]));
  const deathOf = (m: Marriage) => {
    const h = state.graph.nodes.get(m.husband), w = state.graph.nodes.get(m.wife);
    return h?.dead ? h.death : w?.dead ? w.death : undefined;
  };
  // only a widowhood a death made without its end year (its sender lacked her key), never one left without it on purpose;
  // one with years still in the clear is sealed first, and its end put in at the next rebuild
  const dropped = new Set(r.txs.filter(t => t.status === 'approved').flatMap(t => t.ops.flatMap(o => (o.op === 'updateMarriage' && o.after.status === 'widowed' && !('end' in o.after) && !('sealed' in o.after) ? [o.id] : []))));
  const widowed = r.graph.marriages.filter(m => dropped.has(m.id) && m.status === 'widowed' && !open.includes(m) && held(m) && shown.has(m.id) && !shown.get(m.id)!.end && deathOf(m));
  if (!open.length && !widowed.length) return;
  sealingYears = true;
  try {
    const years = (m: Marriage) => ({ year: m.year ?? null, end: m.end ?? null });
    if (open.length)
      await adminEdit(
        { title: 'ختم سنوات الزواج بمفاتيح الزوجات', subject: r.graph.root, level: 'everyday', ops: open.map(m => ({ op: 'updateMarriage' as const, id: m.id, before: years(m), after: years(m) })) },
        'خُتمت سنوات الزواج بمفاتيح الزوجات',
      );
    if (widowed.length)
      await adminEdit(
        { title: 'سنة نهاية الترمّل', subject: r.graph.root, level: 'everyday', ops: widowed.map(m => ({ op: 'updateMarriage' as const, id: m.id, before: { end: null }, after: { end: deathOf(m)! } })) },
        'أُضيفت سنة نهاية الترمّل',
      );
  } finally {
    sealingYears = false;
  }
}

// ---- hidden marriages (data/hidden.ts)

/** Who gets a hidden marriage: the phones of the husband, the wife and its approver, and the root admin's key when the root admin approves it. */
function hiddenReaders(r: Replayed, m: Marriage, approver: string): string[] {
  const people = new Set([m.husband, m.wife, approver]);
  const out = [...r.devices].filter(([, p]) => people.has(p)).map(([d]) => d);
  if (approver === r.adminPerson) out.push(r.adminPub);
  return [...new Set(out)].filter(canReceiveKey);
}

/** Signed by this phone, as its owner. */
function wrapped(body: Private): Wrapped {
  const d = device();
  return { body, from: d.pk, sig: sign(d.sk, privateBytes(body)), to: [] };
}

/** One private entry: a box for each reader, in no order, saying nothing of whom it is for; signed with a key of its own. */
async function writePrivate(list: Wrapped[], readers: string[]) {
  if (!(backend instanceof RemoteLog)) throw new Error('عائلة حقيقية فقط');
  const content = list.map(w => ({ ...w, to: readers }));
  const boxes = readers.map(r => sealFor(r, content)).filter((x): x is NonNullable<typeof x> => !!x);
  for (let i = boxes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [boxes[i], boxes[j]] = [boxes[j], boxes[i]];
  }
  if (!boxes.length) throw new Error('لا هاتف يصله');
  await backend.append({ type: 'private', boxes }, newDeviceKey());
  rebuild();
}

/** Who this phone may ask to approve hiding its owner's marriage. */
export function hideApprovers(s: State = state): string[] {
  const me = viewer(s);
  return me && s.sealedEra && !s.isSample ? approversFor(s.graph, s.seats, s.adminPerson, me) : [];
}

/**
 * A man hides a marriage of his: a wife from the tree (by id) or from outside
 * (a name, a birth year), asked of one approver. Only the three of them will see it.
 */
export async function hideMarriage(wife: string | { name: string; birth?: Year | null }, rec: { year?: Year | null }, approver: string): Promise<boolean> {
  const me = viewer();
  const r = backend instanceof RemoteLog ? replayOf(backend) : null;
  if (!me || !r?.epoch || !hideApprovers().includes(approver)) {
    toast('لا يمكن إرسال هذا الطلب');
    return false;
  }
  const keys: Record<string, string> = {};
  let w: Person | undefined;
  let wifeId: string;
  if (typeof wife === 'string') {
    wifeId = wife;
    const k = heldKey(wife, r.graph.nodes.get(wife)?.sealed);
    if (k) keys[wife] = b64(k);
  } else {
    wifeId = newId('n');
    w = { id: wifeId, name: wife.name.trim(), sex: 'f', external: true, ...(wife.birth ? { birth: wife.birth } : {}) };
    // her key, made now: her details go into the tree with it when the marriage is revealed
    const k = newPersonKey();
    keys[wifeId] = b64(k);
    (backend as RemoteLog).rememberPersonKey(wifeId, b64(k));
  }
  const marriage: Marriage = { id: newId('m'), husband: me, wife: wifeId, status: 'married', ...(rec.year ? { year: rec.year } : {}) };
  const title = `زواج مخفي: ${shownName(state.graph.nodes.get(me)!)} و${w ? w.name : nameOf(state, wifeId)}`;
  const body: Private = { kind: 'hide', id: marriage.id, marriage, ...(w ? { wife: w } : {}), keys, approver, by: me, at: Date.now(), title };
  try {
    await writePrivate([wrapped(body)], hiddenReaders(r, marriage, approver));
    toast('أُرسل الطلب إلى ' + nameOf(state, approver) + ' وحده');
    return true;
  } catch (e) {
    toast('تعذّر الإرسال: ' + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

/** Its approver answers: approved, or refused. */
export async function decideHidden(id: string, ok: boolean): Promise<boolean> {
  const h = state.hidden.find(x => x.id === id);
  const me = viewer();
  const r = backend instanceof RemoteLog ? replayOf(backend) : null;
  if (!h || !r || h.status !== 'pending' || me !== h.approver) return false;
  try {
    await writePrivate([...h.wrapped, wrapped({ kind: 'decide', id, ok, by: me, at: Date.now() })], hiddenReaders(r, h.marriage, h.approver));
    toast(ok ? 'اعتُمد الزواج المخفي' : 'رُفض الطلب');
    return true;
  } catch (e) {
    toast('تعذّر الإرسال: ' + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

/**
 * The changes that put a hidden marriage into the tree: the wife from outside
 * with it, and the marriage itself under its own id. Its years are hers: they
 * go only from a phone that holds her key.
 */
function revealOps(h: Hidden, status?: Marriage['status'], end?: Year): Op[] {
  const sg = structureGraph();
  const ops: Op[] = [];
  if (h.wife && !sg?.nodes.has(h.wife.id)) ops.push({ op: 'addPerson', person: { ...h.wife } });
  const { hidden: _h, ...m } = h.marriage;
  const rec: Marriage = { ...m, ...(status ? { status } : {}), ...(end ? { end } : {}) };
  if (!heldKey(h.marriage.wife, sg?.nodes.get(h.marriage.wife)?.sealed)) {
    delete rec.year;
    delete rec.end;
  }
  ops.push({ op: 'addMarriage', marriage: rec });
  return ops;
}

/** The hidden marriage approved with this wife, for this husband, if this phone sees one. */
export function hiddenWith(s: State, husband: string, wife: string): Hidden | undefined {
  return s.hidden.find(h => h.status === 'approved' && h.marriage.husband === husband && h.marriage.wife === wife);
}

/** Reveals a hidden marriage, for good: an ordinary marriage of the tree from now on (a request, or the root admin's change). */
export function revealHidden(id: string, opts: { status?: Marriage['status']; end?: Year; also?: Op[]; title?: string } = {}) {
  const h = state.hidden.find(x => x.id === id);
  if (!h) return null;
  const ops = [...revealOps(h, opts.status, opts.end), ...(opts.also ?? [])];
  return change({ title: opts.title ?? h.title.replace('زواج مخفي', 'إعلان زواج'), subject: h.marriage.husband, level: 'sensitive', ops, reveal: [id] }, 'أُعلن الزواج');
}

/**
 * Kept by the readers' phones: a phone of theirs added since gets it (from the
 * first of husband, approver, wife who has a phone), and when the husband has
 * died his approver's phone reveals it, a widowhood.
 */
const tended = new Set<string>();
async function keepHidden(r: Replayed) {
  if (!(backend instanceof RemoteLog) || !state.online) return;
  const me = state.me;
  for (const h of r.hidden) {
    if (h.status === 'rejected') continue;
    const order = [h.marriage.husband, h.approver, h.marriage.wife].filter(p => [...r.devices.values()].includes(p));
    if (me && order[0] === me) {
      const missing = hiddenReaders(r, h.marriage, h.approver).filter(x => !h.to.has(x));
      const key = h.id + ':' + missing.join();
      if (missing.length && !tended.has(key)) {
        tended.add(key);
        await writePrivate(h.wrapped, missing).catch(() => tended.delete(key));
      }
    }
    const husband = r.graph.nodes.get(h.marriage.husband);
    const approverHere = me === h.approver || (state.rootAdmin && h.approver === r.adminPerson);
    if (h.status === 'approved' && husband?.dead && approverHere && !tended.has('death:' + h.id)) {
      // a request already out for it
      if (r.txs.some(t => t.status === 'pending' && t.ops.some(o => o.op === 'addMarriage' && o.marriage.id === h.id))) continue;
      tended.add('death:' + h.id);
      revealHidden(h.id, { status: 'widowed', end: state.graph.nodes.get(h.marriage.husband)?.death, title: h.title.replace('زواج مخفي', 'إعلان زواج بوفاة الزوج') });
    }
  }
}

/** A person's own record, without what the graph works out from it. */
export function recordOf(id: string): Person {
  return personRecord(state.graph, id);
}

/**
 * Change a person's details: the root admin directly, anyone else as a request
 * (e.g. aliases). `also`: anything that goes with it, such as a death's widowhood.
 */
export function editPerson(id: string, after: PersonPatch, opts: { title?: string; also?: Op[] } = {}) {
  const cur = recordOf(id) as unknown as Record<string, unknown>;
  const before: Record<string, unknown> = {};
  for (const k of Object.keys(after)) before[k] = cur[k] ?? null;
  const ops: Op[] = [{ op: 'updatePerson', id, before: before as PersonPatch, after }, ...(opts.also ?? [])];
  change({ title: opts.title ?? 'تعديل: ' + state.graph.nodes.get(id)!.name, subject: id, level: 'everyday', ops }, 'حُفظ التعديل');
}

/**
 * A death: the year if known (never the cause or the place), and the marriages
 * that were current become widowhood in that year, in one change. From anyone
 * but the root admin it is a request that two silvers of the branch approve (a
 * key holder's death needs more); undoing it needs the same.
 */
export function recordDeath(id: string, death: Year | null) {
  const g = state.graph;
  const n = g.nodes.get(id);
  if (!n || n.dead) return null;
  const cur = recordOf(id);
  const after: PersonPatch = { deceased: true, ...(death ? { death } : {}) };
  const before: PersonPatch = { deceased: cur.deceased ?? null, ...(death ? { death: cur.death ?? null } : {}) };
  const widowed: Op[] = g.marriages
    .filter(m => (m.husband === id || m.wife === id) && m.status === 'married')
    .map(m => ({ op: 'updateMarriage', id: m.id, before: { status: m.status, end: m.end ?? null }, after: { status: 'widowed', end: death } }));
  return change({ title: 'وفاة: ' + n.name, subject: id, level: 'death', ops: [{ op: 'updatePerson', id, before, after }, ...widowed] }, 'سُجّلت الوفاة');
}

/** Root admin: two records of one person become one, in a single change that can be undone. */
export async function mergePeople(keep: string, drop: string) {
  const why = mergeProblem(state, keep, drop);
  if (why) return toast(why);
  const a = state.graph.nodes.get(keep)!, b = state.graph.nodes.get(drop)!;
  const title = a.name === b.name ? 'دمج سجلين: ' + a.name : `دمج: ${b.name} في ${a.name}`;
  const ok = await adminEdit({ title, subject: keep, level: 'sensitive', ops: mergeOps(state.graph, keep, drop) }, 'دُمج السجلان');
  if (ok) set({ mergeFor: null, mergeWith: null, profile: keep, focus: state.focus === drop ? keep : state.focus });
}

/** Root admin: put a person under another father, or under a daughter of the family. */
export function movePerson(id: string, to: string) {
  const g = state.graph;
  for (let p: string | null = to; p; p = g.nodes.get(p)!.parent) {
    if (p === id) return toast('لا يمكن نقله تحت أحد أبنائه');
  }
  const n = g.nodes.get(id)!, t = g.nodes.get(to)!;
  const after: PersonPatch = t.sex === 'm' ? { father: to, mother: null } : { mother: to, father: null };
  const before: PersonPatch = { father: n.father ?? null, mother: n.mother ?? null };
  void adminEdit({ title: `نقل: ${n.name} تحت ${t.name}`, subject: id, level: 'everyday', ops: [{ op: 'updatePerson', id, before, after }] }, 'نُقل ' + n.name);
}

/** Root admin: remove a person, and their descendants with them if asked. */
/**
 * What removing someone takes: them and their descendants (children before
 * parents, so undoing adds parents back first), their marriages, a spouse from
 * outside married to no one else, and the links of children who stay.
 */
function removal(id: string): { ops: Op[]; title: string; subject: string } {
  const g = state.graph;
  const n = g.nodes.get(id)!;
  const order: string[] = [];
  const walk = (x: string) => {
    for (const k of g.nodes.get(x)!.kids) walk(k);
    order.push(x);
  };
  walk(id);
  // their marriages and milk records go with them, and so does someone from
  // outside (a spouse, a nurse) whom nothing else names (undoing brings them
  // back in the reverse order)
  const gone = new Set(order);
  const ms = g.marriages.filter(m => gone.has(m.husband) || gone.has(m.wife));
  const milks = g.milk.filter(m => milkPeople(m).some(x => gone.has(x)));
  const outside = [...new Set([...ms.flatMap(m => [m.husband, m.wife]), ...milks.flatMap(milkPeople)])].filter(
    x =>
      !gone.has(x) &&
      g.nodes.get(x)!.external &&
      g.marriages.every(m => ms.includes(m) || (m.husband !== x && m.wife !== x)) &&
      g.milk.every(m => milks.includes(m) || !milkPeople(m).includes(x)),
  );
  // children who stay (with their other parent) are no longer linked to one who goes
  const leaving = new Set([...order, ...outside]);
  const unlink: Op[] = [];
  for (const k of g.nodes.values()) {
    if (leaving.has(k.id)) continue;
    for (const f of ['father', 'mother'] as const) {
      const x = k[f];
      if (x && leaving.has(x)) unlink.push({ op: 'updatePerson', id: k.id, before: { [f]: x }, after: { [f]: null } });
    }
  }
  const ops: Op[] = [
    ...unlink,
    ...ms.map(marriage => ({ op: 'removeMarriage' as const, marriage })),
    ...milks.map(milk => ({ op: 'removeMilk' as const, milk })),
    ...[...outside, ...order].map(x => ({ op: 'removePerson' as const, person: recordOf(x) })),
  ];
  return { ops, title: 'حذف: ' + n.name + (order.length > 1 ? ` وذريته (${order.length - 1})` : ''), subject: n.parent ?? id };
}

export function deletePerson(id: string, withDescendants: boolean) {
  const n = state.graph.nodes.get(id)!;
  if (n.familyRoot) return toast('لا يُحذف الجد الجامع');
  if (n.kids.length && !withDescendants) return toast('له ذرية في الشجرة');
  const { ops, title, subject } = removal(id);
  // a linked phone or an open invite of someone removed holds the family key: renew it
  void adminEdit({ title, subject, level: 'everyday', ops }, 'حُذف من الشجرة').then(ok => {
    if (ok) void renewAfter('حُذف من الشجرة');
  });
  set({ profile: null, focus: null });
}

/**
 * Why this phone may not ask to remove someone (null: it may), design document
 * 1.32: never the founder, oneself, a key holder, or anyone with a phone or an
 * open invite in the family (those, the root admin alone); a woman only where
 * this phone opens her details.
 */
export function deleteProblem(s: State, id: string): string | null {
  const n = s.graph.nodes.get(id);
  const v = viewer(s);
  if (!n || n.familyRoot) return 'الجد الجامع لا يُحذف';
  if (s.guest || isMinorViewer(s) || !v) return 'للأفراد فقط';
  if (v === id) return 'لا يحذف أحد نفسه';
  if (!canSee(s, id) || !canAsk(s, id)) return 'خارج حدود طلباتك';
  const gone = new Set<string>();
  const walk = (x: string) => (gone.add(x), s.graph.nodes.get(x)!.kids.forEach(walk));
  walk(id);
  if (s.seats.some(x => gone.has(x.holder))) return 'فيهم من يحمل مفتاحًا: يحذفه مشرف العائلة';
  if ([...s.devices.values()].some(p => gone.has(p)) || s.invites.some(i => i.status === 'pending' && gone.has(i.person))) return 'فيهم من له هاتف أو دعوة في العائلة: يحذفه مشرف العائلة';
  return null;
}

/** The level a removal would need, as every phone will work it out, and whether this phone's own key covers it. */
export function deleteLevel(s: State, id: string): { level: Level; own: 'done' | 'one' | null } {
  const { ops } = removal(id);
  const level = assess(s.graph, ops, x => s.linked.has(x), s.seats).level;
  return { level, own: ownKey(s, id, level) };
}

/** A request to remove someone and their descendants, sent like any other: what the sender's own key covers is done at once. */
export function askDelete(id: string) {
  const why = deleteProblem(state, id);
  if (why) return toast(why);
  const { ops, title, subject } = removal(id);
  return propose({ title, subject, level: 'everyday', ops }, 'أُرسل طلب الحذف للاعتماد');
}

/**
 * Root admin: adds a line of fathers and sons below a person already in the
 * tree (e.g. علي → son → grandson → you), and can link this phone to the last.
 */
export async function addLine(from: string, rows: { name: string; birth?: Person['birth']; sex: Person['sex'] }[], isMe: boolean) {
  const people: Person[] = [];
  let father = from;
  for (const r of rows) {
    const person: Person = { id: newId('n'), name: r.name.trim(), sex: r.sex, father, ...(r.birth ? { birth: r.birth } : {}) };
    people.push(person);
    father = person.id;
  }
  const chain = [...people].reverse().map(p => p.name).join(' بن ') + ' بن ' + state.graph.nodes.get(from)!.name;
  const ok = await adminEdit({ title: 'إضافة سلسلة نسب: ' + chain, subject: from, level: 'everyday', ops: people.map(person => ({ op: 'addPerson' as const, person })) }, 'أُضيفت السلسلة إلى الشجرة');
  if (ok && isMe) linkSelf(people[people.length - 1].id);
  if (ok) set({ lineFrom: null, focus: people[people.length - 1].id, tab: 'tree' });
}

// ---- the root admin: main branches and key seats

async function adminWrite(act: AdminAct, done: string): Promise<boolean> {
  if (!backend || !state.rootAdmin) {
    toast('هذا لمشرف العائلة فقط');
    return false;
  }
  try {
    await backend.append({ type: 'admin', act, by: state.me }, 'admin');
    rebuild();
    toast(done);
    return true;
  } catch (e) {
    toast('تعذّر الحفظ: ' + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

// ---- personal invites

/**
 * With the Face ID lock on, a link that carries the family key is made or shown
 * only after Face ID again, as a recovery kit is: an unlocked phone someone
 * borrows cannot hand out lasting access. Callers ask before awaiting anything
 * else, so the browser still counts the tap.
 */
async function present(): Promise<boolean> {
  if (!lockOn()) return true;
  const r = await confirmPresence();
  if (r !== 'ok') toast(r === 'wrong' ? 'لم تطابق البصمة قفل هذا الهاتف، فلم يُعرض الرابط' : 'لم يكتمل التحقق بالبصمة، فلم يُعرض الرابط');
  return r === 'ok';
}

/** Shows a saved invite's link and QR code again (after Face ID, with the lock on). */
export async function openInvite(key: string) {
  if (await present()) set({ inviteOpen: key });
}

/**
 * Root admin: a new invite for one person. Its secret stays on this device to
 * share again. `asked`: Face ID was asked already (a new phone for someone).
 */
export async function createInvite(person: string, done = 'أُنشئت دعوة لـ ' + nameOf(state, person), asked = false) {
  const m = currentMembership();
  if (!m || (!asked && !(await present()))) return;
  const k = newDeviceKey();
  saveInvite(m.fid, k.pk, k.sk);
  if (await adminWrite({ kind: 'invite', person, key: k.pk }, done)) set({ inviteOpen: k.pk });
}

/**
 * Root admin: a member's phone was lost or replaced. Unlinks the old phone (it
 * forgets the family when it next opens), renews the family key so the old
 * phone can read nothing new, and makes a fresh invite for the same person,
 * whose code then opens on the new phone with the new key.
 */
export async function replaceDevice(person: string, oldDevice: string) {
  // the new invite's link comes at the end: Face ID first, while the tap still counts
  if (!(await present()) || !(await adminWrite({ kind: 'revoke', key: oldDevice }, 'فُصل الجهاز القديم'))) return;
  const renewed = await renewKey(true);
  await createInvite(person, 'فُصل الجهاز القديم' + (renewed ? ' وجُدّد مفتاح العائلة' : '') + '، وهذه دعوة جديدة لـ ' + nameOf(state, person), true);
}

export function inviteLinkFor(sk: string): string | null {
  const m = currentMembership();
  return m ? personalLink(m, sk) : null;
}

/** Cancels an unused invite, or unlinks a device; either held the family key, so it is renewed. */
export async function revokeKey(key: string, done = 'أُلغيت الدعوة') {
  if (await adminWrite({ kind: 'revoke', key }, done)) await renewAfter(done);
}

/** Root admin: unlinks several devices (or cancels invites) at once, then renews the family key once. */
export async function revokeKeys(keys: string[], done: string) {
  const b = backend;
  if (!b || !state.rootAdmin || !keys.length) return;
  try {
    for (const key of keys) await b.append({ type: 'admin', act: { kind: 'revoke', key }, by: state.me }, 'admin');
  } catch (e) {
    toast('تعذّر الحفظ: ' + (e instanceof Error ? e.message : String(e)));
  }
  rebuild();
  toast(done);
  await renewAfter(done);
}

/** Root admin: link this phone to the admin's own place in the tree. */
export function linkSelf(person: string) {
  void adminWrite({ kind: 'self', person, device: device().pk, label: deviceLabel() }, 'رُبط هذا الجهاز بـ ' + nameOf(state, person));
}

// ---- a person's own devices (أجهزتي): any of them adds, renames or removes the others

/** Writes a change to this person's devices, signed by this device; `act` may be built from the log where it lands. */
async function deviceWrite(act: DeviceAct | ((r: Replayed) => DeviceAct | null), done: string | null): Promise<boolean> {
  const b = backend;
  const by = state.me;
  if (!(b instanceof RemoteLog) || !by) return false;
  try {
    const wrote = await b.append(items => {
      if (typeof act !== 'function') return { type: 'device', act, by };
      const r = replayOf(b, items);
      const a = r && act(r);
      return a ? { type: 'device', act: a, by } : null;
    });
    if (backend === b) rebuild();
    if (wrote && done) toast(done);
    return wrote;
  } catch (e) {
    toast('تعذّر الحفظ: ' + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

/** A person's devices, oldest first. */
export function devicesOf(s: State, person: string): DeviceInfo[] {
  return [...s.deviceInfo.values()].filter(d => s.devices.get(d.key) === person);
}

/** Whether a person's own entries may add another device or invite (the replay refuses more). */
function hasRoom(r: Pick<Replayed, 'devices' | 'invites'>, person: string): boolean {
  const devices = [...r.devices.values()].filter(p => p === person).length;
  return devices + r.invites.filter(i => i.person === person && i.status === 'pending').length < MAX_DEVICES;
}
const TOO_MANY = 'لا يتسع لجهاز آخر: أزل جهازًا لا تستخدمه، أو ألغِ دعوة تنتظر';

/**
 * «إضافة جهاز»: a one-time invite for another phone or browser of this person,
 * whose link and code open at once. One this phone made that is still waiting
 * is shown again instead.
 */
export async function addDevice() {
  const m = currentMembership();
  const me = state.me;
  if (!m || !me || !(await present())) return;
  const saved = savedInvites(m.fid);
  const waiting = state.invites.find(i => i.status === 'pending' && i.person === me && saved[i.key]);
  if (waiting) return set({ inviteOpen: waiting.key });
  const mineWaiting = state.invites.filter(i => i.status === 'pending' && i.person === me && i.from).length;
  if (!hasRoom(state, me) || mineWaiting >= MAX_WAITING) return toast(TOO_MANY);
  const k = newDeviceKey();
  saveInvite(m.fid, k.pk, k.sk);
  if (!(await deviceWrite({ kind: 'invite', key: k.pk }, null))) return;
  if (state.invites.some(i => i.key === k.pk)) set({ inviteOpen: k.pk });
  else toast(TOO_MANY);
}

export function renameDevice(key: string, label: string) {
  return deviceWrite({ kind: 'label', device: key, label: label.trim().replace(/\s+/g, ' ') }, 'حُفظ اسم الجهاز');
}

/**
 * Removes some of this person's devices, or cancels their waiting invites.
 * Whatever is removed still holds the family key, so a renewal falls due: the
 * root admin's (or the platinum holder's) phone makes it when it next opens,
 * or this phone at once if it may.
 */
export async function removeMyDevices(keys: string[], done: string): Promise<boolean> {
  const ok = await deviceWrite({ kind: 'remove', keys }, done);
  if (ok && canGrantAccess()) await renewAfter(done);
  return ok;
}

/**
 * A recovery kit's own key, added to this person's devices as «مفتاح الاستعادة»;
 * `replace`: their earlier backup keys are removed (their kits stop working).
 */
export async function addBackupKey(k: DeviceKey, replace: boolean): Promise<boolean> {
  const me = state.me;
  if (!me) return false;
  const old = replace ? devicesOf(state, me).filter(d => d.backup).map(d => d.key) : [];
  await deviceWrite(r => (hasRoom(r, me) ? { kind: 'add', device: k.pk, label: BACKUP_LABEL, backup: true, proof: deviceProof(k.sk, r.adminPub, me, k.pk) } : null), null);
  if (state.devices.get(k.pk) !== me) return false;
  if (old.length) await removeMyDevices(old, 'أُبطل مفتاح الاستعادة السابق');
  return true;
}

/** Adding this phone with a recovery kit's backup key, while it is under way. */
let kitJoin: Promise<void> | null = null;
/** Why it cannot be added (the person has as many devices as allowed): it is not tried again until the kit is opened again. */
let kitStuck: string | null = null;

/** A phone restored from a recovery kit: the kit's backup key adds this phone's own key to the person's devices. */
function registerKit(person: string) {
  const b = backend;
  if (kitJoin || kitStuck || !(b instanceof RemoteLog) || !b.m.kit) return;
  const kit = deviceFromSecret(b.m.kit);
  const d = device();
  kitJoin = (async () => {
    try {
      await b.append(items => {
        const r = replayOf(b, items);
        if (!r || r.devices.get(kit.pk) !== person || r.devices.get(d.pk) === person) return null;
        if (!hasRoom(r, person) || r.devices.has(d.pk)) {
          kitStuck = TOO_MANY;
          return null;
        }
        return { type: 'device', act: { kind: 'add', device: d.pk, label: deviceLabel(), proof: deviceProof(d.sk, r.adminPub, person, d.pk) }, by: person };
      }, kit);
      // written but not counted: say so rather than write it again on every sync
      if (!kitStuck && replayOf(b)?.devices.get(d.pk) !== person && replayOf(b)?.devices.get(kit.pk) === person) kitStuck = TOO_MANY;
      if (backend === b) rebuild();
    } catch (e) {
      toast('تعذّر ربط هذا الجهاز: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      kitJoin = null;
    }
  })();
}

/** A kit opened again: adding this phone is tried again. */
export function kitAgain() {
  kitStuck = null;
}

/** Resolves once a phone restored from a kit has been added to the person's devices (or could not be). */
export async function kitJoined() {
  await kitJoin;
}

/**
 * A recovery kit, checked against the log before anything on this phone
 * changes (its device key, its family). 'ok': it brings the person's access
 * back here. 'here': this phone is already linked to that person (or is the
 * guest's, or holds the same admin key): there is nothing to restore, and
 * 'here-old' says the kit itself no longer works. 'ended': the kit's backup key
 * is no longer one of the person's devices (a newer kit replaced it, they
 * removed it, or the root admin did), or the guest's viewing ended. 'other':
 * this phone is linked to someone else in the family. Throws when the log
 * cannot be read (offline).
 */
export async function checkKit(kit: Kit): Promise<'ok' | 'here' | 'here-old' | 'ended' | 'other'> {
  const own = storedDevice();
  const probe: RemoteLog = new RemoteLog({ ...kit.m, ...(kit.b ? { kit: kit.b } : {}) }, items => replayOf(probe, items)?.kids.at(-1) ?? null, { device: own });
  await probe.pull();
  const r = replayOf(probe);
  if (!r) return 'ended';
  const admin = kit.m.admin ? deviceFromSecret(kit.m.admin).pk : null;
  const backup = kit.b ? deviceFromSecret(kit.b).pk : null;
  const inTree = (id: string | undefined): id is string => !!id && r.graph.nodes.has(id);
  // whose kit it is, and whether it still lets a phone in (the admin key always does)
  const person = backup ? r.owners.get(backup) : undefined;
  const works = admin === r.adminPub || (!r.cut && (backup ? inTree(r.devices.get(backup)) : !!kit.d && r.guestDevices.has(kit.d.pk)));
  if (own) {
    const linked = r.devices.get(own.pk);
    const sameAdmin = !!admin && membership('')?.admin === kit.m.admin;
    const same = sameAdmin || (inTree(linked) && linked === person) || (!!kit.d && kit.d.pk === own.pk);
    if (same) return works ? 'here' : 'here-old';
    if (inTree(linked) || r.guestDevices.has(own.pk)) return 'other';
  }
  return works ? 'ok' : 'ended';
}

// ---- view all: the root admin or the platinum key holder

export function canGrantAccess(s: State = state): boolean {
  return s.mode === 'remote' && (s.rootAdmin || (!!s.me && s.seats.some(x => x.tier === 'platinum' && x.holder === s.me)));
}

async function accessWrite(act: AccessAct, done: string): Promise<boolean> {
  return managerWrite({ type: 'access', act, by: state.me }, done);
}

/** An entry only the root admin, or the platinum holder's phone, may write. */
async function managerWrite(p: Extract<Payload, { type: 'access' | 'setting' }>, done: string): Promise<boolean> {
  if (!backend || !canGrantAccess()) {
    toast('هذا لمشرف العائلة أو حامل المفتاح البلاتيني');
    return false;
  }
  try {
    await backend.append(p, state.rootAdmin ? 'admin' : undefined);
    rebuild();
    toast(done);
    return true;
  } catch (e) {
    toast('تعذّر الحفظ: ' + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

export function setViewAll(person: string, on: boolean) {
  const name = nameOf(state, person);
  const f = state.graph.nodes.get(person)?.sex === 'f';
  return accessWrite({ kind: 'viewall', person, on }, on ? (f ? `أصبحت ${name} ترى الكل` : `أصبح ${name} يرى الكل`) : `أُوقفت مشاهدة الكل لـ ${name}`);
}

/** How far a woman's details are seen, for the whole family: within a degree (3 to 6), or by everyone (null). */
export function setReach(deg: number | null) {
  if (deg === state.reach) return;
  return managerWrite({ type: 'setting', act: { kind: 'reach', deg }, by: state.me }, deg === null ? 'صارت تفاصيل النساء ظاهرة للجميع' : 'صارت تفاصيل المرأة ظاهرة لأقاربها حتى الدرجة ' + degreeWord(deg));
}

/** About whom a member may send requests, for the whole family: relatives within a degree (1 to 6), no one (0), or anyone (null). */
export function setAsks(deg: number | null) {
  if (deg === state.asks) return;
  return managerWrite(
    { type: 'setting', act: { kind: 'asks', deg }, by: state.me },
    deg === null ? 'صار لكل فرد أن يطلب عن أي أحد' : deg === 0 ? 'لم يعد الأفراد يرسلون طلبات' : 'صارت الطلبات عن الأقارب حتى الدرجة ' + degreeWord(deg),
  );
}

/** A view-only invite for a guest; its secret stays on this device to share again. */
export async function createGuest(label: string) {
  const m = currentMembership();
  if (!m || !label.trim() || !(await present())) return;
  const k = newDeviceKey();
  saveInvite(m.fid, k.pk, k.sk);
  if (await accessWrite({ kind: 'guest', key: k.pk, label: label.trim() }, 'أُنشئت دعوة مشاهدة لـ ' + label.trim())) set({ inviteOpen: k.pk });
}

export async function endGuest(key: string) {
  if (await accessWrite({ kind: 'end', key }, 'أُنهيت المشاهدة')) await renewAfter('أُنهيت المشاهدة');
}

// ---- renewing the family key: the root admin or the platinum key holder

/**
 * A new family key, handed (sealed) to everyone who keeps access, so whoever
 * lost access cannot read anything written after it. `ifNeeded`: only when
 * someone who holds the current key has lost access since it was made.
 */
let renewing: Promise<boolean> | null = null;
export function renewKey(ifNeeded = false): Promise<boolean> {
  // one at a time: a renewal under way already answers «if needed»
  if (renewing) return ifNeeded ? renewing : renewing.then(() => renewKey());
  renewing = renew(ifNeeded).finally(() => (renewing = null));
  return renewing;
}

async function renew(ifNeeded: boolean): Promise<boolean> {
  const b = backend;
  if (!(b instanceof RemoteLog) || !canGrantAccess()) return false;
  const as = state.rootAdmin ? 'admin' : undefined;
  const key = newFamilyKey();
  const kid = keyId(key);
  try {
    // built from the log exactly as it stands where the entry lands
    const wrote = await b.append(items => {
      const r = replayOf(b, items);
      if (!r || (ifNeeded && !r.stale.length)) return null;
      return { type: 'rekey', kid, ...wrapKey(key, r.readers), by: state.me };
    }, as, key);
    if (!wrote) return false;
    b.remember(key);
    if (!replayOf(b)?.kids.includes(kid)) throw new Error('لم يُقبل التجديد');
    await carryKeys();
    rebuild();
    return true;
  } catch (e) {
    toast('تعذّر تجديد مفتاح العائلة: ' + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

async function renewAfter(done: string) {
  if (await renewKey(true)) toast(done + ' وجُدّد مفتاح العائلة');
}

/** How long a phone waits once it sees a renewal fall due, so the phone that removed someone (and renews right after) goes first. */
const RENEW_GRACE = 5000;
/** After a renewal that did not go out, when to try again. */
const RENEW_RETRY = 60000;
let due: { kid: string; at: number } | null = null;

/**
 * A renewal is due when someone who holds the current key has lost access (a
 * device removed by its owner, an undo approved through requests). The root
 * admin's phone, or the platinum holder's, makes it unasked: at once when it
 * opens, otherwise after a short wait. Two phones doing it at once is harmless:
 * the log takes one entry at a time, and the second finds nothing due.
 */
function renewIfDue(r: Replayed, opened = false) {
  if (!r.stale.length || r.cut || r.broken || moving || !canGrantAccess()) {
    due = null;
    return;
  }
  const kid = r.kids[r.kids.length - 1] ?? '';
  if (due?.kid !== kid) due = { kid, at: Date.now() + (opened ? 0 : RENEW_GRACE) };
  if (Date.now() < due.at || renewing) return;
  due.at = Date.now() + RENEW_RETRY;
  void renewKey(true);
}

/** Root admin: renew the key by hand. */
export async function renewKeyNow() {
  if (await renewKey()) toast('جُدّد مفتاح العائلة');
}

/** Every earlier key, sealed with the current one, for whoever joins with only the newest key in their link. */
let carrying = false;
async function carryKeys() {
  const b = backend;
  if (carrying || !(b instanceof RemoteLog)) return;
  carrying = true;
  try {
    await b.append(items => {
      const r = replayOf(b, items);
      const keys = r?.backfill ? b.keysOf(r.kids.slice(0, -1)) : {};
      return r?.backfill && Object.keys(keys).length === r.kids.length - 1 ? { type: 'keys', keys } : null;
    }, state.rootAdmin ? 'admin' : undefined);
  } catch {
    /* finished on a later sync */
  } finally {
    carrying = false;
  }
}

/** Joins with the personal invite this device opened. */
export async function claimInvite() {
  const m = currentMembership();
  if (!backend || !m?.invite) return;
  try {
    await backend.append({ type: 'claim', device: device().pk, label: deviceLabel() }, deviceFromSecret(m.invite));
    rebuild();
  } catch (e) {
    toast('تعذّر الانضمام: ' + (e instanceof Error ? e.message : String(e)));
  }
}

export function appoint(tier: Tier, branch: string | null, holder: string, replaces?: string) {
  const act: AdminAct = { kind: 'appoint', tier, branch, holder, ...(replaces ? { replaces } : {}) };
  const check = applySeatAct(state.graph, state.seats, act);
  if (typeof check === 'string') return toast(check);
  return adminWrite(act, 'سُلّم المفتاح لـ ' + nameOf(state, holder));
}

export function vacate(holder: string) {
  return adminWrite({ kind: 'vacate', holder }, 'أُخلي المقعد');
}

export function setMainBranches(ids: string[]) {
  const why = mainBranchProblem(state.graph, ids);
  if (why) return toast(why);
  void adminWrite({ kind: 'branches', ids }, 'حُدّثت الفروع الرئيسية');
}

/** Sample family only: forget the changes made in this browser. */
export function resetDemo() {
  if (backend?.kind !== 'sample') return;
  SampleLog.reset();
  void open(new SampleLog(), null);
  toast('أُعيدت البيانات التجريبية إلى أصلها');
}
