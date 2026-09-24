const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateRiskResponse } = require('./check-release-risk.js');

test('non-empty untestedChanges fails and lists the changed file and function', () => {
  const result = evaluateRiskResponse({
    riskScore: 0.8,
    untestedChanges: [
      { file: 'src/payment.js', function: 'calculatePremium', status: 'untested' }
    ]
  });

  assert.equal(result.shouldFail, true);
  assert.match(result.message, /src\/payment\.js/);
  assert.match(result.message, /calculatePremium/);
});

test('empty untestedChanges passes', () => {
  const result = evaluateRiskResponse({ riskScore: 0.1, untestedChanges: [] });

  assert.equal(result.shouldFail, false);
  assert.equal(result.message, 'No untested changed code was reported.');
});

test('null riskScore displays n/a instead of null', () => {
  const result = evaluateRiskResponse({ riskScore: null, untestedChanges: [] });

  assert.equal(result.riskScore, 'n/a');
  assert.notEqual(result.riskScore, 'null');
});

test('a numeric riskScore is retained for display', () => {
  const result = evaluateRiskResponse({ riskScore: 0.33, untestedChanges: [] });

  assert.equal(result.riskScore, 0.33);
});

test('missing untestedChanges remains a fail-safe response error', () => {
  // The existing CLI rejects a missing or non-array untestedChanges field; this
  // keeps that fail-safe behavior rather than treating the response as empty.
  const result = evaluateRiskResponse({ riskScore: 0 });

  assert.equal(result.shouldFail, true);
  assert.equal(result.invalidResponse, true);
  assert.match(result.message, /missing the required untestedChanges array/);
});
