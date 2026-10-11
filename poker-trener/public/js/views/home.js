import { refreshSummary, store } from '../store.js';
import { esc, fmt } from '../ui/dom.js';

function goalRow(g) {
  const p = Math.min(100, g.target ? (g.value / g.target) * 100 : 0);
  return `<div class="mb"><div class="row between small"><span>${g.done ? '✅' : '🎯'} ${esc(g.label)}</span><span class="muted">${fmt(g.value)}${g.unit} / ${fmt(g.target)}${g.unit}</span></div><div class="bar ${g.done ? 'green' : ''}"><i style="width:${p}%"></i></div>${g.note ? `<div class="tiny muted">${esc(g.note)}</div>` : ''}</div>`;
}

export default {
  async render(root) {
    const s = await refreshSummary();
    const p = store.profile;
    const lv = s.level;
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Dzień dobry' : hour < 18 ? 'Cześć' : 'Dobry wieczór';
    root.innerHTML = `
      <div class="hero-banner mb">
        <div class="row between">
          <div class="col" style="gap:4px">
            <div class="small" style="opacity:.8">${hello}, ${esc(p.name)} ${esc(p.avatar)}</div>
            <div class="big">${esc(s.path.icon)} ${esc(s.path.name)} · poziom ${lv.level}</div>
            <div class="small" style="opacity:.85">${esc(lv.name)} · ${fmt(lv.xp)} XP · do kolejnego poziomu ${fmt(lv.nextLevel - lv.xp)} XP</div>
          </div>
          <div class="level-ring" style="--p:${Math.round(lv.progress * 100)}"><div>${lv.level}</div></div>
        </div>
        <div class="stats mt">
          <div class="stat"><span class="v">🔥 ${s.streak.current}</span><span class="l">dni z rzędu (rekord ${s.streak.best})</span></div>
          <div class="stat"><span class="v">${s.today.spots}</span><span class="l">decyzji dziś</span></div>
          <div class="stat"><span class="v">${s.today.accuracy == null ? '—' : s.today.accuracy + '%'}</span><span class="l">trafność dziś</span></div>
          <div class="stat"><span class="v">💰 ${fmt(s.virtualBankroll)}</span><span class="l">wirtualny bankroll</span></div>
        </div>
      </div>

      ${!s.path.placementDone && s.path.stage === 1 ? `<div class="panel mb" style="border-color:var(--gold)"><div class="row between"><div><b>Znasz już podstawy?</b><div class="small muted">Test wstępny (12 pytań, 3 minuty) ustawi Twój poziom na ścieżce nauki.</div></div><a class="btn gold" href="#/nauka/test">Zrób test</a></div></div>` : ''}

      <div class="grid g4 mb">
        <a class="tile" href="#/trening/standard"><span class="ic">🎯</span><span class="t">Trening ICM</span><span class="d">Spoty dopasowane do Twoich słabych punktów</span></a>
        <a class="tile" href="#/trening/daily"><span class="ic">☀️</span><span class="t">Wyzwanie dnia</span><span class="d">${s.daily.done ? `Zrobione: ${s.daily.score}/${s.daily.total}` : '20 spotów — te same dla wszystkich'}</span>${s.daily.done ? '<span class="badge pill ok">✓</span>' : '<span class="badge pill gold">nowe</span>'}</a>
        <a class="tile" href="#/trening/review"><span class="ic">🔁</span><span class="t">Powtórki błędów</span><span class="d">${s.review.due ? `${s.review.due} do powtórzenia teraz` : s.review.active ? `${s.review.active} w kolejce` : 'Brak zaległości'}</span>${s.review.due ? `<span class="badge pill bad">${s.review.due}</span>` : ''}</a>
        ${s.nextLesson ? `<a class="tile" href="#/nauka/lekcja/${s.nextLesson.id}"><span class="ic">📘</span><span class="t">Następna lekcja</span><span class="d">${esc(s.nextLesson.title)}</span></a>` : `<a class="tile" href="#/nauka"><span class="ic">📘</span><span class="t">Nauka</span><span class="d">Ścieżka i egzaminy</span></a>`}
        <a class="tile" href="#/turniej"><span class="ic">🏆</span><span class="t">Symulator turnieju</span><span class="d">${s.runningTournaments.length ? `${s.runningTournaments.length} w toku` : 'Od 1. poziomu do final table'}</span></a>
        <a class="tile" href="#/turniej/multi"><span class="ic">🖥️</span><span class="t">Multi-table</span><span class="d">2–3 turnieje naraz pod presją czasu</span></a>
        <a class="tile" href="#/trening/survival"><span class="ic">🛡️</span><span class="t">Survival</span><span class="d">Jeden błąd i koniec</span></a>
        <a class="tile" href="#/trening/time_attack"><span class="ic">⏱️</span><span class="t">Time attack</span><span class="d">Ile dobrych decyzji w 2 minuty?</span></a>
      </div>

      <div class="grid g2">
        <div class="panel"><div class="row between mb"><h3>Cele tygodnia</h3><a class="small" href="#/profil/cele">edytuj</a></div>${s.goals.goals.map(goalRow).join('')}</div>
        <div class="panel"><div class="row between mb"><h3>Ostatnie odznaki</h3><a class="small" href="#/profil/odznaki">wszystkie</a></div>
          ${s.recentAchievements.length ? `<div class="list">${s.recentAchievements.map((a) => `<div class="ach on"><span class="i">${a.icon}</span><div><b>${esc(a.label)}</b><div class="small muted">${esc(a.desc)}</div></div></div>`).join('')}</div>` : '<p class="muted small">Pierwsza odznaka czeka za pierwszą decyzją w trenerze.</p>'}
        </div>
      </div>`;
  },
};
