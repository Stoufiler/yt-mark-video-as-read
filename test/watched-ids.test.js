const test = require('node:test');
const assert = require('node:assert/strict');
const { addWatchedId } = require('../src/watched-ids.js');

test('addWatchedId appends a new id without mutating the input', () => {
  const ids = ['aaaaaaaaaaa'];
  assert.deepEqual(addWatchedId(ids, 'bbbbbbbbbbb'), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.deepEqual(ids, ['aaaaaaaaaaa']);
});

test('addWatchedId moves an existing id to the end instead of duplicating it', () => {
  assert.deepEqual(addWatchedId(['a', 'b', 'c'], 'a'), ['b', 'c', 'a']);
});

test('addWatchedId drops the oldest ids beyond the limit', () => {
  assert.deepEqual(addWatchedId(['a', 'b', 'c'], 'd', 3), ['b', 'c', 'd']);
});

test('addWatchedId tolerates missing or corrupted stored data', () => {
  assert.deepEqual(addWatchedId(undefined, 'a'), ['a']);
  assert.deepEqual(addWatchedId('garbage', 'a'), ['a']);
});
