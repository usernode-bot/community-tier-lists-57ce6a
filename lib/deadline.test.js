// Unit tests for the time-limit helpers (issue #23). Pure functions only —
// lib/deadline.js must never require ./db, so `node --test` runs with no
// database.
const test = require('node:test');
const assert = require('node:assert');
const { closeInterval, isClosed, closedMessage } = require('./deadline');

test('closeInterval maps the presets to Postgres intervals', () => {
  assert.equal(closeInterval('1d'), '1 day');
  assert.equal(closeInterval('1w'), '7 days');
  assert.equal(closeInterval('1m'), '1 month');
});

test('closeInterval treats missing values as no limit', () => {
  assert.equal(closeInterval(undefined), null);
  assert.equal(closeInterval(''), null);
  assert.equal(closeInterval('none'), null);
});

test('closeInterval rejects unknown values with a 400', () => {
  for (const bad of ['2y', '1 day', { '1d': true }]) {
    assert.throws(() => closeInterval(bad), (err) => err.status === 400);
  }
});

test('isClosed judges by the instant, inclusive', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  assert.equal(isClosed(null, now), false);
  assert.equal(isClosed('2026-10-18T00:00:00Z', now), false);
  assert.equal(isClosed('2026-10-17T00:00:00Z', now), true);
  assert.equal(isClosed('2026-10-17T12:00:00Z', now), true);
});

test('closedMessage formats the date in UTC', () => {
  assert.equal(closedMessage('2026-10-17T12:00:00Z'), 'This list closed on Oct 17, 2026');
});
