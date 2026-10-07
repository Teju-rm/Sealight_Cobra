(function exposeCobraApi(root, factory) {
  const api = factory(root.fetch ? root.fetch.bind(root) : null);
  if (typeof module === 'object' && module.exports) module.exports = { ...api, createApi: factory };
  if (root) root.CobraApi = api;
})(typeof globalThis === 'object' ? globalThis : this, function createApi(defaultFetch) {
  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return '—';
    const value = Number(seconds);
    if (Math.abs(value) < 60) return `${Math.round(value)} s`;
    const divisor = Math.abs(value) >= 3600 ? 3600 : 60;
    const unit = divisor === 3600 ? 'h' : 'm';
    const amount = (value / divisor).toFixed(2).replace(/\.0+$|(?<=\.[0-9])0$/, '');
    return `${amount} ${unit}`;
  }

  function calculateSavingsPercent(apps) {
    const rows = Array.isArray(apps) ? apps : [];
    const totalCompute = rows.reduce((sum, app) => sum + Math.max(0, Number(app.computeTimeSec) || 0), 0);
    const totalSavings = rows.reduce((sum, app) => sum + Math.max(0, Number(app.savingsSec) || 0), 0);
    return totalCompute > 0 ? Math.round((totalSavings / totalCompute) * 1000) / 10 : 0;
  }

  function createError(response, fallback) {
    const error = new Error(`${fallback} HTTP ${response.status}.`);
    error.status = response.status;
    return error;
  }

  return {
    formatDuration,
    calculateSavingsPercent,
    async getJson(url, options) {
      if (!defaultFetch) throw new Error('Fetch is unavailable in this environment.');
      const response = await defaultFetch(url, options);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = createError(response, body.error || 'API returned');
        throw error;
      }
      return response.json();
    },
    async getBuilds(query) {
      return this.getJson('/builds?' + query);
    },
    async getRisk(buildId, query) {
      return this.getJson('/risk/' + encodeURIComponent(buildId) + (query ? '?' + query : ''));
    },
    async getBuildStages(buildId) {
      return this.getJson('/builds/' + encodeURIComponent(buildId) + '/stages');
    },
    async updateSettings(url, settings) {
      return this.getJson(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
    },
    async getTestOptimizationSummary(filters) {
      if (!defaultFetch) throw new Error('Fetch is unavailable in this environment.');
      const query = new URLSearchParams();
      if (filters.from) query.set('from', filters.from);
      if (filters.to) query.set('to', filters.to);
      if (filters.app) query.set('app', filters.app);
      try {
        return {
          data: await this.getJson('/test-optimization/summary?' + query.toString()),
          sample: false,
        };
      } catch (error) {
        if (error.status !== 404) throw error;
        return {
          data: await this.getJson('/mocks/test-optimization-summary.json'),
          sample: true,
        };
      }
    },
  };
});