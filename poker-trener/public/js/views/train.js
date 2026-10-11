import { get, post } from '../api.js';
import { store, settings, saveSettings, refreshSummary } from '../store.js';
import { esc, fmt } from '../ui/dom.js';
import { errorToast, achievementToasts } from '../ui/overlay.js';
import { confetti, sound } from '../ui/fx.js';
import { createSpotPlayer } from './spotplayer.js';

let player = null;
let cleanupFns = [];

const TYPES = [
  ['open_shove', 'Open shove'],
  ['facing_shove', 'Call vs shove'],
  ['threebet_shove', '3-bet shove'],
  ['resteal', 'Resteal'],
  ['squeeze', 'Squeeze'],
  ['three_way', 'All-in 3-way'],
  ['rfi', 'Otwarcie deep'],
];
const GROUPS = [['EP', 'UTG'], ['MP', 'MP/HJ'], ['CO', 'CO'], ['BTN', 'BTN'], ['SB', 'SB'], ['BB', 'BB']];
const FORMATS = [['mix', 'Mix'], ['mtt', 'MTT'], ['pko', 'PKO'], ['sng', 'SNG'], ['satellite', 'Satelity'], ['wta', 'Winner takes all']];
const STAGES = [['any', 'Każdy'], ['early', 'Wczesna (chip EV)'], ['bubble', 'Bąbelek'], ['final_table', 'Final table'], ['itm', 'W pieniądzach'], ['heads_up', 'Heads-up']];

function sessionTracker() {
  const s = { n: 0, ok: 0, lossPct: 0, lossBB: 0, time: 0, ids: [], errors: [] };
  return {
    add(r, spot) {
      s.n++;
      if (r.correct) s.ok++;
      if (!r.correct) s.errors.push({ hand: spot.heroLabel, type: spot.typeLabel, pos: spot.seats[spot.heroIdx].posLabel, loss: r.evLoss, unit: r.unit, pool: spot.poolTotal });
      if (r.unit === '$') s.lossPct += (r.evLoss / spot.poolTotal) * 100;
      else s.lossBB += r.evLoss || 0;
      s.ids.push(r.attemptId);
    },
    html() {
      return `<div class="panel"><h3>Ta sesja</h3><div class="stats">
        <div class="stat"><span class="v">${s.n}</span><span class="l">decyzji</span></div>
        <div class="stat"><span class="v">${s.n ? Math.round((s.ok / s.n) * 100) + '%' : '—'}</span><span class="l">trafność</span></div>
        <div class="stat"><span class="v">${fmt(s.lossPct, 2)}%</span><span class="l">strata ICM (puli)</span></div>
        <div class="stat"><span class="v">${fmt(s.lossBB, 1)}</span><span class="l">strata chip EV (bb)</span></div>
      </div>
      ${s.n >= 5 ? `<button class="btn sm mt" data-summary>📋 Podsumuj sesję</button>` : '<div class="tiny muted mt">Podsumowanie sesji po 5 decyzjach.</div>'}
      <div class="sum-out small mt"></div>
      <div class="tiny muted mt">Skróty: S/C/R = agresja · F = pas · Spacja = dalej · 1/2/3 = pewność. Na telefonie: przesuń stół w prawo/lewo.</div></div>`;
    },
    summaryText() {
      if (!s.n) return '';
      const byType = {};
      for (const e of s.errors) byType[e.type] = (byType[e.type] || 0) + 1;
      const worst = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
      return `Trafność ${Math.round((s.ok / s.n) * 100)}% (${s.ok}/${s.n}). ${worst ? `Najwięcej błędów: ${worst[0]} (${worst[1]}).` : 'Bez błędów — świetnie!'} ${s.errors.length ? `Ręce z błędami: ${s.errors.slice(-6).map((e) => e.hand).join(', ')}.` : ''}`;
    },
    get ids() {
      return s.ids;
    },
    get count() {
      return s.n;
    },
  };
}

function filtersHtml(st) {
  const f = st.filters || {};
  const types = new Set(f.types || []);
  const groups = new Set(f.heroPositions || []);
  return `
    <details class="more mb" ${f.types?.length || f.heroPositions?.length || f.stage !== 'any' ? 'open' : ''}><summary>Filtry i ustawienia treningu</summary><div>
      <div class="field mb">Typy spotów (puste = wszystkie odblokowane)<div class="chips" data-f="types">${TYPES.map(([k, l]) => `<span class="chip ${types.has(k) ? 'on' : ''}" data-v="${k}">${l}</span>`).join('')}</div></div>
      <div class="field mb">Twoja pozycja<div class="chips" data-f="heroPositions">${GROUPS.map(([k, l]) => `<span class="chip ${groups.has(k) ? 'on' : ''}" data-v="${k}">${l}</span>`).join('')}</div></div>
      <div class="grid g3">
        <label class="field">Stos od (bb)<input class="inp" type="number" min="1" max="100" data-s="min" value="${f.stackRange?.[0] ?? 3}"></label>
        <label class="field">Stos do (bb)<input class="inp" type="number" min="1" max="100" data-s="max" value="${f.stackRange?.[1] ?? 25}"></label>
        <label class="field">Etap turnieju<select class="inp" data-k="stage">${STAGES.map(([k, l]) => `<option value="${k}" ${f.stage === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Format (preferencja)<select class="inp" data-set="formatFocus">${FORMATS.map(([k, l]) => `<option value="${k}" ${st.formatFocus === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Przeciwnicy<select class="inp" data-set="mode"><option value="gto" ${st.mode === 'gto' ? 'selected' : ''}>GTO (standard)</option><option value="exploit" ${st.mode === 'exploit' ? 'selected' : ''}>Eksploatacja (typy graczy)</option></select></label>
        <label class="field">Trudność<select class="inp" data-set="difficulty"><option value="easy" ${st.difficulty === 'easy' ? 'selected' : ''}>Łatwa (losowe ręce)</option><option value="normal" ${st.difficulty === 'normal' ? 'selected' : ''}>Normalna</option><option value="hard" ${st.difficulty === 'hard' ? 'selected' : ''}>Trudna (ręce graniczne)</option></select></label>
        <label class="field">Ante<select class="inp" data-set="anteMode"><option value="bb_ante" ${st.anteMode === 'bb_ante' ? 'selected' : ''}>BB ante</option><option value="classic" ${st.anteMode === 'classic' ? 'selected' : ''}>Klasyczne</option><option value="none" ${st.anteMode === 'none' ? 'selected' : ''}>Brak</option></select></label>
        <label class="field">Tryb Speed<select class="inp" data-set="speedMs"><option value="0">bez limitu</option>${[15000, 10000, 7000, 5000].map((v) => `<option value="${v}" ${Number(st.speedMs) === v ? 'selected' : ''}>${v / 1000} s na decyzję</option>`).join('')}</select></label>
      </div>
      <div class="chips mt">
        <span class="chip ${st.adaptive ? 'on' : ''}" data-toggle="adaptive">🎯 Adaptacja do słabych punktów</span>
        <span class="chip ${st.autoNext ? 'on' : ''}" data-toggle="autoNext">⏭️ Seria (auto-następny)</span>
        <span class="chip ${st.confidence ? 'on' : ''}" data-toggle="confidence">🎚️ Pytaj o pewność</span>
      </div>
      <div class="tiny muted mt">Zmiany zapisują się automatycznie i działają od następnego spotu.</div>
    </div></details>`;
}

function bindFilters(root) {
  const box = root.querySelector('details.more');
  if (!box) return;
  const save = async (patch) => {
    try {
      await saveSettings(patch);
    } catch (e) {
      errorToast(e);
    }
  };
  box.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const t = chip.dataset.toggle;
    if (t) {
      chip.classList.toggle('on');
      save({ [t]: chip.classList.contains('on') });
      return;
    }
    const group = chip.parentElement.dataset.f;
    if (group) {
      chip.classList.toggle('on');
      const vals = [...chip.parentElement.querySelectorAll('.chip.on')].map((c) => c.dataset.v);
      save({ filters: { [group]: vals } });
    }
  });
  box.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.set) save({ [el.dataset.set]: el.dataset.set === 'speedMs' ? Number(el.value) : el.value });
    if (el.dataset.k) save({ filters: { [el.dataset.k]: el.value } });
    if (el.dataset.s) {
      const min = Number(box.querySelector('[data-s="min"]').value) || 3;
      const max = Number(box.querySelector('[data-s="max"]').value) || 25;
      save({ filters: { stackRange: [Math.min(min, max), Math.max(min, max)] } });
    }
  });
}

function bindSession(root, tracker) {
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-summary]')) return;
    const out = root.querySelector('.sum-out');
    out.innerHTML = `<div class="panel flat">${esc(tracker.summaryText())}</div>${store.coach.enabled ? '<button class="btn sm mt" data-sum-ai>🤖 Podsumowanie od coacha</button>' : ''}`;
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sum-ai]');
    if (!b) return;
    b.disabled = true;
    try {
      const r = await post('/coach/session-summary', { attemptIds: tracker.ids });
      root.querySelector('.sum-out').insertAdjacentHTML('beforeend', `<div class="panel flat mt" style="white-space:pre-wrap">🤖 ${esc(r.text)}</div>`);
    } catch (err) {
      errorToast(err);
      b.disabled = false;
    }
  });
}

function hub(root) {
  const s = store.summary;
  root.innerHTML = `
    <h1>Trening</h1>
    <div class="grid g3">
      <a class="tile" href="#/trening/standard"><span class="ic">🎯</span><span class="t">Trener ICM / push-fold</span><span class="d">7 typów spotów, filtry, adaptacja, „co jeśli”, siatki zasięgów</span></a>
      <a class="tile" href="#/trening/daily"><span class="ic">☀️</span><span class="t">Wyzwanie dnia</span><span class="d">${s?.daily?.done ? `Dziś: ${s.daily.score}/${s.daily.total}` : '20 tych samych spotów dla każdego · ranking'}</span></a>
      <a class="tile" href="#/trening/review"><span class="ic">🔁</span><span class="t">Powtórki błędów</span><span class="d">${s?.review?.due ? `${s.review.due} czeka na powtórkę` : 'System powtórek jak w Anki'}</span></a>
      <a class="tile" href="#/trening/survival"><span class="ic">🛡️</span><span class="t">Survival</span><span class="d">Gramy do pierwszego błędu</span></a>
      <a class="tile" href="#/trening/time_attack"><span class="ic">⏱️</span><span class="t">Time attack</span><span class="d">2 minuty — ile dobrych decyzji?</span></a>
      <a class="tile" href="#/trening/drills"><span class="ic">🧩</span><span class="t">Ćwiczenia podstaw</span><span class="d">Układy, kolejność akcji, nuts, outy, pot odds</span></a>
      <a class="tile" href="#/turniej"><span class="ic">🏆</span><span class="t">Symulator turnieju</span><span class="d">Cały turniej od 1. poziomu</span></a>
      <a class="tile" href="#/turniej/multi"><span class="ic">🖥️</span><span class="t">Multi-table</span><span class="d">2–3 stoły naraz</span></a>
      <a class="tile" href="#/narzedzia/spot"><span class="ic">🛠️</span><span class="t">Własny spot</span><span class="d">Zbuduj sytuację z prawdziwej gry</span></a>
    </div>`;
}

function standard(root, mode) {
  const st = settings();
  const tracker = sessionTracker();
  const titles = { standard: 'Trener ICM / push-fold', survival: 'Survival', time_attack: 'Time attack' };
  root.innerHTML = `<div class="row between mb"><h1>${titles[mode]}</h1><a class="btn sm ghost" href="#/trening">← tryby</a></div>${mode === 'standard' ? filtersHtml(st) : ''}<div class="mode-bar"></div><div class="sp"></div>`;
  bindFilters(root);
  bindSession(root, tracker);
  const bar = root.querySelector('.mode-bar');
  let alive = true;
  let streak = 0;
  let over = false;
  let deadline = null;
  let clock = null;

  const finish = async (score, detail) => {
    over = true;
    clearInterval(clock);
    try {
      const r = await post('/modes/record', { mode, score, detail });
      achievementToasts(r.newAchievements);
      const best = r.best;
      if (score >= best && score > 0) {
        confetti();
        sound('level');
      }
      bar.innerHTML = `<div class="panel mb center pop"><div class="big gold" style="font-size:2rem;font-weight:900">${score}</div><div>${mode === 'survival' ? 'dobrych decyzji do pierwszego błędu' : 'dobrych decyzji w 2 minuty'}</div><div class="muted small">Twój rekord: ${best}</div><button class="btn primary mt" data-again>Jeszcze raz</button></div>`;
      bar.querySelector('[data-again]').onclick = () => standard(root, mode);
    } catch (e) {
      errorToast(e);
    }
  };

  if (mode === 'survival') bar.innerHTML = `<div class="panel mb row between"><span>🛡️ Seria: <b class="sv">0</b></span><span class="small muted">Jeden błąd (poza spotami granicznymi) kończy grę.</span></div>`;
  if (mode === 'time_attack') {
    bar.innerHTML = `<div class="panel mb row between"><span>⏱️ <b class="ta-t">2:00</b></span><span>✅ <b class="ta-s">0</b></span><button class="btn sm primary" data-start>Start</button></div>`;
  }

  const startPlayer = () => {
    player = createSpotPlayer(root.querySelector('.sp'), {
      mode,
      speedMs: mode === 'standard' ? st.speedMs : mode === 'survival' ? st.speedMs : 0,
      autoNext: mode === 'time_attack' ? true : st.autoNext,
      autoNextDelay: mode === 'time_attack' ? 700 : st.autoNextDelay,
      confidence: mode === 'standard' && st.confidence,
      fetchSpot: async () => {
        if (!alive || over) return null;
        if (deadline && Date.now() > deadline) return null;
        const r = await post('/spots/next', { mode: mode === 'standard' ? undefined : mode });
        return r.spot;
      },
      onEmpty: () => {},
      onResult: (r, spot) => {
        tracker.add(r, spot);
        const slot = player.slot();
        if (slot) slot.innerHTML = tracker.html();
        if (mode === 'survival') {
          if (r.correct) {
            streak++;
            bar.querySelector('.sv').textContent = streak;
          } else finish(streak, { hand: spot.heroLabel });
        }
        if (mode === 'time_attack' && r.correct) {
          streak++;
          bar.querySelector('.ta-s').textContent = streak;
        }
      },
    });
    const slot = player.slot();
    if (slot) slot.innerHTML = tracker.html();
    player.next();
  };

  if (mode === 'time_attack') {
    bar.querySelector('[data-start]').onclick = (e) => {
      e.target.remove();
      deadline = Date.now() + 120000;
      clock = setInterval(() => {
        const left = Math.max(0, deadline - Date.now());
        const el = bar.querySelector('.ta-t');
        if (el) el.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
        if (left <= 0) {
          player && player.destroy();
          finish(streak, null);
        }
      }, 250);
      startPlayer();
    };
  } else startPlayer();
  cleanupFns.push(() => {
    alive = false;
    clearInterval(clock);
  });
}

async function daily(root) {
  const d = await get('/daily');
  const board = (lb) => `<table class="tbl mt"><thead><tr><th>#</th><th>Gracz</th><th>Wynik</th><th>Strata</th><th>Czas</th></tr></thead><tbody>${lb.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.avatar)} ${esc(x.name)}</td><td><b>${x.score}/${x.total}</b></td><td>${fmt(x.ev_lost, 2)}</td><td>${Math.round((x.time_ms || 0) / 1000)} s</td></tr>`).join('')}</tbody></table>`;
  root.innerHTML = `<div class="row between mb"><h1>☀️ Wyzwanie dnia · ${esc(d.day)}</h1><a class="btn sm ghost" href="#/trening">← tryby</a></div><div class="dh"></div><div class="sp"></div>`;
  const head = root.querySelector('.dh');
  if (d.done) {
    head.innerHTML = `<div class="panel"><h2>Dzisiejszy wynik: ${d.done.score}/${d.done.total}</h2><p class="muted small">Wynik liczy się raz dziennie (pierwsze podejście). Możesz zagrać ponownie dla treningu.</p>${board(d.leaderboard)}<button class="btn mt" data-play>Zagraj ponownie (bez rankingu)</button></div>`;
  } else {
    head.innerHTML = `<div class="panel"><p>20 spotów — te same dla wszystkich profili. Liczy się trafność, potem strata EV, potem czas.</p>${d.leaderboard.length ? board(d.leaderboard) : ''}<button class="btn gold lg mt" data-play>Start</button></div>`;
  }
  head.querySelector('[data-play]').onclick = async () => {
    const s = await post('/daily/start');
    const queue = s.spots.slice();
    let i = 0;
    head.innerHTML = `<div class="panel mb row between"><span>Spot <b class="di">1</b>/20</span><span>✅ <b class="ds">0</b></span></div>`;
    let ok = 0;
    player = createSpotPlayer(root.querySelector('.sp'), {
      mode: 'daily',
      side: true,
      confidence: false,
      fetchSpot: async () => {
        if (i >= queue.length) {
          const f = await post('/daily/finish');
          achievementToasts(f.newAchievements);
          if (f.score >= 16) confetti();
          root.querySelector('.sp').innerHTML = '';
          const fresh = await get('/daily');
          head.innerHTML = `<div class="panel center pop"><div style="font-size:2.4rem;font-weight:900" class="gold">${f.score}/${f.total}</div><div class="muted">strata ${fmt(f.evLostPct, 2)} · ${Math.round(f.timeMs / 1000)} s ${f.counted ? '' : '· (powtórka — nie liczy się do rankingu)'}</div>${board(fresh.leaderboard)}</div>`;
          refreshSummary();
          return null;
        }
        const sp = queue[i++];
        head.querySelector('.di') && (head.querySelector('.di').textContent = i);
        return sp;
      },
      onResult: (r) => {
        if (r.correct) ok++;
        const el = head.querySelector('.ds');
        if (el) el.textContent = ok;
      },
    });
    player.next();
  };
}

function review(root) {
  root.innerHTML = `<div class="row between mb"><h1>🔁 Powtórki błędów</h1><a class="btn sm ghost" href="#/trening">← tryby</a></div><div class="rh"></div><div class="sp"></div>`;
  const tracker = sessionTracker();
  player = createSpotPlayer(root.querySelector('.sp'), {
    mode: 'review',
    confidence: false,
    fetchSpot: async () => {
      const r = await post('/review/next');
      root.querySelector('.rh').innerHTML = `<div class="panel mb small row between"><span>Do powtórki teraz: <b>${r.summary.due}</b> · w kolejce: ${r.summary.active} · opanowane: ${r.summary.mastered}</span><span class="muted">Błędne spoty wracają po 10 min, 1, 3, 7+ dniach</span></div>`;
      if (r.empty) return null;
      return r.spot;
    },
    onEmpty: (c) => {
      c.innerHTML = `<div class="panel center"><div style="font-size:2.5rem">🎉</div><h2>Brak zaległych powtórek</h2><p class="muted">Błędy z treningu trafiają tu automatycznie. Kolejne powtórki pojawią się, gdy przyjdzie ich termin.</p><a class="btn primary" href="#/trening/standard">Trenuj dalej</a></div>`;
    },
    onResult: (r, spot) => {
      tracker.add(r, spot);
      const slot = player.slot();
      if (slot) slot.innerHTML = tracker.html();
    },
  });
  player.next();
}

export default {
  async render(root, { parts }) {
    cleanupFns = [];
    const sub = parts[0];
    if (!sub) return hub(root);
    if (['standard', 'survival', 'time_attack'].includes(sub)) return standard(root, sub);
    if (sub === 'daily') return daily(root);
    if (sub === 'review') return review(root);
    if (sub === 'drills') {
      const m = await import('./drills.js');
      return m.renderDrills(root, parts[1]);
    }
    return hub(root);
  },
  cleanup() {
    if (player) player.destroy();
    player = null;
    cleanupFns.forEach((f) => f());
    cleanupFns = [];
    refreshSummary();
  },
};
