# Risk API contract

This document describes the response consumed by `scripts/check-release-risk.js` when it requests `GET /risk/:buildId`.

## Example response

```json
{
  "riskScore": 0,
  "untestedChanges": []
}
```

When untested changes exist, the checker prints their `file`, `function`, and `status` values:

```json
{
  "riskScore": 42,
  "untestedChanges": [
    {
      "file": "src/payment.js",
      "function": "calculatePremium",
      "status": "untested"
    }
  ]
}
```

## Fields used by the checker

- **`untestedChanges` — required:** Must be an array. A missing value or non-array makes the checker fail. The checker uses `verdict` when present; without it, an empty array passes and a non-empty array fails.
- **`riskScore` — optional:** Used only for display. If absent or `null`, the checker displays `n/a`. The checker does not validate its type or calculate a threshold from it.
- **`verdict` — optional:** `pass` passes, `fail` and `no_data` fail. COBRA returns `no_data` when there are no changed functions or no coverage rows for the build.
- **`file`, `function`, `status` — optional per entry:** Used only when displaying each item in a non-empty `untestedChanges` array. Missing or `null` values display as `(unknown file)`, `(unknown function)`, or `unknown status`, respectively. The checker does not validate entry types or require these properties.
- Any other response properties are ignored by this script.

The response must also be valid JSON, and the HTTP request must succeed with an OK status. The checker fails on an unreachable API, a non-OK response, invalid JSON, or a missing/non-array `untestedChanges` field.

## Coverage execution ingestion

`POST /ingest` accepts the existing `buildId`, `testId`, `language`, and `coverage` fields, plus optional `execution` metadata:

```json
{
  "buildId": "build-123",
  "testId": "CI > quote submission",
  "language": "javascript",
  "execution": {
    "id": "execution-unique-to-this-attempt",
    "suite": "CI",
    "status": "passed",
    "durationMs": 1250,
    "executedAt": "2026-10-07T12:30:00.000Z",
    "environment": "CI"
  },
  "coverage": []
}
```

`testId` identifies the logical test; `execution.id` identifies one attempt and may differ across builds or retries. When execution metadata is supplied, its fields are validated and the execution plus its coverage rows are persisted transactionally. Legacy payloads may omit `execution`; their coverage rows have no execution link. Apply `migrations/006_test_executions.sql` before sending execution metadata.

## Test execution runs

`POST /test-runs` explicitly creates a run in `running` state. It accepts `id`, `buildId`, `suite`, and `environment`, with optional `startedAt`; the run branch is copied from its build. `PATCH /test-runs/:runId` accepts a lifecycle `status` (`running`, `completed`, `failed`, or `cancelled`) and optional `completedAt`. A terminal state receives a completion timestamp if one is not supplied; terminal runs cannot transition to another status. Only explicitly completed runs can later serve as full-suite baselines.

An execution may optionally include `execution.runId`, for example:

```json
{
  "buildId": "build-123",
  "testId": "CI > quote submission",
  "language": "javascript",
  "execution": {
    "id": "execution-123",
    "runId": "run-456",
    "suite": "unit",
    "status": "passed",
    "durationMs": 1250,
    "executedAt": "2026-10-07T12:30:00.000Z",
    "environment": "CI"
  },
  "coverage": []
}
```

When present, ingestion requires that the run exists and matches the execution's build, suite, and environment. Executions without `runId` remain supported, and existing coverage payloads without execution metadata are unchanged. Apply `migrations/007_test_execution_runs.sql` before creating runs or sending run-associated executions.

## Test time-savings estimate

`GET /test-selection/:buildId/savings` estimates potential execution time saved by running the historically selected tests instead of the baseline suite. It requires an explicitly `completed` run from an earlier build in the same repository. The newest completed run with eligible executions on the target branch is preferred; if none exists, the newest eligible completed run across branches is used. If completed runs exist but none has eligible executions, the endpoint reports insufficient data.

The estimate uses only executions linked to that baseline run. Passed, failed, and timed-out attempts with valid durations count; skipped and interrupted attempts are excluded and reported. Repeated attempts for a logical test are represented by their median duration. If the baseline has no eligible executions, has zero total duration, or a selected test is missing an eligible duration, the endpoint returns `status: "insufficient_data"` and null savings values.

This is an estimated sum of test execution durations, not guaranteed wall-clock savings; it does not model parallel execution or runner overhead. The endpoint is read-only and does not alter run, execution, or coverage data.

## Test optimization result

`GET /test-selection/:buildId/optimization` combines the historical test selection with baseline test durations, unselected eligible baseline tests, uncovered changed functions, and estimated potential time savings. It uses the same repository, historical cutoff, positive-hit function matching, and same-branch preference/cross-branch fallback as `GET /test-selection/:buildId`. Deleted functions are never used to select tests and are reported among uncovered changes.

The baseline is selected using the same rules as the savings endpoint: the newest eligible explicitly completed run from an earlier build in the same repository, preferring the target branch and falling back across branches. Only `passed`, `failed`, and `timedOut` executions with valid durations count; `skipped` and `interrupted` executions are excluded and reported. Repeated attempts are represented by the median duration per logical test. Selected and unselected tests are disjoint; unselected tests are eligible baseline tests not selected by historical changed-function coverage.

Missing selected-test durations, no completed baseline, no eligible execution data, invalid aggregate duration, no changed functions, or no selected tests produce `status: "insufficient_data"` with a reason and null duration totals. This optimization is an estimate based on summed test durations, not guaranteed wall-clock savings; it does not model parallel execution or runner overhead. The endpoint is read-only.

## Quality Risks view

`GET /risk/:buildId?stage=all&search=<text>` also returns build context and file-level risk groups for the dashboard. `fileGroups` contains each matching file's untested-method count (`qualityRisks`), high-priority count (`highPriority`, untested new or modified methods), contributor names and initials, and expandable method names/line numbers. Groups sort by risk count descending. `search` matches file and method names but does not change the full-build `untestedChanges`, counts, risk score, or gate verdict used by CI. Named stage filtering is not available until stage data is persisted; values other than `all` return HTTP 400.

Contributor names come from `git log -L` attribution recorded by the Build Scanner in `changed_functions.author`. New and modified functions are attributed during scanning; deleted functions and historical scans without author data may have `author: null`. Apply `migrations/004_changed_function_author.sql` before starting the updated API.

The response also includes `build` (app, the stored branch or `null` when unavailable, timestamp, and previous recorded build reference), `qualityRiskCount`, `highPriorityCount`, and `dataAvailability`. Risk evaluation uses the build's branch-specific settings when available, falling back to the global `unassigned` settings scope when no branch-specific settings apply. Builds without branch metadata use that global scope.

## Coverage settings

`GET /apps/:app/branches/:branch/gate-settings` reads the latest saved settings. `PUT` on the same path creates a new settings version using:

```json
{
  "settings": {
    "codeChangesCoverage": { "enabled": true, "stage": "all", "comparator": ">=", "threshold": 50 },
    "overallCoverage": { "enabled": true, "stage": "all", "comparator": ">=", "threshold": 80 },
    "failedTests": { "enabled": false, "stage": "all", "comparator": "=", "threshold": 0 }
  }
}
```

Thresholds must be from 0 to 100. All enabled conditions must pass. A setting takes effect only for builds recorded after it was saved; past build results use the settings version effective at that build's timestamp. If no conditions are enabled, existing quality-gate rules and fallback behavior remain in effect.

The overall-coverage threshold is app-wide across recorded coverage, matching the existing `/risk/:buildId` metric; the dashboard's Overall Coverage cell remains scoped to that build. Build records persist branch names when provided; older builds without branch metadata use the `unassigned` settings scope. Named test stages and failed-test totals are not stored, so only “All test stages” is selectable. An enabled condition that needs unavailable measurements fails closed; it is not treated as passing. Apply `migrations/003_quality_gate_settings.sql` and `migrations/005_build_branch.sql` before starting the updated API. `GET /risk/:buildId` returns the resulting verdict consumed by `scripts/check-release-risk.js`.
