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

module.exports = { remainingDeck, compare, equityHeadsUp, equityVsRange };
