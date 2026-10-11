const db = require('./db');
const T = require('./push-fold-tables');
const G = require('./gamification');
const Rv = require('./review');
const C = require('./content');

const PENDING_TTL = 30 * 60 * 1000;
const pending = new Map();
const resolved = new Map();

function sweep(map) {
  const now = Date.now();
  for (const [k, v] of map) if (now - v.at > PENDING_TTL) map.delete(k);
}
setInterval(() => {
  sweep(pending);
  sweep(resolved);
}, 5 * 60 * 1000).unref();

function putPending(item, profileId, ctx = {}) {
  pending.set(item.id, { item, profileId, ctx, at: Date.now() });
  return item.id;
}

function takePending(id, profileId) {
  const p = pending.get(id);
  if (!p || p.profileId !== profileId) return null;
  pending.delete(id);
  return p;
}

function putResolved(spot, result, profileId) {
  resolved.set(spot.id, { spot, result, profileId, at: Date.now() });
}

function getResolved(id, profileId) {
  const r = resolved.get(id);
  return r && r.profileId === profileId ? r : null;
}

function bankrollDelta(spot, result) {
  if (result.close && !result.correct) return 0;
  if (spot.type === 'rfi') return result.correct ? 5 : -5;
  const d = Math.abs(result.evDelta || 0);
  const units = spot.valueMode === 'chips' ? d * 20 : (d / spot.poolTotal) * 10000;
  const v = Math.max(1, Math.round(units));
  return result.correct ? v : -v;
}

function effStack(spot) {
  const hero = spot.seats[spot.heroIdx];
  if (spot.type === 'rfi' || spot.mainVillainIdx == null) return hero.stack;
  return Math.min(hero.stack, spot.seats[spot.mainVillainIdx].stack);
}

function recordSpot(profileId, spot, result, ctx = {}) {
  const hero = spot.seats[spot.heroIdx];
  const villain = spot.mainVillainIdx != null ? spot.seats[spot.mainVillainIdx] : null;
  const main = spot.opponents.find((o) => o.idx === spot.mainVillainIdx);
  const speedMs = ctx.speedMs || null;
  const xp = result.correct ? (ctx.mode === 'review' ? G.XP.reviewCorrect : speedMs && speedMs <= 10000 ? G.XP.spotCorrectSpeed : G.XP.spotCorrect) : G.XP.spotWrong;
  const bDelta = bankrollDelta(spot, result);
  const evs = result.evs || {};
  const aggrKey = spot.actions[0];
  const r = db
    .prepare(
      `INSERT INTO trainer_attempts
        (created_at, decision_type, hero_position, villain_position, hero_stack_bb, villain_stack_bb, num_players, hero_cards,
         range_percent, chosen_action, optimal_action, correct, ev_fold, ev_aggressive, ev_lost, speed_mode_ms, time_taken_ms, timed_out,
         profile_id, kind, spot_type, mode, format, stage, hero_pos_group, stack_bucket, hero_label, opp_type, confidence, close,
         ev_delta, pool_total, value_mode, spot_json, xp, bankroll_delta, run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'spot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      new Date().toISOString(),
      spot.type,
      hero.pos,
      villain ? villain.pos : '-',
      hero.stack,
      villain ? villain.stack : 0,
      spot.numPlayers,
      JSON.stringify(spot.heroCombo),
      main ? (main.callPct ?? main.holdPct ?? 0) : spot.openPct || 0,
      result.chosen,
      result.optimal,
      result.correct ? 1 : 0,
      evs.fold ?? 0,
      evs[aggrKey] ?? 0,
      result.evLoss || 0,
      speedMs,
      ctx.timeTakenMs || null,
      ctx.timedOut ? 1 : 0,
      profileId,
      spot.type,
      ctx.mode || 'standard',
      spot.format,
      spot.stage,
      T.groupOf(hero.pos, spot.numPlayers),
      T.STACK_BUCKETS[T.bucketIndex(effStack(spot))].label,
      spot.heroLabel,
      villain && spot.mode === 'exploit' ? villain.oppType || null : null,
      ctx.confidence || null,
      result.close ? 1 : 0,
      result.evDelta ?? null,
      spot.poolTotal,
      spot.valueMode,
      JSON.stringify(spot),
      xp,
      bDelta,
      ctx.runId || null
    );
  const attemptId = Number(r.lastInsertRowid);
  G.addXp(profileId, xp, `spot:${spot.type}`);
  db.prepare('UPDATE profiles SET virtual_bankroll = virtual_bankroll + ? WHERE id = ?').run(bDelta, profileId);

  let review = null;
  if (ctx.mode === 'review' && ctx.reviewId) review = Rv.recordReview(profileId, ctx.reviewId, result.correct);
  else if (!result.correct && !['daily', 'exam', 'replay', 'custom'].includes(ctx.mode)) Rv.addMistake(profileId, spot, attemptId);
  return { attemptId, xp, bankrollDelta: bDelta, review };
}

function recordDrill(profileId, drill, res, ctx = {}) {
  const xp = res.correct ? G.XP.drillCorrect : G.XP.drillWrong;
  const r = db
    .prepare(
      `INSERT INTO trainer_attempts
        (created_at, decision_type, hero_position, villain_position, hero_stack_bb, villain_stack_bb, num_players, hero_cards,
         range_percent, chosen_action, optimal_action, correct, ev_fold, ev_aggressive, ev_lost, time_taken_ms,
         profile_id, kind, spot_type, mode, xp)
       VALUES (?, ?, '-', '-', 0, 0, 0, '[]', 0, ?, ?, ?, 0, 0, 0, ?, ?, 'drill', ?, ?, ?)`
    )
    .run(new Date().toISOString(), drill.type, String(res.chosen ?? ''), String(res.answer), res.correct ? 1 : 0, ctx.timeTakenMs || null, profileId, drill.type, ctx.mode || 'drill', xp);
  G.addXp(profileId, xp, `drill:${drill.type}`);
  return { attemptId: Number(r.lastInsertRowid), xp };
}

function progressPayload(profileId) {
  const xp = G.totalXp(profileId);
  const p = db.prepare('SELECT virtual_bankroll FROM profiles WHERE id = ?').get(profileId);
  return {
    level: G.levelFromXp(xp),
    virtualBankroll: Math.round(p.virtual_bankroll),
    newAchievements: G.checkAchievements(profileId, { lessonCount: C.getLessons().length }),
  };
}

module.exports = { putPending, takePending, putResolved, getResolved, recordSpot, recordDrill, progressPayload };
