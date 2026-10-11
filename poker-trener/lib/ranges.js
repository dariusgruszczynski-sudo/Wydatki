const fs = require('fs');
const path = require('path');
const { RANKS, SUITS } = require('./deck');
const { equityVsRange } = require('./equity');

const RANKING_CACHE_PATH = path.join(__dirname, '..', 'data', 'hand-strength-ranking.json');
const RANKS_DESC = RANKS.slice().reverse();

function combosForType(highRank, lowRank, suited) {
  const combos = [];
  if (highRank === lowRank) {
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) combos.push([highRank + SUITS[i], lowRank + SUITS[j]]);
    }
    return combos;
  }
  for (const s1 of SUITS) {
    for (const s2 of SUITS) {
      if (suited !== (s1 === s2)) continue;
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
const TYPE_BY_LABEL = new Map(ALL_TYPES.map((t) => [t.label, t]));
const TOTAL_COMBOS = 1326;

function rIdx(r) {
  return RANKS.indexOf(r);
}

function labelOfCombo(combo) {
  let [a, b] = combo;
  if (rIdx(a[0]) < rIdx(b[0])) [a, b] = [b, a];
  if (a[0] === b[0]) return a[0] + b[0];
  return a[0] + b[0] + (a[1] === b[1] ? 's' : 'o');
}

function combosForLabels(labels) {
  const out = [];
  for (const l of labels) {
    const t = TYPE_BY_LABEL.get(l);
    if (t) out.push(...t.combos);
  }
  return out;
}

function comboCount(labels) {
  let n = 0;
  for (const l of labels) {
    const t = TYPE_BY_LABEL.get(l);
    if (t) n += t.combos.length;
  }
  return n;
}

let cachedRanking = null;

function loadPrecomputedRanking() {
  if (!fs.existsSync(RANKING_CACHE_PATH)) return null;
  const saved = JSON.parse(fs.readFileSync(RANKING_CACHE_PATH, 'utf8'));
  return saved.map((s) => (TYPE_BY_LABEL.has(s.label) ? { ...TYPE_BY_LABEL.get(s.label), equity: s.equity } : null)).filter(Boolean);
}

function buildStrengthRanking(trialsPerHand = 400, rng = Math.random) {
  if (cachedRanking) return cachedRanking;
  const precomputed = loadPrecomputedRanking();
  if (precomputed && precomputed.length === ALL_TYPES.length) {
    cachedRanking = precomputed;
    return cachedRanking;
  }
  const villainFullRange = ALL_TYPES.flatMap((t) => t.combos);
  const scored = ALL_TYPES.map((type) => {
    const equity = equityVsRange(type.combos[0], villainFullRange, [], trialsPerHand, rng);
    return { ...type, equity: equity === null ? 0 : equity };
  });
  scored.sort((a, b) => b.equity - a.equity);
  cachedRanking = scored;
  return scored;
}

let cachedPlayability = null;

// Ranking do otwarć przy głębokich stosach: equity all-in plus premia za kolor,
// łączność i pary (grywalność po flopie), kara za słabe offsuit bez łączności.
function buildPlayabilityRanking() {
  if (cachedPlayability) return cachedPlayability;
  const scored = buildStrengthRanking().map((t) => {
    let score = t.equity * 100;
    const gap = rIdx(t.hi) - rIdx(t.lo);
    if (t.suited === null) score += 9 + rIdx(t.hi) * 0.3;
    if (t.suited) score += 4;
    if (t.suited && gap <= 3 && rIdx(t.lo) >= 2) score += [0, 4, 2.5, 1][gap] || 0;
    if (t.suited !== null && rIdx(t.lo) >= 8) score += 3;
    if (t.suited === false && gap === 1 && rIdx(t.lo) >= 6) score += 1.5;
    if (t.suited === false && gap > 2 && rIdx(t.lo) < 7) score -= 5;
    if (t.hi === 'A' && t.suited) score += 1.5;
    return { ...t, playability: score };
  });
  scored.sort((a, b) => b.playability - a.playability);
  cachedPlayability = scored;
  return scored;
}

function topPercentLabels(percent, ranking = buildStrengthRanking()) {
  const p = Math.max(0, Math.min(100, percent));
  const target = Math.round((p / 100) * TOTAL_COMBOS);
  const labels = [];
  let count = 0;
  for (const type of ranking) {
    if (count >= target) break;
    labels.push(type.label);
    count += type.combos.length;
  }
  return labels;
}

function topPercentCombos(percent, ranking) {
  return combosForLabels(topPercentLabels(percent, ranking));
}

function gridLabels() {
  const grid = [];
  for (let i = 0; i < 13; i++) {
    const row = [];
    for (let j = 0; j < 13; j++) {
      const a = RANKS_DESC[i];
      const b = RANKS_DESC[j];
      if (i === j) row.push(a + b);
      else if (i < j) row.push(a + b + 's');
      else row.push(b + a + 'o');
    }
    grid.push(row);
  }
  return grid;
}

function expandToken(token) {
  const t = token.trim();
  if (!t) return [];
  const pct = t.match(/^(\d+(?:\.\d+)?)%$/);
  if (pct) return topPercentLabels(Number(pct[1]));
  if (/^(random|any|100%)$/i.test(t)) return ALL_TYPES.map((x) => x.label);

  const pairRange = t.match(/^([2-9TJQKA])\1-([2-9TJQKA])\2$/i);
  if (pairRange) {
    const a = rIdx(pairRange[1].toUpperCase());
    const b = rIdx(pairRange[2].toUpperCase());
    const out = [];
    for (let r = Math.min(a, b); r <= Math.max(a, b); r++) out.push(RANKS[r] + RANKS[r]);
    return out;
  }
  const pairPlus = t.match(/^([2-9TJQKA])\1\+$/i);
  if (pairPlus) {
    const out = [];
    for (let r = rIdx(pairPlus[1].toUpperCase()); r < 13; r++) out.push(RANKS[r] + RANKS[r]);
    return out;
  }
  const pair = t.match(/^([2-9TJQKA])\1$/i);
  if (pair) return [pair[1].toUpperCase().repeat(2)];

  const kickerRange = t.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)-([2-9TJQKA])([2-9TJQKA])([so]?)$/i);
  if (kickerRange && kickerRange[1].toUpperCase() === kickerRange[4].toUpperCase()) {
    const hi = kickerRange[1].toUpperCase();
    const k1 = rIdx(kickerRange[2].toUpperCase());
    const k2 = rIdx(kickerRange[5].toUpperCase());
    const suf = (kickerRange[3] || kickerRange[6]).toLowerCase();
    const out = [];
    for (let k = Math.min(k1, k2); k <= Math.max(k1, k2); k++) {
      if (k >= rIdx(hi)) continue;
      if (suf) out.push(hi + RANKS[k] + suf);
      else out.push(hi + RANKS[k] + 's', hi + RANKS[k] + 'o');
    }
    return out;
  }
  const kickerPlus = t.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)\+$/i);
  if (kickerPlus) {
    const hi = kickerPlus[1].toUpperCase();
    const suf = kickerPlus[3].toLowerCase();
    const out = [];
    for (let k = rIdx(kickerPlus[2].toUpperCase()); k < rIdx(hi); k++) {
      if (suf) out.push(hi + RANKS[k] + suf);
      else out.push(hi + RANKS[k] + 's', hi + RANKS[k] + 'o');
    }
    return out;
  }
  const single = t.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)$/i);
  if (single) {
    let a = single[1].toUpperCase();
    let b = single[2].toUpperCase();
    if (rIdx(a) < rIdx(b)) [a, b] = [b, a];
    const suf = single[3].toLowerCase();
    if (suf) return [a + b + suf];
    return [a + b + 's', a + b + 'o'];
  }
  throw new Error(`Nie rozumiem fragmentu zasięgu: "${t}"`);
}

function parseRange(text) {
  const set = new Set();
  for (const token of String(text || '').split(/[,\s]+/)) {
    for (const l of expandToken(token)) if (TYPE_BY_LABEL.has(l)) set.add(l);
  }
  return [...set];
}

function rangePercent(labels) {
  return Math.round((comboCount(labels) / TOTAL_COMBOS) * 1000) / 10;
}

module.exports = {
  ALL_TYPES,
  TYPE_BY_LABEL,
  TOTAL_COMBOS,
  RANKS_DESC,
  combosForType,
  labelOfCombo,
  combosForLabels,
  comboCount,
  buildStrengthRanking,
  buildPlayabilityRanking,
  topPercentLabels,
  topPercentCombos,
  gridLabels,
  parseRange,
  rangePercent,
};
