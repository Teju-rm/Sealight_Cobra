function functionLabel(fn, index) {
  if (fn.functionName) return fn.functionName;
  const isTopLevel = (fn.ranges || []).some((r) => r.startOffset === 0);
  return isTopLevel ? "Top-level script initialization" : `Anonymous callback ${index}`;
}

module.exports = { functionLabel };
