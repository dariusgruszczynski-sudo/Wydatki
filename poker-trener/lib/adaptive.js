const db = require('./db');
const { weightedPick } = require('./rng');

const TYPE_GROUPS = {
  open_shove: ['EP', 'MP', 'CO', 'BTN', 'SB', 'HU'],
  facing_shove: ['BB', 'SB'],
  threebet_shove: ['MP', 'CO', 'BTN'],
  resteal: ['SB', 'BB'],
  squeeze: ['BTN', 'SB', 'BB'],
  three_way: ['BB'],
  rfi: ['EP', 'MP', 'CO', 'BTN', 'SB'],
};

// Wybiera typ spotu i grupę pozycji z wagą rosnącą wraz z liczbą błędów (H5).
function adaptiveOptions(profileId, baseOpts) {
  const types = baseOpts.types && baseOpts.types.length ? baseOpts.types : ['open_shove', 'facing_shove', 'threebet_shove', 'resteal', 'squeeze', 'three_way'];
  const wantedGroups = new Set(baseOpts.heroPositions || []);
  const rows = db
    .prepare(
      `SELECT spot_type, hero_pos_group, COUNT(*) AS n, SUM(correct) AS c FROM (
         SELECT spot_type, hero_pos_group, correct FROM trainer_attempts
         WHERE profile_id = ? AND kind = 'spot' ORDER BY id DESC LIMIT 500
       ) GROUP BY spot_type, hero_pos_group`
    )
    .all(profileId);
  const stats = new Map(rows.map((r) => [`${r.spot_type}|${r.hero_pos_group}`, r]));
  const cells = [];
  const weights = [];
  for (const type of types) {
    for (const group of TYPE_GROUPS[type] || []) {
      if (wantedGroups.size && !wantedGroups.has(group)) continue;
      const s = stats.get(`${type}|${group}`);
      const acc = s && s.n >= 5 ? s.c / s.n : null;
      cells.push({ type, group, acc, n: s ? s.n : 0 });
      weights.push(acc === null ? 1 : 1 - acc + 0.2);
    }
  }
  if (!cells.length) return { ...baseOpts, focus: null };
  const cell = weightedPick(cells, weights, Math.random);
  const opts = { ...baseOpts, type: cell.type };
  if (cell.group === 'HU') {
    opts.stage = 'heads_up';
    opts.heroPositions = ['SB'];
  } else {
    opts.heroPositions = [cell.group];
  }
  return { ...opts, focus: cell };
}

module.exports = { adaptiveOptions, TYPE_GROUPS };
