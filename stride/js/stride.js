// Stride: food log with a bank of common foods and calorie estimates, plus fully customizable
// exercises, routines and workout sessions. Everything lives in one autosaved document.
import { h, icon, toast, sheet, confirmSheet, uid, todayISO, addDaysISO, fmtDate, download, createDocStore, saveLabel, onShellNavigate, nowInZone, isISODate, onSettingsChange } from '/js/app-kit.js';

const $ = id => document.getElementById(id);
const COLORS = ['#f05a3c', '#2a6fdb', '#14a37f', '#e0a526', '#9b6bdf', '#e9617b', '#18a999', '#7cb518', '#8a7d70'];
const KINDS = {
  strength: { label: 'Weights (reps × weight)', cols: ['reps', 'weight'], met: 5.0 },
  bodyweight: { label: 'Bodyweight (reps)', cols: ['reps'], met: 3.8 },
  timed: { label: 'Timed hold (seconds)', cols: ['seconds'], met: 3.0 },
  cardio: { label: 'Cardio (minutes and distance)', cols: ['minutes', 'km'], met: 7.0 },
};
const ACTIVITY = [[1.2, 'Mostly sitting'], [1.375, 'Lightly active (1–3 workouts a week)'], [1.55, 'Active (3–5 a week)'], [1.725, 'Very active (6–7 a week)'], [1.9, 'Athlete / physical job']];

function defaults() {
  const ex = (name, group, kind) => ({ id: uid(), name, group, kind });
  const exercises = [
    ex('Bench press', 'Chest', 'strength'), ex('Squat', 'Legs', 'strength'), ex('Deadlift', 'Back', 'strength'), ex('Overhead press', 'Shoulders', 'strength'),
    ex('Barbell row', 'Back', 'strength'), ex('Lat pulldown', 'Back', 'strength'), ex('Leg press', 'Legs', 'strength'), ex('Romanian deadlift', 'Legs', 'strength'),
    ex('Dumbbell curl', 'Arms', 'strength'), ex('Tricep pushdown', 'Arms', 'strength'), ex('Pull-up', 'Back', 'bodyweight'), ex('Push-up', 'Chest', 'bodyweight'),
    ex('Lunge', 'Legs', 'bodyweight'), ex('Sit-up', 'Core', 'bodyweight'), ex('Plank', 'Core', 'timed'), ex('Running', 'Cardio', 'cardio'),
    ex('Cycling', 'Cardio', 'cardio'), ex('Rowing machine', 'Cardio', 'cardio'), ex('Walking', 'Cardio', 'cardio'), ex('Swimming', 'Cardio', 'cardio'),
  ];
  const find = n => exercises.find(e => e.name === n).id;
  const sets = (n, s) => Array.from({ length: n }, () => ({ ...s }));
  return {
    version: 2,
    profile: { sex: 'female', age: 20, heightCm: 168, weightKg: 65, activity: 1.375, goal: 'maintain', units: 'metric' },
    goals: { kcal: 2000, protein: 110, carbs: 230, fat: 70, waterMl: 2000, waterUnit: 'glasses' },
    customGoals: [],
    setup: false,
    mealSlots: [{ id: uid(), name: 'Breakfast' }, { id: uid(), name: 'Lunch' }, { id: uid(), name: 'Dinner' }, { id: uid(), name: 'Snacks' }],
    customFoods: [], savedMeals: [], builtMeals: [], recent: [], log: {},
    exercises,
    routines: [
      { id: uid(), name: 'Full body A', color: COLORS[0], items: [{ exerciseId: find('Squat'), sets: sets(3, { reps: 8, weight: 40 }) }, { exerciseId: find('Bench press'), sets: sets(3, { reps: 8, weight: 30 }) }, { exerciseId: find('Barbell row'), sets: sets(3, { reps: 10, weight: 30 }) }, { exerciseId: find('Plank'), sets: sets(3, { seconds: 45 }) }] },
      { id: uid(), name: 'Easy run', color: COLORS[1], items: [{ exerciseId: find('Running'), sets: [{ minutes: 25, km: 4 }] }] },
    ],
    sessions: [], active: null, weights: [],
    plan: { meals: [], workouts: [] },
  };
}
const GLASS_ML = 250;
/** Bring any older saved document (version 1: water in glasses) up to the current shape without losing data. */
const DOC_VERSION = 2;
function migrate(d) {
  const base = defaults();
  const old = d && typeof d === 'object' ? d : {};
  // Saved by a newer Satchel: refuse rather than silently downgrade (and overwrite) it.
  if (Number(old.version) > DOC_VERSION) throw Object.assign(new Error('Your Stride data was saved by a newer version of Satchel. Update Satchel (or reload this page) to open it.'), { newer: true });
  const doc = { ...base, ...old };
  doc.profile = { ...base.profile, ...(old.profile || {}) };
  const og = old.goals && typeof old.goals === 'object' ? old.goals : {};
  doc.goals = { ...base.goals, ...og };
  if (!(Number(old.version) >= 2)) {
    // v1 stored water as a count of glasses; v2 stores millilitres (1 glass = 250 ml).
    const gl = Number(og.water);
    doc.goals.waterMl = og.waterMl > 0 ? og.waterMl : gl > 0 ? Math.round(gl * GLASS_ML) : 8 * GLASS_ML;
    doc.goals.waterUnit = 'glasses';
    doc.log = { ...(old.log || {}) };
    for (const [day, l] of Object.entries(doc.log)) {
      if (!l || typeof l !== 'object') { delete doc.log[day]; continue; }
      doc.log[day] = { ...l, waterMl: l.waterMl >= 0 && l.waterMl != null ? l.waterMl : Math.round((Number(l.water) || 0) * GLASS_ML) };
      delete doc.log[day].water;
    }
  }
  delete doc.goals.water;
  if (doc.goals.waterUnit !== 'litres') doc.goals.waterUnit = 'glasses';
  if (!(doc.goals.waterMl >= 0)) doc.goals.waterMl = 2000;
  for (const k of ['customFoods', 'savedMeals', 'builtMeals', 'customGoals', 'recent', 'exercises', 'routines', 'sessions', 'weights']) if (!Array.isArray(doc[k])) doc[k] = base[k];
  if (!Array.isArray(doc.mealSlots) || !doc.mealSlots.length) doc.mealSlots = base.mealSlots;
  if (!doc.log || typeof doc.log !== 'object') doc.log = {};
  const pl = old.plan && typeof old.plan === 'object' ? old.plan : {};
  doc.plan = { ...pl, meals: Array.isArray(pl.meals) ? pl.meals : [], workouts: Array.isArray(pl.workouts) ? pl.workouts : [] };
  doc.version = DOC_VERSION;
  return doc;
}
const store = createDocStore('stride', {
  defaults, migrate,
  onState: s => saveLabel($('save-state'), s),
  onConflict: () => toast('Stride changed on another device.', { error: true, action: () => location.reload(), actionLabel: 'Reload' }),
});
const D = () => store.doc;
const state = { tab: 'today', day: todayISO(), planDay: todayISO(), wsub: 'routines', gdraft: null };
function changed() { store.changed(); render(); }

// ---------- units ----------
const imperial = () => D().profile.units === 'imperial';
const kgToShow = kg => imperial() ? kg * 2.20462 : kg;
const showToKg = v => imperial() ? v / 2.20462 : v;
const wUnit = () => imperial() ? 'lb' : 'kg';
const kmUnit = () => imperial() ? 'mi' : 'km';
const r1 = n => Math.round(n * 10) / 10;

// ---------- food bank ----------
let FOODS = [];
async function loadFoods() {
  const res = await fetch('/stride/data/foods.json', { credentials: 'same-origin' });
  const data = await res.json();
  FOODS = data.foods.map(([name, group, kcal, protein, carbs, fat, fiber, portions]) => ({ id: 'usda:' + name, name, group, kcal, protein, carbs, fat, fiber, portions: parsePortions(portions) }));
}
function parsePortions(s) { return String(s || '').split(';').filter(Boolean).map(p => { const i = p.lastIndexOf(':'); return { label: p.slice(0, i), grams: Number(p.slice(i + 1)) }; }).filter(p => p.grams > 0); }
// A built meal behaves like a food in search: values per 100 g of the finished meal, with "1 serving" and "whole meal" portions.
function builtAsFood(m) {
  const t = mealTotals(m), grams = t.grams || 1, k = 100 / grams, sv = Math.max(0.5, Number(m.servings) || 1);
  const portions = [{ label: sv === 1 ? 'whole meal' : '1 serving', grams: grams / sv }];
  if (sv !== 1) portions.push({ label: `whole meal (${sv} servings)`, grams });
  return { id: 'meal:' + m.id, mealId: m.id, built: true, custom: true, name: m.name, group: 'My meals', kcal: t.kcal * k, protein: t.protein * k, carbs: t.carbs * k, fat: t.fat * k, fiber: 0, portions };
}
function allFoods({ meals = true } = {}) { return [...(meals ? D().builtMeals.map(builtAsFood) : []), ...D().customFoods.map(f => ({ ...f, portions: f.portions || [], custom: true })), ...FOODS]; }
function ingNutri(i) { const k = (Number(i.grams) || 0) / 100, p = i.per100 || {}; return { kcal: (p.kcal || 0) * k, protein: (p.protein || 0) * k, carbs: (p.carbs || 0) * k, fat: (p.fat || 0) * k }; }
function mealTotals(m) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, grams: 0 };
  for (const i of m.ingredients || []) { const n = ingNutri(i); t.kcal += n.kcal; t.protein += n.protein; t.carbs += n.carbs; t.fat += n.fat; t.grams += Number(i.grams) || 0; }
  return t;
}
function searchFoods(q, { meals = true } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = allFoods({ meals });
  if (!words.length) {
    const recent = D().recent.map(id => list.find(f => f.id === id)).filter(Boolean);
    return recent.length ? recent : list.slice(0, 40);
  }
  return list.map(f => {
    const name = f.name.toLowerCase(), hay = name + ' ' + (f.group || '').toLowerCase();
    if (!words.every(w => hay.includes(w))) return null;
    let score = 0;
    for (const w of words) { if (name.startsWith(w)) score += 4; else if (new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(name)) score += 2; else score += 1; }
    if (D().recent.includes(f.id)) score += 2;
    if (f.custom) score += 1;
    return { f, score: score - name.length / 100 };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 60).map(x => x.f);
}
function estimate(food, grams) { const k = grams / 100; return { kcal: Math.round(food.kcal * k), protein: r1(food.protein * k), carbs: r1(food.carbs * k), fat: r1(food.fat * k) }; }

// ---------- day log ----------
function dayLog(day, create) {
  let l = D().log[day];
  if (!l && create) { l = D().log[day] = { entries: [], waterMl: 0 }; }
  return l || { entries: [], waterMl: 0 };
}
function totals(day) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of dayLog(day).entries) { t.kcal += e.kcal || 0; t.protein += e.protein || 0; t.carbs += e.carbs || 0; t.fat += e.fat || 0; }
  return t;
}
function burned(day) { return D().sessions.filter(s => s.date === day).reduce((a, s) => a + (s.kcal || 0), 0); }

// ---------- rendering frame ----------
const TABS = [['today', 'Today'], ['meals', 'Meals'], ['plan', 'Plan'], ['workouts', 'Workouts'], ['progress', 'Progress'], ['goals', 'Goals']];
function render() {
  const nav = $('tabs'); nav.textContent = '';
  for (const [k, l] of TABS) nav.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === k), text: l, onclick: () => { state.tab = k; render(); } }));
  const v = $('view'); v.textContent = '';
  if (D().active && state.tab !== 'workouts') v.append(activeBanner());
  ({ today, meals, plan: planTab, workouts, progress, goals })[state.tab](v);
}
function dayNav(key = 'day') {
  const day = state[key];
  const label = day === todayISO() ? 'Today' : day === addDaysISO(todayISO(), -1) ? 'Yesterday' : day === addDaysISO(todayISO(), 1) ? 'Tomorrow' : fmtDate(day, { weekday: 'short', month: 'short', day: 'numeric' });
  return h('div.day-nav',
    h('button.icon-btn', { type: 'button', 'aria-label': 'Previous day', onclick: () => { state[key] = addDaysISO(state[key], -1); render(); } }, icon('chevronLeft')),
    h('span.label', { text: label }),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Next day', onclick: () => { state[key] = addDaysISO(state[key], 1); render(); } }, icon('chevronRight')),
    day !== todayISO() ? h('button.btn.btn-sm', { type: 'button', text: 'Today', onclick: () => { state[key] = todayISO(); render(); } }) : null);
}
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    // CSS variables are only reliable as style properties, not presentation attributes.
    if ((k === 'fill' || k === 'stroke') && String(v).startsWith('var(')) el.style.setProperty(k, v); else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}
function ring(value, goal) {
  const R = 62, C = 2 * Math.PI * R, pct = goal ? Math.min(1, value / goal) : 0;
  const s = svg('svg', { viewBox: '0 0 150 150', class: 'ring', role: 'img', 'aria-label': `${value} of ${goal} calories` },
    svg('circle', { cx: 75, cy: 75, r: R, fill: 'none', 'stroke-width': 13, class: 'track' }),
    svg('circle', { cx: 75, cy: 75, r: R, fill: 'none', 'stroke-width': 13, 'stroke-linecap': 'round', class: 'value' + (goal && value > goal ? ' over' : ''), 'stroke-dasharray': C, 'stroke-dashoffset': C * (1 - pct), transform: 'rotate(-90 75 75)' }),
    svg('text', { x: 75, y: 74, 'text-anchor': 'middle', class: 'big' }, String(Math.round(goal ? Math.abs(goal - value) : value))),
    svg('text', { x: 75, y: 94, 'text-anchor': 'middle', class: 'small-t' }, goal ? (value > goal ? 'kcal over' : 'kcal left') : 'kcal'));
  return s;
}
function meter(value, max) { const f = h('span' + (max && value > max * 1.05 ? '.over' : '')); f.style.width = (max ? Math.min(100, value / max * 100) : 0) + '%'; return h('div.meter', f); }
function macroBar(cls, label, value, goal) { return h('div.macro.' + cls, h('div.top', h('b', { text: label }), h('span.num', { text: `${Math.round(value)} / ${goal || '–'} g` })), meter(value, goal)); }

// ---------- today ----------
function today(v) {
  if (!D().setup) v.append(h('div.card', { style: { marginBottom: '16px' } }, h('div.card-head', h('h2', { text: 'Welcome to Stride' })), h('p.muted', { text: 'Tell Stride a little about yourself and it will suggest a daily calorie target. You can skip this and change any goal later.' }), h('div.row', h('button.btn.btn-accent', { type: 'button', text: 'Set my goals', onclick: () => { state.tab = 'goals'; render(); } }), h('button.btn', { type: 'button', text: 'Skip for now', onclick: () => { D().setup = true; changed(); } }))));
  const t = totals(state.day), g = D().goals, burn = burned(state.day);
  v.append(h('div.page-head', h('div', h('h1', { text: state.day === todayISO() ? 'Today' : fmtDate(state.day, { weekday: 'long', month: 'long', day: 'numeric' }) }), h('p', { text: `${Math.round(t.kcal)} kcal eaten${burn ? ` · about ${burn} burned in workouts` : ''}` })), dayNav()));
  const sum = h('section.card', h('div.ring-wrap', ring(Math.round(t.kcal), g.kcal), h('div.macros', macroBar('protein', 'Protein', t.protein, g.protein), macroBar('carbs', 'Carbs', t.carbs, g.carbs), macroBar('fat', 'Fat', t.fat, g.fat))));
  const log = dayLog(state.day);
  const wcard = waterCard(log, g);
  const meals = h('section.card', h('div.card-head', h('h2', { text: 'Meals' }), h('button.btn.btn-sm', { type: 'button', text: 'Open food log', onclick: () => { state.tab = 'meals'; render(); } })));
  for (const slot of D().mealSlots) {
    const es = log.entries.filter(e => e.slotId === slot.id);
    meals.append(h('div.list-row', h('span.grow', h('div.title', { text: slot.name }), h('div.sub', { text: es.length ? es.map(e => e.name).join(', ') : 'Nothing logged' })), h('span.kcal', { text: Math.round(es.reduce((a, e) => a + e.kcal, 0)) + ' kcal' }), h('button.icon-btn', { type: 'button', 'aria-label': 'Add food to ' + slot.name, onclick: () => foodSheet(slot.id) }, icon('plus'))));
  }
  const sessions = D().sessions.filter(s => s.date === state.day);
  const wk = h('section.card', h('div.card-head', h('h2', { text: 'Workouts' }), D().active ? null : h('button.btn.btn-sm.btn-accent', { type: 'button', text: 'Start workout', onclick: () => { state.tab = 'workouts'; render(); } })));
  wk.append(sessions.length ? h('ul.list', sessions.map(sessionRow)) : h('p.muted', { text: 'No workouts logged for this day.' }));
  const planned = plannedTodayCard(state.day);
  v.append(h('div.layout-2', h('div', sum, meals), h('div', wk, planned, wcard)));
}

// ---------- water (stored in ml; shown as glasses or litres) ----------
const waterUnit = () => D().goals.waterUnit === 'litres' ? 'litres' : 'glasses';
const trim = (n, d = 2) => String(+Number(n).toFixed(d));
const fmtLitres = ml => { const s = (ml / 1000).toFixed(2); return s.endsWith('0') ? s.slice(0, -1) : s; };
const fmtGlasses = ml => trim(ml / GLASS_ML);
function waterCard(log, g) {
  const ml = log.waterMl || 0, goalMl = g.waterMl || 0;
  const add = delta => { const l = dayLog(state.day, true); l.waterMl = Math.max(0, Math.round((l.waterMl || 0) + delta)); changed(); };
  if (waterUnit() === 'litres') {
    return h('section.card', h('div.card-head', h('h2', { text: 'Water' }), h('span.muted.num', { text: `${fmtLitres(ml)} / ${fmtLitres(goalMl)} L` })),
      meter(ml, goalMl),
      h('div.row.water-add', h('button.btn.btn-sm.btn-accent', { type: 'button', text: '+250 ml', onclick: () => add(250) }), h('button.btn.btn-sm.btn-accent', { type: 'button', text: '+500 ml', onclick: () => add(500) }),
        h('button.btn.btn-sm', { type: 'button', text: '−250 ml', disabled: ml <= 0, 'aria-label': 'Undo 250 ml', onclick: () => add(-250) })));
  }
  const full = Math.floor(ml / GLASS_ML), total = Math.max(Math.ceil(goalMl / GLASS_ML), full);
  const water = h('div.water', { role: 'group', 'aria-label': 'Water' });
  for (let i = 0; i < total; i++) water.append(h('button' + (i < full ? '.full' : ''), { type: 'button', 'aria-label': `${i + 1} glasses`, 'aria-pressed': String(i < full), onclick: () => { const l = dayLog(state.day, true); l.waterMl = i < full ? i * GLASS_ML : (i + 1) * GLASS_ML; changed(); } }));
  return h('section.card', h('div.card-head', h('h2', { text: 'Water' }), h('span.muted.num', { text: `${fmtGlasses(ml)} / ${fmtGlasses(goalMl)} glasses` })), water);
}

// ---------- planned items on the Today tab ----------
function plannedTodayCard(day) {
  const ms = planMealsOn(day), ws = D().plan.workouts.filter(w => w.date === day).sort((a, b) => a.time.localeCompare(b.time));
  if (!ms.length && !ws.length) return null;
  const card = h('section.card', h('div.card-head', h('h2', { text: 'Planned' }), h('button.btn.btn-sm', { type: 'button', text: 'Open plan', onclick: () => { state.planDay = day; state.tab = 'plan'; render(); } })));
  card.append(h('ul.list', [
    ...ms.map(m => h('li.list-row', h('span.grow', h('div.title', { text: `${m.time} · ${m.name}` }), h('div.sub', { text: m.items.map(i => i.name).join(', ') || 'No foods yet' })), h('span.kcal', { text: Math.round(sumItems(m.items).kcal) + ' kcal' }),
      m.loggedAt ? h('span.pill', { text: 'Logged' }) : h('button.btn.btn-sm', { type: 'button', text: 'Log it', onclick: () => logPlanMeal(m) }))),
    ...ws.map(w => h('li.list-row', h('span.grow', h('div.title', { text: `${w.time} · ${w.name}` }), h('div.sub', { text: `${w.durationMin} min` + (w.notes ? ' · ' + w.notes : '') })), w.sessionId ? h('span.pill', { text: 'Done' }) : h('button.btn.btn-sm', { type: 'button', text: 'Open', onclick: () => { state.tab = 'workouts'; render(); plannedWorkoutSheet(w); } })))]));
  return card;
}

// ---------- meals ----------
function meals(v) {
  v.append(h('div.page-head', h('div', h('h1', { text: 'Food log' }), h('p', { text: 'Search the food bank, pick a portion, and Stride estimates the calories.' })), dayNav()));
  const t = totals(state.day), g = D().goals;
  v.append(h('div.stat-grid', { style: { marginBottom: '16px' } },
    h('div.stat', h('div.v', { text: `${Math.round(t.kcal)}` }), h('div.k', { text: `of ${g.kcal} kcal` })),
    h('div.stat', h('div.v', { text: `${Math.round(t.protein)} g` }), h('div.k', { text: 'Protein' })),
    h('div.stat', h('div.v', { text: `${Math.round(t.carbs)} g` }), h('div.k', { text: 'Carbs' })),
    h('div.stat', h('div.v', { text: `${Math.round(t.fat)} g` }), h('div.k', { text: 'Fat' }))));
  const log = dayLog(state.day);
  D().mealSlots.forEach((slot, i) => {
    const es = log.entries.filter(e => e.slotId === slot.id);
    const card = h('section.card.slot',
      h('div.slot-head', h('h2', { text: slot.name }), h('span.slot-kcal', { text: Math.round(es.reduce((a, e) => a + e.kcal, 0)) + ' kcal' }),
        h('button.icon-btn', { type: 'button', 'aria-label': `Options for ${slot.name}`, onclick: () => slotSheet(slot, i) }, icon('more'))));
    for (const e of es) card.append(h('div.entry', h('span.grow', h('div.title', { text: e.name }), h('div.sub', { text: `${e.portion || Math.round(e.grams) + ' g'} · P ${r1(e.protein)} · C ${r1(e.carbs)} · F ${r1(e.fat)}` })), h('span.kcal', { text: Math.round(e.kcal) + ' kcal' }),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Remove ' + e.name, onclick: () => { const l = dayLog(state.day, true); const idx = l.entries.indexOf(e); l.entries.splice(idx, 1); changed(); toast('Removed ' + e.name + '.', { action: () => { dayLog(state.day, true).entries.splice(idx, 0, e); changed(); } }); } }, icon('x', 16))));
    card.append(h('div.row', { style: { marginTop: '10px' } },
      h('button.btn.btn-sm.btn-accent', { type: 'button', onclick: () => foodSheet(slot.id) }, icon('plus', 15), 'Add food'),
      D().savedMeals.length ? h('button.btn.btn-sm', { type: 'button', text: 'Add saved meal', onclick: () => savedMealSheet(slot.id) }) : null,
      h('button.btn.btn-sm.btn-ghost', { type: 'button', text: 'Copy from yesterday', onclick: () => copyYesterday(slot) }),
      es.length ? h('button.btn.btn-sm.btn-ghost', { type: 'button', text: 'Save as meal', onclick: () => saveMeal(es, slot.name) }) : null));
    v.append(card);
  });
  v.append(h('div.row', { style: { marginTop: '16px' } },
    h('button.btn', { type: 'button', onclick: () => { const name = 'Meal ' + (D().mealSlots.length + 1); D().mealSlots.push({ id: uid(), name }); changed(); } }, icon('plus', 15), 'Add meal section'),
    h('button.btn', { type: 'button', onclick: () => mealBuilder(null) }, icon('plus', 15), 'Build a meal'),
    h('button.btn', { type: 'button', onclick: manageFoods }, 'My meals & foods')));
  v.append(h('p.hint', { style: { marginTop: '12px' }, text: 'Calories and nutrients are estimates based on USDA reference values. Brands and recipes vary.' }));
}
function slotSheet(slot, index) {
  const s = sheet('Meal section');
  const name = h('input.input', { value: slot.name, maxlength: 40 });
  const form = h('form', { onsubmit: e => { e.preventDefault(); slot.name = name.value.trim() || slot.name; s.close(); changed(); } }, h('label.field', h('span', { text: 'Name' }), name));
  s.body.append(form, h('div.row',
    h('button.btn.btn-sm', { type: 'button', disabled: index === 0, onclick: () => { const a = D().mealSlots; [a[index - 1], a[index]] = [a[index], a[index - 1]]; s.close(); changed(); } }, icon('up', 15), 'Move up'),
    h('button.btn.btn-sm', { type: 'button', disabled: index === D().mealSlots.length - 1, onclick: () => { const a = D().mealSlots; [a[index + 1], a[index]] = [a[index], a[index + 1]]; s.close(); changed(); } }, icon('down', 15), 'Move down')));
  s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete section', onclick: async () => {
    if (D().mealSlots.length <= 1) return toast('Keep at least one meal section.', { error: true });
    const used = Object.values(D().log).some(l => l.entries.some(e => e.slotId === slot.id));
    if (!(await confirmSheet('Delete “' + slot.name + '”?', used ? 'Foods logged under it move to the first remaining section.' : 'This section is empty.', { confirmLabel: 'Delete section' }))) return;
    D().mealSlots = D().mealSlots.filter(x => x.id !== slot.id);
    for (const l of Object.values(D().log)) for (const e of l.entries) if (e.slotId === slot.id) e.slotId = D().mealSlots[0].id;
    s.close(); changed();
  } }), h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save', onclick: () => form.requestSubmit() }));
}
function addEntry(slotId, entry, day = state.day) {
  const l = dayLog(day, true);
  l.entries.push({ id: uid(), slotId, ...entry });
  if (entry.foodId) { D().recent = [entry.foodId, ...D().recent.filter(x => x !== entry.foodId)].slice(0, 20); }
}
function foodSheet(slotId) {
  const slot = D().mealSlots.find(x => x.id === slotId) || D().mealSlots[0];
  foodPicker({
    title: 'Add to ' + slot.name, confirmLabel: 'Add to ' + slot.name,
    onAdd: ({ food: f, grams: g, portionText, est }) => {
      addEntry(slot.id, { foodId: f.id, ...(f.built ? { mealId: f.mealId } : {}), name: f.name, grams: Math.round(g), portion: portionText, ...est });
      changed(); toast(`Added ${f.name} (${est.kcal} kcal).`);
    },
    onQuick: () => quickAdd(slot.id),
  });
}
/**
 * Search the food bank (and the user's foods; built meals too unless meals:false), pick a portion or grams,
 * and hand { food, grams, portion, qty, portionText, est } to onAdd. Used for logging, building meals and planning.
 */
function foodPicker({ title, confirmLabel = 'Add', meals = true, onAdd, onQuick, quickLabel = 'Quick add' }) {
  const s = sheet(title, { wide: true });
  const q = h('input.input', { type: 'search', placeholder: 'Search foods, e.g. “banana”, “latte”, “chicken breast”', 'aria-label': 'Search foods', autocomplete: 'off' });
  const results = h('div.food-results', { role: 'listbox', 'aria-label': 'Foods' });
  const detail = h('div');
  const closeFoot = () => { s.foot.textContent = ''; s.foot.append(h('button.btn', { type: 'button', text: 'Close', onclick: () => s.close() })); };
  const drawResults = () => {
    results.textContent = ''; detail.textContent = ''; closeFoot();
    const hits = searchFoods(q.value, { meals });
    if (!q.value.trim()) results.append(h('div.tx-day.hint', { text: D().recent.length ? 'Recent' : 'Popular foods' }));
    if (!hits.length) results.append(h('p.muted', { text: meals ? 'No match. Try a simpler word, use Quick add, or build a meal.' : 'No match. Try a simpler word.' }));
    for (const f of hits) {
      const p0 = f.portions[0];
      const sub = f.built ? `My meal · ${p0.label} ≈ ${Math.round(f.kcal * p0.grams / 100)} kcal` : `${f.custom ? 'My food' : f.group} · ${f.kcal} kcal per 100 g${p0 ? ` · ${p0.label} ≈ ${Math.round(f.kcal * p0.grams / 100)} kcal` : ''}`;
      results.append(h('button.food-hit', { type: 'button', role: 'option', onclick: () => pick(f) }, h('span.grow', h('div.title', { text: f.name }), h('div.sub', { text: sub })), icon('chevronRight', 16)));
    }
  };
  function pick(f) {
    results.textContent = ''; detail.textContent = '';
    const gl = g => trim(g, 1);
    const portionSel = h('select.input', { 'aria-label': 'Portion' }, f.portions.map((p, i) => h('option', { value: String(i), text: `${p.label} (${gl(p.grams)} g)` })), h('option', { value: 'g', text: 'Grams' }));
    portionSel.value = f.portions.length ? '0' : 'g';
    const qty = h('input.input', { type: 'number', min: 0, step: 0.25, value: 1, 'aria-label': f.built ? 'Servings' : 'How many', inputmode: 'decimal' });
    const grams = h('input.input', { type: 'number', min: 0, step: 1, value: f.portions[0] ? Math.round(f.portions[0].grams) : 100, 'aria-label': 'Grams', inputmode: 'decimal' });
    const est = h('div.estimate', { 'aria-live': 'polite' });
    const calc = () => {
      const p = portionSel.value === 'g' ? null : f.portions[Number(portionSel.value)];
      const g = p ? p.grams * (Number(qty.value) || 0) : Number(grams.value) || 0;
      qtyField.hidden = !p; gramsField.hidden = !!p;
      const e = estimate(f, g);
      est.textContent = '';
      est.append(h('div.cal', h('b', { text: e.kcal }), h('span', { text: 'kcal' })), h('div', h('b', { text: e.protein }), h('span', { text: 'protein g' })), h('div', h('b', { text: e.carbs }), h('span', { text: 'carbs g' })), h('div', h('b', { text: e.fat }), h('span', { text: 'fat g' })));
      return { g, p, e };
    };
    const qtyField = h('label.field', h('span', { text: f.built ? 'Servings' : 'How many' }), qty), gramsField = h('label.field', h('span', { text: 'Grams' }), grams);
    for (const el of [portionSel, qty, grams]) el.addEventListener('input', calc);
    const form = h('form', { onsubmit: e => {
      e.preventDefault();
      const { g, p, e: est2 } = calc();
      if (!(g > 0) || g > 100000) return toast('Enter an amount greater than zero.', { error: true });
      s.close();
      onAdd({ food: f, grams: g, portion: p, qty: Number(qty.value) || 0, portionText: p ? `${Number(qty.value)} × ${p.label}` : `${Math.round(g)} g`, est: est2 });
    } }, h('div.card-head', h('h2', { text: f.name }), h('button.btn.btn-sm.btn-ghost', { type: 'button', text: '← Back to search', onclick: () => { drawResults(); q.focus(); } })),
    h('p.hint', { text: `${trim(f.kcal, 1)} kcal · ${trim(f.protein, 1)} g protein · ${trim(f.carbs, 1)} g carbs · ${trim(f.fat, 1)} g fat per 100 g` }),
    h('div.grid-2', h('label.field', h('span', { text: 'Portion' }), portionSel), qtyField, gramsField), est);
    detail.append(form);
    calc();
    s.foot.textContent = '';
    s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: confirmLabel, onclick: () => form.requestSubmit() }));
    setTimeout(() => (f.portions.length ? qty : grams).select(), 30);
  }
  q.addEventListener('input', drawResults);
  s.body.append(h('div.row', q, onQuick ? h('button.btn', { type: 'button', text: quickLabel, onclick: () => { s.close(); onQuick(); } }) : null), results, detail);
  q.style.flex = '1'; q.style.width = 'auto';
  drawResults();
  setTimeout(() => q.focus(), 30);
}
function quickAdd(slotId) {
  quickEntrySheet({ title: 'Quick add', confirmLabel: 'Add', onAdd: entry => { addEntry(slotId, { ...entry, grams: 0, portion: '1 serving' }); changed(); } });
}
/** Name + calories + macros form. onAdd gets { name, kcal, protein, carbs, fat }. */
function quickEntrySheet({ title, confirmLabel, onAdd }) {
  const s = sheet(title);
  const f = { name: h('input.input', { maxlength: 80, placeholder: 'e.g. Homemade curry', required: true }), kcal: h('input.input', { type: 'number', min: 0, max: 10000, required: true }), protein: h('input.input', { type: 'number', min: 0, step: 0.1 }), carbs: h('input.input', { type: 'number', min: 0, step: 0.1 }), fat: h('input.input', { type: 'number', min: 0, step: 0.1 }) };
  const form = h('form', { onsubmit: e => { e.preventDefault(); const kcal = Number(f.kcal.value); if (!(kcal >= 0) || f.kcal.value === '') return; s.close(); onAdd({ name: f.name.value.trim() || 'Quick add', kcal: Math.round(kcal), protein: Number(f.protein.value) || 0, carbs: Number(f.carbs.value) || 0, fat: Number(f.fat.value) || 0 }); } },
    h('label.field', h('span', { text: 'Name' }), f.name), h('label.field', h('span', { text: 'Calories' }), f.kcal),
    h('div.grid-3', h('label.field', h('span', { text: 'Protein g' }), f.protein), h('label.field', h('span', { text: 'Carbs g' }), f.carbs), h('label.field', h('span', { text: 'Fat g' }), f.fat)));
  s.body.append(form);
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: confirmLabel, onclick: () => form.requestSubmit() }));
  setTimeout(() => f.name.focus(), 30);
}

// ---------- build your own meal ----------
const fmtN = n => String(Math.round(n));
const fmtM = n => trim(n, 1);
function mealBuilder(existing) {
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), name: '', servings: 1, ingredients: [] };
  const s = sheet(existing ? 'Edit meal' : 'Build a meal', { wide: true });
  const name = h('input.input', { maxlength: 80, required: true, placeholder: 'e.g. Chicken stir-fry', value: draft.name, oninput: e => { draft.name = e.target.value; } });
  const servings = h('input.input', { type: 'number', min: 0.5, max: 100, step: 0.5, inputmode: 'decimal', value: draft.servings || 1, 'aria-label': 'Number of servings', oninput: e => { draft.servings = Number(e.target.value) > 0 ? Number(e.target.value) : 1; drawTotals(); } });
  const list = h('div.ing-list'), totals = h('div');
  function drawTotals() {
    const t = mealTotals(draft), sv = Math.max(0.5, Number(draft.servings) || 1);
    totals.textContent = '';
    const box = (label, k, t2) => h('div', h('p.label', { text: label }), h('div.estimate', h('div.cal', h('b', { text: fmtN(t2.kcal * k) }), h('span', { text: 'kcal' })), h('div', h('b', { text: fmtM(t2.protein * k) }), h('span', { text: 'protein g' })), h('div', h('b', { text: fmtM(t2.carbs * k) }), h('span', { text: 'carbs g' })), h('div', h('b', { text: fmtM(t2.fat * k) }), h('span', { text: 'fat g' }))));
    totals.append(box(`Whole meal · ${fmtN(t.grams)} g`, 1, t));
    if (sv !== 1) totals.append(box(`Per serving (${trim(sv)} servings) · ${fmtN(t.grams / sv)} g`, 1 / sv, t));
  }
  function drawList() {
    list.textContent = '';
    if (!draft.ingredients.length) list.append(h('p.muted', { text: 'No ingredients yet. Add the first one below.' }));
    draft.ingredients.forEach((ing, i) => {
      const brk = h('div.ing-nums');
      const upd = () => { const n = ingNutri(ing); brk.textContent = ''; brk.append(h('b.kcal', { text: fmtN(n.kcal) + ' kcal' }), h('span', { text: `P ${fmtM(n.protein)} g` }), h('span', { text: `C ${fmtM(n.carbs)} g` }), h('span', { text: `F ${fmtM(n.fat)} g` })); };
      upd();
      const grams = h('input.input', { type: 'number', min: 0, max: 100000, step: 1, inputmode: 'decimal', value: trim(ing.grams, 1), 'aria-label': `Grams of ${ing.name}`, oninput: e => { ing.grams = Math.max(0, Number(e.target.value) || 0); ing.portion = `${trim(ing.grams, 1)} g`; upd(); drawTotals(); } });
      list.append(h('div.ing', h('div.ing-top', h('span.grow', h('div.title', { text: ing.name }), h('div.sub', { text: ing.portion || '' })), h('label.ing-g', grams, h('span', { text: 'g' })),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Remove ' + ing.name, onclick: () => { draft.ingredients.splice(i, 1); drawList(); drawTotals(); } }, icon('trash', 16))), brk));
    });
  }
  const addBtn = h('button.btn.btn-accent', { type: 'button', onclick: () => foodPicker({ title: 'Add an ingredient', confirmLabel: 'Add ingredient', meals: false, onAdd: ({ food: f, grams: g, portionText }) => {
    draft.ingredients.push({ id: uid(), foodId: f.id, name: f.name, grams: Math.round(g * 10) / 10, portion: portionText, per100: { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat } });
    drawList(); drawTotals();
  } }) }, icon('plus', 15), 'Add ingredient');
  s.body.append(h('div.grid-2', h('label.field', h('span', { text: 'Meal name' }), name), h('label.field', h('span', { text: 'Servings it makes' }), servings)),
    h('p.label', { text: 'Ingredients' }), list, h('div.row.ing-add', addBtn, h('span.hint', { text: 'Pick from the food bank or your own foods. Change the grams on any row.' })), totals);
  drawList(); drawTotals();
  if (existing) s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => {
    if (await confirmSheet('Delete “' + existing.name + '”?', 'Meals already logged or planned keep their values.', { confirmLabel: 'Delete meal' })) { D().builtMeals = D().builtMeals.filter(x => x.id !== existing.id); s.close(); changed(); }
  } }));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save meal', onclick: () => {
    draft.name = draft.name.trim();
    if (!draft.name) return toast('Give the meal a name.', { error: true });
    if (!draft.ingredients.length) return toast('Add at least one ingredient.', { error: true });
    draft.servings = Math.max(0.5, Number(draft.servings) || 1);
    if (existing) Object.assign(D().builtMeals.find(x => x.id === existing.id), draft); else D().builtMeals.push(draft);
    s.close(); changed(); toast(`Saved “${draft.name}”. Search for it when adding food.`);
  } }));
  setTimeout(() => name.focus(), 30);
}
function customFoodSheet(existing) {
  const ex = existing && existing.id ? existing : null;
  const s = sheet(ex ? 'Edit custom food' : 'Create custom food');
  const serving = ex && ex.portions[0] ? ex.portions[0] : { label: '1 serving', grams: 100 };
  const per = k => ex ? r1(ex[k] * serving.grams / 100) : '';
  const f = { name: h('input.input', { maxlength: 80, required: true, value: ex ? ex.name : '' }), label: h('input.input', { maxlength: 40, value: serving.label }), grams: h('input.input', { type: 'number', min: 1, max: 5000, value: serving.grams }), kcal: h('input.input', { type: 'number', min: 0, required: true, value: per('kcal') }), protein: h('input.input', { type: 'number', min: 0, step: 0.1, value: per('protein') }), carbs: h('input.input', { type: 'number', min: 0, step: 0.1, value: per('carbs') }), fat: h('input.input', { type: 'number', min: 0, step: 0.1, value: per('fat') }) };
  const form = h('form', { onsubmit: e => {
    e.preventDefault();
    const g = Number(f.grams.value) || 100, k = 100 / g;
    const food = { id: ex ? ex.id : 'my:' + uid(), name: f.name.value.trim() || 'My food', group: 'My foods', kcal: Math.round((Number(f.kcal.value) || 0) * k), protein: r1((Number(f.protein.value) || 0) * k), carbs: r1((Number(f.carbs.value) || 0) * k), fat: r1((Number(f.fat.value) || 0) * k), fiber: 0, portions: [{ label: f.label.value.trim() || '1 serving', grams: g }] };
    if (ex) Object.assign(D().customFoods.find(x => x.id === ex.id), food); else D().customFoods.push(food);
    s.close(); changed(); toast('Saved “' + food.name + '”. Search for it when adding food.');
  } }, h('label.field', h('span', { text: 'Name' }), f.name),
  h('div.grid-2', h('label.field', h('span', { text: 'Serving name' }), f.label), h('label.field', h('span', { text: 'Serving weight (g)' }), f.grams)),
  h('p.hint', { text: 'Nutrition for one serving (from the package label):' }),
  h('div.grid-4', h('label.field', h('span', { text: 'Calories' }), f.kcal), h('label.field', h('span', { text: 'Protein g' }), f.protein), h('label.field', h('span', { text: 'Carbs g' }), f.carbs), h('label.field', h('span', { text: 'Fat g' }), f.fat)));
  s.body.append(form);
  if (ex) s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: () => { D().customFoods = D().customFoods.filter(x => x.id !== ex.id); s.close(); changed(); } }));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save', onclick: () => form.requestSubmit() }));
}
function saveMeal(entries, suggestion) {
  const s = sheet('Save as a meal');
  const name = h('input.input', { maxlength: 60, value: suggestion + ' (' + fmtDate(state.day) + ')' });
  const form = h('form', { onsubmit: e => { e.preventDefault(); D().savedMeals.push({ id: uid(), name: name.value.trim() || 'Meal', items: entries.map(({ id, slotId, ...rest }) => rest) }); s.close(); changed(); toast('Meal saved. Use “Add saved meal” to log it again.'); } }, h('label.field', h('span', { text: 'Name' }), name), h('p.hint', { text: entries.map(e => e.name).join(', ') }));
  s.body.append(form);
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save meal', onclick: () => form.requestSubmit() }));
}
function savedMealSheet(slotId) {
  const s = sheet('Add a saved meal');
  s.body.append(h('ul.list', D().savedMeals.map(m => { const kcal = m.items.reduce((a, x) => a + x.kcal, 0); return h('li.list-row', h('span.grow', h('div.title', { text: m.name }), h('div.sub', { text: m.items.map(x => x.name).join(', ') })), h('span.kcal', { text: Math.round(kcal) + ' kcal' }), h('button.btn.btn-sm.btn-accent', { type: 'button', text: 'Add', onclick: () => { for (const it of m.items) addEntry(slotId, { ...it }); s.close(); changed(); toast(`Added ${m.name}.`); } })); })));
  s.foot.append(h('button.btn', { type: 'button', text: 'Close', onclick: () => s.close() }));
}
function copyYesterday(slot) {
  const prev = dayLog(addDaysISO(state.day, -1)).entries.filter(e => e.slotId === slot.id);
  if (!prev.length) return toast(`Nothing was logged for ${slot.name} the day before.`, { error: true });
  for (const e of prev) { const { id, ...rest } = e; addEntry(slot.id, rest); }
  changed(); toast(`Copied ${prev.length} item${prev.length === 1 ? '' : 's'} from the day before.`);
}
function manageFoods() {
  const s = sheet('My meals & foods', { wide: true });
  const draw = () => {
    s.body.textContent = '';
    s.body.append(h('div.card-head', h('h3', { text: 'My meals' }), h('button.btn.btn-sm.btn-accent', { type: 'button', onclick: () => { s.close(); mealBuilder(null); } }, icon('plus', 14), 'Build a meal')));
    if (!D().builtMeals.length) s.body.append(h('p.muted', { text: 'None yet. Build a meal from ingredients and Stride adds up the calories and macros.' }));
    s.body.append(h('ul.list', D().builtMeals.map(m => { const t = mealTotals(m), sv = Math.max(0.5, Number(m.servings) || 1); return h('li.list-row', h('span.grow', h('div.title', { text: m.name }), h('div.sub', { text: `${m.ingredients.length} ingredient${m.ingredients.length === 1 ? '' : 's'} · ${Math.round(t.kcal / sv)} kcal per serving (${trim(sv)} serving${sv === 1 ? '' : 's'})` })),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Edit ' + m.name, onclick: () => { s.close(); mealBuilder(m); } }, icon('edit', 16)),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Delete ' + m.name, onclick: async () => { if (await confirmSheet('Delete “' + m.name + '”?', 'Meals already logged or planned keep their values.', { confirmLabel: 'Delete meal' })) { D().builtMeals = D().builtMeals.filter(x => x.id !== m.id); store.changed(); draw(); render(); } } }, icon('trash', 16))); })));
    s.body.append(h('div.card-head', { style: { marginTop: '16px' } }, h('h3', { text: 'Custom foods' }), h('button.btn.btn-sm', { type: 'button', onclick: () => { s.close(); customFoodSheet(); } }, icon('plus', 14), 'New food')));
    if (!D().customFoods.length) s.body.append(h('p.muted', { text: 'None yet. Single foods from a package label can be added here; they can also be used as meal ingredients.' }));
    s.body.append(h('ul.list', D().customFoods.map(f => h('li.list-row', h('span.grow', h('div.title', { text: f.name }), h('div.sub', { text: `${f.portions[0] ? f.portions[0].label + ' (' + f.portions[0].grams + ' g) · ' : ''}${Math.round(f.kcal * (f.portions[0] ? f.portions[0].grams : 100) / 100)} kcal` })), h('button.icon-btn', { type: 'button', 'aria-label': 'Edit ' + f.name, onclick: () => { s.close(); customFoodSheet(f); } }, icon('edit', 16))))));
    s.body.append(h('h3', { text: 'Saved meals', style: { margin: '16px 0 6px' } }));
    if (!D().savedMeals.length) s.body.append(h('p.muted', { text: 'Log a meal, then choose “Save as meal” to reuse it.' }));
    s.body.append(h('ul.list', D().savedMeals.map(m => h('li.list-row', h('span.grow', h('div.title', { text: m.name }), h('div.sub', { text: m.items.map(x => x.name).join(', ') })), h('button.icon-btn', { type: 'button', 'aria-label': 'Delete ' + m.name, onclick: () => { D().savedMeals = D().savedMeals.filter(x => x.id !== m.id); store.changed(); draw(); } }, icon('trash', 16))))));
  };
  draw();
  s.foot.append(h('button.btn', { type: 'button', text: 'Close', onclick: () => s.close() }));
}

// ---------- plan: meals and workouts on days ----------
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clone = o => JSON.parse(JSON.stringify(o));
/** Sensible start time for a new planned meal, from the section name. */
function defaultTimeFor(name) {
  const n = String(name || '').toLowerCase();
  if (/breakfast/.test(n)) return '08:00';
  if (/lunch/.test(n)) return '12:00';
  if (/dinner|supper/.test(n)) return '18:00';
  return '15:00';
}
function sumItems(items) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const i of items || []) { t.kcal += Number(i.kcal) || 0; t.protein += Number(i.protein) || 0; t.carbs += Number(i.carbs) || 0; t.fat += Number(i.fat) || 0; }
  return t;
}
const planMealsOn = day => D().plan.meals.filter(m => m.date === day).sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.name.localeCompare(b.name));
// "Now" in the Satchel time zone (Settings), the same clock Almanac uses.
function nowParts() { return nowInZone(); }
function relDay(date) {
  const t = todayISO();
  return date === t ? 'Today' : date === addDaysISO(t, 1) ? 'Tomorrow' : date === addDaysISO(t, -1) ? 'Yesterday' : fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' });
}
const slotOf = id => D().mealSlots.find(x => x.id === id) || null;

function planTab(v) {
  const day = state.planDay, g = D().goals;
  const picker = h('input.input', { type: 'date', value: day, 'aria-label': 'Pick a date', onchange: e => { if (isISODate(e.target.value)) { state.planDay = e.target.value; render(); } } });
  picker.style.width = 'auto';
  v.append(h('div.page-head', h('div', h('h1', { text: 'Meal plan' }), h('p', { text: 'Plan what you will eat, then log it with one tap when the time comes.' })), h('div.row', dayNav('planDay'), picker)));
  const dow = (new Date(day + 'T12:00:00').getDay() + 6) % 7, start = addDaysISO(day, -dow);
  const strip = h('div.week-strip', { role: 'group', 'aria-label': 'Week overview' });
  for (let i = 0; i < 7; i++) {
    const d = addDaysISO(start, i), ms = planMealsOn(d), kcal = Math.round(sumItems(ms.flatMap(m => m.items)).kcal), ws = D().plan.workouts.filter(w => w.date === d).length;
    strip.append(h('button.wk-day' + (d === day ? '.on' : '') + (d === todayISO() ? '.today' : ''), { type: 'button', 'aria-pressed': String(d === day), 'aria-label': `${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}: ${ms.length} planned meal${ms.length === 1 ? '' : 's'}, ${kcal} kcal${ws ? ', workout planned' : ''}`, onclick: () => { state.planDay = d; render(); } },
      h('span.dow', { text: fmtDate(d, { weekday: 'short' }) }), h('span.dnum', { text: String(Number(d.slice(8))) }), h('span.wk-k', { text: ms.length ? kcal.toLocaleString() : '–' }), h('span.wk-w' + (ws ? '.on' : ''), { 'aria-hidden': 'true' })));
  }
  v.append(h('section.card', strip, h('p.hint', { style: { marginTop: '8px' }, text: 'Numbers are planned calories for each day. A dot marks a planned workout.' })));
  const meals = planMealsOn(day), t = sumItems(meals.flatMap(m => m.items));
  v.append(h('div.stat-grid', { style: { margin: '16px 0' } },
    h('div.stat', h('div.v', { text: Math.round(t.kcal).toLocaleString() }), h('div.k', { text: `planned kcal${g.kcal ? ' of ' + g.kcal : ''}` })),
    h('div.stat', h('div.v', { text: Math.round(t.protein) + ' g' }), h('div.k', { text: 'Protein' })),
    h('div.stat', h('div.v', { text: Math.round(t.carbs) + ' g' }), h('div.k', { text: 'Carbs' })),
    h('div.stat', h('div.v', { text: Math.round(t.fat) + ' g' }), h('div.k', { text: 'Fat' }))));
  if (!meals.length) v.append(h('div.card', h('div.empty-state', h('h3', { text: 'Nothing planned for ' + relDay(day).toLowerCase() }), h('p', { text: 'Add a meal and pick its foods. Breakfast defaults to 08:00, lunch 12:00 and dinner 18:00.' }))));
  for (const m of meals) v.append(planMealCard(m));
  const ws = D().plan.workouts.filter(w => w.date === day).sort((a, b) => a.time.localeCompare(b.time));
  if (ws.length) v.append(h('section.card', h('div.card-head', h('h2', { text: 'Workouts this day' })), h('ul.list', ws.map(w => h('li.list-row', h('span.grow', h('div.title', { text: `${w.time} · ${w.name}` }), h('div.sub', { text: `${w.durationMin} min` + (w.notes ? ' · ' + w.notes : '') })), w.sessionId ? h('span.pill', { text: 'Done' }) : null, h('button.icon-btn', { type: 'button', 'aria-label': 'Edit ' + w.name, onclick: () => plannedWorkoutSheet(w) }, icon('edit', 16)))))));
  v.append(h('div.row', { style: { marginTop: '16px' } }, h('button.btn.btn-accent', { type: 'button', onclick: () => planMealSheet(null, { date: day }) }, icon('plus', 15), 'Plan a meal'),
    h('button.btn', { type: 'button', onclick: () => plannedWorkoutSheet(null, { date: day }) }, icon('plus', 15), 'Schedule a workout')));
}
function itemSub(it) {
  const amount = it.portion || (it.grams ? `${Math.round(it.grams)} g` : it.servings ? `${it.servings} × serving` : '');
  return `${amount ? amount + ' · ' : ''}P ${r1(it.protein || 0)} · C ${r1(it.carbs || 0)} · F ${r1(it.fat || 0)}`;
}
function planMealCard(m) {
  const t = sumItems(m.items);
  const card = h('section.card.slot.plan-meal', h('div.slot-head', h('span.plan-time', { text: m.time }), h('h2', { text: m.name }), h('span.slot-kcal', { text: Math.round(t.kcal) + ' kcal' }),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Edit ' + m.name, onclick: () => planMealSheet(m) }, icon('edit', 16))));
  if (!m.items.length) card.append(h('p.muted', { text: 'No foods yet. Open it to add some.' }));
  for (const it of m.items) card.append(h('div.entry', h('span.grow', h('div.title', { text: it.name }), h('div.sub', { text: itemSub(it) })), h('span.kcal', { text: Math.round(it.kcal) + ' kcal' })));
  if (m.items.length) card.append(h('div.sub.plan-totals', { text: `Total: P ${r1(t.protein)} g · C ${r1(t.carbs)} g · F ${r1(t.fat)} g` }));
  if (m.notes) card.append(h('p.hint', { text: m.notes }));
  card.append(h('div.row', { style: { marginTop: '10px' } },
    h('button.btn.btn-sm.btn-accent', { type: 'button', text: m.loggedAt ? 'Log again' : 'Log it', onclick: () => logPlanMeal(m) }),
    h('button.btn.btn-sm', { type: 'button', onclick: () => duplicatePlanMeal(m) }, icon('copy', 14), 'Duplicate'),
    h('button.btn.btn-sm.btn-ghost', { type: 'button', text: 'Edit', onclick: () => planMealSheet(m) }),
    m.loggedAt ? h('span.pill', { text: 'Logged' }) : null));
  return card;
}
function planMealSheet(existing, preset = {}) {
  const slots = D().mealSlots;
  const draft = existing ? clone(existing) : { id: uid(), date: preset.date || state.planDay, time: '', slotId: slots[0].id, name: '', items: [], notes: '' };
  const slotName = () => (slotOf(draft.slotId) || {}).name || '';
  if (!existing) { draft.name = slotName(); draft.time = defaultTimeFor(draft.name); }
  const s = sheet(existing ? 'Edit planned meal' : 'Plan a meal', { wide: true });
  const slotSel = h('select.input', { 'aria-label': 'Meal section' }, slots.map(x => h('option', { value: x.id, text: x.name })), h('option', { value: '', text: 'Other (no section)' }));
  slotSel.value = slotOf(draft.slotId) ? draft.slotId : '';
  const nameIn = h('input.input', { maxlength: 60, value: draft.name, 'aria-label': 'Name', oninput: e => { draft.name = e.target.value; } });
  const dateIn = h('input.input', { type: 'date', value: draft.date, required: true, oninput: e => { draft.date = e.target.value; } });
  const timeIn = h('input.input', { type: 'time', value: draft.time, required: true, oninput: e => { draft.time = e.target.value; } });
  slotSel.addEventListener('change', () => {
    const prev = slotName() || 'Meal', prevTime = defaultTimeFor(prev);
    draft.slotId = slotSel.value || null;
    const next = slotName() || 'Meal';
    if (!draft.name.trim() || draft.name === prev) { draft.name = next; nameIn.value = next; }
    if (!draft.time || draft.time === prevTime) { draft.time = defaultTimeFor(next); timeIn.value = draft.time; }
  });
  const list = h('div'), totals = h('div.estimate', { 'aria-live': 'polite' });
  const draw = () => {
    list.textContent = '';
    if (!draft.items.length) list.append(h('p.muted', { text: 'No foods yet. Add from the food bank, one of your meals, or a quick calorie entry.' }));
    draft.items.forEach((it, i) => list.append(h('div.entry', h('span.grow', h('div.title', { text: it.name }), h('div.sub', { text: itemSub(it) })), h('span.kcal', { text: Math.round(it.kcal) + ' kcal' }),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Remove ' + it.name, onclick: () => { draft.items.splice(i, 1); draw(); } }, icon('x', 16)))));
    const t = sumItems(draft.items);
    totals.textContent = '';
    totals.append(h('div.cal', h('b', { text: Math.round(t.kcal) }), h('span', { text: 'kcal' })), h('div', h('b', { text: r1(t.protein) }), h('span', { text: 'protein g' })), h('div', h('b', { text: r1(t.carbs) }), h('span', { text: 'carbs g' })), h('div', h('b', { text: r1(t.fat) }), h('span', { text: 'fat g' })));
  };
  draw();
  const addFood = () => foodPicker({ title: 'Add to ' + (draft.name || 'meal'), confirmLabel: 'Add to meal', onQuick: addQuick, quickLabel: 'Quick kcal', onAdd: ({ food: f, grams: g, portion: p, qty, portionText, est }) => {
    draft.items.push({ name: f.name, grams: Math.round(g), servings: f.built && f.portions[0] && f.portions[0].grams > 0 ? r1(g / f.portions[0].grams) : null, kcal: est.kcal, protein: est.protein, carbs: est.carbs, fat: est.fat, ...(f.built ? { mealId: f.mealId } : { foodId: f.id }), portion: portionText });
    draw();
  } });
  const addQuick = () => quickEntrySheet({ title: 'Quick calories', confirmLabel: 'Add to meal', onAdd: e => { draft.items.push({ name: e.name, grams: null, servings: 1, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, portion: '1 serving' }); draw(); } });
  const notes = h('textarea.input', { placeholder: 'Notes (optional)', 'aria-label': 'Notes', maxlength: 500, value: draft.notes || '', oninput: e => { draft.notes = e.target.value; } });
  s.body.append(h('div.grid-2', h('label.field', h('span', { text: 'Meal section' }), slotSel), h('label.field', h('span', { text: 'Name' }), nameIn)),
    h('div.grid-2', h('label.field', h('span', { text: 'Date' }), dateIn), h('label.field', h('span', { text: 'Time' }), timeIn)),
    h('p.label', { text: 'Foods' }), list, h('div.row', h('button.btn.btn-accent', { type: 'button', onclick: addFood }, icon('plus', 15), 'Add food'), h('button.btn', { type: 'button', text: 'Quick kcal', onclick: addQuick })),
    totals, h('label.field', { style: { marginTop: '12px' } }, h('span', { text: 'Notes' }), notes));
  const save = () => {
    if (!isISODate(draft.date)) { toast('Choose a date.', { error: true }); return null; }
    if (!TIME_RE.test(draft.time)) { toast('Choose a time.', { error: true }); return null; }
    draft.name = draft.name.trim() || slotName() || 'Meal';
    let m = existing;
    if (m) Object.assign(m, draft); else { m = draft; D().plan.meals.push(m); }
    state.planDay = m.date;
    return m;
  };
  if (existing) s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => {
    if (!(await confirmSheet('Delete “' + existing.name + '”?', 'This planned meal is removed. Anything already logged stays.', { confirmLabel: 'Delete planned meal' }))) return;
    D().plan.meals = D().plan.meals.filter(x => x.id !== existing.id); s.close(); changed();
  } }), h('button.btn', { type: 'button', text: 'Duplicate', onclick: () => { const m = save(); if (m) { s.close(); changed(); duplicatePlanMeal(m); } } }),
  h('button.btn', { type: 'button', text: 'Log it', onclick: () => {
    if (!draft.items.length) { toast('Add foods to this planned meal first.', { error: true }); return; }
    const m = save(); if (!m) return;
    s.close(); changed(); logPlanMeal(m);
  } }));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save', onclick: () => { if (save()) { s.close(); changed(); toast('Planned meal saved.'); } } }));
}
function duplicatePlanMeal(m) {
  const s = sheet('Duplicate to another day');
  const date = h('input.input', { type: 'date', value: addDaysISO(m.date, 1), required: true });
  const quick = (label, d) => h('button.btn.btn-sm', { type: 'button', text: label, onclick: () => { date.value = d; } });
  s.body.append(h('p.muted', { text: `${m.name} · ${m.time} · ${Math.round(sumItems(m.items).kcal)} kcal` }), h('label.field', h('span', { text: 'Copy to' }), date),
    h('div.row', quick('Tomorrow', addDaysISO(m.date, 1)), quick('Next week', addDaysISO(m.date, 7))));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Duplicate', onclick: () => {
    if (!isISODate(date.value)) return toast('Choose a date.', { error: true });
    const { loggedAt, ...rest } = clone(m);
    D().plan.meals.push({ ...rest, id: uid(), date: date.value });
    s.close(); changed(); toast(`Copied to ${relDay(date.value)}.`, { action: () => { state.planDay = date.value; state.tab = 'plan'; render(); }, actionLabel: 'Go there' });
  } }));
}
function logPlanMeal(m) {
  if (!m.items.length) return toast('Add foods to this planned meal first.', { error: true });
  const slots = D().mealSlots;
  const slot = slotOf(m.slotId) || slots.find(x => x.name.toLowerCase() === m.name.toLowerCase()) || slots[0];
  const go = () => {
    for (const it of m.items) {
      const foodId = it.foodId || (it.mealId ? 'meal:' + it.mealId : null);
      addEntry(slot.id, { ...(foodId ? { foodId } : {}), ...(it.mealId ? { mealId: it.mealId } : {}), name: it.name, grams: Math.round(it.grams || 0), portion: it.portion || (it.servings ? `${it.servings} × serving` : it.grams ? `${Math.round(it.grams)} g` : '1 serving'),
        kcal: Math.round(it.kcal || 0), protein: r1(it.protein || 0), carbs: r1(it.carbs || 0), fat: r1(it.fat || 0) }, m.date);
    }
    m.loggedAt = Date.now();
    changed();
    toast(`Logged ${m.items.length} item${m.items.length === 1 ? '' : 's'} to ${slot.name} for ${relDay(m.date).toLowerCase()}.`, { action: () => { state.day = m.date; state.tab = 'meals'; render(); }, actionLabel: 'View' });
  };
  if (m.loggedAt) confirmSheet('Log it again?', 'This planned meal was already logged. Logging again adds the foods a second time.', { confirmLabel: 'Log again', danger: false }).then(ok => { if (ok) go(); });
  else go();
}

// ---------- scheduled workouts ----------
function estimateMinutes(r) {
  if (!r || !r.items.length) return 45;
  let m = 0;
  for (const it of r.items) m += exById(it.exerciseId).kind === 'cardio' ? it.sets.reduce((a, s) => a + (s.minutes || 0), 0) : it.sets.length * 2.5;
  return Math.max(10, Math.round((m + 5) / 5) * 5);
}
function plannedRow(w) {
  return h('li.list-row', h('span.grow', h('div.title', { text: w.name }), h('div.sub', { text: `${relDay(w.date)} · ${w.time} · ${w.durationMin} min${w.notes ? ' · ' + w.notes : ''}` })),
    D().active ? null : h('button.btn.btn-sm.btn-accent', { type: 'button', onclick: () => startSession(D().routines.find(r => r.id === w.routineId) || null, w) }, icon('play', 13), 'Start'),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Edit ' + w.name, onclick: () => plannedWorkoutSheet(w) }, icon('edit', 16)));
}
function scheduledSection(v) {
  const now = nowParts(), key = w => w.date + ' ' + w.time, nowKey = now.date + ' ' + now.time;
  const open = D().plan.workouts.filter(w => !w.sessionId).sort((a, b) => key(a).localeCompare(key(b)));
  const upcoming = open.filter(w => key(w) >= nowKey), missed = open.filter(w => key(w) < nowKey).reverse().slice(0, 10);
  const card = h('section.card', h('div.card-head', h('h2', { text: 'Scheduled workouts' }), h('button.btn.btn-sm', { type: 'button', onclick: () => plannedWorkoutSheet(null) }, icon('plus', 14), 'Schedule')));
  card.append(upcoming.length ? h('ul.list', upcoming.slice(0, 8).map(plannedRow)) : h('p.muted', { text: 'Nothing scheduled. Pick a routine, a day and a time, and Stride will keep it here.' }));
  if (upcoming.length > 8) card.append(h('p.hint', { text: `${upcoming.length - 8} more later.` }));
  if (missed.length) card.append(h('details.missed', h('summary', { text: `Not done (${missed.length})` }), h('ul.list', missed.map(plannedRow))));
  v.append(card);
}
function plannedWorkoutSheet(existing, preset = {}) {
  const routines = D().routines;
  const first = existing ? null : routines[0] || null;
  const draft = existing ? clone(existing) : { id: uid(), date: preset.date || todayISO(), time: '18:00', durationMin: estimateMinutes(first), routineId: first ? first.id : null, name: first ? first.name : '', notes: '', sessionId: null };
  const routineOf = id => routines.find(r => r.id === id) || null;
  const s = sheet(existing ? 'Edit scheduled workout' : 'Schedule a workout');
  const sel = h('select.input', { 'aria-label': 'Routine' }, routines.map(r => h('option', { value: r.id, text: r.name })), h('option', { value: '', text: 'Something else (type a name)' }));
  sel.value = routineOf(draft.routineId) ? draft.routineId : '';
  const nameIn = h('input.input', { maxlength: 60, placeholder: 'e.g. Park run', value: draft.name, 'aria-label': 'Workout name', oninput: e => { draft.name = e.target.value; } });
  const dateIn = h('input.input', { type: 'date', value: draft.date, required: true, oninput: e => { draft.date = e.target.value; } });
  const timeIn = h('input.input', { type: 'time', value: draft.time, required: true, oninput: e => { draft.time = e.target.value; } });
  const durIn = h('input.input', { type: 'number', min: 1, max: 600, step: 5, inputmode: 'numeric', value: draft.durationMin, 'aria-label': 'Expected minutes', oninput: e => { draft.durationMin = Number(e.target.value) || 0; } });
  const notes = h('textarea.input', { placeholder: 'Notes (optional)', 'aria-label': 'Notes', maxlength: 500, value: draft.notes || '', oninput: e => { draft.notes = e.target.value; } });
  sel.addEventListener('change', () => {
    const prev = routineOf(draft.routineId), next = routineOf(sel.value);
    draft.routineId = next ? next.id : null;
    if (next && (!draft.name.trim() || (prev && draft.name === prev.name))) { draft.name = next.name; nameIn.value = next.name; }
    if (next && draft.durationMin === estimateMinutes(prev)) { draft.durationMin = estimateMinutes(next); durIn.value = draft.durationMin; }
  });
  const repeat = existing ? null : h('input.input', { type: 'number', min: 0, max: 26, step: 1, value: 0, inputmode: 'numeric', 'aria-label': 'Repeat for extra weeks' });
  s.body.append(h('div.grid-2', h('label.field', h('span', { text: 'Routine' }), sel), h('label.field', h('span', { text: 'Name' }), nameIn)),
    h('div.grid-3', h('label.field', h('span', { text: 'Date' }), dateIn), h('label.field', h('span', { text: 'Start time' }), timeIn), h('label.field', h('span', { text: 'Expected minutes' }), durIn)),
    h('label.field', h('span', { text: 'Notes' }), notes),
    repeat ? h('label.field', h('span', { text: 'Repeat weekly for this many extra weeks (0 for just once)' }), repeat) : null,
    existing && existing.sessionId ? h('p.hint', { text: 'This workout was completed and is in your history.' }) : null);
  const save = () => {
    if (!isISODate(draft.date)) { toast('Choose a date.', { error: true }); return null; }
    if (!TIME_RE.test(draft.time)) { toast('Choose a start time.', { error: true }); return null; }
    draft.name = draft.name.trim() || (routineOf(draft.routineId) || {}).name || 'Workout';
    draft.durationMin = Math.min(600, Math.max(1, Math.round(Number(draft.durationMin) || 45)));
    draft.notes = (draft.notes || '').trim();
    if (existing) { Object.assign(existing, draft); return existing; }
    D().plan.workouts.push(draft);
    for (let k = 1; k <= Math.min(26, Math.max(0, Math.round(Number(repeat.value) || 0))); k++) D().plan.workouts.push({ ...clone(draft), id: uid(), date: addDaysISO(draft.date, 7 * k) });
    return draft;
  };
  if (existing) s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => {
    if (!(await confirmSheet('Delete “' + existing.name + '”?', 'This scheduled workout is removed. A session already logged from it stays in your history.', { confirmLabel: 'Delete' }))) return;
    D().plan.workouts = D().plan.workouts.filter(x => x.id !== existing.id); s.close(); changed();
  } }));
  if (existing && !existing.sessionId) s.foot.append(h('button.btn', { type: 'button', onclick: () => {
    if (D().active) return toast('Finish or discard the workout in progress first.', { error: true });
    const w = save(); if (!w) return; s.close(); startSession(routineOf(w.routineId), w);
  } }, icon('play', 14), 'Start now'));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save', onclick: () => { if (save()) { s.close(); changed(); toast('Workout scheduled.'); } } }));
}

// ---------- workouts ----------
const exById = id => D().exercises.find(e => e.id === id) || { id, name: 'Removed exercise', kind: 'strength', group: '' };
function setSummary(kind, sets) {
  const done = sets.filter(s => s.done !== false);
  if (!done.length) return 'No sets';
  if (kind === 'strength') return done.map(s => `${s.reps || 0}×${r1(kgToShow(s.weight || 0))}`).join(', ') + ' ' + wUnit();
  if (kind === 'bodyweight') return done.map(s => `${s.reps || 0}`).join(', ') + ' reps';
  if (kind === 'timed') return done.map(s => `${s.seconds || 0}s`).join(', ');
  return done.map(s => `${s.minutes || 0} min${s.km ? ' · ' + r1(imperial() ? s.km * 0.621371 : s.km) + ' ' + kmUnit() : ''}`).join(', ');
}
function lastSets(exerciseId) {
  for (const s of D().sessions.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt || 0) - (a.startedAt || 0))) {
    const e = s.entries.find(x => x.exerciseId === exerciseId);
    if (e && e.sets.length) return { date: s.date, sets: e.sets };
  }
  return null;
}
function workouts(v) {
  if (D().active) { activeView(v); return; }
  v.append(h('div.page-head', h('div', h('h1', { text: 'Workouts' }), h('p', { text: 'Build routines from your own exercises, then log every set.' })),
    h('div.row', h('button.btn', { type: 'button', onclick: () => plannedWorkoutSheet(null) }, icon('clock', 15), 'Schedule workout'), h('button.btn.btn-accent', { type: 'button', onclick: () => startSession(null) }, icon('play', 15), 'Empty workout'))));
  scheduledSection(v);
  const seg = h('div.seg', { role: 'tablist', style: { marginBottom: '14px' } });
  for (const [k, l] of [['routines', 'Routines'], ['exercises', 'Exercises'], ['history', 'History']]) seg.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.wsub === k), text: l, onclick: () => { state.wsub = k; render(); } }));
  v.append(seg);
  if (state.wsub === 'routines') {
    const cards = h('div.cards');
    for (const r of D().routines) {
      const card = h('section.card.routine-card', h('div.card-head', h('h2', { text: r.name }), h('button.icon-btn', { type: 'button', 'aria-label': 'Edit ' + r.name, onclick: () => routineSheet(r) }, icon('edit', 16))),
        h('ul', r.items.map(it => h('li', { text: `${exById(it.exerciseId).name} · ${it.sets.length} set${it.sets.length === 1 ? '' : 's'}` }))),
        h('button.btn.btn-accent', { type: 'button', onclick: () => startSession(r) }, icon('play', 15), 'Start'));
      card.style.setProperty('--rc', r.color || COLORS[0]);
      cards.append(card);
    }
    cards.append(h('button.card', { type: 'button', style: { borderStyle: 'dashed', minHeight: '140px', cursor: 'pointer', color: 'var(--muted)', fontWeight: '600' }, onclick: () => routineSheet(null) }, '+ New routine'));
    v.append(cards);
  } else if (state.wsub === 'exercises') {
    const groups = [...new Set(D().exercises.map(e => e.group || 'Other'))].sort();
    v.append(h('div.row', { style: { marginBottom: '10px' } }, h('button.btn', { type: 'button', onclick: () => exerciseSheet(null) }, icon('plus', 15), 'New exercise')));
    for (const g of groups) {
      const card = h('section.card', h('div.card-head', h('h2', { text: g })));
      card.append(h('ul.list', D().exercises.filter(e => (e.group || 'Other') === g).sort((a, b) => a.name.localeCompare(b.name)).map(e => { const last = lastSets(e.id); return h('li.list-row', h('span.grow', h('div.title', { text: e.name }), h('div.sub', { text: KINDS[e.kind].label + (last ? ` · last: ${setSummary(e.kind, last.sets)}` : '') })), h('button.icon-btn', { type: 'button', 'aria-label': 'Edit ' + e.name, onclick: () => exerciseSheet(e) }, icon('edit', 16))); })));
      v.append(card);
    }
  } else {
    const list = D().sessions.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt || 0) - (a.startedAt || 0));
    if (!list.length) v.append(h('div.card', h('div.empty-state', h('h3', { text: 'No workouts yet' }), h('p', { text: 'Start a routine and your sessions will show up here.' }))));
    else v.append(h('section.card', h('ul.list', list.map(sessionRow))));
  }
}
function sessionRow(s) {
  return h('li.list-row', { style: { cursor: 'pointer' }, tabindex: 0, role: 'button', onclick: () => sessionSheet(s), onkeydown: e => { if (e.key === 'Enter') sessionSheet(s); } },
    h('span.grow', h('div.title', { text: s.name }), h('div.sub', { text: `${fmtDate(s.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${s.minutes || 0} min · ${s.entries.length} exercise${s.entries.length === 1 ? '' : 's'}` })),
    h('span.kcal', { text: `~${s.kcal || 0} kcal` }));
}
function sessionSheet(s) {
  const sh = sheet(s.name);
  sh.body.append(h('p.muted', { text: `${fmtDate(s.date, { weekday: 'long', month: 'long', day: 'numeric' })} · ${s.minutes} min · about ${s.kcal} kcal burned` }),
    h('ul.list', s.entries.map(e => { const ex = exById(e.exerciseId); return h('li.list-row', h('span.grow', h('div.title', { text: ex.name }), h('div.sub', { text: setSummary(ex.kind, e.sets) }))); })),
    s.notes ? h('p', { text: s.notes }) : null);
  sh.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => { if (await confirmSheet('Delete this workout?', 'It is removed from your history.', { confirmLabel: 'Delete workout' })) { D().sessions = D().sessions.filter(x => x.id !== s.id); for (const w of D().plan.workouts) if (w.sessionId === s.id) w.sessionId = null; sh.close(); changed(); } } }),
    h('button.btn', { type: 'button', text: 'Close', onclick: () => sh.close() }));
}
function exerciseSheet(ex) {
  const s = sheet(ex ? 'Edit exercise' : 'New exercise');
  const name = h('input.input', { maxlength: 60, required: true, value: ex ? ex.name : '' });
  const group = h('input.input', { maxlength: 30, value: ex ? ex.group : '', list: 'groups', placeholder: 'e.g. Legs' });
  const groups = h('datalist#groups', [...new Set(D().exercises.map(e => e.group).filter(Boolean))].map(g => h('option', { value: g })));
  const kind = h('select.input', Object.entries(KINDS).map(([k, x]) => h('option', { value: k, text: x.label })));
  kind.value = ex ? ex.kind : 'strength';
  const form = h('form', { onsubmit: e => { e.preventDefault(); const value = { name: name.value.trim() || 'Exercise', group: group.value.trim() || 'Other', kind: kind.value }; if (ex) Object.assign(ex, value); else D().exercises.push({ id: uid(), ...value }); s.close(); changed(); } },
    h('label.field', h('span', { text: 'Name' }), name), h('div.grid-2', h('label.field', h('span', { text: 'Muscle group' }), group, groups), h('label.field', h('span', { text: 'What you record' }), kind)));
  s.body.append(form);
  if (ex) s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => {
    if (D().routines.some(r => r.items.some(i => i.exerciseId === ex.id))) return toast('Remove it from your routines first.', { error: true });
    if (await confirmSheet('Delete “' + ex.name + '”?', 'Past workouts keep their sets but show it as a removed exercise.', { confirmLabel: 'Delete exercise' })) { D().exercises = D().exercises.filter(x => x.id !== ex.id); s.close(); changed(); }
  } }));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save', onclick: () => form.requestSubmit() }));
}
function setInputs(kind, set, onChange) {
  return KINDS[kind].cols.map(c => {
    const shown = c === 'weight' ? r1(kgToShow(set.weight || 0)) : c === 'km' ? r1(imperial() ? (set.km || 0) * 0.621371 : set.km || 0) : set[c] ?? '';
    return h('input.input', { type: 'number', min: 0, step: c === 'weight' || c === 'km' ? 0.5 : 1, inputmode: 'decimal', value: shown, 'aria-label': colLabel(c), oninput: e => {
      const n = Number(e.target.value) || 0;
      set[c] = c === 'weight' ? r1(showToKg(n)) : c === 'km' ? r1(imperial() ? n / 0.621371 : n) : n;
      onChange();
    } });
  });
}
function colLabel(c) { return c === 'weight' ? 'Weight (' + wUnit() + ')' : c === 'km' ? 'Distance (' + kmUnit() + ')' : c === 'reps' ? 'Reps' : c === 'seconds' ? 'Seconds' : 'Minutes'; }
function routineSheet(r) {
  const draft = r ? JSON.parse(JSON.stringify(r)) : { id: uid(), name: '', color: COLORS[D().routines.length % COLORS.length], items: [] };
  const s = sheet(r ? 'Edit routine' : 'New routine', { wide: true });
  const name = h('input.input', { maxlength: 60, value: draft.name, placeholder: 'e.g. Push day', required: true, oninput: e => { draft.name = e.target.value; } });
  const sw = h('div.swatch-pick');
  const drawSw = () => { sw.textContent = ''; for (const c of COLORS) { const b = h('button', { type: 'button', 'aria-label': 'Colour ' + c, 'aria-pressed': String(draft.color === c), onclick: () => { draft.color = c; drawSw(); } }); b.style.background = c; sw.append(b); } };
  drawSw();
  const items = h('div');
  const addSel = h('select.input', { 'aria-label': 'Add exercise' }, h('option', { value: '', text: 'Add an exercise…' }), D().exercises.slice().sort((a, b) => a.name.localeCompare(b.name)).map(e => h('option', { value: e.id, text: `${e.name} (${e.group})` })));
  addSel.addEventListener('change', () => { if (!addSel.value) return; const ex = exById(addSel.value); const base = ex.kind === 'strength' ? { reps: 10, weight: 20 } : ex.kind === 'bodyweight' ? { reps: 10 } : ex.kind === 'timed' ? { seconds: 30 } : { minutes: 20, km: 3 }; draft.items.push({ exerciseId: ex.id, sets: [{ ...base }, { ...base }, { ...base }].slice(0, ex.kind === 'cardio' ? 1 : 3) }); addSel.value = ''; draw(); });
  function draw() {
    items.textContent = '';
    draft.items.forEach((it, i) => {
      const ex = exById(it.exerciseId), cols = KINDS[ex.kind].cols;
      const block = h('div.ex-block', h('div.ex-head', h('h3', { text: ex.name }), h('span.reorder',
        h('button.icon-btn', { type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [draft.items[i - 1], draft.items[i]] = [draft.items[i], draft.items[i - 1]]; draw(); } }, icon('up', 16)),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Move down', disabled: i === draft.items.length - 1, onclick: () => { [draft.items[i + 1], draft.items[i]] = [draft.items[i], draft.items[i + 1]]; draw(); } }, icon('down', 16)),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Remove ' + ex.name, onclick: () => { draft.items.splice(i, 1); draw(); } }, icon('trash', 16)))));
      const sets = h('div.sets');
      const head = h('div.set-row.set-head', h('span', { text: 'Set' }), cols.map(c => h('span', { text: colLabel(c) })), h('span'), h('span'));
      head.style.setProperty('--cols', cols.length);
      sets.append(head);
      it.sets.forEach((set, j) => {
        const row = h('div.set-row', h('span.n', { text: j + 1 }), setInputs(ex.kind, set, () => {}), h('span'), h('button.icon-btn', { type: 'button', 'aria-label': 'Remove set', onclick: () => { it.sets.splice(j, 1); draw(); } }, icon('x', 15)));
        row.style.setProperty('--cols', cols.length);
        sets.append(row);
      });
      block.append(sets, h('button.btn.btn-sm.btn-ghost', { type: 'button', style: { marginTop: '6px' }, onclick: () => { it.sets.push({ ...(it.sets[it.sets.length - 1] || {}) }); draw(); } }, icon('plus', 14), 'Add set'));
      items.append(block);
    });
    if (!draft.items.length) items.append(h('p.muted', { text: 'Add exercises below. Set targets for each set; you can change them while you train.' }));
  }
  draw();
  s.body.append(h('div.grid-2', h('label.field', h('span', { text: 'Name' }), name), h('div.field', h('span.label', { text: 'Colour' }), sw)), items, h('div', { style: { marginTop: '10px' } }, addSel), h('p.hint', { style: { marginTop: '8px' }, text: 'Missing an exercise? Create it under Workouts → Exercises.' }));
  if (r) s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => { if (await confirmSheet('Delete “' + r.name + '”?', 'Past workouts stay in your history.', { confirmLabel: 'Delete routine' })) { D().routines = D().routines.filter(x => x.id !== r.id); s.close(); changed(); } } }));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save routine', onclick: () => {
    draft.name = draft.name.trim() || 'Routine';
    if (r) Object.assign(D().routines.find(x => x.id === r.id), draft); else D().routines.push(draft);
    s.close(); changed();
  } }));
}

// ---------- active session ----------
let tick = 0;
function startSession(r, plan = null) {
  if (D().active) { state.tab = 'workouts'; render(); return; }
  D().active = {
    id: uid(), name: plan ? plan.name : r ? r.name : 'Workout', routineId: r ? r.id : null, planId: plan ? plan.id : null, startedAt: Date.now(), date: todayISO(),
    entries: r ? r.items.map(it => {
      const last = lastSets(it.exerciseId);
      // Pre-fill with what you did last time when it's there, otherwise the routine's targets.
      const sets = it.sets.map((s, i) => ({ ...(last && last.sets[i] ? stripDone(last.sets[i]) : s), done: false }));
      return { exerciseId: it.exerciseId, sets };
    }) : [],
  };
  state.tab = 'workouts';
  changed();
}
const stripDone = ({ done, ...s }) => s;
function elapsed() { const s = Math.max(0, Math.floor((Date.now() - D().active.startedAt) / 1000)); return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function activeBanner() {
  const t = h('span.timer', { text: elapsed() });
  clearInterval(tick); tick = setInterval(() => { if (D().active && t.isConnected) t.textContent = elapsed(); else clearInterval(tick); }, 1000);
  return h('div.active-banner', icon('clock'), h('span.grow', h('b', { text: D().active.name + ' in progress' })), t, h('button.btn.btn-accent.btn-sm', { type: 'button', text: 'Back to workout', onclick: () => { state.tab = 'workouts'; render(); } }));
}
function activeView(v) {
  const a = D().active;
  const timer = h('span.timer', { text: elapsed() });
  clearInterval(tick); tick = setInterval(() => { if (D().active && timer.isConnected) timer.textContent = elapsed(); else clearInterval(tick); }, 1000);
  const nameIn = h('input.input.serif', { value: a.name, maxlength: 60, 'aria-label': 'Workout name', style: { fontSize: '22px', fontWeight: '700', border: '0', background: 'transparent', padding: '0' }, oninput: e => { a.name = e.target.value; store.changed(); } });
  v.append(h('div.page-head', h('div', { style: { flex: '1', minWidth: '220px' } }, nameIn, h('p', { text: 'Tick each set as you finish it. Values are pre-filled from last time.' })), h('div.row', timer,
    h('button.btn.btn-ghost', { type: 'button', text: 'Discard', onclick: async () => { if (await confirmSheet('Discard this workout?', 'Nothing from this session will be saved.', { confirmLabel: 'Discard' })) { D().active = null; changed(); } } }),
    h('button.btn.btn-accent', { type: 'button', onclick: finishSession }, icon('check', 16), 'Finish'))));
  const card = h('section.card');
  a.entries.forEach((en, i) => {
    const ex = exById(en.exerciseId), cols = KINDS[ex.kind].cols, last = lastSets(ex.id);
    const block = h('div.ex-block', h('div.ex-head', h('h3', { text: ex.name }), h('button.icon-btn', { type: 'button', 'aria-label': 'Remove ' + ex.name, onclick: () => { a.entries.splice(i, 1); changed(); } }, icon('trash', 16))));
    if (last) block.append(h('div.last-time', { text: `Last time (${fmtDate(last.date)}): ${setSummary(ex.kind, last.sets)}` }));
    const sets = h('div.sets');
    const head = h('div.set-row.set-head', h('span', { text: 'Set' }), cols.map(c => h('span', { text: colLabel(c) })), h('span', { text: 'Done' }), h('span'));
    head.style.setProperty('--cols', cols.length);
    sets.append(head);
    en.sets.forEach((set, j) => {
      const row = h('div.set-row' + (set.done ? '.done' : ''), h('span.n', { text: j + 1 }), setInputs(ex.kind, set, () => store.changed()),
        h('button.done-btn', { type: 'button', 'aria-label': `Set ${j + 1} done`, 'aria-pressed': String(!!set.done), onclick: e => { set.done = !set.done; e.currentTarget.setAttribute('aria-pressed', String(set.done)); row.classList.toggle('done', set.done); store.changed(); } }, icon('check', 16)),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Remove set', onclick: () => { en.sets.splice(j, 1); changed(); } }, icon('x', 15)));
      row.style.setProperty('--cols', cols.length);
      sets.append(row);
    });
    block.append(sets, h('button.btn.btn-sm.btn-ghost', { type: 'button', style: { marginTop: '6px' }, onclick: () => { en.sets.push({ ...stripDone(en.sets[en.sets.length - 1] || {}), done: false }); changed(); } }, icon('plus', 14), 'Add set'));
    card.append(block);
  });
  if (!a.entries.length) card.append(h('p.muted', { text: 'Add your first exercise below.' }));
  const addSel = h('select.input', { 'aria-label': 'Add exercise', style: { marginTop: '12px' } }, h('option', { value: '', text: 'Add an exercise…' }), D().exercises.slice().sort((x, y) => x.name.localeCompare(y.name)).map(e => h('option', { value: e.id, text: `${e.name} (${e.group})` })));
  addSel.addEventListener('change', () => {
    if (!addSel.value) return;
    const ex = exById(addSel.value), last = lastSets(ex.id);
    const base = ex.kind === 'strength' ? { reps: 10, weight: 20 } : ex.kind === 'bodyweight' ? { reps: 10 } : ex.kind === 'timed' ? { seconds: 30 } : { minutes: 20, km: 3 };
    a.entries.push({ exerciseId: ex.id, sets: last ? last.sets.map(s => ({ ...stripDone(s), done: false })) : [{ ...base, done: false }] });
    changed();
  });
  card.append(addSel);
  const notes = h('textarea.input', { placeholder: 'Notes (how it felt, what to change next time)', 'aria-label': 'Workout notes', value: a.notes || '', oninput: e => { a.notes = e.target.value.slice(0, 2000); store.changed(); } });
  v.append(card, h('section.card', notes));
}
function finishSession() {
  const a = D().active;
  const entries = a.entries.map(e => ({ exerciseId: e.exerciseId, sets: e.sets.filter(s => s.done).map(stripDone) })).filter(e => e.sets.length);
  if (!entries.length) { toast('Tick at least one set as done, or discard the workout.', { error: true }); return; }
  const minutes = Math.max(1, Math.round((Date.now() - a.startedAt) / 60000));
  // Calories: MET × body weight × hours. Cardio uses its logged minutes; everything else shares the session time.
  const weight = D().profile.weightKg || 70;
  let cardioMin = 0, cardioKcal = 0;
  for (const e of entries) { const ex = exById(e.exerciseId); if (ex.kind === 'cardio') { const m = e.sets.reduce((s, x) => s + (x.minutes || 0), 0); cardioMin += m; cardioKcal += KINDS.cardio.met * weight * m / 60; } }
  const rest = Math.max(0, minutes - cardioMin);
  const otherKinds = entries.map(e => exById(e.exerciseId).kind).filter(k => k !== 'cardio');
  const met = otherKinds.length ? otherKinds.reduce((s, k) => s + KINDS[k].met, 0) / otherKinds.length : 0;
  const kcal = Math.round(cardioKcal + met * weight * rest / 60);
  D().sessions.push({ id: a.id, date: a.date, name: a.name.trim() || 'Workout', routineId: a.routineId, ...(a.planId ? { planId: a.planId } : {}), startedAt: a.startedAt, minutes, kcal, entries, notes: a.notes || '' });
  // Finishing a session that was started from a scheduled workout marks that plan as done.
  const planned = a.planId && D().plan.workouts.find(w => w.id === a.planId);
  if (planned) planned.sessionId = a.id;
  if (D().sessions.length > 3000) D().sessions.splice(0, D().sessions.length - 3000);
  D().active = null;
  clearInterval(tick);
  state.wsub = 'history';
  changed();
  toast(`Workout saved: ${minutes} min, about ${kcal} kcal.`);
}

// ---------- progress ----------
function lineChart(points, { goal, unit, label }) {
  const W = 640, H = 220, L = 44, B = 26, T = 10;
  const ys = points.map(p => p.y).concat(goal ? [goal] : []);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const x = i => L + (W - L - 10) * (points.length === 1 ? 0.5 : i / (points.length - 1));
  const y = v => T + (H - B - T) * (1 - (v - lo) / (hi - lo));
  const c = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': label });
  for (let i = 0; i <= 3; i++) { const v = lo + (hi - lo) * i / 3; c.append(svg('line', { x1: L, x2: W - 6, y1: y(v), y2: y(v), class: 'grid-line' }), svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, String(Math.round(v)))); }
  if (goal) c.append(svg('line', { x1: L, x2: W - 6, y1: y(goal), y2: y(goal), class: 'goal-line' }));
  c.append(svg('polyline', { points: points.map((p, i) => `${x(i)},${y(p.y)}`).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  points.forEach((p, i) => { const dot = svg('circle', { cx: x(i), cy: y(p.y), r: 3.5, fill: 'var(--accent)' }); dot.append(svg('title', {}, `${p.label}: ${r1(p.y)} ${unit}`)); c.append(dot); });
  const step = Math.max(1, Math.ceil(points.length / 7));
  points.forEach((p, i) => { if (i % step === 0 || i === points.length - 1) c.append(svg('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }, p.label)); });
  return c;
}
function barChart(bars, { goal, label }) {
  const W = 640, H = 200, L = 44, B = 26, T = 10, top = Math.max(1, goal || 0, ...bars.map(b => b.y)) * 1.1;
  const bw = (W - L - 10) / bars.length;
  const y = v => T + (H - B - T) * (1 - v / top);
  const c = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': label });
  for (let i = 0; i <= 3; i++) { const v = top * i / 3; c.append(svg('line', { x1: L, x2: W - 6, y1: y(v), y2: y(v), class: 'grid-line' }), svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, String(Math.round(v)))); }
  bars.forEach((b, i) => { const r = svg('rect', { x: L + i * bw + bw * 0.2, y: y(b.y), width: bw * 0.6, height: Math.max(0, H - B - y(b.y)), rx: 3, fill: goal && b.y > goal * 1.05 ? '#c0392b' : 'var(--accent)' }); r.append(svg('title', {}, `${b.label}: ${Math.round(b.y)}`)); c.append(r, svg('text', { x: L + i * bw + bw / 2, y: H - 6, 'text-anchor': 'middle' }, b.label)); });
  if (goal) c.append(svg('line', { x1: L, x2: W - 6, y1: y(goal), y2: y(goal), class: 'goal-line' }));
  return c;
}
function progress(v) {
  v.append(h('div.page-head', h('div', h('h1', { text: 'Progress' }), h('p', { text: 'Body weight, calories and training over time.' }))));
  const wIn = h('input.input', { type: 'number', min: 20, max: 700, step: 0.1, placeholder: wUnit(), 'aria-label': 'Weight in ' + wUnit(), style: { width: '120px' } });
  const dIn = h('input.input', { type: 'date', value: todayISO(), 'aria-label': 'Date', style: { width: 'auto' } });
  const weights = D().weights.slice().sort((a, b) => a.date.localeCompare(b.date));
  const wcard = h('section.card', h('div.card-head', h('h2', { text: 'Body weight' })),
    h('form.row', { onsubmit: e => { e.preventDefault(); const n = Number(wIn.value); if (!(n > 0)) return; const kg = r1(showToKg(n)); D().weights = D().weights.filter(x => x.date !== dIn.value); D().weights.push({ date: dIn.value || todayISO(), kg }); D().profile.weightKg = D().weights.slice().sort((a, b) => b.date.localeCompare(a.date))[0].kg; changed(); } }, wIn, dIn, h('button.btn.btn-accent', { type: 'submit', text: 'Log weight' })));
  if (weights.length >= 2) wcard.append(lineChart(weights.slice(-30).map(w => ({ y: kgToShow(w.kg), label: fmtDate(w.date) })), { unit: wUnit(), label: 'Body weight trend' }));
  else wcard.append(h('p.muted', { style: { marginTop: '10px' }, text: weights.length ? `Logged ${r1(kgToShow(weights[0].kg))} ${wUnit()}. Log another day to see a trend.` : 'Log your weight now and then to see the trend.' }));
  if (weights.length) wcard.append(h('ul.list', weights.slice(-5).reverse().map(w => h('li.list-row', h('span.grow', { text: fmtDate(w.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }), h('b.num', { text: `${r1(kgToShow(w.kg))} ${wUnit()}` }), h('button.icon-btn', { type: 'button', 'aria-label': 'Delete entry', onclick: () => { D().weights = D().weights.filter(x => x !== w); changed(); } }, icon('x', 15))))));
  const days = Array.from({ length: 14 }, (_, i) => addDaysISO(todayISO(), i - 13));
  const ccard = h('section.card', h('div.card-head', h('h2', { text: 'Calories, last 14 days' }), h('span.muted', { text: `Goal ${D().goals.kcal} kcal` })), barChart(days.map(d => ({ y: totals(d).kcal, label: new Date(d + 'T12:00:00').getDate() })), { goal: D().goals.kcal, label: 'Calories eaten per day' }));
  const weeks = Array.from({ length: 8 }, (_, i) => addDaysISO(todayISO(), -7 * (7 - i)));
  const tcard = h('section.card', h('div.card-head', h('h2', { text: 'Workouts per week' })), barChart(weeks.map(start => ({ y: D().sessions.filter(s => s.date > addDaysISO(start, -7) && s.date <= start).length, label: fmtDate(start) })), { label: 'Workouts per week' }));
  v.append(wcard, ccard, tcard);
}

// ---------- goals ----------
const KCAL_PER_KG = 7700, LB = 2.20462;
const BUILTIN_GOALS = [
  { id: 'lose', name: 'Lose weight', label: 'Lose weight (about 0.4 kg a week)', rate: -0.4, adj: -450, proteinPerKg: 1.8, builtin: true },
  { id: 'maintain', name: 'Maintain', label: 'Maintain', rate: 0, adj: 0, proteinPerKg: 1.4, builtin: true },
  { id: 'gain', name: 'Build muscle', label: 'Build muscle (slow gain)', rate: 0.3, adj: 300, proteinPerKg: 1.8, builtin: true },
];
/** A built-in goal, or the user's own ({ id, name, kgPerWeek, proteinPerKg|null }), as { id, name, rate (kg/week), proteinPerKg, builtin }. */
function goalDef(id, custom = D().customGoals) {
  const b = BUILTIN_GOALS.find(g => g.id === id);
  if (b) return b;
  const c = (custom || []).find(g => g.id === id);
  if (c) return { id: c.id, name: c.name, rate: Number(c.kgPerWeek) || 0, proteinPerKg: Number(c.proteinPerKg) > 0 ? Number(c.proteinPerKg) : 0, builtin: false };
  return BUILTIN_GOALS[1];
}
/** Daily calorie adjustment: about 7700 kcal per kg, spread over 7 days. */
const goalAdj = g => g.adj != null ? g.adj : g.rate * KCAL_PER_KG / 7;
function suggest(p, custom) {
  const gd = goalDef(p.goal, custom);
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78);
  const tdee = bmr * p.activity;
  const raw = Math.round((tdee + goalAdj(gd)) / 10) * 10;
  const kcal = gd.builtin ? Math.max(1200, raw) : Math.max(0, raw);
  const ppk = gd.proteinPerKg > 0 ? gd.proteinPerKg : Math.abs(gd.rate) < 0.05 ? 1.4 : 1.8;
  const protein = Math.round(p.weightKg * ppk);
  const fat = Math.round(kcal * 0.28 / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const warnings = [];
  if (Math.abs(gd.rate) > 1) warnings.push('fast');
  if (kcal < 1200) warnings.push('low');
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, fat, carbs, warnings, goal: gd };
}
const rateText = (kg, imp) => { const v = imp ? kg * LB : kg; return `${v > 0 ? '+' : ''}${trim(v, 2)} ${imp ? 'lb' : 'kg'}/week`; };
function warnLines(warnings, imp) {
  const out = [];
  if (warnings.includes('fast')) out.push(`That is faster than ${imp ? '2.2 lb' : '1 kg'} a week. Changing weight that fast is hard to keep up and may not be healthy. Consider a professional's advice.`);
  if (warnings.includes('low')) out.push('The suggested calories are below about 1,200 a day, which is generally too low to get enough nutrition without medical supervision.');
  return out;
}
function warnBox(el, warnings, imp) { el.textContent = ''; const lines = warnLines(warnings, imp); el.hidden = !lines.length; for (const t of lines) el.append(h('p', { text: t })); }
function goalSheet(existing, read) {
  const imp = read().units === 'imperial';
  const s = sheet(existing ? 'Edit goal' : 'New goal');
  const name = h('input.input', { maxlength: 40, required: true, placeholder: 'e.g. Slow cut', value: existing ? existing.name : '' });
  const rate = h('input.input', { type: 'number', min: -5, max: 5, step: 0.05, inputmode: 'decimal', required: true, placeholder: imp ? 'e.g. -0.8' : 'e.g. -0.35', value: existing ? trim(existing.kgPerWeek * (imp ? LB : 1), 2) : '' });
  const ppk = h('input.input', { type: 'number', min: 0, max: 4, step: 0.1, inputmode: 'decimal', placeholder: 'Automatic', value: existing && existing.proteinPerKg ? existing.proteinPerKg : '' });
  const out = h('div.estimate'), warn = h('div.warn-box', { role: 'status' });
  const cur = () => ({ id: existing ? existing.id : 'goal:' + uid(), name: name.value.trim(), kgPerWeek: Math.round((Number(rate.value) || 0) / (imp ? LB : 1) * 1000) / 1000, proteinPerKg: Number(ppk.value) > 0 ? Number(ppk.value) : null });
  const show = () => {
    const g = cur(), sg = suggest({ ...read(), goal: g.id }, [g]);
    out.textContent = '';
    out.append(h('div.cal', h('b', { text: sg.kcal }), h('span', { text: 'kcal / day' })), h('div', h('b', { text: sg.protein }), h('span', { text: 'protein g' })), h('div', h('b', { text: sg.carbs }), h('span', { text: 'carbs g' })), h('div', h('b', { text: sg.fat }), h('span', { text: 'fat g' })));
    warnBox(warn, sg.warnings, imp);
  };
  for (const el of [rate, ppk]) el.addEventListener('input', show);
  show();
  const form = h('form', { onsubmit: e => {
    e.preventDefault();
    const g = cur();
    if (!g.name) return toast('Give the goal a name.', { error: true });
    if (rate.value === '' || !Number.isFinite(Number(rate.value))) return toast('Enter a weekly change (negative to lose, positive to gain, 0 to maintain).', { error: true });
    if (existing) Object.assign(D().customGoals.find(x => x.id === existing.id), g); else D().customGoals.push(g);
    state.gdraft = { ...read(), goal: g.id };
    s.close(); changed(); toast(`Saved “${g.name}”. Choose “Use these targets” to apply it.`);
  } }, h('label.field', h('span', { text: 'Name' }), name),
  h('div.grid-2', h('label.field', h('span', { text: `Weekly weight change (${imp ? 'lb' : 'kg'} per week)` }), rate), h('label.field', h('span', { text: 'Protein (g per kg of body weight, optional)' }), ppk)),
  h('p.hint', { text: `Negative to lose, positive to gain. Stride uses about ${KCAL_PER_KG} kcal per kg, so a change of 0.5 kg a week is about 550 kcal a day. Preview for your current profile:` }), out, warn);
  s.body.append(form);
  if (existing) s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => {
    if (!(await confirmSheet('Delete “' + existing.name + '”?', 'If it is your current goal, Stride switches back to Maintain.', { confirmLabel: 'Delete goal' }))) return;
    D().customGoals = D().customGoals.filter(x => x.id !== existing.id);
    if (D().profile.goal === existing.id) D().profile.goal = 'maintain';
    const r = read(); state.gdraft = { ...r, goal: r.goal === existing.id ? 'maintain' : r.goal };
    s.close(); changed();
  } }));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save goal', onclick: () => form.requestSubmit() }));
  setTimeout(() => name.focus(), 30);
}
function waterGoalCard() {
  const g = D().goals, litres = waterUnit() === 'litres';
  const unit = h('select.input', { 'aria-label': 'Water unit', onchange: e => { g.waterUnit = e.target.value === 'litres' ? 'litres' : 'glasses'; changed(); } }, h('option', { value: 'glasses', text: 'Glasses' }), h('option', { value: 'litres', text: 'Litres' }));
  unit.value = waterUnit();
  const hint = h('p.hint');
  const sum = () => { hint.textContent = `1 glass = ${GLASS_ML} ml. Your target is ${Math.round(g.waterMl)} ml: ${fmtGlasses(g.waterMl)} glasses or ${fmtLitres(g.waterMl)} L.`; };
  const toMl = n => Math.min(20000, Math.max(0, Math.round(litres ? n * 1000 : n * GLASS_ML)));
  const target = h('input.input', { type: 'number', min: 0, max: litres ? 20 : 80, step: litres ? 0.25 : 1, inputmode: 'decimal', 'aria-label': 'Daily water target in ' + (litres ? 'litres' : 'glasses'), value: litres ? fmtLitres(g.waterMl) : fmtGlasses(g.waterMl),
    oninput: e => { const ml = toMl(Number(e.target.value) || 0); g.waterMl = ml; sum(); store.changed(); }, onchange: () => changed() });
  sum();
  return h('section.card', h('div.card-head', h('h2', { text: 'Water' })), h('div.grid-2', h('label.field', h('span', { text: 'Show water in' }), unit), h('label.field', h('span', { text: litres ? 'Daily target (litres)' : 'Daily target (glasses)' }), target)), hint);
}
function goals(v) {
  const p = D().profile, g = D().goals, p0 = { ...p, ...(state.gdraft || {}) }, imp = p0.units === 'imperial';
  state.gdraft = null;
  v.append(h('div.page-head', h('div', h('h1', { text: 'Goals & profile' }), h('p', { text: 'Stride estimates your daily needs with the Mifflin-St Jeor equation. Adjust anything.' }))));
  const units = h('select.input', h('option', { value: 'metric', text: 'Metric (kg, cm, km)' }), h('option', { value: 'imperial', text: 'Imperial (lb, in, mi)' }));
  units.value = p0.units;
  const sex = h('select.input', h('option', { value: 'female', text: 'Female' }), h('option', { value: 'male', text: 'Male' }), h('option', { value: 'other', text: 'Prefer not to say' }));
  sex.value = p0.sex;
  const age = h('input.input', { type: 'number', min: 13, max: 100, value: p0.age });
  const height = h('input.input', { type: 'number', min: 50, max: 250, step: 0.5, value: imp ? r1(p0.heightCm / 2.54) : r1(p0.heightCm) });
  const weight = h('input.input', { type: 'number', min: 20, max: 700, step: 0.1, value: r1(imp ? p0.weightKg * LB : p0.weightKg) });
  const act = h('select.input', ACTIVITY.map(([f, l]) => h('option', { value: String(f), text: l })));
  act.value = String(p0.activity);
  const goal = h('select.input', { 'aria-label': 'Goal' });
  const fillGoals = () => { const sel = goal.value || p0.goal; goal.textContent = ''; for (const b of BUILTIN_GOALS) goal.append(h('option', { value: b.id, text: b.label })); for (const c of D().customGoals) goal.append(h('option', { value: c.id, text: `${c.name} (${rateText(c.kgPerWeek, imp)})` })); goal.value = goalDef(sel).id; };
  fillGoals();
  const out = h('div.estimate'), warn = h('div.warn-box', { role: 'status' });
  const read = () => ({ units: units.value, sex: sex.value, age: Number(age.value) || 20, heightCm: units.value === 'imperial' ? (Number(height.value) || 66) * 2.54 : Number(height.value) || 168, weightKg: units.value === 'imperial' ? (Number(weight.value) || 150) / LB : Number(weight.value) || 65, activity: Number(act.value), goal: goal.value });
  const customOf = id => D().customGoals.find(c => c.id === id) || null;
  const editBtn = h('button.btn.btn-sm', { type: 'button', text: 'Edit this goal', onclick: () => goalSheet(customOf(goal.value), read) });
  const show = () => {
    const s = suggest(read());
    out.textContent = '';
    out.append(h('div.cal', h('b', { text: s.kcal }), h('span', { text: 'kcal / day' })), h('div', h('b', { text: s.protein }), h('span', { text: 'protein g' })), h('div', h('b', { text: s.carbs }), h('span', { text: 'carbs g' })), h('div', h('b', { text: s.fat }), h('span', { text: 'fat g' })));
    warnBox(warn, s.warnings, units.value === 'imperial');
    editBtn.hidden = !customOf(goal.value);
  };
  for (const el of [units, sex, age, height, weight, act, goal]) el.addEventListener('input', show);
  show();
  v.append(h('section.card', h('div.card-head', h('h2', { text: 'About you' })),
    h('div.grid-3', h('label.field', h('span', { text: 'Units' }), units), h('label.field', h('span', { text: 'Sex (for the estimate)' }), sex), h('label.field', h('span', { text: 'Age' }), age)),
    h('div.grid-3', h('label.field', h('span', { text: 'Height (' + (imp ? 'in' : 'cm') + ')' }), height), h('label.field', h('span', { text: 'Weight (' + (imp ? 'lb' : 'kg') + ')' }), weight), h('label.field', h('span', { text: 'Goal' }), goal)),
    h('div.row.goal-actions', h('button.btn.btn-sm', { type: 'button', onclick: () => goalSheet(null, read) }, icon('plus', 14), 'New custom goal'), editBtn),
    h('label.field', h('span', { text: 'Activity' }), act),
    h('p.label', { text: 'Suggested daily targets' }), out, warn,
    h('div.row', h('button.btn.btn-accent', { type: 'button', text: 'Use these targets', onclick: () => { const r = read(); Object.assign(p, { ...r, heightCm: r1(r.heightCm), weightKg: r1(r.weightKg) }); const s = suggest(p); Object.assign(g, { kcal: s.kcal, protein: s.protein, carbs: s.carbs, fat: s.fat }); D().setup = true; changed(); toast('Targets updated.'); } }),
      h('button.btn', { type: 'button', text: 'Save profile only', onclick: () => { const r = read(); Object.assign(p, { ...r, heightCm: r1(r.heightCm), weightKg: r1(r.weightKg) }); D().setup = true; changed(); toast('Profile saved.'); } })),
    h('p.hint', { style: { marginTop: '10px' }, text: 'These are general estimates, not medical advice. If you have a health condition, are pregnant, or are under 18, check with a professional before changing how you eat.' })));
  const field = (k, label) => h('label.field', h('span', { text: label }), h('input.input', { type: 'number', min: 0, max: k === 'kcal' ? 10000 : 1000, value: g[k], onchange: e => { g[k] = Math.max(0, Number(e.target.value) || 0); changed(); } }));
  v.append(h('section.card', h('div.card-head', h('h2', { text: 'Daily targets' })), h('div.grid-4', field('kcal', 'Calories'), field('protein', 'Protein (g)'), field('carbs', 'Carbs (g)'), field('fat', 'Fat (g)'))));
  v.append(waterGoalCard());
  v.append(h('section.card', h('div.card-head', h('h2', { text: 'Your data' })), h('button.btn', { type: 'button', onclick: () => download('stride-backup.json', JSON.stringify(D(), null, 1), 'application/json') }, icon('download', 16), 'Download a backup (JSON)'), h('p.hint', { style: { marginTop: '8px' }, text: 'Food values come from USDA FoodData Central reference data (public domain), rounded.' })));
}

// ---------- start ----------
let pendingRoute = null;
async function route(params) {
  if (!store.doc) { pendingRoute = params; return; }
  const tab = params.get('tab'), mealId = params.get('meal'), plannedId = params.get('planned'), date = params.get('date');
  // A link to one plan (from Almanac) may name something added or changed on another device
  // since this page loaded: fetch the newest version first when nothing here is unsaved.
  if (mealId || plannedId) { try { await store.refresh(); } catch { /* offline: use what is here */ } }
  let open = null;
  if (tab && TABS.some(([k]) => k === tab)) state.tab = tab;
  if (date && isISODate(date)) { state.planDay = date; }
  if (mealId) {
    state.tab = 'plan';
    const m = D().plan.meals.find(x => x.id === mealId);
    if (m) { state.planDay = m.date; open = () => planMealSheet(m); } else toast('That plan no longer exists.', { error: true });
  } else if (plannedId) {
    state.tab = 'workouts';
    const w = D().plan.workouts.find(x => x.id === plannedId);
    if (w) open = () => plannedWorkoutSheet(w); else toast('That plan no longer exists.', { error: true });
  }
  history.replaceState(null, '', '/stride/app');
  render();
  if (open) open();
}
onShellNavigate(params => { void route(params); });
// Pick up edits made on another device whenever Stride comes back into view with nothing unsaved.
async function refreshIfClean() {
  if (!store.doc || document.querySelector('dialog[open]')) return;
  try { if (await store.refresh()) render(); } catch { /* offline */ }
}
window.addEventListener('focus', () => { void refreshIfClean(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshIfClean(); });
// The Satchel time zone changed in Settings: "today" may be a different date now.
onSettingsChange(() => { state.day = todayISO(); state.planDay = todayISO(); if (store.doc) render(); });
(async () => {
  try {
    await Promise.all([store.load(), loadFoods()]);
    await route(pendingRoute || new URLSearchParams(location.search));
    pendingRoute = null;
  } catch (err) { toast(err && err.newer ? err.message : 'Stride could not load: ' + err.message, { error: true, ms: 60000 }); }
})();
