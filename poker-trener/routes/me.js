const express = require('express');
const db = require('../lib/db');
const G = require('../lib/gamification');
const Rv = require('../lib/review');
const C = require('../lib/content');
const Push = require('../lib/push');
const { dayKey, utcRangeForDays, addDays } = require('../lib/time');
const { h, httpError, num } = require('./util');

const router = express.Router();

// ---------- pulpit (D5) ----------

router.get('/me/summary', h((req) => {
  const p = req.profile;
  const today = dayKey();
  const [from, to] = utcRangeForDays(today, addDays(today, 1));
  const todayRows = db
    .prepare(`SELECT created_at, correct, kind FROM trainer_attempts WHERE profile_id = ? AND created_at >= ? AND created_at < ?`)
    .all(p.id, from, to)
    .filter((r) => dayKey(r.created_at) === today);
  const spotsToday = todayRows.filter((r) => r.kind === 'spot');
  const xp = G.totalXp(p.id);
  const daily = db.prepare('SELECT score, total FROM daily_results WHERE profile_id = ? AND day = ?').get(p.id, today);
  const stages = C.getStages();
  const stage = stages.find((s) => s.stage === Math.min(p.pathStage, C.MAX_STAGE));
  const nextLesson = db
    .prepare('SELECT lesson_id FROM lesson_done WHERE profile_id = ?')
    .all(p.id)
    .map((r) => r.lesson_id);
  const done = new Set(nextLesson);
  const upcoming = C.getLessons().find((l) => !done.has(l.id) && (p.settings.freeMode || l.stage <= p.pathStage));
  const recentAch = db.prepare('SELECT key, awarded_at FROM achievements WHERE profile_id = ? ORDER BY awarded_at DESC LIMIT 4').all(p.id);
  const achMap = new Map(G.ACHIEVEMENTS.map((a) => [a.key, a]));
  const runs = db.prepare("SELECT id FROM tournament_runs WHERE profile_id = ? AND status = 'running' ORDER BY id DESC LIMIT 3").all(p.id);
  return {
    profile: p,
    level: G.levelFromXp(xp),
    streak: G.streak(p.id),
    today: {
      spots: spotsToday.length,
      accuracy: spotsToday.length ? Math.round((spotsToday.filter((r) => r.correct).length / spotsToday.length) * 100) : null,
      drills: todayRows.filter((r) => r.kind === 'drill').length,
    },
    daily: daily ? { done: true, ...daily } : { done: false },
    review: Rv.summary(p.id),
    goals: G.goalsFor(p.id),
    path: { stage: p.pathStage, name: stage ? stage.name : 'Mistrz', icon: stage ? stage.icon : '👑', maxStage: C.MAX_STAGE, placementDone: p.placementDone },
    nextLesson: upcoming ? { id: upcoming.id, title: upcoming.title, stage: upcoming.stage } : null,
    recentAchievements: recentAch.map((r) => ({ ...achMap.get(r.key), awardedAt: r.awarded_at })).filter((a) => a.key),
    runningTournaments: runs.map((r) => r.id),
    virtualBankroll: Math.round(p.virtualBankroll),
  };
}));

router.get('/achievements', h((req) => G.achievementsFor(req.profile.id)));

router.get('/goals', h((req) => G.goalsFor(req.profile.id)));
router.put('/goals', h((req) => {
  for (const [kind, target] of Object.entries(req.body || {})) G.setGoal(req.profile.id, kind, target);
  return G.goalsFor(req.profile.id);
}));

router.get('/leaderboard', h(() => G.leaderboard()));

router.get('/xp/history', h((req) => db.prepare('SELECT created_at, amount, reason FROM xp_events WHERE profile_id = ? ORDER BY id DESC LIMIT 50').all(req.profile.id)));

// ---------- bankroll (B10) ----------

function bankrollSummary(profile) {
  const rows = db.prepare('SELECT * FROM bankroll_sessions WHERE profile_id = ? ORDER BY day ASC, id ASC').all(profile.id);
  const start = Number(profile.settings.startingBankroll) || 0;
  const rule = Number(profile.settings.bankrollRule) || 100;
  let bank = start;
  let tourn = 0;
  let buy = 0;
  let cash = 0;
  let hours = 0;
  const curve = [{ day: rows[0]?.day || dayKey(), bankroll: start }];
  for (const r of rows) {
    bank += r.cashes - r.buyins;
    tourn += r.tournaments;
    buy += r.buyins;
    cash += r.cashes;
    hours += r.hours || 0;
    curve.push({ day: r.day, bankroll: Math.round(bank * 100) / 100 });
  }
  const abi = tourn ? buy / tourn : 0;
  const maxAbi = bank / rule;
  return {
    sessions: rows.slice().reverse(),
    summary: {
      startingBankroll: start,
      bankroll: Math.round(bank * 100) / 100,
      tournaments: tourn,
      buyins: Math.round(buy * 100) / 100,
      cashes: Math.round(cash * 100) / 100,
      profit: Math.round((cash - buy) * 100) / 100,
      roi: buy ? Math.round(((cash - buy) / buy) * 1000) / 10 : null,
      abi: Math.round(abi * 100) / 100,
      hours: Math.round(hours * 10) / 10,
      hourly: hours ? Math.round(((cash - buy) / hours) * 100) / 100 : null,
      rule,
      maxAbi: Math.round(maxAbi * 100) / 100,
      status: !tourn ? 'unknown' : abi <= maxAbi ? 'ok' : abi <= maxAbi * 1.5 ? 'warning' : 'danger',
      reliable: tourn >= 300,
    },
    curve,
  };
}

router.get('/bankroll', h((req) => bankrollSummary(req.profile)));

router.post('/bankroll/sessions', h((req) => {
  const b = req.body || {};
  const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : dayKey();
  const tournaments = Math.max(1, Math.round(num(b.tournaments, 1)));
  const buyins = Math.max(0, num(b.buyins, 0));
  const cashes = Math.max(0, num(b.cashes, 0));
  db.prepare('INSERT INTO bankroll_sessions (profile_id, day, site, game_type, tournaments, buyins, cashes, hours, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    req.profile.id, day, b.site || null, b.gameType || null, tournaments, buyins, cashes, num(b.hours), b.notes || null, new Date().toISOString()
  );
  return bankrollSummary(req.profile);
}));

router.delete('/bankroll/sessions/:id', h((req) => {
  db.prepare('DELETE FROM bankroll_sessions WHERE id = ? AND profile_id = ?').run(Number(req.params.id), req.profile.id);
  return bankrollSummary(req.profile);
}));

// ---------- powiadomienia (F10) ----------

router.get('/push/key', h(() => ({ publicKey: Push.publicKey() })));

router.post('/push/subscribe', h((req) => {
  Push.subscribe(req.profile.id, req.body?.subscription);
  return { ok: true };
}));

router.post('/push/unsubscribe', h((req) => {
  if (!req.body?.endpoint) throw httpError(400, 'Brak endpointu.');
  Push.unsubscribe(req.body.endpoint);
  return { ok: true };
}));

router.post('/push/test', h((req) => Push.sendTest(req.profile.id)));

module.exports = router;
