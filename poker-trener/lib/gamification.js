const db = require('./db');
const { dayKey, addDays, weekStart, utcRangeForDays } = require('./time');

const XP = {
  spotCorrect: 10,
  spotCorrectSpeed: 15,
  spotWrong: 2,
  drillCorrect: 5,
  drillWrong: 1,
  quizAnswer: 5,
  lessonDone: 30,
  examPass: 150,
  dailyDone: 50,
  dailyPerfect: 100,
  reviewCorrect: 8,
  tournamentItm: 60,
  tournamentWin: 200,
  handImport: 1,
};

const LEVEL_NAMES = [
  [1, 'Rybka'],
  [5, 'Amator'],
  [10, 'Regular'],
  [15, 'Grinder'],
  [20, 'Pro'],
  [30, 'Legenda'],
];

function levelThreshold(n) {
  return 50 * (n - 1) * n;
}

function levelFromXp(xp) {
  let n = 1;
  while (levelThreshold(n + 1) <= xp) n++;
  const name = LEVEL_NAMES.filter(([lvl]) => n >= lvl).pop()[1];
  const cur = levelThreshold(n);
  const next = levelThreshold(n + 1);
  return { level: n, name, xp, levelStart: cur, nextLevel: next, progress: (xp - cur) / (next - cur) };
}

function addXp(profileId, amount, reason) {
  if (!amount) return;
  db.prepare('INSERT INTO xp_events (profile_id, created_at, amount, reason) VALUES (?, ?, ?, ?)').run(profileId, new Date().toISOString(), Math.round(amount), reason);
}

function totalXp(profileId) {
  return db.prepare('SELECT COALESCE(SUM(amount),0) AS xp FROM xp_events WHERE profile_id = ?').get(profileId).xp;
}

function xpSince(profileId, iso) {
  return db.prepare('SELECT COALESCE(SUM(amount),0) AS xp FROM xp_events WHERE profile_id = ? AND created_at >= ?').get(profileId, iso).xp;
}

function activityDays(profileId) {
  const rows = db
    .prepare(
      `SELECT DISTINCT substr(created_at,1,13) AS h FROM (
         SELECT created_at FROM trainer_attempts WHERE profile_id = ?
         UNION ALL SELECT created_at FROM quiz_attempts WHERE profile_id = ?
         UNION ALL SELECT completed_at AS created_at FROM lesson_done WHERE profile_id = ?
       ) ORDER BY h DESC LIMIT 6000`
    )
    .all(profileId, profileId, profileId);
  return new Set(rows.map((r) => dayKey(`${r.h}:30:00Z`)));
}

function streak(profileId) {
  const days = activityDays(profileId);
  const today = dayKey();
  let start = days.has(today) ? today : addDays(today, -1);
  if (!days.has(start)) return { current: 0, best: bestStreak(days), today: false };
  let n = 0;
  while (days.has(start)) {
    n++;
    start = addDays(start, -1);
  }
  return { current: n, best: Math.max(n, bestStreak(days)), today: days.has(today) };
}

function bestStreak(days) {
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

// ---------- odznaki ----------

const ACHIEVEMENTS = [
  { key: 'first_spot', icon: '🎯', label: 'Pierwszy krok', desc: 'Pierwsza decyzja w trenerze' },
  { key: 'spots_100', icon: '💯', label: 'Setka', desc: '100 decyzji w trenerze' },
  { key: 'spots_500', icon: '🔥', label: 'Pół tysiąca', desc: '500 decyzji' },
  { key: 'spots_1000', icon: '🏋️', label: 'Grinder', desc: '1000 decyzji' },
  { key: 'spots_5000', icon: '🦾', label: 'Maszyna', desc: '5000 decyzji' },
  { key: 'row_10', icon: '🎳', label: 'Seria 10', desc: '10 dobrych decyzji z rzędu' },
  { key: 'row_25', icon: '🌟', label: 'Seria 25', desc: '25 dobrych decyzji z rzędu' },
  { key: 'days_3', icon: '📅', label: '3 dni z rzędu', desc: 'Trening 3 dni pod rząd' },
  { key: 'days_7', icon: '🗓️', label: 'Tydzień', desc: 'Trening 7 dni pod rząd' },
  { key: 'days_30', icon: '🏆', label: 'Miesiąc', desc: 'Trening 30 dni pod rząd' },
  { key: 'acc_80', icon: '🎓', label: 'Precyzja', desc: 'Co najmniej 80% trafności w ostatnich 100 decyzjach' },
  { key: 'speed_50', icon: '⚡', label: 'Błyskawica', desc: '50 dobrych decyzji z limitem 5 s' },
  { key: 'survival_20', icon: '🛡️', label: 'Przetrwanie', desc: '20 dobrych decyzji w trybie survival' },
  { key: 'time_attack_30', icon: '⏱️', label: 'Sprinter', desc: '30 dobrych w 2 minuty' },
  { key: 'daily_first', icon: '☀️', label: 'Wyzwanie dnia', desc: 'Ukończone pierwsze wyzwanie dnia' },
  { key: 'daily_perfect', icon: '💎', label: 'Perfekcja', desc: '20/20 w wyzwaniu dnia' },
  { key: 'lessons_10', icon: '📘', label: 'Pilny uczeń', desc: '10 ukończonych lekcji' },
  { key: 'lessons_all', icon: '📚', label: 'Erudyta', desc: 'Wszystkie lekcje ukończone' },
  { key: 'exam_3', icon: '🥉', label: 'Regular', desc: 'Zdany egzamin poziomu 2' },
  { key: 'exam_5', icon: '🥈', label: 'Pro', desc: 'Zdany egzamin poziomu 4' },
  { key: 'exam_6', icon: '🥇', label: 'Mistrz', desc: 'Zdany egzamin poziomu 5 — ścieżka ukończona' },
  { key: 'tourney_itm', icon: '💰', label: 'W kasie', desc: 'Wejście do pieniędzy w symulatorze turnieju' },
  { key: 'tourney_win', icon: '👑', label: 'Mistrz turnieju', desc: 'Wygrany symulowany turniej' },
  { key: 'multi_3', icon: '🖥️', label: 'Multi-tabler', desc: 'Ukończona sesja na 3 stołach' },
  { key: 'review_50', icon: '🔁', label: 'Powtarzacz', desc: '50 powtórek błędów' },
  { key: 'hh_100', icon: '📥', label: 'Analityk', desc: '100 zaimportowanych rąk' },
  { key: 'journal_10', icon: '📝', label: 'Kronikarz', desc: '10 wpisów w dzienniku' },
  { key: 'calibrated', icon: '🎚️', label: 'Samoświadomość', desc: '≥90% trafności przy deklaracji „pewny” (min. 30 decyzji)' },
  { key: 'bankroll_x2', icon: '📈', label: 'Podwojenie', desc: 'Wirtualny bankroll podwojony' },
];

function has(profileId, key) {
  return !!db.prepare('SELECT 1 FROM achievements WHERE profile_id = ? AND key = ?').get(profileId, key);
}

function award(profileId, key) {
  const r = db.prepare('INSERT OR IGNORE INTO achievements (profile_id, key, awarded_at) VALUES (?, ?, ?)').run(profileId, key, new Date().toISOString());
  return r.changes > 0;
}

function countAttempts(profileId, where = '1=1', params = []) {
  return db.prepare(`SELECT COUNT(*) AS c FROM trainer_attempts WHERE profile_id = ? AND kind = 'spot' AND ${where}`).get(profileId, ...params).c;
}

function currentCorrectRun(profileId) {
  const rows = db.prepare(`SELECT correct FROM trainer_attempts WHERE profile_id = ? AND kind = 'spot' ORDER BY id DESC LIMIT 60`).all(profileId);
  let n = 0;
  for (const r of rows) {
    if (!r.correct) break;
    n++;
  }
  return n;
}

const CHECKS = {
  first_spot: (p) => countAttempts(p) >= 1,
  spots_100: (p) => countAttempts(p) >= 100,
  spots_500: (p) => countAttempts(p) >= 500,
  spots_1000: (p) => countAttempts(p) >= 1000,
  spots_5000: (p) => countAttempts(p) >= 5000,
  row_10: (p) => currentCorrectRun(p) >= 10,
  row_25: (p) => currentCorrectRun(p) >= 25,
  days_3: (p) => streak(p).current >= 3,
  days_7: (p) => streak(p).current >= 7,
  days_30: (p) => streak(p).current >= 30,
  acc_80: (p) => {
    const rows = db.prepare(`SELECT correct FROM trainer_attempts WHERE profile_id = ? AND kind='spot' ORDER BY id DESC LIMIT 100`).all(p);
    return rows.length >= 100 && rows.filter((r) => r.correct).length >= 80;
  },
  speed_50: (p) => countAttempts(p, 'correct = 1 AND speed_mode_ms > 0 AND speed_mode_ms <= 5000') >= 50,
  survival_20: (p) => !!db.prepare(`SELECT 1 FROM mode_records WHERE profile_id = ? AND mode = 'survival' AND score >= 20`).get(p),
  time_attack_30: (p) => !!db.prepare(`SELECT 1 FROM mode_records WHERE profile_id = ? AND mode = 'time_attack' AND score >= 30`).get(p),
  daily_first: (p) => !!db.prepare(`SELECT 1 FROM daily_results WHERE profile_id = ?`).get(p),
  daily_perfect: (p) => !!db.prepare(`SELECT 1 FROM daily_results WHERE profile_id = ? AND score = total AND total >= 20`).get(p),
  lessons_10: (p) => db.prepare(`SELECT COUNT(*) c FROM lesson_done WHERE profile_id = ?`).get(p).c >= 10,
  lessons_all: (p, ctx) => ctx.lessonCount && db.prepare(`SELECT COUNT(*) c FROM lesson_done WHERE profile_id = ?`).get(p).c >= ctx.lessonCount,
  exam_3: (p) => (db.prepare('SELECT path_stage FROM profiles WHERE id = ?').get(p)?.path_stage || 1) >= 3,
  exam_5: (p) => (db.prepare('SELECT path_stage FROM profiles WHERE id = ?').get(p)?.path_stage || 1) >= 5,
  exam_6: (p) => (db.prepare('SELECT path_stage FROM profiles WHERE id = ?').get(p)?.path_stage || 1) >= 6,
  tourney_itm: (p) => !!db.prepare(`SELECT 1 FROM tournament_runs WHERE profile_id = ? AND prize > 0`).get(p),
  tourney_win: (p) => !!db.prepare(`SELECT 1 FROM tournament_runs WHERE profile_id = ? AND finish_place = 1`).get(p),
  multi_3: (p) => !!db.prepare(`SELECT 1 FROM mode_records WHERE profile_id = ? AND mode = 'multitable' AND score >= 3`).get(p),
  review_50: (p) => countAttempts(p, "mode = 'review'") >= 50,
  hh_100: (p) => db.prepare(`SELECT COUNT(*) c FROM hands WHERE profile_id = ?`).get(p).c >= 100,
  journal_10: (p) => db.prepare(`SELECT COUNT(*) c FROM hand_journal WHERE profile_id = ?`).get(p).c >= 10,
  calibrated: (p) => {
    const r = db.prepare(`SELECT COUNT(*) n, SUM(correct) c FROM trainer_attempts WHERE profile_id = ? AND confidence = 'sure'`).get(p);
    return r.n >= 30 && r.c / r.n >= 0.9;
  },
  bankroll_x2: (p) => (db.prepare('SELECT virtual_bankroll FROM profiles WHERE id = ?').get(p)?.virtual_bankroll || 0) >= 20000,
};

function checkAchievements(profileId, ctx = {}) {
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (has(profileId, a.key)) continue;
    const check = CHECKS[a.key];
    if (check && check(profileId, ctx) && award(profileId, a.key)) unlocked.push(a);
  }
  return unlocked;
}

function achievementsFor(profileId) {
  const got = new Map(db.prepare('SELECT key, awarded_at FROM achievements WHERE profile_id = ?').all(profileId).map((r) => [r.key, r.awarded_at]));
  return ACHIEVEMENTS.map((a) => ({ ...a, awardedAt: got.get(a.key) || null }));
}

// ---------- cele tygodniowe (F9) ----------

const GOAL_KINDS = {
  spots: { label: 'Decyzje w trenerze', unit: '' },
  accuracy: { label: 'Trafność w tym tygodniu', unit: '%' },
  lessons: { label: 'Ukończone lekcje', unit: '' },
  drills: { label: 'Ćwiczenia podstaw', unit: '' },
  review: { label: 'Powtórki błędów', unit: '' },
  daily: { label: 'Wyzwania dnia', unit: '' },
};

const DEFAULT_GOALS = { spots: 150, accuracy: 70, lessons: 2, review: 20 };

function goalsFor(profileId) {
  const ws = weekStart();
  let rows = db.prepare('SELECT * FROM goals WHERE profile_id = ? AND week_start = ?').all(profileId, ws);
  if (!rows.length) {
    const ins = db.prepare('INSERT OR IGNORE INTO goals (profile_id, week_start, kind, target, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const [kind, target] of Object.entries(DEFAULT_GOALS)) ins.run(profileId, ws, kind, target, new Date().toISOString());
    rows = db.prepare('SELECT * FROM goals WHERE profile_id = ? AND week_start = ?').all(profileId, ws);
  }
  const [from, to] = utcRangeForDays(ws, addDays(ws, 7));
  const inWeek = (iso) => {
    const d = dayKey(iso);
    return d >= ws && d < addDays(ws, 7);
  };
  const att = db.prepare(`SELECT created_at, correct, kind, mode FROM trainer_attempts WHERE profile_id = ? AND created_at >= ? AND created_at < ?`).all(profileId, from, to).filter((r) => inWeek(r.created_at));
  const spots = att.filter((r) => r.kind === 'spot');
  const progress = {
    spots: spots.length,
    accuracy: spots.length ? Math.round((spots.filter((r) => r.correct).length / spots.length) * 100) : 0,
    drills: att.filter((r) => r.kind === 'drill').length,
    review: spots.filter((r) => r.mode === 'review').length,
    lessons: db.prepare(`SELECT completed_at FROM lesson_done WHERE profile_id = ? AND completed_at >= ? AND completed_at < ?`).all(profileId, from, to).filter((r) => inWeek(r.completed_at)).length,
    daily: db.prepare(`SELECT COUNT(*) c FROM daily_results WHERE profile_id = ? AND day >= ? AND day < ?`).get(profileId, ws, addDays(ws, 7)).c,
  };
  return {
    weekStart: ws,
    goals: rows.map((g) => ({
      id: g.id,
      kind: g.kind,
      label: GOAL_KINDS[g.kind]?.label || g.kind,
      unit: GOAL_KINDS[g.kind]?.unit || '',
      target: g.target,
      value: progress[g.kind] ?? 0,
      done: g.kind === 'accuracy' ? spots.length >= 30 && progress.accuracy >= g.target : (progress[g.kind] ?? 0) >= g.target,
      note: g.kind === 'accuracy' && spots.length < 30 ? 'liczy się od 30 decyzji w tygodniu' : null,
    })),
  };
}

function setGoal(profileId, kind, target) {
  if (!GOAL_KINDS[kind]) throw new Error('Nieznany typ celu.');
  const ws = weekStart();
  if (target == null || target === '' || Number(target) <= 0) {
    db.prepare('DELETE FROM goals WHERE profile_id = ? AND week_start = ? AND kind = ?').run(profileId, ws, kind);
    return;
  }
  db.prepare(
    `INSERT INTO goals (profile_id, week_start, kind, target, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(profile_id, week_start, kind) DO UPDATE SET target = excluded.target`
  ).run(profileId, ws, kind, Number(target), new Date().toISOString());
}

// ---------- ranking (F5) ----------

function leaderboard() {
  const profiles = db.prepare('SELECT id, name, avatar FROM profiles ORDER BY id').all();
  const ws = weekStart();
  const [weekFrom] = utcRangeForDays(ws, addDays(ws, 7));
  const today = dayKey();
  return profiles
    .map((p) => {
      const xp = totalXp(p.id);
      const acc7 = db
        .prepare(`SELECT COUNT(*) n, SUM(correct) c FROM trainer_attempts WHERE profile_id = ? AND kind='spot' AND created_at >= ?`)
        .get(p.id, new Date(Date.now() - 7 * 86400000).toISOString());
      const daily = db.prepare('SELECT score, total FROM daily_results WHERE profile_id = ? AND day = ?').get(p.id, today);
      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        xp,
        level: levelFromXp(xp),
        weekXp: xpSince(p.id, weekFrom),
        streak: streak(p.id).current,
        accuracy7d: acc7.n ? Math.round((acc7.c / acc7.n) * 100) : null,
        spots7d: acc7.n,
        dailyToday: daily ? `${daily.score}/${daily.total}` : null,
      };
    })
    .sort((a, b) => b.weekXp - a.weekXp || b.xp - a.xp);
}

module.exports = {
  XP,
  levelFromXp,
  addXp,
  totalXp,
  xpSince,
  streak,
  ACHIEVEMENTS,
  checkAchievements,
  achievementsFor,
  GOAL_KINDS,
  goalsFor,
  setGoal,
  leaderboard,
};
