import { esc } from './api/client.js';
import { t, getLang } from './i18n.js';
export function chart(pts, { min, max, unit = '', label }) {
  const vals = pts.filter(p => p[1] != null).map(p => p[1]);
  if (vals.length < 2) return `<p class="muted">${t('Not enough data yet')}</p>`;
  const W = 640, H = 150, L = 42, B = 20, T = 8, R = 8, x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  const lo = min ?? 0, hi = max ?? Math.max(...vals, 1) * 1.15;
  const X = ts => L + (ts - x0) / Math.max(x1 - x0, 1) * (W - L - R), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let d = '', pen = false;
  for (const [ts, v] of pts) { if (v == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${X(ts).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true; }
  const downs = pts.filter(p => p[1] == null);
  const loc = getLang() === 'ka' ? 'ka-GE' : 'en-GB', day = ts => new Date(ts).toLocaleDateString(loc, { day: 'numeric', month: 'short' });
  const grid = [lo, (lo + hi) / 2, hi].map(v => `<line class="cgrid" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ctext" x="${L - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`).join('');
  const desc = `${label}: ${Math.min(...vals)}–${Math.max(...vals)}${unit}`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}">${grid}
    ${downs.map(p => `<line class="cdown" x1="${X(p[0]).toFixed(1)}" x2="${X(p[0]).toFixed(1)}" y1="${T}" y2="${H - B}"/>`).join('')}
    <path class="cline" d="${d}"/><text class="ctext" x="${L}" y="${H - 5}">${day(x0)}</text><text class="ctext" x="${W - R}" y="${H - 5}" text-anchor="end">${day(x1)}</text></svg>
    ${downs.length ? `<p class="muted csmall">${t('Red lines mean the site was down')}</p>` : ''}`;
}
