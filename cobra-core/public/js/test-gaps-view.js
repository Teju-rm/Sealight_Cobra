(function exposeTestGapsView(root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  if (root) root.CobraTestGapsView = view;
})(typeof globalThis === 'object' ? globalThis : this, function createTestGapsView() {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function displayReason(reason) {
    if (reason === 'no_historical_coverage') return 'No matching historical coverage found';
    return reason ? escapeHtml(reason) : '—';
  }

  function render(data) {
    const summary = data.summary || {};
    const gaps = Array.isArray(data.gaps) ? data.gaps : [];
    const strategyLabels = {
      same_branch: 'Same branch',
      cross_branch_fallback: 'Cross-branch fallback',
    };
    const branchStrategy = strategyLabels[data.branchStrategy] || data.branchStrategy;
    const metrics = [
      ['Changed Functions', summary.changedFunctions],
      ['Covered Changed Functions', summary.coveredChangedFunctions],
      ['Historical Gaps', summary.gaps],
      ['Deleted Functions', summary.deletedFunctions],
    ].map(([label, value]) =>
      '<div class="test-gap-card"><span class="test-gap-value">' + escapeHtml(value ?? 0) +
      '</span><span class="test-gap-label">' + label + '</span></div>'
    ).join('');
    const rows = gaps.map((gap) => {
      const lines = gap.startLine === null || gap.startLine === undefined
        || gap.endLine === null || gap.endLine === undefined
        ? '—'
        : escapeHtml(gap.startLine) + '–' + escapeHtml(gap.endLine);
      return '<tr><td>' + escapeHtml(gap.file || '') + '</td><td>' + escapeHtml(gap.function || '') +
        '</td><td>' + escapeHtml(gap.status || '—') + '</td><td>' + lines + '</td><td>' +
        escapeHtml(gap.author ?? 'Not recorded') + '</td><td class="test-gap-reason">' +
        displayReason(gap.reason) + '</td></tr>';
    }).join('');
    const tableContent = gaps.length
      ? '<div class="table-scroll"><table class="test-gap-table"><thead><tr><th>File</th><th>Function</th><th>Status</th><th>Lines</th><th>Author</th><th>Reason</th></tr></thead><tbody>' +
        rows + '</tbody></table></div>'
      : '<div class="empty-state">No historical coverage gaps were found for the selected build.</div>';
    const metadata = [
      '<span><strong>Build ID:</strong> <span class="build-id">' + escapeHtml(data.buildId) + '</span></span>',
      '<span><strong>Repository:</strong> ' + escapeHtml(data.repo || 'Not recorded') + '</span>',
      '<span><strong>Branch:</strong> ' + escapeHtml(data.branch || 'Branch not recorded') + '</span>',
      '<span><strong>Language:</strong> ' + escapeHtml(data.language || 'Not recorded') + '</span>',
      branchStrategy ? '<span><strong>Branch strategy:</strong> ' + escapeHtml(branchStrategy) + '</span>' : '',
    ].join('');

    return '<section class="page-heading"><div><h1>Historical Test Gaps</h1>' +
      '<p class="subtitle">Changed functions without matching positive-hit coverage in eligible earlier builds.</p>' +
      '<div class="test-gap-meta">' + metadata + '</div></div>' +
      '<a class="button" href="/dashboard.html">Coverage Dashboard</a></section>' +
      '<section class="test-gap-summary" aria-label="Historical test gap summary">' + metrics + '</section>' +
      '<section class="table-card" aria-label="Historical test gaps">' +
      (gaps.length
        ? '<p class="test-gap-explanation">No eligible historical coverage record matched this changed function with positive hits. This does not mean that no test exists.</p>'
        : '') +
      tableContent + '</section>';
  }

  function renderError(message) {
    return '<div class="error-state" role="alert">Could not load historical test gaps: ' + escapeHtml(message) +
      ' <button type="button" class="button" id="retryTestGaps">Retry</button></div>';
  }

  return { render, renderError };
});
