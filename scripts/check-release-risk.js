#!/usr/bin/env node

const buildId = process.env.BUILD_ID;
const apiHost = process.env.INGESTION_API_HOST;

function fail(message) {
  console.error(`\n❌ RELEASE RISK CHECK FAILED\n${message}\n`);
  process.exit(1);
}

if (!buildId) fail('Missing required environment variable: BUILD_ID');
if (!apiHost) fail('Missing required environment variable: INGESTION_API_HOST');

async function main() {
  const url = `${apiHost.replace(/\/+$/, '')}/risk/${encodeURIComponent(buildId)}`;
  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    fail(`Could not reach the risk API at ${url}: ${error.message}`);
  }

  if (!response.ok) {
    fail(`Risk API returned HTTP ${response.status} ${response.statusText} for ${url}`);
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    fail(`Risk API returned invalid JSON: ${error.message}`);
  }

  if (!result || !Array.isArray(result.untestedChanges)) {
    fail('Risk API response is missing the required untestedChanges array.');
  }

  const riskScore = result.riskScore ?? 'not provided';
  if (result.untestedChanges.length > 0) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ RELEASE RISK CHECK FAILED');
    console.error(`Build: ${buildId}   Risk score: ${riskScore}`);
    console.error('Untested changed code:');
    for (const change of result.untestedChanges) {
      console.error(`  • ${change.file ?? '(unknown file)'} — ${change.function ?? '(unknown function)'} [${change.status ?? 'unknown status'}]`);
    }
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ RELEASE RISK CHECK PASSED');
  console.log(`Build: ${buildId}   Risk score: ${riskScore}`);
  console.log('No untested changed code was reported.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((error) => fail(`Unexpected error while checking release risk: ${error.message}`));
