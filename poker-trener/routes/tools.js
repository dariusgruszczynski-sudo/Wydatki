const express = require('express');
const db = require('../lib/db');
const R = require('../lib/ranges');
const T = require('../lib/push-fold-tables');
const P = require('../lib/payouts');
const { icmEquity, MAX_LIVE } = require('../lib/icm');
const { equityMulti } = require('../lib/equity');
const { h, httpError } = require('./util');

const router = express.Router();

function parseCards(str) {
  const cards = String(str || '').replace(/[\s,]+/g, '').match(/[2-9TJQKA][shdc]/gi) || [];
  return cards.map((c) => c[0].toUpperCase() + c[1].toLowerCase());
}

// ---------- kalkulator ICM (C1) ----------

router.post('/tools/icm', h((req) => {
  const stacks = (req.body?.stacks || []).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
  let payouts = (req.body?.payouts || []).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
  if (!payouts.length && req.body?.templateKey) payouts = P.payoutsFor(req.body.templateKey, stacks.length, Number(req.body.poolTotal) || 1000);
  if (stacks.length < 2) throw httpError(400, 'Podaj co najmniej 2 stosy.');
  if (stacks.filter((s) => s > 0).length > MAX_LIVE) throw httpError(400, `Maksymalnie ${MAX_LIVE} graczy.`);
  if (!payouts.length) throw httpError(400, 'Podaj wypłaty.');
  const ev = icmEquity(stacks, payouts);
  const totalChips = stacks.reduce((a, b) => a + b, 0);
  const totalPay = payouts.reduce((a, b) => a + b, 0);
  return {
    players: stacks.map((s, i) => ({
      stack: s,
      chipPct: Math.round((s / totalChips) * 10000) / 100,
      equity: Math.round(ev[i] * 100) / 100,
      equityPct: Math.round((ev[i] / totalPay) * 10000) / 100,
      chipChop: Math.round((s / totalChips) * totalPay * 100) / 100,
    })),
    payouts,
    totalPay,
  };
}));

router.get('/tools/payout-templates', h(() => Object.entries(P.TEMPLATES).map(([key, t]) => ({ key, label: t.label, format: t.format, pct: t.pct }))));

// ---------- kalkulator equity (C2) ----------

router.post('/tools/equity', h((req) => {
  const inputs = (req.body?.players || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (inputs.length < 2 || inputs.length > 6) throw httpError(400, 'Podaj 2–6 graczy (ręka np. AhKd albo zasięg np. QQ+,AKs).');
  const board = parseCards(req.body?.board);
  if (board.length > 5 || board.length === 1 || board.length === 2) throw httpError(400, 'Board: 0, 3, 4 albo 5 kart.');
  const players = inputs.map((txt) => {
    const cards = parseCards(txt);
    if (cards.length === 2 && /^[2-9TJQKA][shdc]\s*[2-9TJQKA][shdc]$/i.test(txt.replace(/\s+/g, ''))) {
      if (cards[0] === cards[1]) throw httpError(400, `Dwie takie same karty: ${txt}`);
      return { label: cards.join(' '), combo: cards };
    }
    const labels = R.parseRange(txt);
    if (!labels.length) throw httpError(400, `Pusty zasięg: ${txt}`);
    return { label: txt, combos: R.combosForLabels(labels), pct: R.rangePercent(labels) };
  });
  const all = [...players.filter((p) => p.combo).flatMap((p) => p.combo), ...board];
  if (new Set(all).size !== all.length) throw httpError(400, 'Te same karty pojawiają się więcej niż raz.');
  const trials = Math.min(20000, Math.max(1000, Number(req.body?.trials) || 8000));
  const res = equityMulti(players, board, trials);
  return {
    players: players.map((p, i) => ({ label: p.label, pct: p.pct ?? null, equity: Math.round(res.equities[i] * 10000) / 100 })),
    board,
    exact: res.exact,
    samples: res.samples,
  };
}));

// ---------- zasięgi (C3, C5) ----------

router.get('/ranges/grid', h(() => ({ grid: R.gridLabels(), combos: Object.fromEntries(R.ALL_TYPES.map((t) => [t.label, t.combos.length])) })));

router.post('/ranges/parse', h((req) => {
  const labels = R.parseRange(req.body?.text || '');
  return { labels, pct: R.rangePercent(labels), combos: R.comboCount(labels) };
}));

router.post('/ranges/top', h((req) => {
  const pct = Math.max(0, Math.min(100, Number(req.body?.pct) || 0));
  const labels = R.topPercentLabels(pct, req.body?.ranking === 'playability' ? R.buildPlayabilityRanking() : R.buildStrengthRanking());
  return { labels, pct: R.rangePercent(labels) };
}));

router.get('/ranges/charts', h(() => {
  const buckets = T.STACK_BUCKETS.slice(0, 5).map((b) => b.label);
  const mid = [5, 9, 13, 18, 23];
  const groups = ['EP', 'MP', 'CO', 'BTN', 'SB', 'HU'];
  return {
    buckets,
    groups: groups.map((g) => ({ key: g, label: T.GROUP_LABELS[g] })),
    shove: groups.map((g) => ({ group: g, cells: mid.map((m) => {
      const pct = T.shovePercent(g, m);
      return { pct, labels: R.topPercentLabels(pct) };
    }) })),
    call: groups.map((g) => ({ group: g, cells: mid.map((m) => {
      const pct = T.callVsShovePercent(g, m);
      return { pct, labels: R.topPercentLabels(pct) };
    }) })),
    rfi: Object.entries(T.RFI_DEEP).map(([pos, pct]) => ({ pos, pct, labels: R.topPercentLabels(pct, R.buildPlayabilityRanking()) })),
  };
}));

router.get('/ranges/custom', h((req) => db.prepare('SELECT id, name, labels, created_at FROM custom_ranges WHERE profile_id = ? ORDER BY id DESC').all(req.profile.id).map((r) => {
  const labels = JSON.parse(r.labels);
  return { ...r, labels, pct: R.rangePercent(labels) };
})));

router.post('/ranges/custom', h((req) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const labels = (req.body?.labels || []).filter((l) => R.TYPE_BY_LABEL.has(l));
  if (!name || !labels.length) throw httpError(400, 'Podaj nazwę i zaznacz ręce.');
  const r = db.prepare('INSERT INTO custom_ranges (profile_id, name, labels, created_at) VALUES (?, ?, ?, ?)').run(req.profile.id, name, JSON.stringify(labels), new Date().toISOString());
  return { id: Number(r.lastInsertRowid), name, labels, pct: R.rangePercent(labels) };
}));

router.delete('/ranges/custom/:id', h((req) => {
  db.prepare('DELETE FROM custom_ranges WHERE id = ? AND profile_id = ?').run(Number(req.params.id), req.profile.id);
  return { ok: true };
}));

// ---------- eksport / backup (C10) ----------

const EXPORT_TABLES = {
  trainer_attempts: 'trainer_attempts',
  quiz_attempts: 'quiz_attempts',
  lesson_done: 'lesson_done',
  hand_journal: 'hand_journal',
  review_queue: 'review_queue',
  achievements: 'achievements',
  xp_events: 'xp_events',
  mode_records: 'mode_records',
  daily_results: 'daily_results',
  goals: 'goals',
  opponents: 'opponents',
  hands: 'hands',
  bankroll_sessions: 'bankroll_sessions',
  custom_ranges: 'custom_ranges',
  tournament_runs: 'tournament_runs',
  ai_messages: 'ai_messages',
};

router.get('/export.json', h((req, res) => {
  const data = { app: 'poker-trener', version: 2, exportedAt: new Date().toISOString(), profile: { name: req.profile.name, avatar: req.profile.avatar, settings: req.profile.settings, pathStage: req.profile.pathStage, virtualBankroll: req.profile.virtualBankroll }, tables: {} };
  for (const t of Object.values(EXPORT_TABLES)) data.tables[t] = db.prepare(`SELECT * FROM ${t} WHERE profile_id = ?`).all(req.profile.id);
  res.setHeader('Content-Disposition', `attachment; filename="poker-trener-${req.profile.name}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
}));

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/export/attempts.csv', h((req, res) => {
  const cols = ['created_at', 'kind', 'spot_type', 'mode', 'format', 'stage', 'hero_position', 'hero_stack_bb', 'villain_position', 'hero_label', 'chosen_action', 'optimal_action', 'correct', 'close', 'ev_fold', 'ev_aggressive', 'ev_lost', 'pool_total', 'value_mode', 'time_taken_ms', 'speed_mode_ms', 'confidence'];
  const rows = db.prepare(`SELECT ${cols.join(',')} FROM trainer_attempts WHERE profile_id = ? ORDER BY id`).all(req.profile.id);
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="poker-trener-decyzje.csv"');
  res.send('﻿' + csv);
}));

router.get('/export/hands.csv', h((req, res) => {
  const cols = ['played_at', 'site', 'hand_no', 'tournament_id', 'hero_pos', 'hero_cards', 'hero_stack_bb', 'board', 'result_bb', 'hero_vpip', 'hero_pfr', 'showdown'];
  const rows = db.prepare(`SELECT ${cols.join(',')} FROM hands WHERE profile_id = ? ORDER BY played_at`).all(req.profile.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="poker-trener-rece.csv"');
  res.send('﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n'));
}));

router.post('/import.json', express.json({ limit: '60mb' }), h((req) => {
  const data = req.body;
  if (!data || data.app !== 'poker-trener' || !data.tables) throw httpError(400, 'To nie jest plik backupu Poker Trenera.');
  const counts = {};
  db.exec('BEGIN');
  try {
    for (const t of Object.values(EXPORT_TABLES)) {
      const rows = data.tables[t] || [];
      if (!rows.length) continue;
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).filter((c) => c !== 'id');
      let n = 0;
      for (const row of rows) {
        const use = cols.filter((c) => c in row);
        const values = use.map((c) => (c === 'profile_id' ? req.profile.id : row[c]));
        const r = db.prepare(`INSERT OR IGNORE INTO ${t} (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`).run(...values);
        n += r.changes;
      }
      counts[t] = n;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, imported: counts };
}));

module.exports = router;
