// Pure ranking logic. No DOM, no network — safe to unit test in Node.
//
// The ranking is one ordered array of strings: dog ids mixed with four cut
// markers. A dog's tier is decided by how many cut markers sit above it.

export const CUTS = ['cut1', 'cut2', 'cut3', 'cutPass'];
export const TIERS = ['t1', 't2', 't3', 'unsorted', 'pass'];
export const RANKED_TIERS = ['t1', 't2', 't3'];

const CUT_SET = new Set(CUTS);
export const isCut = (x) => CUT_SET.has(x);

const emptyGroups = () => ({ t1: [], t2: [], t3: [], unsorted: [], pass: [] });

/** Everything starts in "Not sorted". */
export function defaultOrder(dogIds) {
  return ['cut1', 'cut2', 'cut3', ...dogIds, 'cutPass'];
}

/** Each cut appears exactly once, in order. */
export function isValidOrder(order) {
  const cuts = order.filter(isCut);
  return cuts.length === CUTS.length && cuts.every((c, i) => c === CUTS[i]);
}

/** Dogs bucketed by tier, each bucket in ranked order. */
export function groups(order) {
  const g = emptyGroups();
  let cutsSeen = 0;
  for (const x of order) {
    if (isCut(x)) cutsSeen = Math.min(cutsSeen + 1, CUTS.length);
    else g[TIERS[cutsSeen]].push(x);
  }
  return g;
}

export function fromGroups(g) {
  return [...g.t1, 'cut1', ...g.t2, 'cut2', ...g.t3, 'cut3', ...g.unsorted, 'cutPass', ...g.pass];
}

/**
 * Turn whatever was saved into a valid order for the dogs we have now:
 * drops unknown ids and duplicates, repairs missing or shuffled cut lines,
 * and puts dogs that are new since the save into "Not sorted".
 */
export function normalizeOrder(saved, dogIds) {
  if (saved && !Array.isArray(saved) && typeof saved === 'object') {
    // Firebase can hand arrays back as { "0": ..., "1": ... }.
    saved = Object.keys(saved).sort((a, b) => a - b).map((k) => saved[k]);
  }
  if (!Array.isArray(saved) || saved.length === 0) return defaultOrder(dogIds);

  const known = new Set(dogIds);
  const seen = new Set();
  const kept = [];
  for (const x of saved) {
    if (typeof x !== 'string' || seen.has(x)) continue;
    if (isCut(x) || known.has(x)) { seen.add(x); kept.push(x); }
  }
  const g = groups(kept);
  for (const id of dogIds) if (!seen.has(id)) g.unsorted.push(id);
  return fromGroups(g);
}

/** Map of dog id -> tier key. */
export function tierMap(order) {
  const m = new Map();
  const g = groups(order);
  for (const t of TIERS) for (const id of g[t]) m.set(id, t);
  return m;
}

/** Dogs in tiers 1-3, best first. */
export function rankedIds(order) {
  const g = groups(order);
  return [...g.t1, ...g.t2, ...g.t3];
}

/** Map of dog id -> 1-based rank, for dogs in tiers 1-3 only. */
export function rankNumbers(order) {
  const m = new Map();
  rankedIds(order).forEach((id, i) => m.set(id, i + 1));
  return m;
}

/** Move a dog to the bottom of a tier. */
export function moveToTier(order, id, tier) {
  if (!TIERS.includes(tier) || isCut(id) || !order.includes(id)) return order;
  const g = groups(order);
  for (const t of TIERS) g[t] = g[t].filter((x) => x !== id);
  g[tier].push(id);
  return fromGroups(g);
}

/**
 * Drag-and-drop move: put `id` (a dog or a cut line) directly after `prevId`,
 * or at the very top when prevId is null. Returns the original array, same
 * reference, when the move is impossible or would put cut lines out of order.
 */
export function moveAfter(order, id, prevId) {
  if (id === prevId || !order.includes(id)) return order;
  const without = order.filter((x) => x !== id);
  let at = 0;
  if (prevId !== null && prevId !== undefined) {
    const i = without.indexOf(prevId);
    if (i === -1) return order;
    at = i + 1;
  }
  const next = [...without.slice(0, at), id, ...without.slice(at)];
  return isValidOrder(next) ? next : order;
}

/** The best-ranked dogs nobody has taken yet. */
export function topAvailable(order, taken = {}, n = 3) {
  return rankedIds(order).filter((id) => !taken[id]).slice(0, n);
}
