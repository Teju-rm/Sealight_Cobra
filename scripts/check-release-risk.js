#!/usr/bin/env node

const REQUEST_TIMEOUT_MS = 10_000;

function evaluateRiskResponse(data) {
  if (!data || !Array.isArray(data.untestedChanges)) {
    return {
      shouldFail: true,
      invalidResponse: true,
      title: 'RELEASE RISK CHECK FAILED',
      message: 'Risk API response is missing the required untestedChanges array.',
      riskScore: data?.riskScore ?? 'n/a',
      verdict: data?.verdict ?? 'n/a',
      untestedChanges: []
    };
  }

  const riskScore = data.riskScore ?? 'n/a';
  const verdict = data.verdict;
  const untestedChanges = data.untestedChanges;
  const list = untestedChanges.map((change) =>
    `  ${change.file ?? '(unknown file)'} - ${change.function ?? '(unknown function)'} [${change.status ?? 'unknown status'}]`
  ).join('\n');

  // "no_data" means the API has no registered changes for this build.
  // That is NOT a verified pass, so it fails.
  if (verdict === 'no_data') {
    return {
      shouldFail: true,
      invalidResponse: false,
      title: 'NO DATA - NOT A VERIFIED PASS',
      message: 'The API has no registered changed functions for this build, so nothing was checked.\n  Make sure the Build Scanner and coverage ingest ran for this commit.',
      riskScore,
      verdict,
      untestedChanges
    };
  }

  // If the API sends a verdict, follow it (so configured thresholds apply).
  // Any verdict other than "pass" fails. Without a verdict, fall back to the old rule.
  const shouldFail = verdict === undefined
    ? untestedChanges.length > 0
    : verdict !== 'pass';

  let message = list;
  if (!list) {
    message = shouldFail
      ? `Verdict is "${verdict}" but no untested functions are listed (a threshold was probably not met).`
      : 'No untested changed code was reported.';
  }

  return {
    shouldFail,
    invalidResponse: false,
    title: shouldFail ? 'RELEASE RISK CHECK FAILED' : 'RELEASE RISK CHECK PASSED',
    message,
    riskScore,
    verdict: verdict ?? 'n/a',
    untestedChanges
  };
}

function fail(message) {
  console.error(`\n[FAIL] RELEASE RISK CHECK FAILED\n${message}\n`);
  console.error(`::error title=Quality Gate::${message.replace(/\r?\n/g, ' | ')}`);
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
    // This header lets the request through ngrok's free-tier warning page.
    response = await fetch(url, {
      signal: controller.signal,
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
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

  const line = '========================================';
  if (result.shouldFail) {
    console.error(`\n${line}`);
    console.error(`[FAIL] ${result.title}`);
    console.error(`Build: ${buildId}   Risk score: ${result.riskScore}   Verdict: ${result.verdict}`);
    console.error('Details:');
    console.error(result.message);
    console.error(`${line}\n`);
    console.error(`::error title=Quality Gate::${result.title} | ${result.message.replace(/\r?\n/g, ' | ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n${line}`);
  console.log(`[PASS] ${result.title}`);
  console.log(`Build: ${buildId}   Risk score: ${result.riskScore}   Verdict: ${result.verdict}`);
  console.log(result.message);
  console.log(`${line}\n`);
}

if (require.main === module) {
  main().catch((error) => fail(`Unexpected error while checking release risk: ${error.message}`));
}

module.exports = { evaluateRiskResponse };
