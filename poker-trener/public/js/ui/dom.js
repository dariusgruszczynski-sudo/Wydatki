export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function on(root, event, selector, fn) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  });
}

export function fmt(n, d = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function money(v, unit = '$') {
  if (v == null) return '—';
  return unit === 'bb' ? `${fmt(v, 1)}bb` : `$${fmt(v, 0)}`;
}

export function pct(v, d = 1) {
  return v == null ? '—' : `${fmt(v, d)}%`;
}

export function dateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function isMobile() {
  return window.matchMedia('(max-width: 899px)').matches;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const ACTION_PL = { shove: 'All-in', call: 'Call', fold: 'Pas', raise: 'Otwarcie' };
