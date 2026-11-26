import { DateTime } from 'luxon';

export type StrideFood = { name: string; grams: number; servings: number; portion: string; kcal: number; protein: number; carbs: number; fat: number };
export type StrideMeal = { kind: 'meal'; id: string; date: string; time: string; slotId: string; name: string; items: StrideFood[]; notes: string; kcal: number; logged: boolean };
export type StrideWorkout = { kind: 'workout'; id: string; date: string; time: string; durationMin: number; routineId: string; name: string; notes: string; done: boolean };
export type StrideEntry = StrideMeal | StrideWorkout;
export type StridePlan = { meals: StrideMeal[]; workouts: StrideWorkout[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
function validDate(v: unknown): v is string { return typeof v === 'string' && DATE.test(v) && DateTime.fromISO(v, { zone: 'UTC' }).isValid; }
function validTime(v: unknown): string { return typeof v === 'string' && TIME.test(v) ? v : '00:00'; }

export function parseFood(raw: unknown): StrideFood | null {
  if (!isRecord(raw)) return null;
  return { name: str(raw.name, 200), grams: num(raw.grams), servings: num(raw.servings), portion: str(raw.portion, 120), kcal: num(raw.kcal), protein: num(raw.protein), carbs: num(raw.carbs), fat: num(raw.fat) };
}
export function mealKcal(items: readonly { kcal: number }[]): number { return Math.round(items.reduce((sum, i) => sum + (Number.isFinite(i.kcal) ? i.kcal : 0), 0)); }
export function mealMacros(items: readonly StrideFood[]) {
  const total = (key: 'protein' | 'carbs' | 'fat') => Math.round(items.reduce((s, i) => s + i[key], 0) * 10) / 10;
  return { kcal: mealKcal(items), protein: total('protein'), carbs: total('carbs'), fat: total('fat') };
}
export function parseMeal(raw: unknown): StrideMeal | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || !validDate(raw.date)) return null;
  const items = (Array.isArray(raw.items) ? raw.items : []).map(parseFood).filter((i): i is StrideFood => !!i);
  return { kind: 'meal', id: raw.id, date: raw.date, time: validTime(raw.time), slotId: str(raw.slotId, 100), name: str(raw.name, 200).trim() || 'Meal', items, notes: str(raw.notes, 2000), kcal: mealKcal(items), logged: typeof raw.loggedAt === 'string' || typeof raw.loggedAt === 'number' };
}
export function parseWorkout(raw: unknown): StrideWorkout | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || !validDate(raw.date)) return null;
  return { kind: 'workout', id: raw.id, date: raw.date, time: validTime(raw.time), durationMin: Math.round(num(raw.durationMin)), routineId: str(raw.routineId, 100), name: str(raw.name, 200).trim() || 'Workout', notes: str(raw.notes, 2000), done: raw.sessionId !== null && raw.sessionId !== undefined && raw.sessionId !== '' };
}
/** Reads document.plan (or a bare { meals, workouts } plan) defensively. Missing or malformed data yields an empty plan. */
export function parseStridePlan(document: unknown): StridePlan {
  const plan = isRecord(document) && isRecord(document.plan) ? document.plan : isRecord(document) && ('meals' in document || 'workouts' in document) ? document : {};
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return { meals: list(plan.meals).map(parseMeal).filter((m): m is StrideMeal => !!m), workouts: list(plan.workouts).map(parseWorkout).filter((w): w is StrideWorkout => !!w) };
}
export function sortEntries(entries: StrideEntry[]): StrideEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || (a.kind === b.kind ? 0 : a.kind === 'meal' ? -1 : 1) || a.name.localeCompare(b.name));
}
export function groupByDay(plan: StridePlan, from?: string, toExclusive?: string): Map<string, StrideEntry[]> {
  const map = new Map<string, StrideEntry[]>();
  for (const entry of sortEntries([...plan.meals, ...plan.workouts])) {
    if ((from && entry.date < from) || (toExclusive && entry.date >= toExclusive)) continue;
    const list = map.get(entry.date); if (list) list.push(entry); else map.set(entry.date, [entry]);
  }
  return map;
}
export function dayTotals(entries: readonly StrideEntry[]) {
  let kcal = 0, workouts = 0, done = 0;
  for (const e of entries) { if (e.kind === 'meal') kcal += e.kcal; else { workouts++; if (e.done) done++; } }
  return { kcal, workouts, done };
}
/** Seven dates starting on the user's week start (1 = Monday, 7 = Sunday) that contain `date`. */
export function weekDates(date: string, weekStart: 1 | 7): string[] {
  const d = DateTime.fromISO(date, { zone: 'UTC' });
  const start = d.minus({ days: (d.weekday - weekStart + 7) % 7 });
  return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).toISODate()!);
}
export function clockLabel(time: string, format: '12' | '24'): string {
  const m = TIME.test(time) ? time : '00:00';
  if (format === '24') return m;
  const h = Number(m.slice(0, 2));
  return `${h % 12 || 12}:${m.slice(3)} ${h < 12 ? 'AM' : 'PM'}`;
}
export function shortClock(time: string, format: '12' | '24'): string {
  return format === '24' ? time : clockLabel(time, '12').replace(':00', '').replace(' AM', 'am').replace(' PM', 'pm');
}
export function durationLabel(min: number): string {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
export function entryLabel(e: StrideEntry, format: '12' | '24'): string {
  const when = clockLabel(e.time, format);
  return e.kind === 'meal' ? `Meal, ${e.name}, ${when}, ${e.kcal} kcal, ${e.logged ? 'logged' : 'planned'}` : `Workout, ${e.name}, ${when}${e.durationMin ? ', ' + durationLabel(e.durationMin) : ''}, ${e.done ? 'done' : 'planned'}`;
}
export function stridePath(e: StrideEntry): string {
  return e.kind === 'meal' ? '/stride/app?tab=plan&meal=' + encodeURIComponent(e.id) : '/stride/app?tab=workouts&planned=' + encodeURIComponent(e.id);
}
export function openStride(path: string): void {
  const open = typeof window !== 'undefined' ? window.SatchelTabs?.open : undefined;
  if (typeof open === 'function') window.SatchelTabs!.open!(path); else location.href = path;
}
