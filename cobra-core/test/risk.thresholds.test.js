const express = require('express');
const request = require('supertest');
const createRiskRouter = require('../src/routes/risk');

function mockPool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

function appWith(pool) {
  const app = express();
  app.use(createRiskRouter(pool));
  return app;
}

describe('GET /risk/:buildId - thresholds, overallCoverage, no_data', () => {
  test('zero changed_functions -> verdict no_data, even with rules configured', async () => {
    const pool = mockPool((sql) => {
      if (sql.includes('FROM builds WHERE')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('COUNT(*)::int AS total\n         FROM changed_functions')) return { rows: [{ total: 0 }] };
      if (sql.includes('per_function')) return { rows: [{ total: 10, covered: 5 }] };
      if (sql.includes('quality_gate_rules')) return { rows: [{ metric: 'code_changes_coverage', operator: '>=', threshold: 50 }] };
      throw new Error('unexpected query: ' + sql);
    });
    const res = await request(appWith(pool)).get('/risk/empty-build');
    expect(res.body.verdict).toBe('no_data');
    expect(res.body.riskScore).toBe(0);
  });

  test('no rules configured -> legacy fallback: untested=0 passes', async () => {
    const pool = mockPool((sql) => {
      if (sql.includes('FROM builds WHERE')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [] };
      if (sql.includes('JOIN changed_functions')) return { rows: [{ test_id: 't1', function: 'f1' }] };
      if (sql.includes('COUNT(*)::int AS total\n         FROM changed_functions')) return { rows: [{ total: 2 }] };
      if (sql.includes('per_function')) return { rows: [{ total: 4, covered: 4 }] };
      if (sql.includes('quality_gate_rules')) return { rows: [] };
      throw new Error('unexpected query: ' + sql);
    });
    const res = await request(appWith(pool)).get('/risk/clean-build');
    expect(res.body.verdict).toBe('pass');
    expect(res.body.overallCoverage).toBe(100);
  });

  test('no rules configured -> legacy fallback: any untested fails', async () => {
    const pool = mockPool((sql) => {
      if (sql.includes('FROM builds WHERE')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [{ file: 'a.js', function: 'f', status: 'modified' }] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('COUNT(*)::int AS total\n         FROM changed_functions')) return { rows: [{ total: 1 }] };
      if (sql.includes('per_function')) return { rows: [{ total: 2, covered: 1 }] };
      if (sql.includes('quality_gate_rules')) return { rows: [] };
      throw new Error('unexpected query: ' + sql);
    });
    const res = await request(appWith(pool)).get('/risk/bad-build');
    expect(res.body.verdict).toBe('fail');
  });

  test('rules configured, all pass -> verdict pass even with some untested (threshold-based, not binary)', async () => {
    const pool = mockPool((sql) => {
      if (sql.includes('FROM builds WHERE')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [{ file: 'a.js', function: 'f', status: 'modified' }] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('COUNT(*)::int AS total\n         FROM changed_functions')) return { rows: [{ total: 4 }] };
      if (sql.includes('per_function')) return { rows: [{ total: 10, covered: 8 }] };
      if (sql.includes('quality_gate_rules')) return {
        rows: [
          { metric: 'code_changes_coverage', operator: '>=', threshold: 50 },
          { metric: 'overall_coverage', operator: '>=', threshold: 70 },
        ],
      };
      throw new Error('unexpected query: ' + sql);
    });
    const res = await request(appWith(pool)).get('/risk/threshold-build');
    expect(res.body.verdict).toBe('pass');
    expect(res.body.overallCoverage).toBe(80);
  });

  test('rules configured, one fails -> verdict fail', async () => {
    const pool = mockPool((sql) => {
      if (sql.includes('FROM builds WHERE')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [{ file: 'a.js', function: 'f', status: 'modified' }] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('COUNT(*)::int AS total\n         FROM changed_functions')) return { rows: [{ total: 4 }] };
      if (sql.includes('per_function')) return { rows: [{ total: 10, covered: 2 }] };
      if (sql.includes('quality_gate_rules')) return {
        rows: [
          { metric: 'code_changes_coverage', operator: '>=', threshold: 50 },
          { metric: 'overall_coverage', operator: '>=', threshold: 70 },
        ],
      };
      throw new Error('unexpected query: ' + sql);
    });
    const res = await request(appWith(pool)).get('/risk/threshold-fail-build');
    expect(res.body.verdict).toBe('fail');
  });

  test('rule with unsupported metric is skipped and reported, not silently passed', async () => {
    const pool = mockPool((sql) => {
      if (sql.includes('FROM builds WHERE')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('COUNT(*)::int AS total\n         FROM changed_functions')) return { rows: [{ total: 2 }] };
      if (sql.includes('per_function')) return { rows: [{ total: 5, covered: 5 }] };
      if (sql.includes('quality_gate_rules')) return {
        rows: [{ metric: 'failed_tests', operator: '=', threshold: 0 }],
      };
      throw new Error('unexpected query: ' + sql);
    });
    const res = await request(appWith(pool)).get('/risk/unsupported-metric-build');
    expect(res.body.verdict).toBe('pass');
    expect(res.body.skippedRules).toEqual([{ metric: 'failed_tests', reason: 'unsupported metric' }]);
  });

  test('build not found in builds table -> repo null, overallCoverage null, rules skipped entirely', async () => {
    const pool = mockPool((sql) => {
      if (sql.includes('FROM builds WHERE')) return { rows: [] };
      if (sql.includes('HAVING COALESCE')) return { rows: [] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('COUNT(*)::int AS total\n         FROM changed_functions')) return { rows: [{ total: 0 }] };
      throw new Error('unexpected query: ' + sql);
    });
    const res = await request(appWith(pool)).get('/risk/does-not-exist');
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('no_data');
    expect(res.body.overallCoverage).toBe(null);
  });
});
