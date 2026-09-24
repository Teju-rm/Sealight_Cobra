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

- **`untestedChanges` — required:** Must be an array. A missing value or non-array makes the checker fail. An empty array passes the release-risk check; a non-empty array fails it.
- **`riskScore` — optional:** Used only for display. If absent or `null`, the checker displays `n/a`. The checker does not validate its type or calculate a threshold from it.
- **`file`, `function`, `status` — optional per entry:** Used only when displaying each item in a non-empty `untestedChanges` array. Missing or `null` values display as `(unknown file)`, `(unknown function)`, or `unknown status`, respectively. The checker does not validate entry types or require these properties.
- Any other response properties are ignored by this script.

The response must also be valid JSON, and the HTTP request must succeed with an OK status. The checker fails on an unreachable API, a non-OK response, invalid JSON, or a missing/non-array `untestedChanges` field.

## Endpoint ownership and availability

As of this repository state, `GET /risk/:buildId` is **not implemented in this repository**. It is owned by the Mapping Engine (Phase 4) and is a hard dependency for the Quality Gate to function end-to-end.

The workflow currently defaults `INGESTION_API_HOST` to [http://localhost:4000](http://localhost:4000). Once the real API is deployed, set `INGESTION_API_HOST` as a repository Actions Variable to its host. The workflow also requires `BUILD_ID` when running the checker.
