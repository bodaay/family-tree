import type { Alias } from '../data/types';
import { ALIAS_AR, ALIAS_TYPES, aliasProblem, nameKey } from '../data/names';
import { Icon } from './icons';

const PLACEHOLDER: Record<Alias['type'], string> = {
  kunya: 'مثل: أبو فهد، أم خالد',
  laqab: 'مثل: حمود، بو سعد',
  known: 'الاسم الذي تناديه به العائلة',
  previous: 'الاسم قبل تغييره',
  spelling: 'مثل: عايشة، Mohammed',
};

/** Why the alias being typed cannot be added, or null (also when nothing is typed). */
export function draftProblem(list: Alias[], draft: Alias): string | null {
  if (!draft.text.trim()) return null;
  return aliasProblem(draft.text) ?? (list.some(a => nameKey(a.text) === nameKey(draft.text)) ? 'هذا الاسم مسجل من قبل' : null);
}

/** The aliases with what is still typed in the box, as they will be saved. */
export function withDraft(list: Alias[], draft: Alias): Alias[] {
  return draft.text.trim() && !draftProblem(list, draft) ? [...list, { type: draft.type, text: draft.text.trim() }] : list;
}

/** Kunya, laqab and other names: remove any, or add one with its type. */
export function AliasEditor({ list, onList, draft, onDraft }: { list: Alias[]; onList: (l: Alias[]) => void; draft: Alias; onDraft: (a: Alias) => void }) {
  const why = draftProblem(list, draft);
  const add = () => {
    if (!draft.text.trim() || why) return;
    onList(withDraft(list, draft));
    onDraft({ type: draft.type, text: '' });
  };
  return (
    <div class="aliases">
      {list.length > 0 && (
        <div class="card list">
          {list.map((a, i) => (
            <div class="arow">
              <span class="pt">
                <small>{ALIAS_AR[a.type]}</small>
                <b>{a.text}</b>
              </span>
              <button class="btn sq small" aria-label={'حذف ' + a.text} onClick={() => onList(list.filter((_, j) => j !== i))}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div class="akinds">
        {ALIAS_TYPES.map(t => (
          <button class={t === draft.type ? 'on' : ''} onClick={() => onDraft({ ...draft, type: t })}>
            {ALIAS_AR[t]}
          </button>
        ))}
      </div>
      <div class="lineins">
        <input
          class="bigin"
          dir="auto"
          value={draft.text}
          placeholder={PLACEHOLDER[draft.type]}
          onInput={e => onDraft({ ...draft, text: (e.target as HTMLInputElement).value })}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button class="btn small" disabled={!draft.text.trim() || !!why} onClick={add}>
          <Icon name="plus" size={16} /> إضافة
        </button>
      </div>
      {why && <div class="warnbox">{why}</div>}
    </div>
  );
}
