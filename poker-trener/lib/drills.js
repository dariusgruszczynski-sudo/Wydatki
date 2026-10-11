const crypto = require('crypto');
const { Hand } = require('pokersolver');
const { fullDeck } = require('./deck');
const { seededRng, randomSeed, randInt, pick } = require('./rng');
const T = require('./push-fold-tables');

const HAND_NAMES_PL = {
  'High Card': 'Wysoka karta',
  Pair: 'Para',
  'Two Pair': 'Dwie pary',
  'Three of a Kind': 'Trójka',
  Straight: 'Strit',
  Flush: 'Kolor',
  'Full House': 'Full',
  'Four of a Kind': 'Kareta',
  'Straight Flush': 'Poker',
  'Royal Flush': 'Poker królewski',
};
const CATEGORY_ORDER = Object.keys(HAND_NAMES_PL);

const DRILL_TYPES = {
  hand_compare: { label: 'Który układ jest silniejszy?', level: 1 },
  hand_name: { label: 'Nazwij układ', level: 1 },
  action_order: { label: 'Kolejność akcji', level: 1 },
  board_nuts: { label: 'Nuts na boardzie', level: 2 },
  outs: { label: 'Liczenie outów', level: 2 },
  pot_odds: { label: 'Pot odds: call czy pas?', level: 2 },
};

function draw(rng, n, dead = []) {
  const d = new Set(dead);
  const pool = fullDeck().filter((c) => !d.has(c));
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    out.push(pool[i]);
  }
  return out;
}

function namePl(hand) {
  return HAND_NAMES_PL[hand.name] || hand.name;
}

function descrPl(hand) {
  let d = hand.descr || '';
  for (const [en, pl] of Object.entries(HAND_NAMES_PL).sort((a, b) => b[0].length - a[0].length)) d = d.replace(en, pl);
  return d.replace(/(\S+) High/g, 'do $1').replace(/ over /g, ' na ').replace(/'s/g, '');
}

function compare(a, b) {
  const ha = Hand.solve(a);
  const hb = Hand.solve(b);
  const w = Hand.winners([ha, hb]);
  if (w.length === 2) return 0;
  return w[0] === ha ? 1 : -1;
}

function shuffleOptions(options, rng) {
  const a = options.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Ręce o zadanej kategorii (żeby ćwiczenia nie były zdominowane przez parę/wysoką kartę).
function handOfCategory(category, rng) {
  for (let i = 0; i < 4000; i++) {
    const cards = draw(rng, 5);
    if (Hand.solve(cards).name === category) return cards;
  }
  return draw(rng, 5);
}

function gen_hand_compare(rng) {
  const sameCat = rng() < 0.45;
  const cats = CATEGORY_ORDER.slice(0, 9);
  const c1 = pick(cats.slice(0, 7), rng);
  let a;
  let b;
  for (let i = 0; i < 50; i++) {
    a = handOfCategory(c1, rng);
    const used = new Set(a);
    const c2 = sameCat ? c1 : pick(cats.slice(0, 7).filter((c) => c !== c1), rng);
    b = handOfCategory(c2, rng);
    if (b.some((c) => used.has(c))) continue;
    if (compare(a, b) !== 0) break;
  }
  const res = compare(a, b);
  const ha = Hand.solve(a);
  const hb = Hand.solve(b);
  return {
    prompt: 'Który układ jest silniejszy?',
    data: { handA: a, handB: b },
    options: [
      { key: 'A', label: 'Układ A' },
      { key: 'B', label: 'Układ B' },
    ],
    answer: res > 0 ? 'A' : 'B',
    explanation: [
      `A: ${descrPl(ha)}. B: ${descrPl(hb)}.`,
      ha.name === hb.name ? 'Ta sama kategoria — decydują wyższe karty / kickery.' : `${HAND_NAMES_PL[(res > 0 ? ha : hb).name]} bije ${HAND_NAMES_PL[(res > 0 ? hb : ha).name].toLowerCase()}.`,
    ],
  };
}

function gen_hand_name(rng) {
  const target = pick(CATEGORY_ORDER.slice(0, 9), rng);
  let hole;
  let board;
  for (let i = 0; i < 3000; i++) {
    const cards = draw(rng, 7);
    if (Hand.solve(cards).name === target || i > 2500) {
      hole = cards.slice(0, 2);
      board = cards.slice(2);
      break;
    }
  }
  const hand = Hand.solve([...hole, ...board]);
  const correct = namePl(hand);
  const distractors = shuffleOptions(Object.values(HAND_NAMES_PL).filter((n) => n !== correct && n !== 'Poker królewski'), rng).slice(0, 3);
  const options = shuffleOptions([correct, ...distractors], rng).map((label) => ({ key: label, label }));
  return {
    prompt: 'Jaki najlepszy układ 5 kart masz (Twoje 2 karty + 5 na stole)?',
    data: { hole, board },
    options,
    answer: correct,
    explanation: [`Najlepsza piątka: ${hand.cards.map((c) => c.toString()).join(' ')} — ${descrPl(hand)}.`],
  };
}

function gen_action_order(rng) {
  const n = randInt(3, 9, rng);
  const positions = T.POSITIONS_BY_COUNT[n];
  const street = rng() < 0.4 ? 'preflop' : 'postflop';
  let inHand = positions.slice();
  if (street === 'postflop') {
    const k = randInt(2, Math.min(4, n), rng);
    inHand = shuffleOptions(positions, rng).slice(0, k).sort((a, b) => positions.indexOf(a) - positions.indexOf(b));
  }
  let answer;
  if (street === 'preflop') {
    answer = n === 3 ? 'BTN' : positions[0];
  } else {
    const order = ['SB', 'BB', ...positions.filter((p) => p !== 'SB' && p !== 'BB')];
    answer = order.find((p) => inHand.includes(p));
  }
  const opts = shuffleOptions([...new Set([answer, ...shuffleOptions(inHand, rng)])].slice(0, 4), rng);
  return {
    prompt:
      street === 'preflop'
        ? `Stół ${n}-osobowy. Kto działa pierwszy przed flopem?`
        : `Na flopie zostali: ${inHand.map((p) => T.POSITION_LABELS[p]).join(', ')}. Kto działa pierwszy?`,
    data: { positions, inHand, street },
    options: opts.map((p) => ({ key: p, label: T.POSITION_LABELS[p] })),
    answer,
    explanation: [
      street === 'preflop'
        ? 'Przed flopem akcję zaczyna gracz po lewej od big blinda (UTG), a blindy działają na końcu.'
        : 'Po flopie akcję zaczyna pierwszy gracz w grze po lewej od buttona — blindy działają pierwsze, button ostatni.',
    ],
  };
}

function allCombos(remaining) {
  const out = [];
  for (let i = 0; i < remaining.length; i++) for (let j = i + 1; j < remaining.length; j++) out.push([remaining[i], remaining[j]]);
  return out;
}

function nutsCandidate(rng) {
  const board = draw(rng, 5);
  const remaining = fullDeck().filter((c) => !board.includes(c));
  const scored = allCombos(remaining).map((combo) => ({ combo, hand: Hand.solve([...combo, ...board]) }));
  const bestSet = new Set(Hand.winners(scored.map((s) => s.hand)));
  const nuts = scored.filter((s) => bestSet.has(s.hand));
  if (nuts.length > 40) return null;
  const others = scored.filter((s) => !bestSet.has(s.hand));
  others.sort((a, b) => (Hand.winners([a.hand, b.hand])[0] === a.hand ? -1 : 1));
  const picked = [];
  const usedKeys = new Set();
  const handKey = (h) => h.cards.map((c) => c.value).sort().join('') + h.name;
  for (const s of shuffleOptions(others.slice(0, 120), rng)) {
    const key = handKey(s.hand);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    picked.push(s);
    if (picked.length === 3) break;
  }
  if (picked.length < 3) return null;
  return { board, nuts, picked };
}

function gen_board_nuts(rng) {
  let c = null;
  for (let i = 0; i < 30 && !c; i++) c = nutsCandidate(rng);
  if (!c) return gen_hand_name(rng);
  const { board, nuts, picked } = c;
  const nutPick = pick(nuts, rng);
  const options = shuffleOptions(
    [nutPick, ...picked].map((s) => ({ key: s.combo.join(''), label: s.combo.join(' '), cards: s.combo, descr: descrPl(s.hand) })),
    rng
  );
  return {
    prompt: 'Która ręka jest nuts (najlepsza możliwa) na tym boardzie?',
    data: { board },
    options: options.map(({ key, label, cards }) => ({ key, label, cards })),
    answer: nutPick.combo.join(''),
    reveal: options,
    explanation: [`Nuts: ${nutPick.combo.join(' ')} → ${descrPl(nutPick.hand)}.`, nuts.length > 1 ? `Tę samą najlepszą rękę daje ${nuts.length} kombinacji.` : null].filter(Boolean),
  };
}

function exactEquity(hero, villain, board) {
  const dead = new Set([...hero, ...villain, ...board]);
  const remaining = fullDeck().filter((c) => !dead.has(c));
  const need = 5 - board.length;
  let win = 0;
  let tie = 0;
  let n = 0;
  if (need === 2) {
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const b = [...board, remaining[i], remaining[j]];
        const r = compare([...hero, ...b], [...villain, ...b]);
        if (r > 0) win++;
        else if (r === 0) tie++;
        n++;
      }
    }
  } else {
    for (const c of remaining) {
      const b = [...board, c];
      const r = compare([...hero, ...b], [...villain, ...b]);
      if (r > 0) win++;
      else if (r === 0) tie++;
      n++;
    }
  }
  return (win + tie / 2) / n;
}

function gen_outs(rng) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const cards = draw(rng, 7);
    const hero = cards.slice(0, 2);
    const villain = cards.slice(2, 4);
    const flop = cards.slice(4, 7);
    if (compare([...hero, ...flop], [...villain, ...flop]) >= 0) continue;
    const remaining = fullDeck().filter((c) => !cards.includes(c));
    const outCards = remaining.filter((c) => compare([...hero, ...flop, c], [...villain, ...flop, c]) > 0);
    const outs = outCards.length;
    if (outs < 2 || outs > 17) continue;
    const eq = exactEquity(hero, villain, flop);
    const choices = new Set([outs]);
    for (const d of shuffleOptions([-4, -3, -2, -1, 1, 2, 3, 4, 6], rng)) {
      if (choices.size >= 4) break;
      if (outs + d > 0) choices.add(outs + d);
    }
    const hv = Hand.solve([...villain, ...flop]);
    return {
      prompt: 'Przeciwnik pokazał karty (all-in na flopie). Ile masz outów, żeby wyjść na prowadzenie na turnie?',
      data: { hero, villain, board: flop },
      options: [...choices].sort((a, b) => a - b).map((x) => ({ key: String(x), label: String(x) })),
      answer: String(outs),
      explanation: [
        `Outy (${outs}): ${outCards.join(' ')}.`,
        `Przeciwnik ma teraz: ${descrPl(hv)}.`,
        `Reguła 4: ${outs} × 4 ≈ ${Math.min(100, outs * 4)}% (reguła 4 i 2 z poprawką: ≈ ${Math.round(Math.min(100, outs * 4 - Math.max(0, outs - 8)))}%). Dokładne equity do rivera: ${(eq * 100).toFixed(1)}%.`,
      ],
      extra: { outs, exactEquity: eq },
    };
  }
  return gen_pot_odds(rng);
}

function gen_pot_odds(rng) {
  for (let i = 0; i < 100; i++) {
    const pot = randInt(4, 40, rng) * 1;
    const betFrac = pick([0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5, 2], rng);
    const bet = Math.round(pot * betFrac * 10) / 10;
    const req = bet / (pot + 2 * bet);
    const equity = Math.round((req + (rng() < 0.5 ? -1 : 1) * (0.04 + rng() * 0.15)) * 100) / 100;
    if (equity <= 0.03 || equity >= 0.9) continue;
    const answer = equity > req ? 'call' : 'fold';
    return {
      prompt: `W puli jest ${pot}bb. Przeciwnik stawia ${bet}bb (${Math.round(betFrac * 100)}% puli). Twoje equity to ${Math.round(equity * 100)}%. Call czy pas?`,
      data: { pot, bet, equity },
      options: [
        { key: 'call', label: 'Call' },
        { key: 'fold', label: 'Pas' },
      ],
      answer,
      explanation: [
        `Musisz dopłacić ${bet}bb, żeby wygrać pulę ${Math.round((pot + 2 * bet) * 10) / 10}bb (z Twoją dopłatą).`,
        `Potrzebne equity = ${bet} / ${Math.round((pot + 2 * bet) * 10) / 10} = ${(req * 100).toFixed(1)}%. Masz ${Math.round(equity * 100)}% → ${answer === 'call' ? 'call jest +EV' : 'pas'}.`,
        `Skrót: bet ${Math.round(betFrac * 100)}% puli wymaga ok. ${(req * 100).toFixed(0)}% equity.`,
      ],
    };
  }
  return null;
}

const GEN = { hand_compare: gen_hand_compare, hand_name: gen_hand_name, action_order: gen_action_order, board_nuts: gen_board_nuts, outs: gen_outs, pot_odds: gen_pot_odds };

function generateDrill(type, seed = randomSeed()) {
  const t = DRILL_TYPES[type] ? type : pick(Object.keys(DRILL_TYPES), seededRng(seed));
  const d = GEN[t](seededRng(seed));
  return { id: crypto.randomUUID(), kind: 'drill', type: t, typeLabel: DRILL_TYPES[t].label, seed, ...d };
}

function publicDrill(d) {
  const pub = { ...d };
  for (const k of ['answer', 'explanation', 'reveal', 'extra']) delete pub[k];
  return pub;
}

function resolveDrill(d, choice) {
  return {
    correct: String(choice) === String(d.answer),
    answer: d.answer,
    chosen: choice,
    explanation: d.explanation,
    reveal: d.reveal || null,
    extra: d.extra || null,
  };
}

module.exports = { DRILL_TYPES, HAND_NAMES_PL, generateDrill, publicDrill, resolveDrill, exactEquity };
