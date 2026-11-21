import { useState } from 'preact/hooks';
import { set, approve, reject, viewer, nameOf, proposeRevert, isMinorViewer, decides, canAskOps, decideHidden, revealHidden, type State } from '../data/store';
import type { Hidden } from '../data/hidden';
import { byWho, titleOf, undoable } from '../data/history';
import { canApprove, approversFor, NEED, seatOf, TIER_AR } from '../data/governance';
import type { Tx } from '../data/types';
import { Icon } from './icons';
import { Avatar, SeatBadge, Seg } from './common';

const LEVEL_AR = { everyday: 'يومي', death: 'وفاة', sensitive: 'حساس', critical: 'حرج', trunk: 'الجذع' } as const;

/** A hidden marriage, as its three see it: waiting for its approver, approved (and to reveal), or refused. */
function HiddenCard({ s, h }: { s: State; h: Hidden }) {
  const v = viewer(s);
  const mine = v === h.approver;
  const reveal = () => {
    if (confirm('إعلان الزواج للعائلة كلها؟ يصير زواجًا عاديًا في الشجرة، ولا رجعة فيه.')) revealHidden(h.id);
  };
  return (
    <div class="card req">
      <div class="rq-top">
        <Avatar id={h.by} s={s} size={36} />
        <span>
          <b>{nameOf(s, h.by)}</b> يطلب
          <small>{new Date(h.at).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })}</small>
        </span>
        <span class="lvl sensitive">مخفي</span>
      </div>
      <h4>{h.title}</h4>
      <div class={'need' + (h.status === 'approved' ? ' ok' : '')}>
        <Icon name="lock" size={15} />{' '}
        {h.status === 'pending' ? (mine ? 'طلب منك وحدك اعتماده' : 'بانتظار اعتماد ' + nameOf(s, h.approver)) : h.status === 'approved' ? 'اعتمده ' + nameOf(s, h.approver) : 'رفضه ' + nameOf(s, h.approver)}
      </div>
      {h.status === 'pending' && mine && !isMinorViewer(s) && (
        <div class="acts">
          <button class="btn primary" onClick={() => void decideHidden(h.id, true)}>
            <Icon name="check" /> اعتماد
          </button>
          <button class="btn" onClick={() => void decideHidden(h.id, false)}>
            رفض
          </button>
        </div>
      )}
      {h.status === 'approved' && (v === h.approver || v === h.marriage.husband) && !isMinorViewer(s) && (
        <div class="acts">
          <button class="btn" onClick={reveal}>
            إعلان الزواج
          </button>
        </div>
      )}
    </div>
  );
}

export function Requests({ s }: { s: State }) {
  const v = viewer(s);
  // all requests, those about one's own branch, or one's own (sent or approved)
  const [who, setWho] = useState<'all' | 'branch' | 'mine'>('all');
  const [shown, setShown] = useState(30);
  const branch = v ? s.graph.nodes.get(v)?.branch ?? null : null;
  const keep = (t: Tx) => who === 'all' || (who === 'mine' ? t.by === v || t.approvals.some(a => a.by === v) : !!branch && t.branch === branch);
  const pending = s.txs.filter(t => t.status === 'pending' && keep(t)).reverse();
  // with the changes from before the move to per-person keys, for members who read them (to show, never to undo)
  const done = [...s.before, ...s.txs].filter(t => t.status !== 'pending' && keep(t)).reverse();
  const day = (t: Tx) => new Date(t.at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn');
  return (
    <div class="page requests">
      <div class="phead">
        <h1>الطلبات</h1>
        {v ? (
          <div class="persona">
            <Avatar id={v} s={s} size={30} />
            <span>
              {s.isSample ? 'تعرض كـ ' : s.actingAs ? 'تعمل بصفة ' : ''}
              <b>{nameOf(s, v)}</b>
            </span>
            <SeatBadge s={s} id={v} />
          </div>
        ) : (
          <button class="btn small" onClick={() => set({ tab: 'me' })}>
            {s.isSample ? 'اختر من تكون' : 'اربط باسمك'}
          </button>
        )}
      </div>
      {s.seats.length === 0 && (
        <button class="card cta" onClick={() => set({ tab: s.rootAdmin && !s.isSample ? 'admin' : 'me' })}>
          <Icon name="key" />
          <span>
            <b>لم تُسلَّم المفاتيح بعد</b>
            <small>{s.rootAdmin && !s.isSample ? 'أنت مشرف العائلة: تعتمد الطلبات بنفسك حتى تسلّم المفاتيح من تبويب «الإدارة».' : 'لا يُعتمد أي طلب حتى يسلّم مشرف العائلة المفاتيح.'}</small>
          </span>
        </button>
      )}
      {v && s.txs.length > 0 && (
        <Seg cls="reqfilter" value={who} options={[['all', 'الكل'], ...(branch ? [['branch', 'فرعي'] as ['branch', string]] : []), ['mine', 'طلباتي']]} onChange={setWho} />
      )}
      {s.hidden.length > 0 && (
        <section>
          <h3>زيجات مخفية ({s.hidden.length})</h3>
          <p class="hint">لا يراها إلا الزوج والزوجة ومن يعتمدها. يُعلن الزواج متى أُضيف له ابن، وعند وفاة الزوج، أو متى أعلنه الزوج أو معتمده؛ والإعلان لا رجعة فيه.</p>
          {s.hidden.map(h => (
            <HiddenCard s={s} h={h} />
          ))}
        </section>
      )}
      <section>
        <h3>بانتظار الاعتماد ({pending.length})</h3>
        {pending.length === 0 && (
          <div class="card empty">
            <Icon name="inbox" />
            <span>
              {s.isSample
                ? 'لا طلبات الآن. أضف ابنًا أو ابنة من الشجرة لترى كيف يمر الطلب على حاملي المفاتيح.'
                : 'لا طلبات تنتظر الاعتماد. تظهر هنا طلبات الإضافة والتعديل حين يرسلها الأفراد، ليعتمدها حاملو المفاتيح.'}
            </span>
          </div>
        )}
        {pending.map(t => (
          <Card s={s} t={t} />
        ))}
      </section>
      {done.length > 0 && (
        <section>
          <h3>السجل</h3>
          {done.slice(0, shown).map(t => (
            <div class="card hist">
              <Icon name={t.status === 'approved' ? 'check' : 'x'} />
              <span>
                <b>{titleOf(s, t)}</b>
                <small>
                  {t.direct
                    ? 'مباشرة من مشرف العائلة'
                    : t.byAdmin
                      ? (t.status === 'approved' ? 'اعتمده' : 'رفضه') + ' مشرف العائلة' + (t.approvals.length ? '، بعد ' + t.approvals.map(a => byWho(s, a.by, a.via)).join('، ') : '')
                    : t.status === 'approved'
                      ? 'معتمد من ' + t.approvals.map(a => byWho(s, a.by, a.via) + (a.override ? ' (تجاوز بلاتيني)' : '')).join('، ')
                      : t.closed
                        ? 'أُغلق: من يخصه الطلب ليس في الشجرة'
                        : 'رفضه ' + byWho(s, t.rejectedBy!, t.rejectedVia)}
                  {t.via && ' · أرسله مشرف العائلة بصفة ' + nameOf(s, t.by)}
                  {' · ' + day(t)}
                </small>
              </span>
              {t.status === 'approved' && !t.revertOf && undoable(t) && !s.before.includes(t) && !isMinorViewer(s) && canAskOps(s, t.ops) && (
                <button class="btn small" onClick={() => proposeRevert(t.id)}>
                  <Icon name="undo" size={16} /> تراجع
                </button>
              )}
            </div>
          ))}
          {done.length > shown && (
            <button class="btn small" onClick={() => setShown(shown + 30)}>
              عرض المزيد ({done.length - shown})
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function Card({ s, t }: { s: State; t: Tx }) {
  const v = viewer(s);
  const admin = decides(s);
  const c = admin ? { ok: true, override: false } : canApprove(s.graph, s.seats, v, t);
  const need = NEED[t.level];
  const branch = t.branch ? s.graph.nodes.get(t.branch)?.name : null;
  const eligible = approversFor(s.graph, s.seats, t).slice(0, 4);
  return (
    <div class="card req">
      <div class="rq-top">
        <Avatar id={t.by} s={s} size={36} />
        <span>
          {t.via && 'مشرف العائلة بصفة '}
          <b>{nameOf(s, t.by)}</b> يطلب
          <small>{new Date(t.at).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })}</small>
        </span>
        <span class={'lvl ' + t.level}>{LEVEL_AR[t.level]}</span>
      </div>
      <h4>{titleOf(s, t)}</h4>
      {t.declared && (
        <div class="need warn">
          أُرسل على أنه {LEVEL_AR[t.declared.level]}
          {t.declared.branch !== t.branch ? ' من فرع ' + (t.declared.branch ? (s.graph.nodes.get(t.declared.branch)?.name ?? '؟') : 'العائلة') : ''}، وحسبته الهواتف من تغييراته.
        </div>
      )}
      <div class="need">
        <Icon name="key" size={15} /> يحتاج: {need.text}
        {branch ? ' من فرع ' + branch : ''} · تم {t.approvals.length} من {need.count}
      </div>
      {t.approvals.length > 0 && <div class="need ok">اعتمده: {t.approvals.map(a => byWho(s, a.by, a.via)).join('، ')}</div>}
      {c.ok ? (
        <>
          {admin && <div class="need">بصفتك مشرف العائلة: يُعتمد أو يُرفض بقرارك وحدك.</div>}
          <div class="acts">
            <button class="btn primary" onClick={() => approve(t.id)}>
              <Icon name="check" /> {c.override ? 'اعتماد (تجاوز بلاتيني)' : 'اعتماد'}
            </button>
            <button class="btn" onClick={() => reject(t.id)}>
              رفض
            </button>
          </div>
        </>
      ) : (
        <div class="who-can">
          <small>{c.why ?? 'لا يمكنك اعتماده'}. يمكن اعتماده من:</small>
          <div class="eligible">
            {eligible.map(e =>
              s.isSample ? (
                <button class="chip" onClick={() => set({ persona: e.holder })}>
                  <Icon name="eye" size={14} /> عرض كـ {nameOf(s, e.holder)} · {TIER_AR[e.tier]}
                </button>
              ) : (
                <span class="chip">
                  <Icon name="key" size={14} /> {nameOf(s, e.holder)} · {TIER_AR[e.tier]}
                </span>
              ),
            )}
            {eligible.length === 0 && seatOf(s.seats, v) == null && <small class="mut">لا يوجد حامل مفتاح متاح</small>}
          </div>
        </div>
      )}
    </div>
  );
}
