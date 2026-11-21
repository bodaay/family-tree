// What أنا → الأمان and the lock and restore screens do: the Face ID lock, the
// recovery kit, and bringing a person's access back on a new phone.
import { device, membership, restoreKeys, savedInvites } from './backend';
import { confirmPresence, disableLock, enableLock, forget, isLocked, lockOn, unlock, wipeSecrets, type LockResult } from './vault';
import { openKit, restoreLink, sealKit, type Kit } from './recovery';
import { addBackupKey, checkKit, getState, kitAgain, kitJoined, set, startFamily, toast } from './store';
import { newDeviceKey } from '../core/crypto.ts';

/** Face ID at the lock screen; the family opens once it succeeds. */
export async function unlockApp(): Promise<LockResult> {
  const r = await unlock();
  if (r === 'ok') void startFamily();
  return r;
}

export async function setLock(on: boolean): Promise<LockResult | 'again'> {
  const r = on ? await enableLock('شجرة ' + (getState().graph.family.name || 'العائلة')) : await disableLock();
  set({ lock: lockOn() });
  if (r === 'ok') toast(on ? 'فُعّل قفل البصمة' : 'أُوقف قفل البصمة');
  return r;
}

/** The way out at the lock screen when the passkey is gone: this phone forgets its keys. */
export function forgetThisPhone() {
  wipeSecrets();
  forget('ft-mode');
  set({ status: 'none', lock: false });
}

/**
 * A recovery kit for what this phone holds in its family, sealed with the
 * passphrase. A member's kit gets a backup key of its own, added to their
 * devices first (`replace`: their earlier backup keys are removed, so older
 * kits stop working). With the lock on, Face ID is asked again first, so a
 * borrowed phone cannot hand out its keys. 'failed': the backup key could not
 * be added (offline, or too many devices).
 */
export async function makeKit(pass: string, replace = true): Promise<string | LockResult | 'failed'> {
  const stored = membership('');
  if (!stored) return 'unsupported';
  if (lockOn()) {
    const ok = await confirmPresence();
    if (ok !== 'ok') return ok;
  }
  const { kit: _, ...m } = stored;
  void _;
  // the root admin's kit carries the invites still waiting, to share them again (used ones would only make
  // it longer). Nobody else's does: an invite outlives the backup key, so a leaked kit whose backup key was
  // removed would still let a new phone in with it, and receive every renewal after.
  const s = getState();
  const waiting = new Set([...s.invites, ...s.guests].filter(x => x.status === 'pending').map(x => x.key));
  const i = s.rootAdmin ? Object.fromEntries(Object.entries(savedInvites(m.fid)).filter(([pub]) => waiting.has(pub))) : {};
  const kit: Kit = { v: 2, m, i };
  if (s.guest) kit.d = device();
  else if (s.me) {
    const b = newDeviceKey();
    if (!(await addBackupKey(b, replace))) return 'failed';
    kit.b = b.sk;
  }
  return restoreLink(await sealKit(kit, pass));
}

/**
 * What restoring did: 'here' (and 'here-old', the kit no longer works): this
 * phone was linked to that person already, and kept as it was; 'ended': the
 * kit no longer works; 'other': this phone is someone else's in the family;
 * 'offline': the log could not be read to check the kit; 'cancel': the person
 * chose to keep what this phone holds.
 */
export type Restored = 'ok' | 'bad' | 'wrong' | 'here' | 'here-old' | 'ended' | 'other' | 'offline' | 'cancel';

/**
 * Opens the kit from the link with its passphrase, and this phone becomes that
 * person's again. Nothing on the phone changes until the log shows the kit
 * still works and the phone needs it; `replace` asks before a family or keys
 * this phone holds are replaced.
 */
export async function restoreAccess(pass: string, replace: () => boolean): Promise<Restored> {
  const blob = getState().restore;
  if (!blob) return 'bad';
  const kit = await openKit(blob, pass);
  if (typeof kit === 'string') return kit;
  let found: Awaited<ReturnType<typeof checkKit>>;
  try {
    found = await checkKit(kit);
  } catch {
    return 'offline';
  }
  if (found === 'ended' || found === 'other') return found;
  if (found !== 'ok') {
    // already linked here: the phone keeps its own key and family
    set({ restore: null, ended: null });
    await startFamily();
    const s = getState();
    const f = !!s.me && s.graph.nodes.get(s.me)?.sex === 'f';
    toast((f ? 'هذا الهاتف مرتبط بكِ أصلًا، ولم يتغير عليه شيء' : 'هذا الهاتف مرتبط بك أصلًا، ولم يتغير عليه شيء') + (found === 'here-old' ? '. ومفتاح الاستعادة هذا لم يعد يعمل.' : '.'));
    return found;
  }
  // restoring replaces what this phone holds now (another family, or keys behind a lock)
  if ((lockOn() || membership('')) && !replace()) return 'cancel';
  // keys locked behind a passkey that cannot be opened any more are replaced by the kit's
  if (isLocked()) wipeSecrets();
  // a member's phone gets a key of its own, which the kit's backup key adds to their devices
  restoreKeys(kit.b ? { ...kit.m, kit: kit.b } : kit.m, kit.d ?? null, kit.i ?? {});
  kitAgain();
  set({ restore: null, ended: null });
  await startFamily();
  await kitJoined();
  // only once the log agrees: a kit whose backup key was removed opens to «انتهى دخولك» instead
  const s = getState();
  if (s.status === 'ready' && (s.me || s.rootAdmin || s.guest)) toast('عاد دخولك إلى العائلة على هذا الهاتف');
  return 'ok';
}

export function cancelRestore() {
  set({ restore: null });
  if (isLocked()) set({ status: 'locked' });
  else if (getState().status === 'none') void startFamily();
}
