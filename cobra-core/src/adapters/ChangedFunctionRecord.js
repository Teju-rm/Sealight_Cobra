const STATUSES = new Set(["new", "modified", "unchanged", "deleted"]);

function validateBuildScan(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") return { valid: false, errors: ["payload must be an object"] };

  for (const field of ["buildId", "repo", "commitSha", "language"]) {
    if (typeof payload[field] !== "string" || !payload[field].length) {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  if (!Array.isArray(payload.changes)) {
    errors.push("changes must be an array");
  } else {
    payload.changes.forEach((entry, i) => {
      if (typeof entry.file !== "string") errors.push(`changes[${i}].file must be a string`);
      if (typeof entry.function !== "string") errors.push(`changes[${i}].function must be a string`);
      if (typeof entry.startLine !== "number") errors.push(`changes[${i}].startLine must be a number`);
      if (typeof entry.endLine !== "number") errors.push(`changes[${i}].endLine must be a number`);
      if (!STATUSES.has(entry.status)) errors.push(`changes[${i}].status must be one of ${[...STATUSES].join(", ")}`);
    });
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateBuildScan };
