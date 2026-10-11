const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];

function fullDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

function rankIndex(r) {
  return RANKS.indexOf(r);
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawRandom(excluding, count, rng = Math.random) {
  const excludeSet = new Set(excluding);
  const remaining = fullDeck().filter((c) => !excludeSet.has(c));
  return shuffle(remaining, rng).slice(0, count);
}

function randomHoleCards(excluding, rng = Math.random) {
  return drawRandom(excluding, 2, rng);
}

module.exports = { RANKS, SUITS, fullDeck, rankIndex, shuffle, drawRandom, randomHoleCards };
