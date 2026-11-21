import { useState } from 'preact/hooks';
import { adminLinkHere, currentMembership, eraseAdminHere, leaveFamily, moveToApp, nameOf, toast, trySample, type State } from '../data/store';
import { personalLink } from '../data/backend';
import { Icon } from './icons';

/** Copies text with the tap that asks for it (the clipboard needs the tap itself). */
async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('تعذّر النسخ: اضغط مطوّلًا على الرابط وانسخه');
  }
}

/** A link to carry into the app, with its copy button. */
function Carry({ link, what }: { link: string; what: string }) {
  return (
    <div class="card carry">
      <small class="mono" dir="ltr">
        {link.slice(0, 32)}…
      </small>
      <button class="btn primary" onClick={() => void copy(link, 'نُسخ ' + what)}>
        نسخ الرابط
      </button>
    </div>
  );
}

/**
 * On an iPhone or iPad the family opens only in its app on the Home Screen
 * (design document 1.38): in a browser this screen comes instead. A link opened
 * here is not taken up, only copied, to paste in the app; access this browser
 * already holds moves into the app («نقل حسابي إلى التطبيق»); the root admin
 * copies the admin link, then removes it from here.
 */
export function HomeScreenOnly({ s }: { s: State }) {
  const [moving, setMoving] = useState<string | null>(null);
  const [adminLink, setAdminLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const m = currentMembership();
  const ready = s.status === 'ready' && s.mode === 'remote';
  // an invite opened here before this rule, not yet accepted: it goes to the app too
  const waiting = ready && s.claim?.status === 'ok' && s.claim.kind !== 'kit' && m?.invite ? personalLink(m, m.invite) : null;
  const member = ready && !s.rootAdmin && !!s.me;
  const root = ready && s.rootAdmin;
  const once = async (f: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="join homescreen">
      <div class="wl-mark">
        <Icon name="tree" size={34} />
      </div>
      <h2>{s.graph.family.name && ready ? `افتح ${s.graph.family.name} من الشاشة الرئيسية` : 'افتح العائلة من الشاشة الرئيسية'}</h2>
      <p>على الآيفون والآيباد لا تُفتح العائلة في المتصفح، بل في تطبيقها على الشاشة الرئيسية: قد يحذف Safari مفاتيحها إن لم يُزر الموقع سبعة أيام، والتطبيق لا يرى ما في المتصفح.</p>
      <ol class="steps">
        <li>من زر المشاركة اختر «إضافة إلى الشاشة الرئيسية».</li>
        <li>افتح التطبيق من الشاشة الرئيسية.</li>
        <li>اضغط فيه «لصق رابط»{s.carry || waiting || member || root ? ' بعد نسخ الرابط من هنا' : ' وألصق رابط دعوتك، أو امسح رمزها'}.</li>
      </ol>
      <p class="small">إن فُتح الرابط داخل تطبيق آخر (واتساب مثلًا) فافتحه في Safari أولًا.</p>

      {s.carry && <Carry link={s.carry} what={/restore=/.test(s.carry) ? 'رابط الاستعادة' : 'الرابط'} />}
      {!s.carry && waiting && (
        <>
          <Carry link={waiting} what="رابط الدعوة" />
          <button class="btn" onClick={leaveFamily}>
            إزالة الدعوة من هذا المتصفح
          </button>
        </>
      )}

      {member && !waiting && (
        <section class="move">
          <h3>دخولك في هذا المتصفح</h3>
          {moving ? (
            <>
              <p>هذا رابط جهاز لك يعمل مرة واحدة: انسخه وألصقه في التطبيق. حين يدخل به التطبيق يُزال هذا المتصفح من أجهزتك وتُحذف منه بيانات العائلة.</p>
              <Carry link={moving} what="رابط النقل" />
            </>
          ) : (
            <>
              <p>
                هذا المتصفح مرتبط باسم {nameOf(s, s.me!)}. انقل دخولك إلى التطبيق: لا تحتاج دعوة جديدة، ويبقى مفتاح استعادتك كما هو.
              </p>
              <button class="btn primary" disabled={busy} onClick={() => void once(async () => setMoving(await moveToApp()))}>
                <Icon name="phone" size={18} /> نقل حسابي إلى التطبيق
              </button>
            </>
          )}
        </section>
      )}

      {root && (
        <section class="move">
          <h3>دخول مشرف العائلة في هذا المتصفح</h3>
          <p>انسخ رابط المشرف وألصقه في التطبيق، ثم احذف الدخول من هنا. روابط الدعوات المحفوظة في هذا المتصفح لا تنتقل: من أُرسلت إليه ما زال يحملها، ولإرسالها مرة أخرى أنشئ دعوة جديدة من التطبيق.</p>
          {adminLink ? (
            <Carry link={adminLink} what="رابط المشرف" />
          ) : (
            <button class="btn primary" disabled={busy} onClick={() => void once(async () => setAdminLink(await adminLinkHere()))}>
              <Icon name="key" size={18} /> نسخ رابط المشرف
            </button>
          )}
          <button
            class="btn"
            disabled={busy}
            onClick={() =>
              confirm('حذف دخول المشرف من هذا المتصفح؟ تأكد أولًا أن التطبيق على الشاشة الرئيسية فُتح برابط المشرف: بدونه لا يُستعاد الدخول.') && void once(eraseAdminHere)
            }
          >
            حذف دخول المشرف من هذا المتصفح
          </button>
        </section>
      )}

      {!ready && !s.carry && (
        <button class="btn" onClick={trySample}>
          جرّب العائلة التجريبية
        </button>
      )}
    </div>
  );
}
