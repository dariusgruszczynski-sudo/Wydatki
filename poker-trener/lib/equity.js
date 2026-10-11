const { Hand } = require('pokersolver');
const { fullDeck, shuffle } = require('./deck');

function remainingDeck(dead) {
  const deadSet = new Set(dead);
  return fullDeck().filter((c) => !deadSet.has(c));
}

function compare(cardsA, cardsB) {
  const handA = Hand.solve(cardsA);
  const handB = Hand.solve(cardsB);
  const winners = Hand.winners([handA, handB]);
  if (winners.length === 2) return 0;
  return winners[0] === handA ? 1 : -1;
}

function equityHeadsUp(heroCombo, villainCombo, boardKnown = [], trials = 2000, rng = Math.random) {
  const dead = [...heroCombo, ...villainCombo, ...boardKnown];
  const toDeal = 5 - boardKnown.length;
  const deck = remainingDeck(dead);
  let win = 0;
  let tie = 0;
  for (let t = 0; t < trials; t++) {
    const board = toDeal > 0 ? shuffle(deck, rng).slice(0, toDeal) : boardKnown;
    const fullBoard = toDeal > 0 ? [...boardKnown, ...board] : boardKnown;
    const result = compare([...heroCombo, ...fullBoard], [...villainCombo, ...fullBoard]);
    if (result === 1) win++;
    else if (result === 0) tie++;
  }
  return (win + tie / 2) / trials;
}

function equityVsRange(heroCombo, villainRangeCombos, boardKnown = [], trials = 2500, rng = Math.random) {
  const heroSet = new Set(heroCombo);
  const boardSet = new Set(boardKnown);
  const legalVillainCombos = villainRangeCombos.filter(
    ([a, b]) => !heroSet.has(a) && !heroSet.has(b) && !boardSet.has(a) && !boardSet.has(b)
  );
  if (legalVillainCombos.length === 0) return null;
  let win = 0;
  let tie = 0;
  let n = 0;
  for (let t = 0; t < trials; t++) {
    const villainCombo = legalVillainCombos[Math.floor(rng() * legalVillainCombos.length)];
    const dead = [...heroCombo, ...villainCombo, ...boardKnown];
    const toDeal = 5 - boardKnown.length;
    const deck = remainingDeck(dead);
    if (toDeal > deck.length) continue;
    const dealt = toDeal > 0 ? shuffle(deck, rng).slice(0, toDeal) : [];
    const fullBoard = [...boardKnown, ...dealt];
    const result = compare([...heroCombo, ...fullBoard], [...villainCombo, ...fullBoard]);
    if (result === 1) win++;
    else if (result === 0) tie++;
    n++;
  }
  if (n === 0) return null;
  return (win + tie / 2) / n;
}

function shareWinners(hands, board, acc) {
  const solved = hands.map((h) => Hand.solve([...h, ...board]));
  const winners = Hand.winners(solved);
  const share = 1 / winners.length;
  solved.forEach((s, i) => {
    if (winners.includes(s)) acc[i] += share;
  });
}

// Equity wielu graczy: każdy gracz ma konkretną rękę ({combo}) albo zasięg ({combos}).
function equityMulti(players, board = [], trials = 6000, rng = Math.random) {
  const n = players.length;
  const acc = new Array(n).fill(0);
  const allFixed = players.every((p) => p.combo);
  if (allFixed && board.length >= 3) {
    const dead = new Set([...players.flatMap((p) => p.combo), ...board]);
    const rest = fullDeck().filter((c) => !dead.has(c));
    let count = 0;
    if (board.length === 5) {
      shareWinners(players.map((p) => p.combo), board, acc);
      count = 1;
    } else if (board.length === 4) {
      for (const c of rest) {
        shareWinners(players.map((p) => p.combo), [...board, c], acc);
        count++;
      }
    } else {
      for (let i = 0; i < rest.length; i++) {
        for (let j = i + 1; j < rest.length; j++) {
          shareWinners(players.map((p) => p.combo), [...board, rest[i], rest[j]], acc);
          count++;
        }
      }
    }
    return { equities: acc.map((a) => a / count), exact: true, samples: count };
  }
  let valid = 0;
  for (let t = 0; t < trials; t++) {
    const dead = new Set(board);
    const hands = [];
    let ok = true;
    for (const p of players) {
      let c = p.combo;
      if (!c) {
        for (let k = 0; k < 40; k++) {
          const cand = p.combos[Math.floor(rng() * p.combos.length)];
          if (!dead.has(cand[0]) && !dead.has(cand[1])) {
            c = cand;
            break;
          }
        }
      } else if (dead.has(c[0]) || dead.has(c[1])) c = null;
      if (!c) {
        ok = false;
        break;
      }
      dead.add(c[0]);
      dead.add(c[1]);
      hands.push(c);
    }
    if (!ok) continue;
    const pool = fullDeck().filter((c) => !dead.has(c));
    const need = 5 - board.length;
    const extra = [];
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      extra.push(pool[i]);
    }
    shareWinners(hands, [...board, ...extra], acc);
    valid++;
  }
  if (!valid) throw new Error('Ręce/zasięgi kolidują ze sobą albo z boardem.');
  return { equities: acc.map((a) => a / valid), exact: false, samples: valid };
}

module.exports = { remainingDeck, compare, equityHeadsUp, equityVsRange, equityMulti };
