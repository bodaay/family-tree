import { useRef, useState } from 'preact/hooks';
import { openInvite, addDevice, renameDevice, removeMyDevices, devicesOf, currentMembership, type State } from '../data/store';
import { device, savedInvites } from '../data/backend';
import { deviceLabel, labelProblem, LABEL_MAX, type DeviceInfo } from '../data/devices';
import { seatOf, TIER_AR } from '../data/governance';
import { Icon } from './icons';

export function day(at: number): string {
  return new Date(at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn');
}

/** A device's name: what the log keeps, else (for devices linked before names were kept) this browser's own, or a plain word. */
export function deviceName(d: DeviceInfo): string {
  return d.label ?? (d.key === device().pk ? deviceLabel() : 'جهاز دون اسم');
}

/** How and when a device was added, in a few words. */
function added(d: DeviceInfo): string {
  if (d.backup) return 'يفتحه رابط الاستعادة مع عبارة المرور · أُنشئ ' + day(d.at);
  const how = d.via === 'invite' ? ' بدعوة شخصية' : d.via === 'add' ? ' بمفتاح الاستعادة' : ' برابط المشرف';
  return 'أُضيف ' + day(d.at) + how;
}

/**
 * أنا → أجهزتي: every phone or browser that acts as this person, and the
 * recovery kit's backup key. Each one can add another (a one-time invite),
 * rename or remove any of them. A key holder keeps at least one phone to
 * approve with; anyone else may remove them all, this phone included.
 */
export function MyDevices({ s }: { s: State }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [why, setWhy] = useState('');
  const [all, setAll] = useState(false);
  // one change at a time: a second tap while the first is being saved does nothing
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
  const me = s.me;
  if (!me) return null;
  const f = s.graph.nodes.get(me)?.sex === 'f';
  const here = device().pk;
  const list = devicesOf(s, me);
  const phones = list.filter(d => !d.backup);
  const seat = seatOf(s.seats, me);
  const saved = savedInvites(currentMembership()?.fid ?? '');
  const waiting = s.invites.filter(i => i.person === me && i.status === 'pending');
  const holds = f ? 'تحملين' : 'تحمل';
  const keepOne = seat
    ? `${holds} المفتاح ال${TIER_AR[seat.tier]}، فيبقى لك جهاز واحد على الأقل تعتمد${f ? 'ين' : ''} منه. لإزالة آخر أجهزتك سلّم${f ? 'ي' : ''} المفتاح أولًا، أو اطلب${f ? 'ي' : ''} ذلك من مشرف العائلة.`
    : '';

  const remove = (d: DeviceInfo) => {
    setWhy('');
    if (seat && !d.backup && !phones.some(x => x.key !== d.key)) return setWhy(keepOne);
    const name = deviceName(d);
    // the invites it made and nobody has opened yet go with it
    const made = waiting.some(i => i.from === d.key) ? '، وتُلغى الدعوات التي أنشأها ولم تُفتح' : '';
    const ask = d.backup
      ? 'إزالة مفتاح الاستعادة؟ لن يفتح رابطه شيئًا بعد ذلك، ويُجدَّد مفتاح العائلة.'
      : d.key === here && s.rootAdmin
        ? 'فصل هذا الجهاز عن اسمك؟ يبقى عليه مفتاح المشرف، ويمكنك ربطه من جديد من «أنا ← تغيير».'
        : d.key === here
        ? 'إزالة هذا الجهاز؟ تُحذف منه بيانات العائلة ومفتاحها الآن، ولا يعود إلا بدعوة جديدة أو بمفتاح الاستعادة.'
        : `إزالة «${name}»؟ تُحذف منه بيانات العائلة عند فتحه${made}، ويُجدَّد مفتاح العائلة فلا يصله شيء جديد.`;
    if (!confirm(ask)) return;
    return removeMyDevices([d.key], d.backup ? 'أُزيل مفتاح الاستعادة' : 'أُزيل الجهاز');
  };
  const save = (d: DeviceInfo) => {
    const p = labelProblem(draft);
    if (p) return setWhy(p);
    setEditing(null);
    setWhy('');
    if (draft.trim() !== d.label) return renameDevice(d.key, draft);
  };
  const removeAll = () => {
    if (!confirm(f ? 'هل أنتِ متأكدة؟ تُزال كل أجهزتك الآن، ولا تعودين إلا بدعوة جديدة.' : 'هل أنت متأكد؟ تُزال كل أجهزتك الآن، ولا تعود إلا بدعوة جديدة.')) return;
    setAll(false);
    return removeMyDevices([...list.map(d => d.key), ...waiting.map(i => i.key)], 'أُزيلت كل الأجهزة');
  };

  return (
    <section class="mydevs">
      <h3>أجهزتي</h3>
      <div class="card list devlist">
        {list.map(d =>
          editing === d.key ? (
            <div class="prow devedit">
              <input
                class="bigin"
                dir="auto"
                maxLength={LABEL_MAX}
                value={draft}
                aria-label="اسم الجهاز"
                onInput={e => { setDraft((e.target as HTMLInputElement).value); setWhy(''); }}
                onKeyDown={e => e.key === 'Enter' && void run(() => save(d))}
              />
              <button class="btn small primary" onClick={() => run(() => save(d))}>حفظ</button>
              <button class="btn small" onClick={() => { setEditing(null); setWhy(''); }}>إلغاء</button>
            </div>
          ) : (
            <div class={'prow two' + (d.key === here ? ' here' : '')}>
              <Icon name={d.backup ? 'key' : 'phone'} cls={d.key === here ? 'okc' : ''} />
              <span class="pt">
                <b>
                  {deviceName(d)} {d.key === here && <span class="tag here">هذا الجهاز</span>}
                </b>
                <small>{added(d)}</small>
              </span>
              <span class="permacts">
                {!d.backup && (
                  <button class="btn small" onClick={() => { setEditing(d.key); setDraft(d.label ?? deviceName(d)); setWhy(''); }}>
                    <Icon name="pen" size={16} /> تسمية
                  </button>
                )}
                <button class="btn small" onClick={() => run(() => remove(d))}>
                  إزالة
                </button>
              </span>
            </div>
          ),
        )}
        {waiting.map(i => (
          <div class="prow">
            <Icon name="plus" />
            <span class="pt">
              <b>دعوة جهاز بانتظار الفتح</b>
              <small>{(i.from ? 'من أحد أجهزتك' : 'من مشرف العائلة') + ' · ' + day(i.at) + ' · تعمل مرة واحدة'}</small>
            </span>
            {saved[i.key] && (
              <button class="btn small" onClick={() => void openInvite(i.key)}>
                عرض
              </button>
            )}
            <button
              class="btn small"
              aria-label="إلغاء الدعوة"
              onClick={() => run(() => confirm('إلغاء هذه الدعوة؟ يُجدَّد مفتاح العائلة فلا يفتح رابطها شيئًا جديدًا.') && removeMyDevices([i.key], 'أُلغيت الدعوة'))}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
      {why && <div class="warnbox">{why}</div>}
      {s.familyKey.mine && <p class="hint warn">سيُجدَّد مفتاح العائلة تلقائيًا عند فتح المشرف للتطبيق، فلا يصل شيء جديد إلى ما أُزيل.</p>}
      <button class="card cta" onClick={() => run(addDevice)}>
        <Icon name="plus" />
        <span>
          <b>إضافة جهاز</b>
          <small>
            {f
              ? 'هاتف آخر أو متصفح آخر باسمكِ: افتحي الرابط عليه أو صوّري الرمز بكاميرته. يعمل مرة واحدة.'
              : 'هاتف آخر أو متصفح آخر باسمك: افتح الرابط عليه أو صوّر الرمز بكاميرته. يعمل مرة واحدة.'}
          </small>
        </span>
      </button>
      {seat ? (
        <p class="hint">{keepOne}</p>
      ) : !all ? (
        <button class="btn small" onClick={() => setAll(true)}>
          <Icon name="x" size={16} /> إزالة كل الأجهزة
        </button>
      ) : (
        <div class="card removeall">
          <b class="danger">إزالة كل الأجهزة</b>
          <p>
            تُزال كل أجهزتك{list.some(d => d.backup) ? ' ومفتاح الاستعادة' : ''}، ومنها هذا الجهاز: تُحذف منها بيانات العائلة ومفتاحها، ويُجدَّد مفتاح العائلة. لا
            {f ? ' تعودين' : ' تعود'} بعدها إلا بدعوة جديدة من مشرف العائلة.
          </p>
          <button class="btn wide dangerbtn" onClick={() => run(removeAll)}>
            نعم، أزل كل أجهزتي
          </button>
          <button class="btn wide" onClick={() => setAll(false)}>
            تراجع
          </button>
        </div>
      )}
      <p class="hint">كل جهاز هنا يطلب ويعتمد باسمك. أسماؤها وتواريخها محفوظة مشفّرة في سجل العائلة.</p>
    </section>
  );
}
