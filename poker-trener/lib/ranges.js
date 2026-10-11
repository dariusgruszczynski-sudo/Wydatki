const fs = require('fs');
const path = require('path');
const { RANKS, SUITS } = require('./deck');
const { equityVsRange } = require('./equity');

const RANKING_CACHE_PATH = path.join(__dirname, '..', 'data', 'hand-strength-ranking.json');

function combosForType(highRank, lowRank, suited) {
  const combos = [];
  if (highRank === lowRank) {
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        combos.push([highRank + SUITS[i], lowRank + SUITS[j]]);
      }
    }
    return combos;
  }
  for (const s1 of SUITS) {
    for (const s2 of SUITS) {
      const isSuited = s1 === s2;
      if (suited && !isSuited) continue;
      if (!suited && isSuited) continue;
      combos.push([highRank + s1, lowRank + s2]);
    }
  }
  return combos;
}

function allHandTypes() {
  const types = [];
  for (let i = RANKS.length - 1; i >= 0; i--) {
    for (let j = i; j >= 0; j--) {
      const hi = RANKS[i];
      const lo = RANKS[j];
      if (i === j) {
        types.push({ label: hi + lo, hi, lo, suited: null, combos: combosForType(hi, lo, null) });
      } else {
        types.push({ label: hi + lo + 's', hi, lo, suited: true, combos: combosForType(hi, lo, true) });
        types.push({ label: hi + lo + 'o', hi, lo, suited: false, combos: combosForType(hi, lo, false) });
      }
    }
  }
  return types;
}

const ALL_TYPES = allHandTypes();
const TOTAL_COMBOS = ALL_TYPES.reduce((s, t) => s + t.combos.length, 0);

let cachedRanking = null;

function loadPrecomputedRanking() {
  if (!fs.existsSync(RANKING_CACHE_PATH)) return null;
  const saved = JSON.parse(fs.readFileSync(RANKING_CACHE_PATH, 'utf8'));
  const byLabel = new Map(ALL_TYPES.map((t) => [t.label, t]));
  return saved
    .map((s) => (byLabel.has(s.label) ? { ...byLabel.get(s.label), equity: s.equity } : null))
    .filter(Boolean);
}

function buildStrengthRanking(trialsPerHand = 400, rng = Math.random) {
  if (cachedRanking) return cachedRanking;
  const precomputed = loadPrecomputedRanking();
  if (precomputed && precomputed.length === ALL_TYPES.length) {
    cachedRanking = precomputed;
    return cachedRanking;
  }
  const scored = ALL_TYPES.map((type) => {
    const repCombo = type.combos[0];
    const villainFullRange = ALL_TYPES.flatMap((t) => t.combos);
    const equity = equityVsRange(repCombo, villainFullRange, [], trialsPerHand, rng);
    return { ...type, equity: equity === null ? 0 : equity };
  });
  scored.sort((a, b) => b.equity - a.equity);
  cachedRanking = scored;
  return scored;
}

function topPercentCombos(percent, ranking = buildStrengthRanking()) {
  const targetCount = Math.max(1, Math.round((percent / 100) * TOTAL_COMBOS));
  const combos = [];
  let count = 0;
  for (const type of ranking) {
    if (count >= targetCount) break;
    combos.push(...type.combos);
    count += type.combos.length;
  }
  return combos;
}

function topPercentLabel(percent, ranking = buildStrengthRanking()) {
  const targetCount = Math.max(1, Math.round((percent / 100) * TOTAL_COMBOS));
  const labels = [];
  let count = 0;
  for (const type of ranking) {
    if (count >= targetCount) break;
    labels.push(type.label);
    count += type.combos.length;
  }
  return labels;
}

module.exports = {
  ALL_TYPES,
  TOTAL_COMBOS,
  combosForType,
  buildStrengthRanking,
  topPercentCombos,
  topPercentLabel,
};
