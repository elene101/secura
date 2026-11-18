const DAY = 86400000;
const RETENTION = 90 * DAY;

function record(site, result, scheduled) {
  const now = Date.now();
  (site.history ||= []).push({
    t: now, ms: result.ms, up: result.up, reason: result.reason,
    status: result.status, scheduled, interval: site.interval || 30
  });
  pruneHistory(site, now);
}

function pruneHistory(site, now = Date.now()) {
  const history = site.history || [];
  let retained = 0;
  while (history[retained]?.t < now - RETENTION) retained++;
  if (retained) history.splice(0, retained);
}

function sampleHistory(history) {
  const stride = Math.ceil(history.length / 864);
  if (stride <= 1) return history;
  const sampled = [];
  for (let index = 0; index < history.length; index += stride) {
    const window = history.slice(index, index + stride);
    const failure = window.find(point => !point.up);
    const middle = window[Math.floor(window.length / 2)];
    sampled.push(failure || {
      ...middle, ms: Math.round(window.reduce((total, point) => total + point.ms, 0) / window.length)
    });
  }
  return sampled;
}

function computeStats(site, days = 7) {
  const now = Date.now();
  const history = site.history || [];
  const within = days => history.filter(point => point.t >= now - days * DAY);
  const percent = points => {
    const checks = points.filter(point => point.scheduled !== false && point.reason !== 'REGIONAL_DIFFERENCE');
    return checks.length ? Math.round(1000 * checks.filter(p => p.up).length / checks.length) / 10 : null;
  };
  const recent = within(1), chart = within(days), scores = site.scores || [];
  const successful = recent.filter(p => p.up);
  const samples = sampleHistory(chart.filter(point => point.reason !== 'REGIONAL_DIFFERENCE'));
  return {
    status: site.status || 'unknown', uptime24h: percent(recent), uptime7d: percent(within(7)),
    uptimePeriod: percent(chart), checks: chart.length, days,
    avgMs24h: successful.length ? Math.round(successful.reduce((sum, p) => sum + p.ms, 0) / successful.length) : null,
    history: samples.map(p => [p.t, p.up ? p.ms : null, p.reason || null]),
    scores: scores.filter(p => p.t >= now - days * DAY && Number.isFinite(p.score) && p.version === 2).map(p => [p.t, p.score]),
    ssl: site.ssl || null, domain: site.domain || null, incidents: (site.incidents || []).slice(-50).reverse(),
    changes: (site.changes || []).slice(-50).reverse(), missed: site.missed || 0
  };
}

module.exports = { record, computeStats, pruneHistory };
