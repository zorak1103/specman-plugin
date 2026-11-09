import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPlainText, computeMarkups } from '../scripts/nsd-diff-markups.mjs';

test('diffPlainText finds an appended suffix', () => {
  const d = diffPlainText('hello', 'hello world');
  assert.deepEqual(d, { from: 5, to: 10 });
});

test('diffPlainText finds a prepended prefix', () => {
  const d = diffPlainText('world', 'hello world');
  assert.deepEqual(d, { from: 0, to: 5 });
});

test('diffPlainText finds a replaced middle section', () => {
  const d = diffPlainText('the cat sat', 'the dog sat');
  assert.deepEqual(d, { from: 4, to: 6 });
});

test('diffPlainText returns null when nothing changed', () => {
  assert.equal(diffPlainText('same', 'same'), null);
});

test('diffPlainText returns null for a pure deletion with no new characters to mark', () => {
  assert.equal(diffPlainText('hello world', 'hello'), null);
});

test('computeMarkups produces one self-validated Changed span for an appended suffix', () => {
  const result = computeMarkups({ oldPlain: 'hello', newPlain: 'hello world', changeset: 'yellow' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.markups, [{ from: 5, to: 10, type: 'Changed', changeset: 'yellow' }]);
});

test('computeMarkups reports no markups (not an error) when nothing changed', () => {
  const result = computeMarkups({ oldPlain: 'same', newPlain: 'same', changeset: 'yellow' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.markups, []);
});

test('computeMarkups self-check: rejects an out-of-range span rather than writing a wrong markup', () => {
  // Simulates a diff bug producing an out-of-bounds span; computeMarkups must refuse to trust it.
  const result = computeMarkups({ oldPlain: 'a', newPlain: 'ab', changeset: 'yellow', __forceSpan: { from: 5, to: 9 } });
  assert.equal(result.ok, false);
  assert.match(result.error, /out of range/i);
});
