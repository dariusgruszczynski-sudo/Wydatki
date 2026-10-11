const db = require('./db');
const { dayKey, hourOf, weekStart, addDays } = require('./time');
const { SPOT_TYPES } = require('./spots');
const T = require('./push-fold-tables');

const AGGRESSIVE = new Set(['shove', 'call', 'raise']);
const SESSION_GAP_MS = 20 * 60 * 1000;

function loadAttempts(profileId, { from, to } = {}) {
  let sql = `SELECT id, created_at, kind, spot_type, mode, format, stage, hero_pos_group, stack_bucket, hero_label, opp_type, confidence,
                    correct, close, chosen_action, optimal_action, ev_lost, ev_delta, pool_total, value_mode, speed_mode_ms, time_taken_ms, timed_out,
                    hero_position, hero_stack_bb, villain_position
             FROM trainer_attempts WHERE profile_id = ? AND kind = 'spot'`;
  const params = [profileId];
  if (from) {
    sql += ' AND created_at >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND created_at < ?';
    params.push(to);
  }
  sql += ' ORDER BY id ASC LIMIT 50000';
  return db.prepare(sql).all(...params);
}

// Strata EV znormalizowana: % puli dla ICM, bb dla chip EV.
function lossPct(a) {
  if (a.value_mode === 'chips') return 0;
  return a.pool_total ? (a.ev_lost / a.pool_total) * 100 : 0;
}

function lossBB(a) {
  return a.value_mode === 'chips' ? a.ev_lost : 0;
}

function agg(rows) {
  const n = rows.length;
  const c = rows.filter((r) => r.correct).length;
  return {
    n,
    correct: c,
    accuracy: n ? Math.round((c / n) * 1000) / 10 : null,
    lossPct: Math.round(rows.reduce((s, r) => s + lossPct(r), 0) * 100) / 100,
    lossBB: Math.round(rows.reduce((s, r) => s + lossBB(r), 0) * 10) / 10,
    avgTimeMs: n ? Math.round(rows.reduce((s, r) => s + (r.time_taken_ms || 0), 0) / n) : null,
  };
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function typeLabel(t) {
  return SPOT_TYPES[t]?.label || t || 'inne';
}

function overview(profileId, range) {
  const rows = loadAttempts(profileId, range);
  const byType = [...groupBy(rows, (r) => r.spot_type)].map(([type, rs]) => ({ type, label: typeLabel(type), ...agg(rs) }));
  const byMode = [...groupBy(rows, (r) => r.mode)].map(([mode, rs]) => ({ mode, ...agg(rs) }));
  return { total: agg(rows), byType, byMode };
}

function matrix(profileId, range) {
  const rows = loadAttempts(profileId, range);
  const groups = ['EP', 'MP', 'CO', 'BTN', 'SB', 'BB', 'HU'];
  const buckets = T.STACK_BUCKETS.map((b) => b.label);
  const cells = [];
  const m = groupBy(rows, (r) => `${r.hero_pos_group}|${r.stack_bucket}`);
  for (const g of groups) for (const b of buckets) {
    const rs = m.get(`${g}|${b}`) || [];
    if (rs.length) cells.push({ group: g, bucket: b, ...agg(rs) });
  }
  return { groups, buckets, cells };
}

function timerComparison(profileId, range) {
  const rows = loadAttempts(profileId, range);
  const levels = [
    { key: 'none', label: 'Bez limitu', f: (r) => !r.speed_mode_ms },
    { key: '15', label: '15 s', f: (r) => r.speed_mode_ms > 10000 },
    { key: '10', label: '10 s', f: (r) => r.speed_mode_ms > 5000 && r.speed_mode_ms <= 10000 },
    { key: '5', label: '5 s i mniej', f: (r) => r.speed_mode_ms > 0 && r.speed_mode_ms <= 5000 },
  ];
  return levels.map((l) => {
    const rs = rows.filter(l.f);
    return { key: l.key, label: l.label, ...agg(rs), timeouts: rs.filter((r) => r.timed_out).length };
  });
}

function trends(profileId) {
  const rows = loadAttempts(profileId);
  const weekly = [...groupBy(rows, (r) => weekStart(r.created_at))].map(([week, rs]) => ({ period: week, ...agg(rs) })).slice(-16);
  const monthly = [...groupBy(rows, (r) => dayKey(r.created_at).slice(0, 7))].map(([month, rs]) => ({ period: month, ...agg(rs) })).slice(-12);
  const daysBack = 60;
  const today = dayKey();
  const byDay = groupBy(rows, (r) => dayKey(r.created_at));
  const daily = [];
  let cumLoss = 0;
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const rs = byDay.get(d) || [];
    const a = agg(rs);
    cumLoss += a.lossPct;
    daily.push({ day: d, ...a, cumLossPct: Math.round(cumLoss * 100) / 100 });
  }
  return { weekly, monthly, daily };
}

function topErrors(profileId, limit = 10, range) {
  const rows = loadAttempts(profileId, range).filter((r) => !r.correct);
  rows.sort((a, b) => lossPct(b) + lossBB(b) / 10 - (lossPct(a) + lossBB(a) / 10));
  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    type: r.spot_type,
    typeLabel: typeLabel(r.spot_type),
    pos: r.hero_position,
    stack: r.hero_stack_bb,
    hand: r.hero_label,
    chosen: r.chosen_action,
    optimal: r.optimal_action,
    lossPct: Math.round(lossPct(r) * 100) / 100,
    lossBB: Math.round(lossBB(r) * 10) / 10,
    stage: r.stage,
    format: r.format,
  }));
}

const ACTION_PL = { shove: 'all-in', call: 'call', raise: 'otwarcie', fold: 'pas' };

function leaks(profileId, range) {
  const rows = loadAttempts(profileId, range);
  const m = groupBy(rows, (r) => `${r.spot_type}|${r.hero_pos_group}|${r.stack_bucket}`);
  const out = [];
  for (const [key, rs] of m) {
    if (rs.length < 5) continue;
    const errors = rs.filter((r) => !r.correct);
    const a = agg(rs);
    if (errors.length < 3 || a.accuracy >= 75) continue;
    const loose = errors.filter((r) => AGGRESSIVE.has(r.chosen_action) && r.optimal_action === 'fold');
    const tight = errors.filter((r) => r.chosen_action === 'fold' && AGGRESSIVE.has(r.optimal_action));
    const [type, group, bucket] = key.split('|');
    const dir = loose.length >= tight.length ? 'loose' : 'tight';
    const aggrAction = SPOT_TYPES[type]?.actions[0] || 'shove';
    const where = `${typeLabel(type).toLowerCase()} z ${T.GROUP_LABELS[group] || group} przy ${bucket}`;
    const message =
      dir === 'loose'
        ? `Za luźno: ${where} — ${loose.length} z ${errors.length} błędów to ${ACTION_PL[aggrAction]} tam, gdzie trzeba spasować.`
        : `Za ciasno: ${where} — ${tight.length} z ${errors.length} błędów to pas tam, gdzie ${ACTION_PL[aggrAction]} był lepszy.`;
    out.push({
      key,
      type,
      typeLabel: typeLabel(type),
      group,
      bucket,
      direction: dir,
      message,
      n: rs.length,
      errors: errors.length,
      accuracy: a.accuracy,
      lossPct: a.lossPct,
      lossBB: a.lossBB,
      examples: errors.slice(-5).map((r) => r.hero_label),
      severity: a.lossPct + a.lossBB / 10 + (100 - a.accuracy) / 50,
    });
  }
  out.sort((a, b) => b.severity - a.severity);
  return out;
}

function tilt(profileId, range) {
  const rows = loadAttempts(profileId, range);
  const base = agg(rows);
  let run = 0;
  const afterErrors = [];
  const afterCorrect = [];
  for (const r of rows) {
    if (run >= 2) afterErrors.push(r);
    else afterCorrect.push(r);
    run = r.correct ? 0 : run + 1;
  }
  const byHour = [...groupBy(rows, (r) => {
    const h = hourOf(r.created_at);
    return h < 6 ? '00-06' : h < 12 ? '06-12' : h < 18 ? '12-18' : h < 22 ? '18-22' : '22-24';
  })].map(([slot, rs]) => ({ slot, ...agg(rs) }))
    .sort((a, b) => a.slot.localeCompare(b.slot));

  const sessionBuckets = { '0-15 min': [], '15-30 min': [], '30-60 min': [], '60+ min': [] };
  let sessionStart = null;
  let prev = null;
  let sessions = 0;
  for (const r of rows) {
    const t = Date.parse(r.created_at);
    if (!prev || t - prev > SESSION_GAP_MS) {
      sessionStart = t;
      sessions++;
    }
    const min = (t - sessionStart) / 60000;
    const k = min < 15 ? '0-15 min' : min < 30 ? '15-30 min' : min < 60 ? '30-60 min' : '60+ min';
    sessionBuckets[k].push(r);
    prev = t;
  }
  const fatigue = Object.entries(sessionBuckets).map(([slot, rs]) => ({ slot, ...agg(rs) }));
  const ae = agg(afterErrors);
  const warnings = [];
  if (ae.n >= 10 && base.accuracy && ae.accuracy < base.accuracy - 8) {
    warnings.push(`Po 2+ błędach z rzędu Twoja trafność spada do ${ae.accuracy}% (średnio ${base.accuracy}%). Zrób przerwę po serii błędów.`);
  }
  const late = byHour.find((h) => h.slot === '22-24' || h.slot === '00-06');
  if (late && late.n >= 15 && base.accuracy && late.accuracy < base.accuracy - 8) {
    warnings.push(`Późnym wieczorem trafność jest niższa (${late.accuracy}%). Najlepiej trenujesz o innych porach.`);
  }
  const tired = fatigue.find((f) => f.slot === '60+ min');
  if (tired && tired.n >= 15 && base.accuracy && tired.accuracy < base.accuracy - 8) {
    warnings.push(`Po godzinie sesji trafność spada do ${tired.accuracy}%. Krótsze sesje mogą dać lepsze efekty.`);
  }
  return { base, afterErrors: ae, afterCorrect: agg(afterCorrect), byHour, fatigue, sessions, warnings };
}

function calibration(profileId, range) {
  const rows = loadAttempts(profileId, range).filter((r) => r.confidence);
  const labels = { sure: 'Pewny', medium: 'Raczej', guess: 'Zgaduję' };
  return ['sure', 'medium', 'guess'].map((c) => ({ key: c, label: labels[c], ...agg(rows.filter((r) => r.confidence === c)) }));
}

function heatmap(profileId, range) {
  const rows = loadAttempts(profileId, range).filter((r) => r.hero_label);
  return [...groupBy(rows, (r) => r.hero_label)].map(([label, rs]) => ({ label, n: rs.length, errors: rs.filter((r) => !r.correct).length }));
}

function tagStats(profileId) {
  const rows = db.prepare('SELECT tags, result, result_bb FROM hand_journal WHERE profile_id = ?').all(profileId);
  const m = new Map();
  for (const r of rows) {
    for (const tag of String(r.tags || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)) {
      const s = m.get(tag) || { tag, count: 0, win: 0, loss: 0, fold: 0, resultBB: 0 };
      s.count++;
      if (r.result === 'win') s.win++;
      else if (r.result === 'loss') s.loss++;
      else if (r.result === 'fold') s.fold++;
      s.resultBB += r.result_bb || 0;
      m.set(tag, s);
    }
  }
  return [...m.values()].map((s) => ({ ...s, resultBB: Math.round(s.resultBB * 10) / 10 })).sort((a, b) => b.count - a.count);
}

function drillStats(profileId) {
  return db
    .prepare(`SELECT spot_type AS type, COUNT(*) n, SUM(correct) c FROM trainer_attempts WHERE profile_id = ? AND kind = 'drill' GROUP BY spot_type`)
    .all(profileId)
    .map((r) => ({ type: r.type, n: r.n, accuracy: r.n ? Math.round((r.c / r.n) * 1000) / 10 : null }));
}

function monthReport(profileId, month) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : dayKey().slice(0, 7);
  const from = `${m}-01T00:00:00.000Z`;
  const [y, mm] = m.split('-').map(Number);
  const next = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  const to = `${next}-01T00:00:00.000Z`;
  const range = { from, to };
  const hands = db
    .prepare(`SELECT COUNT(*) n, SUM(result_bb) bb, SUM(hero_vpip) vpip, SUM(hero_pfr) pfr FROM hands WHERE profile_id = ? AND imported_at >= ? AND imported_at < ?`)
    .get(profileId, from, to);
  const bankroll = db
    .prepare(`SELECT COUNT(*) sessions, SUM(tournaments) t, SUM(buyins) b, SUM(cashes) c FROM bankroll_sessions WHERE profile_id = ? AND day >= ? AND day < ?`)
    .get(profileId, `${m}-01`, `${next}-01`);
  const quizzes = db.prepare(`SELECT COUNT(*) n, SUM(score) s, SUM(total) t FROM quiz_attempts WHERE profile_id = ? AND created_at >= ? AND created_at < ?`).get(profileId, from, to);
  const lessons = db.prepare(`SELECT COUNT(*) n FROM lesson_done WHERE profile_id = ? AND completed_at >= ? AND completed_at < ?`).get(profileId, from, to);
  return {
    month: m,
    overview: overview(profileId, range),
    leaks: leaks(profileId, range).slice(0, 8),
    topErrors: topErrors(profileId, 8, range),
    timer: timerComparison(profileId, range),
    calibration: calibration(profileId, range),
    tilt: tilt(profileId, range),
    hands: { n: hands.n, resultBB: Math.round((hands.bb || 0) * 10) / 10, vpip: hands.n ? Math.round(((hands.vpip || 0) / hands.n) * 1000) / 10 : null, pfr: hands.n ? Math.round(((hands.pfr || 0) / hands.n) * 1000) / 10 : null },
    bankroll: { sessions: bankroll.sessions, tournaments: bankroll.t || 0, buyins: bankroll.b || 0, cashes: bankroll.c || 0, profit: (bankroll.c || 0) - (bankroll.b || 0), roi: bankroll.b ? Math.round((((bankroll.c || 0) - bankroll.b) / bankroll.b) * 1000) / 10 : null },
    quizzes: { n: quizzes.n, accuracy: quizzes.t ? Math.round((quizzes.s / quizzes.t) * 1000) / 10 : null },
    lessons: lessons.n,
  };
}

module.exports = { overview, matrix, timerComparison, trends, topErrors, leaks, tilt, calibration, heatmap, tagStats, drillStats, monthReport, lossPct, loadAttempts };
