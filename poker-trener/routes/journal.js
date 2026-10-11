const express = require('express');
const db = require('../lib/db');
const H = require('../lib/handhistory');
const S = require('../lib/spots');
const A = require('../lib/analytics');
const G = require('../lib/gamification');
const At = require('../lib/attempts');
const { h, httpError, num } = require('./util');

const router = express.Router();

// ---------- dziennik ----------

const JOURNAL_FIELDS = ['title', 'stage', 'position', 'stack_bb', 'hero_cards', 'board', 'action_summary', 'result', 'result_bb', 'notes', 'tags', 'opponent', 'hand_id'];

function journalValues(b) {
  return {
    title: b.title || null,
    stage: b.stage || null,
    position: b.position || null,
    stack_bb: num(b.stackBb ?? b.stack_bb),
    hero_cards: b.heroCards ?? b.hero_cards ?? null,
    board: b.board || null,
    action_summary: b.actionSummary ?? b.action_summary ?? null,
    result: b.result || null,
    result_bb: num(b.resultBb ?? b.result_bb),
    notes: b.notes || null,
    tags: Array.isArray(b.tags) ? b.tags.join(',') : b.tags || null,
    opponent: b.opponent || null,
    hand_id: num(b.handId ?? b.hand_id),
  };
}

router.get('/journal', h((req) => {
  const tag = req.query.tag ? `%${String(req.query.tag).toLowerCase()}%` : null;
  const rows = tag
    ? db.prepare('SELECT * FROM hand_journal WHERE profile_id = ? AND lower(tags) LIKE ? ORDER BY id DESC LIMIT 300').all(req.profile.id, tag)
    : db.prepare('SELECT * FROM hand_journal WHERE profile_id = ? ORDER BY id DESC LIMIT 300').all(req.profile.id);
  return rows;
}));

router.post('/journal', h((req) => {
  const v = journalValues(req.body || {});
  const r = db
    .prepare(`INSERT INTO hand_journal (created_at, profile_id, ${JOURNAL_FIELDS.join(',')}) VALUES (?, ?, ${JOURNAL_FIELDS.map(() => '?').join(',')})`)
    .run(new Date().toISOString(), req.profile.id, ...JOURNAL_FIELDS.map((f) => v[f]));
  return { id: Number(r.lastInsertRowid), ...At.progressPayload(req.profile.id) };
}));

router.put('/journal/:id', h((req) => {
  const v = journalValues(req.body || {});
  db.prepare(`UPDATE hand_journal SET ${JOURNAL_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ? AND profile_id = ?`).run(...JOURNAL_FIELDS.map((f) => v[f]), Number(req.params.id), req.profile.id);
  return { ok: true };
}));

router.delete('/journal/:id', h((req) => {
  db.prepare('DELETE FROM hand_journal WHERE id = ? AND profile_id = ?').run(Number(req.params.id), req.profile.id);
  return { ok: true };
}));

router.get('/journal/tags', h((req) => A.tagStats(req.profile.id)));

// ---------- import historii rąk (C6) ----------

router.post('/hands/import', h((req) => {
  const text = String(req.body?.text || '');
  if (!text.trim()) throw httpError(400, 'Wklej albo wgraj historię rąk.');
  const { hands, errors } = H.parseText(text);
  if (!hands.length) throw httpError(400, errors.length ? `Nie udało się odczytać rąk: ${errors.slice(0, 3).join('; ')}` : 'Nie znaleziono rąk PokerStars/GGPoker w tym tekście.');
  const ins = db.prepare(
    `INSERT OR IGNORE INTO hands (profile_id, site, hand_no, tournament_id, played_at, sb, bb, ante, max_seats, hero_name, hero_cards, hero_pos, hero_stack_bb,
       board, players_json, actions_json, result_bb, showdown, hero_vpip, hero_pfr, hero_3bet, hero_allin_pre, raw, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let added = 0;
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const x of hands) {
      const r = ins.run(
        req.profile.id, x.site, x.handNo, x.tournamentId, x.playedAt, x.sb, x.bb, x.ante, x.maxSeats, x.heroName,
        x.heroCards ? x.heroCards.join('') : null, x.heroPos, x.heroStackBB, x.board.join(' '),
        JSON.stringify(x.players), JSON.stringify(x.actions), x.resultBB, x.showdown ? 1 : 0,
        x.heroVpip ? 1 : 0, x.heroPfr ? 1 : 0, x.hero3bet ? 1 : 0, x.heroAllinPre ? 1 : 0, x.raw, now
      );
      added += r.changes;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  if (added) G.addXp(req.profile.id, Math.min(200, added * G.XP.handImport), 'hands:import');
  return { parsed: hands.length, added, duplicates: hands.length - added, errors: errors.length, ...At.progressPayload(req.profile.id) };
}));

router.get('/hands', h((req) => {
  const limit = Math.min(500, num(req.query.limit, 100));
  const offset = num(req.query.offset, 0);
  const where = ['profile_id = ?'];
  const params = [req.profile.id];
  if (req.query.pos) {
    where.push('hero_pos = ?');
    params.push(String(req.query.pos));
  }
  if (req.query.flagged === '1') where.push("review_json LIKE '%\"correct\":false%'");
  if (req.query.allin === '1') where.push('hero_allin_pre = 1');
  const rows = db
    .prepare(`SELECT id, site, hand_no, tournament_id, played_at, bb, hero_cards, hero_pos, hero_stack_bb, board, result_bb, showdown, hero_vpip, hero_pfr, hero_allin_pre, review_json FROM hands WHERE ${where.join(' AND ')} ORDER BY played_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) c FROM hands WHERE ${where.join(' AND ')}`).get(...params).c;
  return { total, rows: rows.map((r) => ({ ...r, review: r.review_json ? JSON.parse(r.review_json) : null, review_json: undefined })) };
}));

router.get('/hands/stats', h((req) => {
  const p = req.profile.id;
  const all = db.prepare('SELECT COUNT(*) n, SUM(hero_vpip) v, SUM(hero_pfr) pf, SUM(hero_3bet) t, SUM(result_bb) r, SUM(showdown) sd FROM hands WHERE profile_id = ?').get(p);
  const byPos = db
    .prepare('SELECT hero_pos AS pos, COUNT(*) n, SUM(hero_vpip) v, SUM(hero_pfr) pf, SUM(result_bb) r FROM hands WHERE profile_id = ? AND hero_pos IS NOT NULL GROUP BY hero_pos')
    .all(p)
    .map((r) => ({ pos: r.pos, n: r.n, vpip: Math.round((r.v / r.n) * 1000) / 10, pfr: Math.round((r.pf / r.n) * 1000) / 10, resultBB: Math.round((r.r || 0) * 10) / 10, bbPer100: Math.round(((r.r || 0) / r.n) * 1000) / 10 }));
  const reviewed = db.prepare("SELECT review_json FROM hands WHERE profile_id = ? AND review_json IS NOT NULL AND review_json <> 'null'").all(p).map((r) => JSON.parse(r.review_json));
  const pending = db.prepare('SELECT COUNT(*) c FROM hands WHERE profile_id = ? AND review_json IS NULL').get(p).c;
  const pct = (a) => (all.n ? Math.round(((a || 0) / all.n) * 1000) / 10 : null);
  return {
    hands: all.n,
    vpip: pct(all.v),
    pfr: pct(all.pf),
    threeBet: pct(all.t),
    showdown: pct(all.sd),
    resultBB: Math.round((all.r || 0) * 10) / 10,
    bbPer100: all.n ? Math.round(((all.r || 0) / all.n) * 1000) / 10 : null,
    byPos,
    pushFold: { reviewed: reviewed.length, mistakes: reviewed.filter((r) => !r.correct).length, pending },
  };
}));

router.get('/hands/:id', h((req) => {
  const row = db.prepare('SELECT * FROM hands WHERE id = ? AND profile_id = ?').get(Number(req.params.id), req.profile.id);
  if (!row) throw httpError(404, 'Nie ma takiej ręki.');
  return { ...row, players: JSON.parse(row.players_json), actions: JSON.parse(row.actions_json), review: row.review_json ? JSON.parse(row.review_json) : null, players_json: undefined, actions_json: undefined, review_json: undefined };
}));

router.delete('/hands/:id', h((req) => {
  db.prepare('DELETE FROM hands WHERE id = ? AND profile_id = ?').run(Number(req.params.id), req.profile.id);
  return { ok: true };
}));

// Porównanie spotów push/fold z importowanych rąk z modelem (chip EV) — porcjami.
router.post('/hands/review-batch', h((req) => {
  const budgetMs = 8000;
  const start = Date.now();
  const rows = db.prepare('SELECT id, raw FROM hands WHERE profile_id = ? AND review_json IS NULL ORDER BY id LIMIT 400').all(req.profile.id);
  const upd = db.prepare('UPDATE hands SET review_json = ? WHERE id = ?');
  let processed = 0;
  let spots = 0;
  let mistakes = 0;
  for (const r of rows) {
    if (Date.now() - start > budgetMs) break;
    let review = null;
    try {
      const parsed = H.parseHand(r.raw);
      const det = H.detectPushFoldSpot(parsed);
      if (det) {
        const spot = S.customSpot(det.input);
        const res = S.resolveSpot(spot, det.chosen, { trials: 700 });
        review = { type: det.input.type, chosen: det.chosen, optimal: res.optimal, correct: res.correct, close: res.close, evs: res.evs, unit: res.unit, explanation: res.explanation.slice(0, 3) };
        spots++;
        if (!res.correct) mistakes++;
      }
    } catch {
      review = null;
    }
    upd.run(JSON.stringify(review), r.id);
    processed++;
  }
  const remaining = db.prepare('SELECT COUNT(*) c FROM hands WHERE profile_id = ? AND review_json IS NULL').get(req.profile.id).c;
  return { processed, spots, mistakes, remaining };
}));

router.post('/hands/:id/journal', h((req) => {
  const x = db.prepare('SELECT * FROM hands WHERE id = ? AND profile_id = ?').get(Number(req.params.id), req.profile.id);
  if (!x) throw httpError(404, 'Nie ma takiej ręki.');
  const actions = JSON.parse(x.actions_json)
    .filter((a) => a.type === 'action' || a.type === 'board')
    .map((a) => (a.type === 'board' ? `| ${a.street}: ${a.cards.join(' ')} |` : `${a.pos || a.name}: ${a.verb}${a.amount ? ' ' + a.amount : ''}${a.allin ? ' (all-in)' : ''}`))
    .join(', ');
  const result = x.result_bb > 0 ? 'win' : x.result_bb < 0 && x.hero_vpip ? 'loss' : 'fold';
  const r = db
    .prepare(`INSERT INTO hand_journal (created_at, profile_id, title, stage, position, stack_bb, hero_cards, board, action_summary, result, result_bb, notes, tags, hand_id) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(new Date().toISOString(), req.profile.id, `${x.site} #${x.hand_no}`, x.hero_pos, x.hero_stack_bb, x.hero_cards, x.board, actions, result, x.result_bb, req.body?.notes || null, req.body?.tags || 'import', x.id);
  return { id: Number(r.lastInsertRowid) };
}));

// ---------- przeciwnicy (G8) ----------

router.get('/opponents', h((req) => {
  const notes = db.prepare('SELECT * FROM opponents WHERE profile_id = ? ORDER BY updated_at DESC').all(req.profile.id);
  const agg = new Map();
  const rows = db.prepare('SELECT site, hero_name, players_json, played_at FROM hands WHERE profile_id = ? ORDER BY played_at DESC LIMIT 20000').all(req.profile.id);
  for (const r of rows) {
    for (const pl of JSON.parse(r.players_json)) {
      if (pl.name === r.hero_name || pl.sittingOut) continue;
      const key = `${pl.name}|${r.site}`;
      const a = agg.get(key) || { name: pl.name, site: r.site, hands: 0, vpip: 0, pfr: 0, lastSeen: r.played_at, showed: [] };
      a.hands++;
      if (pl.vpip) a.vpip++;
      if (pl.pfr) a.pfr++;
      if (pl.showed && a.showed.length < 8) a.showed.push(pl.showed.join(''));
      agg.set(key, a);
    }
  }
  const seen = [...agg.values()]
    .filter((a) => a.hands >= 3)
    .map((a) => {
      const vpip = Math.round((a.vpip / a.hands) * 1000) / 10;
      const pfr = Math.round((a.pfr / a.hands) * 1000) / 10;
      const suggested = a.hands < 20 ? null : vpip < 15 ? 'nit' : vpip > 40 && pfr > 25 ? 'maniac' : vpip > 35 && pfr < 12 ? 'fish' : vpip > 28 && pfr > 18 ? 'lag' : 'reg';
      return { ...a, vpip, pfr, suggestedType: suggested };
    })
    .sort((a, b) => b.hands - a.hands)
    .slice(0, 200);
  return { notes, seen };
}));

router.post('/opponents', h((req) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw httpError(400, 'Podaj nick przeciwnika.');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO opponents (profile_id, name, site, type, notes, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id, name, site) DO UPDATE SET type = excluded.type, notes = excluded.notes, tags = excluded.tags, updated_at = excluded.updated_at`
  ).run(req.profile.id, name, String(b.site || ''), b.type || null, b.notes || null, Array.isArray(b.tags) ? b.tags.join(',') : b.tags || null, now, now);
  return { ok: true };
}));

router.delete('/opponents/:id', h((req) => {
  db.prepare('DELETE FROM opponents WHERE id = ? AND profile_id = ?').run(Number(req.params.id), req.profile.id);
  return { ok: true };
}));

module.exports = router;
