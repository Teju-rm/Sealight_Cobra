const fs = require('fs');
const path = require('path');
const { test: base } = require('@playwright/test');

const baseUrl = process.env.COVERAGE_BASE_URL || 'http://127.0.0.1:3100';
const artifactDirectory = process.env.COVERAGE_TEST_ARTIFACTS || path.join(__dirname, '..', 'coverage-artifacts', 'playwright-tests');

function browserFiles(rawCoverage) {
  return rawCoverage
    .filter((script) => script.url && new URL(script.url).origin === new URL(baseUrl).origin)
    .map((script) => {
      const functions = script.functions.map((fn, index) => ({
        name: fn.functionName || (fn.ranges.some((range) => range.startOffset === 0) ? 'Top-level script initialization' : `Anonymous callback ${index}`),
        covered: fn.ranges.some((range) => range.count > 0),
        location: String(fn.ranges[0]?.startOffset ?? index),
      }));
      return { layer: 'frontend', url: script.url, functions, totalFunctions: functions.length, coveredFunctions: functions.filter((fn) => fn.covered).length };
    });
}

function backendFiles(rawCoverage) {
  const projectRoot = path.resolve(__dirname, '..').replace(/\\/g, '/').toLowerCase();
  return rawCoverage.filter((script) => {
    const normalizedUrl = String(script.url || '').replace(/\\/g, '/').toLowerCase();
    return normalizedUrl.includes(projectRoot) && !normalizedUrl.includes('/node_modules/');
  }).map((script) => {
    const functions = script.functions.map((fn, index) => ({
      name: fn.functionName || `Anonymous callback ${index}`,
      covered: fn.ranges.some((range) => range.count > 0),
      ranges: fn.ranges,
      location: String(fn.ranges[0]?.startOffset ?? index),
    }));
    return { layer: 'backend', url: script.url, functions, totalFunctions: functions.length, coveredFunctions: functions.filter((fn) => fn.covered).length };
  });
}

function safeName(value) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 100) || 'test';
}

const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    const startedAt = new Date().toISOString();
    let rawBrowserCoverage = [];
    let rawBackendCoverage = [];
    try {
      await use(page);
    } finally {
      try {
        rawBrowserCoverage = (await cdp.send('Profiler.takePreciseCoverage')).result || [];
        await cdp.send('Profiler.stopPreciseCoverage');
        await cdp.send('Profiler.disable');
      } finally {
        const response = await fetch(`${baseUrl}/__coverage__/snapshot`, { method: 'POST' });
        if (!response.ok) throw new Error(`Backend coverage snapshot failed with ${response.status}`);
        rawBackendCoverage = await response.json();
        fs.mkdirSync(artifactDirectory, { recursive: true });
        const files = [...browserFiles(rawBrowserCoverage), ...backendFiles(rawBackendCoverage)];
        const record = {
          testName: testInfo.title,
          testDescription: testInfo.titlePath.join(' > '),
          testSuite: 'CI',
          environment: process.env.COVERAGE_ENVIRONMENT || 'Development',
          buildVersion: process.env.BUILD_VERSION || 'local',
          siteOrigin: process.env.COVERAGE_HISTORY_ORIGIN || new URL(baseUrl).origin,
          startedAt,
          stoppedAt: new Date().toISOString(),
          status: testInfo.status,
          coverage: { browser: rawBrowserCoverage, backend: rawBackendCoverage },
          files,
        };
        const filename = `${String(testInfo.workerIndex).padStart(2, '0')}-${safeName(testInfo.title)}-${testInfo.retry}.json`;
        fs.writeFileSync(path.join(artifactDirectory, filename), JSON.stringify(record, null, 2));
      }
    }
  },
});

module.exports = { test, expect: require('@playwright/test').expect };
