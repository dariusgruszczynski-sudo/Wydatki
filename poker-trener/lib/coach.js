const Anthropic = require('@anthropic-ai/sdk').default;
const db = require('./db');
const A = require('./analytics');
const C = require('./content');
const { SPOT_TYPES } = require('./spots');

const MODEL = process.env.COACH_MODEL || 'claude-opus-5-5';
const enabled = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = enabled ? new Anthropic() : null;

const SYSTEM = `Jesteś trenerem pokera turniejowego (Texas Hold'em, MTT) w aplikacji „Poker Trener”.
Uczeń gra turnieje online, często 2–3 naraz, i uczy się od podstaw do zaawansowanej strategii.
Zasady:
- Pisz po polsku, konkretnie i życzliwie. Bez nagłówków markdown; krótkie akapity lub listy z myślnikami.
- Opieraj się na liczbach, które dostajesz (EV, equity, zasięgi, ICM). Nie wymyślaj danych, których nie masz.
- Zasięgi w aplikacji to uproszczony model edukacyjny, nie pełny solver — jeśli to istotne, zaznacz to.
- Uczysz myślenia o decyzjach (EV, ICM, zasięgi), nie o wynikach pojedynczych rozdań.
- Aplikacja służy do nauki między sesjami. Nie pomagasz w podejmowaniu decyzji w trakcie gry o prawdziwe pieniądze (narzędzia RTA są zakazane przez regulaminy serwisów).`;

function status() {
  return { enabled, model: enabled ? MODEL : null };
}

async function ask({ messages, maxTokens = 2500, effort = 'medium', schema = null }) {
  if (!client) throw new Error('Coach AI nie jest skonfigurowany (brak ANTHROPIC_API_KEY).');
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: schema ? { effort, format: { type: 'json_schema', schema } } : { effort },
    messages,
  };
  let response;
  try {
    response = await client.beta.messages.create(params);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new Error('Coach AI jest chwilowo przeciążony — spróbuj za minutę.');
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Nieprawidłowy klucz ANTHROPIC_API_KEY.');
    if (e instanceof Anthropic.APIError) throw new Error(`Błąd Coach AI (${e.status}).`);
    throw new Error('Nie udało się połączyć z Coach AI.');
  }
  if (response.stop_reason === 'refusal') throw new Error('Coach AI odmówił odpowiedzi na to pytanie.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (schema) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Coach AI zwrócił nieczytelną odpowiedź — spróbuj ponownie.');
    }
  }
  return text;
}

function spotSummary(spot, result) {
  const hero = spot.seats[spot.heroIdx];
  const lines = [
    `Typ spotu: ${SPOT_TYPES[spot.type]?.label || spot.type}. Format: ${spot.format}, etap: ${spot.stage}, liczenie: ${spot.valueMode === 'chips' ? 'chip EV (bb)' : 'ICM ($)'}.`,
    `Graczy przy stole: ${spot.numPlayers}. Pula nagród: ${spot.poolTotal}. Wypłaty pozostałych miejsc: ${spot.payouts.join(', ') || 'brak (chip EV)'}.`,
    `Stosy (bb): ${spot.seats.map((s) => `${s.posLabel}${s.role === 'hero' ? ' (bohater)' : ''}=${Math.round(s.stack * 10) / 10}`).join(', ')}.`,
    `Bohater: ${hero.posLabel}, ręka ${spot.heroLabel} (${spot.heroCombo.join(' ')}).`,
    `Sytuacja: ${spot.prompt}`,
    `Decyzja ucznia: ${result.chosen}. Najlepsza wg modelu: ${result.optimal}${result.close ? ' (spot graniczny)' : ''}.`,
    result.evs ? `EV: ${Object.entries(result.evs).map(([k, v]) => `${k}=${Math.round(v * 10) / 10}${result.unit}`).join(', ')}.` : '',
    result.equityVsMain != null ? `Equity ręki vs zasięg głównego przeciwnika: ${Math.round(result.equityVsMain * 1000) / 10}%.` : '',
    result.callFreq != null ? `Częstość calla przeciwników: ${Math.round(result.callFreq * 1000) / 10}%.` : '',
    result.breakEven?.breakEven != null ? `Próg equity do calla: ICM ${Math.round(result.breakEven.breakEven * 1000) / 10}%, chip EV ${Math.round(result.breakEven.chipBreakEven * 1000) / 10}%.` : '',
    `Zasięgi: ${(result.ranges || []).filter((r) => r.holdPct || r.callPct).map((r) => `${r.pos}: ${r.holdPct != null ? `trzyma ~${r.holdPct}%` : ''}${r.callPct != null ? ` sprawdza ~${r.callPct}%` : ''}`).join('; ')}.`,
  ];
  return lines.filter(Boolean).join('\n');
}

async function explainSpot(spot, result) {
  return ask({
    effort: 'low',
    maxTokens: 1500,
    messages: [
      {
        role: 'user',
        content: `Wyjaśnij uczniowi ten spot w 4–7 zdaniach: dlaczego najlepsza decyzja jest najlepsza, jaki był kluczowy czynnik (fold equity, equity, ICM, stos, pozycja) i jedną praktyczną regułę na przyszłość.\n\n${spotSummary(spot, result)}`,
      },
    ],
  });
}

async function analyzeJournal(entry, hand) {
  const handText = hand
    ? `Zaimportowana ręka (${hand.site}): blindy ${hand.sb}/${hand.bb}, ante ${hand.ante}. Bohater ${hand.hero_pos} z ${hand.hero_cards}, stos ${hand.hero_stack_bb}bb. Board: ${hand.board || '—'}. Wynik: ${hand.result_bb}bb.\nAkcje: ${JSON.parse(hand.actions_json)
        .filter((a) => a.type === 'action' || a.type === 'board')
        .map((a) => (a.type === 'board' ? `[${a.street}: ${a.cards.join(' ')}]` : `${a.pos || a.name} ${a.verb}${a.amount ? ' ' + a.amount : ''}${a.allin ? ' all-in' : ''}`))
        .join(', ')}`
    : '';
  const entryText = entry
    ? `Wpis z dziennika: ${entry.title || ''}. Etap: ${entry.stage || '—'}, pozycja: ${entry.position || '—'}, stos: ${entry.stack_bb ?? '—'}bb, karty: ${entry.hero_cards || '—'}, board: ${entry.board || '—'}.\nPrzebieg: ${entry.action_summary || '—'}\nWynik: ${entry.result || '—'} (${entry.result_bb ?? '—'}bb). Notatki ucznia: ${entry.notes || '—'}. Tagi: ${entry.tags || '—'}.`
    : '';
  return ask({
    effort: 'medium',
    maxTokens: 2500,
    messages: [
      {
        role: 'user',
        content: `Przeanalizuj to rozdanie. Oceń kluczowe decyzje (dobra / dyskusyjna / błąd) z krótkim uzasadnieniem, wskaż najważniejszą lekcję i zaproponuj tag do dziennika. Jeśli brakuje informacji, powiedz, czego brakuje.\n\n${entryText}\n${handText}`,
      },
    ],
  });
}

function statsContext(profileId) {
  const ov = A.overview(profileId);
  const leaks = A.leaks(profileId).slice(0, 5);
  const timer = A.timerComparison(profileId);
  const tilt = A.tilt(profileId);
  const drills = A.drillStats(profileId);
  const profile = db.prepare('SELECT path_stage FROM profiles WHERE id = ?').get(profileId);
  const stage = C.getStages().find((s) => s.stage === Math.min(profile.path_stage, C.MAX_STAGE));
  return [
    `Poziom ścieżki: ${profile.path_stage} (${stage ? stage.name : 'ukończona'}).`,
    `Decyzje w trenerze: ${ov.total.n}, trafność ${ov.total.accuracy ?? '—'}%, strata ICM ${ov.total.lossPct}% puli, strata chip EV ${ov.total.lossBB}bb.`,
    `Wg typu: ${ov.byType.map((t) => `${t.label} ${t.accuracy}% (n=${t.n})`).join('; ') || 'brak'}.`,
    `Leaki: ${leaks.map((l) => `${l.message} (trafność ${l.accuracy}%)`).join(' | ') || 'brak wyraźnych leaków (za mało danych lub dobra gra)'}.`,
    `Timer: ${timer.filter((t) => t.n).map((t) => `${t.label}: ${t.accuracy}% (n=${t.n})`).join('; ') || 'brak danych'}.`,
    `Tilt: po 2+ błędach trafność ${tilt.afterErrors.accuracy ?? '—'}% vs średnio ${tilt.base.accuracy ?? '—'}%. ${tilt.warnings.join(' ')}`,
    `Ćwiczenia podstaw: ${drills.map((d) => `${d.type} ${d.accuracy}% (n=${d.n})`).join('; ') || 'brak'}.`,
  ].join('\n');
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    focus: { type: 'array', items: { type: 'string' } },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string' },
          theme: { type: 'string' },
          tasks: { type: 'array', items: { type: 'string' } },
          minutes: { type: 'integer' },
        },
        required: ['day', 'theme', 'tasks', 'minutes'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'focus', 'days'],
  additionalProperties: false,
};

async function trainingPlan(profileId, minutesPerDay = 30) {
  return ask({
    effort: 'medium',
    maxTokens: 6000,
    schema: PLAN_SCHEMA,
    messages: [
      {
        role: 'user',
        content: `Na podstawie statystyk ucznia ułóż plan treningowy na 7 dni (pn–nd), ok. ${minutesPerDay} minut dziennie. Używaj modułów aplikacji: Trener (typy spotów, filtry pozycji i stosów, tryb Speed, tryb Eksploatacja), Powtórki błędów, Wyzwanie dnia, Survival, Time attack, Symulator turnieju, Sesja multi-table, Ćwiczenia podstaw, Lekcje, Egzaminy, Dziennik/Import HH. Każde zadanie ma być konkretne (np. „40 spotów call vs shove, pozycja BB, stos 11–15bb”). „focus” to 1–3 główne cele tygodnia.\n\n${statsContext(profileId)}`,
      },
    ],
  });
}

async function sessionSummary(profileId, attemptIds) {
  const rows = attemptIds.length
    ? db
        .prepare(`SELECT spot_type, hero_position, hero_stack_bb, hero_label, chosen_action, optimal_action, correct, ev_lost, pool_total, value_mode, time_taken_ms FROM trainer_attempts WHERE profile_id = ? AND id IN (${attemptIds.map(() => '?').join(',')})`)
        .all(profileId, ...attemptIds)
    : [];
  if (!rows.length) throw new Error('Brak decyzji w tej sesji.');
  const text = rows.map((r) => `${r.spot_type} ${r.hero_position} ${r.hero_stack_bb}bb ${r.hero_label}: ${r.chosen_action} (opt ${r.optimal_action}) ${r.correct ? 'OK' : 'BŁĄD'}${r.ev_lost ? ` strata ${r.value_mode === 'chips' ? r.ev_lost.toFixed(1) + 'bb' : ((r.ev_lost / r.pool_total) * 100).toFixed(2) + '% puli'}` : ''}, ${Math.round((r.time_taken_ms || 0) / 100) / 10}s`).join('\n');
  return ask({
    effort: 'low',
    maxTokens: 1500,
    messages: [{ role: 'user', content: `Podsumuj tę sesję treningową w 4–6 zdaniach: co poszło dobrze, jaki wzorzec błędów widać, jedno konkretne zadanie na następną sesję.\n\n${text}` }],
  });
}

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctIndex: { type: 'integer' },
          explanation: { type: 'string' },
        },
        required: ['q', 'options', 'correctIndex', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

async function mistakeQuiz(profileId) {
  const errors = A.topErrors(profileId, 12);
  if (!errors.length) throw new Error('Brak błędów do przerobienia — świetnie!');
  const text = errors.map((e) => `${e.typeLabel}, ${e.pos}, ${e.stack}bb, ${e.hand}, etap ${e.stage}: zagrano ${e.chosen}, lepiej ${e.optimal}`).join('\n');
  const out = await ask({
    effort: 'medium',
    maxTokens: 5000,
    schema: QUIZ_SCHEMA,
    messages: [
      {
        role: 'user',
        content: `Na podstawie błędów ucznia ułóż 5 pytań wielokrotnego wyboru (4 odpowiedzi, jedna poprawna) sprawdzających ZASADY stojące za tymi błędami (fold equity, ICM, zasięgi wg pozycji, wpływ stosu), a nie zapamiętanie konkretnych rąk. Wyjaśnienie: 1–2 zdania.\n\n${text}`,
      },
    ],
  });
  return out.questions.filter((q) => Array.isArray(q.options) && q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length).slice(0, 5);
}

async function chat(profileId, thread, message) {
  const history = db
    .prepare('SELECT role, content FROM ai_messages WHERE profile_id = ? AND thread = ? ORDER BY id DESC LIMIT 20')
    .all(profileId, thread)
    .reverse();
  const messages = [
    { role: 'user', content: `Kontekst ucznia (aktualne statystyki z aplikacji):\n${statsContext(profileId)}\n\nZapamiętaj ten kontekst; odpowiadaj na kolejne pytania.` },
    { role: 'assistant', content: 'Jasne — mam Twoje statystyki. O co chcesz zapytać?' },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];
  const reply = await ask({ effort: 'medium', maxTokens: 3000, messages });
  const now = new Date().toISOString();
  const ins = db.prepare('INSERT INTO ai_messages (profile_id, thread, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
  ins.run(profileId, thread, 'user', message, now);
  ins.run(profileId, thread, 'assistant', reply, now);
  return reply;
}

function chatHistory(profileId, thread) {
  return db.prepare('SELECT role, content, created_at FROM ai_messages WHERE profile_id = ? AND thread = ? ORDER BY id ASC LIMIT 200').all(profileId, thread);
}

function clearChat(profileId, thread) {
  db.prepare('DELETE FROM ai_messages WHERE profile_id = ? AND thread = ?').run(profileId, thread);
}

// Plan bez AI (fallback): reguły z raportu leaków.
function rulePlan(profileId, minutesPerDay = 30) {
  const leaks = A.leaks(profileId).slice(0, 3);
  const ov = A.overview(profileId);
  const focus = leaks.length ? leaks.map((l) => l.message) : ['Zbuduj bazę: min. 150 decyzji w trenerze, żeby raport leaków miał dane.'];
  const leakTask = (l) => `${Math.round(minutesPerDay * 0.6)} min: trener — ${l.typeLabel}, pozycja ${l.group}, stos ${l.bucket} (filtry trenera)`;
  const names = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
  const days = names.map((day, i) => {
    const l = leaks[i % Math.max(1, leaks.length)];
    const tasks = [];
    if (i === 5) tasks.push(`${minutesPerDay} min: symulator turnieju (45 graczy) albo sesja 2 stołów`);
    else if (i === 6) tasks.push('Wyzwanie dnia', 'Przegląd raportu leaków i ustawienie celów na kolejny tydzień');
    else {
      tasks.push('Wyzwanie dnia (rozgrzewka)');
      tasks.push(l ? leakTask(l) : `${Math.round(minutesPerDay * 0.6)} min: trener w trybie mix z adaptacją`);
      tasks.push('Powtórki błędów (wszystkie zaległe)');
      if (i % 2 === 0) tasks.push('1 lekcja z bieżącego poziomu ścieżki + quiz');
    }
    return { day, theme: l ? l.typeLabel : 'Trening ogólny', tasks, minutes: minutesPerDay };
  });
  return { summary: `Plan oparty na ${ov.total.n} decyzjach (trafność ${ov.total.accuracy ?? '—'}%). Generowany regułowo — z kluczem ANTHROPIC_API_KEY plan ułoży Coach AI.`, focus, days, ai: false };
}

module.exports = { status, explainSpot, analyzeJournal, trainingPlan, rulePlan, sessionSummary, mistakeQuiz, chat, chatHistory, clearChat };
