const fs = require("fs");
const path = require("path");
const { CoverageAdapter } = require("../CoverageAdapter");
const { offsetToLine } = require("./offsetToLine");
const { resolveLocalPath } = require("./resolveLocalPath");
const { functionLabel } = require("./functionLabel");

class JsAdapter extends CoverageAdapter {
  constructor({ projectRoot, publicDir = "public" }) {
    super();
    this.projectRoot = projectRoot;
    this.publicDir = publicDir;
    this._sourceCache = new Map();
  }

  parseNativeReport(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  toUCF(record, context = {}) {
    const buildId = context.buildId || record.buildVersion || "local";
    const testId = record.testDescription || record.testName;

    const coverage = [
      ...this._extractLayer(record.coverage?.browser, "frontend", record.siteOrigin),
      ...this._extractLayer(record.coverage?.backend, "backend", record.siteOrigin),
    ];

    return { buildId, testId, language: "javascript", coverage };
  }

  _extractLayer(rawScripts, layer, siteOrigin) {
    if (!Array.isArray(rawScripts)) return [];
    const entries = [];

    for (const script of rawScripts) {
      const relativeFile = resolveLocalPath({
        url: script.url,
        layer,
        projectRoot: this.projectRoot,
        publicDir: this.publicDir,
        siteOrigin,
      });
      if (!relativeFile) continue;

      const source = this._readSource(relativeFile);
      if (source == null) continue;

      (script.functions || []).forEach((fn, index) => {
        if (!fn.ranges || fn.ranges.length === 0) return;
        const startOffset = fn.ranges[0].startOffset;
        const endOffset = fn.ranges[fn.ranges.length - 1].endOffset;
        const hits = fn.ranges[0].count ?? 0;

        entries.push({
          file: relativeFile,
          function: functionLabel(fn, index),
          startLine: offsetToLine(source, startOffset),
          endLine: offsetToLine(source, endOffset),
          hits,
        });
      });
    }

    return entries;
  }

  _readSource(relativeFile) {
    if (this._sourceCache.has(relativeFile)) return this._sourceCache.get(relativeFile);
    const absolute = path.join(this.projectRoot, relativeFile);
    let source = null;
    try {
      source = fs.readFileSync(absolute, "utf8");
    } catch {
      source = null;
    }
    this._sourceCache.set(relativeFile, source);
    return source;
  }
}

module.exports = { JsAdapter };
