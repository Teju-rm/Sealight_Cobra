// test/risk.test.js
const express = require('express');
const request = require('supertest');
const createRiskRouter = require('../src/routes/risk');

function appWithMockPool(queryImpl) {
  const app = express();
  const mockPool = { query: queryImpl };
  app.use(createRiskRouter(mockPool));
  return app;
}

describe('GET /risk/:buildId', () => {
  test('flags a function with hits = 0 as untested, and one with hits > 0 as tested', async () => {
    const queryImpl = jest.fn((sql, params) => {
      if (sql.includes('HAVING COALESCE')) {
        return Promise.resolve({
          rows: [{ file: 'OrderService.java', function: 'applyDiscount', status: 'modified' }],
        });
      }
      if (sql.includes('JOIN changed_functions')) {
        return Promise.resolve({
          rows: [{ test_id: 'test_checkout_flow_12', function: 'calculateTotal' }],
        });
      }
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ total: 2 }] });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const app = appWithMockPool(queryImpl);
    const res = await request(app).get('/risk/b-104');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      buildId: 'b-104',
      untestedChanges: [
        { file: 'OrderService.java', function: 'applyDiscount', status: 'modified' },
      ],
      testRecommendations: [
        { testId: 'test_checkout_flow_12', coversChangedFunctions: ['calculateTotal'] },
      ],
      riskScore: 0.5,
    });
  });

  test('returns riskScore 0 when the build has no changed functions', async () => {
    const queryImpl = jest.fn((sql) => {
      if (sql.includes('HAVING COALESCE')) return Promise.resolve({ rows: [] });
      if (sql.includes('JOIN changed_functions')) return Promise.resolve({ rows: [] });
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: 0 }] });
      throw new Error(`Unexpected query: ${sql}`);
    });

    const app = appWithMockPool(queryImpl);
    const res = await request(app).get('/risk/b-empty');

    expect(res.status).toBe(200);
    expect(res.body.riskScore).toBe(0);
    expect(res.body.untestedChanges).toEqual([]);
    expect(res.body.testRecommendations).toEqual([]);
  });

  test('a coverage_runs row with hits = 0 still counts as untested (not just a missing row)', async () => {
    const queryImpl = jest.fn((sql) => {
      if (sql.includes('HAVING COALESCE')) {
        return Promise.resolve({
          rows: [{ file: 'Foo.js', function: 'bar', status: 'new' }],
        });
      }
      if (sql.includes('JOIN changed_functions')) return Promise.resolve({ rows: [] });
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: 1 }] });
      throw new Error(`Unexpected query: ${sql}`);
    });

    const app = appWithMockPool(queryImpl);
    const res = await request(app).get('/risk/b-zero-hits');

    expect(res.body.untestedChanges).toEqual([
      { file: 'Foo.js', function: 'bar', status: 'new' },
    ]);
    expect(res.body.riskScore).toBe(1);
  });
});
