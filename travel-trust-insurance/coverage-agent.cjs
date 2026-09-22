const inspector = require('inspector');

let session;
let started = false;

function post(method, params = {}) {
  return new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
  });
}

async function startCoverageAgent() {
  if (started || process.env.COVERAGE_AGENT !== '1') return;
  session = new inspector.Session();
  session.connect();
  await post('Profiler.enable');
  await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  started = true;
}

async function enableCoverageAgent() {
  if (!started) {
    session = new inspector.Session();
    session.connect();
    await post('Profiler.enable');
    started = true;
  }
  await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}

async function takeCoverageSnapshot() {
  if (!started) return [];
  const result = await post('Profiler.takePreciseCoverage');
  await post('Profiler.stopPreciseCoverage');
  await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  return result.result || [];
}

module.exports = { startCoverageAgent, enableCoverageAgent, takeCoverageSnapshot };
