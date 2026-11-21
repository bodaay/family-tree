import { useState } from 'preact/hooks';
import { set, getState, viewer, nameOf, resetDemo, leaveFamily, currentMembership, serverView, logSize, isMinorViewer, type State } from '../data/store';
import { Keys } from './Keys';
import { hasAdmin } from './Admin';
import { ExportLog } from './Export';
import { Security } from './Security';
import { MyDevices } from './Devices';
import { FONTS, type FontKey } from '../font';
import { install, isInstalled, isIOS } from '../install';
import { reloadApp } from '../update';
import { TIER_AR, seatOf } from '../data/governance';
import type { Seat } from '../data/types';
import { Icon } from './icons';
import { Avatar, PersonRow, Seg, SeatBadge } from './common';

export function Me({ s }: { s: State }) {
  const g = s.graph;
  const v = viewer(s);
  const plat = s.seats.filter(x => x.tier === 'platinum');
  const byBranch = new Map<string, Seat[]>();
  for (const x of s.seats) if (x.branch) byBranch.set(x.branch, [...(byBranch.get(x.branch) ?? []), x]);
  const settings = s.settings;
  const put = (p: Partial<State['settings']>) => set({ settings: { ...getState().settings, ...p } });
  return (
    <div class="page me">
      <div class="phead">
        <h1>أنا</h1>
      </div>

      {s.guest ? (
        <section>
          <h3>زائر</h3>
          <div class="card cta">
            <Icon name="eye" />
            <span>
              <b>{s.guest.label}</b>
              <small>تشاهد شجرة {g.family.name} كاملة، دون طلبات أو اعتمادات. إن أُنهيت المشاهدة تُحذف بيانات العائلة من هذا الهاتف.</small>
            </span>
          </div>
        </section>
      ) : (
      <section>
        <h3>{s.isSample ? 'من أنت في الشجرة؟' : 'أنت في الشجرة'}</h3>
        {s.me ? (
          <div class="card">
            <PersonRow s={s} id={s.me} onClick={() => set({ profile: s.me })} right={<SeatBadge s={s} id={s.me} />} />
            {!s.isSample && (
              <p class="hint">
                {isMinorViewer(s)
                  ? 'هذا الجهاز مرتبط بك. تشاهد الشجرة، والتعديل والطلبات متاحة من سن 18.'
                  : `هذا الجهاز مرتبط بك${s.rootAdmin ? ' بصفتك مشرف العائلة' : ''}، وكل طلب أو اعتماد منه يُنسب إليك.`}
              </p>
            )}
            {(s.isSample || s.rootAdmin) && (
              <button class="btn small" onClick={() => set({ searchOpen: 'me' })}>
                تغيير
              </button>
            )}
          </div>
        ) : (
          <button class="card cta" onClick={() => set({ searchOpen: 'me' })}>
            <Icon name="user" />
            <span>
              <b>{s.isSample ? 'اختر اسمك' : 'اربط نفسك بالشجرة'}</b>
              <small>{s.isSample ? 'لتظهر الشجرة من مكانك، وتطبق قواعد الخصوصية كما ستكون لك.' : 'اختر اسمك في الشجرة ليرتبط به هذا الجهاز، فتطلب وتعتمد باسمك.'}</small>
            </span>
          </button>
        )}
        {s.rootAdmin && !s.isSample && (
          <button class="card cta" onClick={() => set({ searchOpen: 'line' })}>
            <Icon name="plus" />
            <span>
              <b>{s.me ? 'إضافة سلسلة نسب' : 'لست في الشجرة بعد؟'}</b>
              <small>اختر أقرب جد موجود، ثم اكتب الأسماء جيلًا بعد جيل حتى تصل إليك. تُضاف مباشرة لأنك مشرف العائلة.</small>
            </span>
          </button>
        )}
        {s.seesAll && s.me && <p class="hint">لديك مشاهدة الكل: ترى كل الأسماء في الشجرة.</p>}
      </section>
      )}

      {!s.isSample && !s.guest && s.me && <MyDevices s={s} />}

      {!isInstalled() && (
        <section>
          <div class="card cta install">
            <Icon name="tree" />
            <span>
              <b>ثبّت «{g.family.name}» كتطبيق</b>
              <small>
                {s.installable
                  ? 'يفتح من الشاشة الرئيسية بملء الشاشة، دون شريط المتصفح.'
                  : isIOS()
                    ? // the installed app keeps its own storage: it starts without this device's access
                      'في Safari: زر المشاركة ثم «إضافة إلى الشاشة الرئيسية». التطبيق المثبّت لا يرى دخولك هنا: ' +
                      (s.rootAdmin && !s.isSample
                        ? 'افتحه وألصق فيه رابط المشرف أو امسح رمزه.'
                        : s.isSample
                          ? 'افتحه وألصق فيه رابط دعوتك أو امسح رمزها.'
                          : s.me
                            ? // the installed app is another device of theirs (أجهزتي)
                              'هو جهاز آخر لك: من «أجهزتي» أعلاه اختر «إضافة جهاز» وانسخ الرابط، ثم ألصقه في التطبيق.'
                            : 'دعوتك استُخدمت في Safari، فاطلب من مشرف العائلة «جهاز جديد» وافتح الدعوة الجديدة في التطبيق.')
                    : 'من قائمة المتصفح (⋮) اختر «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق»، ثم افتحه من الشاشة الرئيسية.'}
              </small>
            </span>
            {s.installable && (
              <button class="btn primary small" onClick={() => void install()}>
                تثبيت
              </button>
            )}
          </div>
        </section>
      )}

      {/* in the sample family only to switch off a lock left on from a real family */}
      {(!s.isSample || s.lock) && <Security s={s} />}

      {s.isSample && <section>
        <h3>عرض التطبيق كـ</h3>
        <p class="hint">للعرض التجريبي: جرّب التطبيق بعين أي حامل مفتاح لترى الاعتمادات والخصوصية من مكانه.</p>
        <div class="card list">
          {s.me && (
            <button class={'prow' + (s.persona == null ? ' on' : '')} onClick={() => set({ persona: null, relA: s.me })}>
              <Avatar id={s.me} s={s} size={34} />
              <span class="pt">
                <b>أنا ({nameOf(s, s.me)})</b>
                <small>{seatOf(s.seats, s.me) ? 'مفتاح ' + TIER_AR[seatOf(s.seats, s.me)!.tier] : 'عضو'}</small>
              </span>
              {s.persona == null && <Icon name="check" />}
            </button>
          )}
          {s.seats.length === 0 && <p class="hint">لم تُسلَّم المفاتيح بعد.</p>}
          {[...plat, ...[...byBranch.values()].flat()].filter(x => x.holder !== s.me).map(x => (
            <button class={'prow' + (s.persona === x.holder ? ' on' : '')} onClick={() => set({ persona: x.holder, relA: x.holder })}>
              <Avatar id={x.holder} s={s} size={34} />
              <span class="pt">
                <b>{nameOf(s, x.holder)}</b>
                <small>
                  مفتاح {TIER_AR[x.tier]}
                  {x.branch ? ' · فرع ' + g.nodes.get(x.branch)!.name : ' · رأس العائلة'}
                </small>
              </span>
              {s.persona === x.holder && <Icon name="check" />}
            </button>
          ))}
        </div>
        {v && s.persona && (
          <button class="btn small" onClick={() => set({ persona: null })}>
            الرجوع إلى حسابي
          </button>
        )}
      </section>}

      {/* who holds the keys: on «الإدارة» for those who run the family */}
      {!hasAdmin(s) && <Keys s={s} />}
      {/* a gold exports their branch from here (the root admin and the platinum holder, from «الإدارة») */}
      {!hasAdmin(s) && <ExportLog s={s} />}

      <section>
        <h3>الإعدادات</h3>
        <div class="card set">
          <div class="srow">
            <span>المظهر</span>
            <Seg value={settings.theme} options={[['system', 'تلقائي'], ['light', 'فاتح'], ['dark', 'داكن']]} onChange={theme => put({ theme })} />
          </div>
          <div class="srow">
            <span>الخط</span>
            <div class="seg">
              {(Object.keys(FONTS) as FontKey[]).map(k => (
                <button class={settings.font === k ? 'on' : ''} style={{ fontFamily: FONTS[k].family }} onClick={() => put({ font: k })}>
                  {FONTS[k].label}
                </button>
              ))}
            </div>
          </div>
          <div class="srow">
            <span>التقويم</span>
            <Seg value={settings.cal} options={[['g', 'ميلادي'], ['h', 'هجري']]} onChange={cal => put({ cal })} />
          </div>
          {s.isSample && <div class="srow">
            <span>
              قواعد الخصوصية
              <small>عند الإيقاف تظهر كل الأسماء (للمقارنة فقط)</small>
            </span>
            <Seg value={settings.privacy ? 'on' : 'off'} options={[['on', 'مفعّلة'], ['off', 'موقوفة']]} onChange={x => put({ privacy: x === 'on' })} />
          </div>}
          <div class="srow">
            <span>
              التطبيق
              <small>إعادة تحميله بأحدث نسخة، بدل إغلاقه وفتحه</small>
            </span>
            <button class="btn small" onClick={reloadApp}>
              <Icon name="refresh" size={16} /> تحديث
            </button>
          </div>
        </div>
      </section>

      <Family s={s} />
    </div>
  );
}

function Family({ s }: { s: State }) {
  const [raw, setRaw] = useState(false);
  const m = currentMembership();
  return (
    <section>
      <h3>العائلة والمزامنة</h3>
      <div class="card set">
        <div class="srow">
          <span>الحالة</span>
          <b class={s.isSample ? '' : s.online ? 'ok' : 'warn'}>{s.isSample ? 'عائلة تجريبية على هذا الجهاز' : s.online ? 'متصل · مشفّر من طرف إلى طرف' : 'غير متصل'}</b>
        </div>
        {s.sealedEra && (
          <div class="srow">
            <span>تفاصيل النساء</span>
            <b>{s.movedDiffers ? 'لقطة الانتقال لا تطابق ما قرأه هذا الهاتف' : `مختومة بمفاتيحهن · يفتح هذا الهاتف ${s.opened.size}`}</b>
          </div>
        )}
        {s.movedDiffers && <div class="warnbox">لقطة الانتقال إلى مفاتيح النساء لا تطابق ما قرأه هذا الهاتف من السجل قبلها. أخبر مشرف العائلة.</div>}
        <div class="srow">
          <span>المصدر</span>
          <b>{s.graph.family.source ?? '—'}</b>
        </div>
        <div class="srow">
          <span>الأفراد · التغييرات في السجل</span>
          <b>
            {s.graph.members} · {Math.max(0, logSize() - 1)}
          </b>
        </div>
      </div>
      {m && (
        <>
          <button class="btn small" onClick={() => setRaw(!raw)}>
            <Icon name="eye" size={16} /> ماذا يرى الخادم؟
          </button>
          {raw && (
            <div class="card raw">
              <p class="hint">هذا ما يخزّنه الخادم من آخر التغييرات: بيانات مشفّرة وتواقيع فقط، دون أي اسم.</p>
              {serverView().map(e => (
                <pre dir="ltr">{`#${e.n}  at ${new Date(e.at).toISOString().slice(0, 16)}\npub ${e.pub.slice(0, 24)}…\nkey ${e.kid}\nct  ${e.ct.slice(0, 64)}…\nsig ${e.sig.slice(0, 32)}…`}</pre>
              ))}
            </div>
          )}
        </>
      )}
      {s.isSample && (
        <button class="btn small" onClick={() => confirm('إعادة العائلة التجريبية إلى أصلها؟') && resetDemo()}>
          <Icon name="refresh" size={16} /> إعادة البيانات التجريبية
        </button>
      )}
      <button
        class="btn small"
        onClick={() =>
          confirm(s.isSample ? 'الخروج من العائلة التجريبية؟' : s.rootAdmin ? 'إزالة العائلة من هذا الجهاز؟ سيُحذف منه مفتاح المشرف أيضًا، وتحتاج رابط المشرف لاستعادته.' : 'إزالة العائلة من هذا الجهاز؟ ستحتاج رابط الدعوة للعودة.') &&
          leaveFamily()
        }
      >
        <Icon name="x" size={16} /> {s.isSample ? 'الخروج من العائلة التجريبية' : 'إزالة العائلة من هذا الجهاز'}
      </button>
      {!s.isSample && (
        <p class="hint">
          {s.lock
            ? 'مفتاح العائلة محفوظ في هذا المتصفح مشفّرًا، ولا يُفتح إلا ببصمتك.'
            : 'مفتاح العائلة محفوظ في هذا المتصفح دون قفل. فعّل قفل البصمة من «الأمان» أعلاه.'}
        </p>
      )}
    </section>
  );
}
