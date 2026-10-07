const COMPARATORS = {
  ">=": (actual, threshold) => actual >= threshold,
  "<=": (actual, threshold) => actual <= threshold,
  ">": (actual, threshold) => actual > threshold,
  "<": (actual, threshold) => actual < threshold,
  "=": (actual, threshold) => actual === threshold,
};

const RULES = {
  codeChangesCoverage: { metric: "code_changes_coverage", defaultThreshold: 50, comparator: ">=" },
  overallCoverage: { metric: "overall_coverage", defaultThreshold: 80, comparator: ">=" },
  failedTests: { metric: "failed_tests", defaultThreshold: 0, comparator: "=" },
};

function defaultGateSettings() {
  return Object.fromEntries(
    Object.entries(RULES).map(([key, rule]) => [
      key,
      { enabled: false, stage: "all", comparator: rule.comparator, threshold: rule.defaultThreshold },
    ])
  );
}

function validateGateSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "settings must be an object";
  }

  for (const [key, rule] of Object.entries(RULES)) {
    const setting = value[key];
    if (!setting || typeof setting !== "object" || Array.isArray(setting)) {
      return `settings.${key} is required`;
    }
    if (typeof setting.enabled !== "boolean") {
      return `settings.${key}.enabled must be a boolean`;
    }
    if (setting.stage !== "all") {
      return `settings.${key}.stage must be "all"; named test stages are not stored yet`;
    }
    if (!Object.hasOwn(COMPARATORS, setting.comparator)) {
      return `settings.${key}.comparator must be one of ${Object.keys(COMPARATORS).join(", ")}`;
    }
    if (!Number.isFinite(setting.threshold) || setting.threshold < 0 || setting.threshold > 100) {
      return `settings.${key}.threshold must be a number from 0 to 100`;
    }
  }

  return null;
}

function hasEnabledSettings(settings) {
  return Object.keys(RULES).some((key) => settings?.[key]?.enabled === true);
}

function evaluateGateSettings({ settings, metrics, totalChanged, coverageRunCount }) {
  if (!hasEnabledSettings(settings)) return null;
  if (totalChanged === 0 || coverageRunCount === 0) {
    return { status: "no_data", failedConditions: [], unavailableConditions: [] };
  }

  const failedConditions = [];
  const unavailableConditions = [];
  for (const [key, rule] of Object.entries(RULES)) {
    const setting = settings[key];
    if (!setting?.enabled) continue;

    const actual = metrics[rule.metric];
    if (actual === null || actual === undefined || !Number.isFinite(Number(actual))) {
      unavailableConditions.push(key);
    } else if (!COMPARATORS[setting.comparator](Number(actual), Number(setting.threshold))) {
      failedConditions.push(key);
    }
  }

  return {
    status: failedConditions.length || unavailableConditions.length ? "failed" : "passed",
    failedConditions,
    unavailableConditions,
  };
}

module.exports = {
  defaultGateSettings,
  evaluateGateSettings,
  hasEnabledSettings,
  validateGateSettings,
};
