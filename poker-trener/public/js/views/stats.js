import { get, post } from '../api.js';
import { esc, fmt, dateTime, ACTION_PL } from '../ui/dom.js';
import { lineChart, barChart } from '../ui/charts.js';
import { gridHtml } from '../ui/grid.js';
import { modal } from '../ui/overlay.js';
import { createSpotPlayer } from './spotplayer.js';

const TABS = [
  ['przeglad', '📈 Przegląd'],
  ['leaki', '🩺 Leaki'],
  ['bledy', '💸 Najdroższe błędy'],
  ['czas', '⏱️ Timer i tilt'],
  ['heatmapa', '🔥 Heatmapa rąk'],
];

const accCell = (a) => (a == null ? '—' : `<span class="${a >= 80 ? 'ok' : a >= 65 ? 'warn' : 'bad'}">${fmt(a, 1)}%</span>`);
const RANGE = [['', 'Cały czas'], ['30', '30 dni'], ['7', '7 dni']];

function rangeChips(days) {
  return `<div class="chips mb" id="rng">${RANGE.map(([v, l]) => `<span class="chip ${String(days || '') === v ? 'on' : ''}" data-d="${v}">${l}</span>`).join('')}</div>`;
}

async function overview(box, q) {
  const [ov, tr, dr] = await Promise.all([get(`/stats/overview${q}`), get('/stats/trends'), get('/stats/drills')]);
  const t = ov.total;
  box.innerHTML = `<div class="panel mb"><div class="stats">
      <div class="stat"><span class="v">${fmt(t.n)}</span><span class="l">decyzji</span></div>
      <div class="stat"><span class="v">${accCell(t.accuracy)}</span><span class="l">trafność</span></div>
      <div class="stat"><span class="v">${fmt(t.lossPct, 2)}%</span><span class="l">strata ICM (suma % puli)</span></div>
      <div class="stat"><span class="v">${fmt(t.lossBB, 1)}</span><span class="l">strata chip EV (bb)</span></div>
      <div class="stat"><span class="v">${t.avgTimeMs ? fmt(t.avgTimeMs / 1000, 1) + ' s' : '—'}</span><span class="l">średni czas decyzji</span></div>
    </div></div>
    <div class="grid g2">
      <div class="panel"><h3>Trafność w dniach treningu (60 dni)</h3>${lineChart(tr.daily.filter((d) => d.n).map((d) => ({ ...d, v: d.accuracy })), { key: 'v', yMin: 0, yMax: 100, label: (p) => p.day.slice(5), fmtY: (v) => `${Math.round(v)}%` })}</div>
      <div class="panel"><h3>Liczba decyzji dziennie</h3>${barChart(tr.daily.slice(-30), { key: 'n', label: (p) => p.day.slice(8), lowIf: (p) => p.accuracy != null && p.accuracy < 65 })}<div class="tiny muted">Czerwone słupki: dni z trafnością poniżej 65%.</div></div>
      <div class="panel"><h3>Skumulowana strata ICM (% puli)</h3>${lineChart(tr.daily.map((d) => ({ ...d, v: d.cumLossPct })), { key: 'v', label: (p) => p.day.slice(5), fmtY: (v) => fmt(v, 1) })}</div>
      <div class="panel"><h3>Trendy tygodniowe</h3>${tr.weekly.length ? `<table class="tbl"><thead><tr><th>Tydzień</th><th>Decyzje</th><th>Trafność</th><th>Strata ICM</th></tr></thead><tbody>${tr.weekly.slice().reverse().map((w) => `<tr><td>${w.period}</td><td>${w.n}</td><td>${accCell(w.accuracy)}</td><td>${fmt(w.lossPct, 2)}%</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Brak danych.</p>'}
      ${tr.monthly.length > 1 ? `<h3 class="mt">Miesiące</h3><table class="tbl"><tbody>${tr.monthly.slice().reverse().map((m) => `<tr><td>${m.period}</td><td>${m.n}</td><td>${accCell(m.accuracy)}</td><td><a href="#/raport/${m.period}">raport</a></td></tr>`).join('')}</tbody></table>` : ''}</div>
      <div class="panel"><h3>Wg typu spotu</h3><table class="tbl"><thead><tr><th>Typ</th><th>n</th><th>Trafność</th><th>Strata ICM</th></tr></thead><tbody>${ov.byType.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.n}</td><td>${accCell(x.accuracy)}</td><td>${fmt(x.lossPct, 2)}%</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Brak danych</td></tr>'}</tbody></table></div>
      <div class="panel"><h3>Ćwiczenia podstaw</h3>${dr.length ? `<table class="tbl"><tbody>${dr.map((d) => `<tr><td>${esc(d.type.replace('_', ' '))}</td><td>${d.n}</td><td>${accCell(d.accuracy)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Brak danych.</p>'}</div>
    </div>`;
}

async function leaks(box, q) {
  const [lk, mx] = await Promise.all([get(`/stats/leaks${q}`), get(`/stats/matrix${q}`)]);
  const cell = (g, b) => mx.cells.find((c) => c.group === g && c.bucket === b);
  box.innerHTML = `<div class="panel mb"><h3>Raport leaków</h3>${lk.length ? `<div class="list">${lk
    .map((l) => `<div class="item badline"><div class="grow"><b>${l.direction === 'loose' ? '📈' : '📉'} ${esc(l.message)}</b><div class="small muted">Trafność ${fmt(l.accuracy, 1)}% (n=${l.n}) · strata ${fmt(l.lossPct, 2)}% puli${l.lossBB ? ` + ${fmt(l.lossBB, 1)}bb` : ''} · przykłady: ${l.examples.join(', ')}</div></div><a class="btn sm" href="#/trening/standard" data-fix="${l.type}|${l.group}|${l.bucket}">Ćwicz</a></div>`)
    .join('')}</div><p class="tiny muted mt">Leak = komórka (typ spotu × pozycja × stos) z min. 5 decyzjami, ≥3 błędami i trafnością poniżej 75%. „Ćwicz” ustawia filtry trenera na ten spot.</p>` : '<p class="muted small">Brak wyraźnych leaków — albo za mało danych (potrzeba min. 5 decyzji w danej komórce).</p>'}</div>
    <div class="panel"><h3>Trafność: pozycja × efektywny stos</h3><div class="scroll-x"><table class="tbl"><thead><tr><th></th>${mx.buckets.map((b) => `<th>${b}</th>`).join('')}</tr></thead><tbody>${mx.groups
      .map((g) => `<tr><td><b>${g}</b></td>${mx.buckets.map((b) => {
        const c = cell(g, b);
        return `<td title="${c ? `${c.correct}/${c.n}` : ''}" style="${c ? `background:color-mix(in srgb, ${c.accuracy >= 80 ? 'var(--accent)' : c.accuracy >= 65 ? 'var(--warn)' : 'var(--danger)'} ${Math.min(60, 15 + c.n * 2)}%, transparent)` : ''}">${c ? `${fmt(c.accuracy, 0)}%<div class="tiny muted">${c.n}</div>` : ''}</td>`;
      }).join('')}</tr>`)
      .join('')}</tbody></table></div></div>`;
  box.onclick = async (e) => {
    const f = e.target.closest('[data-fix]');
    if (!f) return;
    e.preventDefault();
    const [type, group, bucket] = f.dataset.fix.split('|');
    const m = bucket.match(/(\d+)\D+(\d+)/) || bucket.match(/≤(\d+)/);
    const range = bucket.startsWith('≤') ? [3, Number(m[1])] : m ? [Number(m[1]), Number(m[2])] : [3, 25];
    const { saveSettings } = await import('../store.js');
    await saveSettings({ filters: { types: [type], heroPositions: group === 'HU' ? ['SB'] : [group], stackRange: range, stage: group === 'HU' ? 'heads_up' : 'any' }, adaptive: false });
    location.hash = '#/trening/standard';
  };
}

async function errors(box, q) {
  const list = await get(`/stats/top-errors${q}`);
  box.innerHTML = `<div class="panel"><h3>Top 10 najdroższych błędów</h3>${list.length ? `<div class="list">${list
    .map((e) => `<div class="item badline"><div class="grow"><b>${esc(e.typeLabel)}</b> · ${esc(e.pos)} · ${fmt(e.stack, 1)}bb · <b>${esc(e.hand)}</b><div class="small muted">Zagrałeś ${ACTION_PL[e.chosen]}, lepiej ${ACTION_PL[e.optimal]} · ${dateTime(e.createdAt)} · ${esc(e.stage || '')}</div></div><span class="bad nowrap">−${e.lossPct ? `${fmt(e.lossPct, 2)}% puli` : `${fmt(e.lossBB, 1)}bb`}</span><button class="btn sm" data-replay="${e.id}">↻ Zagraj ponownie</button></div>`)
    .join('')}</div>` : '<p class="muted small">Brak błędów 🎉</p>'}</div>`;
  box.onclick = (e) => {
    const r = e.target.closest('[data-replay]');
    if (!r) return;
    const { el } = modal('<div class="rp"></div><button class="btn mt" data-close>Zamknij</button>', { wide: true });
    let done = false;
    const p = createSpotPlayer(el.querySelector('.rp'), {
      mode: 'replay',
      side: false,
      keys: false,
      confidence: false,
      manualNext: true,
      fetchSpot: async () => {
        if (done) return null;
        done = true;
        return (await post(`/spots/replay/${r.dataset.replay}`)).spot;
      },
    });
    p.next();
  };
}

async function timing(box, q) {
  const [tm, tl, cal] = await Promise.all([get(`/stats/timer${q}`), get(`/stats/tilt${q}`), get(`/stats/calibration${q}`)]);
  const tbl = (rows, cols) => `<table class="tbl"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  box.innerHTML = `<div class="grid g2">
    <div class="panel"><h3>Z timerem vs bez (multi-tabling)</h3>${tbl(tm.map((t) => `<tr><td>${t.label}</td><td>${t.n}</td><td>${accCell(t.accuracy)}</td><td>${t.avgTimeMs ? fmt(t.avgTimeMs / 1000, 1) + ' s' : '—'}</td><td>${t.timeouts}</td></tr>`), ['Limit', 'n', 'Trafność', 'Śr. czas', 'Timeouty'])}<p class="tiny muted mt">Jeśli trafność spada mocno przy krótszym limicie, Twoje odruchy nie są jeszcze gotowe na więcej stołów.</p></div>
    <div class="panel"><h3>Tilt</h3>${tl.warnings.length ? `<div class="list mb">${tl.warnings.map((w) => `<div class="item badline small">⚠️ ${esc(w)}</div>`).join('')}</div>` : '<p class="small ok mb">Brak sygnałów tiltu 👍</p>'}
      ${tbl([`<tr><td>Średnio</td><td>${tl.base.n}</td><td>${accCell(tl.base.accuracy)}</td></tr>`, `<tr><td>Po 2+ błędach z rzędu</td><td>${tl.afterErrors.n}</td><td>${accCell(tl.afterErrors.accuracy)}</td></tr>`], ['Sytuacja', 'n', 'Trafność'])}
      <h3 class="mt">Pora dnia</h3>${tbl(tl.byHour.map((h) => `<tr><td>${h.slot}</td><td>${h.n}</td><td>${accCell(h.accuracy)}</td></tr>`), ['Godziny', 'n', 'Trafność'])}
      <h3 class="mt">Minuty w sesji</h3>${tbl(tl.fatigue.map((h) => `<tr><td>${h.slot}</td><td>${h.n}</td><td>${accCell(h.accuracy)}</td></tr>`), ['Czas sesji', 'n', 'Trafność'])}<div class="tiny muted mt">Sesji: ${tl.sessions} (przerwa 20+ min = nowa sesja)</div></div>
    <div class="panel"><h3>Kalibracja pewności</h3>${tbl(cal.map((c) => `<tr><td>${c.label}</td><td>${c.n}</td><td>${accCell(c.accuracy)}</td></tr>`), ['Deklaracja', 'n', 'Trafność'])}<p class="tiny muted mt">Dobrze skalibrowany gracz: „pewny” ≈ 90%+, „zgaduję” ≈ 50–60%. Jeśli przy „pewny” trafność jest niska — masz błędne przekonania, które warto przećwiczyć.</p></div>
  </div>`;
}

async function heat(box, q) {
  const rows = await get(`/stats/heatmap${q}`);
  const map = Object.fromEntries(rows.map((r) => [r.label, r]));
  const worst = rows.filter((r) => r.n >= 3).map((r) => ({ ...r, rate: r.errors / r.n })).sort((a, b) => b.rate - a.rate || b.errors - a.errors).slice(0, 10);
  box.innerHTML = `<div class="grid g2"><div class="panel"><h3>Twoje błędy wg ręki</h3>${gridHtml({ heat: map })}<div class="legend"><span><i style="background:var(--danger)"></i>więcej błędów</span><span><i style="background:color-mix(in srgb, var(--accent) 25%, var(--panel-3))"></i>grane bez błędów</span></div></div>
    <div class="panel"><h3>Najczęściej mylone ręce (min. 3 decyzje)</h3>${worst.length ? `<table class="tbl"><thead><tr><th>Ręka</th><th>Błędy</th><th>Decyzje</th><th>%</th></tr></thead><tbody>${worst.map((w) => `<tr><td><b>${w.label}</b></td><td>${w.errors}</td><td>${w.n}</td><td class="bad">${Math.round(w.rate * 100)}%</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Za mało danych.</p>'}</div></div>`;
}

export default {
  async render(root, { parts, params }) {
    const tab = TABS.find((t) => t[0] === parts[0]) ? parts[0] : 'przeglad';
    const days = params.days || '';
    const q = days ? `?days=${days}` : '';
    root.innerHTML = `<div class="row between"><h1>📊 Statystyki</h1><a class="btn sm" href="#/raport">🖨️ Raport miesięczny</a></div><div class="tabs">${TABS.map(([k, l]) => `<a href="#/statystyki/${k}${q}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>${tab !== 'przeglad' ? rangeChips(days) : ''}<div id="sb"></div>`;
    root.querySelector('#rng')?.addEventListener('click', (e) => {
      const c = e.target.closest('[data-d]');
      if (c) location.hash = `#/statystyki/${tab}${c.dataset.d ? `?days=${c.dataset.d}` : ''}`;
    });
    const box = root.querySelector('#sb');
    const map = { przeglad: overview, leaki: leaks, bledy: errors, czas: timing, heatmapa: heat };
    await map[tab](box, q);
  },
};
