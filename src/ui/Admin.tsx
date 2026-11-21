import { canGrantAccess, createInvite, logBackup, moveToPersonKeys, nameOf, setAsks, setReach, toast, type State } from '../data/store';
import { PersonRow } from './common';
import { ASKS, REACHES } from '../data/types';
import { degreeWord } from '../data/kinship';
import { Seg } from './common';
import { Keys } from './Keys';
import { FamilyKey, Members, ViewAccess } from './Invites';
import { ExportLog } from './Export';

/**
 * Running the family, in a tab of its own: members and invites, the key seats,
 * women's privacy, the limit on requests, «مشاهدة الكل», exporting the tree and
 * the family key. For
 * the root admin; the platinum key holder sees it too, for the two settings and
 * «مشاهدة الكل».
 */
export function Admin({ s }: { s: State }) {
  const root = s.rootAdmin && !s.isSample;
  return (
    <div class="page admin">
      <div class="phead">
        <h1>الإدارة</h1>
      </div>
      <p class="hint">
        {root
          ? 'أنت مشرف العائلة: تدعو الأفراد، وتسلّم المفاتيح، وتمنح مشاهدة الكل. ما يخصك أنت (جهازك، الأمان، الإعدادات) في تبويب «أنا».'
          : 'بصفتك حامل المفتاح البلاتيني تضبط خصوصية النساء وحدود الطلبات، وتمنح مشاهدة الكل أو توقفها، وترى من يحمل المفاتيح.'}
      </p>
      {root && <Members s={s} />}
      <Keys s={s} />
      {canGrantAccess(s) && <Reach s={s} />}
      {canGrantAccess(s) && <Asks s={s} />}
      {canGrantAccess(s) && <ViewAccess s={s} />}
      <ExportLog s={s} />
      {root && <FamilyKey s={s} />}
      {root && <WomenKeys s={s} />}
      {root && BACKUP && <Backup />}
    </div>
  );
}

/** The root admin's download of the family log (Backup, below): turned off for now, in version 1.27. */
const BACKUP = false;

/**
 * The move to per-person keys for women's details (design document, Section 6):
 * once, from here. Before it, what it does and what must come first; after it,
 * the members whose invites it cancelled, to invite again.
 */
function WomenKeys({ s }: { s: State }) {
  const waitingTxs = s.txs.filter(t => t.status === 'pending').length;
  const waitingInvites = s.invites.filter(i => i.status === 'pending').length;
  if (s.sealedEra) {
    // cancelled by the move and not joined since: each a new invite away
    const again = [...new Set(s.invites.filter(i => s.cancelled.includes(i.key)).map(i => i.person))].filter(
      p => s.graph.nodes.has(p) && ![...s.devices.values()].includes(p) && !s.invites.some(i => i.person === p && i.status === 'pending'),
    );
    return (
      <section>
        <h3>مفاتيح النساء</h3>
        <p class="hint">
          انتقلت العائلة إلى مفاتيح النساء في {new Date(s.movedAt!).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}: تفاصيل كل امرأة مختومة بمفتاحها، لا يقرؤها إلا أقاربها في حدود العائلة ومن يلزم أن يراها. ومن ينضم من الآن لا يقرأ ما قبل الانتقال.
        </p>
        {again.length > 0 && (
          <>
            <p class="hint">ألغى الانتقال دعوات هؤلاء لأنها تحمل المفتاح القديم. أرسل لكل منهم دعوة جديدة:</p>
            <div class="card list">
              {again.map(p => (
                <PersonRow s={s} id={p} onClick={() => void createInvite(p)} right={<small class="mut">دعوة جديدة</small>} />
              ))}
            </div>
          </>
        )}
      </section>
    );
  }
  const go = () => {
    if (
      !confirm(
        `مرة واحدة ولا رجعة فيها: تُختم تفاصيل كل امرأة بمفتاحها، ويُجدَّد مفتاح العائلة دون أن يحمل ما قبله، فلا يقرأ من ينضم لاحقًا ما قبل الانتقال.${waitingInvites ? ` وتُلغى ${waitingInvites} دعوات تنتظر، فتُرسل من جديد بعده.` : ''} والهاتف الذي ما زال على إصدار سابق لا يرسل شيئًا حتى يُحدَّث التطبيق فيه. متابعة؟`,
      )
    )
      return;
    void moveToPersonKeys();
  };
  return (
    <section>
      <h3>مفاتيح النساء</h3>
      <p class="hint">
        اليوم يحفظ التطبيق قاعدة ظهور تفاصيل النساء، ويحمل كل هاتف مفتاح العائلة الذي يفتحها كلها. وبالانتقال تُختم تفاصيل كل امرأة (اسمها وأسماؤها الأخرى وسنواتها) بمفتاح خاص بها، لا يصل إلا إلى أقاربها في حدود العائلة ومن يلزم أن يراها، ولا يقرأ من ينضم بعده ما قبله. ويبقى ما في هواتف الأفراد اليوم مقروءًا لهم.
      </p>
      {waitingTxs > 0 && <div class="warnbox">احسم الطلبات المنتظرة أولًا ({waitingTxs}).</div>}
      {waitingInvites > 0 && <p class="hint">{waitingInvites} دعوات تنتظر: تُلغى بالانتقال لأنها تحمل المفتاح القديم، وتُرسل من جديد بعده.</p>}
      <button class="btn wide" disabled={waitingTxs > 0} onClick={go}>
        الانتقال إلى مفاتيح النساء
      </button>
    </section>
  );
}

/**
 * The root admin's own copy of the family log, sealed as the server stores it:
 * to keep somewhere else, so the family can be put back on a new server if this
 * one loses it (scripts/restore-log.ts). Shared to Files or mail on a phone that
 * can, downloaded elsewhere.
 */
function Backup() {
  const save = async () => {
    const b = logBackup();
    if (!b) return;
    const file = new File([b.text], b.name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) return void (await navigator.share({ files: [file], title: b.name }));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = b.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(`نُزّلت النسخة: ${b.count} قيدًا`);
  };
  return (
    <section>
      <h3>نسخة احتياطية</h3>
      <p class="hint">سجل العائلة كله كما يحفظه الخادم: مختومًا بمفتاح العائلة، فلا يقرؤه إلا من يحمل المفتاح. احفظه في مكان آخر غير هذا الهاتف (ملفاتك أو بريدك)؛ ومنه يُعاد السجل كما كان إلى خادم جديد إن فقده الخادم.</p>
      <button class="btn wide" onClick={() => void save()}>
        تنزيل نسخة احتياطية
      </button>
    </section>
  );
}

/** How far a woman's details are seen, for the whole family: the root admin or the platinum key holder sets it. */
function Reach({ s }: { s: State }) {
  const pick = (v: string) => {
    const deg = v === 'all' ? null : Number(v);
    if (deg === s.reach) return;
    const ask = deg === null ? 'تظهر تفاصيل كل امرأة في العائلة لكل الأفراد. متابعة؟' : `تظهر تفاصيل المرأة لأقاربها حتى الدرجة ${degreeWord(deg)}، في العائلة كلها. متابعة؟`;
    if (confirm(ask)) void setReach(deg);
  };
  const set = s.reachSet;
  return (
    <section>
      <h3>خصوصية النساء</h3>
      <p class="hint">إلى أي درجة قرابة تظهر تفاصيل المرأة (اسمها وسنواتها) لأقاربها؛ ومن هم أبعد يرونها «ابنة» أو «امرأة» فقط. تسري على العائلة كلها، ومن مُنح مشاهدة الكل يرى الجميع على أي حال.</p>
      <Seg cls="reach" value={s.reach === null ? 'all' : String(s.reach)} options={[...REACHES.map((d): [string, string] => [String(d), degreeWord(d)]), ['all', 'بلا حد']]} onChange={pick} />
      <p class="hint">
        {set
          ? `غيّرها ${set.admin ? 'مشرف العائلة' : nameOf(s, set.by ?? '')} · ${new Date(set.at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}`
          : 'الدرجة الثالثة ما لم تُغيَّر.'}
      </p>
    </section>
  );
}

/** About whom a member may send requests, for the whole family: the root admin or the platinum key holder sets it. */
function Asks({ s }: { s: State }) {
  const pick = (v: string) => {
    const deg = v === 'all' ? null : Number(v);
    if (deg === s.asks) return;
    const ask =
      deg === null
        ? 'يرسل كل فرد طلبات عن أي أحد في الشجرة. متابعة؟'
        : deg === 0
          ? 'لن يرسل الأفراد طلبات عن أحد، إلا حاملي المفاتيح في فروعهم. متابعة؟'
          : `يرسل الفرد طلبات عن أقاربه حتى الدرجة ${degreeWord(deg)} فقط، في العائلة كلها. متابعة؟`;
    if (confirm(ask)) void setAsks(deg);
  };
  const set = s.asksSet;
  return (
    <section>
      <h3>حدود الطلبات</h3>
      <p class="hint">عن أي أقارب يرسل الفرد طلبات (إضافة ابن أو زوجة، والأسماء الأخرى، وحالة الزواج، والتراجع): الأولى أبواه وأبناؤه وزوجه، والثانية إخوته وأجداده وأحفاده، والثالثة أعمامه وأبناء إخوته، والرابعة أبناء عمومته. ومن هم أبعد يراهم ولا يطلب عنهم. ولحامل المفتاح أن يطلب في فرعه، وللبلاتيني في العائلة كلها.</p>
      <Seg
        cls="asks"
        value={s.asks === null ? 'all' : String(s.asks)}
        options={[...ASKS.map((d): [string, string] => [String(d), d ? degreeWord(d) : 'لا أحد']), ['all', 'بلا حد']]}
        onChange={pick}
      />
      <p class="hint">
        {set
          ? `غيّرها ${set.admin ? 'مشرف العائلة' : nameOf(s, set.by ?? '')} · ${new Date(set.at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}`
          : 'بلا حد ما لم تُغيَّر.'}
      </p>
    </section>
  );
}

/** Whether this phone sees «الإدارة». */
export function hasAdmin(s: State): boolean {
  return (s.rootAdmin && !s.isSample) || canGrantAccess(s);
}
