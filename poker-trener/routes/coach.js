const express = require('express');
const db = require('../lib/db');
const Co = require('../lib/coach');
const At = require('../lib/attempts');
const { h, httpError } = require('./util');

const router = express.Router();

function requireAi() {
  if (!Co.status().enabled) throw httpError(503, 'Coach AI nie jest włączony — dodaj ANTHROPIC_API_KEY do pliku .env na serwerze.');
}

router.get('/coach/status', h(() => Co.status()));

router.post('/coach/explain', h(async (req) => {
  const r = At.getResolved(req.body?.spotId, req.profile.id);
  if (!r) throw httpError(404, 'Spot wygasł — wyjaśnienie AI jest dostępne do 30 minut po decyzji.');
  if (!Co.status().enabled) return { text: r.result.explanation.join('\n'), ai: false };
  return { text: await Co.explainSpot(r.spot, r.result), ai: true };
}));

router.post('/coach/journal/:id', h(async (req) => {
  requireAi();
  const entry = db.prepare('SELECT * FROM hand_journal WHERE id = ? AND profile_id = ?').get(Number(req.params.id), req.profile.id);
  if (!entry) throw httpError(404, 'Nie ma takiego wpisu.');
  const hand = entry.hand_id ? db.prepare('SELECT * FROM hands WHERE id = ? AND profile_id = ?').get(entry.hand_id, req.profile.id) : null;
  return { text: await Co.analyzeJournal(entry, hand), ai: true };
}));

router.post('/coach/hand/:id', h(async (req) => {
  requireAi();
  const hand = db.prepare('SELECT * FROM hands WHERE id = ? AND profile_id = ?').get(Number(req.params.id), req.profile.id);
  if (!hand) throw httpError(404, 'Nie ma takiej ręki.');
  return { text: await Co.analyzeJournal(null, hand), ai: true };
}));

router.get('/coach/chat', h((req) => Co.chatHistory(req.profile.id, String(req.query.thread || 'main'))));

router.post('/coach/chat', h(async (req) => {
  requireAi();
  const message = String(req.body?.message || '').trim().slice(0, 4000);
  if (!message) throw httpError(400, 'Napisz pytanie.');
  return { reply: await Co.chat(req.profile.id, String(req.body?.thread || 'main'), message) };
}));

router.delete('/coach/chat', h((req) => {
  Co.clearChat(req.profile.id, String(req.query.thread || 'main'));
  return { ok: true };
}));

router.post('/coach/plan', h(async (req) => {
  const minutes = Math.max(10, Math.min(180, Number(req.body?.minutes) || 30));
  if (!Co.status().enabled || req.body?.rules) return Co.rulePlan(req.profile.id, minutes);
  return { ...(await Co.trainingPlan(req.profile.id, minutes)), ai: true };
}));

router.post('/coach/session-summary', h(async (req) => {
  requireAi();
  const ids = (req.body?.attemptIds || []).map(Number).filter(Number.isFinite).slice(-200);
  return { text: await Co.sessionSummary(req.profile.id, ids), ai: true };
}));

router.post('/coach/mistake-quiz', h(async (req) => {
  requireAi();
  return { title: 'Quiz AI z Twoich błędów', questions: await Co.mistakeQuiz(req.profile.id), ai: true };
}));

module.exports = router;
