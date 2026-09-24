#!/usr/bin/env node

const REQUEST_TIMEOUT_MS = 10_000;

function evaluateRiskResponse(data) {
  if (!data || !Array.isArray(data.untestedChanges)) {
    return {
      shouldFail: true,
      invalidResponse: true,
      message: 'Risk API response is missing the required untestedChanges array.',
      riskScore: data?.riskScore ?? 'n/a',
      untestedChanges: []
    };
  }

  const riskScore = data.riskScore ?? 'n/a';
  const untestedChanges = data.untestedChanges;
  const message = untestedChanges.length > 0
    ? untestedChanges.map((change) =>
      `  ${change.file ?? '(unknown file)'} — ${change.function ?? '(unknown function)'} [${change.status ?? 'unknown status'}]`
    ).join('\n')
    : 'No untested changed code was reported.';

  return {
    shouldFail: untestedChanges.length > 0,
    invalidResponse: false,
    message,
    riskScore,
    untestedChanges
  };
}

function fail(message) {
  console.error(`\n❌ RELEASE RISK CHECK FAILED\n${message}\n`);
  process.exitCode = 1;
}

async function main() {
  const buildId = process.env.BUILD_ID;
  const apiHost = process.env.INGESTION_API_HOST;

  if (!buildId) {
    fail('Missing required environment variable: BUILD_ID');
    return;
  }
  if (!apiHost) {
    fail('Missing required environment variable: INGESTION_API_HOST');
    return;
  }

  const url = `${apiHost.replace(/\/+$/, '')}/risk/${encodeURIComponent(buildId)}`;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let response;
  let data;
  let parsingResponse = false;
  try {
    response = await fetch(url, { signal: controller.signal });
    if (response.ok) {
      parsingResponse = true;
      data = await response.json();
    }
  } catch (error) {
    if (timedOut) {
      fail(`Request to Ingestion API timed out after ${REQUEST_TIMEOUT_MS}ms`);
    } else if (parsingResponse) {
      fail(`Risk API returned invalid JSON: ${error.message}`);
    } else {
      fail(`Could not reach the risk API at ${url}: ${error.message}`);
    }
    return;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    fail(`Risk API returned HTTP ${response.status} ${response.statusText} for ${url}`);
    return;
  }

  const result = evaluateRiskResponse(data);
  if (result.invalidResponse) {
    fail(result.message);
    return;
  }

  if (result.shouldFail) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ RELEASE RISK CHECK FAILED');
    console.error(`Build: ${buildId}   Risk score: ${result.riskScore}`);
    console.error('Untested changed code:');
    console.error(result.message);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ RELEASE RISK CHECK PASSED');
  console.log(`Build: ${buildId}   Risk score: ${result.riskScore}`);
  console.log(result.message);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

if (require.main === module) {
  main().catch((error) => fail(`Unexpected error while checking release risk: ${error.message}`));
}

module.exports = { evaluateRiskResponse };
