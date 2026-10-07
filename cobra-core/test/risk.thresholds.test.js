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

function coverageSettings(threshold) {
  return {
    codeChangesCoverage: { enabled: true, stage: 'all', comparator: '>=', threshold },
    overallCoverage: { enabled: false, stage: 'all', comparator: '>=', threshold: 80 },
    failedTests: { enabled: false, stage: 'all', comparator: '=', threshold: 0 },
  };
}

function branchRiskApp(branch, settingsByBranch) {
  const build = {
    repo: 'demo-repo',
    branch,
    created_at: '2026-10-07T00:00:00.000Z',
  };
  const pool = mockPool((sql, values) => {
    if (sql.includes('FROM builds b')) return { rows: [build] };
    if (sql.includes('HAVING COALESCE')) {
      return { rows: [{ file: 'a.js', function: 'untested', status: 'modified' }] };
    }
    if (sql.includes('JOIN changed_functions')) return { rows: [] };
    if (sql.includes('AS total') && sql.includes('FROM changed_functions')) {
      return { rows: [{ total: 2, coverage_run_count: 2 }] };
    }
    if (sql.includes('per_function')) return { rows: [{ total: 4, covered: 3 }] };
    if (sql.includes('FROM quality_gate_settings')) {
      const selectedSettings = settingsByBranch[values[1]] || settingsByBranch[''];
      return { rows: selectedSettings ? [{ settings: selectedSettings }] : [] };
    }
    if (sql.includes('quality_gate_rules')) return { rows: [] };
    throw new Error('unexpected query: ' + sql);
  });
  return { app: appWith(pool), pool };
}

describe('GET /risk/:buildId - thresholds, overallCoverage, no_data', () => {
  test('zero changed_functions -> verdict no_data, even with rules configured', async () => {
    const pool = mockPool((sql) => {
      if (sql.includes('FROM builds b')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('AS total') && sql.includes('FROM changed_functions')) return { rows: [{ total: 0, coverage_run_count: 0 }] };
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
      if (sql.includes('FROM builds b')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [] };
      if (sql.includes('JOIN changed_functions')) return { rows: [{ test_id: 't1', function: 'f1' }] };
      if (sql.includes('AS total') && sql.includes('FROM changed_functions')) return { rows: [{ total: 2, coverage_run_count: 2 }] };
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
      if (sql.includes('FROM builds b')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [{ file: 'a.js', function: 'f', status: 'modified' }] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('AS total') && sql.includes('FROM changed_functions')) return { rows: [{ total: 1, coverage_run_count: 1 }] };
      if (sql.includes('per_function')) return { rows: [{ total: 2, covered: 1 }] };
      if (sql.includes('quality_gate_rules')) return { rows: [] };
      throw new Error('unexpected query: ' + sql);
    });
    const res = await request(appWith(pool)).get('/risk/bad-build');
    expect(res.body.verdict).toBe('fail');
  });

  test('rules configured, all pass -> verdict pass even with some untested (threshold-based, not binary)', async () => {
    const pool = mockPool((sql) => {
      if (sql.includes('FROM builds b')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [{ file: 'a.js', function: 'f', status: 'modified' }] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('AS total') && sql.includes('FROM changed_functions')) return { rows: [{ total: 4, coverage_run_count: 4 }] };
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
      if (sql.includes('FROM builds b')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [{ file: 'a.js', function: 'f', status: 'modified' }] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('AS total') && sql.includes('FROM changed_functions')) return { rows: [{ total: 4, coverage_run_count: 4 }] };
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
      if (sql.includes('FROM builds b')) return { rows: [{ repo: 'demo-repo' }] };
      if (sql.includes('HAVING COALESCE')) return { rows: [] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('AS total') && sql.includes('FROM changed_functions')) return { rows: [{ total: 2, coverage_run_count: 2 }] };
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
      if (sql.includes('FROM builds b')) return { rows: [] };
      if (sql.includes('HAVING COALESCE')) return { rows: [] };
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('AS total') && sql.includes('FROM changed_functions')) return { rows: [{ total: 0, coverage_run_count: 0 }] };
      throw new Error('unexpected query: ' + sql);
    });
    const res = await request(appWith(pool)).get('/risk/does-not-exist');
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('no_data');
    expect(res.body.overallCoverage).toBe(null);
  });

  test('enabled app settings determine the risk verdict used by the release gate', async () => {
    const settings = {
      codeChangesCoverage: { enabled: true, stage: 'all', comparator: '>=', threshold: 50 },
      overallCoverage: { enabled: true, stage: 'all', comparator: '>=', threshold: 75 },
      failedTests: { enabled: false, stage: 'all', comparator: '=', threshold: 0 },
    };
    const pool = mockPool((sql) => {
      if (sql.includes('FROM builds b')) {
        return { rows: [{ repo: 'demo-repo', created_at: '2026-10-07T00:00:00.000Z' }] };
      }
      if (sql.includes('HAVING COALESCE')) {
        return { rows: [{ file: 'a.js', function: 'f', status: 'modified' }] };
      }
      if (sql.includes('JOIN changed_functions')) return { rows: [] };
      if (sql.includes('AS total') && sql.includes('FROM changed_functions')) {
        return { rows: [{ total: 4, coverage_run_count: 4 }] };
      }
      if (sql.includes('per_function')) return { rows: [{ total: 10, covered: 8 }] };
      if (sql.includes('FROM quality_gate_settings')) return { rows: [{ settings }] };
      throw new Error('unexpected query: ' + sql);
    });
    const res = await request(appWith(pool)).get('/risk/settings-build');
    expect(res.body.verdict).toBe('pass');
    expect(res.body.overallCoverage).toBe(80);
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('FROM quality_gate_rules'),
      expect.anything()
    );
  });

  test('build on branch A uses branch A settings and returns its branch', async () => {
    const branchASettings = coverageSettings(40);
    const { app, pool } = branchRiskApp('branch-a', {
      'branch-a': branchASettings,
      '': coverageSettings(60),
    });

    const res = await request(app).get('/risk/branch-a-build');
    const settingsCall = pool.query.mock.calls.find(([sql]) => sql.includes('FROM quality_gate_settings'));

    expect(res.body.verdict).toBe('pass');
    expect(res.body.build.branch).toBe('branch-a');
    expect(res.body.dataAvailability.branch).toBe(true);
    expect(settingsCall[0]).toContain("branch = $2 OR branch = ''");
    expect(settingsCall[1]).toEqual(['demo-repo', 'branch-a', '2026-10-07T00:00:00.000Z']);
  });

  test('build on branch B uses branch B settings', async () => {
    const { app, pool } = branchRiskApp('branch-b', {
      'branch-b': coverageSettings(60),
      '': coverageSettings(40),
    });

    const res = await request(app).get('/risk/branch-b-build');
    const settingsCall = pool.query.mock.calls.find(([sql]) => sql.includes('FROM quality_gate_settings'));

    expect(res.body.verdict).toBe('fail');
    expect(res.body.build.branch).toBe('branch-b');
    expect(settingsCall[1]).toEqual(['demo-repo', 'branch-b', '2026-10-07T00:00:00.000Z']);
  });

  test('identical build metrics produce branch-dependent gate results', async () => {
    const settingsByBranch = {
      'branch-a': coverageSettings(40),
      'branch-b': coverageSettings(60),
    };
    const branchA = branchRiskApp('branch-a', settingsByBranch);
    const branchB = branchRiskApp('branch-b', settingsByBranch);

    const [branchAResponse, branchBResponse] = await Promise.all([
      request(branchA.app).get('/risk/same-metrics-a'),
      request(branchB.app).get('/risk/same-metrics-b'),
    ]);

    expect(branchAResponse.body.riskScore).toBe(branchBResponse.body.riskScore);
    expect(branchAResponse.body.overallCoverage).toBe(branchBResponse.body.overallCoverage);
    expect(branchAResponse.body.verdict).toBe('pass');
    expect(branchBResponse.body.verdict).toBe('fail');
  });

  test('build without a branch uses global settings and preserves unassigned behavior', async () => {
    const { app, pool } = branchRiskApp(null, { '': coverageSettings(40) });

    const res = await request(app).get('/risk/unassigned-build');
    const settingsCall = pool.query.mock.calls.find(([sql]) => sql.includes('FROM quality_gate_settings'));

    expect(res.body.verdict).toBe('pass');
    expect(res.body.build.branch).toBe(null);
    expect(res.body.dataAvailability.branch).toBe(false);
    expect(settingsCall[1]).toEqual(['demo-repo', '', '2026-10-07T00:00:00.000Z']);
  });
});
