import { useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { set, openInvite, nameOf, unitOf, inviteLinkFor, toast, currentMembership, createGuest, endGuest, setViewAll, renewKeyNow, type State, type Invite } from '../data/store';
import { savedInvites } from '../data/backend';
import { nasab } from '../data/graph';
import { Icon } from './icons';
import { Avatar, fullLine } from './common';
import { askCancelInvite, askNewDevice, askUnlink, openPermissions } from './Permissions';
import { useBack } from './back';

const STATUS: Record<Invite['status'], string> = { pending: 'بانتظار الانضمام', joined: 'انضم', revoked: 'أُلغيت' };
/** An invite's state in the members list, «انضمت» for a woman. */
const statusOf = (s: State, i: Invite) => (i.status === 'joined' && s.graph.nodes.get(i.person)?.sex === 'f' ? 'انضمت' : STATUS[i.status]);

/**
 * Root admin: personal invites. Each invite is for one person and works once:
 * the first phone that opens it becomes that person's phone.
 */
export function Members({ s }: { s: State }) {
  const fid = currentMembership()?.fid ?? '';
  const mine = savedInvites(fid);
  const list = [...s.invites].reverse().filter(i => i.status !== 'revoked' && s.graph.nodes.has(i.person));
  const joined = new Set([...s.devices.values()]).size;
  return (
    <section>
      <h3>الأعضاء والدعوات</h3>
      <button class="card cta" onClick={() => set({ searchOpen: 'invite' })}>
        <Icon name="plus" />
        <span>
          <b>دعوة فرد</b>
          <small>اختر الشخص من الشجرة، ثم أرسل له رابطه أو رمزه. الدعوة له وحده وتعمل مرة واحدة.</small>
        </span>
      </button>
      {list.length > 0 && (
        <div class="card list">
          {list.map(i => (
            <div class="prow">
              <Avatar id={i.person} s={s} size={38} />
              <button class="pt tap" onClick={() => openPermissions(i.person)}>
                <b>
                  {unitOf(s, i.person)} <small class="mut">{fullLine(s, i.person)}</small>
                </b>
                <small class={i.status === 'joined' ? 'ok' : ''}>{statusOf(s, i)}</small>
              </button>
              {i.status === 'pending' && mine[i.key] && (
                <button class="btn small" onClick={() => void openInvite(i.key)}>
                  مشاركة
                </button>
              )}
              {i.status === 'joined' && !s.graph.nodes.get(i.person)!.dead && (
                <button class="btn small" onClick={() => void askNewDevice(s, i.person, i.device!)}>
                  جهاز جديد
                </button>
              )}
              <button
                class="btn small"
                aria-label="إلغاء"
                onClick={() => void (i.status === 'joined' ? askUnlink(s, i.person, i.device!) : askCancelInvite(s, i.person, i.key))}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p class="hint">
        انضم {joined} {joined === 1 ? 'فرد' : 'أفراد'}. الدعوة تحمل مفتاح العائلة، فأرسلها للشخص نفسه مباشرة. إن ضاع هاتف أحدهم أو غيّره فاختر «جهاز جديد»: يُفصل هاتفه القديم وتصله دعوة جديدة باسمه. ولجهاز آخر دون فصل هاتفه: «جهاز إضافي» في صفحته، أو يضيفه هو من «أجهزتي».
      </p>
    </section>
  );
}

/**
 * View all (مشاهدة الكل), for the root admin and the platinum key holder: let a
 * member see everyone, or invite a guest who may only look. Either can be
 * stopped at any time; a guest's phone then forgets the family.
 */
export function ViewAccess({ s }: { s: State }) {
  const [label, setLabel] = useState('');
  const fid = currentMembership()?.fid ?? '';
  const mine = savedInvites(fid);
  const guests = [...s.guests].reverse().filter(x => x.status !== 'revoked');
  return (
    <section>
      <h3>مشاهدة الكل</h3>
      <p class="hint">من يُمنح مشاهدة الكل يرى كل الأسماء في الشجرة، بما فيها ما تخفيه قاعدة الخصوصية عادة. الزائر يشاهد فقط، دون طلبات أو اعتمادات. يمكنك إيقافها في أي وقت.</p>
      <div class="card guestnew">
        <input class="bigin" dir="rtl" placeholder="اسم الزائر، مثل: أبو فهد" value={label} onInput={e => setLabel((e.target as HTMLInputElement).value)} />
        <button class="btn primary" disabled={!label.trim()} onClick={() => { void createGuest(label); setLabel(''); }}>
          <Icon name="eye" size={18} /> دعوة زائر للمشاهدة
        </button>
      </div>
      <button class="btn small" onClick={() => set({ searchOpen: 'viewall' })}>
        <Icon name="plus" size={16} /> منح فرد مشاهدة الكل
      </button>
      {(s.viewAll.size > 0 || guests.length > 0) && (
        <div class="card list">
          {[...s.viewAll].filter(id => s.graph.nodes.has(id)).map(id => (
            <div class="prow">
              <Avatar id={id} s={s} size={38} />
              <button class="pt tap" onClick={() => openPermissions(id)}>
                <b>{unitOf(s, id)} <small class="mut">{fullLine(s, id)}</small></b>
                <small class="ok">فرد · يرى الكل</small>
              </button>
              <button class="btn small" aria-label="إيقاف" onClick={() => confirm(`إيقاف مشاهدة الكل لـ ${nameOf(s, id)}؟`) && setViewAll(id, false)}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
          {guests.map(x => (
            <div class="prow">
              <div class="av guest"><Icon name="eye" size={18} /></div>
              <span class="pt">
                <b>{x.label}</b>
                <small class={x.status === 'joined' ? 'ok' : ''}>زائر · {x.status === 'joined' ? 'يشاهد الآن' : 'بانتظار فتح الدعوة'}</small>
              </span>
              {x.status === 'pending' && mine[x.key] && (
                <button class="btn small" onClick={() => void openInvite(x.key)}>
                  مشاركة
                </button>
              )}
              <button class="btn small" aria-label="إنهاء" onClick={() => confirm(`إنهاء مشاهدة ${x.label}؟ تُحذف بيانات العائلة من هاتفه عند فتحه التطبيق، ويُجدَّد مفتاحها فلا يصله شيء جديد.`) && endGuest(x.key)}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Root admin: the family key's version, and renewing it by hand. It renews by
 * itself whenever someone loses access; this is for anything else (a lost phone
 * not yet unlinked from here, or a renewal that failed to go out).
 */
export function FamilyKey({ s }: { s: State }) {
  const [busy, setBusy] = useState(false);
  const k = s.familyKey;
  const renew = async () => {
    if (!confirm('تجديد مفتاح العائلة الآن؟ يصل المفتاح الجديد تلقائيًا إلى كل من بقي له دخول.')) return;
    setBusy(true);
    await renewKeyNow();
    setBusy(false);
  };
  return (
    <section>
      <h3>مفتاح العائلة</h3>
      <div class={'card cta renew' + (k.stale ? ' due' : '')}>
        <Icon name="key" />
        <span>
          <b>تجديد مفتاح العائلة</b>
          <small>
            {k.stale
              ? 'خرج من العائلة من يحمل المفتاح الحالي، فيُجدَّد الآن تلقائيًا. إن لم يتجدد فجدّده بيدك.'
              : 'يصل المفتاح الجديد تلقائيًا إلى الأجهزة المرتبطة والدعوات القائمة، ولا يصل إلى من أُلغي دخوله.'}
          </small>
        </span>
        <button class="btn primary small" disabled={busy} onClick={renew}>
          {busy ? 'جارٍ…' : 'تجديد'}
        </button>
      </div>
      <p class="hint">
        المفتاح الحالي: الإصدار {k.version}
        {k.version > 1 && k.at ? ' · جُدّد في ' + new Date(k.at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn') : ''}. يتجدد تلقائيًا عند فصل جهاز أو إلغاء دعوة أو
        إنهاء مشاهدة أو حذف شخص مرتبط، وعند فتحك التطبيق إن أزال أحد الأفراد جهازًا من أجهزته. التجديد يحجب الجديد فقط: ما رآه أحدهم قبل خروجه لا
        يمكن سحبه.
      </p>
    </section>
  );
}

/** The link and QR code of one invite, to send or scan. */
export function InviteOverlay({ s }: { s: State }) {
  useBack(() => set({ inviteOpen: null }), !!s.inviteOpen);
  const key = s.inviteOpen;
  const inv = key ? s.invites.find(i => i.key === key) : null;
  const guest = key ? s.guests.find(x => x.key === key) : null;
  const sk = key ? savedInvites(currentMembership()?.fid ?? '')[key] : null;
  if (!key || (!inv && !guest) || !sk) return null;
  const url = inviteLinkFor(sk);
  if (!url) return null;
  const close = () => set({ inviteOpen: null });
  const name = inv ? nameOf(s, inv.person) : guest!.label;
  // a personal invite speaks of (and to) the person it is for
  const f = !!inv && s.graph.nodes.get(inv.person)?.sex === 'f';
  // for this person's own other phone or browser (أجهزتي), or another device for someone who has one already
  const own = !!inv?.from && inv.person === s.me;
  const extra = !!inv && [...s.devices.values()].includes(inv.person);
  const text = own
    ? `رابط لإضافة جهاز آخر إلى أجهزتي في شجرة ${s.graph.family.name}. يعمل مرة واحدة:`
    : inv
      ? f
        ? `دعوتكِ الشخصية للانضمام إلى شجرة ${s.graph.family.name}. افتحي الرابط على هاتفكِ، وهو لكِ وحدكِ:`
        : `دعوتك الشخصية للانضمام إلى شجرة ${s.graph.family.name}. افتح الرابط على هاتفك، وهو لك وحدك:`
      : `دعوة لمشاهدة شجرة ${s.graph.family.name}. افتح الرابط على هاتفك:`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'شجرة ' + s.graph.family.name, text, url });
      else {
        await navigator.clipboard.writeText(text + '\n' + url);
        toast('نُسخت الدعوة');
      }
    } catch {
      /* cancelled */
    }
  };
  return (
    <div class="overlay" onClick={e => e.target === e.currentTarget && close()}>
      <div class="modal invite">
        <div class="mhead">
          <button class="link" onClick={close}>
            إغلاق
          </button>
          <b>{own ? 'إضافة جهاز' : (inv ? 'دعوة' : 'دعوة مشاهدة:') + ' ' + name}</b>
          <span />
        </div>
        {own ? (
          <p class="hint">
            {f
              ? 'افتحي الرابط على جهازكِ الآخر، أو صوّري الرمز بكاميرته. أول جهاز يفتحه يُضاف إلى أجهزتكِ باسمكِ، والرابط يعمل مرة واحدة فقط.'
              : 'افتح الرابط على جهازك الآخر، أو صوّر الرمز بكاميرته. أول جهاز يفتحه يُضاف إلى أجهزتك باسمك، والرابط يعمل مرة واحدة فقط.'}
          </p>
        ) : (
          <p class="hint">
            {inv ? `${unitOf(s, inv.person)} ${nasab(s.graph, inv.person, 3)}` : name}:{' '}
            {f ? 'تفتح الرابط على هاتفها، أو تصوّر الرمز بكاميرا هاتفها.' : 'يفتح الرابط على هاتفه، أو يصوّر الرمز بكاميرا هاتفه.'}{' '}
            {inv
              ? extra
                ? f ? 'أول جهاز يفتحها يُضاف إلى أجهزتها، ويبقى ما سبقه.' : 'أول جهاز يفتحها يُضاف إلى أجهزته، ويبقى ما سبقه.'
                : f ? 'أول هاتف يفتحها يصبح هاتفها.' : 'أول هاتف يفتحها يصبح هاتفه.'
              : 'تتيح المشاهدة فقط، وتعمل على هاتف واحد.'}
          </p>
        )}
        <div class="qr" dangerouslySetInnerHTML={{ __html: renderSVG(url, { border: 2 }) }} />
        <button class="btn primary wide" onClick={share}>
          <Icon name="user" size={18} /> {own ? 'إرسال الرابط' : 'إرسال الدعوة'}
        </button>
        <button
          class="btn wide"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast('نُسخ الرابط');
            } catch {
              toast('تعذّر النسخ');
            }
          }}
        >
          نسخ الرابط
        </button>
      </div>
    </div>
  );
}
