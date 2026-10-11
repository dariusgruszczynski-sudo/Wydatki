import { get } from '../api.js';
import { store } from '../store.js';
import { esc, fmt, ACTION_PL } from '../ui/dom.js';

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

function shiftMonth(m, d) {
  const [y, mm] = m.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mm - 1 + d, 1));
  return dt.toISOString().slice(0, 7);
}

export default {
  async render(root, { parts }) {
    const r = await get(`/stats/report${parts[0] ? `?month=${parts[0]}` : ''}`);
    const [y, m] = r.month.split('-').map(Number);
    const t = r.overview.total;
    root.innerHTML = `
      <div class="row between mb no-print"><div class="row"><a class="btn sm" href="#/raport/${shiftMonth(r.month, -1)}">◀</a><b>${MONTHS[m - 1]} ${y}</b><a class="btn sm" href="#/raport/${shiftMonth(r.month, 1)}">▶</a></div><button class="btn gold" onclick="window.print()">🖨️ Drukuj / zapisz PDF</button></div>
      <div class="panel"><h1>Raport miesięczny — ${MONTHS[m - 1]} ${y}</h1><p class="muted">${esc(store.profile.avatar)} ${esc(store.profile.name)} · Poker Trener</p>
        <div class="stats">
          <div class="stat"><span class="v">${t.n}</span><span class="l">decyzji w trenerze</span></div>
          <div class="stat"><span class="v">${t.accuracy == null ? '—' : fmt(t.accuracy, 1) + '%'}</span><span class="l">trafność</span></div>
          <div class="stat"><span class="v">${fmt(t.lossPct, 2)}%</span><span class="l">strata ICM</span></div>
          <div class="stat"><span class="v">${r.lessons}</span><span class="l">lekcji</span></div>
          <div class="stat"><span class="v">${r.quizzes.accuracy == null ? '—' : r.quizzes.accuracy + '%'}</span><span class="l">quizy (${r.quizzes.n})</span></div>
        </div></div>
      <div class="grid g2 mt">
        <div class="panel"><h3>Wg typu spotu</h3><table class="tbl"><tbody>${r.overview.byType.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.n}</td><td>${fmt(x.accuracy, 1)}%</td></tr>`).join('') || '<tr><td class="muted">brak</td></tr>'}</tbody></table></div>
        <div class="panel"><h3>Leaki</h3>${r.leaks.length ? `<ol class="small">${r.leaks.map((l) => `<li>${esc(l.message)} (trafność ${fmt(l.accuracy, 0)}%)</li>`).join('')}</ol>` : '<p class="small muted">Brak wyraźnych leaków.</p>'}</div>
        <div class="panel"><h3>Najdroższe błędy</h3>${r.topErrors.length ? `<ol class="small">${r.topErrors.map((e) => `<li>${esc(e.typeLabel)} ${esc(e.pos)} ${fmt(e.stack, 1)}bb ${esc(e.hand)}: ${ACTION_PL[e.chosen]} zamiast ${ACTION_PL[e.optimal]}</li>`).join('')}</ol>` : '<p class="small muted">Brak.</p>'}</div>
        <div class="panel"><h3>Timer i tilt</h3><table class="tbl small"><tbody>${r.timer.filter((x) => x.n).map((x) => `<tr><td>${x.label}</td><td>${x.n}</td><td>${fmt(x.accuracy, 1)}%</td></tr>`).join('')}</tbody></table>${r.tilt.warnings.map((w) => `<p class="small warn">⚠️ ${esc(w)}</p>`).join('')}</div>
        <div class="panel"><h3>Prawdziwa gra (import HH)</h3><p class="small">Ręce: <b>${r.hands.n}</b> · VPIP ${r.hands.vpip ?? '—'}% · PFR ${r.hands.pfr ?? '—'}% · wynik ${fmt(r.hands.resultBB, 1)}bb</p></div>
        <div class="panel"><h3>Bankroll</h3><p class="small">Sesji: ${r.bankroll.sessions} · turniejów: ${r.bankroll.tournaments} · wpisowe ${fmt(r.bankroll.buyins, 2)} · wygrane ${fmt(r.bankroll.cashes, 2)} · <b class="${r.bankroll.profit >= 0 ? 'ok' : 'bad'}">${fmt(r.bankroll.profit, 2)}</b>${r.bankroll.roi != null ? ` · ROI ${r.bankroll.roi}%` : ''}</p></div>
      </div>`;
  },
};
