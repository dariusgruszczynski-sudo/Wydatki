const path = require('path');
const crypto = require('crypto');
const express = require('express');

const db = require('./lib/db');
const { buildScenario, resolveDecision } = require('./lib/scenarios');
const { getLessons, getLesson, getQuiz, getQuizForLesson } = require('./lib/content');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const pendingScenarios = new Map();
const PENDING_TTL_MS = 15 * 60 * 1000;

function cleanupPending() {
  const now = Date.now();
  for (const [id, entry] of pendingScenarios) {
    if (now - entry.createdAt > PENDING_TTL_MS) pendingScenarios.delete(id);
  }
}
setInterval(cleanupPending, 5 * 60 * 1000);

function publicScenario(id, scenario, speedMs) {
  return {
    id,
    decisionType: scenario.decisionType,
    numPlayers: scenario.numPlayers,
    paidPlaces: scenario.paidPlaces,
    poolTotal: scenario.poolTotal,
    payouts: scenario.payouts,
    heroPosition: scenario.heroPosition,
    heroPositionLabel: scenario.heroPositionLabel,
    villainPosition: scenario.villainPosition,
    villainPositionLabel: scenario.villainPositionLabel,
    heroStackBB: scenario.heroStackBB,
    villainStackBB: scenario.villainStackBB,
    heroCombo: scenario.heroCombo,
    numOtherPlayers: scenario.stacks.length - 2,
    speedMs: speedMs || null,
    actionLabel: scenario.decisionType === 'open_shove' ? ['shove', 'fold'] : ['call', 'fold'],
  };
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/trainer/scenario', (req, res) => {
  const { decisionType, speedMs } = req.body || {};
  const scenario = buildScenario({ decisionType: decisionType || undefined });
  const id = crypto.randomUUID();
  pendingScenarios.set(id, { scenario, createdAt: Date.now(), speedMs: speedMs || null });
  res.json(publicScenario(id, scenario, speedMs));
});

app.post('/api/trainer/decision', (req, res) => {
  const { id, action, timeTakenMs, timedOut } = req.body || {};
  const entry = pendingScenarios.get(id);
  if (!entry) return res.status(404).json({ error: 'Scenariusz nie znaleziony lub wygasł.' });
  pendingScenarios.delete(id);
  const { scenario, speedMs } = entry;

  const effectiveAction = timedOut ? 'fold' : action;
  const result = resolveDecision(scenario, effectiveAction);

  db.prepare(
    `INSERT INTO trainer_attempts
      (created_at, decision_type, hero_position, villain_position, hero_stack_bb, villain_stack_bb,
       num_players, hero_cards, range_percent, chosen_action, optimal_action, correct,
       ev_fold, ev_aggressive, ev_lost, speed_mode_ms, time_taken_ms, timed_out)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    new Date().toISOString(),
    scenario.decisionType,
    scenario.heroPosition,
    scenario.villainPosition,
    scenario.heroStackBB,
    scenario.villainStackBB,
    scenario.numPlayers,
    JSON.stringify(scenario.heroCombo),
    scenario.rangePercent,
    effectiveAction,
    result.optimalAction,
    result.correct ? 1 : 0,
    result.evFold,
    result.evAggressive,
    result.evLostByChoice,
    speedMs || null,
    timeTakenMs || null,
    timedOut ? 1 : 0
  );

  res.json({
    ...result,
    rangePercent: scenario.rangePercent,
    effStack: scenario.effStack,
    heroCombo: scenario.heroCombo,
    timedOut: !!timedOut,
  });
});

app.get('/api/trainer/stats', (req, res) => {
  const overall = db
    .prepare(
      `SELECT COUNT(*) as total, SUM(correct) as correctCount, SUM(ev_lost) as evLost,
              AVG(time_taken_ms) as avgTimeMs
       FROM trainer_attempts`
    )
    .get();

  const byType = db
    .prepare(
      `SELECT decision_type as decisionType, COUNT(*) as total, SUM(correct) as correctCount
       FROM trainer_attempts GROUP BY decision_type`
    )
    .all();

  const recent = db
    .prepare(`SELECT * FROM trainer_attempts ORDER BY id DESC LIMIT 30`)
    .all();

  const byDay = db
    .prepare(
      `SELECT substr(created_at,1,10) as day, COUNT(*) as total, SUM(correct) as correctCount
       FROM trainer_attempts GROUP BY day ORDER BY day DESC LIMIT 14`
    )
    .all();

  res.json({ overall, byType, recent, byDay });
});

app.get('/api/lessons', (req, res) => {
  const completedRows = db.prepare('SELECT lesson_id FROM lesson_progress').all();
  const completed = new Set(completedRows.map((r) => r.lesson_id));
  res.json(
    getLessons().map((l) => ({
      id: l.id,
      title: l.title,
      summary: l.summary,
      completed: completed.has(l.id),
    }))
  );
});

app.get('/api/lessons/:id', (req, res) => {
  const lesson = getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lekcja nie znaleziona.' });
  const quiz = getQuizForLesson(lesson.id);
  res.json({ ...lesson, quizId: quiz ? quiz.id : null });
});

app.post('/api/lessons/:id/complete', (req, res) => {
  const lesson = getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lekcja nie znaleziona.' });
  db.prepare(
    `INSERT INTO lesson_progress (lesson_id, completed_at) VALUES (?, ?)
     ON CONFLICT(lesson_id) DO UPDATE SET completed_at = excluded.completed_at`
  ).run(lesson.id, new Date().toISOString());
  res.json({ ok: true });
});

app.get('/api/quizzes/:id', (req, res) => {
  const quiz = getQuiz(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz nie znaleziony.' });
  res.json({
    id: quiz.id,
    lessonId: quiz.lessonId,
    title: quiz.title,
    questions: quiz.questions.map((q) => ({ q: q.q, options: q.options })),
  });
});

app.post('/api/quizzes/:id/submit', (req, res) => {
  const quiz = getQuiz(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz nie znaleziony.' });
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  let score = 0;
  const results = quiz.questions.map((q, i) => {
    const correct = answers[i] === q.correctIndex;
    if (correct) score++;
    return { correct, correctIndex: q.correctIndex, explanation: q.explanation };
  });
  db.prepare(
    `INSERT INTO quiz_attempts (created_at, quiz_id, lesson_id, score, total) VALUES (?, ?, ?, ?, ?)`
  ).run(new Date().toISOString(), quiz.id, quiz.lessonId, score, quiz.questions.length);
  res.json({ score, total: quiz.questions.length, results });
});

app.get('/api/journal', (req, res) => {
  const rows = db.prepare('SELECT * FROM hand_journal ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
});

app.post('/api/journal', (req, res) => {
  const b = req.body || {};
  db.prepare(
    `INSERT INTO hand_journal
      (created_at, title, stage, position, stack_bb, hero_cards, board, action_summary, result, result_bb, notes, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    new Date().toISOString(),
    b.title || null,
    b.stage || null,
    b.position || null,
    b.stackBb ?? null,
    b.heroCards || null,
    b.board || null,
    b.actionSummary || null,
    b.result || null,
    b.resultBb ?? null,
    b.notes || null,
    Array.isArray(b.tags) ? b.tags.join(',') : b.tags || null
  );
  res.json({ ok: true });
});

app.delete('/api/journal/:id', (req, res) => {
  db.prepare('DELETE FROM hand_journal WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

const BIND = process.env.BIND_HOST || '0.0.0.0';
app.listen(PORT, BIND, () => {
  console.log(`poker-trener listening on ${BIND}:${PORT}`);
});
