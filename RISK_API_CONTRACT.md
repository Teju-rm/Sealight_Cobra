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
