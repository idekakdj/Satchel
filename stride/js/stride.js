// Stride: food log with a bank of common foods and calorie estimates, plus fully customizable
// exercises, routines and workout sessions. Everything lives in one autosaved document.
import { h, icon, toast, sheet, confirmSheet, uid, todayISO, addDaysISO, fmtDate, download, createDocStore, saveLabel, onShellNavigate } from '/js/app-kit.js';

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
    version: 1,
    profile: { sex: 'female', age: 20, heightCm: 168, weightKg: 65, activity: 1.375, goal: 'maintain', units: 'metric' },
    goals: { kcal: 2000, protein: 110, carbs: 230, fat: 70, water: 8 },
    setup: false,
    mealSlots: [{ id: uid(), name: 'Breakfast' }, { id: uid(), name: 'Lunch' }, { id: uid(), name: 'Dinner' }, { id: uid(), name: 'Snacks' }],
    customFoods: [], savedMeals: [], recent: [], log: {},
    exercises,
    routines: [
      { id: uid(), name: 'Full body A', color: COLORS[0], items: [{ exerciseId: find('Squat'), sets: sets(3, { reps: 8, weight: 40 }) }, { exerciseId: find('Bench press'), sets: sets(3, { reps: 8, weight: 30 }) }, { exerciseId: find('Barbell row'), sets: sets(3, { reps: 10, weight: 30 }) }, { exerciseId: find('Plank'), sets: sets(3, { seconds: 45 }) }] },
      { id: uid(), name: 'Easy run', color: COLORS[1], items: [{ exerciseId: find('Running'), sets: [{ minutes: 25, km: 4 }] }] },
    ],
    sessions: [], active: null, weights: [],
  };
}
const store = createDocStore('stride', {
  defaults, migrate: d => ({ ...defaults(), ...d }),
  onState: s => saveLabel($('save-state'), s),
  onConflict: () => toast('Stride changed on another device.', { error: true, action: () => location.reload(), actionLabel: 'Reload' }),
});
const D = () => store.doc;
const state = { tab: 'today', day: todayISO(), wsub: 'routines' };
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
function allFoods() { return [...D().customFoods.map(f => ({ ...f, portions: f.portions || [], custom: true })), ...FOODS]; }
function searchFoods(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = allFoods();
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
  if (!l && create) { l = D().log[day] = { entries: [], water: 0 }; }
  return l || { entries: [], water: 0 };
}
function totals(day) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of dayLog(day).entries) { t.kcal += e.kcal || 0; t.protein += e.protein || 0; t.carbs += e.carbs || 0; t.fat += e.fat || 0; }
  return t;
}
function burned(day) { return D().sessions.filter(s => s.date === day).reduce((a, s) => a + (s.kcal || 0), 0); }

// ---------- rendering frame ----------
const TABS = [['today', 'Today'], ['meals', 'Meals'], ['workouts', 'Workouts'], ['progress', 'Progress'], ['goals', 'Goals']];
function render() {
  const nav = $('tabs'); nav.textContent = '';
  for (const [k, l] of TABS) nav.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === k), text: l, onclick: () => { state.tab = k; render(); } }));
  const v = $('view'); v.textContent = '';
  if (D().active && state.tab !== 'workouts') v.append(activeBanner());
  ({ today, meals, workouts, progress, goals })[state.tab](v);
}
function dayNav() {
  const label = state.day === todayISO() ? 'Today' : state.day === addDaysISO(todayISO(), -1) ? 'Yesterday' : fmtDate(state.day, { weekday: 'short', month: 'short', day: 'numeric' });
  return h('div.day-nav',
    h('button.icon-btn', { type: 'button', 'aria-label': 'Previous day', onclick: () => { state.day = addDaysISO(state.day, -1); render(); } }, icon('chevronLeft')),
    h('span.label', { text: label }),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Next day', onclick: () => { state.day = addDaysISO(state.day, 1); render(); } }, icon('chevronRight')),
    state.day !== todayISO() ? h('button.btn.btn-sm', { type: 'button', text: 'Today', onclick: () => { state.day = todayISO(); render(); } }) : null);
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
  const water = h('div.water', { role: 'group', 'aria-label': 'Water' });
  for (let i = 0; i < Math.max(g.water || 8, log.water); i++) water.append(h('button' + (i < log.water ? '.full' : ''), { type: 'button', 'aria-label': `${i + 1} glasses`, 'aria-pressed': String(i < log.water), onclick: () => { const l = dayLog(state.day, true); l.water = i < l.water ? i : i + 1; changed(); } }));
  const wcard = h('section.card', h('div.card-head', h('h2', { text: 'Water' }), h('span.muted', { text: `${log.water} / ${g.water || 8} glasses` })), water);
  const meals = h('section.card', h('div.card-head', h('h2', { text: 'Meals' }), h('button.btn.btn-sm', { type: 'button', text: 'Open food log', onclick: () => { state.tab = 'meals'; render(); } })));
  for (const slot of D().mealSlots) {
    const es = log.entries.filter(e => e.slotId === slot.id);
    meals.append(h('div.list-row', h('span.grow', h('div.title', { text: slot.name }), h('div.sub', { text: es.length ? es.map(e => e.name).join(', ') : 'Nothing logged' })), h('span.kcal', { text: Math.round(es.reduce((a, e) => a + e.kcal, 0)) + ' kcal' }), h('button.icon-btn', { type: 'button', 'aria-label': 'Add food to ' + slot.name, onclick: () => foodSheet(slot.id) }, icon('plus'))));
  }
  const sessions = D().sessions.filter(s => s.date === state.day);
  const wk = h('section.card', h('div.card-head', h('h2', { text: 'Workouts' }), D().active ? null : h('button.btn.btn-sm.btn-accent', { type: 'button', text: 'Start workout', onclick: () => { state.tab = 'workouts'; render(); } })));
  wk.append(sessions.length ? h('ul.list', sessions.map(sessionRow)) : h('p.muted', { text: 'No workouts logged for this day.' }));
  v.append(h('div.layout-2', h('div', sum, meals), h('div', wk, wcard)));
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
    h('button.btn', { type: 'button', onclick: customFoodSheet }, icon('plus', 15), 'Create custom food'),
    h('button.btn', { type: 'button', onclick: manageFoods }, 'My foods & saved meals')));
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
function addEntry(slotId, entry) {
  const l = dayLog(state.day, true);
  l.entries.push({ id: uid(), slotId, ...entry });
  if (entry.foodId) { D().recent = [entry.foodId, ...D().recent.filter(x => x !== entry.foodId)].slice(0, 20); }
}
function foodSheet(slotId) {
  const slot = D().mealSlots.find(x => x.id === slotId) || D().mealSlots[0];
  const s = sheet('Add to ' + slot.name, { wide: true });
  const q = h('input.input', { type: 'search', placeholder: 'Search foods, e.g. “banana”, “latte”, “chicken breast”', 'aria-label': 'Search foods', autocomplete: 'off' });
  const results = h('div.food-results', { role: 'listbox', 'aria-label': 'Foods' });
  const detail = h('div');
  const drawResults = () => {
    results.textContent = ''; detail.textContent = '';
    const hits = searchFoods(q.value);
    if (!q.value.trim()) results.append(h('div.tx-day.hint', { text: D().recent.length ? 'Recent' : 'Popular foods' }));
    if (!hits.length) results.append(h('p.muted', { text: 'No match. Try a simpler word, use Quick add, or create a custom food.' }));
    for (const f of hits) results.append(h('button.food-hit', { type: 'button', role: 'option', onclick: () => pick(f) },
      h('span.grow', h('div.title', { text: f.name }), h('div.sub', { text: `${f.custom ? 'My food' : f.group} · ${f.kcal} kcal per 100 g${f.portions[0] ? ` · ${f.portions[0].label} ≈ ${Math.round(f.kcal * f.portions[0].grams / 100)} kcal` : ''}` })), icon('chevronRight', 16)));
  };
  function pick(f) {
    results.textContent = ''; detail.textContent = '';
    const portionSel = h('select.input', { 'aria-label': 'Portion' }, f.portions.map((p, i) => h('option', { value: String(i), text: `${p.label} (${p.grams} g)` })), h('option', { value: 'g', text: 'Grams' }));
    portionSel.value = f.portions.length ? '0' : 'g';
    const qty = h('input.input', { type: 'number', min: 0, step: 0.25, value: 1, 'aria-label': 'How many', inputmode: 'decimal' });
    const grams = h('input.input', { type: 'number', min: 0, step: 1, value: f.portions[0] ? f.portions[0].grams : 100, 'aria-label': 'Grams', inputmode: 'decimal' });
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
    const qtyField = h('label.field', h('span', { text: 'How many' }), qty), gramsField = h('label.field', h('span', { text: 'Grams' }), grams);
    for (const el of [portionSel, qty, grams]) el.addEventListener('input', calc);
    const form = h('form', { onsubmit: e => {
      e.preventDefault();
      const { g, p, e: est2 } = calc();
      if (!(g > 0) || g > 10000) return toast('Enter an amount greater than zero.', { error: true });
      addEntry(slot.id, { foodId: f.id, name: f.name, grams: Math.round(g), portion: p ? `${Number(qty.value)} × ${p.label}` : `${Math.round(g)} g`, ...est2 });
      s.close(); changed(); toast(`Added ${f.name} (${est2.kcal} kcal).`);
    } }, h('div.card-head', h('h2', { text: f.name }), h('button.btn.btn-sm.btn-ghost', { type: 'button', text: '← Back to search', onclick: () => { drawResults(); q.focus(); } })),
    h('p.hint', { text: `${f.kcal} kcal · ${f.protein} g protein · ${f.carbs} g carbs · ${f.fat} g fat per 100 g` }),
    h('div.grid-2', h('label.field', h('span', { text: 'Portion' }), portionSel), qtyField, gramsField), est);
    detail.append(form);
    calc();
    s.foot.textContent = '';
    s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Add to ' + slot.name, onclick: () => form.requestSubmit() }));
    setTimeout(() => (f.portions.length ? qty : grams).select(), 30);
  }
  q.addEventListener('input', drawResults);
  s.body.append(h('div.row', q, h('button.btn', { type: 'button', text: 'Quick add', onclick: () => { s.close(); quickAdd(slot.id); } })), results, detail);
  s.foot.append(h('button.btn', { type: 'button', text: 'Close', onclick: () => s.close() }));
  q.style.flex = '1'; q.style.width = 'auto';
  drawResults();
  setTimeout(() => q.focus(), 30);
}
function quickAdd(slotId) {
  const s = sheet('Quick add');
  const f = { name: h('input.input', { maxlength: 80, placeholder: 'e.g. Homemade curry', required: true }), kcal: h('input.input', { type: 'number', min: 0, max: 10000, required: true }), protein: h('input.input', { type: 'number', min: 0, step: 0.1 }), carbs: h('input.input', { type: 'number', min: 0, step: 0.1 }), fat: h('input.input', { type: 'number', min: 0, step: 0.1 }) };
  const form = h('form', { onsubmit: e => { e.preventDefault(); const kcal = Number(f.kcal.value); if (!(kcal >= 0)) return; addEntry(slotId, { name: f.name.value.trim() || 'Quick add', grams: 0, portion: '1 serving', kcal: Math.round(kcal), protein: Number(f.protein.value) || 0, carbs: Number(f.carbs.value) || 0, fat: Number(f.fat.value) || 0 }); s.close(); changed(); } },
    h('label.field', h('span', { text: 'Name' }), f.name), h('label.field', h('span', { text: 'Calories' }), f.kcal),
    h('div.grid-3', h('label.field', h('span', { text: 'Protein g' }), f.protein), h('label.field', h('span', { text: 'Carbs g' }), f.carbs), h('label.field', h('span', { text: 'Fat g' }), f.fat)));
  s.body.append(form);
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Add', onclick: () => form.requestSubmit() }));
  setTimeout(() => f.name.focus(), 30);
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
  const s = sheet('My foods & saved meals', { wide: true });
  const draw = () => {
    s.body.textContent = '';
    s.body.append(h('h3', { text: 'Custom foods', style: { marginBottom: '6px' } }));
    if (!D().customFoods.length) s.body.append(h('p.muted', { text: 'None yet. Create foods from package labels or your own recipes.' }));
    s.body.append(h('ul.list', D().customFoods.map(f => h('li.list-row', h('span.grow', h('div.title', { text: f.name }), h('div.sub', { text: `${f.portions[0] ? f.portions[0].label + ' (' + f.portions[0].grams + ' g) · ' : ''}${Math.round(f.kcal * (f.portions[0] ? f.portions[0].grams : 100) / 100)} kcal` })), h('button.icon-btn', { type: 'button', 'aria-label': 'Edit ' + f.name, onclick: () => { s.close(); customFoodSheet(f); } }, icon('edit', 16))))));
    s.body.append(h('h3', { text: 'Saved meals', style: { margin: '16px 0 6px' } }));
    if (!D().savedMeals.length) s.body.append(h('p.muted', { text: 'Log a meal, then choose “Save as meal” to reuse it.' }));
    s.body.append(h('ul.list', D().savedMeals.map(m => h('li.list-row', h('span.grow', h('div.title', { text: m.name }), h('div.sub', { text: m.items.map(x => x.name).join(', ') })), h('button.icon-btn', { type: 'button', 'aria-label': 'Delete ' + m.name, onclick: () => { D().savedMeals = D().savedMeals.filter(x => x.id !== m.id); store.changed(); draw(); } }, icon('trash', 16))))));
  };
  draw();
  s.foot.append(h('button.btn', { type: 'button', text: 'Close', onclick: () => s.close() }));
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
    h('div.row', h('button.btn.btn-accent', { type: 'button', onclick: () => startSession(null) }, icon('play', 15), 'Empty workout'))));
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
  sh.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => { if (await confirmSheet('Delete this workout?', 'It is removed from your history.', { confirmLabel: 'Delete workout' })) { D().sessions = D().sessions.filter(x => x.id !== s.id); sh.close(); changed(); } } }),
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
function startSession(r) {
  if (D().active) { state.tab = 'workouts'; render(); return; }
  D().active = {
    id: uid(), name: r ? r.name : 'Workout', routineId: r ? r.id : null, startedAt: Date.now(), date: todayISO(),
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
  D().sessions.push({ id: a.id, date: a.date, name: a.name.trim() || 'Workout', routineId: a.routineId, startedAt: a.startedAt, minutes, kcal, entries, notes: a.notes || '' });
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
function suggest(p) {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78);
  const tdee = bmr * p.activity;
  const kcal = Math.round((tdee + (p.goal === 'lose' ? -450 : p.goal === 'gain' ? 300 : 0)) / 10) * 10;
  const protein = Math.round(p.weightKg * (p.goal === 'maintain' ? 1.4 : 1.8));
  const fat = Math.round(kcal * 0.28 / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal: Math.max(1200, kcal), protein, fat, carbs };
}
function goals(v) {
  const p = D().profile, g = D().goals;
  v.append(h('div.page-head', h('div', h('h1', { text: 'Goals & profile' }), h('p', { text: 'Stride estimates your daily needs with the Mifflin-St Jeor equation. Adjust anything.' }))));
  const units = h('select.input', h('option', { value: 'metric', text: 'Metric (kg, cm, km)' }), h('option', { value: 'imperial', text: 'Imperial (lb, in, mi)' }));
  units.value = p.units;
  const sex = h('select.input', h('option', { value: 'female', text: 'Female' }), h('option', { value: 'male', text: 'Male' }), h('option', { value: 'other', text: 'Prefer not to say' }));
  sex.value = p.sex;
  const age = h('input.input', { type: 'number', min: 13, max: 100, value: p.age });
  const height = h('input.input', { type: 'number', min: 50, max: 250, step: 0.5, value: imperial() ? r1(p.heightCm / 2.54) : p.heightCm });
  const weight = h('input.input', { type: 'number', min: 20, max: 700, step: 0.1, value: r1(kgToShow(p.weightKg)) });
  const act = h('select.input', ACTIVITY.map(([f, l]) => h('option', { value: String(f), text: l })));
  act.value = String(p.activity);
  const goal = h('select.input', h('option', { value: 'lose', text: 'Lose weight (about 0.4 kg a week)' }), h('option', { value: 'maintain', text: 'Maintain' }), h('option', { value: 'gain', text: 'Build muscle (slow gain)' }));
  goal.value = p.goal;
  const out = h('div.estimate');
  const read = () => ({ units: units.value, sex: sex.value, age: Number(age.value) || 20, heightCm: units.value === 'imperial' ? (Number(height.value) || 66) * 2.54 : Number(height.value) || 168, weightKg: units.value === 'imperial' ? (Number(weight.value) || 150) / 2.20462 : Number(weight.value) || 65, activity: Number(act.value), goal: goal.value });
  const show = () => { const s = suggest(read()); out.textContent = ''; out.append(h('div.cal', h('b', { text: s.kcal }), h('span', { text: 'kcal / day' })), h('div', h('b', { text: s.protein }), h('span', { text: 'protein g' })), h('div', h('b', { text: s.carbs }), h('span', { text: 'carbs g' })), h('div', h('b', { text: s.fat }), h('span', { text: 'fat g' }))); };
  for (const el of [units, sex, age, height, weight, act, goal]) el.addEventListener('input', show);
  show();
  v.append(h('section.card', h('div.card-head', h('h2', { text: 'About you' })),
    h('div.grid-3', h('label.field', h('span', { text: 'Units' }), units), h('label.field', h('span', { text: 'Sex (for the estimate)' }), sex), h('label.field', h('span', { text: 'Age' }), age)),
    h('div.grid-3', h('label.field', h('span', { text: 'Height (' + (imperial() ? 'in' : 'cm') + ')' }), height), h('label.field', h('span', { text: 'Weight (' + wUnit() + ')' }), weight), h('label.field', h('span', { text: 'Goal' }), goal)),
    h('label.field', h('span', { text: 'Activity' }), act),
    h('p.label', { text: 'Suggested daily targets' }), out,
    h('div.row', h('button.btn.btn-accent', { type: 'button', text: 'Use these targets', onclick: () => { const r = read(); Object.assign(p, { ...r, heightCm: r1(r.heightCm), weightKg: r1(r.weightKg) }); const s = suggest(p); Object.assign(g, { kcal: s.kcal, protein: s.protein, carbs: s.carbs, fat: s.fat }); D().setup = true; changed(); toast('Targets updated.'); } }),
      h('button.btn', { type: 'button', text: 'Save profile only', onclick: () => { const r = read(); Object.assign(p, { ...r, heightCm: r1(r.heightCm), weightKg: r1(r.weightKg) }); D().setup = true; changed(); toast('Profile saved.'); } })),
    h('p.hint', { style: { marginTop: '10px' }, text: 'These are general estimates, not medical advice. If you have a health condition, are pregnant, or are under 18, check with a professional before changing how you eat.' })));
  const field = (k, label) => h('label.field', h('span', { text: label }), h('input.input', { type: 'number', min: 0, max: k === 'kcal' ? 10000 : 1000, value: g[k], onchange: e => { g[k] = Math.max(0, Number(e.target.value) || 0); changed(); } }));
  v.append(h('section.card', h('div.card-head', h('h2', { text: 'Daily targets' })), h('div.grid-4', field('kcal', 'Calories'), field('protein', 'Protein (g)'), field('carbs', 'Carbs (g)'), field('fat', 'Fat (g)')), h('div.grid-4', field('water', 'Water (glasses)'))));
  v.append(h('section.card', h('div.card-head', h('h2', { text: 'Your data' })), h('button.btn', { type: 'button', onclick: () => download('stride-backup.json', JSON.stringify(D(), null, 1), 'application/json') }, icon('download', 16), 'Download a backup (JSON)'), h('p.hint', { style: { marginTop: '8px' }, text: 'Food values come from USDA FoodData Central reference data (public domain), rounded.' })));
}

// ---------- start ----------
function route(params) {
  const tab = params.get('tab');
  if (tab && TABS.some(([k]) => k === tab)) state.tab = tab;
  history.replaceState(null, '', '/stride/app');
  render();
}
onShellNavigate(route);
(async () => {
  try {
    await Promise.all([store.load(), loadFoods()]);
    route(new URLSearchParams(location.search));
  } catch (err) { toast('Stride could not load: ' + err.message, { error: true, ms: 20000 }); }
})();
