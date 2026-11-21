import { useState } from 'preact/hooks';
import { set, mergePeople, type State } from '../data/store';
import { mergeOps, mergeProblem } from '../data/merge';
import { aliasesOf } from '../data/names';
import type { Alias } from '../data/types';
import { Icon } from './icons';
import { PersonRow, Sheet } from './common';

const FILLED: Record<string, string> = { birth: 'الميلاد', death: 'الوفاة', deceased: 'الوفاة', father: 'الأب', mother: 'الأم' };
const moving = (n: number) => (n === 1 ? 'واحد، ينتقل' : n === 2 ? 'اثنان، ينتقلان' : n + '، ينتقلون') + ' إلى السجل الباقي';

/** Root admin: one person entered twice. One record stays and takes the other's children and names. */
export function MergeSheet({ s, a, b }: { s: State; a: string; b: string }) {
  const [swapped, setSwapped] = useState(false);
  const keep = swapped ? b : a;
  const drop = swapped ? a : b;
  const g = s.graph;
  const close = () => set({ mergeFor: null, mergeWith: null });
  const why = mergeProblem(s, keep, drop);
  const ops = why ? [] : mergeOps(g, keep, drop);
  const kids = ops.filter(o => o.op === 'updatePerson' && o.id !== keep).length;
  const marriages = ops.filter(o => o.op === 'removeMarriage').length;
  const self = ops.find(o => o.op === 'updatePerson' && o.id === keep);
  const after = self?.op === 'updatePerson' ? self.after : {};
  const names = ((after.aliases ?? []) as Alias[]).slice(aliasesOf(g.nodes.get(keep)).length);
  const filled = [...new Set(Object.keys(after).filter(k => FILLED[k]).map(k => FILLED[k]))];
  return (
    <Sheet title="دمج سجلين" onClose={close} cls="merge">
      <p class="hint">لشخص واحد سُجّل مرتين. يبقى سجل واحد ويأخذ أبناء الآخر وأسماءه، ويُحذف الآخر.</p>
      <div class="card list">
        <div class="mtag">يبقى</div>
        <PersonRow s={s} id={keep} />
        <div class="mtag">
          يُدمج فيه ثم يُحذف
          <button class="btn small" onClick={() => setSwapped(!swapped)}>
            <Icon name="swap" size={16} /> تبديل
          </button>
        </div>
        <PersonRow s={s} id={drop} />
      </div>
      {why ? (
        <div class="warnbox">{why}</div>
      ) : (
        <div class="card review">
          <div>
            <small>الأبناء</small>
            <b>{kids ? moving(kids) : 'لا أبناء في السجل المحذوف'}</b>
          </div>
          {marriages > 0 && (
            <div>
              <small>الزواج</small>
              <b>{moving(marriages)}</b>
            </div>
          )}
          <div>
            <small>أسماء تُضاف إليه</small>
            <b>{names.length ? names.map(x => x.text).join('، ') : '—'}</b>
          </div>
          {filled.length > 0 && (
            <div>
              <small>يُكمَّل من السجل المحذوف</small>
              <b>{filled.join('، ')}</b>
            </div>
          )}
        </div>
      )}
      <p class="hint">يُحفظ مباشرة تغييرًا واحدًا لأنك مشرف العائلة، ويمكن التراجع عنه من السجل فيعود السجلان كما كانا.</p>
      <button class="btn primary wide" disabled={!!why} onClick={() => void mergePeople(keep, drop)}>
        <Icon name="merge" size={18} /> دمج
      </button>
    </Sheet>
  );
}
