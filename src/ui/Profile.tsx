import { set, toast, viewer, canSee, nameOf, proposeRevert, deletePerson, isMinorViewer, canAsk, canAskOps, asksNote, mayWiden, reachFor, revealHidden, type State } from '../data/store';
import { titleOf, undoable } from '../data/history';
import { ancestorsOf, familiesOf, milkKidsOf, milkOf, milkSiblingsOf, opTouches, siblingsOf } from '../data/graph';
import { removeMilk, setMilkCertain } from '../data/milk';
import { marriageText, marriageVisible } from '../data/marriages';
import { kin, termFor, degreeText, degreeWord, headline, routes } from '../data/kinship';
import { Icon } from './icons';
import { Avatar, CalSeg, PersonRow, SeatBadge, YearText, deadMark, genLabel, lineOf, yearShort } from './common';
import { addFor, addSpouseFor } from './Home';
import { Permissions } from './Permissions';
import { WhoSees } from './WhoSees';
import { mayExport } from '../export/build';
import { THIS_YEAR, gYear } from '../data/dates';
import { ALIAS_AR, aliasesOf } from '../data/names';
import { useRef } from 'preact/hooks';
import { useBack, useBackSteps } from './back';

export function Profile({ s, id }: { s: State; id: string }) {
  // a person opened from this profile is a step that back returns from, as is a page in any app
  const trail = useRef<string[]>([]);
  const t = trail.current;
  if (t[t.length - 1] !== id) {
    const i = t.lastIndexOf(id);
    trail.current = i >= 0 ? t.slice(0, i + 1) : [...t, id];
  }
  const back = () => set({ profile: trail.current.length > 1 ? trail.current[trail.current.length - 2] : null });
  useBack(() => set({ profile: null }));
  useBackSteps(trail.current.length - 1, k => set({ profile: trail.current[k] }));
  const g = s.graph;
  const n = g.nodes.get(id);
  if (!n) return null;
  const vis = canSee(s, id);
  const v = viewer(s);
  const k = v && v !== id ? kin(g, v, id) : null;
  const fams = familiesOf(g, id);
  const sibs = siblingsOf(g, id);
  const kids = [...new Set(fams.flatMap(f => f.kids))];
  const milkRecs = milkOf(g, id);
  const milkKids = milkKidsOf(g, id);
  const milkSibs = milkSiblingsOf(g, id);
  const males = (ids: string[]) => ids.filter(x => g.nodes.get(x)!.sex === 'm').length;
  // with the changes from before the move to per-person keys, for members who read them (to show, never to undo)
  const history = [...s.before, ...s.txs].filter(t => t.subject === id || t.ops.some(o => opTouches(g, o, id)));
  const age = n.by != null ? (n.dead ? (gYear(n.death) ?? null) : THIS_YEAR) : null;
  const branch = n.branch ? g.nodes.get(n.branch)!.name : null;
  const house = n.house && n.house !== n.id ? g.nodes.get(n.house)!.name : null;
  const chain = [...ancestorsOf(g, id)].reverse();
  // a woman's other names follow her details' visibility
  const aliases = vis ? aliasesOf(n) : [];
  // a guest only looks; so does a member under 18, and anyone about someone beyond the family's limit on requests
  const looks = !!s.guest || isMinorViewer(s);
  const ro = looks || !canAsk(s, id);
  const canName = vis && !n.familyRoot && !ro && ((s.rootAdmin && !s.isSample) || !!v);
  // anyone who may send requests about them corrects their details, as a request (the founder's, the root admin)
  const canEdit = canName;
  // a death, as a request (the root admin records it in «تعديل»); never one's own
  const canDie = vis && !n.familyRoot && !n.dead && !ro && !!v && v !== id && !(s.rootAdmin && !s.isSample);
  const dying = s.txs.some(t => t.status === 'pending' && t.ops.some(o => o.op === 'updatePerson' && o.id === id && 'deceased' in o.after));
  // a child or a brother or sister: the whole name and the years, a tap away
  const member = (c: string) => (
    <button class="fp" onClick={() => set({ profile: c })}>
      <Avatar id={c} s={s} size={30} />
      <span>
        <b>{nameOf(s, c)}</b>
        <small>{yearShort(s, c) || ' '}</small>
      </span>
    </button>
  );

  return (
    <div class="page profile">
      <div class="phero">
        <div class="navbtns">
          <button class="round glass" onClick={back} aria-label="رجوع">
            <Icon name="chevR" />
          </button>
          <span class="navend">
            {((s.rootAdmin && !s.isSample) || canEdit) && (
              <button class="round glass" onClick={() => set({ editFor: id })} aria-label="تعديل البيانات">
                <Icon name="edit" />
              </button>
            )}
            <button class="round glass" onClick={() => set({ profile: null, focus: id, tab: 'tree' })} aria-label="في الشجرة">
              <Icon name="tree" />
            </button>
          </span>
        </div>
      </div>
      <div class="pc">
        <Avatar id={id} s={s} size={104} />
        <h1>{nameOf(s, id)}</h1>
        <div class="ns">{vis ? lineOf(s, id) : 'تفاصيلها تظهر للأقارب حتى الدرجة ' + degreeWord(reachFor(s, id) ?? 3)}</div>
        {aliases.length > 0 && (
          <div class="aka">
            {n.sex === 'f' ? 'تُعرف بـ' : 'يُعرف بـ'} {aliases.map(a => a.text).join(' · ')}
          </div>
        )}
        <div class="tags">
          {n.dead && !n.familyRoot && <span class="tag">{deadMark(s, id)}</span>}
          <SeatBadge s={s} id={id} />
          {k && (
            <span class="tag rel">
              {headline(routes(g, v!, id)) || termFor(g, v!, id, k)} · {degreeText(k.deg).replace('قرابة من ', '')}
            </span>
          )}
          {n.uncertain && <span class="tag warn">الارتباط بالأب غير مؤكد</span>}
        </div>
      </div>

      <section>
        <div class="hrow">
          <h3>نبذة</h3>
          <CalSeg s={s} />
        </div>
        <div class="stats">
          <div class="stat">
            <small>الميلاد</small>
            {vis && n.birth ? <YearText s={s} y={n.birth} /> : <b>—</b>}
          </div>
          {n.dead && n.death ? (
            <div class="stat">
              <small>الوفاة</small>
              <YearText s={s} y={n.death} />
            </div>
          ) : (
            <div class="stat">
              <small>العمر</small>
              <b>{vis && age && n.by ? age - n.by : '—'}</b>
            </div>
          )}
          <div class="stat">
            <small>الجيل</small>
            <b>{genLabel(n.gen).replace('الجيل ', '')}</b>
            <i>{house ? 'بيت ' + house : branch ? 'فرع ' + branch : g.family.name}</i>
          </div>
        </div>
        <div class="stats two">
          <div class="stat">
            <small>الأبناء</small>
            <b>{kids.length}</b>
            {kids.length > 0 && <i>ذكور {males(kids)} · إناث {kids.length - males(kids)}</i>}
          </div>
          <div class="stat">
            <small>الإخوة والأخوات</small>
            {/* no parent in the tree (an outside spouse, the family's anchor): not known */}
            <b>{n.parent ? sibs.length : '—'}</b>
            {sibs.length > 0 && <i>ذكور {males(sibs)} · إناث {sibs.length - males(sibs)}</i>}
          </div>
        </div>
        {canDie &&
          (dying ? (
            <p class="hint">{n.sex === 'f' ? 'عليها' : 'عليه'} طلب وفاة بانتظار الاعتماد.</p>
          ) : (
            <button class="link deathlink" onClick={() => set({ deathFor: id })}>
              تسجيل وفاة
            </button>
          ))}
      </section>


      <section>
        <div class="hrow">
          <h3>الأسرة</h3>
          {!ro && (
            <button class="link" onClick={() => addFor(s, id)}>
              + إضافة ابن أو ابنة
            </button>
          )}
        </div>
        {!looks && ro && !n.familyRoot && <p class="hint asksnote">{(n.sex === 'f' ? 'لا ترسل طلبات عنها: ' : 'لا ترسل طلبات عنه: ') + asksNote(s) + '.'}</p>}
        {fams.length === 0 && <p class="hint">لا أبناء مسجلون.</p>}
        {fams.map(f => {
          const m = f.marriage;
          // the status and years are details: for those who may see both spouses
          const shown = m && marriageVisible(s, m);
          return (
            <div class="card fam">
              {f.spouse ? (
                <PersonRow s={s} id={f.spouse} onClick={() => set({ profile: f.spouse })} />
              ) : (
                <div class="famh">الأبناء{fams.length > 1 ? (n.sex === 'm' ? ' (الأم غير مسجلة)' : ' (الأب غير مسجل)') : ''}</div>
              )}
              {m && shown && (
                <div class="mline">
                  <span>
                    {m.hidden && <span class="tag">مخفي</span>} {marriageText(s, m)}
                  </span>
                  {/* hidden: only revealed (by its approver or the husband), never changed in the open */}
                  {m.hidden
                    ? !looks &&
                      (v === m.husband || v === s.hidden.find(h => h.id === m.id)?.approver) && (
                        <button class="link" onClick={() => confirm('إعلان الزواج للعائلة كلها؟ يصير زواجًا عاديًا في الشجرة، ولا رجعة فيه.') && revealHidden(m.id)}>
                          إعلان
                        </button>
                      )
                    : !ro && (
                        <button class="link" onClick={() => set({ marriageFor: m.id })}>
                          تعديل
                        </button>
                      )}
                </div>
              )}
              {f.kids.length > 0 ? (
                <div class="fkids">{f.kids.map(c => member(c))}</div>
              ) : (
                <small class="nokids">لا أبناء مسجلون</small>
              )}
              {/* the root admin ticks which children are this marriage's, from one list */}
              {m && !m.hidden && s.rootAdmin && !s.isSample && !ro && (
                <button class="link kidslink" onClick={() => set({ kidsFor: m.id })}>
                  ربط أبناء
                </button>
              )}
            </div>
          );
        })}
        {!ro && !n.external && !n.familyRoot && vis && (
          <button class="card cta addsp" onClick={() => addSpouseFor(s, id)}>
            + {n.sex === 'm' ? 'إضافة زوجة' : 'إضافة زوج'}
          </button>
        )}
        {sibs.length > 0 && (
          <div class="card fam">
            <div class="famh">{n.sex === 'm' ? 'إخوته وأخواته' : 'إخوتها وأخواتها'}</div>
            <div class="fkids">{sibs.map(c => member(c))}</div>
          </div>
        )}
      </section>

      {/* milk kinship (design document 1.36): whom they were nursed by, their milk brothers and sisters, whom they nursed */}
      {(milkRecs.length > 0 || milkKids.length > 0 || (!ro && vis && !n.external && !n.familyRoot)) && (
        <section class="milk">
          <div class="hrow">
            <h3>الرضاعة</h3>
            {!ro && vis && !n.external && !n.familyRoot && (
              <button class="link" onClick={() => set({ milkFor: id, milkPick: null })}>
                + إضافة رضاعة
              </button>
            )}
          </div>
          {milkRecs.map(m => (
            <div class="card fam milkrec">
              <PersonRow s={s} id={m.nurse} onClick={() => set({ profile: m.nurse })} right={<small class="mut">{n.sex === 'm' ? 'أرضعته' : 'أرضعتها'}</small>} />
              {m.father && <PersonRow s={s} id={m.father} onClick={() => set({ profile: m.father! })} right={<small class="mut">الأب من الرضاعة</small>} />}
              <div class="mline">
                <span>{m.uncertain ? <span class="tag">غير مؤكدة</span> : 'رضاعة مؤكدة'}</span>
                {!ro && (
                  <span>
                    <button class="link" onClick={() => setMilkCertain(m.id, !m.uncertain)}>
                      {m.uncertain ? 'اجعلها مؤكدة' : 'اجعلها غير مؤكدة'}
                    </button>
                    {' · '}
                    <button class="link danger" onClick={() => confirm('حذف هذه الرضاعة من الشجرة؟ يُحفظ في السجل ويمكن التراجع عنه.') && removeMilk(m.id)}>
                      حذف
                    </button>
                  </span>
                )}
              </div>
            </div>
          ))}
          {milkSibs.length > 0 && (
            <div class="card fam">
              <div class="famh">{n.sex === 'm' ? 'إخوته وأخواته من الرضاعة' : 'إخوتها وأخواتها من الرضاعة'}</div>
              <div class="fkids">{milkSibs.map(c => member(c))}</div>
            </div>
          )}
          {milkKids.length > 0 && (
            <div class="card fam">
              <div class="famh">{n.sex === 'f' ? 'أرضعت' : 'أبناؤه من الرضاعة'}</div>
              <div class="fkids">{milkKids.map(c => member(c))}</div>
            </div>
          )}
          {!milkRecs.length && !milkKids.length && <p class="hint">لا رضاعة مسجلة. سجّل من {n.sex === 'm' ? 'أرضعته' : 'أرضعتها'} إن كانت غير {n.sex === 'm' ? 'أمه' : 'أمها'}، فتظهر القرابة التي تنشأ عنها.</p>}
        </section>
      )}

      {!n.external && (
        <section>
          <div class="hrow">
            <h3>النسب</h3>
          </div>
          <div class="chainline">
            {chain.map(a => (
              <>
                <button onClick={() => set({ profile: a })}>{nameOf(s, a)}</button>
                <Icon name="chevL" size={12} />
              </>
            ))}
            <span class="cur">{nameOf(s, id)}</span>
          </div>
        </section>
      )}

      {vis && !n.familyRoot && (aliases.length > 0 || canName) && (
        <section>
          <div class="hrow">
            <h3>أسماء أخرى</h3>
            {canName && (
              <button class="link" onClick={() => set({ editFor: id })}>
                {aliases.length ? 'تعديل' : '+ إضافة كنية أو لقب'}
              </button>
            )}
          </div>
          {aliases.length ? (
            <div class="card list aliases">
              {aliases.map(a => (
                <div class="arow">
                  <span class="pt">
                    <small>{ALIAS_AR[a.type]}</small>
                    <b>{a.text}</b>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p class="hint">{n.sex === 'f' ? 'لا كنية ولا لقب بعد. أضف ما تُعرف به، فيجدها من يبحث به.' : 'لا كنية ولا لقب بعد. أضف ما يُعرف به، فيجده من يبحث به.'}</p>
          )}
        </section>
      )}

      {mayWiden(s, id) && <WhoSees s={s} id={id} />}

      <Permissions s={s} id={id} />

      <section>
        <div class="hrow">
          <h3>صور عبر السنين</h3>
          {!ro && (
            <button class="link" onClick={() => toast('إضافة الصور مع قصّ الوجوه تأتي في المرحلة الثالثة')}>
              + إضافة صورة
            </button>
          )}
        </div>
        <div class="card empty">
          <Icon name="cam" />
          <span>لا صور بعد. تُحفظ صورة الشخص وحده، ولا تُخزَّن الصور الجماعية أبدًا.</span>
        </div>
      </section>

      <section>
        <div class="hrow">
          <h3>سجل التغييرات</h3>
        </div>
        {history.length === 0 && <p class="hint">لا تغييرات بعد على هذا السجل. كل تغيير يُحفظ هنا ويمكن التراجع عنه بطلب معتمد.</p>}
        {history.map(t => (
          <div class="card hist">
            <Icon name="history" />
            <span>
              <b>{titleOf(s, t)}</b>
              <small>
                {t.status === 'approved' ? 'معتمد' : t.status === 'pending' ? 'بانتظار الاعتماد' : t.closed ? 'أُغلق' : 'مرفوض'} · {new Date(t.at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}
              </small>
            </span>
            {t.status === 'approved' && !t.revertOf && undoable(t) && !s.before.includes(t) && !looks && canAskOps(s, t.ops) && (
              <button class="btn small" onClick={() => proposeRevert(t.id)}>
                <Icon name="undo" size={16} /> تراجع
              </button>
            )}
          </div>
        ))}
      </section>

      {mayExport(s, id) && !n.external && (
        <section>
          <h3>تصدير</h3>
          <div class="card list">
            {(n.familyRoot || n.kids.length > 0) && (
              <button class="prow" onClick={() => set({ exportFor: { from: id, kind: 'down' } })}>
                <Icon name="layers" />
                <span class="pt">
                  <b>{n.familyRoot ? 'تصدير شجرة الأسرة' : n.sex === 'f' ? 'تصدير ذريتها' : 'تصدير ذريته'}</b>
                  <small>لوحة للطباعة، أو لوحات متجاورة</small>
                </span>
              </button>
            )}
            {!n.familyRoot && (
              <button class="prow" onClick={() => set({ exportFor: { from: id, kind: 'up' } })}>
                <Icon name="route" />
                <span class="pt">
                  <b>{n.sex === 'f' ? 'تصدير نسبها' : 'تصدير نسبه'}</b>
                  <small>من {n.sex === 'f' ? 'أبيها' : 'أبيه'} إلى جد الأسرة، في ورقة أو صورة</small>
                </span>
              </button>
            )}
          </div>
        </section>
      )}

      {s.rootAdmin && !s.isSample && (
        <section>
          <h3>أدوات المشرف</h3>
          <div class="card list">
            <button class="prow" onClick={() => set({ editFor: id })}>
              <Icon name="user" />
              <span class="pt">
                <b>تعديل البيانات</b>
                <small>الاسم، الأسماء الأخرى، الميلاد، الوفاة، الارتباط</small>
              </span>
            </button>
            {!n.familyRoot && !n.external && (
              <button class="prow" onClick={() => set({ mergeFor: id, mergeWith: null, searchOpen: 'merge' })}>
                <Icon name="merge" />
                <span class="pt">
                  <b>دمج مع…</b>
                  <small>إن كان مسجلًا مرتين في الشجرة</small>
                </span>
              </button>
            )}
            {!n.familyRoot && !n.external && (
              <button class="prow" onClick={() => set({ moveFor: id, searchOpen: 'move' })}>
                <Icon name="swap" />
                <span class="pt">
                  <b>نقل إلى أب آخر</b>
                  <small>إن كان مربوطًا بالأب الخطأ</small>
                </span>
              </button>
            )}
            {!n.familyRoot && (
              <button
                class="prow"
                onClick={() => {
                  const desc = n.desc;
                  if (desc ? confirm(`حذف ${n.name} و${desc} من ذريته من الشجرة؟ يمكن التراجع عنه من السجل.`) : confirm(`حذف ${n.name} من الشجرة؟ يمكن التراجع عنه من السجل.`)) deletePerson(id, desc > 0);
                }}
              >
                <Icon name="x" />
                <span class="pt">
                  <b class="danger">حذف من الشجرة</b>
                  <small>{n.desc ? `مع ذريته (${n.desc})` : 'يمكن التراجع عنه'}</small>
                </span>
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
