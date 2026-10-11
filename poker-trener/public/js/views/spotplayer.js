import { post } from '../api.js';
import { store, settings, updateProgress } from '../store.js';
import { esc, fmt, money, isMobile, ACTION_PL } from '../ui/dom.js';
import { cardsHtml } from '../ui/cards.js';
import { tableHtml, animateBet, payoutsHtml } from '../ui/table.js';
import { gridHtml } from '../ui/grid.js';
import { feedback, confetti, shake, sound } from '../ui/fx.js';
import { toast, errorToast, achievementToasts } from '../ui/overlay.js';
import { setKeys, onSwipe } from '../ui/input.js';

const OPP_TYPES = [['reg', 'Regular'], ['nit', 'Nit'], ['lag', 'LAG'], ['maniac', 'Maniak'], ['fish', 'Rekreacyjny']];

export function evBarsHtml(result, spot) {
  if (!result.evs) return '';
  const entries = Object.entries(result.evs);
  const vals = entries.map(([, v]) => v);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = max - min || 1;
  return `<div class="ev-bars">${entries
    .map(([a, v]) => {
      const w = 35 + ((v - min) / span) * 65;
      const best = a === result.optimal;
      return `<b>${ACTION_PL[a]}</b><div class="b"><i style="width:${w}%;background:${best ? 'var(--accent)' : 'var(--muted)'}"></i></div><span class="nowrap">${money(v, result.unit)}</span>`;
    })
    .join('')}</div>${spot.valueMode === 'icm' && result.evDelta != null ? `<div class="small muted">Różnica: ${money(Math.abs(result.evDelta), '$')} = ${fmt((Math.abs(result.evDelta) / spot.poolTotal) * 100, 2)}% puli nagród</div>` : ''}`;
}

export function rangesHtml(result, spot) {
  const main = result.ranges.find((r) => r.idx === spot.mainVillainIdx) || result.ranges[0];
  if (!main) return '';
  const layers = [];
  if (main.holdLabels && main.status !== 'toAct' && spot.type !== 'rfi') layers.push({ labels: main.holdLabels, cls: 'on2' });
  if (main.callLabels) layers.push({ labels: main.callLabels, cls: 'on' });
  if (spot.type === 'rfi') layers.push({ labels: main.holdLabels, cls: 'on3' });
  const legend = spot.type === 'rfi'
    ? `<span><i style="background:var(--accent)"></i>zasięg otwarcia ~${main.holdPct}%</span>`
    : `${main.holdLabels && main.status !== 'toAct' ? `<span><i style="background:var(--warn)"></i>${main.status === 'allin' ? 'zasięg shove' : 'zasięg otwarcia'} ~${main.holdPct}%</span>` : ''}${main.callLabels ? `<span><i style="background:var(--danger)"></i>${main.status === 'toAct' ? 'sprawdza Twój all-in' : 'sprawdza 3-bet'} ~${main.callPct}%</span>` : ''}`;
  const others = result.ranges.filter((r) => r !== main && (r.callPct || r.holdPct)).map((r) => `${esc(r.pos)}: ${r.holdPct && r.status !== 'toAct' ? `trzyma ~${r.holdPct}%` : ''} ${r.callPct ? `sprawdza ~${r.callPct}%` : ''}`).join(' · ');
  return `<div class="small muted mb">Zasięg gracza ${esc(main.pos)}</div>${gridHtml({ layers, hero: spot.heroLabel })}<div class="legend">${legend}<span><i style="outline:2px solid var(--gold-2)"></i>Twoja ręka</span></div>${others ? `<div class="tiny muted mt">Pozostali: ${others}</div>` : ''}`;
}

export function createSpotPlayer(container, opts) {
  const o = {
    mode: 'standard',
    speedMs: 0,
    side: true,
    compact: false,
    keys: true,
    confidence: settings().confidence,
    autoNext: settings().autoNext,
    autoNextDelay: settings().autoNextDelay || 2500,
    ...opts,
  };
  let spot = null;
  let startedAt = 0;
  let timerH = null;
  let autoH = null;
  let busy = false;
  let decided = false;
  let confidence = null;
  let destroyed = false;

  container.innerHTML = `
    <div class="${o.side && !o.compact ? 'grid trainer' : ''}">
      <div class="panel sp-main">
        <div class="row between mb sp-head"></div>
        <div class="sp-table"></div>
        <div class="hero-hand sp-hand"></div>
        <div class="prompt sp-prompt"></div>
        <div class="timer hidden sp-timer"><i></i></div>
        <div class="actions sp-actions"></div>
        <div class="conf sp-conf ${o.confidence && !o.compact ? '' : 'hidden'}">
          <span class="small muted">Pewność:</span>
          <span class="chip" data-c="sure">💪 pewny <kbd>1</kbd></span><span class="chip" data-c="medium">🤔 raczej <kbd>2</kbd></span><span class="chip" data-c="guess">🎲 zgaduję <kbd>3</kbd></span>
        </div>
        <div class="sp-result"></div>
      </div>
      ${o.side && !o.compact ? `<div class="col sp-side">
        <div class="panel ${isMobile() ? 'hidden' : ''} sp-payouts"><h3>Wypłaty i ICM</h3><div class="sp-pay"></div></div>
        <div class="sp-slot"></div>
      </div>` : ''}
    </div>`;
  const q = (s) => container.querySelector(s);

  function clearTimers() {
    clearInterval(timerH);
    clearTimeout(autoH);
  }

  function header() {
    const chips = [
      `<span class="pill gold">${esc(spot.typeLabel)}</span>`,
      spot.formatLabel ? `<span class="pill">${esc(spot.formatLabel)}</span>` : '',
      spot.stageLabel ? `<span class="pill">${esc(spot.stageLabel)}</span>` : '',
      spot.mode === 'exploit' ? '<span class="pill bad">eksploatacja</span>' : '',
      spot.review ? `<span class="pill">🔁 powtórka #${spot.review.reps + 1}</span>` : '',
      spot.focus && spot.focus.acc != null ? `<span class="pill" title="Adaptacja: trenujesz to, gdzie masz najniższą trafność">🎯 Twoja trafność tu: ${Math.round(spot.focus.acc * 100)}%</span>` : '',
    ].join('');
    return `<div class="chips">${chips}</div>${o.headerRight || ''}`;
  }

  function renderSpot() {
    decided = false;
    confidence = null;
    q('.sp-head').innerHTML = header();
    q('.sp-table').innerHTML = tableHtml(spot, { compact: o.compact });
    q('.sp-hand').innerHTML = cardsHtml(spot.heroCombo, { size: o.compact ? '' : 'lg', deal: true });
    q('.sp-prompt').textContent = spot.prompt;
    q('.sp-result').innerHTML = '';
    q('.sp-conf').querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
    const keyOf = (a) => (a === 'fold' ? 'F' : a === 'call' ? 'C' : a === 'raise' ? 'R' : 'S');
    q('.sp-actions').innerHTML = spot.actions
      .map((a) => `<button class="btn lg ${a === 'fold' ? '' : 'primary'}" data-act="${a}">${a === 'fold' ? '✋' : a === 'call' ? '✅' : a === 'raise' ? '⬆️' : '🚀'} ${ACTION_PL[a]} ${o.compact ? '' : `<kbd>${keyOf(a)}</kbd>`}</button>`)
      .join('');
    const pay = q('.sp-pay');
    if (pay) pay.innerHTML = payoutsHtml(spot);
    sound('deal');
    startedAt = Date.now();
    const speed = spot.speedMs || o.speedMs;
    const tm = q('.sp-timer');
    if (speed) {
      tm.classList.remove('hidden', 'warn', 'danger');
      const bar = tm.firstElementChild;
      bar.style.width = '100%';
      timerH = setInterval(() => {
        const left = 1 - (Date.now() - startedAt) / speed;
        bar.style.width = `${Math.max(0, left * 100)}%`;
        tm.classList.toggle('warn', left < 0.5);
        tm.classList.toggle('danger', left < 0.2);
        if (left <= 0) {
          clearInterval(timerH);
          decide(null, true);
        }
      }, 100);
    } else tm.classList.add('hidden');
    if (o.onSpot) o.onSpot(spot);
  }

  async function next() {
    if (destroyed) return;
    clearTimers();
    busy = true;
    q('.sp-actions').innerHTML = '<span class="muted">Rozdaję…</span>';
    try {
      const s = await o.fetchSpot();
      if (destroyed) return;
      if (!s) {
        if (o.onEmpty) o.onEmpty(container);
        return;
      }
      spot = s;
      renderSpot();
    } catch (e) {
      errorToast(e);
      q('.sp-actions').innerHTML = '<button class="btn" data-retry>Spróbuj ponownie</button>';
    } finally {
      busy = false;
    }
  }

  async function decide(action, timedOut = false) {
    if (!spot || decided || busy) return;
    decided = true;
    busy = true;
    clearInterval(timerH);
    const levelBefore = store.summary?.level?.level;
    q('.sp-actions').querySelectorAll('button').forEach((b) => (b.disabled = true));
    if (action && action !== 'fold') animateBet(q('.sp-table'), spot.heroIdx, ACTION_PL[action]);
    try {
      const r = await post('/spots/decide', { id: spot.id, action, timedOut, timeTakenMs: Date.now() - startedAt, confidence });
      if (destroyed) return;
      feedback(r.correct, r.close);
      if (!r.correct) shake(q('.sp-main'));
      updateProgress(r);
      achievementToasts(r.newAchievements);
      if (r.level && levelBefore && r.level.level > levelBefore) {
        confetti();
        sound('level');
        toast(`⭐ Poziom ${r.level.level}: ${r.level.name}!`, 'gold');
      }
      renderResult(r, timedOut);
      if (o.onResult) o.onResult(r, spot);
      if (o.autoNext && !o.manualNext) autoH = setTimeout(() => !destroyed && next(), o.autoNextDelay);
    } catch (e) {
      errorToast(e);
      decided = false;
    } finally {
      busy = false;
    }
  }

  function renderResult(r, timedOut) {
    spot.__lastOptimal = r.optimal;
    const verdict = timedOut ? '⏱️ Czas minął — auto-pas' : r.close ? (r.chosen === r.optimal ? '✅ Dobrze (spot graniczny)' : '🟡 Spot graniczny — OK') : r.correct ? '✅ Dobra decyzja' : '❌ Błąd';
    const cls = r.close ? 'close' : r.correct ? 'good' : 'bad';
    const showWhatIf = !o.compact && r.evs;
    q('.sp-result').innerHTML = `
      <div class="result ${cls} pop">
        <div class="row between"><div class="verdict">${verdict}</div><div class="row small">${r.xp ? `<span class="pill gold">+${r.xp} XP</span>` : ''}${r.bankrollDelta ? `<span class="pill ${r.bankrollDelta > 0 ? 'ok' : 'bad'}">💰 ${r.bankrollDelta > 0 ? '+' : ''}${fmt(r.bankrollDelta)}</span>` : ''}</div></div>
        <div class="small">Najlepiej: <b>${ACTION_PL[r.optimal]}</b> · Ty: <b>${ACTION_PL[r.chosen] || 'Pas'}</b>${!r.correct && r.evLoss ? ` · koszt błędu: <b class="bad">${money(r.evLoss, r.unit)}</b>` : ''}</div>
        ${evBarsHtml(r, spot)}
        <ul class="explain">${r.explanation.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        ${r.review ? `<div class="small muted">🔁 ${r.review.mastered ? 'Opanowane — spot znika z powtórek.' : `Następna powtórka: ${new Date(r.review.nextDue).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}</div>` : !r.correct && !r.close && !['daily', 'replay'].includes(r.mode) ? '<div class="small muted">🔁 Dodano do powtórek błędów.</div>' : ''}
        ${r.outcome ? `<div class="mt"><b>Przebieg:</b> ${esc(r.outcome.summary)}${r.outcome.board?.length ? `<div class="row mt">${cardsHtml(r.outcome.board, { size: 'sm', deal: true })}${r.outcome.shown.map((s) => `<span class="small">${esc(s.pos)}: ${cardsHtml(s.cards, { size: 'sm' })}</span>`).join('')}</div>` : ''}</div>` : ''}
        ${o.manualNext ? '' : `<div class="row mt"><button class="btn primary" data-next>Następny ${o.compact ? '' : '<kbd>Spacja</kbd>'}</button>${store.coach.enabled && !o.compact ? '<button class="btn" data-ai>🤖 Wyjaśnij (AI)</button>' : ''}</div>`}
        <div class="sp-ai small mt"></div>
      </div>
      ${o.compact ? '' : `<details class="more"><summary>Zasięg przeciwnika (siatka)</summary><div>${rangesHtml(r, spot)}</div></details>`}
      ${showWhatIf ? `<details class="more sp-whatif"><summary>Co jeśli…? (zmień parametry)</summary><div>
        <div class="grid g2">
          <label class="field">Twój stos: <b class="wi-hs-v">${fmt(spot.seats[spot.heroIdx].stack, 1)}</b> bb<input type="range" class="wi-hs" min="1" max="60" step="0.5" value="${spot.seats[spot.heroIdx].stack}"></label>
          ${spot.mainVillainIdx != null ? `<label class="field">Stos ${esc(spot.seats[spot.mainVillainIdx].posLabel)}: <b class="wi-vs-v">${fmt(spot.seats[spot.mainVillainIdx].stack, 1)}</b> bb<input type="range" class="wi-vs" min="1" max="80" step="0.5" value="${spot.seats[spot.mainVillainIdx].stack}"></label>` : '<span></span>'}
          <label class="field">Twoje karty<input class="wi-cards" placeholder="${spot.heroCombo.join('')}"></label>
          <label class="field">Typ przeciwnika<select class="wi-opp"><option value="">bez zmian</option>${OPP_TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
          <label class="field">Ante<select class="wi-ante"><option value="">bez zmian</option><option value="none">brak</option><option value="bb_ante">BB ante</option><option value="classic">klasyczne</option></select></label>
        </div>
        <button class="btn gold mt wi-go">Przelicz</button>
        <div class="wi-out mt"></div>
      </div></details>` : ''}`;
  }

  async function whatIf() {
    const changes = {};
    const hs = q('.wi-hs');
    const vs = q('.wi-vs');
    if (hs && Number(hs.value) !== spot.seats[spot.heroIdx].stack) changes.heroStack = Number(hs.value);
    if (vs && Number(vs.value) !== spot.seats[spot.mainVillainIdx].stack) changes.villainStack = Number(vs.value);
    if (q('.wi-cards').value.trim()) changes.heroCards = q('.wi-cards').value.trim();
    if (q('.wi-opp').value) changes.oppType = q('.wi-opp').value;
    if (q('.wi-ante').value) changes.anteMode = q('.wi-ante').value;
    const out = q('.wi-out');
    out.innerHTML = '<span class="muted">Liczę…</span>';
    try {
      const w = await post('/spots/whatif', { id: spot.id, changes });
      const r = w.result;
      out.innerHTML = `<div class="result ${r.close ? 'close' : ''}"><b>Po zmianie najlepiej: ${ACTION_PL[r.optimal]}${r.close ? ' (granicznie)' : ''}</b> ${r.optimal !== spot.__lastOptimal ? '<span class="pill gold">decyzja się zmienia!</span>' : ''}${evBarsHtml(r, w.spot)}<ul class="explain">${r.explanation.slice(0, 3).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
    } catch (e) {
      out.innerHTML = '';
      errorToast(e);
    }
  }

  async function aiExplain(btn) {
    btn.disabled = true;
    const box = q('.sp-ai');
    box.innerHTML = '<span class="muted">Coach analizuje…</span>';
    try {
      const r = await post('/coach/explain', { spotId: spot.id });
      box.innerHTML = `<div class="panel flat" style="white-space:pre-wrap">🤖 ${esc(r.text)}</div>`;
    } catch (e) {
      box.innerHTML = '';
      errorToast(e);
      btn.disabled = false;
    }
  }

  container.addEventListener('click', (e) => {
    const t = e.target;
    const act = t.closest('[data-act]');
    if (act) return decide(act.dataset.act);
    if (t.closest('[data-next]')) return next();
    if (t.closest('[data-retry]')) return next();
    if (t.closest('[data-ai]')) return aiExplain(t.closest('[data-ai]'));
    if (t.closest('.wi-go')) return whatIf();
    const c = t.closest('.sp-conf .chip');
    if (c) {
      confidence = confidence === c.dataset.c ? null : c.dataset.c;
      q('.sp-conf').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x.dataset.c === confidence));
    }
    if (t.closest('details') || t.closest('.sp-result')) clearTimeout(autoH);
  });
  container.addEventListener('input', (e) => {
    if (e.target.matches('.wi-hs')) q('.wi-hs-v').textContent = fmt(Number(e.target.value), 1);
    if (e.target.matches('.wi-vs')) q('.wi-vs-v').textContent = fmt(Number(e.target.value), 1);
  });

  const aggressive = () => spot && spot.actions[0];
  if (o.keys) {
    setKeys({
      s: () => spot && spot.actions.includes('shove') && decide('shove'),
      c: () => spot && spot.actions.includes('call') && decide('call'),
      r: () => spot && spot.actions.includes('raise') && decide('raise'),
      a: () => spot && decide(aggressive()),
      f: () => decide('fold'),
      Space: () => (decided ? next() : null),
      Enter: () => (decided ? next() : null),
      1: () => q('.sp-conf [data-c="sure"]')?.click(),
      2: () => q('.sp-conf [data-c="medium"]')?.click(),
      3: () => q('.sp-conf [data-c="guess"]')?.click(),
    });
  }
  onSwipe(q('.sp-table'), { left: () => !decided && decide('fold'), right: () => !decided && spot && decide(aggressive()) });

  return {
    next,
    decide,
    get spot() {
      return spot;
    },
    slot: () => q('.sp-slot'),
    destroy() {
      destroyed = true;
      clearTimers();
    },
    setSpot(s) {
      spot = s;
      renderSpot();
    },
  };
}
