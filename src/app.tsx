import { useEffect, useState } from 'preact/hooks';
import { useStore, set, viewer, decides, nameOf, endActing, type Tab } from './data/store';
import { canApprove } from './data/governance';
import { Icon } from './ui/icons';
import { themeOf } from './ui/common';
import { Home } from './ui/Home';
import { Relation } from './ui/Relation';
import { Requests } from './ui/Requests';
import { Me } from './ui/Me';
import { Admin, hasAdmin } from './ui/Admin';
import { Profile } from './ui/Profile';
import { Search } from './ui/Search';
import { AddChild } from './ui/AddChild';
import { Join } from './ui/Join';
import { KeyOverlays } from './ui/Keys';
import { InviteOverlay } from './ui/Invites';
import { Lock, Restore } from './ui/Lock';
import { KitOverlay } from './ui/Security';
import { AddLine } from './ui/AddLine';
import { EditPerson } from './ui/EditPerson';
import { DeathSheet } from './ui/Death';
import { ExportSheet } from './ui/Export';
import { MergeSheet } from './ui/Merge';
import { MilkSheet } from './ui/Milk';
import { KidsSheet, MarriageSheet, SpouseSheet } from './ui/Marriage';
import { applyFont } from './font';
import { reloadApp, useNewerVersion } from './update';
import { inBrowserOnIPhone } from './platform';
import { HomeScreenOnly } from './ui/HomeScreen';
import { useBack } from './ui/back';

const TABS: [Tab, string, string][] = [
  ['tree', 'tree', 'الشجرة'],
  ['relation', 'route', 'القرابة'],
  ['requests', 'inbox', 'الطلبات'],
  ['admin', 'key', 'الإدارة'],
  ['me', 'user', 'أنا'],
];

export function App() {
  const s = useStore();
  const theme = themeOf(s);
  const [, rerender] = useState(0);
  const [welcomeSeen, setWelcomeSeen] = useState(false);
  useEffect(() => {
    // re-lay out when the screen changes size (rotating, folding or unfolding)
    let t = 0;
    const onResize = () => { clearTimeout(t); t = window.setTimeout(() => rerender(x => x + 1), 120); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => applyFont(s.settings.font), [s.settings.font]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => rerender(x => x + 1);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);
  const newer = useNewerVersion();
  // back from another tab returns to the tree
  useBack(() => set({ tab: 'tree' }), s.status === 'ready' && s.tab !== 'tree');
  // an iPhone or iPad in a browser: the family opens only in its app on the Home Screen (a guest already in may stay)
  if (inBrowserOnIPhone() && s.status !== 'locked' && s.status !== 'loading' && !s.restore && (s.carry || (s.status === 'none' && !s.ended) || (s.status === 'ready' && s.mode === 'remote' && !s.guest))) {
    return (
      <div class={'app ' + theme}>
        <HomeScreenOnly s={s} />
        {s.toast && <div class="toast">{s.toast}</div>}
      </div>
    );
  }
  // a real family opens only on a phone linked to a person (or the root admin's)
  const needsInvite = s.status === 'ready' && s.mode === 'remote' && !s.me && !s.rootAdmin && !s.guest;
  if (s.status !== 'ready' || needsInvite || s.restore) {
    return (
      <div class={'app ' + theme}>
        {s.restore ? <Restore /> : s.status === 'locked' ? <Lock /> : <Join s={s} />}
      </div>
    );
  }
  const v = viewer(s);
  const actionable = s.txs.filter(t => t.status === 'pending' && (decides(s) || canApprove(s.graph, s.seats, v, t).ok)).length + s.hidden.filter(h => h.status === 'pending' && h.approver === v).length;
  const pendingAll = s.txs.filter(t => t.status === 'pending').length;
  // a tab always shows its page: an open profile (drawn under the bar) closes,
  // and the tab already shown goes back to its start, the whole tree
  const go = (id: Tab) => set(id === s.tab && !s.profile && id === 'tree' ? { focus: null } : { tab: id, profile: null });

  return (
    <div class={'app ' + theme + (s.actingAs ? ' acting' : '')}>
      {s.actingAs && (
        <div class="actbar" role="status">
          <Icon name="eye" size={16} />
          <span>
            تعمل بصفة <b>{nameOf(s, s.actingAs)}</b> · كل ما تفعله يُسجَّل
          </span>
          <button class="btn small" onClick={endActing}>
            إنهاء
          </button>
        </div>
      )}
      {s.tab === 'tree' && <Home s={s} />}
      {s.tab === 'relation' && <Relation s={s} />}
      {s.tab === 'requests' && <Requests s={s} />}
      {s.tab === 'admin' && (hasAdmin(s) ? <Admin s={s} /> : <Me s={s} />)}
      {s.tab === 'me' && <Me s={s} />}

      <nav class="tabs glass">
          {TABS.filter(([id]) => id !== 'admin' || hasAdmin(s)).map(([id, icon, label]) => (
            <button class={'tab' + (s.tab === id ? ' on' : '')} onClick={() => go(id)}>
              {id === 'requests' && (actionable || pendingAll) > 0 && <span class={'badge' + (actionable ? '' : ' quiet')}>{actionable || pendingAll}</span>}
              <Icon name={icon} />
              {label}
            </button>
          ))}
      </nav>

      {s.profile && <Profile s={s} id={s.profile} />}
      <KeyOverlays s={s} />
      <InviteOverlay s={s} />
      {s.spouseFor && s.graph.nodes.has(s.spouseFor) && <SpouseSheet s={s} id={s.spouseFor} />}
      {s.milkFor && s.graph.nodes.has(s.milkFor) && <MilkSheet s={s} id={s.milkFor} />}
      {s.marriageFor && s.graph.marriages.some(m => m.id === s.marriageFor) && <MarriageSheet s={s} id={s.marriageFor} />}
      {s.kidsFor && s.rootAdmin && s.graph.marriages.some(m => m.id === s.kidsFor) && <KidsSheet s={s} id={s.kidsFor} />}
      <KitOverlay s={s} />
      {/* under the search: «اختيار شخص آخر…» opens the search over it */}
      {s.exportFor && s.graph.nodes.has(s.exportFor.from) && <ExportSheet s={s} />}
      {s.searchOpen && <Search s={s} />}
      {s.addFor && <AddChild s={s} parent={s.addFor} />}
      {s.lineFrom && s.graph.nodes.has(s.lineFrom) && <AddLine s={s} from={s.lineFrom} />}
      {s.editFor && s.graph.nodes.has(s.editFor) && <EditPerson s={s} id={s.editFor} />}
      {s.deathFor && s.graph.nodes.has(s.deathFor) && <DeathSheet s={s} id={s.deathFor} />}
      {s.mergeFor && s.mergeWith && s.graph.nodes.has(s.mergeFor) && s.graph.nodes.has(s.mergeWith) && <MergeSheet key={s.mergeFor + s.mergeWith} s={s} a={s.mergeFor} b={s.mergeWith} />}
      {!s.me && !s.guest && !welcomeSeen && !s.searchOpen && (
        <div class="overlay" onClick={e => e.target === e.currentTarget && setWelcomeSeen(true)}>
          <div class="welcome glass">
            <div class="wl-mark">
              <Icon name="tree" size={34} />
            </div>
            <h2>أهلًا بك في شجرة {s.graph.family.name}</h2>
            <p>
              {s.graph.members} فردًا عبر {s.graph.maxGen + 1} أجيال.{' '}
              {s.isSample
                ? 'اختر اسمك لتظهر الشجرة من مكانك، وتطبّق قواعد الخصوصية كما ستكون لك.'
                : 'أنت مشرف العائلة. اربط هذا الهاتف باسمك في الشجرة (وإن لم تكن فيها بعد فأضف سلسلة نسبك من تبويب «أنا»)، ثم ادعُ الأفراد وسلّم المفاتيح من تبويب «الإدارة».'}
            </p>
            <button class="btn primary" onClick={() => { setWelcomeSeen(true); set({ searchOpen: 'me' }); }}>
              {s.isSample ? 'اختر اسمي' : 'اربط باسمي'}
            </button>
            <button class="btn" onClick={() => setWelcomeSeen(true)}>
              تصفّح أولًا
            </button>
          </div>
        </div>
      )}
      {newer && (
        <button class="updatebar" onClick={reloadApp}>
          <Icon name="refresh" size={16} /> نسخة أحدث من التطبيق · <b>تحديث</b>
        </button>
      )}
      {s.toast && <div class="toast">{s.toast}</div>}
    </div>
  );
}
