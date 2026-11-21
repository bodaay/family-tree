import { useState } from 'preact/hooks';
import { cancelRestore, forgetThisPhone, restoreAccess, unlockApp, type Restored } from '../data/security';
import { set } from '../data/store';
import { restoreBlob } from '../data/recovery';
import { Icon } from './icons';

/** With the Face ID lock on, this comes before anything else: the family's keys are sealed until it opens. */
export function Lock() {
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState('');
  const [help, setHelp] = useState(false);
  const [link, setLink] = useState('');
  const open = async () => {
    setBusy(true);
    setWhy('');
    const r = await unlockApp();
    setBusy(false);
    if (r === 'cancelled') setWhy('لم يكتمل التحقق. حاول مرة أخرى.');
    else if (r === 'wrong') setWhy('لم يطابق مفتاح الدخول قفل هذا الهاتف. حاول مرة أخرى.');
    else if (r !== 'ok') setWhy('تعذّر فتح القفل على هذا المتصفح. إن تكرر ذلك فاستخدم مفتاح الاستعادة.');
  };
  return (
    <div class="join">
      <div class="wl-mark"><Icon name="lock" size={30} /></div>
      <h2>التطبيق مقفل</h2>
      <p>مفاتيح العائلة على هذا الهاتف مشفّرة، ولا تُفتح إلا ببصمة الوجه أو الإصبع.</p>
      <button class="btn primary" disabled={busy} onClick={open}>
        <Icon name="lock" size={18} /> افتح بالبصمة
      </button>
      {why && <div class="warnbox">{why}</div>}
      {!help ? (
        <button class="link" onClick={() => setHelp(true)}>لا أستطيع الفتح</button>
      ) : (
        <div class="card lockhelp">
          <p>إن كان لديك مفتاح الاستعادة فألصق رابطه هنا، ثم اكتب عبارة المرور. وإلا فاحذف المفاتيح من هذا الهاتف وأضفه من جهاز آخر لك (أنا ← أجهزتي ← إضافة جهاز)، أو اطلب من مشرف العائلة دعوة جديدة باسمك.</p>
          <input
            class="bigin"
            dir="ltr"
            placeholder="رابط مفتاح الاستعادة"
            value={link}
            onInput={e => { setLink((e.target as HTMLInputElement).value); setWhy(''); }}
          />
          <button class="btn primary small" disabled={!link.trim()} onClick={() => { const kit = restoreBlob(link); if (kit) set({ restore: kit }); else setWhy('هذا ليس رابط مفتاح استعادة.'); }}>
            متابعة
          </button>
          <button
            class="btn small"
            onClick={() =>
              confirm('حذف مفاتيح العائلة من هذا الهاتف؟ لا تعود إلا بمفتاح الاستعادة أو بدعوة جديدة من المشرف.') && forgetThisPhone()
            }
          >
            <Icon name="x" size={16} /> حذف المفاتيح من هذا الهاتف
          </button>
        </div>
      )}
    </div>
  );
}

const RESTORE_SAYS: Partial<Record<Restored, string>> = {
  wrong: 'عبارة المرور غير صحيحة. تأكد من الكلمات وترتيبها، ثم حاول مرة أخرى.',
  bad: 'هذا الرابط ناقص أو تالف. انسخه كاملًا وحاول مرة أخرى.',
  ended: 'لم يعد مفتاح الاستعادة هذا يعمل: أُبطل عند إنشاء مفتاح أحدث، أو أُزيل من «أجهزتي»، أو أبطله مشرف العائلة. لم يتغير شيء على هذا الهاتف. استعمل أحدث مفتاح لديك، أو اطلب دعوة جديدة من مشرف العائلة.',
  other: 'هذا الهاتف مرتبط بفرد آخر في العائلة، فلم يتغير عليه شيء. أزله أولًا من «أجهزتي» لذلك الفرد، أو استعد المفتاح على هاتف آخر.',
  offline: 'تعذّر الوصول إلى سجل العائلة للتحقق من المفتاح. تأكد من الاتصال وحاول مرة أخرى.',
};

/** A recovery link was opened: its passphrase brings this person's access back on this phone. */
export function Restore() {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState('');
  const go = async () => {
    if (!pass.trim() || busy) return;
    setBusy(true);
    setWhy('');
    // asked only once the kit is known to work here: restoring replaces what this phone holds now (another family, or keys behind a lock)
    const r = await restoreAccess(pass, () => confirm('على هذا الهاتف عائلة محفوظة. الاستعادة تستبدلها بما في المفتاح. متابعة؟'));
    setBusy(false);
    setWhy(RESTORE_SAYS[r] ?? '');
  };
  return (
    <div class="join">
      <div class="wl-mark"><Icon name="key" size={30} /></div>
      <h2>مفتاح الاستعادة</h2>
      <p>اكتب عبارة المرور التي اخترتها عند إنشاء هذا المفتاح، فيعود هذا الهاتف إليك باسمك في الشجرة.</p>
      <input
        class="bigin pass"
        dir="rtl"
        placeholder="عبارة المرور"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        value={pass}
        onInput={e => { setPass((e.target as HTMLInputElement).value); setWhy(''); }}
        onKeyDown={e => e.key === 'Enter' && void go()}
      />
      {why && <div class="warnbox">{why}</div>}
      <button class="btn primary" disabled={busy || !pass.trim()} onClick={go}>
        {busy ? 'جارٍ فك التشفير…' : 'استعادة'}
      </button>
      <button class="btn" disabled={busy} onClick={cancelRestore}>إلغاء</button>
      <p>يُفك التشفير على هذا الهاتف فقط: لا تصل العبارة ولا المفتاح إلى أي خادم.</p>
    </div>
  );
}
