import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Dumbbell, Pencil, Utensils } from 'lucide-react';
import { addDays, day, monthCells } from '../domain/calendar';
import type { Preferences } from '../shared/model';
import { Empty, Modal } from './ui';
import { clockLabel, dayTotals, durationLabel, entryLabel, groupByDay, mealMacros, openStride, parseStridePlan, shortClock, stridePath, weekDates, type StrideEntry, type StridePlan } from './stride-plan';

const MEAL_COLOR = '#e2bc78', WORKOUT_COLOR = '#7bc9b4', REFRESH_MS = 30000;
type StrideView = 'month' | 'week';
type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; empty: boolean; plan: StridePlan };
const colorOf = (e: StrideEntry) => (e.kind === 'meal' ? MEAL_COLOR : WORKOUT_COLOR);

export function StrideCalendar({ prefs, today }: { prefs: Preferences; today: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  // The view and date survive leaving the page (My tasks and back) for this browser tab.
  const [view, setView] = useState<StrideView>(() => (sessionStorage.getItem('almanac.stride.view') === 'week' ? 'week' : 'month'));
  const [active, setActive] = useState(() => { const d = sessionStorage.getItem('almanac.stride.date'); return d && /^d{4}-d{2}-d{2}$/.test(d) ? d : today; });
  useEffect(() => { try { sessionStorage.setItem('almanac.stride.view', view); sessionStorage.setItem('almanac.stride.date', active); } catch { /* storage unavailable */ } }, [view, active]);
  const [detail, setDetail] = useState<StrideEntry | null>(null);
  const revision = useRef<string | null>(null);
  const timeFormat = prefs.timeFormat, weekStart = prefs.weekStart;

  // Only the plan is fetched (not the rest of the fitness log), and ?since= skips unchanged data.
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const since = revision.current === null ? '' : '?since=' + encodeURIComponent(revision.current);
      const res = await fetch('/api/apps/stride/plan' + since, { credentials: 'same-origin', headers: { 'X-Requested-With': 'satchel' }, signal });
      if (res.status === 401 || res.status === 403) {
        // Signed out: never keep showing private plans from before.
        revision.current = null; setDetail(null);
        setLoad({ state: 'error', message: 'Sign in again to see your Stride plan.' });
        return;
      }
      if (!res.ok) throw new Error('Stride could not be reached.');
      const body: unknown = await res.json();
      const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      if (record.unchanged === true) return;
      revision.current = String(record.revision ?? '');
      setLoad({ state: 'ready', empty: record.exists !== true, plan: parseStridePlan(record.plan) });
    } catch (error) {
      if (signal?.aborted) return;
      setLoad(prev => (prev.state === 'ready' ? prev : { state: 'error', message: error instanceof Error ? error.message : 'Stride could not be reached.' }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const run = () => { if (document.visibilityState !== 'hidden') void refresh(controller.signal); };
    run();
    const timer = window.setInterval(run, REFRESH_MS);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', run); };
  }, [refresh]);

  const cells = useMemo(() => monthCells(active, weekStart), [active, weekStart]);
  const week = useMemo(() => weekDates(active, weekStart), [active, weekStart]);
  const dates = view === 'month' ? cells : week;
  const plan = load.state === 'ready' ? load.plan : null;
  const byDay = useMemo(() => (plan ? groupByDay(plan, dates[0], addDays(dates.at(-1)!, 1)) : new Map<string, StrideEntry[]>()), [plan, dates]);
  const inRange = [...byDay.values()].reduce((n, list) => n + list.length, 0);

  const navigate = (dir: -1 | 1) => setActive(view === 'month' ? day(active.slice(0, 7) + '-01').plus({ months: dir }).toISODate()! : addDays(active, dir * 7));
  const title = view === 'month' ? day(active).toFormat('MMMM yyyy') : `${day(week[0]).toFormat('MMM d')} – ${day(week[6]).toFormat('MMM d, yyyy')}`;

  const chip = (e: StrideEntry) => (
    <button key={e.kind + e.id} className={`calendar-event stride-chip ${e.kind} ${(e.kind === 'workout' && e.done) || (e.kind === 'meal' && e.logged) ? 'completed' : ''}`} style={{ '--item-color': colorOf(e) } as React.CSSProperties} aria-label={entryLabel(e, timeFormat)} title={entryLabel(e, timeFormat)} onClick={() => setDetail(e)} onDoubleClick={() => openStride(stridePath(e))}>
      {e.kind === 'meal' ? <Utensils size={10} aria-hidden="true" /> : <Dumbbell size={10} aria-hidden="true" />}
      <small>{shortClock(e.time, timeFormat)}</small><span>{e.name}</span>{((e.kind === 'workout' && e.done) || (e.kind === 'meal' && e.logged)) && <Check size={11} aria-hidden="true" />}
    </button>
  );
  const totalsText = (entries: StrideEntry[]) => {
    const t = dayTotals(entries); const parts: string[] = [];
    if (t.kcal) parts.push(`${t.kcal.toLocaleString()} kcal`);
    if (t.workouts) parts.push(`${t.workouts} workout${t.workouts === 1 ? '' : 's'}`);
    return parts.join(' · ');
  };

  if (load.state === 'loading') return <div className="stride-page"><p className="field-help" role="status">Loading your Stride plan…</p></div>;
  if (load.state === 'error') return <div className="stride-page"><Empty title="Stride isn’t answering." detail={load.message} action={<button className="button secondary" onClick={() => void refresh()}>Try again</button>} /></div>;
  if (load.empty) return <div className="stride-page"><Empty title="Nothing planned yet." detail="Open Stride once and plan a meal or a workout. It will appear here on its own calendar." action={<button className="button primary" onClick={() => openStride('/stride/app')}>Open Stride</button>} /></div>;

  return <div className="calendar-layout stride-page"><section className="calendar-area" aria-label="Stride calendar">
    <div className="calendar-toolbar">
      <div className="month-navigation"><h2 aria-live="polite">{title}</h2><div className="arrow-pair"><button className="icon-button" aria-label="Previous period" onClick={() => navigate(-1)}><ChevronLeft size={18} /></button><button className="icon-button" aria-label="Next period" onClick={() => navigate(1)}><ChevronRight size={18} /></button></div><button className="button today-button" onClick={() => setActive(today)}>Today</button></div>
      <div className="toolbar-right"><ul className="stride-legend" aria-label="Legend"><li><i style={{ background: MEAL_COLOR }} /> Meals</li><li><i style={{ background: WORKOUT_COLOR }} /> Workouts</li></ul><div className="segmented" aria-label="Stride view">{(['month', 'week'] as const).map(v => <button key={v} aria-pressed={view === v} className={view === v ? 'selected' : ''} onClick={() => setView(v)}>{v === 'month' ? 'Month' : 'Week'}</button>)}</div></div>
    </div>
    {inRange === 0 && <Empty title="Nothing planned in this range." detail="Plan a few meals or schedule a workout in Stride and they will show up here." action={<div className="stride-empty-actions"><button className="button primary" onClick={() => openStride('/stride/app?tab=plan')}>Plan meals in Stride</button><button className="button secondary" onClick={() => openStride('/stride/app?tab=workouts')}>Schedule a workout</button></div>} />}
    {view === 'month' ? <div className="month-calendar"><div className="weekday-headers">{cells.slice(0, 7).map(d => <span key={d}>{day(d).toFormat('ccc')}</span>)}</div>
      {Array.from({ length: cells.length / 7 }, (_, w) => { const row = cells.slice(w * 7, w * 7 + 7); return <Fragment key={row[0]}><div className="calendar-week">{row.map(date => { const entries = byDay.get(date) ?? [], outside = date.slice(0, 7) !== active.slice(0, 7), text = totalsText(entries);
        return <div key={date} className={`day-cell stride-day ${outside ? 'outside' : ''} ${date === today ? 'today' : ''}`}><div className="stride-day-head"><span className="day-number">{day(date).day}</span>{date === today && <span className="today-label">TODAY</span>}</div>
          <div className="day-events">{entries.slice(0, 3).map(chip)}{entries.length > 3 && <button className="more-events" aria-label={`${entries.length - 3} more planned on ${day(date).toFormat('cccc, MMMM d')}. Show this week.`} onClick={() => { setActive(date); setView('week'); }}>+{entries.length - 3} more</button>}{text && <span className="stride-day-total">{text}</span>}</div></div>; })}</div></Fragment>; })}</div>
    : <div className="agenda-list stride-week">{week.map(date => { const entries = byDay.get(date) ?? [], text = totalsText(entries);
      return <section key={date} aria-label={day(date).toFormat('cccc, MMMM d')}><div className="agenda-date"><span>{day(date).toFormat('ccc')}</span><b className={date === today ? 'today-number' : ''}>{day(date).day}</b><small>{day(date).toFormat('MMM')}</small></div>
        <div className="stride-rows">{entries.map(e => <button key={e.kind + e.id} className={`stride-row ${e.kind}`} style={{ '--item-color': colorOf(e) } as React.CSSProperties} aria-label={entryLabel(e, timeFormat)} onClick={() => setDetail(e)} onDoubleClick={() => openStride(stridePath(e))}>
          <span className="stride-row-icon">{e.kind === 'meal' ? <Utensils size={15} aria-hidden="true" /> : <Dumbbell size={15} aria-hidden="true" />}</span><span className="stride-row-time">{clockLabel(e.time, timeFormat)}</span><b>{e.name}</b>
          <span className="stride-row-meta">{e.kind === 'meal' ? `${e.kcal.toLocaleString()} kcal` : durationLabel(e.durationMin)}{e.kind === 'workout' && <span className={`badge ${e.done ? 'done' : ''}`}>{e.done ? 'Done' : 'Planned'}</span>}</span></button>)}
          {!entries.length && <p className="stride-none">Nothing planned.</p>}{text && <p className="stride-day-total">{text}</p>}</div></section>; })}</div>}
    <p className="field-help stride-note">Planned in Stride. Changes there appear here within 30 seconds.</p>
  </section>
  {detail && <Modal title={detail.name} subtitle={`${day(detail.date).toFormat('cccc, MMMM d, yyyy')} · ${clockLabel(detail.time, timeFormat)}`} onClose={() => setDetail(null)}><StrideDetail entry={detail} onEdit={() => { const path = stridePath(detail); setDetail(null); openStride(path); }} onClose={() => setDetail(null)} /></Modal>}
  </div>;
}

function StrideDetail({ entry, onEdit, onClose }: { entry: StrideEntry; onEdit: () => void; onClose: () => void }) {
  const macros = entry.kind === 'meal' ? mealMacros(entry.items) : null;
  return <div className="editor stride-detail">
    {entry.kind === 'meal' ? <>
      <p><span className="badge">Meal</span> <span className={`badge ${entry.logged ? 'done' : ''}`}>{entry.logged ? 'Logged' : 'Planned'}</span></p>
      {entry.items.length ? <ul className="stride-foods">{entry.items.map((f, i) => <li key={i}><span>{f.name || 'Food'}<small>{f.portion ? ` · ${f.portion}` : f.servings ? ` · ${f.servings} serving${f.servings === 1 ? '' : 's'}` : ''}{f.grams ? ` · ${Math.round(f.grams)} g` : ''}</small></span><b>{Math.round(f.kcal)} kcal</b></li>)}</ul> : <p className="field-help">No foods added to this meal yet.</p>}
      {macros && <p className="stride-macros"><b>{macros.kcal.toLocaleString()} kcal</b> · {macros.protein} g protein · {macros.carbs} g carbs · {macros.fat} g fat</p>}
    </> : <>
      <p><span className="badge">Workout</span> <span className={`badge ${entry.done ? 'done' : ''}`}>{entry.done ? 'Done' : 'Planned'}</span></p>
      <p>{entry.durationMin ? `Duration: ${durationLabel(entry.durationMin)}` : 'No duration set.'}</p>
    </>}
    {entry.notes && <p className="preserve-lines">{entry.notes}</p>}
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>Close</button><button className="button primary" onClick={onEdit}><Pencil size={15} /> Edit in Stride</button></div>
  </div>;
}
