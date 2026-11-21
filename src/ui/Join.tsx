import { useState } from 'preact/hooks';
import { joinFamily, trySample, leaveFamily, claimInvite, set, toast, type State } from '../data/store';
import { nasab, shownName } from '../data/graph';
import { isInstalled } from '../install';
import { Icon } from './icons';
import { Scan } from './Scan';

/**
 * «لصق رابط»: the link the clipboard holds (iOS asks with its own "Paste"
 * bubble). An app on an iPhone's Home Screen never receives tapped links: they
 * open in the browser, which copies them (HomeScreen.tsx), and the app pastes.
 */
async function pasted(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/** Shown until this device has joined a family (or is opening its log). */
export function Join({ s }: { s: State }) {
  const [link, setLink] = useState('');
  const [bad, setBad] = useState(false);
  const [scan, setScan] = useState(false);
  if (s.status === 'loading') {
    return (
      <div class="join">
        <div class="wl-mark spin"><Icon name="lock" size={30} /></div>
        <h2>جارٍ فتح سجل العائلة</h2>
        <p>يُنزَّل السجل مشفّرًا، ويُفك تشفيره على هذا الجهاز فقط، ويُتحقق من توقيع كل تغيير.</p>
      </div>
    );
  }
  if (s.status === 'ready') {
    // a real family: you come in through your own personal invite
    const c = s.claim;
    const n = c && s.graph.nodes.get(c.person);
    if (c?.status === 'ok' && c.kind === 'guest') {
      return (
        <div class="join">
          <div class="wl-mark"><Icon name="eye" size={30} /></div>
          <h2>دعوة مشاهدة</h2>
          <p>دعوة لمشاهدة شجرة {s.graph.family.name} كاملة، باسم:</p>
          <div class="card who3">
            <b>{c.label}</b>
          </div>
          <p>تشاهد الشجرة فقط، دون طلبات أو اعتمادات. يمكن لمن دعاك إنهاء المشاهدة في أي وقت، فتُحذف بيانات العائلة من هذا الهاتف.</p>
          <button class="btn primary" onClick={() => void claimInvite()}>قبول الدعوة</button>
          <button class="btn" onClick={leaveFamily}>ليست لي</button>
        </div>
      );
    }
    if (c?.kind === 'kit' && n) {
      // c.label: why it could not be added
      return c.label ? (
        <div class="join">
          <div class="wl-mark warn"><Icon name="key" size={30} /></div>
          <h2>تعذّر ربط هذا الهاتف</h2>
          <p>{c.label}، من «أجهزتي» على جهاز آخر لـ{n.name}، ثم افتح رابط الاستعادة مرة أخرى.</p>
          <button class="btn" onClick={leaveFamily}>إغلاق</button>
        </div>
      ) : (
        <div class="join">
          <div class="wl-mark spin"><Icon name="key" size={30} /></div>
          <h2>جارٍ ربط هذا الهاتف</h2>
          <p>يضيف مفتاح الاستعادة هذا الهاتف إلى أجهزة {n.name}، بمفتاح خاص به لا يشاركه فيه جهاز آخر.</p>
        </div>
      );
    }
    if (c?.status === 'ok' && n && c.extra) {
      const f = n.sex === 'f';
      return (
        <div class="join">
          <div class="wl-mark"><Icon name="phone" size={30} /></div>
          <h2>إضافة جهاز</h2>
          <p>هذه الدعوة تضيف هذا الجهاز إلى أجهزة:</p>
          <div class="card who3">
            <b>{n.name}</b>
            <small>{nasab(s.graph, n.id, 4)}</small>
          </div>
          <p>{f ? 'هل أنتِ هي؟ يرتبط هذا الجهاز بكِ إلى جانب أجهزتكِ الأخرى' : 'هل أنت هو؟ يرتبط هذا الجهاز بك إلى جانب أجهزتك الأخرى'}، وكل طلب أو اعتماد منه يُنسب {f ? 'إليكِ' : 'إليك'}.</p>
          <button class="btn primary" onClick={() => void claimInvite()}>نعم، أنا {n.name}</button>
          <button class="btn" onClick={leaveFamily}>لست أنا</button>
        </div>
      );
    }
    if (c?.status === 'ok' && n) {
      const f = n.sex === 'f';
      return (
        <div class="join">
          <div class="wl-mark"><Icon name="user" size={30} /></div>
          <h2>دعوة شخصية</h2>
          <p>هذه الدعوة للانضمام إلى شجرة {s.graph.family.name} باسم:</p>
          <div class="card who3">
            <b>{shownName(n)}</b>
            <small>{nasab(s.graph, n.id, 4)}</small>
          </div>
          <p>{f ? 'هل أنتِ هي؟ سيرتبط هذا الهاتف بكِ، وكل طلب أو اعتماد منه يُنسب إليكِ.' : 'هل أنت هو؟ سيرتبط هذا الهاتف بك، وكل طلب أو اعتماد منه يُنسب إليك.'}</p>
          <button class="btn primary" onClick={() => void claimInvite()}>نعم، أنا {shownName(n)}</button>
          <button class="btn" onClick={leaveFamily}>لست أنا</button>
        </div>
      );
    }
    const why = !c ? 'يدخل كل فرد بدعوة شخصية باسمه من مشرف العائلة.' : c.status === 'used' ? 'استُخدمت هذه الدعوة على هاتف آخر.' : c.status === 'revoked' ? 'أُلغيت هذه الدعوة.' : 'لم نجد هذه الدعوة في سجل العائلة.';
    return (
      <div class="join">
        <div class="wl-mark warn"><Icon name="lock" size={30} /></div>
        <h2>تحتاج دعوة شخصية</h2>
        <p>{why} اطلب من مشرف العائلة دعوة جديدة باسمك.</p>
        <button class="btn" onClick={leaveFamily}>إغلاق</button>
      </div>
    );
  }
  if (s.status === 'error') {
    return (
      <div class="join">
        <div class="wl-mark warn"><Icon name="x" size={30} /></div>
        <h2>تعذّر فتح سجل العائلة</h2>
        <p class="mono">{s.error}</p>
        <p>تأكد أن الخادم يعمل وأن الرابط صحيح.</p>
        <button class="btn primary" onClick={() => location.reload()}>إعادة المحاولة</button>
        <button class="btn" onClick={leaveFamily}>استخدام رابط آخر</button>
      </div>
    );
  }
  if (s.ended && s.movedApp) {
    // this browser moved its access into the app on the Home Screen, which then removed it
    return (
      <div class="join">
        <div class="wl-mark"><Icon name="phone" size={30} /></div>
        <h2>نُقل دخولك إلى التطبيق</h2>
        <p>صار دخولك إلى شجرة {s.ended} في تطبيقها على الشاشة الرئيسية، فحُذفت بيانات العائلة ومفتاحها من هذا المتصفح. افتح العائلة من الشاشة الرئيسية.</p>
        <button class="btn" onClick={() => set({ ended: null, movedApp: false })}>حسنًا</button>
      </div>
    );
  }
  if (s.ended) {
    return (
      <div class="join">
        <div class="wl-mark warn"><Icon name="lock" size={30} /></div>
        <h2>انتهى دخولك</h2>
        <p>أُنهي دخول هذا الهاتف إلى شجرة {s.ended}، وحُذفت بيانات العائلة ومفتاحها منه. للعودة تحتاج دعوة جديدة.</p>
        <button class="btn" onClick={() => set({ ended: null })}>حسنًا</button>
      </div>
    );
  }
  return (
    <div class="join">
      <div class="wl-mark"><Icon name="tree" size={34} /></div>
      <h1>شجرة العائلة</h1>
      <p>
        سجل العائلة مشفّر من طرف إلى طرف: لا يقرؤه إلا أفراد العائلة على أجهزتهم.{' '}
        {isInstalled()
          ? 'للانضمام، ألصق رابط الدعوة هنا أو امسح رمزه بالكاميرا: الروابط تُفتح في المتصفح لا في التطبيق.'
          : 'للانضمام، افتح رابط الدعوة الذي وصلك، أو ألصقه هنا، أو امسح رمزه بالكاميرا.'}
      </p>
      <input
        class="bigin"
        dir="ltr"
        placeholder="رابط الدعوة أو مفتاح الاستعادة"
        value={link}
        onInput={e => { setLink((e.target as HTMLInputElement).value); setBad(false); }}
      />
      {bad && <div class="warnbox">هذا ليس رابط دعوة صحيحًا.</div>}
      <button class="btn primary" onClick={() => setBad(!joinFamily(link))}>انضمام</button>
      <button
        class="btn"
        onClick={() =>
          void pasted().then(t => {
            if (t === null) return toast('تعذّر اللصق: ألصق الرابط في الخانة أعلاه');
            setLink(t);
            setBad(!joinFamily(t));
          })
        }
      >
        لصق رابط
      </button>
      <button class="btn" onClick={() => setScan(true)}>
        <Icon name="cam" size={18} /> مسح رمز الدعوة
      </button>
      <button class="btn" onClick={trySample}>جرّب العائلة التجريبية</button>
      {scan && (
        <Scan
          onClose={() => setScan(false)}
          onText={text => {
            setScan(false);
            setBad(!joinFamily(text));
          }}
        />
      )}
    </div>
  );
}
