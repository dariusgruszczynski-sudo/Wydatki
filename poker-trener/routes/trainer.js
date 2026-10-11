const express = require('express');
const db = require('../lib/db');
const S = require('../lib/spots');
const D = require('../lib/drills');
const Tn = require('../lib/tournament');
const Rv = require('../lib/review');
const G = require('../lib/gamification');
const C = require('../lib/content');
const Ad = require('../lib/adaptive');
const At = require('../lib/attempts');
const { seededRng, hashString, weightedPick } = require('../lib/rng');
const { dayKey } = require('../lib/time');
const { h, httpError, num } = require('./util');

const router = express.Router();

function spotOptions(profile, body = {}) {
  const st = profile.settings;
  const unl = C.unlocked(profile.pathStage, st.freeMode);
  const f = { ...st.filters, ...(body.filters || {}) };
  let types = (body.types || f.types || []).filter((t) => unl.spotTypes.includes(t));
  if (!types.length) types = unl.spotTypes.filter((t) => t !== 'rfi');
  let format = body.format || st.formatFocus || 'mix';
  if (format !== 'mix' && !unl.formats.includes(format)) format = 'mix';
  if (format === 'mix') {
    const fw = { mtt: 5, pko: 2, sng: 2, satellite: 1.5, wta: 0.5 };
    format = weightedPick(unl.formats, unl.formats.map((x) => fw[x] || 1), Math.random);
  }
  let mode = body.mode || st.mode || 'gto';
  if (mode === 'exploit' && !unl.exploit) mode = 'gto';
  const opts = {
    types,
    format,
    mode,
    difficulty: body.difficulty || st.difficulty,
    anteMode: body.anteMode || st.anteMode,
    heroPositions: f.heroPositions && f.heroPositions.length ? f.heroPositions : undefined,
    stackRange: Array.isArray(f.stackRange) ? f.stackRange.map(Number) : undefined,
    stage: f.stage && f.stage !== 'any' ? f.stage : undefined,
    numPlayers: Array.isArray(f.numPlayers) ? f.numPlayers.map(Number) : undefined,
  };
  const adaptive = body.adaptive ?? st.adaptive;
  return adaptive ? Ad.adaptiveOptions(profile.id, opts) : opts;
}

function newSpot(profile, body, ctx) {
  const opts = spotOptions(profile, body);
  let spot;
  try {
    spot = S.generateSpot(opts);
  } catch {
    spot = S.generateSpot({ ...opts, heroPositions: undefined, stage: undefined, stackRange: undefined, type: undefined });
  }
  At.putPending(spot, profile.id, ctx);
  return { spot: S.publicView(spot, { speedMs: ctx.speedMs || null, focus: opts.focus || null }) };
}

router.post('/spots/next', h((req) => {
  const speedMs = num(req.body?.speedMs, req.profile.settings.speedMs) || null;
  return newSpot(req.profile, req.body || {}, { mode: req.body?.mode === 'survival' || req.body?.mode === 'time_attack' ? req.body.mode : speedMs ? 'speed' : 'standard', speedMs });
}));

function decide(req, body) {
  const p = At.takePending(body.id, req.profile.id);
  if (!p) throw httpError(404, 'Spot wygasł albo został już rozwiązany.');
  const spot = p.item;
  const ctx = { ...p.ctx, timeTakenMs: num(body.timeTakenMs), timedOut: !!body.timedOut, confidence: ['sure', 'medium', 'guess'].includes(body.confidence) ? body.confidence : null };
  const action = ctx.timedOut ? 'fold' : spot.actions.includes(body.action) ? body.action : 'fold';
  const result = S.resolveSpot(spot, action);
  At.putResolved(spot, result, req.profile.id);
  const rec = At.recordSpot(req.profile.id, spot, result, ctx);
  const out = { ...result, spotId: spot.id, attemptId: rec.attemptId, xp: rec.xp, bankrollDelta: rec.bankrollDelta, review: rec.review, mode: ctx.mode, timedOut: ctx.timedOut };

  if (ctx.runId) {
    const run = Tn.loadRun(req.profile.id, ctx.runId);
    if (run && run.status === 'running') {
      const wasItm = run.itm;
      const outcome = Tn.applyOutcome(run, spot, action);
      Tn.saveRun(run);
      out.run = Tn.publicRun(run);
      out.outcome = outcome;
      if (!wasItm && run.itm && run.status !== 'busted') G.addXp(req.profile.id, G.XP.tournamentItm, 'tournament:itm');
      if (run.status === 'won') G.addXp(req.profile.id, G.XP.tournamentWin, 'tournament:win');
      if (run.status === 'busted' && run.prize > 0 && !wasItm) G.addXp(req.profile.id, G.XP.tournamentItm, 'tournament:itm');
    }
  }
  if (ctx.mode === 'daily') {
    const ds = dailySessions.get(req.profile.id);
    if (ds && ds.day === ctx.day) ds.results[ctx.index] = { correct: result.correct, evLoss: result.evLoss, unit: result.unit, pool: spot.poolTotal };
  }
  return { ...out, ...At.progressPayload(req.profile.id) };
}

router.post('/spots/decide', h((req) => decide(req, req.body || {})));

router.post('/spots/whatif', h((req) => {
  const r = At.getResolved(req.body?.id, req.profile.id);
  if (!r) throw httpError(404, 'Spot wygasł — rozwiąż nowy.');
  const changes = req.body?.changes || {};
  if (changes.heroCards) {
    const cards = String(changes.heroCards).replace(/\s+/g, '').match(/[2-9TJQKA][shdc]/gi);
    if (!cards || cards.length !== 2 || cards[0].toLowerCase() === cards[1].toLowerCase()) throw httpError(400, 'Podaj dwie różne karty, np. AhKd.');
    changes.heroCombo = cards.map((c) => c[0].toUpperCase() + c[1].toLowerCase());
  }
  const s2 = S.whatIf(r.spot, changes);
  const res = S.resolveSpot(s2, r.result.chosen, { trials: 1800 });
  return { spot: S.publicView(s2), result: res };
}));

router.post('/spots/custom', h((req) => {
  const spot = S.customSpot(req.body || {});
  const result = S.resolveSpot(spot, null);
  At.putResolved(spot, result, req.profile.id);
  return { spot: S.publicView(spot), result };
}));

router.post('/spots/replay/:attemptId', h((req) => {
  const row = db.prepare('SELECT spot_json FROM trainer_attempts WHERE id = ? AND profile_id = ?').get(Number(req.params.attemptId), req.profile.id);
  if (!row || !row.spot_json) throw httpError(404, 'Brak zapisanego spotu dla tej decyzji.');
  const spot = JSON.parse(row.spot_json);
  spot.id = require('crypto').randomUUID();
  At.putPending(spot, req.profile.id, { mode: 'replay' });
  return { spot: S.publicView(spot) };
}));

// ---------- powtórki (A8) ----------

router.get('/review/summary', h((req) => Rv.summary(req.profile.id)));

router.post('/review/next', h((req) => {
  const row = Rv.nextDue(req.profile.id);
  if (!row) return { empty: true, summary: Rv.summary(req.profile.id) };
  const spot = JSON.parse(row.spot_json);
  spot.id = require('crypto').randomUUID();
  At.putPending(spot, req.profile.id, { mode: 'review', reviewId: row.id });
  return { spot: S.publicView(spot, { review: { reps: row.reps, lapses: row.lapses } }), summary: Rv.summary(req.profile.id) };
}));

// ---------- wyzwanie dnia (F4) ----------

const DAILY_COUNT = 20;
const dailySessions = new Map();

function dailySpot(day, i) {
  const seed = hashString(`daily-${day}-${i}`);
  const rng = seededRng(seed);
  const type = weightedPick(['open_shove', 'facing_shove', 'threebet_shove', 'resteal', 'three_way'], [4, 4, 2, 2, 1], rng);
  const format = weightedPick(['mtt', 'sng', 'pko', 'satellite'], [5, 2, 2, 1], rng);
  return S.generateSpot({ type, format, seed, mode: 'gto', difficulty: 'normal', anteMode: 'bb_ante' });
}

router.get('/daily', h((req) => {
  const day = dayKey();
  const done = db.prepare('SELECT * FROM daily_results WHERE profile_id = ? AND day = ?').get(req.profile.id, day);
  const board = db
    .prepare('SELECT d.score, d.total, d.ev_lost, d.time_ms, p.name, p.avatar FROM daily_results d JOIN profiles p ON p.id = d.profile_id WHERE d.day = ? ORDER BY d.score DESC, d.ev_lost ASC, d.time_ms ASC')
    .all(day);
  return { day, total: DAILY_COUNT, done: done || null, leaderboard: board };
}));

router.post('/daily/start', h((req) => {
  const day = dayKey();
  const spots = [];
  for (let i = 0; i < DAILY_COUNT; i++) {
    const spot = dailySpot(day, i);
    At.putPending(spot, req.profile.id, { mode: 'daily', day, index: i });
    spots.push(S.publicView(spot, { index: i }));
  }
  dailySessions.set(req.profile.id, { day, results: {}, startedAt: Date.now() });
  return { day, spots };
}));

router.post('/daily/finish', h((req) => {
  const ds = dailySessions.get(req.profile.id);
  const day = dayKey();
  if (!ds || ds.day !== day) throw httpError(400, 'Brak aktywnego wyzwania dnia.');
  dailySessions.delete(req.profile.id);
  const results = Object.values(ds.results);
  const score = results.filter((r) => r.correct).length;
  const evLost = results.reduce((s, r) => s + (r.unit === '$' ? (r.evLoss / r.pool) * 100 : r.evLoss / 10), 0);
  const timeMs = Date.now() - ds.startedAt;
  const existing = db.prepare('SELECT 1 FROM daily_results WHERE profile_id = ? AND day = ?').get(req.profile.id, day);
  if (!existing) {
    db.prepare('INSERT INTO daily_results (profile_id, day, score, total, ev_lost, time_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.profile.id, day, score, DAILY_COUNT, Math.round(evLost * 100) / 100, timeMs, new Date().toISOString());
    G.addXp(req.profile.id, score === DAILY_COUNT ? G.XP.dailyPerfect : G.XP.dailyDone, 'daily');
  }
  return { day, score, total: DAILY_COUNT, evLostPct: Math.round(evLost * 100) / 100, timeMs, counted: !existing, ...At.progressPayload(req.profile.id) };
}));

// ---------- rekordy trybów (F6, F7, B9) ----------

router.post('/modes/record', h((req) => {
  const mode = String(req.body?.mode || '');
  if (!['survival', 'time_attack', 'multitable'].includes(mode)) throw httpError(400, 'Nieznany tryb.');
  const score = Math.max(0, Math.min(1000, num(req.body?.score, 0)));
  db.prepare('INSERT INTO mode_records (profile_id, mode, score, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(req.profile.id, mode, score, JSON.stringify(req.body?.detail || null), new Date().toISOString());
  const best = db.prepare('SELECT MAX(score) AS best FROM mode_records WHERE profile_id = ? AND mode = ?').get(req.profile.id, mode).best;
  return { mode, score, best, ...At.progressPayload(req.profile.id) };
}));

router.get('/modes/records', h((req) => {
  const rows = db.prepare('SELECT mode, MAX(score) AS best, COUNT(*) AS plays FROM mode_records WHERE profile_id = ? GROUP BY mode').all(req.profile.id);
  const recent = db.prepare('SELECT mode, score, created_at FROM mode_records WHERE profile_id = ? ORDER BY id DESC LIMIT 20').all(req.profile.id);
  return { best: rows, recent };
}));

// ---------- symulator turnieju (B1) i multi-table (B9) ----------

router.post('/tournament/start', h((req) => {
  const run = Tn.createRun(req.profile.id, { field: num(req.body?.field, 45), buyin: num(req.body?.buyin, 10), sessionKey: req.body?.sessionKey || null, format: req.body?.format });
  return Tn.publicRun(run);
}));

router.post('/tournament/:id/next', h((req) => {
  const run = Tn.loadRun(req.profile.id, Number(req.params.id));
  if (!run) throw httpError(404, 'Nie ma takiego turnieju.');
  if (run.status !== 'running') return { run: Tn.publicRun(run), spot: null };
  const spot = Tn.nextSpot(run, req.profile.settings);
  Tn.saveRun(run);
  const speedMs = num(req.body?.speedMs) || null;
  At.putPending(spot, req.profile.id, { mode: req.body?.multitable ? 'multitable' : 'tournament', runId: run.id, speedMs });
  return { run: Tn.publicRun(run), spot: S.publicView(spot, { speedMs }) };
}));

router.get('/tournament/runs', h((req) => Tn.listRuns(req.profile.id, 30)));

router.get('/tournament/:id', h((req) => {
  const run = Tn.loadRun(req.profile.id, Number(req.params.id));
  if (!run) throw httpError(404, 'Nie ma takiego turnieju.');
  return Tn.publicRun(run);
}));

router.get('/tournament-fields', h(() => Object.entries(Tn.FIELDS).map(([field, f]) => ({ field: Number(field), label: f.label }))));

// ---------- ćwiczenia podstaw (A3, A5, A6, A7) ----------

router.get('/drills/types', h((req) => {
  const unl = C.unlocked(req.profile.pathStage, req.profile.settings.freeMode);
  return Object.entries(D.DRILL_TYPES).map(([key, d]) => ({ key, ...d, unlocked: unl.drills.includes(key) || req.profile.settings.freeMode }));
}));

router.post('/drills/next', h((req) => {
  const d = D.generateDrill(req.body?.type);
  At.putPending(d, req.profile.id, { mode: 'drill' });
  return D.publicDrill(d);
}));

router.post('/drills/answer', h((req) => {
  const p = At.takePending(req.body?.id, req.profile.id);
  if (!p || p.item.kind !== 'drill') throw httpError(404, 'Ćwiczenie wygasło.');
  const res = D.resolveDrill(p.item, req.body?.choice);
  const rec = At.recordDrill(req.profile.id, p.item, res, { timeTakenMs: num(req.body?.timeTakenMs) });
  return { ...res, xp: rec.xp, ...At.progressPayload(req.profile.id) };
}));

module.exports = router;
