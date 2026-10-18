// Time-limit helpers for the template closes_at column. Pure — never
// requires ./db, so `node --test` runs with no database.
const TIME_LIMITS = { '1d': '1 day', '1w': '7 days', '1m': '1 month' };

// Postgres interval string for a time_limit value; null = no limit. Throws a
// 400 for unknown values so POST /api/templates rejects them before inserting.
function closeInterval(value) {
  if (value === undefined || value === null || value === '' || value === 'none') return null;
  if (typeof value !== 'string' || !TIME_LIMITS[value]) {
    const e = new Error('Unknown time limit');
    e.status = 400;
    throw e;
  }
  return TIME_LIMITS[value];
}

// Inclusive: a list closes the instant its closes_at passes.
function isClosed(closesAt, now = new Date()) {
  return !!closesAt && new Date(closesAt) <= now;
}

// Server-side message, date in UTC so it reads the same to every client.
function closedMessage(closesAt) {
  return 'This list closed on ' + new Date(closesAt).toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

module.exports = { TIME_LIMITS, closeInterval, isClosed, closedMessage };
