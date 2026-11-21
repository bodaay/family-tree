import { useEffect, useState } from 'preact/hooks';
import { encode, renderSVG } from 'uqr';
import { set, toast, devicesOf, type State } from '../data/store';
import { makeKit, setLock } from '../data/security';
import { lockSupport, type LockResult } from '../data/vault';
import { ADMIN_BITS, passProblem, suggestWords } from '../data/recovery';
import { Icon } from './icons';
import { Seg, Sheet } from './common';

/** What the lock's answers mean, said to a woman (`f`) or a man. */
const lockSays = (f: boolean): Partial<Record<LockResult | 'again', string>> => ({
  again: f
    ? 'حُفظ مفتاح الدخول على هذا الهاتف. اضغطي «مفعّل» مرة أخرى وأكّدي بالبصمة لإكمال التفعيل.'
    : 'حُفظ مفتاح الدخول على هذا الهاتف. اضغط «مفعّل» مرة أخرى وأكّد بالبصمة لإكمال التفعيل.',
  unsupported: 'لا تتوفر بصمة الوجه أو الإصبع للتطبيق على هذا المتصفح، فلم يُفعَّل القفل.',
  noprf: `هذا الهاتف (أو مدير كلمات المرور فيه) لا يستطيع فتح المفاتيح بالبصمة، فلم يُفعَّل القفل: مفاتيح العائلة ما زالت محفوظة دون قفل. ${f ? 'احفظي' : 'احفظ'} مفتاح الاستعادة على الأقل.`,
  cancelled: 'لم يكتمل التحقق، ولم يتغير شيء.',
  wrong: 'لم تطابق البصمة قفل هذا الهاتف، ولم يتغير شيء.',
});

/** This phone's person is a woman: the screens here speak to her as one. */
const woman = (s: State) => !!s.me && s.graph.nodes.get(s.me)?.sex === 'f';

/** أنا → الأمان: the Face ID lock, and the recovery kit. */
export function Security({ s }: { s: State }) {
  const f = woman(s);
  const says = lockSays(f);
  const [support, setSupport] = useState<'ok' | 'unsupported' | 'noprf' | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => void lockSupport().then(setSupport), []);
  const toggle = async (on: boolean) => {
    if (on === s.lock || busy) return;
    if (!on && !confirm('إيقاف قفل البصمة؟ تعود مفاتيح العائلة إلى هذا الهاتف دون تشفير.')) return;
    setBusy(true);
    setNote('');
    const r = await setLock(on);
    setBusy(false);
    setNote(says[r] ?? '');
  };
  const unavailable = !s.lock && support !== null && support !== 'ok';
  return (
    <section>
      <h3>الأمان</h3>
      <div class="card set">
        <div class="srow">
          <span>
            قفل البصمة
            <small>
              {s.lock
                ? 'يُطلب Face ID أو البصمة عند فتح التطبيق، ومفاتيح العائلة على هذا الهاتف مشفّرة.'
                : 'يطلب Face ID أو البصمة عند فتح التطبيق، ويحفظ مفاتيح العائلة على هذا الهاتف مشفّرة.'}
            </small>
          </span>
          {unavailable ? (
            <b class="warn">غير متاح</b>
          ) : (
            <Seg value={s.lock ? 'on' : 'off'} options={[['on', 'مفعّل'], ['off', 'موقوف']]} onChange={v => void toggle(v === 'on')} />
          )}
        </div>
      </div>
      {(note || unavailable) && <p class="hint warn">{note || says[support as LockResult]}</p>}
      {!s.isSample && (
        <button class="card cta" onClick={() => set({ kitOpen: true })}>
          <Icon name="key" />
          <span>
            <b>مفتاح الاستعادة</b>
            <small>
              {f
                ? 'إن ضاع هاتفكِ أو غيّرتِه، يعيدكِ إلى العائلة باسمكِ. رابط ورمز تحفظينهما في ملاحظاتكِ أو تطبعينهما، ولا يفتحهما إلا عبارة مرور تختارينها.'
                : 'إن ضاع هاتفك أو غيّرته، يعيدك إلى العائلة باسمك. رابط ورمز تحفظهما في ملاحظاتك أو تطبعهما، ولا يفتحهما إلا عبارة مرور تختارها.'}
            </small>
          </span>
        </button>
      )}
    </section>
  );
}

/** Shown above the tab bar, like the other sheets. */
export function KitOverlay({ s }: { s: State }) {
  return s.kitOpen ? <KitSheet s={s} onClose={() => set({ kitOpen: false })} /> : null;
}

function KitSheet({ s, onClose }: { s: State; onClose: () => void }) {
  const f = woman(s);
  const [words, setWords] = useState(() => suggestWords());
  const [own, setOwn] = useState<string | null>(null);
  const [noted, setNoted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState('');
  const [link, setLink] = useState<string | null>(null);
  // a member's kit is a backup key among their devices: a new one can end the earlier ones
  const backups = s.me && !s.guest ? devicesOf(s, s.me).filter(d => d.backup).length : 0;
  const [replace, setReplace] = useState(true);
  const pass = own ?? words;
  // a phrase of one's own for the root admin's kit (it carries the admin key) must be longer than the suggested words
  const problem = passProblem(pass, own !== null && s.rootAdmin ? ADMIN_BITS : undefined);
  const create = async () => {
    setBusy(true);
    setWhy('');
    const r = await makeKit(pass, replace);
    setBusy(false);
    if (r.includes('#restore=')) setLink(r);
    else if (r === 'failed')
      setWhy(
        f
          ? 'تعذّر إضافة مفتاح الاستعادة إلى أجهزتكِ. تأكدي من الاتصال وحاولي مرة أخرى، أو أزيلي جهازًا لا تستخدمينه.'
          : 'تعذّر إضافة مفتاح الاستعادة إلى أجهزتك. تأكد من الاتصال وحاول مرة أخرى، أو أزل جهازًا لا تستخدمه.',
      );
    else setWhy(lockSays(f)[r as LockResult] ?? 'تعذّر إنشاء المفتاح.');
  };
  if (link) return <KitResult s={s} link={link} onClose={onClose} />;
  return (
    <Sheet title="مفتاح الاستعادة" onClose={onClose} cls="kit">
      <p class="hint">
        {f ? 'إن ضاع هاتفكِ أو غيّرتِه، يعيدكِ هذا المفتاح إلى العائلة باسمكِ' : 'إن ضاع هاتفك أو غيّرته، يعيدك هذا المفتاح إلى العائلة باسمك'}
        {s.rootAdmin ? '، ومعه مفتاح المشرف' : ''}. يُقفل بعبارة مرور، ولا يُفتح إلا بها.
        {s.me && !s.guest ? ` يظهر في «أجهزتي» باسم «مفتاح الاستعادة»، والهاتف الذي يُستعاد عليه يُضاف إلى ${f ? 'أجهزتكِ' : 'أجهزتك'} بمفتاح خاص به.` : ''}
      </p>
      {own === null ? (
        <>
          <div class="words">
            {words.split(' ').map((w, i) => (
              <span>
                <i>{i + 1}</i>
                {w}
              </span>
            ))}
          </div>
          <div class="kitbtns">
            <button class="btn small" onClick={() => { setWords(suggestWords()); setNoted(false); }}>
              <Icon name="refresh" size={16} /> كلمات أخرى
            </button>
            <button class="btn small" onClick={() => { setOwn(''); setNoted(false); }}>أكتب عبارتي</button>
          </div>
        </>
      ) : (
        <>
          <input
            class="bigin pass"
            dir="rtl"
            placeholder="ست كلمات أو أكثر"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            value={own}
            onInput={e => setOwn((e.target as HTMLInputElement).value)}
          />
          {own && problem && <div class="warnbox">{problem}</div>}
          <button class="btn small" onClick={() => { setOwn(null); setNoted(false); }}>
            <Icon name="refresh" size={16} /> كلمات مقترحة
          </button>
        </>
      )}
      <label class="opt">
        <span>
          <b>كتبتُ العبارة في مكان آمن</b>
          <small>على ورقة، بالترتيب، بعيدًا عن الرابط. لا يمكن استرجاعها إن نُسيت.</small>
        </span>
        <input type="checkbox" checked={noted} onChange={e => setNoted((e.target as HTMLInputElement).checked)} />
      </label>
      {backups > 0 && (
        <label class="opt">
          <span>
            <b>إبطال المفتاح السابق</b>
            <small>لا يعود رابط {f ? 'مفتاحكِ' : 'مفتاحك'} القديم يفتح شيئًا، ويُجدَّد مفتاح العائلة.</small>
          </span>
          <input type="checkbox" class="replace" checked={replace} onChange={e => setReplace((e.target as HTMLInputElement).checked)} />
        </label>
      )}
      {why && <div class="warnbox">{why}</div>}
      <button class="btn primary wide" disabled={!!problem || !noted || busy} onClick={create}>
        {busy ? 'جارٍ التشفير…' : 'إنشاء المفتاح'}
      </button>
    </Sheet>
  );
}

function KitResult({ s, link, onClose }: { s: State; link: string; onClose: () => void }) {
  const f = woman(s);
  let svg = '';
  try {
    svg = renderSVG(link, { border: 2 });
  } catch {
    /* too long for a QR code: the link itself still works */
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast(f ? 'نُسخ الرابط. احفظيه في ملاحظاتكِ، والعبارة في مكان آخر.' : 'نُسخ الرابط. احفظه في ملاحظاتك، والعبارة في مكان آخر.');
    } catch {
      toast('تعذّر النسخ');
    }
  };
  return (
    <Sheet title="مفتاح الاستعادة" onClose={onClose} cls="invite kit">
      <p class="hint">
        {f
          ? 'احفظي الرابط في ملاحظاتكِ، أو صورة الرمز، أو اطبعيه. على الهاتف الجديد: افتحي الرابط أو صوّري الرمز، ثم اكتبي عبارة المرور. وإن كان التطبيق مثبّتًا على الشاشة الرئيسية فانسخي الرابط وألصقيه في التطبيق نفسه.'
          : 'احفظ الرابط في ملاحظاتك، أو صورة الرمز، أو اطبعه. على الهاتف الجديد: افتح الرابط أو صوّر الرمز، ثم اكتب عبارة المرور. وإن كان التطبيق مثبّتًا على الشاشة الرئيسية فانسخ الرابط وألصقه في التطبيق نفسه.'}
      </p>
      {svg ? <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} /> : <p class="hint warn">الرابط أطول من أن يُرسم رمزًا، {f ? 'فاحفظي' : 'فاحفظ'} الرابط نفسه.</p>}
      <button class="btn primary wide" onClick={copy}>
        نسخ
      </button>
      {svg && (
        <button class="btn wide" onClick={() => void saveImage(link, s.graph.family.name)}>
          حفظ صورة
        </button>
      )}
      <p class="hint">
        {s.rootAdmin
          ? f
            ? 'يحمل هذا المفتاح مفتاح المشرف، فاحفظيه كما تحفظين رابط المشرف: من يملكه مع العبارة يدير العائلة.'
            : 'يحمل هذا المفتاح مفتاح المشرف، فاحفظه كما تحفظ رابط المشرف: من يملكه مع العبارة يدير العائلة.'
          : s.guest
            ? 'يبقى المفتاح صالحًا ما دامت مشاهدتك قائمة.'
            : f
              ? 'يبقى المفتاح صالحًا ما دام «مفتاح الاستعادة» في أجهزتكِ (أنا ← أجهزتي). إن أزلتِه من هناك، أو أبطله مشرف العائلة، لم يعد يفتح شيئًا.'
              : 'يبقى المفتاح صالحًا ما دام «مفتاح الاستعادة» في أجهزتك (أنا ← أجهزتي). إن أزلته من هناك، أو أبطله مشرف العائلة، لم يعد يفتح شيئًا.'}
      </p>
    </Sheet>
  );
}

/** The QR code as a picture, to keep in the phone's photos or print. */
async function saveImage(link: string, family: string) {
  const qr = encode(link, { border: 3 });
  const cell = Math.max(4, Math.floor(720 / qr.size));
  const side = qr.size * cell;
  const c = document.createElement('canvas');
  c.width = side + 80;
  c.height = side + 220;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.fillStyle = '#12152a';
  g.font = '800 40px Almarai, sans-serif';
  g.fillText('مفتاح الاستعادة', c.width / 2, 70);
  g.fillStyle = '#646a88';
  g.font = '400 26px Almarai, sans-serif';
  g.fillText(`شجرة ${family} · لا يُفتح إلا بعبارة المرور`, c.width / 2, 116);
  g.fillStyle = '#000';
  qr.data.forEach((row, y) => row.forEach((on, x) => on && g.fillRect(40 + x * cell, 150 + y * cell, cell, cell)));
  g.fillStyle = '#646a88';
  g.font = '400 22px Almarai, sans-serif';
  g.fillText(new Date().toLocaleDateString('ar'), c.width / 2, side + 190);
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
  if (!blob) return toast('تعذّر حفظ الصورة');
  const file = new File([blob], 'مفتاح-الاستعادة.png', { type: 'image/png' });
  try {
    // phones: the share sheet has "Save Image"; elsewhere a download
    if (navigator.maxTouchPoints > 0 && navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file] });
  } catch {
    return; /* cancelled */
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
