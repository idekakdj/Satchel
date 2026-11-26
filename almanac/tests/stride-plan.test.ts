import { afterEach, describe, expect, it, vi } from 'vitest';
import { clockLabel, dayTotals, durationLabel, entryLabel, groupByDay, mealKcal, mealMacros, openStride, parseStridePlan, shortClock, stridePath, weekDates } from '../src/renderer/stride-plan';

const doc = {
  plan: {
    meals: [
      { id: 'm2', date: '2026-11-25', time: '18:30', slotId: 'dinner', name: 'Dinner', items: [{ name: 'Rice', grams: 150, servings: 1, kcal: 200.4, protein: 4, carbs: 44, fat: 0.5 }, { name: 'Tofu', grams: 100, servings: 1, kcal: 144.4, protein: 15, carbs: 2, fat: 8 }], notes: 'x' },
      { id: 'm1', date: '2026-11-25', time: '08:00', slotId: 'breakfast', name: 'Oats', items: [], notes: '' },
      { id: 'bad1', date: 'nope', time: '08:00', name: 'x', items: [] },
      { date: '2026-11-25', time: '08:00', name: 'no id', items: [] },
      null, 7, 'x',
    ],
    workouts: [
      { id: 'w1', date: '2026-11-25', time: '07:00', durationMin: 45, routineId: 'r', name: 'Push', notes: '', sessionId: 's1' },
      { id: 'w2', date: '2026-11-26', time: '25:99', durationMin: -5, routineId: 'r', name: '', notes: 5, sessionId: null },
    ],
  },
};

describe('parseStridePlan', () => {
  it('keeps valid entries and skips malformed ones', () => {
    const plan = parseStridePlan(doc);
    expect(plan.meals.map(m => m.id).sort()).toEqual(['m1', 'm2']);
    expect(plan.workouts.map(w => w.id)).toEqual(['w1', 'w2']);
  });
  it('treats missing, null or wrong-typed documents as empty', () => {
    for (const value of [null, undefined, {}, { plan: null }, { plan: { meals: 'x', workouts: {} } }, 5, []]) expect(parseStridePlan(value)).toEqual({ meals: [], workouts: [] });
  });
  it('sanitises bad fields', () => {
    expect(parseStridePlan(doc).workouts[1]).toMatchObject({ time: '00:00', durationMin: 0, name: 'Workout', notes: '', done: false });
  });
  it('derives done from sessionId', () => {
    const [a, b] = parseStridePlan(doc).workouts;
    expect(a.done).toBe(true);
    expect(b.done).toBe(false);
  });
});

describe('meal totals', () => {
  it('rounds the sum of item kcal', () => {
    expect(mealKcal([{ kcal: 200.4 }, { kcal: 144.4 }])).toBe(345);
    expect(parseStridePlan(doc).meals.find(m => m.id === 'm2')!.kcal).toBe(345);
    expect(mealKcal([])).toBe(0);
  });
  it('sums macros', () => {
    expect(mealMacros(parseStridePlan(doc).meals.find(m => m.id === 'm2')!.items)).toEqual({ kcal: 345, protein: 19, carbs: 46, fat: 8.5 });
  });
});

describe('grouping', () => {
  it('groups by day sorted by time', () => {
    const map = groupByDay(parseStridePlan(doc));
    expect([...map.keys()]).toEqual(['2026-11-25', '2026-11-26']);
    expect(map.get('2026-11-25')!.map(e => e.id)).toEqual(['w1', 'm1', 'm2']);
  });
  it('filters to a half-open range', () => {
    expect([...groupByDay(parseStridePlan(doc), '2026-11-26', '2026-11-27').keys()]).toEqual(['2026-11-26']);
    expect(groupByDay(parseStridePlan(doc), '2026-11-25', '2026-11-26').has('2026-11-26')).toBe(false);
  });
  it('computes day totals', () => {
    expect(dayTotals(groupByDay(parseStridePlan(doc)).get('2026-11-25')!)).toEqual({ kcal: 345, workouts: 1, done: 1 });
  });
});

describe('weekDates', () => {
  it('starts on Monday', () => {
    expect(weekDates('2026-11-25', 1)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  });
  it('starts on Sunday', () => {
    expect(weekDates('2026-11-22', 7)[0]).toBe('2026-11-22');
    expect(weekDates('2026-11-28', 7)[0]).toBe('2026-11-22');
  });
  it('handles a Sunday with Monday start', () => {
    expect(weekDates('2026-11-29', 1)[0]).toBe('2026-11-23');
  });
});

describe('formatting and links', () => {
  it('formats clock times', () => {
    expect(clockLabel('00:05', '12')).toBe('12:05 AM');
    expect(clockLabel('13:30', '12')).toBe('1:30 PM');
    expect(clockLabel('13:30', '24')).toBe('13:30');
    expect(shortClock('13:00', '12')).toBe('1pm');
    expect(shortClock('13:30', '12')).toBe('1:30pm');
  });
  it('formats durations', () => {
    expect(durationLabel(0)).toBe('');
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(60)).toBe('1 h');
    expect(durationLabel(95)).toBe('1 h 35 min');
  });
  it('builds Stride paths', () => {
    const plan = parseStridePlan({ plan: { meals: [{ id: 'a b&c', date: '2026-01-01', time: '10:00', items: [] }], workouts: [{ id: 'w/1', date: '2026-01-01', time: '10:00' }] } });
    expect(stridePath(plan.meals[0])).toBe('/stride/app?tab=plan&meal=a%20b%26c');
    expect(stridePath(plan.workouts[0])).toBe('/stride/app?tab=workouts&planned=w%2F1');
  });
});

describe('openStride', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses SatchelTabs when present', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { SatchelTabs: { open } });
    openStride('/stride/app');
    expect(open).toHaveBeenCalledWith('/stride/app');
  });
  it('falls back to location', () => {
    const location = { href: '' };
    vi.stubGlobal('window', {});
    vi.stubGlobal('location', location);
    openStride('/stride/app?tab=plan');
    expect(location.href).toBe('/stride/app?tab=plan');
  });
});

describe('plan-only responses and logged meals', () => {
  it('reads a bare { meals, workouts } plan as well as a whole Stride document', () => {
    const meal = { id: 'm1', date: '2026-11-25', time: '08:00', name: 'Breakfast', items: [{ name: 'Oats', kcal: 150, portion: '1 × 1 cup' }], loggedAt: '2026-11-25T08:10:00Z' };
    const bare = parseStridePlan({ meals: [meal], workouts: [] });
    expect(bare.meals).toHaveLength(1);
    expect(bare.meals[0].logged).toBe(true);
    expect(bare.meals[0].items[0].portion).toBe('1 × 1 cup');
    expect(parseStridePlan({ plan: { meals: [meal] } }).meals).toHaveLength(1);
  });
  it('treats a meal without loggedAt as planned and says so in its label', () => {
    const plan = parseStridePlan({ meals: [{ id: 'm2', date: '2026-11-25', time: '12:00', name: 'Lunch', items: [] }] });
    expect(plan.meals[0].logged).toBe(false);
    expect(entryLabel(plan.meals[0], '24')).toContain('planned');
  });
});
