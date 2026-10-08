const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createApi } = require('../public/js/api');
const { render, renderError } = require('../public/js/test-gaps-view');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('getTestGaps requests the encoded build-specific endpoint', async () => {
  const calls = [];
  const payload = { buildId: 'release/one #?', gaps: [] };
  const api = createApi(async (url) => {
    calls.push(url);
    return jsonResponse(payload);
  });

  assert.deepEqual(await api.getTestGaps('release/one #?'), payload);
  assert.deepEqual(calls, ['/test-gaps/release%2Fone%20%23%3F']);
});

test('getTestGaps preserves the shared API error handling', async () => {
  const api = createApi(async () => jsonResponse({ error: 'Build not found' }, 404));
  await assert.rejects(api.getTestGaps('missing'), (error) =>
    error.status === 404 && /Build not found HTTP 404/.test(error.message)
  );
});

test('historical test gaps renders summary values and gap details', () => {
  const html = render({
    buildId: 'build-42',
    repo: 'cobra',
    branch: 'main',
    language: 'javascript',
    branchStrategy: 'cross_branch_fallback',
    summary: {
      changedFunctions: 12,
      coveredChangedFunctions: 8,
      gaps: 3,
      deletedFunctions: 1,
    },
    gaps: [{
      file: 'src/claims.js',
      function: 'submitClaim',
      status: 'modified',
      startLine: 24,
      endLine: 38,
      author: 'Ada Example',
      reason: 'no_historical_coverage',
    }],
  });

  for (const content of [
    'Changed Functions', '12', 'Covered Changed Functions', '8',
    'Historical Gaps', '3', 'Deleted Functions', '1',
    'Build ID:', 'build-42', 'Repository:', 'cobra', 'Branch:', 'main',
    'Language:', 'javascript', 'Cross-branch fallback', 'src/claims.js',
    'submitClaim', 'modified', '24–38', 'Ada Example',
    'No matching historical coverage found',
    'No eligible historical coverage record matched this changed function with positive hits. This does not mean that no test exists.',
  ]) {
    assert.ok(html.includes(content), `expected rendered gap page to include ${content}`);
  }
});

test('historical test gaps render missing lines and authors safely', () => {
  const html = render({
    summary: {},
    gaps: [{
      file: 'src/anonymous.js',
      function: 'anonymous',
      status: 'new',
      startLine: 7,
      endLine: null,
      author: null,
      reason: 'no_historical_coverage',
    }],
  });

  assert.match(html, /<td>—<\/td><td>Not recorded<\/td>/);
});

test('historical test gaps render an explicit empty state', () => {
  const html = render({ summary: { gaps: 0 }, gaps: [] });

  assert.match(html, /No historical coverage gaps were found for the selected build\./);
  assert.doesNotMatch(html, /<thead>/);
});

test('historical test gaps render a retryable API error state', () => {
  const html = renderError('Build not found HTTP 404.');

  assert.match(html, /role="alert"/);
  assert.match(html, /Could not load historical test gaps: Build not found HTTP 404\./);
  assert.match(html, /id="retryTestGaps"/);
});

test('dashboard exposes and dispatches the dedicated historical test gaps screen', () => {
  const dashboard = readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');

  assert.match(dashboard, /Historical Test Gaps/);
  assert.match(dashboard, /screen=test-gaps/);
  assert.match(dashboard, /getTestGaps\(buildId\)/);
  assert.match(dashboard, /data-action="test-gaps"/);
  assert.match(dashboard, /CobraTestGapsView\.renderError\(error\.message\)/);
});
