import { useState } from 'preact/hooks';
import { canSee, unitOf, type State } from '../data/store';
import { nasab } from '../data/graph';
import { aliasesOf } from '../data/names';
import { Icon } from './icons';
import { PersonRow, Sheet } from './common';

/**
 * Off: most names in the family repeat, so the question came up for other
 * people far more often than for someone already in the tree. The code stays,
 * to be turned back on here; meanwhile «للتمييز» is set from the editor.
 */
export const CHECK_DUPLICATES = false;

/**
 * Before someone is added: people already in the tree who may be the same
 * person. The user opens one to check, or carries on; a person they carried on
 * past is not asked about again in the same form.
 */
export function useDuplicateCheck(s: State, onOpen: (id: string) => void, same?: { ok: (id: string) => boolean; pick: (id: string) => void }) {
  const [passed, setPassed] = useState<string[]>([]);
  const [asking, setAsking] = useState<{ ids: string[]; then: () => void } | null>(null);
  const check = (ids: string[], then: () => void) => {
    const fresh = CHECK_DUPLICATES ? [...new Set(ids)].filter(id => canSee(s, id) && !passed.includes(id)) : [];
    if (fresh.length) setAsking({ ids: fresh, then });
    else then();
  };
  const sheet = asking && (
    <DuplicateSheet
      s={s}
      ids={asking.ids}
      onOpen={id => {
        setAsking(null);
        onOpen(id);
      }}
      onContinue={() => {
        setPassed([...passed, ...asking.ids]);
        setAsking(null);
        asking.then();
      }}
      onClose={() => setAsking(null)}
      // a brother or sister by the same name: carry on, and tell the two apart
      onSame={
        same && asking.ids.length === 1 && same.ok(asking.ids[0])
          ? () => {
              same.pick(asking.ids[0]);
              setPassed([...passed, ...asking.ids]);
              setAsking(null);
              asking.then();
            }
          : undefined
      }
    />
  );
  return { check, sheet };
}

function DuplicateSheet({ s, ids, onOpen, onContinue, onClose, onSame }: { s: State; ids: string[]; onOpen: (id: string) => void; onContinue: () => void; onClose: () => void; onSame?: () => void }) {
  const g = s.graph;
  const f = g.nodes.get(ids[0])!.sex === 'f';
  const question =
    ids.length === 1
      ? `هل ${f ? 'هي نفسها' : 'هو نفسه'} ${unitOf(s, ids[0])} ${nasab(g, ids[0], 3)}؟`
      : `هل ${f ? 'هي إحدى' : 'هو أحد'} هؤلاء؟`;
  return (
    <Sheet title={f ? 'قد تكون مسجلة من قبل' : 'قد يكون مسجلًا من قبل'} onClose={onClose} cls="dups">
      <div class="q small">{question}</div>
      <p class="hint">في الشجرة من يحمل هذا الاسم أو يُعرف به. افتح الملف للتأكد، أو تابع إن {f ? 'كانت' : 'كان'} شخصًا آخر.</p>
      <div class="card list">
        {ids.map(id => (
          <PersonRow
            s={s}
            id={id}
            aka={aliasesOf(g.nodes.get(id)).map(a => a.text).join(' · ')}
            onClick={() => onOpen(id)}
            right={
              <span class="link">
                فتح الملف <Icon name="chevL" size={14} />
              </span>
            }
          />
        ))}
      </div>
      {onSame && (
        <button class="btn primary wide" onClick={onSame}>
          {f ? 'لا، أخت أخرى بالاسم نفسه' : 'لا، أخ آخر بالاسم نفسه'}
        </button>
      )}
      <button class="btn wide" onClick={onContinue}>
        لا، {f ? 'هي شخص آخر' : 'هو شخص آخر'} · متابعة
      </button>
    </Sheet>
  );
}
