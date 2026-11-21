import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

const ids = ['a', 'b', 'c', 'd', 'e'];

test('default order puts every dog in Not sorted', () => {
  const o = L.defaultOrder(ids);
  assert.ok(L.isValidOrder(o));
  const g = L.groups(o);
  assert.deepEqual(g.unsorted, ids);
  assert.deepEqual([g.t1, g.t2, g.t3, g.pass], [[], [], [], []]);
});

test('tier comes from position relative to the cut lines', () => {
  const o = ['a', 'cut1', 'b', 'c', 'cut2', 'cut3', 'd', 'cutPass', 'e'];
  const t = L.tierMap(o);
  assert.equal(t.get('a'), 't1');
  assert.equal(t.get('b'), 't2');
  assert.equal(t.get('c'), 't2');
  assert.equal(t.get('d'), 'unsorted');
  assert.equal(t.get('e'), 'pass');
});

test('isValidOrder rejects missing, duplicated or shuffled cuts', () => {
  assert.equal(L.isValidOrder(['a', 'cut1', 'cut2', 'cut3', 'cutPass']), true);
  assert.equal(L.isValidOrder(['cut2', 'cut1', 'cut3', 'cutPass']), false);
  assert.equal(L.isValidOrder(['cut1', 'cut2', 'cut3']), false);
  assert.equal(L.isValidOrder(['cut1', 'cut1', 'cut2', 'cut3', 'cutPass']), false);
});

test('moveToTier appends to the bottom of the target tier', () => {
  let o = L.defaultOrder(ids);
  o = L.moveToTier(o, 'c', 't1');
  o = L.moveToTier(o, 'a', 't1');
  o = L.moveToTier(o, 'e', 'pass');
  o = L.moveToTier(o, 'b', 't3');
  assert.deepEqual(o, ['c', 'a', 'cut1', 'cut2', 'b', 'cut3', 'd', 'cutPass', 'e']);
  o = L.moveToTier(o, 'c', 'unsorted');
  assert.deepEqual(L.groups(o).unsorted, ['d', 'c']);
  assert.ok(L.isValidOrder(o));
});

test('moveToTier ignores unknown dogs, cut lines and bad tiers', () => {
  const o = L.defaultOrder(ids);
  assert.equal(L.moveToTier(o, 'zzz', 't1'), o);
  assert.equal(L.moveToTier(o, 'cut1', 't2'), o);
  assert.equal(L.moveToTier(o, 'a', 'nope'), o);
});

test('moveAfter reorders a dog, including to the very top', () => {
  const o = ['a', 'b', 'cut1', 'c', 'cut2', 'cut3', 'd', 'cutPass', 'e'];
  assert.deepEqual(L.moveAfter(o, 'd', null), ['d', 'a', 'b', 'cut1', 'c', 'cut2', 'cut3', 'cutPass', 'e']);
  assert.deepEqual(L.moveAfter(o, 'a', 'cut1'), ['b', 'cut1', 'a', 'c', 'cut2', 'cut3', 'd', 'cutPass', 'e']);
});

test('moveAfter moves a cut line, changing the tiers around it', () => {
  const o = ['a', 'cut1', 'b', 'c', 'cut2', 'cut3', 'cutPass'];
  const next = L.moveAfter(o, 'cut1', 'b');
  assert.deepEqual(next, ['a', 'b', 'cut1', 'c', 'cut2', 'cut3', 'cutPass']);
  assert.equal(L.tierMap(next).get('b'), 't1');
});

test('moveAfter refuses to put cut lines out of order', () => {
  const o = ['a', 'cut1', 'b', 'cut2', 'c', 'cut3', 'cutPass'];
  assert.equal(L.moveAfter(o, 'cut1', 'c'), o);
  assert.equal(L.moveAfter(o, 'cut3', null), o);
  assert.equal(L.moveAfter(o, 'a', 'missing'), o);
  assert.equal(L.moveAfter(o, 'missing', 'a'), o);
});

test('normalizeOrder falls back to the default for empty saves', () => {
  assert.deepEqual(L.normalizeOrder(null, ids), L.defaultOrder(ids));
  assert.deepEqual(L.normalizeOrder([], ids), L.defaultOrder(ids));
});

test('normalizeOrder drops stale ids and duplicates, adds new dogs to Not sorted', () => {
  const saved = ['b', 'gone', 'cut1', 'a', 'b', 'cut2', 'cut3', 'cutPass', 'c'];
  const o = L.normalizeOrder(saved, ids);
  assert.deepEqual(o, ['b', 'cut1', 'a', 'cut2', 'cut3', 'd', 'e', 'cutPass', 'c']);
});

test('normalizeOrder repairs missing cut lines and keeps what it can', () => {
  const o = L.normalizeOrder(['a', 'cut1', 'b'], ids);
  assert.ok(L.isValidOrder(o));
  assert.equal(L.tierMap(o).get('a'), 't1');
  assert.equal(L.tierMap(o).get('b'), 't2');
  assert.equal(L.tierMap(o).get('c'), 'unsorted');
});

test('normalizeOrder accepts the object form Firebase can return', () => {
  const o = L.normalizeOrder({ 0: 'a', 1: 'cut1', 2: 'cut2', 3: 'cut3', 4: 'cutPass', 10: 'b' }, ids);
  assert.equal(L.tierMap(o).get('a'), 't1');
  assert.equal(L.tierMap(o).get('b'), 'pass');
});

test('rank numbers cover tiers 1-3 only', () => {
  const o = ['a', 'cut1', 'b', 'cut2', 'c', 'cut3', 'd', 'cutPass', 'e'];
  const r = L.rankNumbers(o);
  assert.deepEqual([r.get('a'), r.get('b'), r.get('c')], [1, 2, 3]);
  assert.equal(r.has('d'), false);
  assert.equal(r.has('e'), false);
});

test('topAvailable skips taken dogs and never reaches unsorted ones', () => {
  const o = ['a', 'cut1', 'b', 'cut2', 'c', 'cut3', 'd', 'cutPass', 'e'];
  assert.deepEqual(L.topAvailable(o, { a: true }, 3), ['b', 'c']);
  assert.deepEqual(L.topAvailable(o, { a: true, b: true, c: true }), []);
  assert.deepEqual(L.topAvailable(o, {}, 1), ['a']);
});
