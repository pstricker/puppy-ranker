import * as L from './logic.js';
import { createStore } from './store.js';

const LINE_POSITION = 22; // our place in the adoption line

const TIER_INFO = {
  t1: { label: 'Tier 1', short: '1' },
  t2: { label: 'Tier 2', short: '2' },
  t3: { label: 'Tier 3', short: '3' },
  unsorted: { label: 'Not sorted', short: '' },
  pass: { label: 'Pass', short: 'Pass' },
};
const CUT_INFO = {
  cut1: { above: 't1', text: 'Tier 1 ends' },
  cut2: { above: 't2', text: 'Tier 2 ends' },
  cut3: { above: 't3', text: 'Tier 3 ends' },
  cutPass: { above: 'unsorted', text: 'Pass below' },
};

// ---------- tiny DOM helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid);
  }
  return el;
}

function photo(src, alt, cls, eager = false) {
  return h('img', {
    class: cls, src, alt,
    loading: eager ? 'eager' : 'lazy',
    decoding: 'async',
    referrerPolicy: 'no-referrer',
  });
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

// ---------- dog formatting ----------

// "Shepherd, German" -> "German Shepherd"
const breedName = (b) => (b || '').split(', ').reverse().join(' ').trim();

function mixLabel(dog) {
  const a = breedName(dog.breed);
  const b = breedName(dog.secondaryBreed);
  if (!b) return a;
  if (b === 'Mix') return `${a} mix`;
  return `${a} × ${b}`;
}

const ageShort = (dog) => (dog.ageWeeks < 16 ? `${dog.ageWeeks} wk` : dog.ageLabel);
const weightShort = (dog) => {
  const n = parseFloat(dog.weight);
  return Number.isFinite(n) ? `${n} lb` : '';
};
const facts = (dog) => [dog.sex, ageShort(dog), weightShort(dog)].filter(Boolean).join(' · ');
const isSoon = (dog) => dog.status !== 'available';

// ---------- load data ----------

const data = await fetch('dogs.json').then((r) => r.json());
const dogs = data.dogs;
const byId = new Map(dogs.map((d) => [d.id, d]));
const soonCount = dogs.filter((d) => d.status !== 'available').length;
$('#dogcount').textContent = `${dogs.length - soonCount} available · ${soonCount} coming soon`;

const litterNum = (id) => parseInt(String(id).replace(/\D+/g, ''), 10) || 0;
const litters = [...new Set(dogs.map((d) => d.litterId))]
  .sort((a, b) => litterNum(a) - litterNum(b))
  .map((id) => {
    const members = dogs.filter((d) => d.litterId === id);
    return { id, members, label: mixLabel(members[0]), age: members[0].ageLabel, description: members[0].litterDescription || '' };
  });

// ---------- state ----------

let state = null;
let tiers = new Map();
let ranks = new Map();
let dragging = false;
let pendingRender = false;

// Coming-soon pups are hidden unless this device has switched them on.
const SOON_KEY = 'puppy-ranker:show-soon';
let savedShowSoon = false;
try { savedShowSoon = localStorage.getItem(SOON_KEY) === '1'; } catch { /* ignore */ }
const filters = { q: '', sex: null, showSoon: savedShowSoon, sorted: null, hidePass: false, hideTaken: false };
let ready = false;

const store = await createStore(dogs.map((d) => d.id), (next, status) => {
  state = next;
  tiers = L.tierMap(state.order);
  ranks = L.rankNumbers(state.order);
  renderSync(status);
  if (!ready) return;
  if (dragging) { pendingRender = true; return; }
  renderAll();
});

const setTier = (id, tier) => {
  const target = tiers.get(id) === tier ? 'unsorted' : tier;
  store.update((s) => ({ ...s, order: L.moveToTier(s.order, id, target) }));
};
const toggleTaken = (id) => {
  store.update((s) => {
    const taken = { ...s.taken };
    if (taken[id]) delete taken[id]; else taken[id] = true;
    return { ...s, taken };
  });
};
const setNote = (id, text) => {
  store.update((s) => ({ ...s, notes: { ...s.notes, [id]: text } }));
};

// ---------- shared bits ----------

function tierButtons(id, { large = false } = {}) {
  return h('div', { class: `tierbtns${large ? ' large' : ''}`, role: 'group', 'aria-label': 'Tier' },
    ['t1', 't2', 't3', 'pass'].map((t) =>
      h('button', {
        type: 'button', dataset: { tier: t },
        'aria-label': TIER_INFO[t].label,
        onclick: (e) => { e.stopPropagation(); setTier(id, t); },
      }, large ? TIER_INFO[t].label : TIER_INFO[t].short)));
}

function syncTierButtons(root, id) {
  const tier = tiers.get(id);
  for (const b of root.querySelectorAll('.tierbtns button')) {
    b.setAttribute('aria-pressed', String(b.dataset.tier === tier));
  }
}

function badgeText(id) {
  const tier = tiers.get(id);
  if (ranks.has(id)) return `#${ranks.get(id)}`;
  return tier === 'pass' ? 'Pass' : '';
}

// ---------- sync pill ----------

function renderSync(status) {
  const el = $('#sync');
  const text = { live: 'Live', connecting: 'Connecting', offline: 'Offline', local: 'This device' }[status];
  const title = {
    live: 'Changes sync to every phone that has this page open.',
    connecting: 'Connecting to the shared list…',
    offline: 'No connection. Changes will sync when you are back online.',
    local: 'Rankings are saved on this device only.',
  }[status];
  el.dataset.status = status;
  el.textContent = text;
  el.title = title;
}

// ---------- browse ----------

const cardEls = new Map();
const litterEls = new Map();

function buildCard(dog) {
  const open = () => openSheet(dog.id, visibleBrowseIds());
  const card = h('article', { class: 'card', dataset: { id: dog.id } },
    h('button', { type: 'button', class: 'card-photo', onclick: open, 'aria-label': `Open ${dog.name}` },
      dog.photos[0] ? photo(dog.photos[0], dog.name, '') : h('span', { class: 'nophoto' }, 'No photo'),
      h('span', { class: 'badge' }),
      dog.photos.length > 1 && h('span', { class: 'photocount' }, `${dog.photos.length} photos`),
      isSoon(dog) && h('span', { class: 'soon' }, 'Coming soon'),
      h('span', { class: 'stamp' }, 'Taken')),
    h('div', { class: 'card-body', onclick: open },
      h('h3', {}, dog.name),
      h('p', {}, facts(dog))),
    tierButtons(dog.id));
  cardEls.set(dog.id, card);
  return card;
}

function buildBrowse() {
  const chipDefs = [
    ['Show coming soon', () => filters.showSoon, () => {
      filters.showSoon = !filters.showSoon;
      try { localStorage.setItem(SOON_KEY, filters.showSoon ? '1' : '0'); } catch { /* ignore */ }
    }],
    ['Female', () => filters.sex === 'Female', () => { filters.sex = filters.sex === 'Female' ? null : 'Female'; }],
    ['Male', () => filters.sex === 'Male', () => { filters.sex = filters.sex === 'Male' ? null : 'Male'; }],
    ['Not sorted', () => filters.sorted === 'unsorted', () => { filters.sorted = filters.sorted === 'unsorted' ? null : 'unsorted'; }],
    ['Ranked', () => filters.sorted === 'ranked', () => { filters.sorted = filters.sorted === 'ranked' ? null : 'ranked'; }],
    ['Hide passes', () => filters.hidePass, () => { filters.hidePass = !filters.hidePass; }],
    ['Hide taken', () => filters.hideTaken, () => { filters.hideTaken = !filters.hideTaken; }],
  ];
  const chipEls = chipDefs.map(([label, isOn, toggle]) => {
    const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(isOn()) }, label);
    b.addEventListener('click', () => {
      toggle();
      chipEls.forEach((el, i) => el.setAttribute('aria-pressed', String(chipDefs[i][1]())));
      renderAll();
    });
    return b;
  });
  $('#chips').append(...chipEls);

  $('#search').addEventListener('input', (e) => {
    filters.q = e.target.value.trim().toLowerCase();
    syncBrowse();
  });

  for (const lit of litters) {
    const desc = h('p', { class: 'litter-desc clamp' }, lit.description);
    const more = lit.description.length > 140 && h('button', {
      type: 'button', class: 'linkbtn',
      onclick: () => { more.textContent = desc.classList.toggle('clamp') ? 'More' : 'Less'; },
    }, 'More');
    const section = h('section', { class: 'litter', id: lit.id },
      h('header', {},
        h('p', { class: 'eyebrow' }, `Litter ${litterNum(lit.id)} · ${lit.members.length} listed · ${lit.age}`),
        h('h2', {}, lit.label),
        lit.description && desc, more),
      h('div', { class: 'grid' }, lit.members.map(buildCard)));
    litterEls.set(lit.id, section);
    $('#litters').append(section);

    $('#litternav').append(h('button', {
      type: 'button', class: 'litterlink', dataset: { litter: lit.id },
      onclick: () => section.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    }, h('b', {}, lit.members.length), ` ${lit.label}`));
  }
}

function passesFilters(dog) {
  const tier = tiers.get(dog.id);
  if (filters.q && !dog.name.toLowerCase().includes(filters.q)) return false;
  if (filters.sex && dog.sex !== filters.sex) return false;
  if (!filters.showSoon && isSoon(dog)) return false;
  if (filters.sorted === 'unsorted' && tier !== 'unsorted') return false;
  if (filters.sorted === 'ranked' && !ranks.has(dog.id)) return false;
  if (filters.hidePass && tier === 'pass') return false;
  if (filters.hideTaken && state.taken[dog.id]) return false;
  return true;
}

const visibleBrowseIds = () =>
  litters.flatMap((l) => l.members).filter(passesFilters).map((d) => d.id);

function syncBrowse() {
  let shown = 0;
  for (const lit of litters) {
    let any = false;
    for (const dog of lit.members) {
      const card = cardEls.get(dog.id);
      const ok = passesFilters(dog);
      card.hidden = !ok;
      if (ok) { any = true; shown += 1; }
      card.dataset.tier = tiers.get(dog.id);
      card.dataset.taken = String(Boolean(state.taken[dog.id]));
      $('.badge', card).textContent = badgeText(dog.id);
      syncTierButtons(card, dog.id);
    }
    litterEls.get(lit.id).hidden = !any;
    $(`[data-litter="${lit.id}"]`).hidden = !any;
  }
  const hiddenSoon = filters.showSoon ? '' : ` · ${soonCount} coming-soon pups hidden`;
  $('#resultcount').textContent = shown === 0
    ? `No pups match these filters${hiddenSoon}.`
    : shown === dogs.length ? '' : `Showing ${shown} of ${dogs.length}${hiddenSoon}`;
}

// ---------- rank ----------

const rowEls = new Map();

function buildRow(id) {
  if (L.isCut(id)) {
    return h('li', { class: 'cut', dataset: { id, tier: CUT_INFO[id].above } },
      h('span', { class: 'cut-label' }),
      h('span', { class: 'handle', 'aria-label': 'Drag tier line' }, h('span', { class: 'grip' })));
  }
  const dog = byId.get(id);
  return h('li', { class: 'row', dataset: { id } },
    h('span', { class: 'handle', 'aria-label': `Drag ${dog.name}` }, h('span', { class: 'grip' })),
    h('span', { class: 'num' }),
    h('button', { type: 'button', class: 'row-main', onclick: () => openSheet(id, visibleOrder().filter((x) => !L.isCut(x))) },
      dog.photos[0] ? photo(dog.photos[0], '', 'thumb') : h('span', { class: 'thumb nophoto' }),
      h('span', { class: 'row-text' },
        h('strong', {}, dog.name),
        h('small', {}, `${facts(dog)} · ${mixLabel(dog)}`))),
    h('button', { type: 'button', class: 'takenbtn', 'aria-pressed': 'false', onclick: () => toggleTaken(id) }, 'Taken'));
}

// Coming-soon pups stay out of the rank list while they are switched off,
// unless they have already been ranked into a tier.
const rankVisible = (id) =>
  L.isCut(id) || filters.showSoon || ranks.has(id) || !isSoon(byId.get(id));
const visibleOrder = () => state.order.filter(rankVisible);

function renderRank() {
  const g = L.groups(visibleOrder());
  const els = visibleOrder().map((id) => {
    let el = rowEls.get(id);
    if (!el) { el = buildRow(id); rowEls.set(id, el); }
    if (L.isCut(id)) {
      const info = CUT_INFO[id];
      const n = g[info.above].length;
      $('.cut-label', el).textContent = id === 'cutPass'
        ? `${n} not sorted above · ${g.pass.length} passed below`
        : `${info.text} · ${n} ${n === 1 ? 'pup' : 'pups'}`;
    } else {
      el.dataset.tier = tiers.get(id);
      el.dataset.taken = String(Boolean(state.taken[id]));
      $('.num', el).textContent = ranks.get(id) ?? '';
      $('.takenbtn', el).setAttribute('aria-pressed', String(Boolean(state.taken[id])));
    }
    return el;
  });
  $('#ranklist').replaceChildren(...els);
}

function initDrag() {
  // eslint-disable-next-line no-undef
  if (typeof Sortable === 'undefined') {
    $('.rankhint').textContent = 'Drag and drop could not load. Use the tier buttons in Browse instead.';
    return;
  }
  // eslint-disable-next-line no-undef
  Sortable.create($('#ranklist'), {
    handle: '.handle',
    draggable: 'li',
    animation: 160,
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: 3,
    scroll: true,
    scrollSensitivity: 110,
    scrollSpeed: 16,
    ghostClass: 'ghost',
    chosenClass: 'chosen',
    dragClass: 'dragging',
    onStart: () => { dragging = true; document.body.classList.add('is-dragging'); },
    onEnd: (evt) => {
      dragging = false;
      document.body.classList.remove('is-dragging');
      const id = evt.item.dataset.id;
      const prevId = evt.item.previousElementSibling?.dataset.id ?? null;
      const next = L.moveAfter(state.order, id, prevId);
      if (next === state.order) {
        const sameSpot = state.order[state.order.indexOf(id) - 1] === (prevId ?? undefined);
        if (!sameSpot) toast('Tier lines have to stay in order.');
        renderAll();
      } else {
        store.update((s) => ({ ...s, order: L.moveAfter(s.order, id, prevId) }));
        if (pendingRender) renderAll();
      }
      pendingRender = false;
    },
  });
}

// ---------- pick bar + tabs ----------

function renderPickbar() {
  const bar = $('#pickbar');
  const ranked = L.rankedIds(state.order);
  const open = ranked.filter((id) => !state.taken[id]);
  const takenCount = Object.keys(state.taken).length;
  const top = open.slice(0, 3).map((id) => byId.get(id));
  bar.dataset.empty = String(top.length === 0);
  bar.onclick = top.length ? () => openSheet(top[0].id, open) : () => showView('browse');

  const covered = open.length >= LINE_POSITION;
  const meter = h('span', { class: 'meter', dataset: { covered: String(covered) }, title: `You are ${LINE_POSITION}th in line, so rank at least ${LINE_POSITION}.` },
    h('b', {}, open.length), `/${LINE_POSITION} ranked`,
    takenCount > 0 && h('i', {}, ` · ${takenCount} taken`));

  if (!top.length) {
    bar.replaceChildren(
      h('span', { class: 'pick-text' },
        h('small', {}, ranked.length ? 'Every ranked pup is taken' : 'No ranking yet'),
        h('strong', {}, ranked.length ? 'Rank more pups' : 'Tap 1, 2 or 3 on a pup to start')),
      meter);
    return;
  }
  const [first, ...rest] = top;
  bar.replaceChildren(
    first.photos[0] ? photo(first.photos[0], '', 'pick-thumb', true) : h('span', { class: 'pick-thumb nophoto' }),
    h('span', { class: 'pick-text' },
      h('small', {}, `Top pick · ${TIER_INFO[tiers.get(first.id)].label}`),
      h('strong', {}, first.name),
      rest.length > 0 && h('span', { class: 'then' }, `then ${rest.map((d) => d.name).join(', ')}`)),
    meter);
}

function showView(name) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== name;
  for (const b of document.querySelectorAll('.tabs button')) {
    if (b.dataset.view === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0 });
  try { sessionStorage.setItem('puppy-ranker:view', name); } catch { /* ignore */ }
}

function renderTabs() {
  const g = L.groups(visibleOrder());
  $('#tab-browse-count').textContent = `${g.unsorted.length} to sort`;
  $('#tab-rank-count').textContent = `${g.t1.length} · ${g.t2.length} · ${g.t3.length}`;
}

// ---------- detail sheet ----------

const sheet = $('#sheet');
let sheetId = null;
let sheetNav = [];
let noteTimer;

function flushNote() {
  if (!noteTimer) return;
  clearTimeout(noteTimer);
  noteTimer = null;
  const ta = $('textarea', sheet);
  if (ta && sheetId) setNote(sheetId, ta.value);
}

function buildSheet(dog) {
  const litter = litters.find((l) => l.id === dog.litterId);
  const mates = litter.members.filter((d) => d.id !== dog.id);
  const idx = sheetNav.indexOf(dog.id);
  const go = (step) => {
    const nextId = sheetNav[idx + step];
    if (nextId) { flushNote(); showSheet(nextId); }
  };

  const gallery = h('div', { class: 'gallery' },
    dog.photos.length
      ? dog.photos.map((src, i) => photo(src, `${dog.name}, photo ${i + 1}`, '', i === 0))
      : h('div', { class: 'nophoto' }, 'No photos yet'));
  const counter = h('span', { class: 'gcount' }, dog.photos.length > 1 ? `1 / ${dog.photos.length}` : '');
  gallery.addEventListener('scroll', () => {
    if (dog.photos.length < 2) return;
    const i = Math.round(gallery.scrollLeft / gallery.clientWidth) + 1;
    counter.textContent = `${Math.min(i, dog.photos.length)} / ${dog.photos.length}`;
  }, { passive: true });

  const factRows = [
    ['Sex', dog.sex],
    ['Age', `${dog.ageWeeks} weeks`],
    ['Weight', dog.weight],
    ['Status', isSoon(dog) ? 'Coming soon' : 'Available'],
    ['Born about', dog.birthdayEstimate],
    ['Fee', dog.adoptionFee],
  ].filter(([, v]) => v);

  const bio = dog.fosterBio || dog.fullBio || '';

  const notes = h('textarea', {
    rows: 3, placeholder: 'Shared notes: energy, size guess, gut feeling…',
    'aria-label': 'Notes', value: state.notes[dog.id] || '',
    oninput: () => {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(flushNote, 700);
    },
    onblur: flushNote,
  });

  return [
    h('div', { class: 'sheet-top' },
      h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Close', onclick: closeSheet }, '✕'),
      h('span', { class: 'sheet-pos' }, idx >= 0 ? `${idx + 1} of ${sheetNav.length}` : ''),
      h('span', { class: 'sheet-nav' },
        h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Previous pup', disabled: idx <= 0, onclick: () => go(-1) }, '‹'),
        h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Next pup', disabled: idx < 0 || idx >= sheetNav.length - 1, onclick: () => go(1) }, '›'))),
    h('div', { class: 'sheet-scroll' },
      h('div', { class: 'gallery-wrap' }, gallery, counter, h('span', { class: 'stamp' }, 'Taken')),
      h('div', { class: 'sheet-body' },
        h('p', { class: 'eyebrow sheet-rank' }),
        h('h2', {}, dog.name),
        h('p', { class: 'mix' }, mixLabel(dog)),
        h('dl', { class: 'factgrid' }, factRows.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
        dog.attributes.length > 0 && h('ul', { class: 'attrs' }, dog.attributes.map((a) => h('li', {}, a))),
        h('label', { class: 'takenrow' },
          h('input', { type: 'checkbox', class: 'takenbox', onchange: () => toggleTaken(dog.id) }),
          h('span', {}, 'Already taken by someone else')),
        notes,
        dog.highlights.length > 0 && h('section', {},
          h('h3', {}, 'Highlights'),
          h('ul', { class: 'highlights' }, dog.highlights.map((x) => h('li', {}, h('b', {}, x.topic), ' ', x.text)))),
        bio && h('section', {}, h('h3', {}, 'From the foster'), h('p', { class: 'bio' }, bio)),
        h('section', {},
          h('h3', {}, `Litter ${litterNum(litter.id)} · ${litter.label}`),
          litter.description && h('p', { class: 'bio' }, litter.description),
          mates.length > 0 && h('div', { class: 'mates' }, mates.map((m) =>
            h('button', { type: 'button', class: 'mate', dataset: { id: m.id }, onclick: () => { flushNote(); showSheet(m.id); } },
              m.photos[0] ? photo(m.photos[0], '', '') : h('span', { class: 'nophoto' }),
              h('span', {}, m.name))))),
        h('a', { class: 'profilelink', href: dog.profileUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Open the rescue listing ↗'))),
    h('div', { class: 'sheet-actions' },
      tierButtons(dog.id, { large: true }),
      h('button', { type: 'button', class: 'nextbtn', disabled: idx < 0 || idx >= sheetNav.length - 1, onclick: () => go(1) }, 'Next ›')),
  ];
}

function syncSheet() {
  if (!sheetId || !sheet.open) return;
  const tier = tiers.get(sheetId);
  const taken = Boolean(state.taken[sheetId]);
  sheet.dataset.tier = tier;
  sheet.dataset.taken = String(taken);
  $('.sheet-rank', sheet).textContent = ranks.has(sheetId)
    ? `Ranked #${ranks.get(sheetId)} · ${TIER_INFO[tier].label}`
    : TIER_INFO[tier].label;
  $('.takenbox', sheet).checked = taken;
  syncTierButtons(sheet, sheetId);
  const ta = $('textarea', sheet);
  if (document.activeElement !== ta && !noteTimer) ta.value = state.notes[sheetId] || '';
  for (const m of sheet.querySelectorAll('.mate')) m.dataset.tier = tiers.get(m.dataset.id);
}

function showSheet(id) {
  sheetId = id;
  sheet.replaceChildren(...buildSheet(byId.get(id)));
  syncSheet();
}

function openSheet(id, navList) {
  sheetNav = navList && navList.includes(id) ? navList : [id];
  if (!sheet.open) {
    sheet.showModal();
    document.body.classList.add('modal-open');
    history.pushState({ sheet: true }, '');
  }
  showSheet(id);
}

function closeSheet() {
  if (history.state?.sheet) history.back();
  else reallyClose();
}

function reallyClose() {
  flushNote();
  if (sheet.open) sheet.close();
  document.body.classList.remove('modal-open');
  sheetId = null;
}

window.addEventListener('popstate', reallyClose);
sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

// ---------- wire up ----------

function renderAll() {
  syncBrowse();
  renderRank();
  renderPickbar();
  renderTabs();
  syncSheet();
}

buildBrowse();
initDrag();
for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => showView(b.dataset.view));
}
let startView = 'browse';
try { startView = sessionStorage.getItem('puppy-ranker:view') || 'browse'; } catch { /* ignore */ }
showView(startView);
ready = true;
renderAll();
// Entrance animation runs once; drop the class so filter changes don't replay it.
document.body.classList.add('ready');
setTimeout(() => document.body.classList.remove('ready'), 1200);
