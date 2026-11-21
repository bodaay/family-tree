import { useEffect, useRef, useState } from 'preact/hooks';
import { set, openInvite, nameOf, canSee, canGrantAccess, appoint, vacate, setViewAll, createInvite, revokeKey, revokeKeys, replaceDevice, currentMembership, devicesOf, type State } from '../data/store';
import { savedInvites } from '../data/backend';
import { SEATS, TIER_AR, seatOf, seatProblem } from '../data/governance';
import type { Node } from '../data/graph';
import type { Seat, Tier } from '../data/types';
import { Icon } from './icons';
import { PersonRow, Seg, SeatBadge } from './common';
import { day } from './Devices';

const TIERS: Tier[] = ['platinum', 'gold', 'silver'];
const FULL: Record<number, string> = { 2: 'المقعدان مشغولان', 3: 'المقاعد الثلاثة مشغولة' };

let jumpTo: string | null = null;

/** Opens a person's profile at their permissions (from the keys and members screens). */
export function openPermissions(id: string) {
  jumpTo = id;
  set({ profile: id });
}

const isWoman = (s: State, id: string) => s.graph.nodes.get(id)?.sex === 'f';

// Taking a phone or an invite away, asked the same way on the members screen and
// on a profile. What is taken away held the family key, so each renews it once
// written (revokeKey, replaceDevice), as the confirmation says.

/** Unlinking a device also cancels the invites it made that nobody has opened yet: said when there are any. */
function madeBy(s: State, device: string): string {
  return s.invites.some(i => i.from === device && i.status === 'pending') ? '، وتُلغى الدعوات التي أنشأها ولم تُفتح' : '';
}

/** «جهاز جديد»: unlinks the person's phone, renews the family key and shows a fresh invite for them. */
export function askNewDevice(s: State, person: string, device: string) {
  const name = nameOf(s, person);
  const f = isWoman(s, person);
  if (!confirm(`جهاز جديد لـ ${name}؟ يُفصل ${f ? 'هاتفها' : 'هاتفه'} الحالي (فتُحذف منه بيانات العائلة عند فتحه${madeBy(s, device)}) ويُجدَّد مفتاح العائلة، وتُنشأ ${f ? 'لها دعوة جديدة تفتحها على هاتفها' : 'له دعوة جديدة يفتحها على هاتفه'} الجديد.`)) return;
  return replaceDevice(person, device);
}

export function askUnlink(s: State, person: string, device: string) {
  const f = isWoman(s, person);
  if (!confirm(`فصل جهاز ${nameOf(s, person)}؟ لن ${f ? 'تستطيع' : 'يستطيع'} الطلب أو الاعتماد منه، وتُحذف منه بيانات العائلة عند فتحه${madeBy(s, device)}، ويُجدَّد مفتاحها فلا يصله شيء جديد.`)) return;
  return revokeKey(device, 'فُصل الجهاز');
}

export function askCancelInvite(s: State, person: string, key: string) {
  if (!confirm(`إلغاء دعوة ${nameOf(s, person)}؟ يُجدَّد مفتاح العائلة فلا يفتح رابطها شيئًا جديدًا.`)) return;
  return revokeKey(key, 'أُلغيت الدعوة');
}

function askRemoveBackup(s: State, person: string, key: string) {
  if (!confirm(`إبطال مفتاح الاستعادة لـ ${nameOf(s, person)}؟ لن يفتح رابطه شيئًا بعد ذلك، ويُجدَّد مفتاح العائلة.`)) return;
  return revokeKey(key, 'أُبطل مفتاح الاستعادة');
}

/** Every phone, backup key and waiting invite of one person, in one step and one renewal. */
function askUnlinkAll(s: State, person: string, keys: string[]) {
  const name = nameOf(s, person);
  const f = isWoman(s, person);
  if (!confirm(`فصل كل أجهزة ${name}؟ لن ${f ? 'تستطيع' : 'يستطيع'} الطلب أو الاعتماد من أي منها، وتُحذف منها بيانات العائلة عند فتحها، ويُجدَّد مفتاح العائلة مرة واحدة.`)) return;
  return revokeKeys(keys, 'فُصلت كل أجهزة ' + name);
}

/** One key tier for this person: held, open, full (hand over from a holder) or not possible, and why. */
interface Option {
  tier: Tier;
  branch: string | null;
  state: 'held' | 'open' | 'full' | 'no';
  why?: string;
  /** Others holding this tier in the same place (the person's own seat moves with them). */
  holders: Seat[];
}

function optionFor(s: State, n: Node, tier: Tier): Option {
  const branch = tier === 'platinum' ? null : n.branch;
  const holders = s.seats.filter(x => x.tier === tier && x.branch === branch && x.holder !== n.id);
  const base = { tier, branch, holders };
  if (s.seats.some(x => x.holder === n.id && x.tier === tier && x.branch === branch)) return { ...base, state: 'held' };
  const why = seatProblem(s.graph, tier, branch, n.id);
  if (why) return { ...base, state: 'no', why: explain(why, tier, n) };
  return { ...base, state: holders.length >= SEATS[tier] ? 'full' : 'open' };
}

/** The seat rules' reason, said in full where it is short. */
function explain(why: string, tier: Tier, n: Node): string {
  if (n.dead) return 'المفاتيح للأحياء فقط';
  if (tier !== 'platinum' && !n.branch) return `${n.sex === 'f' ? 'ليست' : 'ليس'} من فرع رئيسي، والمفتاح ال${TIER_AR[tier]} لأفراد الفروع`;
  return why;
}

/**
 * A person's access in one place, on their profile: their key, their phone and
 * view all. The root admin manages all of it; the platinum key holder only view
 * all, as the rules allow. Every button here writes the same log entry as the
 * keys and members screens do.
 */
export function Permissions({ s, id }: { s: State; id: string }) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<Tier | null>(null);
  // one change at a time: a second tap while the first is still being saved does nothing
  // (a double tap on «دعوة» would otherwise make two invites)
  const busy = useRef(false);
  const run = async (f: () => unknown) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await f();
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    // arriving from the keys or members screen: scroll down to this section
    if (jumpTo !== id) return;
    jumpTo = null;
    const el = ref.current, page = el?.closest('.page');
    if (el && page) page.scrollTop += el.getBoundingClientRect().top - page.getBoundingClientRect().top - 16;
  }, [id]);
  useEffect(() => setOpen(null), [id]);

  const g = s.graph;
  const n = g.nodes.get(id);
  // a real family's root admin, or its platinum key holder; the sample family keeps its profile as it was.
  // A wife or husband from outside the family is not a member: no key, invite or view all.
  if (!n || n.familyRoot || n.external || !canGrantAccess(s) || !canSee(s, id)) return null;
  const admin = s.rootAdmin;
  const name = nameOf(s, id);
  const f = n.sex === 'f';
  const seat = seatOf(s.seats, id);
  const sees = s.viewAll.has(id);
  const invites = s.invites.filter(i => i.person === id);
  const pendings = invites.filter(i => i.status === 'pending');
  // a person may have several phones and browsers, and a recovery kit's backup key
  const devs = devicesOf(s, id);
  const phones = devs.filter(d => !d.backup);
  // linked with the admin key (the root admin's own phone), not by an invite
  const adminDevices = devs.filter(d => d.via === 'self');
  const thisAdmin = admin && s.me === id;
  // the deceased have nothing to manage, unless access is left to undo
  if (n.dead && !seat && !sees && !pendings.length && !devs.length) return null;
  const saved = savedInvites(currentMembership()?.fid ?? '');
  const where = (o: { tier: Tier; branch: string | null }) => (o.branch ? 'فرع ' + g.nodes.get(o.branch)!.name : o.tier === 'platinum' ? 'رأس العائلة' : '');
  const theKey = (t: Tier) => 'المفتاح ال' + TIER_AR[t];
  const freesOld = (t: Tier) => (seat && seat.tier !== t ? ` لا يحمل أحد مفتاحين، فيُخلى ${f ? 'مقعدها' : 'مقعده'} ال${TIER_AR[seat.tier]}.` : '');
  const isF = (x: string) => isWoman(s, x);

  const give = (o: Option) => {
    if (seat && !confirm(`تسليم ${name} ${theKey(o.tier)} (${where(o)})؟${freesOld(o.tier)}`)) return;
    return appoint(o.tier, o.branch, id);
  };
  const giveFrom = (o: Option, from: string) => {
    if (!confirm(`تسليم ${theKey(o.tier)} من ${nameOf(s, from)} إلى ${name}؟ يُخلى مقعد ${nameOf(s, from)}.${freesOld(o.tier)}`)) return;
    setOpen(null);
    return appoint(o.tier, o.branch, id, from);
  };
  const canInvite = !pendings.length && !phones.length && !n.dead;
  // another phone or browser for someone who has one already (or an invite waiting)
  const canAdd = !n.dead && !canInvite && (phones.length > 0 || pendings.length > 0);
  // no phone now: say whether they were never invited, their invite was cancelled, or their phone unlinked
  const last = invites[invites.length - 1];
  const noPhone = !last ? (f ? 'لم تُدعَ بعد' : 'لم يُدعَ بعد') : last.device ? (f ? 'فُصل جهازها' : 'فُصل جهازه') : f ? 'أُلغيت دعوتها' : 'أُلغيت دعوته';
  const joinedFrom = f ? 'انضمت من هاتفها' : 'انضم من هاتفه';
  const phone =
    phones.length > 1
      ? `${f ? 'انضمت' : 'انضم'} من ${phones.length === 2 ? 'جهازين' : phones.length + ' أجهزة'}`
      : phones.length === 1
        ? phones[0].via === 'self' ? 'هاتف مشرف العائلة' : joinedFrom
        : pendings.length
          ? 'دعوة بانتظار الانضمام'
          : devs.length
            ? 'مفتاح الاستعادة فقط'
            : n.dead ? '—' : noPhone;
  // what «فصل كل أجهزته» takes away (the root admin's own phone stays)
  const allKeys = [...devs.filter(d => d.via !== 'self').map(d => d.key), ...pendings.map(i => i.key)];
  const options = TIERS.map(t => optionFor(s, n, t));
  // one reason for every tier (e.g. deceased) is said once
  const noKey = options.every(o => o.state === 'no' && o.why === options[0].why) ? options[0].why : null;

  return (
    <section class="perms" ref={ref}>
      <h3>الصلاحيات</h3>
      <div class="card set permstat">
        <div class="srow">
          <span>المفتاح</span>
          {seat ? <SeatBadge s={s} id={id} /> : <b class="mut">بلا مفتاح</b>}
        </div>
        {admin && (
          <div class="srow">
            <span>
              الهاتف
              {adminDevices.length > 0 && <small>{thisAdmin ? 'أنت مشرف العائلة، وهذا الجهاز مرتبط بك' : 'مرتبط بجهاز مشرف العائلة'}</small>}
            </span>
            <b class={phones.length ? 'ok' : pendings.length ? 'warn' : 'mut'}>{phone}</b>
          </div>
        )}
        <div class="srow">
          <span>
            مشاهدة الكل
            <small>{sees ? `${f ? 'ترى' : 'يرى'} كل الأسماء، بما فيها ما تخفيه قاعدة الخصوصية` : `تنطبق ${f ? 'عليها' : 'عليه'} قاعدة الخصوصية كالعادة`}</small>
          </span>
          <Seg
            cls="viewall"
            value={sees ? 'on' : 'off'}
            options={[['on', 'مفعّلة'], ['off', 'موقوفة']]}
            onChange={x => {
              if ((x === 'on') === sees) return;
              if (x === 'on') void run(() => setViewAll(id, true));
              else if (confirm(`إيقاف مشاهدة الكل لـ ${name}؟`)) void run(() => setViewAll(id, false));
            }}
          />
        </div>
      </div>

      {admin && (
        <>
          <div class="permh">مفتاح القيادة</div>
          <div class="card list permkeys">
            {seat && (
              <>
                <button class="prow" onClick={() => set({ pickSeat: { tier: seat.tier, branch: seat.branch, replaces: id }, searchOpen: 'seat' })}>
                  <Icon name="swap" />
                  <span class="pt">
                    <b>تسليم المفتاح إلى…</b>
                    <small>اختر من يحمله بعد {name}، فينتقل إليه مباشرة</small>
                  </span>
                  <Icon name="chevL" size={16} />
                </button>
                <button
                  class="prow"
                  onClick={() => confirm(`سحب ${theKey(seat.tier)} من ${name}؟ يُخلى المقعد، ويمكن تسليمه لغيره لاحقًا.`) && run(() => vacate(id))}
                >
                  <Icon name="x" />
                  <span class="pt">
                    <b class="danger">سحب المفتاح</b>
                    <small>يبقى المقعد شاغرًا حتى يُسلَّم لغيره</small>
                  </span>
                </button>
              </>
            )}
            {noKey && (
              <div class="prow">
                <Icon name="lock" />
                <span class="pt">
                  <b>{f ? 'لا يمكن أن تحمل مفتاحًا' : 'لا يمكن أن يحمل مفتاحًا'}</b>
                  <small>{noKey}</small>
                </span>
              </div>
            )}
            {!noKey && options.map(o => {
              const t = o.tier;
              const status =
                o.state === 'held' ? (f ? 'تحمله الآن' : 'يحمله الآن')
                : o.state === 'no' ? o.why
                : o.state === 'full' ? (SEATS[t] === 1 ? (isF(o.holders[0].holder) ? 'تحمله ' : 'يحمله ') + nameOf(s, o.holders[0].holder) : FULL[SEATS[t]] ?? 'المقاعد مشغولة')
                : `شاغر ${SEATS[t] - o.holders.length} من ${SEATS[t]}`;
              return (
                <div class={'permtier ' + o.state}>
                  <div class="prow">
                    <span class={'key ' + t}>
                      <Icon name="key" size={13} /> {TIER_AR[t]}
                    </span>
                    <span class="pt">
                      <b>{where(o) || '—'}</b>
                      <small>{status}</small>
                    </span>
                    {o.state === 'held' && <Icon name="check" />}
                    {o.state === 'open' && (
                      <button class="btn small" aria-label={`منح ${theKey(t)}`} onClick={() => run(() => give(o))}>
                        منح
                      </button>
                    )}
                    {o.state === 'full' && (
                      <button class={'btn small' + (open === t ? ' on' : '')} aria-expanded={open === t} onClick={() => setOpen(open === t ? null : t)}>
                        تسليم بدلًا من…
                      </button>
                    )}
                  </div>
                  {o.state === 'full' && open === t && (
                    <div class="permfrom">
                      <p class="hint">
                        {SEATS[t] === 1 ? 'للمفتاح ال' + TIER_AR[t] + ' مقعد واحد.' : 'مقاعد هذا المفتاح ممتلئة.'} اختر من يسلّم مفتاحه إلى {name} في خطوة واحدة:
                      </p>
                      {o.holders.map(x => (
                        <PersonRow s={s} id={x.holder} onClick={() => run(() => giveFrom(o, x.holder))} right={<span class="btn small">{isF(x.holder) ? 'بدلًا منها' : 'بدلًا منه'}</span>} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {(devs.length > 0 || pendings.length > 0 || canInvite) && (
            <>
              <div class="permh">الدخول من الأجهزة</div>
              <div class="card list permphone">
                {devs.map(d =>
                  d.via === 'self' ? (
                    <div class="prow">
                      <Icon name="key" cls="okc" />
                      <span class="pt">
                        <b>هاتف مشرف العائلة</b>
                        <small>{(d.label ? d.label + ' · ' : '') + (thisAdmin ? 'هذا الجهاز مرتبط بك. لتغيير ذلك: أنا ← تغيير' : 'مرتبط بمفتاح المشرف، لا بدعوة')}</small>
                      </span>
                    </div>
                  ) : d.backup ? (
                    <div class="prow">
                      <Icon name="key" cls="okc" />
                      <span class="pt">
                        <b>مفتاح الاستعادة</b>
                        <small>
                          يعيد{f ? 'ها' : 'ه'} إلى العائلة على جهاز جديد · أُنشئ {day(d.at)}
                        </small>
                      </span>
                      <button class="btn small" onClick={() => run(() => askRemoveBackup(s, id, d.key))}>
                        إبطال
                      </button>
                    </div>
                  ) : (
                    <div class="prow two">
                      <Icon name="check" cls="okc" />
                      <span class="pt">
                        <b>{d.label ?? joinedFrom}</b>
                        <small>{(d.label ? joinedFrom + ' ' : '') + (d.via === 'add' ? 'بمفتاح الاستعادة' : 'بدعوة شخصية') + ' · ' + day(d.at)}</small>
                      </span>
                      {/* a lost or changed phone, as on the members screen: one step unlinks it, renews the key and
                          invites again (not for the deceased, who are not invited; their phone can still be unlinked) */}
                      <span class="permacts">
                        {!n.dead && (
                          <button class="btn small" onClick={() => run(() => askNewDevice(s, id, d.key))}>
                            جهاز جديد
                          </button>
                        )}
                        <button class="btn small" onClick={() => run(() => askUnlink(s, id, d.key))}>
                          فصل الجهاز
                        </button>
                      </span>
                    </div>
                  ),
                )}
                {pendings.map(p => (
                  // its buttons on their own line, as for a joined phone: the label and date keep the full width
                  <div class="prow two">
                    <Icon name="user" />
                    <span class="pt">
                      <b>دعوة بانتظار الانضمام</b>
                      <small>
                        {p.from
                          ? `${f ? 'أنشأتها من أحد أجهزتها' : 'أنشأها من أحد أجهزته'} · ${day(p.at)}`
                          : saved[p.key]
                            ? `أُنشئت ${day(p.at)} · تعمل مرة واحدة`
                            : 'رابطها محفوظ على الجهاز الذي أنشأها'}
                      </small>
                    </span>
                    <span class="permacts">
                      {saved[p.key] && (
                        <button class="btn small" onClick={() => void openInvite(p.key)}>
                          عرض الدعوة
                        </button>
                      )}
                      <button class="btn small iconbtn" aria-label="إلغاء الدعوة" onClick={() => run(() => askCancelInvite(s, id, p.key))}>
                        <Icon name="x" size={16} />
                      </button>
                    </span>
                  </div>
                ))}
                {canInvite && (
                  <button class="prow" onClick={() => run(() => createInvite(id))}>
                    <Icon name="plus" />
                    <span class="pt">
                      <b>دعوة</b>
                      <small>دعوة شخصية {f ? 'لها وحدها' : 'له وحده'}، تعمل مرة واحدة على هاتف واحد: أرسل الرابط أو الرمز</small>
                    </span>
                    <Icon name="chevL" size={16} />
                  </button>
                )}
                {canAdd && (
                  <button class="prow" onClick={() => run(() => createInvite(id, 'أُنشئت دعوة لجهاز إضافي لـ ' + name))}>
                    <Icon name="plus" />
                    <span class="pt">
                      <b>جهاز إضافي</b>
                      <small>
                        دعوة أخرى {f ? 'لها تفتحها على جهاز آخر فيُضاف إلى أجهزتها' : 'له يفتحها على جهاز آخر فيُضاف إلى أجهزته'}، دون فصل ما سبق. تعمل مرة واحدة.
                      </small>
                    </span>
                    <Icon name="chevL" size={16} />
                  </button>
                )}
                {allKeys.length > 1 && (
                  <button class="prow" onClick={() => run(() => askUnlinkAll(s, id, allKeys))}>
                    <Icon name="x" />
                    <span class="pt">
                      <b class="danger">{f ? 'فصل كل أجهزتها' : 'فصل كل أجهزته'}</b>
                      <small>
                        {devs.some(d => d.backup) ? 'الهواتف ومفتاح الاستعادة' : 'كل الهواتف'}
                        {pendings.length ? ' والدعوات المنتظرة' : ''}، ويُجدَّد مفتاح العائلة مرة واحدة
                      </small>
                    </span>
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
      <p class="hint">
        {admin
          ? 'كل تغيير هنا يُوقَّع بمفتاح المشرف ويُحفظ في سجل العائلة، كما لو أُجري من شاشة المفاتيح أو الأعضاء. فصل جهاز أو إلغاء دعوة يجدّد مفتاح العائلة تلقائيًا.'
          : 'بصفتك حامل المفتاح البلاتيني تمنح مشاهدة الكل أو توقفها. المفاتيح والدعوات لمشرف العائلة.'}
      </p>
    </section>
  );
}

