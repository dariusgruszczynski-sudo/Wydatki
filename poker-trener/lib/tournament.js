const db = require('./db');
const S = require('./spots');
const P = require('./payouts');
const { playOnce } = require('./allin');
const R = require('./ranges');

const FIELDS = {
  18: { label: '18 graczy (2 stoły, płatne 4)', paidFraction: 4 / 18 },
  45: { label: '45 graczy (płatne 7)', paidFraction: 7 / 45 },
  90: { label: '90 graczy (płatne 12)', paidFraction: 12 / 90 },
};
const ICM_THRESHOLD = 13;
const START_CHIPS = 5000;
const START_BB = 100;

function levelBB(level) {
  const raw = START_BB * Math.pow(1.25, level - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

function createRun(profileId, { field = 45, buyin = 10, sessionKey = null, format = 'mtt' } = {}) {
  const f = FIELDS[field] ? field : 45;
  const poolTotal = buyin * f;
  const payouts = P.fieldPayouts(f, poolTotal, FIELDS[f].paidFraction);
  const state = {
    field: f,
    buyin,
    format: format === 'pko' ? 'pko' : 'mtt',
    poolTotal,
    payouts,
    paid: payouts.length,
    playersLeft: f,
    level: 1,
    bb: START_BB,
    totalChips: f * START_CHIPS,
    heroChips: START_CHIPS,
    step: 0,
    itm: false,
    history: [],
    status: 'running',
    finishPlace: null,
    prize: 0,
  };
  const now = new Date().toISOString();
  const r = db
    .prepare('INSERT INTO tournament_runs (profile_id, created_at, updated_at, status, state_json, field, session_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(profileId, now, now, 'running', JSON.stringify(state), f, sessionKey);
  return { id: Number(r.lastInsertRowid), ...state };
}

function loadRun(profileId, id) {
  const row = db.prepare('SELECT * FROM tournament_runs WHERE id = ? AND profile_id = ?').get(id, profileId);
  if (!row) return null;
  return { id: row.id, sessionKey: row.session_key, ...JSON.parse(row.state_json) };
}

function saveRun(run) {
  const state = { ...run };
  const id = state.id;
  delete state.id;
  delete state.sessionKey;
  db.prepare('UPDATE tournament_runs SET state_json = ?, updated_at = ?, status = ?, finish_place = ?, prize = ? WHERE id = ?').run(
    JSON.stringify(state),
    new Date().toISOString(),
    state.status,
    state.finishPlace,
    state.prize,
    id
  );
}

function gauss(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Upływ czasu między decyzjami: blindy rosną, gracze odpadają, stos dryfuje.
function advance(run, rng = Math.random) {
  run.step++;
  if (run.step % 3 === 0) run.level++;
  run.bb = levelBB(run.level);
  const avgBB = run.totalChips / run.playersLeft / run.bb;
  let rate = Math.min(0.2, Math.max(0.02, 0.03 + 0.8 / Math.max(avgBB, 4)));
  const nearBubble = run.playersLeft > run.paid && run.playersLeft <= run.paid + 3;
  if (nearBubble) rate *= 0.35;
  let out = Math.round(run.playersLeft * rate * (0.6 + rng() * 0.8));
  if (run.playersLeft <= 9) out = rng() < 0.45 ? 1 : 0;
  run.playersLeft = Math.max(2, run.playersLeft - out);
  const drift = (-0.9 + gauss(rng) * 1.8) * run.bb;
  run.heroChips = Math.max(run.bb * 1.2, run.heroChips + drift);
  if (run.playersLeft <= run.paid) run.itm = true;
}

function otherStacksBB(run, count, rng) {
  const remaining = run.totalChips - run.heroChips;
  const others = run.playersLeft - 1;
  const raw = [];
  for (let i = 0; i < others; i++) raw.push(Math.exp(gauss(rng) * 0.55));
  const sum = raw.reduce((a, b) => a + b, 0);
  const all = raw.map((x) => Math.max(1.5, ((x / sum) * remaining) / run.bb));
  return { table: all.slice(0, count), off: all.slice(count) };
}

function chooseType(heroBB, rng) {
  if (heroBB > 40) return rng() < 0.75 ? 'rfi' : 'facing_shove';
  if (heroBB > 25) return rng() < 0.5 ? 'rfi' : 'facing_shove';
  const r = rng();
  if (r < 0.35) return 'open_shove';
  if (r < 0.65) return 'facing_shove';
  if (r < 0.8) return heroBB >= 9 ? 'resteal' : 'open_shove';
  if (r < 0.92) return heroBB >= 9 ? 'threebet_shove' : 'facing_shove';
  return heroBB >= 8 ? 'three_way' : 'facing_shove';
}

function structureFor(run) {
  const n = Math.min(9, run.playersLeft);
  if (run.playersLeft > ICM_THRESHOLD) {
    return { format: run.format, stage: 'early', poolTotal: run.poolTotal, numPlayers: n, payouts: [], templateKey: null, valueMode: 'chips' };
  }
  const payouts = run.payouts.slice(0, run.playersLeft);
  const stage = run.playersLeft > run.paid ? 'bubble' : run.playersLeft === 2 ? 'heads_up' : run.playersLeft <= 9 ? 'final_table' : 'itm';
  return { format: run.format, stage, poolTotal: run.poolTotal, numPlayers: n, payouts, templateKey: null, valueMode: 'icm' };
}

function nextSpot(run, settings = {}) {
  const rng = Math.random;
  advance(run, rng);
  const heroBB = run.heroChips / run.bb;
  let type = chooseType(heroBB, rng);
  const structure = structureFor(run);
  if (structure.numPlayers < 4 && ['threebet_shove', 'three_way', 'squeeze'].includes(type)) type = 'open_shove';
  if (structure.numPlayers < 2) type = 'open_shove';
  const { table, off } = otherStacksBB(run, structure.numPlayers, rng);
  const heroStack = Math.round(heroBB * 10) / 10;
  const offTable = structure.valueMode === 'icm' ? off : [];
  const spot = S.generateSpot({
    type,
    structure,
    otherStacks: table,
    offTableStacks: offTable,
    stackRange: [Math.max(1, Math.floor(heroStack)), Math.max(1, Math.ceil(heroStack))],
    rfiStackRange: [Math.floor(heroStack), Math.ceil(heroStack)],
    mode: settings.mode || 'gto',
    difficulty: 'easy',
    anteMode: 'bb_ante',
  });
  spot.seats[spot.heroIdx].stack = heroStack;
  S.computeRanges(spot);
  spot.prompt = S.promptFor(spot);
  return spot;
}

function applyOutcome(run, spot, chosenAction, rng = Math.random) {
  const hero = spot.seats[spot.heroIdx];
  let summary;
  let shown = [];
  let board = [];
  if (spot.type === 'rfi') {
    if (chosenAction === 'raise') {
      const r = rng();
      const deltaBB = r < 0.45 ? 1.5 + 1 : r < 0.75 ? 4 + rng() * 8 : -(2.2 + rng() * 8);
      run.heroChips = Math.max(run.bb, run.heroChips + deltaBB * run.bb);
      summary = deltaBB > 0 ? `Otwarcie się opłaciło (+${deltaBB.toFixed(1)}bb).` : `Po flopie nie wyszło (${deltaBB.toFixed(1)}bb).`;
    } else {
      run.heroChips -= hero.posted * run.bb;
      summary = 'Pas.';
    }
  } else {
    const ctx = {
      startStacks: spot.seats.map((s) => s.stack),
      posted: spot.seats.map((s) => s.posted),
      heroIdx: spot.heroIdx,
      heroCombo: spot.heroCombo,
      opponents: spot.opponents.map((o) => ({
        idx: o.idx,
        status: o.status,
        combos: R.combosForLabels(o.holdLabels),
        callSet: o.callLabels ? new Set(o.callLabels) : null,
        labelOf: R.labelOfCombo,
      })),
      walkTo: spot.walkTo,
      board: [],
    };
    const res = playOnce(ctx, chosenAction, rng);
    const before = hero.stack;
    const after = res.finalStacks[spot.heroIdx];
    shown = res.shown.map((s) => ({ pos: spot.seats[s.idx].posLabel, cards: s.cards, hero: s.idx === spot.heroIdx }));
    board = res.board;
    const othersOut = res.eliminated.filter((e) => e.idx !== spot.heroIdx);
    if (after <= 0) {
      const smallerOut = othersOut.filter((e) => spot.seats[e.idx].stack < before).length;
      run.finishPlace = run.playersLeft - smallerOut;
      run.prize = run.payouts[run.finishPlace - 1] || 0;
      run.status = 'busted';
      run.heroChips = 0;
      summary = `Odpadasz na ${run.finishPlace}. miejscu${run.prize ? ` z nagrodą $${run.prize}` : ''}.`;
    } else {
      run.heroChips = after * run.bb;
      run.playersLeft = Math.max(1, run.playersLeft - othersOut.length);
      const diff = after - before;
      summary =
        res.continuing.length >= 2
          ? `${diff >= 0 ? 'Wygrywasz' : 'Przegrywasz'} all-in (${diff >= 0 ? '+' : ''}${diff.toFixed(1)}bb).${othersOut.length ? ` Eliminujesz ${othersOut.length} ${othersOut.length === 1 ? 'gracza' : 'graczy'}.` : ''}`
          : chosenAction === 'fold'
            ? 'Pas.'
            : `Wszyscy pasują — zgarniasz pulę (+${diff.toFixed(1)}bb).`;
    }
  }
  if (run.status === 'running' && run.playersLeft <= run.paid) run.itm = true;
  if (run.status === 'running' && run.playersLeft === 1) {
    run.status = 'won';
    run.finishPlace = 1;
    run.prize = run.payouts[0];
    summary += ` 🏆 Wygrywasz turniej! Nagroda: $${run.prize}.`;
  }
  run.history.push({ step: run.step, level: run.level, playersLeft: run.playersLeft, heroBB: Math.round((run.heroChips / run.bb) * 10) / 10, type: spot.type, action: chosenAction, summary });
  if (run.history.length > 60) run.history.shift();
  return { summary, shown, board };
}

function publicRun(run) {
  return {
    id: run.id,
    field: run.field,
    buyin: run.buyin,
    poolTotal: run.poolTotal,
    paid: run.paid,
    payoutsTop: run.payouts.slice(0, 12),
    playersLeft: run.playersLeft,
    level: run.level,
    bb: run.bb,
    heroChips: Math.round(run.heroChips),
    heroBB: Math.round((run.heroChips / run.bb) * 10) / 10,
    avgBB: Math.round((run.totalChips / run.playersLeft / run.bb) * 10) / 10,
    status: run.status,
    itm: run.itm,
    finishPlace: run.finishPlace,
    prize: run.prize,
    history: run.history.slice(-12),
    step: run.step,
  };
}

function listRuns(profileId, limit = 20) {
  return db
    .prepare('SELECT id, created_at, status, finish_place, prize, field, session_key, state_json FROM tournament_runs WHERE profile_id = ? ORDER BY id DESC LIMIT ?')
    .all(profileId, limit)
    .map((r) => {
      const s = JSON.parse(r.state_json);
      return { id: r.id, createdAt: r.created_at, status: r.status, finishPlace: r.finish_place, prize: r.prize, field: r.field, buyin: s.buyin, sessionKey: r.session_key };
    });
}

module.exports = { FIELDS, createRun, loadRun, saveRun, nextSpot, applyOutcome, publicRun, listRuns };
