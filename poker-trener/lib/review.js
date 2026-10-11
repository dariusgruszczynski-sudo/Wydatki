const db = require('./db');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const MASTERED_AFTER = 4;

function iso(ms) {
  return new Date(ms).toISOString();
}

function addMistake(profileId, spot, attemptId) {
  const json = JSON.stringify(spot);
  db.prepare(
    `INSERT INTO review_queue (profile_id, spot_json, source_attempt_id, due_at, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(profileId, json, attemptId || null, iso(Date.now() + 10 * MINUTE), new Date().toISOString());
}

function recordReview(profileId, reviewId, correct) {
  const r = db.prepare('SELECT * FROM review_queue WHERE id = ? AND profile_id = ?').get(reviewId, profileId);
  if (!r) return null;
  let { reps, lapses, ease, interval_days: interval } = r;
  let active = 1;
  let due;
  if (correct) {
    reps++;
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(interval * ease * 10) / 10;
    due = Date.now() + interval * DAY;
    if (reps >= MASTERED_AFTER) active = 0;
  } else {
    lapses++;
    reps = 0;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
    due = Date.now() + 10 * MINUTE;
  }
  db.prepare('UPDATE review_queue SET reps = ?, lapses = ?, ease = ?, interval_days = ?, due_at = ?, active = ? WHERE id = ?').run(reps, lapses, ease, interval, iso(due), active, reviewId);
  return { reps, lapses, interval, active: !!active, mastered: !active, nextDue: iso(due) };
}

function nextDue(profileId) {
  return db.prepare(`SELECT * FROM review_queue WHERE profile_id = ? AND active = 1 AND due_at <= ? ORDER BY due_at ASC LIMIT 1`).get(profileId, new Date().toISOString());
}

function summary(profileId) {
  const now = new Date().toISOString();
  const r = db
    .prepare(
      `SELECT
        SUM(CASE WHEN active = 1 AND due_at <= ? THEN 1 ELSE 0 END) AS due,
        SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END) AS mastered,
        MIN(CASE WHEN active = 1 AND due_at > ? THEN due_at END) AS nextAt
       FROM review_queue WHERE profile_id = ?`
    )
    .get(now, now, profileId);
  return { due: r.due || 0, active: r.active || 0, mastered: r.mastered || 0, nextAt: r.nextAt || null };
}

module.exports = { addMistake, recordReview, nextDue, summary };
