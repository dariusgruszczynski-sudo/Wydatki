const { Hand } = require('pokersolver');
const { fullDeck } = require('./deck');
const { icmEquity } = require('./icm');

const DECK = fullDeck();

function sampleCombo(combos, dead, rng) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const c = combos[Math.floor(rng() * combos.length)];
    if (!dead.has(c[0]) && !dead.has(c[1])) return c;
  }
  const legal = combos.filter((c) => !dead.has(c[0]) && !dead.has(c[1]));
  return legal.length ? legal[Math.floor(rng() * legal.length)] : null;
}

function dealBoard(dead, count, known, rng) {
  if (count <= 0) return known.slice();
  const pool = DECK.filter((c) => !dead.has(c));
  const out = known.slice();
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    out.push(pool[i]);
  }
  return out;
}

function bestOf(indices, hands, board) {
  if (indices.length === 1) return indices;
  const solved = indices.map((i) => Hand.solve([...hands[i], ...board]));
  const winners = Hand.winners(solved);
  return indices.filter((_, k) => winners.includes(solved[k]));
}

// Rozstrzyga rozdanie: kto gra dalej, side poty, wynikowe stosy i kogo wyeliminowano.
function settleHand({ startStacks, commits, continuing, hands, board, walkTo }) {
  const n = startStacks.length;
  const won = new Array(n).fill(0);
  const busterOf = new Array(n).fill(null);
  const totalPot = commits.reduce((a, b) => a + b, 0);

  if (continuing.length === 0) {
    won[walkTo] += totalPot;
  } else if (continuing.length === 1) {
    won[continuing[0]] += totalPot;
  } else {
    const levels = [...new Set(continuing.map((i) => commits[i]))].sort((a, b) => a - b);
    let prev = 0;
    let lastWinners = null;
    for (const level of levels) {
      let layer = 0;
      for (let i = 0; i < n; i++) layer += Math.max(0, Math.min(commits[i], level) - prev);
      const eligible = continuing.filter((i) => commits[i] >= level);
      const winners = eligible.length === 1 ? eligible : bestOf(eligible, hands, board);
      winners.forEach((w) => (won[w] += layer / winners.length));
      for (const i of continuing) {
        if (commits[i] === level && startStacks[i] === commits[i]) busterOf[i] = winners;
      }
      lastWinners = winners;
      prev = level;
    }
    const leftover = totalPot - won.reduce((a, b) => a + b, 0);
    if (leftover > 1e-9 && lastWinners) lastWinners.forEach((w) => (won[w] += leftover / lastWinners.length));
  }

  const finalStacks = startStacks.map((s, i) => Math.max(0, s - commits[i] + won[i]));
  const eliminated = [];
  for (let i = 0; i < n; i++) {
    if (finalStacks[i] <= 1e-9 && startStacks[i] > 0) {
      finalStacks[i] = 0;
      eliminated.push({ idx: i, by: busterOf[i] || [] });
    }
  }
  return { finalStacks, eliminated, won };
}

function heroValue(ctx, settle) {
  const { valueMode, payouts, heroIdx, startStacks, bounties } = ctx;
  let value;
  if (valueMode === 'chips') {
    value = settle.finalStacks[heroIdx];
  } else {
    const rounded = settle.finalStacks.map((s) => Math.round(s * 100) / 100);
    value = icmEquity(rounded, payouts, startStacks)[heroIdx];
  }
  let bountyCash = 0;
  if (bounties && settle.finalStacks[heroIdx] > 0) {
    for (const e of settle.eliminated) {
      if (e.idx === heroIdx || !e.by.includes(heroIdx)) continue;
      bountyCash += (bounties[e.idx] || 0) / 2 / e.by.length;
    }
  }
  return { value: value + bountyCash, bountyCash };
}

// ctx: { startStacks, posted, heroIdx, heroCombo, opponents:[{idx, combos, callSet:Set(label)|null, status}],
//        walkTo, payouts, valueMode:'icm'|'chips', bounties, board:[] }
// status: 'allin' (już all-in), 'called' (sprawdził all-in), 'opened' (otworzył, odpowie na shove), 'toAct' (działa po nas)
function simulateAction(ctx, heroAction, trials, rng) {
  const { startStacks, posted, heroIdx, heroCombo, opponents, walkTo, board = [] } = ctx;
  const n = startStacks.length;
  const heroIn = heroAction !== 'fold';

  const fixedContinuing = opponents.filter((o) => o.status === 'allin' || o.status === 'called');
  const deterministicFold = !heroIn && fixedContinuing.length <= 1;
  const runs = deterministicFold ? 1 : trials;

  let total = 0;
  let bountyTotal = 0;
  let calledCount = 0;
  let heroWinsWhenCalled = 0;
  let survive = 0;
  let valid = 0;

  for (let t = 0; t < runs; t++) {
    const dead = new Set([...heroCombo, ...board]);
    const hands = new Array(n).fill(null);
    hands[heroIdx] = heroCombo;
    let ok = true;
    for (const o of opponents) {
      const c = sampleCombo(o.combos, dead, rng);
      if (!c) { ok = false; break; }
      hands[o.idx] = c;
      dead.add(c[0]);
      dead.add(c[1]);
    }
    if (!ok) continue;

    const continuing = [];
    const commits = posted.slice();
    if (heroIn) {
      continuing.push(heroIdx);
      commits[heroIdx] = startStacks[heroIdx];
    }
    for (const o of opponents) {
      const label = o.labelOf ? o.labelOf(hands[o.idx]) : null;
      const plays = o.status === 'allin' || o.status === 'called'
        ? true
        : heroIn && o.callSet && o.callSet.has(label);
      if (plays) {
        continuing.push(o.idx);
        commits[o.idx] = startStacks[o.idx];
      }
    }

    const needBoard = continuing.length >= 2;
    const fullBoard = needBoard ? dealBoard(dead, 5 - board.length, board, rng) : board;
    const settle = settleHand({ startStacks, commits, continuing, hands, board: fullBoard, walkTo });
    const { value, bountyCash } = heroValue(ctx, settle);

    total += value;
    bountyTotal += bountyCash;
    valid++;
    if (heroIn && continuing.length >= 2) {
      calledCount++;
      if (settle.finalStacks[heroIdx] > startStacks[heroIdx]) heroWinsWhenCalled++;
    }
    if (settle.finalStacks[heroIdx] > 0) survive++;
  }

  if (valid === 0) return null;
  return {
    ev: total / valid,
    bountyEv: bountyTotal / valid,
    callFreq: heroIn ? calledCount / valid : null,
    winWhenCalled: calledCount ? heroWinsWhenCalled / calledCount : null,
    survival: survive / valid,
  };
}

// Jedno realne rozegranie (symulator turnieju): zwraca wynikowe stosy, eliminacje i karty.
function playOnce(ctx, heroAction, rng) {
  const { startStacks, posted, heroIdx, heroCombo, opponents, walkTo, board = [] } = ctx;
  const n = startStacks.length;
  const heroIn = heroAction !== 'fold';
  for (let attempt = 0; attempt < 20; attempt++) {
    const dead = new Set([...heroCombo, ...board]);
    const hands = new Array(n).fill(null);
    hands[heroIdx] = heroCombo;
    let ok = true;
    for (const o of opponents) {
      const c = sampleCombo(o.combos, dead, rng);
      if (!c) { ok = false; break; }
      hands[o.idx] = c;
      dead.add(c[0]);
      dead.add(c[1]);
    }
    if (!ok) continue;
    const continuing = [];
    const commits = posted.slice();
    if (heroIn) {
      continuing.push(heroIdx);
      commits[heroIdx] = startStacks[heroIdx];
    }
    for (const o of opponents) {
      const plays = o.status === 'allin' || o.status === 'called' ? true : heroIn && o.callSet && o.callSet.has(o.labelOf(hands[o.idx]));
      if (plays) {
        continuing.push(o.idx);
        commits[o.idx] = startStacks[o.idx];
      }
    }
    const fullBoard = continuing.length >= 2 ? dealBoard(dead, 5 - board.length, board, rng) : [];
    const settle = settleHand({ startStacks, commits, continuing, hands, board: fullBoard, walkTo });
    const shown = continuing.length >= 2 ? continuing.map((i) => ({ idx: i, cards: hands[i] })) : [];
    return { ...settle, board: fullBoard, shown, continuing };
  }
  return null;
}

module.exports = { simulateAction, settleHand, dealBoard, sampleCombo, playOnce };
