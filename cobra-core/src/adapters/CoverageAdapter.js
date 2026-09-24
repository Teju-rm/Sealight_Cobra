class CoverageAdapter {
  parseNativeReport(filePath) {
    throw new Error("parseNativeReport() not implemented");
  }

  toUCF(raw, context) {
    throw new Error("toUCF() not implemented");
  }

  async submit(payload, ingestUrl = process.env.INGEST_URL || "http://127.0.0.1:4000/ingest") {
    const res = await fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ingestion API rejected payload (${res.status}): ${text}`);
    }
    return res.json();
  }
}

function validateUCF(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") return { valid: false, errors: ["payload must be an object"] };

  for (const field of ["buildId", "testId", "language"]) {
    if (typeof payload[field] !== "string" || !payload[field].length) {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  if (!Array.isArray(payload.coverage)) {
    errors.push("coverage must be an array");
  } else {
    payload.coverage.forEach((entry, i) => {
      if (typeof entry.file !== "string") errors.push(`coverage[${i}].file must be a string`);
      if (typeof entry.function !== "string") errors.push(`coverage[${i}].function must be a string`);
      if (typeof entry.startLine !== "number") errors.push(`coverage[${i}].startLine must be a number`);
      if (typeof entry.endLine !== "number") errors.push(`coverage[${i}].endLine must be a number`);
      if (typeof entry.hits !== "number") errors.push(`coverage[${i}].hits must be a number`);
    });
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { CoverageAdapter, validateUCF };
