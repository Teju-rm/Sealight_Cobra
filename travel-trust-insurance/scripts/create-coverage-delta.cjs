const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { allFunctions, createInventory, inventorySource } = require('./coverage-inventory.cjs');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'coverage-artifacts');
const report = JSON.parse(fs.readFileSync(path.join(artifacts, 'ci-coverage.json'), 'utf8'));
const baselinePath = process.env.COVERAGE_BASELINE_PATH || path.join(artifacts, 'coverage-baseline.json');
const updateBaseline = process.argv.includes('--update-baseline');
// A git diff is used by CI when Git is available; local runs use the snapshot below.
function baseline() {
  if (fs.existsSync(baselinePath)) return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  try {
    const ref = process.env.BASE_REF || 'HEAD~1'; const files = {};
    const changedFiles = execFileSync('git', ['diff', '--name-only', ref, 'HEAD', '--', 'travel-trust-insurance'], { cwd: path.resolve(root, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/).filter(Boolean);
    const names = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', 'travel-trust-insurance'], { cwd: path.resolve(root, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/).filter(Boolean);
    if (changedFiles.length) console.log(`Git baseline includes ${changedFiles.length} changed path(s).`);
    names.filter((file) => /\.(?:js|cjs|mjs)$/.test(file)).forEach((file) => { const relative = file.replace(/^travel-trust-insurance\//, ''); const source = execFileSync('git', ['show', `${ref}:${file}`], { cwd: path.resolve(root, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); files[relative] = inventorySource(relative, source); });
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), files };
  } catch { return { schemaVersion: 1, generatedAt: new Date().toISOString(), files: {} }; }
}
function unique(functions) { const groups = new Map(); functions.forEach((fn) => groups.set(fn.logicalId, [...(groups.get(fn.logicalId) || []), fn])); return new Map([...groups].filter(([, entries]) => entries.length === 1).map(([id, entries]) => [id, entries[0]])); }
function isCovered(fn) {
  if (fn.file.startsWith('public/')) { const expected = `/${fn.file.replace(/^public\//, '')}`; const file = (report.files || []).find((entry) => { try { return new URL(entry.url).pathname === expected; } catch { return false; } }); return Boolean(file?.functions.some((item) => item.covered && Number(item.location) >= fn.start && Number(item.location) <= fn.end)); }
  return (report.backendCoverage || []).some((script) => String(script.url || '').replace(/\\/g, '/').endsWith(`/${fn.file}`) && script.functions.some((item) => item.ranges?.some((range) => range.count > 0 && range.startOffset <= fn.start && range.endOffset >= fn.end)));
}
fs.mkdirSync(artifacts, { recursive: true });
const current = createInventory(root); const previous = allFunctions(baseline()); const latest = allFunctions(current);
const priorIds = new Map(previous.map((fn) => [fn.id, fn])); const latestIds = new Map(latest.map((fn) => [fn.id, fn])); const priorLogical = unique(previous); const latestLogical = unique(latest);
const added = latest.filter((fn) => !priorIds.has(fn.id) && !priorLogical.has(fn.logicalId)); const modified = latest.filter((fn) => priorLogical.has(fn.logicalId) && (priorLogical.get(fn.logicalId).id !== fn.id || priorLogical.get(fn.logicalId).hash !== fn.hash)); const removed = previous.filter((fn) => !latestIds.has(fn.id) && !latestLogical.has(fn.logicalId));
const changed = [...added, ...modified.map((fn) => ({ ...fn, changeType: 'modified' }))].map((fn) => ({ ...fn, covered: isCovered(fn) }));
const delta = { schemaVersion: 2, baselineRef: process.env.BASE_REF || 'saved baseline', comparisonRef: process.env.GITHUB_SHA || 'local', inventory: { baselineFunctions: previous.length, currentFunctions: latest.length }, functionsAdded: added, functionsModified: modified, functionsRemoved: removed, newFunctionsExecuted: changed.filter((fn) => fn.covered), newFunctionsUntested: changed.filter((fn) => !fn.covered), report };
fs.writeFileSync(path.join(artifacts, 'coverage-delta.json'), JSON.stringify(delta, null, 2));
// A baseline represents only the next testing cycle. Once every change in
// this cycle has been covered, promote the current inventory automatically;
// subsequent reports therefore contain only newly introduced work.
const cycleComplete = changed.length > 0 && delta.newFunctionsUntested.length === 0;
if (updateBaseline || cycleComplete) fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2));
const bridgeUrl = (process.env.COVERAGE_BRIDGE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const environment = report.environment || process.env.COVERAGE_ENVIRONMENT || process.env.DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV || 'Development';
fetch(`${bridgeUrl}/delta-analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteOrigin: report.siteOrigin, environment, buildVersion: report.buildVersion, baselineRef: delta.baselineRef, delta }) })
  .then((response) => { if (!response.ok) throw new Error(`Bridge server returned ${response.status}`); console.log('Coverage Delta uploaded to the dashboard.'); })
  .catch((error) => console.warn(`Coverage Delta saved locally but was not uploaded: ${error.message}`));
const pendingAdded = added.filter((fn) => !delta.newFunctionsExecuted.some((covered) => covered.id === fn.id));
const pendingModified = modified.filter((fn) => !delta.newFunctionsExecuted.some((covered) => covered.id === fn.id));
console.log(`Coverage Delta: ${pendingAdded.length} added pending, ${pendingModified.length} modified pending; ${delta.newFunctionsExecuted.length} executed; ${delta.newFunctionsUntested.length} untested.${cycleComplete ? ' Testing cycle complete; baseline advanced.' : ''}`);
