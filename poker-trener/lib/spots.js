const crypto = require('crypto');
const { seededRng, randomSeed, randInt, pick, weightedPick } = require('./rng');
const { fullDeck, shuffle } = require('./deck');
const R = require('./ranges');
const T = require('./push-fold-tables');
const P = require('./payouts');
const { simulateAction } = require('./allin');
const { icmEquity } = require('./icm');
const { equityVsRange } = require('./equity');

const SPOT_TYPES = {
  open_shove: { label: 'Open shove', actions: ['shove', 'fold'] },
  facing_shove: { label: 'Call vs shove', actions: ['call', 'fold'] },
  threebet_shove: { label: '3-bet shove', actions: ['shove', 'fold'] },
  resteal: { label: 'Resteal z blindów', actions: ['shove', 'fold'] },
  squeeze: { label: 'Squeeze', actions: ['shove', 'fold'] },
  three_way: { label: 'All-in 3-way (overcall)', actions: ['call', 'fold'] },
  rfi: { label: 'Otwarcie (deep, 40-100bb)', actions: ['raise', 'fold'] },
};

const STAGE_LABELS = {
  early: 'Wczesna faza (chip EV)',
  bubble: 'Bąbelek',
  final_table: 'Final table',
  itm: 'W pieniądzach',
  heads_up: 'Heads-up',
};

const ALL_LABELS = R.ALL_TYPES.map((t) => t.label);
function percentileMap(ranking) {
  const map = new Map();
  let cum = 0;
  for (const t of ranking) {
    map.set(t.label, ((cum + t.combos.length / 2) / R.TOTAL_COMBOS) * 100);
    cum += t.combos.length;
  }
  return map;
}

let strengthMap = null;
let playabilityMap = null;

function strengthPctOf(label) {
  if (!strengthMap) strengthMap = percentileMap(R.buildStrengthRanking());
  return strengthMap.get(label);
}

function playabilityPctOf(label) {
  if (!playabilityMap) playabilityMap = percentileMap(R.buildPlayabilityRanking());
  return playabilityMap.get(label);
}

function topLabels(pct, ranking = 'strength') {
  return R.topPercentLabels(pct, ranking === 'playability' ? R.buildPlayabilityRanking() : R.buildStrengthRanking());
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

// ---------- konfiguracja turnieju (format, etap, wypłaty) ----------

function chooseFormat(opts, rng) {
  if (opts.format && opts.format !== 'mix') return opts.format;
  return weightedPick(['mtt', 'pko', 'sng', 'satellite', 'wta'], [5, 2, 2, 1.5, 0.5], rng);
}

function chooseStage(format, opts, rng) {
  const allowed = {
    mtt: ['early', 'bubble', 'final_table', 'heads_up'],
    pko: ['early', 'bubble', 'final_table', 'heads_up'],
    sng: ['bubble', 'itm', 'heads_up'],
    satellite: ['bubble'],
    wta: ['early', 'heads_up'],
  }[format];
  if (opts.stage && opts.stage !== 'any' && allowed.includes(opts.stage)) return opts.stage;
  const weights = allowed.map((s) => ({ early: 2, bubble: 3, final_table: 3, itm: 2, heads_up: 1 })[s]);
  return weightedPick(allowed, weights, rng);
}

function buildStructure(opts, rng) {
  const minPlayers = opts.minPlayers || 2;
  for (let attempt = 0; attempt < 25; attempt++) {
    const st = buildStructureOnce(opts, rng);
    if (st.numPlayers >= minPlayers) return st;
  }
  return buildStructureOnce({ ...opts, format: 'mtt', stage: 'final_table', numPlayers: [Math.max(minPlayers, 3), 9] }, rng);
}

function buildStructureOnce(opts, rng) {
  const format = chooseFormat(opts, rng);
  const stage = chooseStage(format, opts, rng);
  const poolTotal = opts.poolTotal || pick([1000, 2500, 5000, 10000, 25000], rng);
  const [minN, maxN] = opts.numPlayers || [3, 9];
  const clampN = (n) => Math.max(2, Math.min(9, n));
  let numPlayers;
  let payouts;
  let templateKey;
  let valueMode = 'icm';

  if (stage === 'heads_up') {
    numPlayers = 2;
    templateKey = format === 'wta' ? 'winner_all' : format === 'sng' ? 'sng9' : format === 'pko' ? 'pko' : 'mtt_top';
    payouts = P.payoutsFor(templateKey, 2, poolTotal);
    if (format === 'wta') valueMode = 'chips';
  } else if (stage === 'early') {
    numPlayers = clampN(randInt(Math.max(minN, 5), Math.max(maxN, 5), rng));
    templateKey = null;
    payouts = [];
    valueMode = 'chips';
  } else if (format === 'satellite') {
    templateKey = pick(P.FORMAT_TEMPLATES.satellite, rng);
    const seats = P.TEMPLATES[templateKey].pct.length;
    numPlayers = clampN(seats + randInt(1, 3, rng));
    payouts = P.payoutsFor(templateKey, numPlayers, poolTotal);
  } else if (format === 'sng') {
    templateKey = pick(P.FORMAT_TEMPLATES.sng, rng);
    const paid = P.TEMPLATES[templateKey].pct.length;
    numPlayers = stage === 'bubble' ? paid + 1 : clampN(randInt(2, paid, rng));
    payouts = P.payoutsFor(templateKey, numPlayers, poolTotal);
  } else {
    templateKey = format === 'pko' ? 'pko' : pick(P.FORMAT_TEMPLATES.mtt, rng);
    numPlayers = clampN(randInt(Math.max(minN, 3), maxN, rng));
    if (stage === 'bubble') {
      const unpaid = numPlayers >= 6 && rng() < 0.3 ? 2 : 1;
      payouts = P.payoutsFor(templateKey, numPlayers - unpaid, poolTotal);
    } else {
      payouts = P.payoutsFor(templateKey, numPlayers, poolTotal);
    }
  }
  return { format, stage, poolTotal, numPlayers, payouts, templateKey, valueMode };
}

// ---------- stół ----------

function postingFor(pos, anteMode, numPlayers) {
  let p = 0;
  if (pos === 'SB') p += 0.5;
  if (pos === 'BB') p += 1;
  if (anteMode === 'classic') p += 0.125;
  if (anteMode === 'bb_ante' && pos === 'BB') p += 1;
  if (numPlayers === 2 && pos === 'SB' && anteMode === 'bb_ante') p += 0;
  return p;
}

function buildSeats(numPlayers, opts, rng) {
  const positions = T.POSITIONS_BY_COUNT[numPlayers];
  const anteMode = opts.anteMode || 'bb_ante';
  return positions.map((pos, i) => ({
    seat: i,
    pos,
    posLabel: T.POSITION_LABELS[pos],
    stack: randInt(opts.otherMin ?? 6, opts.otherMax ?? 55, rng),
    posted: postingFor(pos, anteMode, numPlayers),
    role: 'folded',
    status: 'folded',
  }));
}

function chooseOppType(opts, rng) {
  if ((opts.mode || 'gto') === 'gto') return 'reg';
  if (opts.oppType && opts.oppType !== 'random') return opts.oppType;
  return weightedPick(['reg', 'nit', 'lag', 'maniac', 'fish'], [3, 2, 2, 1, 2], rng);
}

function heroStackFrom(opts, def, rng) {
  const [lo, hi] = opts.stackRange || def;
  return randInt(Math.max(def[0], lo), Math.max(Math.max(def[0], lo), Math.min(def[1], hi)), rng);
}

function filterPositions(candidates, opts) {
  if (!opts.heroPositions || !opts.heroPositions.length) return candidates;
  const want = new Set(opts.heroPositions);
  const out = candidates.filter((p) => want.has(p) || want.has(T.POSITION_GROUP[p]));
  return out.length ? out : candidates;
}

// ---------- hero hand z biasem na trudne (bliskie granicy) decyzje ----------

const ALL_COMBOS = R.ALL_TYPES.flatMap((t) => t.combos);

function chooseHeroCombo(referencePct, difficulty, dead, rng) {
  const deadSet = new Set(dead);
  const legal = ALL_COMBOS.filter((c) => !deadSet.has(c[0]) && !deadSet.has(c[1]));
  const width = difficulty === 'easy' ? null : difficulty === 'hard' ? 6 : 12;
  const biasProb = difficulty === 'easy' ? 0 : difficulty === 'hard' ? 0.9 : 0.6;
  if (width && referencePct != null && rng() < biasProb) {
    const near = legal.filter((c) => Math.abs(strengthPctOf(R.labelOfCombo(c)) - referencePct) <= width);
    if (near.length) return near[Math.floor(rng() * near.length)];
  }
  return legal[Math.floor(rng() * legal.length)];
}

// ---------- typy spotów ----------

function rangeSpec(basis, params) {
  return { basis, ...params };
}

// Liczy zasięgi przeciwników z parametrów (używane też przy "co jeśli").
function computeRanges(spot) {
  for (const o of spot.opponents) {
    const s = spot.seats[o.idx];
    const hero = spot.seats[spot.heroIdx];
    const eff = Math.min(s.stack, hero.stack);
    const t = o.oppType || 'reg';
    const ot = T.OPPONENT_TYPES[t] || T.OPPONENT_TYPES.reg;
    const sp = o.spec;
    let hold = ALL_LABELS;
    let call = null;
    if (sp.basis === 'shover') {
      hold = topLabels(T.shovePercent(sp.group, s.stack, t));
    } else if (sp.basis === 'opener') {
      const openPct = T.clampPct(T.openPercent(s.pos, s.stack, spot.numPlayers) * ot.open);
      hold = topLabels(openPct, 'playability');
      const callPct = T.clampPct(openPct * T.callVs3betFraction(eff) * (ot.call ** 0.5) * T.stageCallFactor(spot.stage, spot.format));
      call = topLabels(callPct);
      o.openPct = openPct;
    } else if (sp.basis === 'flat') {
      const lo = new Set(topLabels(4));
      hold = topLabels(T.clampPct(22 * ot.open), 'playability').filter((l) => !lo.has(l));
      const strong = new Set(topLabels(T.clampPct(7 * ot.call * T.stageCallFactor(spot.stage, spot.format))));
      call = hold.filter((l) => strong.has(l));
    } else if (sp.basis === 'toAct') {
      call = topLabels(T.callVsShovePercent(sp.vsGroup, eff, t, spot.stage, spot.format) * sp.factor);
    } else if (sp.basis === 'caller') {
      const shover = spot.seats[sp.shoverIdx];
      hold = topLabels(T.callVsShovePercent(sp.vsGroup, Math.min(s.stack, shover.stack), t, spot.stage, spot.format) * sp.factor);
    }
    o.holdLabels = hold;
    o.callLabels = call;
    o.holdPct = R.rangePercent(hold);
    o.callPct = call ? R.rangePercent(call) : null;
  }
}

function finalizeOpp(spot, idx, role, status, spec, oppType) {
  const s = spot.seats[idx];
  s.role = role;
  s.status = status;
  s.oppType = oppType;
  spot.opponents.push({ idx, status, spec, oppType });
}

function baseSpot(type, opts, rng) {
  const st = opts.structure ? { ...opts.structure } : buildStructure(opts, rng);
  const seats = buildSeats(st.numPlayers, opts, rng);
  if (opts.otherStacks) seats.forEach((s, i) => (s.stack = opts.otherStacks[i] ?? s.stack));
  for (const stack of opts.offTableStacks || []) {
    seats.push({ seat: seats.length, pos: 'OFF', posLabel: 'inny stół', stack, posted: 0, role: 'offtable', status: 'offtable', offtable: true });
  }
  const spot = {
    v: 2,
    type,
    ...st,
    anteMode: opts.anteMode || 'bb_ante',
    mode: opts.mode || 'gto',
    difficulty: opts.difficulty || 'normal',
    seats,
    opponents: [],
    buttonIdx: seats.findIndex((s) => s.pos === 'BTN' || (st.numPlayers === 2 && s.pos === 'SB')),
    bbIdx: seats.findIndex((s) => s.pos === 'BB'),
    bounties: null,
  };
  if (st.format === 'pko' && st.valueMode === 'icm') {
    const base = st.poolTotal / (st.numPlayers * 2.5);
    spot.bounties = seats.map(() => Math.round(base * (0.5 + rng() * 2.5)));
    seats.forEach((s, i) => (s.bounty = spot.bounties[i]));
  }
  return spot;
}

function gen_open_shove(opts, rng) {
  const spot = baseSpot('open_shove', opts, rng);
  const { seats, numPlayers } = spot;
  const cands = filterPositions(seats.filter((s) => s.pos !== 'BB').map((s) => s.pos), opts);
  const heroPos = pick(cands, rng);
  const heroIdx = seats.findIndex((s) => s.pos === heroPos);
  spot.heroIdx = heroIdx;
  seats[heroIdx].stack = heroStackFrom(opts, [3, 25], rng);
  seats[heroIdx].role = 'hero';
  seats[heroIdx].status = 'hero';
  const heroGroup = T.groupOf(heroPos, numPlayers);
  const oppType = chooseOppType(opts, rng);
  for (let i = heroIdx + 1; i < numPlayers; i++) {
    const factor = seats[i].pos === 'BB' ? 1 : seats[i].pos === 'SB' ? 0.85 : 0.7;
    finalizeOpp(spot, i, i === spot.bbIdx ? 'villain' : 'behind', 'toAct', rangeSpec('toAct', { vsGroup: heroGroup, factor }), i === spot.bbIdx ? oppType : 'reg');
  }
  spot.walkTo = spot.bbIdx;
  spot.mainVillainIdx = spot.bbIdx;
  spot.referencePct = T.shovePercent(heroGroup, seats[heroIdx].stack);
  return spot;
}

function gen_facing_shove(opts, rng) {
  const spot = baseSpot('facing_shove', opts, rng);
  const { seats, numPlayers } = spot;
  const heroCands = filterPositions(['BB', ...(numPlayers > 2 ? ['SB'] : [])], opts);
  const heroPos = weightedPick(heroCands, heroCands.map((p) => (p === 'BB' ? 4 : 1)), rng);
  const heroIdx = seats.findIndex((s) => s.pos === heroPos);
  const shoverIdx = randInt(0, heroIdx - 1, rng);
  spot.heroIdx = heroIdx;
  seats[heroIdx].stack = heroStackFrom(opts, [3, 45], rng);
  seats[heroIdx].role = 'hero';
  seats[heroIdx].status = 'hero';
  seats[shoverIdx].stack = randInt(3, 25, rng);
  const shoverGroup = T.groupOf(seats[shoverIdx].pos, numPlayers);
  const oppType = chooseOppType(opts, rng);
  finalizeOpp(spot, shoverIdx, 'villain', 'allin', rangeSpec('shover', { group: shoverGroup }), oppType);
  for (let i = heroIdx + 1; i < numPlayers; i++) {
    finalizeOpp(spot, i, 'behind', 'toAct', rangeSpec('toAct', { vsGroup: shoverGroup, factor: 0.55 }), 'reg');
  }
  spot.walkTo = shoverIdx;
  spot.mainVillainIdx = shoverIdx;
  const eff = Math.min(seats[heroIdx].stack, seats[shoverIdx].stack);
  spot.referencePct = T.callVsShovePercent(shoverGroup, eff, 'reg', spot.stage, spot.format);
  return spot;
}

function gen_threebet(type, opts, rng) {
  const spot = baseSpot(type, { ...opts, minPlayers: type === 'resteal' ? 2 : 4 }, rng);
  const { seats, numPlayers } = spot;
  let openerIdx;
  let heroIdx;
  if (type === 'resteal') {
    const heroPos = pick(filterPositions(numPlayers === 2 ? ['BB'] : ['SB', 'BB'], opts), rng);
    heroIdx = seats.findIndex((s) => s.pos === heroPos);
    const openerCands = seats
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => i < heroIdx && ['CO', 'BTN', 'SB'].includes(s.pos));
    if (!openerCands.length) return gen_threebet('threebet_shove', opts, rng);
    openerIdx = pick(openerCands, rng).i;
  } else {
    const heroCands = seats
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => i >= 1 && !['SB', 'BB'].includes(s.pos));
    const filtered = filterPositions(heroCands.map((h) => h.s.pos), opts);
    const heroPos = pick(filtered, rng);
    heroIdx = seats.findIndex((s) => s.pos === heroPos);
    openerIdx = randInt(0, heroIdx - 1, rng);
  }
  spot.heroIdx = heroIdx;
  seats[heroIdx].stack = heroStackFrom(opts, [9, 25], rng);
  seats[heroIdx].role = 'hero';
  seats[heroIdx].status = 'hero';
  seats[openerIdx].stack = randInt(14, 60, rng);
  seats[openerIdx].posted = Math.max(seats[openerIdx].posted, 2.2) + (spot.anteMode === 'classic' ? 0.125 : 0);
  const oppType = chooseOppType(opts, rng);
  finalizeOpp(spot, openerIdx, 'villain', 'opened', rangeSpec('opener', {}), oppType);
  const heroGroup = T.groupOf(seats[heroIdx].pos, numPlayers);
  for (let i = heroIdx + 1; i < numPlayers; i++) {
    finalizeOpp(spot, i, 'behind', 'toAct', rangeSpec('toAct', { vsGroup: heroGroup === 'BB' ? 'SB' : heroGroup, factor: 0.5 }), 'reg');
  }
  spot.walkTo = openerIdx;
  spot.mainVillainIdx = openerIdx;
  computeRanges(spot);
  const opener = spot.opponents.find((o) => o.idx === openerIdx);
  spot.referencePct = Math.min(45, opener.openPct * 0.75);
  return spot;
}

function gen_squeeze(opts, rng) {
  const spot = baseSpot('squeeze', { ...opts, minPlayers: 5 }, rng);
  const { seats, numPlayers } = spot;
  const heroPos = pick(filterPositions(['BTN', 'SB', 'BB'].filter((p) => seats.some((s) => s.pos === p)), opts), rng);
  const heroIdx = seats.findIndex((s) => s.pos === heroPos);
  const openerIdx = randInt(0, Math.max(0, heroIdx - 2), rng);
  const callerIdx = randInt(openerIdx + 1, heroIdx - 1, rng);
  spot.heroIdx = heroIdx;
  seats[heroIdx].stack = heroStackFrom(opts, [12, 30], rng);
  seats[heroIdx].role = 'hero';
  seats[heroIdx].status = 'hero';
  for (const i of [openerIdx, callerIdx]) {
    seats[i].stack = randInt(18, 60, rng);
    seats[i].posted = Math.max(seats[i].posted, 2.2) + (spot.anteMode === 'classic' ? 0.125 : 0);
  }
  const oppType = chooseOppType(opts, rng);
  finalizeOpp(spot, openerIdx, 'villain', 'opened', rangeSpec('opener', {}), oppType);
  finalizeOpp(spot, callerIdx, 'caller', 'opened', rangeSpec('flat', {}), oppType);
  for (let i = heroIdx + 1; i < numPlayers; i++) {
    finalizeOpp(spot, i, 'behind', 'toAct', rangeSpec('toAct', { vsGroup: 'CO', factor: 0.45 }), 'reg');
  }
  spot.walkTo = openerIdx;
  spot.mainVillainIdx = openerIdx;
  spot.referencePct = 14;
  return spot;
}

function gen_three_way(opts, rng) {
  const spot = baseSpot('three_way', { ...opts, minPlayers: 4 }, rng);
  const { seats, numPlayers } = spot;
  const heroIdx = spot.bbIdx;
  const shoverIdx = randInt(0, heroIdx - 2, rng);
  const callerIdx = randInt(shoverIdx + 1, heroIdx - 1, rng);
  spot.heroIdx = heroIdx;
  seats[heroIdx].stack = heroStackFrom(opts, [8, 45], rng);
  seats[heroIdx].role = 'hero';
  seats[heroIdx].status = 'hero';
  seats[shoverIdx].stack = randInt(4, 20, rng);
  seats[callerIdx].stack = randInt(10, 50, rng);
  const shoverGroup = T.groupOf(seats[shoverIdx].pos, numPlayers);
  const oppType = chooseOppType(opts, rng);
  finalizeOpp(spot, shoverIdx, 'villain', 'allin', rangeSpec('shover', { group: shoverGroup }), oppType);
  finalizeOpp(spot, callerIdx, 'caller', 'called', rangeSpec('caller', { vsGroup: shoverGroup, shoverIdx, factor: 0.8 }), 'reg');
  spot.walkTo = shoverIdx;
  spot.mainVillainIdx = shoverIdx;
  spot.referencePct = 8;
  return spot;
}

function gen_rfi(opts, rng) {
  const spot = baseSpot('rfi', { ...opts, stage: 'early', format: 'mtt' }, rng);
  const { seats } = spot;
  const cands = filterPositions(seats.filter((s) => s.pos !== 'BB').map((s) => s.pos), opts);
  const heroPos = pick(cands, rng);
  const heroIdx = seats.findIndex((s) => s.pos === heroPos);
  spot.heroIdx = heroIdx;
  seats.forEach((s) => (s.stack = randInt(35, 120, rng)));
  seats[heroIdx].stack = heroStackFrom({ stackRange: opts.rfiStackRange }, [40, 100], rng);
  seats[heroIdx].role = 'hero';
  seats[heroIdx].status = 'hero';
  for (let i = heroIdx + 1; i < seats.length; i++) seats[i].status = 'toAct';
  spot.openPct = T.openPercent(heroPos, seats[heroIdx].stack, spot.numPlayers);
  spot.openLabels = topLabels(spot.openPct, 'playability');
  spot.referencePct = spot.openPct;
  spot.walkTo = spot.bbIdx;
  return spot;
}

const GENERATORS = {
  open_shove: gen_open_shove,
  facing_shove: gen_facing_shove,
  threebet_shove: (o, r) => gen_threebet('threebet_shove', o, r),
  resteal: (o, r) => gen_threebet('resteal', o, r),
  squeeze: gen_squeeze,
  three_way: gen_three_way,
  rfi: gen_rfi,
};

function chooseHeroComboForRfi(spot, rng) {
  const all = ALL_COMBOS;
  const width = spot.difficulty === 'easy' ? null : spot.difficulty === 'hard' ? 5 : 10;
  const bias = spot.difficulty === 'easy' ? 0 : spot.difficulty === 'hard' ? 0.9 : 0.6;
  if (width && rng() < bias) {
    const near = all.filter((c) => Math.abs(playabilityPctOf(R.labelOfCombo(c)) - spot.openPct) <= width);
    if (near.length) return near[Math.floor(rng() * near.length)];
  }
  return all[Math.floor(rng() * all.length)];
}

function generateSpot(opts = {}) {
  const seed = opts.seed ?? randomSeed();
  const rng = seededRng(seed);
  const types = opts.types && opts.types.length ? opts.types : ['open_shove', 'facing_shove', 'threebet_shove', 'resteal', 'squeeze', 'three_way'];
  const typeWeights = types.map((t) => ({ open_shove: 4, facing_shove: 4, threebet_shove: 2, resteal: 2, squeeze: 1, three_way: 1, rfi: 2 })[t] || 1);
  const type = opts.type || weightedPick(types, typeWeights, rng);
  const spot = GENERATORS[type](opts, rng);
  spot.seed = seed;
  spot.id = crypto.randomUUID();
  computeRanges(spot);

  spot.heroCombo = opts.heroCombo || (type === 'rfi' ? chooseHeroComboForRfi(spot, rng) : chooseHeroCombo(spot.referencePct, spot.difficulty, [], rng));
  spot.heroLabel = R.labelOfCombo(spot.heroCombo);
  spot.actions = SPOT_TYPES[type].actions;
  spot.prompt = promptFor(spot);
  return spot;
}

// ---------- opis i widok publiczny ----------

function fmtBB(x) {
  return `${round1(x)}bb`;
}

function promptFor(spot) {
  const hero = spot.seats[spot.heroIdx];
  const v = spot.mainVillainIdx != null ? spot.seats[spot.mainVillainIdx] : null;
  switch (spot.type) {
    case 'open_shove':
      return `Spasowano do Ciebie na ${hero.posLabel} (${fmtBB(hero.stack)}). All-in czy pas?`;
    case 'facing_shove':
      return `${v.posLabel} (${fmtBB(v.stack)}) idzie all-in. Jesteś na ${hero.posLabel} z ${fmtBB(hero.stack)}. Call czy pas?`;
    case 'threebet_shove':
      return `${v.posLabel} otwiera na 2.2bb. Jesteś na ${hero.posLabel} z ${fmtBB(hero.stack)}. 3-bet all-in czy pas?`;
    case 'resteal':
      return `${v.posLabel} otwiera na 2.2bb (możliwa kradzież). Jesteś na ${hero.posLabel} z ${fmtBB(hero.stack)}. Resteal all-in czy pas?`;
    case 'squeeze': {
      const caller = spot.seats[spot.opponents.find((o) => o.spec.basis === 'flat').idx];
      return `${v.posLabel} otwiera, ${caller.posLabel} sprawdza. Jesteś na ${hero.posLabel} z ${fmtBB(hero.stack)}. Squeeze all-in czy pas?`;
    }
    case 'three_way': {
      const caller = spot.seats[spot.opponents.find((o) => o.status === 'called').idx];
      return `${v.posLabel} (${fmtBB(v.stack)}) all-in, ${caller.posLabel} (${fmtBB(caller.stack)}) sprawdza. Jesteś na BB z ${fmtBB(hero.stack)}. Overcall czy pas?`;
    }
    case 'rfi':
      return `Spasowano do Ciebie na ${hero.posLabel} (${fmtBB(hero.stack)}, głęboko). Otwierasz (raise) czy pas?`;
    default:
      return '';
  }
}

function potBefore(spot) {
  return round1(spot.seats.reduce((a, s) => a + s.posted, 0) + spot.opponents.filter((o) => o.status === 'allin').reduce((a, o) => a + spot.seats[o.idx].stack - spot.seats[o.idx].posted, 0) + spot.opponents.filter((o) => o.status === 'called').reduce((a, o) => a + spot.seats[o.idx].stack - spot.seats[o.idx].posted, 0));
}

function publicView(spot, extra = {}) {
  const icmNow = spot.valueMode === 'icm' && spot.payouts.length ? icmEquity(spot.seats.map((s) => s.stack), spot.payouts) : null;
  const off = spot.seats.filter((s) => s.offtable);
  return {
    offTable: off.length ? { count: off.length, stacks: off.map((s) => round1(s.stack)), icmValues: icmNow ? off.map((s) => Math.round(icmNow[s.seat])) : null } : null,
    id: spot.id,
    type: spot.type,
    typeLabel: SPOT_TYPES[spot.type].label,
    format: spot.format,
    formatLabel: P.FORMAT_LABELS[spot.format],
    stage: spot.stage,
    stageLabel: STAGE_LABELS[spot.stage],
    valueMode: spot.valueMode,
    templateLabel: spot.templateKey ? P.TEMPLATES[spot.templateKey].label : null,
    numPlayers: spot.numPlayers,
    poolTotal: spot.poolTotal,
    payouts: spot.payouts,
    anteMode: spot.anteMode,
    mode: spot.mode,
    seats: spot.seats.filter((s) => !s.offtable).map((s, i) => ({
      seat: s.seat,
      pos: s.pos,
      posLabel: s.posLabel,
      stack: round1(s.stack),
      posted: s.posted,
      role: s.role,
      status: s.status,
      bounty: s.bounty ?? null,
      oppType: spot.mode === 'exploit' && s.oppType ? s.oppType : null,
      oppTypeLabel: spot.mode === 'exploit' && s.oppType ? T.OPPONENT_TYPES[s.oppType].label : null,
      icmValue: icmNow ? Math.round(icmNow[i]) : null,
    })),
    heroIdx: spot.heroIdx,
    buttonIdx: spot.buttonIdx,
    mainVillainIdx: spot.mainVillainIdx ?? null,
    heroCombo: spot.heroCombo,
    heroLabel: spot.heroLabel,
    actions: spot.actions,
    prompt: spot.prompt,
    pot: potBefore(spot),
    ...extra,
  };
}

// ---------- rozstrzyganie ----------

function opponentsForSim(spot) {
  return spot.opponents.map((o) => ({
    idx: o.idx,
    status: o.status,
    combos: R.combosForLabels(o.holdLabels),
    callSet: o.callLabels ? new Set(o.callLabels) : null,
    labelOf: R.labelOfCombo,
  }));
}

function simCtx(spot) {
  return {
    startStacks: spot.seats.map((s) => s.stack),
    posted: spot.seats.map((s) => s.posted),
    heroIdx: spot.heroIdx,
    heroCombo: spot.heroCombo,
    opponents: opponentsForSim(spot),
    walkTo: spot.walkTo,
    payouts: spot.payouts,
    valueMode: spot.valueMode,
    bounties: spot.bounties,
    board: [],
  };
}

function closeThreshold(spot) {
  return spot.valueMode === 'chips' ? 0.15 : Math.max(0.0025 * spot.poolTotal, 1);
}

// Próg equity potrzebny do calla vs shove: w ICM i w chip EV (dla porównania).
function icmBreakEven(spot) {
  if (spot.type !== 'facing_shove') return null;
  const vIdx = spot.mainVillainIdx;
  const h = spot.heroIdx;
  const stacks = spot.seats.map((s) => s.stack);
  const posted = spot.seats.map((s) => s.posted);
  const eff = Math.min(stacks[h], stacks[vIdx]);
  const dead = posted.reduce((a, b, i) => (i === h || i === vIdx ? a : a + b), 0);
  const value = (st) => (spot.valueMode === 'chips' ? st[h] : icmEquity(st, spot.payouts, stacks)[h]);
  const others = (st) => spot.seats.forEach((s, i) => { if (i !== h && i !== vIdx) st[i] -= s.posted; });
  const win = stacks.slice();
  const lose = stacks.slice();
  const fold = stacks.slice();
  others(win);
  others(lose);
  others(fold);
  win[h] += eff + dead;
  win[vIdx] -= eff;
  lose[h] -= eff;
  lose[vIdx] += eff + dead;
  fold[h] -= posted[h];
  fold[vIdx] += dead + posted[h];
  const evWin = value(win);
  const evLose = value(lose);
  const evFold = value(fold);
  const be = evWin === evLose ? null : (evFold - evLose) / (evWin - evLose);
  const chipBe = (eff - posted[h]) / (2 * eff + dead);
  return { evWin, evLose, evFold, breakEven: be, chipBreakEven: chipBe, eff, dead };
}

function resolveSpot(spot, action, opts = {}) {
  if (spot.type === 'rfi') return resolveRfi(spot, action);
  const trials = opts.trials || 2500;
  const ctx = simCtx(spot);
  const aggressive = spot.actions[0];
  const rngA = seededRng(spot.seed + 1);
  const rngF = seededRng(spot.seed + 2);
  const aggr = simulateAction(ctx, aggressive, trials, rngA);
  const fold = simulateAction(ctx, 'fold', Math.round(trials / 2), rngF);
  const evs = { [aggressive]: aggr.ev, fold: fold.ev };
  const delta = aggr.ev - fold.ev;
  const close = Math.abs(delta) < closeThreshold(spot);
  const optimal = delta > 0 ? aggressive : 'fold';
  const chosen = action || 'fold';
  const correct = chosen === optimal || close;
  const evLoss = chosen === optimal ? 0 : Math.abs(delta);

  const main = spot.opponents.find((o) => o.idx === spot.mainVillainIdx);
  const vsCombos = R.combosForLabels(main.callLabels || main.holdLabels);
  const equityVsMain = vsCombos.length ? equityVsRange(spot.heroCombo, vsCombos, [], 1500, seededRng(spot.seed + 3)) : null;
  const be = icmBreakEven(spot);

  const result = {
    evs,
    optimal,
    chosen,
    correct,
    close,
    evLoss,
    evDelta: delta,
    callFreq: aggr.callFreq,
    winWhenCalled: aggr.winWhenCalled,
    survival: aggr.survival,
    bountyEv: aggr.bountyEv,
    equityVsMain,
    breakEven: be,
    unit: spot.valueMode === 'chips' ? 'bb' : '$',
    ranges: spot.opponents.map((o) => ({
      idx: o.idx,
      pos: spot.seats[o.idx].posLabel,
      role: spot.seats[o.idx].role,
      status: o.status,
      holdLabels: o.status === 'toAct' ? null : o.holdLabels,
      holdPct: o.status === 'toAct' ? null : o.holdPct,
      callLabels: o.callLabels,
      callPct: o.callPct,
    })),
  };
  result.explanation = explain(spot, result);
  return result;
}

function resolveRfi(spot, action) {
  const pct = playabilityPctOf(spot.heroLabel);
  const inRange = spot.openLabels.includes(spot.heroLabel);
  const close = Math.abs(pct - spot.openPct) <= 2.5;
  const optimal = inRange ? 'raise' : 'fold';
  const chosen = action || 'fold';
  const correct = chosen === optimal || close;
  const result = {
    evs: null,
    optimal,
    chosen,
    correct,
    close,
    evLoss: correct ? 0 : Math.round(Math.abs(pct - spot.openPct) * 10) / 100,
    evDelta: null,
    unit: 'bb',
    ranges: [{ idx: spot.heroIdx, pos: spot.seats[spot.heroIdx].posLabel, role: 'hero', status: 'open', holdLabels: spot.openLabels, holdPct: R.rangePercent(spot.openLabels), callLabels: null, callPct: null }],
    handPercentile: Math.round(pct * 10) / 10,
    openPct: spot.openPct,
  };
  result.explanation = [
    `Z ${spot.seats[spot.heroIdx].posLabel} przy głębokim stosie otwierasz ok. ${spot.openPct}% rąk.`,
    `${spot.heroLabel} jest w okolicy top ${result.handPercentile}% wg grywalności — ${inRange ? 'mieści się w zasięgu otwarcia' : 'jest poza zasięgiem otwarcia'}.`,
    close ? 'To ręka graniczna — oba wybory są akceptowalne, zależnie od stołu (agresywni gracze za Tobą = pas, pasywni = raise).' : null,
  ].filter(Boolean);
  return result;
}

function pctStr(x) {
  return `${Math.round(x * 1000) / 10}%`;
}

function money(spot, v) {
  return spot.valueMode === 'chips' ? `${round1(v)}bb` : `$${Math.round(v)}`;
}

function explain(spot, r) {
  const lines = [];
  const hero = spot.seats[spot.heroIdx];
  const aggr = spot.actions[0];
  const aggrWord = { shove: 'all-in', call: 'call' }[aggr];
  const better = r.optimal === 'fold' ? 'pas' : aggrWord;
  lines.push(
    `${r.close ? 'Spot graniczny — różnica EV jest w granicach błędu modelu, obie decyzje są OK.' : `Lepsza decyzja: ${better}.`} EV(${aggrWord}) = ${money(spot, r.evs[aggr])}, EV(pas) = ${money(spot, r.evs.fold)}.`
  );
  if (r.callFreq != null && ['open_shove', 'threebet_shove', 'resteal', 'squeeze'].includes(spot.type)) {
    lines.push(`Fold equity: przeciwnicy dają call w ok. ${pctStr(r.callFreq)} przypadków — w ${pctStr(1 - r.callFreq)} zgarniasz pulę bez walki.`);
  }
  if (r.equityVsMain != null) {
    const main = spot.seats[spot.mainVillainIdx];
    const what = spot.type === 'facing_shove' || spot.type === 'three_way' ? 'zasięgu shove' : 'zasięgu calla';
    lines.push(`Twoja ręka ${spot.heroLabel} ma ok. ${pctStr(r.equityVsMain)} equity przeciwko ${what} gracza ${main.posLabel}.`);
  }
  if (r.breakEven && r.breakEven.breakEven != null && spot.valueMode === 'icm' && (spot.type === 'facing_shove')) {
    lines.push(
      `ICM: żeby call był opłacalny, potrzebujesz ok. ${pctStr(r.breakEven.breakEven)} equity (w chip EV wystarczyłoby ${pctStr(r.breakEven.chipBreakEven)}). Różnica to „podatek ICM” — przegrana kosztuje więcej, niż daje wygrana.`
    );
  } else if (r.breakEven && spot.type === 'facing_shove') {
    lines.push(`Chip EV: potrzebujesz ok. ${pctStr(r.breakEven.chipBreakEven)} equity, żeby call się opłacał.`);
  }
  if (spot.valueMode === 'icm' && spot.stage === 'bubble') lines.push('Bąbelek: odpadnięcie teraz to zero pieniędzy — krótkie stosy i gracze bez gwarancji wypłaty są pod największą presją.');
  if (spot.format === 'satellite') lines.push('Satelita: wszystkie płatne miejsca są warte tyle samo, więc żetony ponad bezpieczny stos są warte prawie zero — pasuje się bardzo dużo.');
  if (r.bountyEv > 0.5) lines.push(`Bounty: eliminacja przeciwnika dokłada średnio ${money(spot, r.bountyEv)} do EV agresji.`);
  if (spot.mode === 'exploit') {
    const v = spot.seats[spot.mainVillainIdx];
    if (v.oppType && v.oppType !== 'reg') lines.push(`Przeciwnik to ${T.OPPONENT_TYPES[v.oppType].label} — jego zasięgi są przesunięte względem standardu, co zmienia optymalną decyzję.`);
  }
  if (spot.type === 'three_way') lines.push('Przy pasie przeciwnicy grają między sobą — ktoś może odpaść, co podnosi Twoją wartość ICM bez ryzyka.');
  if (spot.type === 'squeeze') lines.push('Sprawdzający ma zwykle zasięg „ograniczony” (bez najsilniejszych rąk, które by 3-betował), co zwiększa fold equity squeeze.');
  if (hero.stack <= 8 && aggr === 'shove') lines.push(`Przy ${round1(hero.stack)}bb każdy pas kosztuje Cię blindy i ante — krótki stos musi szukać okazji do all-in, zanim fold equity zniknie.`);
  return lines;
}

// "Co jeśli" (C8): zmiana parametrów i ponowne przeliczenie.
function whatIf(spot, changes) {
  const s = JSON.parse(JSON.stringify(spot));
  if (changes.heroStack != null) s.seats[s.heroIdx].stack = Math.max(1, Number(changes.heroStack));
  if (changes.villainStack != null && s.mainVillainIdx != null) s.seats[s.mainVillainIdx].stack = Math.max(1, Number(changes.villainStack));
  if (changes.heroCombo) {
    s.heroCombo = changes.heroCombo;
    s.heroLabel = R.labelOfCombo(changes.heroCombo);
  }
  if (changes.oppType && s.mainVillainIdx != null) {
    const o = s.opponents.find((x) => x.idx === s.mainVillainIdx);
    o.oppType = changes.oppType;
    s.seats[s.mainVillainIdx].oppType = changes.oppType;
    s.mode = 'exploit';
  }
  if (changes.anteMode) {
    s.anteMode = changes.anteMode;
    s.seats.forEach((seat) => {
      const extra = seat.posted - postingFor(seat.pos, spot.anteMode, s.numPlayers);
      seat.posted = postingFor(seat.pos, changes.anteMode, s.numPlayers) + Math.max(0, extra);
    });
  }
  if (s.type === 'rfi') {
    s.openPct = T.openPercent(s.seats[s.heroIdx].pos, s.seats[s.heroIdx].stack, s.numPlayers);
    s.openLabels = topLabels(s.openPct, 'playability');
  } else {
    computeRanges(s);
  }
  s.prompt = promptFor(s);
  return s;
}

// Własny spot (C9) z ręcznych parametrów.
function customSpot(input) {
  const numPlayers = Math.max(2, Math.min(9, Number(input.numPlayers) || 6));
  const type = SPOT_TYPES[input.type] && ['open_shove', 'facing_shove'].includes(input.type) ? input.type : 'open_shove';
  const positions = T.POSITIONS_BY_COUNT[numPlayers];
  const stacks = (input.stacks || []).map(Number);
  const poolTotal = Number(input.poolTotal) || 1000;
  let payouts = Array.isArray(input.payouts) && input.payouts.length ? input.payouts.map(Number) : null;
  if (!payouts && input.templateKey) payouts = P.payoutsFor(input.templateKey, numPlayers, poolTotal);
  const valueMode = payouts && payouts.length ? 'icm' : 'chips';
  const anteMode = input.anteMode || 'bb_ante';
  const seats = positions.map((pos, i) => ({
    seat: i,
    pos,
    posLabel: T.POSITION_LABELS[pos],
    stack: stacks[i] > 0 ? stacks[i] : 20,
    posted: postingFor(pos, anteMode, numPlayers),
    role: 'folded',
    status: 'folded',
  }));
  const heroIdx = positions.indexOf(input.heroPos);
  if (heroIdx < 0) throw new Error('Wybierz pozycję bohatera.');
  const spot = {
    v: 2,
    id: crypto.randomUUID(),
    seed: randomSeed(),
    type,
    format: valueMode === 'chips' ? 'mtt' : input.format || 'mtt',
    stage: valueMode === 'chips' ? 'early' : numPlayers > (payouts || []).length ? 'bubble' : 'final_table',
    poolTotal,
    numPlayers,
    payouts: payouts || [],
    templateKey: input.templateKey || null,
    valueMode,
    anteMode,
    mode: input.oppType && input.oppType !== 'reg' ? 'exploit' : 'gto',
    difficulty: 'normal',
    seats,
    opponents: [],
    buttonIdx: seats.findIndex((s) => s.pos === 'BTN' || (numPlayers === 2 && s.pos === 'SB')),
    bbIdx: seats.findIndex((s) => s.pos === 'BB'),
    bounties: null,
    heroIdx,
  };
  seats[heroIdx].role = 'hero';
  seats[heroIdx].status = 'hero';
  const oppType = input.oppType || 'reg';
  if (type === 'open_shove') {
    if (positions[heroIdx] === 'BB') throw new Error('Open shove nie może być z BB.');
    const heroGroup = T.groupOf(positions[heroIdx], numPlayers);
    for (let i = heroIdx + 1; i < numPlayers; i++) {
      const factor = seats[i].pos === 'BB' ? 1 : seats[i].pos === 'SB' ? 0.85 : 0.7;
      finalizeOpp(spot, i, i === spot.bbIdx ? 'villain' : 'behind', 'toAct', rangeSpec('toAct', { vsGroup: heroGroup, factor }), i === spot.bbIdx ? oppType : 'reg');
    }
    spot.walkTo = spot.bbIdx;
    spot.mainVillainIdx = spot.bbIdx;
  } else {
    const shoverIdx = positions.indexOf(input.villainPos);
    if (shoverIdx < 0 || shoverIdx >= heroIdx) throw new Error('Shover musi siedzieć przed bohaterem.');
    finalizeOpp(spot, shoverIdx, 'villain', 'allin', rangeSpec('shover', { group: T.groupOf(positions[shoverIdx], numPlayers) }), oppType);
    for (let i = heroIdx + 1; i < numPlayers; i++) {
      finalizeOpp(spot, i, 'behind', 'toAct', rangeSpec('toAct', { vsGroup: T.groupOf(positions[shoverIdx], numPlayers), factor: 0.55 }), 'reg');
    }
    spot.walkTo = shoverIdx;
    spot.mainVillainIdx = shoverIdx;
  }
  computeRanges(spot);
  if (input.villainRange && spot.mainVillainIdx != null) {
    const o = spot.opponents.find((x) => x.idx === spot.mainVillainIdx);
    const labels = R.parseRange(input.villainRange);
    if (labels.length) {
      if (o.status === 'allin') o.holdLabels = labels;
      else o.callLabels = labels;
      o.holdPct = R.rangePercent(o.holdLabels);
      o.callPct = o.callLabels ? R.rangePercent(o.callLabels) : null;
      o.custom = true;
    }
  }
  const cards = String(input.heroCards || '').replace(/\s+/g, '').match(/[2-9TJQKA][shdc]/gi);
  if (!cards || cards.length !== 2) throw new Error('Podaj karty bohatera, np. AhKd.');
  spot.heroCombo = cards.map((c) => c[0].toUpperCase() + c[1].toLowerCase());
  if (spot.heroCombo[0] === spot.heroCombo[1]) throw new Error('Dwie takie same karty.');
  spot.heroLabel = R.labelOfCombo(spot.heroCombo);
  spot.actions = SPOT_TYPES[type].actions;
  spot.prompt = promptFor(spot);
  return spot;
}

module.exports = {
  promptFor,
  SPOT_TYPES,
  STAGE_LABELS,
  generateSpot,
  resolveSpot,
  publicView,
  whatIf,
  customSpot,
  computeRanges,
  strengthPctOf,
  playabilityPctOf,
  fullDeck,
  shuffle,
};
