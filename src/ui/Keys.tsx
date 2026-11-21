import { useState } from 'preact/hooks';
import { set, nameOf, vacate, setMainBranches, type State } from '../data/store';
import { SEATS, TIER_AR } from '../data/governance';
import { nasab, unit, type Node } from '../data/graph';
import type { Seat, Tier } from '../data/types';
import { Icon } from './icons';
import { PersonRow, Sheet, genLabel } from './common';
import { openPermissions } from './Permissions';
import { useBack } from './back';

const BRANCH_TIERS: Tier[] = ['gold', 'silver'];

/**
 * The family's key seats. For now the root admin (مشرف العائلة) marks the main
 * branches and fills or empties the seats; everyone else sees who holds what.
 */
export function Keys({ s }: { s: State }) {
  const g = s.graph;
  const admin = s.rootAdmin;
  const slot = (tier: Tier, branch: string | null, x: Seat | undefined, label = TIER_AR[tier]) => (
    <button
      class={'keyrow ' + tier + (x ? '' : ' empty')}
      // a real family: a holder's key is managed from their profile; the sample keeps its seat sheet
      onClick={() => (x ? (admin && s.isSample ? set({ keySheet: x }) : openPermissions(x.holder)) : admin && set({ pickSeat: { tier, branch }, searchOpen: 'seat' }))}
    >
      <span class="kt">{label}</span>
      <span class="kn">{x ? nameOf(s, x.holder) : 'شاغر'}</span>
      {admin && <Icon name={x ? 'chevL' : 'plus'} size={16} />}
    </button>
  );
  return (
    <section>
      <h3>مفاتيح العائلة</h3>
      {admin && (
        <div class="card adminnote">
          <Icon name="key" />
          <span>
            <b>أنت مشرف العائلة على هذا الجهاز</b>
            <small>تحدد الفروع الرئيسية وتسلّم المفاتيح. كل تعيين يُوقَّع بمفتاح المشرف ويُحفظ في سجل العائلة.</small>
          </span>
        </div>
      )}
      <div class="keys">
        {slot('platinum', null, s.seats.find(x => x.tier === 'platinum'), 'بلاتيني · رأس العائلة')}
        {g.branches.map(b => {
          const head = g.nodes.get(b)!;
          const living = [...g.nodes.values()].some(n => n.branch === b && !n.dead && !n.external);
          return (
            <div class="keyblock">
              <div class="kb">
                فرع {head.name} <small>· {people(head.desc + 1)}</small>
              </div>
              {living ? (
                BRANCH_TIERS.flatMap(tier => {
                  const held = s.seats.filter(x => x.tier === tier && x.branch === b);
                  return Array.from({ length: SEATS[tier] }, (_, i) => slot(tier, b, held[i]));
                })
              ) : (
                <div class="keyrow">
                  <span class="kt mut">لا يوجد أحياء مسجلون في هذا الفرع بعد</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {admin && (
        <button class="btn small" onClick={() => set({ branchEditor: true })}>
          <Icon name="layers" size={16} /> الفروع الرئيسية
        </button>
      )}
      <p class="hint">
        {admin
          ? 'لا يحمل أحد مفتاحين: من يُسلَّم مفتاحًا جديدًا يُخلى مقعده السابق. الانتخابات تأتي لاحقًا، ويبقى المشرف إلى جانب المفاتيح حتى تقرر العائلة غير ذلك.'
          : `يسلّم مشرف العائلة${s.adminBy ? ' (' + nameOf(s, s.adminBy) + ')' : ''} المفاتيح حاليًا، وتأتي الانتخابات لاحقًا.`}
      </p>
    </section>
  );
}

function people(n: number): string {
  return n === 1 ? 'فرد واحد' : n === 2 ? 'فردان' : n <= 10 ? n + ' أفراد' : n + ' فردًا';
}

/** Shown above the tab bar, so they live at the app level like the other overlays. */
export function KeyOverlays({ s }: { s: State }) {
  if (s.keySheet) return <SeatSheet s={s} x={s.keySheet} onClose={() => set({ keySheet: null })} />;
  if (s.branchEditor) return <Branches s={s} onClose={() => set({ branchEditor: false })} />;
  return null;
}

function SeatSheet({ s, x, onClose }: { s: State; x: Seat; onClose: () => void }) {
  const where = x.branch ? 'فرع ' + s.graph.nodes.get(x.branch)!.name : 'رأس العائلة';
  return (
    <Sheet title={'مفتاح ' + TIER_AR[x.tier] + ' · ' + where} onClose={onClose}>
      <div class="card list">
        <PersonRow s={s} id={x.holder} onClick={() => { onClose(); set({ profile: x.holder }); }} />
      </div>
      <button class="btn primary wide" onClick={() => { onClose(); set({ pickSeat: { tier: x.tier, branch: x.branch, replaces: x.holder }, searchOpen: 'seat' }); }}>
        تسليم المفتاح لشخص آخر
      </button>
      <button class="btn wide" onClick={() => { if (confirm(`إخلاء مقعد ${nameOf(s, x.holder)}؟`)) { onClose(); vacate(x.holder); } }}>
        إخلاء المقعد
      </button>
    </Sheet>
  );
}

/** Choosing the main branches: founders may not overlap, so picking one clears its ancestors and descendants. */
function Branches({ s, onClose }: { s: State; onClose: () => void }) {
  useBack(onClose);
  const g = s.graph;
  const [sel, setSel] = useState<string[]>(g.branches);
  const rows: Node[] = [];
  const walk = (id: string) => {
    const n = g.nodes.get(id)!;
    if (n.gen > 4) return;
    if (!n.familyRoot && n.sex === 'm' && (n.gen === 1 || n.desc > 0 || sel.includes(id))) rows.push(n);
    n.kids.forEach(walk);
  };
  walk(g.root);
  const headOf = (id: string, picked: string[]) => {
    for (let p: string | null = id; p; p = g.nodes.get(p)!.parent) if (picked.includes(p)) return p;
    return null;
  };
  const toggle = (id: string) => {
    if (sel.includes(id)) return setSel(sel.filter(x => x !== id));
    setSel([...sel.filter(x => headOf(x, [id]) !== id && headOf(id, [x]) !== x), id]);
  };
  const ordered = rows.map(n => n.id).filter(id => sel.includes(id));
  const lost = s.seats.filter(x => x.tier !== 'platinum' && headOf(x.holder, ordered) !== x.branch);
  const changed = ordered.join() !== g.branches.join();
  const save = () => {
    if (lost.length && !confirm(`سيُخلى ${lost.length} من المقاعد لأن أصحابها لم يعودوا في فروعها. متابعة؟`)) return;
    setMainBranches(ordered);
    onClose();
  };
  return (
    <div class="overlay full">
      <div class="searchpage">
        <div class="shead">
          <button class="round" onClick={onClose} aria-label="إغلاق">
            <Icon name="chevR" />
          </button>
          <b>الفروع الرئيسية</b>
        </div>
        <p class="hint">
          اختر رؤوس الفروع الرئيسية. لكل فرع ذهبيان وثلاثة فضيين، ويعتمد كل فرع ما يخص أفراده. من فوق رؤوس الفروع هم جذع العائلة، وتغييراتهم
          تحتاج البلاتيني وذهبيًا من كل فرع.
        </p>
        <div class="picked">
          {ordered.map(id => (
            <span class="tag">فرع {g.nodes.get(id)!.name}</span>
          ))}
        </div>
        <div class="results">
          {rows.map(n => (
            <button class={'brow' + (sel.includes(n.id) ? ' on' : '')} style={{ paddingInlineStart: 8 + (n.gen - 1) * 18 + 'px' }} onClick={() => toggle(n.id)}>
              <span class="tick">{sel.includes(n.id) && <Icon name="check" size={16} />}</span>
              <span class="pt">
                <b>
                  {unit(n)} <small class="mut">{nasab(g, n.id, 2)}</small>
                </b>
                <small>
                  {genLabel(n.gen)} · {n.desc} من الذرية
                </small>
              </span>
            </button>
          ))}
        </div>
        <div class="bfoot">
          <button class="btn primary wide" disabled={!changed || !ordered.length} onClick={save}>
            حفظ · {ordered.length} {ordered.length > 2 && ordered.length < 11 ? 'فروع' : 'فرع'}
          </button>
        </div>
      </div>
    </div>
  );
}
