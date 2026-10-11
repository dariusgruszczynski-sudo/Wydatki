import { esc } from './dom.js';

// E7: prosty wykres liniowy SVG (jedna lub dwie serie).
export function lineChart(points, { key = 'v', key2 = null, height = 180, yMin = null, yMax = null, label = (x) => x, fmtY = (v) => v, area = true } = {}) {
  const w = 600;
  const pad = { l: 38, r: 10, t: 12, b: 24 };
  const vals = points.flatMap((p) => [p[key], key2 ? p[key2] : null]).filter((v) => v != null);
  if (!vals.length) return '<p class="small muted">Za mało danych na wykres.</p>';
  let lo = yMin ?? Math.min(...vals);
  let hi = yMax ?? Math.max(...vals);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const x = (i) => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const series = (k) => {
    const pts = points.map((p, i) => (p[k] == null ? null : [x(i), y(p[k])])).filter(Boolean);
    return pts.length ? pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') : '';
  };
  const d1 = series(key);
  const ticks = [lo, (lo + hi) / 2, hi];
  const step = Math.max(1, Math.ceil(points.length / 6));
  const xl = points.map((p, i) => (i % step === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${height - 6}" text-anchor="middle">${esc(label(p))}</text>` : '')).join('');
  const idx = points.map((p, i) => (p[key] == null ? -1 : i)).filter((i) => i >= 0);
  const areaPath = area && idx.length > 1 ? `${d1} L${x(idx[idx.length - 1])},${pad.t + ih} L${x(idx[0])},${pad.t + ih} Z` : '';
  return `<div class="chart"><svg viewBox="0 0 ${w} ${height}" role="img">
    ${ticks.map((t) => `<line class="grid-line" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 6}" y="${y(t) + 3}" text-anchor="end">${esc(fmtY(t))}</text>`).join('')}
    ${areaPath ? `<path class="area" d="${areaPath}"/>` : ''}
    <path class="line" d="${d1}"/>
    ${key2 ? `<path class="line l2" d="${series(key2)}"/>` : ''}
    ${points.map((p, i) => (p[key] != null && idx.length <= 40 ? `<circle class="dot" cx="${x(i)}" cy="${y(p[key])}" r="2.6"/>` : '')).join('')}
    ${xl}
  </svg></div>`;
}

export function barChart(points, { key = 'v', height = 140, label = (x) => x, lowIf = () => false, fmtY = (v) => v } = {}) {
  const w = 600;
  const pad = { l: 30, r: 6, t: 10, b: 22 };
  const max = Math.max(1, ...points.map((p) => p[key] || 0));
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const bw = iw / Math.max(1, points.length);
  const step = Math.max(1, Math.ceil(points.length / 8));
  return `<div class="chart"><svg viewBox="0 0 ${w} ${height}">
    <line class="axis" x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>
    <text x="${pad.l - 4}" y="${pad.t + 8}" text-anchor="end">${esc(fmtY(max))}</text>
    ${points.map((p, i) => {
      const v = p[key] || 0;
      const hgt = (v / max) * ih;
      return `<rect class="barv ${lowIf(p) ? 'low' : ''}" x="${pad.l + i * bw + bw * 0.15}" y="${pad.t + ih - hgt}" width="${bw * 0.7}" height="${Math.max(0, hgt)}" rx="2"><title>${esc(label(p))}: ${v}</title></rect>${i % step === 0 ? `<text x="${pad.l + i * bw + bw / 2}" y="${height - 6}" text-anchor="middle">${esc(label(p))}</text>` : ''}`;
    }).join('')}
  </svg></div>`;
}
