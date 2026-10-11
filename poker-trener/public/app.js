const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_RED = new Set(['h', 'd']);

function cardEl(cardStr) {
  const rank = cardStr[0];
  const suit = cardStr[1];
  const div = document.createElement('div');
  div.className = 'card' + (SUIT_RED.has(suit) ? ' red' : '');
  div.textContent = rank + SUIT_SYMBOL[suit];
  return div;
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Błąd ${res.status}`);
  }
  return res.json();
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2200);
}

function switchTab(tab) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.bnav').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'lekcje') loadLessons();
  if (tab === 'dziennik') loadJournal();
  if (tab === 'statystyki') loadStats();
}

document.querySelectorAll('.tab, .bnav').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ---------- Trener ICM ----------

let currentScenario = null;
let timerHandle = null;
let decisionStartedAt = null;
const session = { total: 0, correct: 0, evLost: 0 };

function updateSessionPanel() {
  document.getElementById('session-total').textContent = session.total;
  document.getElementById('session-accuracy').textContent =
    session.total === 0 ? '—' : Math.round((session.correct / session.total) * 100) + '%';
  document.getElementById('session-ev').textContent = Math.round(session.evLost).toLocaleString('pl-PL');
}

async function newScenario() {
  clearInterval(timerHandle);
  const decisionType = document.getElementById('cfg-decision').value;
  const speedMs = Number(document.getElementById('cfg-speed').value) || 0;
  const scenario = await api('/api/trainer/scenario', {
    method: 'POST',
    body: JSON.stringify({ decisionType: decisionType || undefined, speedMs: speedMs || undefined }),
  });
  currentScenario = scenario;
  renderScenario(scenario, speedMs);
}

function renderScenario(s, speedMs) {
  document.getElementById('scenario-empty').classList.add('hidden');
  document.getElementById('scenario-box').classList.remove('hidden');
  document.getElementById('result-box').classList.add('hidden');

  document.getElementById('meta-players').textContent = `${s.numPlayers} graczy przy stołach`;
  document.getElementById('meta-pool').textContent = `Pula: ${s.poolTotal.toLocaleString('pl-PL')}`;
  document.getElementById('meta-paid').textContent = `Płatne miejsca: ${s.paidPlaces}`;

  document.getElementById('hero-pos').textContent = s.heroPositionLabel;
  document.getElementById('hero-stack').textContent = `${s.heroStackBB} bb`;
  const heroCardsEl = document.getElementById('hero-cards');
  heroCardsEl.innerHTML = '';
  s.heroCombo.forEach((c) => heroCardsEl.appendChild(cardEl(c)));

  document.getElementById('villain-pos').textContent = s.villainPositionLabel;
  document.getElementById('villain-stack').textContent = `${s.villainStackBB} bb`;

  const prompt = document.getElementById('decision-prompt');
  if (s.decisionType === 'open_shove') {
    prompt.textContent = `Jesteś na ${s.heroPositionLabel} ze stosem ${s.heroStackBB}bb. Pierwszy przy akcji. Shove czy fold?`;
  } else {
    prompt.textContent = `Jesteś na BB. ${s.villainPositionLabel} idzie all-in. Call czy fold?`;
  }

  const actionsEl = document.getElementById('action-buttons');
  actionsEl.innerHTML = '';
  s.actionLabel.forEach((label) => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (label === 'fold' ? 'secondary' : 'primary');
    btn.textContent = label === 'shove' ? '🚀 Shove' : label === 'call' ? '✅ Call' : '❌ Fold';
    btn.addEventListener('click', () => submitDecision(label, false));
    actionsEl.appendChild(btn);
  });

  const timerBar = document.getElementById('timer-bar');
  if (speedMs > 0) {
    timerBar.classList.remove('hidden');
    startTimer(speedMs);
  } else {
    timerBar.classList.add('hidden');
  }

  decisionStartedAt = Date.now();
}

function startTimer(ms) {
  const fill = document.getElementById('timer-fill');
  fill.style.width = '100%';
  fill.classList.remove('warn', 'danger');
  const start = Date.now();
  clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    const elapsed = Date.now() - start;
    const pct = Math.max(0, 100 - (elapsed / ms) * 100);
    fill.style.width = pct + '%';
    if (pct < 50) fill.classList.add('warn');
    if (pct < 20) fill.classList.add('danger');
    if (elapsed >= ms) {
      clearInterval(timerHandle);
      submitDecision(null, true);
    }
  }, 100);
}

async function submitDecision(action, timedOut) {
  if (!currentScenario) return;
  clearInterval(timerHandle);
  const timeTakenMs = Date.now() - decisionStartedAt;
  document.getElementById('action-buttons').querySelectorAll('button').forEach((b) => (b.disabled = true));

  const result = await api('/api/trainer/decision', {
    method: 'POST',
    body: JSON.stringify({ id: currentScenario.id, action, timeTakenMs, timedOut }),
  });

  session.total++;
  if (result.correct) session.correct++;
  session.evLost += result.evLostByChoice;
  updateSessionPanel();

  const box = document.getElementById('result-box');
  box.classList.remove('hidden', 'correct', 'incorrect');
  box.classList.add(result.correct ? 'correct' : 'incorrect');
  const actionWord = { shove: 'Shove', call: 'Call', fold: 'Fold' };
  box.innerHTML = `
    <div class="verdict ${result.correct ? 'correct' : 'incorrect'}">
      ${timedOut ? '⏱️ Czas minął — auto-fold. ' : ''}${result.correct ? '✅ Dobra decyzja!' : '❌ Błąd'}
    </div>
    <div>Optymalnie: <strong>${actionWord[result.optimalAction]}</strong> · Twoja decyzja: <strong>${actionWord[result.chosenAction] || actionWord.fold}</strong></div>
    <div>EV(fold): ${result.evFold.toFixed(0)} · EV(agresja): ${result.evAggressive.toFixed(0)}</div>
    <div>Equity vs zasięg przeciwnika: ${(result.winProb * 100).toFixed(1)}% · Zasięg przeciwnika: ~${result.rangePercent}% najlepszych rąk</div>
    ${result.correct ? '' : `<div>Koszt błędu (ICM): <strong>${result.evLostByChoice.toFixed(0)}</strong></div>`}
  `;
}

document.getElementById('btn-new-scenario').addEventListener('click', () => newScenario().catch((e) => showToast(e.message)));

// ---------- Lekcje ----------

let lessonsCache = null;

async function loadLessons() {
  const lessons = await api('/api/lessons');
  lessonsCache = lessons;
  const list = document.getElementById('lessons-list');
  list.innerHTML = '';
  lessons.forEach((l) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="lesson-title"><span>${l.title}</span>${l.completed ? '<span class="lesson-done-badge">✓</span>' : ''}</div><div class="lesson-summary">${l.summary}</div>`;
    li.addEventListener('click', () => openLesson(l.id));
    list.appendChild(li);
  });
}

async function openLesson(id) {
  document.querySelectorAll('#lessons-list li').forEach((li, i) => li.classList.toggle('active', lessonsCache[i].id === id));
  const lesson = await api(`/api/lessons/${id}`);
  const detail = document.getElementById('lesson-detail');
  detail.innerHTML = `
    <h2>${lesson.title}</h2>
    <div class="key-points"><ul>${lesson.keyPoints.map((k) => `<li>${k}</li>`).join('')}</ul></div>
    ${lesson.body.map((p) => `<p>${p}</p>`).join('')}
    <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">
      <button class="btn secondary" id="btn-complete">Oznacz jako zrobione</button>
      ${lesson.quizId ? `<button class="btn primary" id="btn-quiz">Rozwiąż quiz</button>` : ''}
    </div>
  `;
  document.getElementById('btn-complete').addEventListener('click', async () => {
    await api(`/api/lessons/${id}/complete`, { method: 'POST' });
    showToast('Lekcja oznaczona jako zrobiona');
    loadLessons();
  });
  if (lesson.quizId) {
    document.getElementById('btn-quiz').addEventListener('click', () => openQuiz(lesson.quizId));
  }
}

// ---------- Quiz modal ----------

async function openQuiz(quizId) {
  const quiz = await api(`/api/quizzes/${quizId}`);
  const modal = document.getElementById('quiz-modal');
  const content = document.getElementById('quiz-modal-content');
  const selected = new Array(quiz.questions.length).fill(null);

  function render() {
    content.innerHTML = `<h2>${quiz.title}</h2>` + quiz.questions.map((q, qi) => `
      <div class="quiz-question" data-qi="${qi}">
        <p>${qi + 1}. ${q.q}</p>
        ${q.options.map((opt, oi) => `<button class="quiz-option ${selected[qi] === oi ? 'selected' : ''}" data-qi="${qi}" data-oi="${oi}">${opt}</button>`).join('')}
      </div>
    `).join('') + `<button class="btn primary wide" id="btn-submit-quiz" style="margin-top:12px;">Sprawdź odpowiedzi</button>
       <button class="btn secondary wide" id="btn-close-quiz" style="margin-top:8px;">Zamknij</button>`;

    content.querySelectorAll('.quiz-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected[Number(btn.dataset.qi)] = Number(btn.dataset.oi);
        render();
      });
    });
    document.getElementById('btn-submit-quiz').addEventListener('click', submit);
    document.getElementById('btn-close-quiz').addEventListener('click', () => modal.classList.add('hidden'));
  }

  async function submit() {
    const res = await api(`/api/quizzes/${quizId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers: selected }),
    });
    content.innerHTML = `<h2>${quiz.title} — wynik: ${res.score}/${res.total}</h2>` + quiz.questions.map((q, qi) => {
      const r = res.results[qi];
      return `<div class="quiz-question">
        <p>${qi + 1}. ${q.q}</p>
        ${q.options.map((opt, oi) => {
          let cls = 'quiz-option';
          if (oi === r.correctIndex) cls += ' right';
          else if (oi === selected[qi]) cls += ' wrong';
          return `<div class="${cls}">${opt}</div>`;
        }).join('')}
        <p class="hint">${r.explanation}</p>
      </div>`;
    }).join('') + `<button class="btn secondary wide" id="btn-close-quiz2">Zamknij</button>`;
    document.getElementById('btn-close-quiz2').addEventListener('click', () => modal.classList.add('hidden'));
  }

  render();
  modal.classList.remove('hidden');
}

// ---------- Dziennik rozdań ----------

async function loadJournal() {
  const rows = await api('/api/journal');
  const list = document.getElementById('journal-list');
  list.innerHTML = '';
  if (rows.length === 0) {
    list.innerHTML = '<p class="hint">Brak wpisów. Dodaj pierwszą rozdaną rękę do analizy.</p>';
    return;
  }
  rows.forEach((r) => {
    const div = document.createElement('div');
    div.className = 'journal-entry';
    div.innerHTML = `
      <button class="j-delete" data-id="${r.id}">✕</button>
      <div class="j-title">${r.title || '(bez tytułu)'} ${r.result ? `· ${r.result}` : ''}</div>
      <div class="j-meta">${r.stage || ''} ${r.position ? '· ' + r.position : ''} ${r.stack_bb != null ? '· ' + r.stack_bb + 'bb' : ''} ${r.hero_cards ? '· ' + r.hero_cards : ''}</div>
      ${r.notes ? `<div class="j-meta">📝 ${r.notes}</div>` : ''}
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('.j-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/journal/${btn.dataset.id}`, { method: 'DELETE' });
      loadJournal();
    });
  });
}

document.getElementById('journal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/journal', {
    method: 'POST',
    body: JSON.stringify({
      title: document.getElementById('j-title').value,
      stage: document.getElementById('j-stage').value,
      position: document.getElementById('j-position').value,
      stackBb: document.getElementById('j-stack').value ? Number(document.getElementById('j-stack').value) : null,
      heroCards: document.getElementById('j-cards').value,
      board: document.getElementById('j-board').value,
      actionSummary: document.getElementById('j-action').value,
      result: document.getElementById('j-result').value,
      resultBb: document.getElementById('j-result-bb').value ? Number(document.getElementById('j-result-bb').value) : null,
      notes: document.getElementById('j-notes').value,
      tags: document.getElementById('j-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    }),
  });
  e.target.reset();
  showToast('Zapisano rozdanie');
  loadJournal();
});

// ---------- Statystyki ----------

async function loadStats() {
  const stats = await api('/api/trainer/stats');
  const overview = document.getElementById('stats-overview');
  const total = stats.overall.total || 0;
  const acc = total ? Math.round((stats.overall.correctCount / total) * 100) : 0;
  overview.innerHTML = `
    <div class="stat"><span class="stat-value">${total}</span><span class="stat-label">decyzji łącznie</span></div>
    <div class="stat"><span class="stat-value">${acc}%</span><span class="stat-label">trafność</span></div>
    <div class="stat"><span class="stat-value">${Math.round(stats.overall.evLost || 0)}</span><span class="stat-label">EV zgubione razem</span></div>
    <div class="stat"><span class="stat-value">${stats.overall.avgTimeMs ? Math.round(stats.overall.avgTimeMs / 100) / 10 : '—'}s</span><span class="stat-label">śr. czas decyzji</span></div>
  `;

  const byType = document.getElementById('stats-bytype');
  byType.innerHTML = stats.byType.map((t) => {
    const pct = Math.round((t.correctCount / t.total) * 100);
    const label = t.decisionType === 'open_shove' ? 'Open shove' : 'Call vs shove';
    return `<div class="recent-row"><span>${label}</span><span>${pct}% (${t.correctCount}/${t.total})</span></div>`;
  }).join('') || '<p class="hint">Jeszcze brak danych.</p>';

  const byDay = document.getElementById('stats-byday');
  const days = stats.byDay.slice().reverse();
  const maxTotal = Math.max(1, ...days.map((d) => d.total));
  byDay.innerHTML = days.map((d) => {
    const pct = Math.round((d.correctCount / d.total) * 100);
    const h = Math.max(4, (d.total / maxTotal) * 90);
    return `<div class="byday-bar ${pct < 60 ? 'low' : ''}" style="height:${h}px" title="${d.day}: ${pct}% (${d.total})"></div>`;
  }).join('') || '<p class="hint">Jeszcze brak danych.</p>';

  const recent = document.getElementById('stats-recent');
  recent.innerHTML = stats.recent.map((r) => `
    <div class="recent-row ${r.correct ? 'correct' : 'incorrect'}">
      <span>${r.hero_position}→${r.decision_type === 'open_shove' ? 'shove' : 'call'} vs ${r.villain_position} (${r.hero_stack_bb}bb)</span>
      <span>${r.correct ? '✓' : '✗ -' + Math.round(r.ev_lost)}</span>
    </div>
  `).join('') || '<p class="hint">Jeszcze brak danych.</p>';
}

updateSessionPanel();
