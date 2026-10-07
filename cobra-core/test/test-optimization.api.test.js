const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createApi, formatDuration, calculateSavingsPercent } = require('../public/js/api');
const mockSummary = require('../public/mocks/test-optimization-summary.json');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('formats durations as compact human-readable units', () => {
  assert.equal(formatDuration(48), '48 s');
  assert.equal(formatDuration(345), '5.75 m');
  assert.equal(formatDuration(1195200), '332 h');
  assert.equal(formatDuration(null), '—');
});

test('calculates compute-time savings as a percentage of full-suite time', () => {
  assert.equal(calculateSavingsPercent([
    { computeTimeSec: 100, savingsSec: 25 },
    { computeTimeSec: 300, savingsSec: 100 },
  ]), 31.3);
  assert.equal(calculateSavingsPercent([{ computeTimeSec: 0, savingsSec: 10 }]), 0);
});

test('uses the local sample file only when the summary endpoint returns 404', async () => {
  const calls = [];
  const api = createApi(async (url) => {
    calls.push(url);
    if (url.startsWith('/test-optimization/summary?')) return jsonResponse({}, 404);
    return jsonResponse({ savingsPercent: 20, apps: [] });
  });

  const result = await api.getTestOptimizationSummary({ from: '2026-09-01', to: '2026-09-30', app: 'cobra core' });
  assert.equal(result.sample, true);
  assert.deepEqual(result.data, { savingsPercent: 20, apps: [] });
  assert.match(calls[0], /app=cobra\+core/);
  assert.equal(calls[1], '/mocks/test-optimization-summary.json');
});

test('uses the live summary without marking it as sample data', async () => {
  const api = createApi(async () => jsonResponse({ savingsPercent: 12, apps: [] }));
  const result = await api.getTestOptimizationSummary({ from: '2026-09-01', to: '2026-09-30' });
  assert.equal(result.sample, false);
  assert.equal(result.data.savingsPercent, 12);
});

test('does not mask non-404 summary failures with sample data', async () => {
  const api = createApi(async () => jsonResponse({ error: 'unavailable' }, 500));
  await assert.rejects(api.getTestOptimizationSummary({}), (error) => error.status === 500);
});

test('sample summary percentage matches its app totals', () => {
  assert.equal(mockSummary.savingsPercent, calculateSavingsPercent(mockSummary.apps));
});