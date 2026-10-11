const T = require('./push-fold-tables');

const HAND_START = /^(?:PokerStars (?:Zoom |Home Game )?(?:Hand|Game) #|Poker Hand #|GGPoker Hand #)/m;

function num(s) {
  return s == null ? 0 : Number(String(s).replace(/,/g, ''));
}

function splitHands(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const idx = [];
  const re = new RegExp(HAND_START.source, 'gm');
  let m;
  while ((m = re.exec(src))) idx.push(m.index);
  return idx.map((start, i) => src.slice(start, idx[i + 1] ?? src.length).trim()).filter(Boolean);
}

function assignPositions(players, buttonSeat, sbName) {
  const active = players.filter((p) => !p.sittingOut).sort((a, b) => a.seat - b.seat);
  const n = active.length;
  if (n < 2) return;
  const posList = T.POSITIONS_BY_COUNT[Math.min(n, 9)];
  let startIdx = active.findIndex((p) => p.name === sbName);
  if (startIdx < 0) {
    const afterBtn = active.findIndex((p) => p.seat > buttonSeat);
    startIdx = afterBtn < 0 ? 0 : afterBtn;
    if (n === 2) startIdx = active.findIndex((p) => p.seat === buttonSeat);
    if (startIdx < 0) startIdx = 0;
  }
  const ordered = [];
  for (let k = 0; k < n; k++) ordered.push(active[(startIdx + k) % n]);
  if (n === 2) {
    ordered[0].pos = 'SB';
    ordered[1].pos = 'BB';
    return;
  }
  ordered[0].pos = 'SB';
  ordered[1].pos = 'BB';
  const rest = posList.slice(0, posList.length - 2);
  for (let k = 2; k < n; k++) ordered[k].pos = rest[k - 2] || `S${k}`;
}

function parseHand(raw) {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const header = lines[0];
  const site = /^Poker Hand #|^GGPoker/.test(header) ? 'ggpoker' : 'pokerstars';
  const handNo = (header.match(/(?:Hand|Game) #([A-Z]*\d+)/) || [])[1];
  if (!handNo) throw new Error('Brak numeru rozdania');
  const tournamentId = (header.match(/Tournament #(\d+)/) || [])[1] || null;
  const blinds = header.match(/\((?:[$€£])?([\d,.]+)\/(?:[$€£])?([\d,.]+)(?:\(([\d,.]+)\))?/);
  const sb = blinds ? num(blinds[1]) : 0;
  const bb = blinds ? num(blinds[2]) : 0;
  let ante = blinds && blinds[3] ? num(blinds[3]) : 0;
  const dateM = header.match(/(\d{4}\/\d{2}\/\d{2}) (\d{1,2}:\d{2}:\d{2})/);
  const playedAt = dateM ? `${dateM[1].replace(/\//g, '-')}T${dateM[2].padStart(8, '0')}` : null;
  const tableLine = lines.find((l) => /^Table '/.test(l)) || '';
  const buttonSeat = num((tableLine.match(/Seat #(\d+) is the button/) || [])[1]);
  const maxSeats = num((tableLine.match(/(\d+)-max/) || [])[1]) || null;

  const players = [];
  const byName = new Map();
  let heroName = null;
  let heroCards = null;
  let street = 'setup';
  const board = [];
  const actions = [];
  const invested = new Map();
  const streetPut = new Map();
  const collected = new Map();
  let sbName = null;
  let pot = 0;
  let anteCount = 0;
  let showdown = false;
  let pfRaises = 0;

  const addInvest = (name, amount, countsToStreet = true) => {
    invested.set(name, (invested.get(name) || 0) + amount);
    if (countsToStreet) streetPut.set(name, (streetPut.get(name) || 0) + amount);
    pot += amount;
    const p = byName.get(name);
    if (p) p.stackNow -= amount;
  };

  for (const line of lines.slice(1)) {
    let m;
    if ((m = line.match(/^Seat (\d+): (.+?) \(([$€£]?[\d,.]+) in chips(?:, ([$€£]?[\d,.]+) bounty)?\)(.*)$/))) {
      if (street !== 'setup') continue;
      const p = { seat: num(m[1]), name: m[2], stack: num(m[3].replace(/[$€£]/, '')), bounty: m[4] ? m[4] : null, sittingOut: /sitting out/i.test(m[5] || ''), vpip: false, pfr: false, showed: null };
      p.stackNow = p.stack;
      players.push(p);
      byName.set(p.name, p);
      continue;
    }
    if ((m = line.match(/^(.+?): posts the ante ([\d,.]+)/))) {
      addInvest(m[1], num(m[2]), false);
      anteCount++;
      if (!ante) ante = num(m[2]);
      continue;
    }
    if ((m = line.match(/^(.+?): posts small blind ([\d,.]+)/))) {
      sbName = m[1];
      addInvest(m[1], num(m[2]));
      continue;
    }
    if ((m = line.match(/^(.+?): posts big blind ([\d,.]+)/))) {
      addInvest(m[1], num(m[2]));
      continue;
    }
    if (/^\*\*\* HOLE CARDS \*\*\*/.test(line)) {
      street = 'preflop';
      assignPositions(players, buttonSeat, sbName);
      continue;
    }
    if ((m = line.match(/^\*\*\* (?:FIRST )?FLOP \*\*\* \[(.+?)\]/))) {
      street = 'flop';
      board.push(...m[1].split(' '));
      streetPut.clear();
      actions.push({ street, type: 'board', cards: m[1].split(' '), pot });
      continue;
    }
    if ((m = line.match(/^\*\*\* (?:FIRST )?TURN \*\*\* \[.+?\] \[(.+?)\]/))) {
      street = 'turn';
      board.push(m[1]);
      streetPut.clear();
      actions.push({ street, type: 'board', cards: [m[1]], pot });
      continue;
    }
    if ((m = line.match(/^\*\*\* (?:FIRST )?RIVER \*\*\* \[.+?\] \[(.+?)\]/))) {
      street = 'river';
      board.push(m[1]);
      streetPut.clear();
      actions.push({ street, type: 'board', cards: [m[1]], pot });
      continue;
    }
    if (/^\*\*\* (?:SHOW ?DOWN|FIRST SHOWDOWN) \*\*\*/.test(line)) {
      showdown = true;
      street = 'showdown';
      continue;
    }
    if (/^\*\*\* SUMMARY \*\*\*/.test(line)) {
      street = 'summary';
      continue;
    }
    if (street === 'summary') {
      if ((m = line.match(/^Board \[(.+)\]/)) && !board.length) board.push(...m[1].split(' '));
      continue;
    }
    if ((m = line.match(/^Dealt to (.+?) \[(\S\S) (\S\S)\]/))) {
      heroName = m[1];
      heroCards = [m[2], m[3]];
      continue;
    }
    if ((m = line.match(/^Uncalled bet \(([\d,.]+)\) returned to (.+)$/))) {
      const amt = num(m[1]);
      invested.set(m[2], (invested.get(m[2]) || 0) - amt);
      pot -= amt;
      const p = byName.get(m[2]);
      if (p) p.stackNow += amt;
      actions.push({ street, type: 'return', name: m[2], amount: amt, pot });
      continue;
    }
    if ((m = line.match(/^(.+?) collected ([\d,.]+) from/))) {
      collected.set(m[1], (collected.get(m[1]) || 0) + num(m[2]));
      const p = byName.get(m[1]);
      if (p) p.stackNow += num(m[2]);
      actions.push({ street: 'showdown', type: 'collect', name: m[1], amount: num(m[2]), pot });
      continue;
    }
    if ((m = line.match(/^(.+?): shows \[(\S\S) (\S\S)\]/))) {
      const p = byName.get(m[1]);
      if (p) p.showed = [m[2], m[3]];
      actions.push({ street: 'showdown', type: 'show', name: m[1], cards: [m[2], m[3]], pot });
      continue;
    }
    if ((m = line.match(/^(.+?): (folds|checks|calls|bets|raises)(?: ([\d,.]+))?(?: to ([\d,.]+))?( and is all-in)?/))) {
      const [, name, verb, a1, a2, allin] = m;
      const p = byName.get(name);
      let amount = 0;
      if (verb === 'calls' || verb === 'bets') amount = num(a1);
      if (verb === 'raises') amount = num(a2) - (streetPut.get(name) || 0);
      if (amount > 0) addInvest(name, amount);
      if (street === 'preflop' && p) {
        if (verb === 'calls' || verb === 'raises' || verb === 'bets') p.vpip = true;
        if (verb === 'raises') {
          p.pfr = true;
          if (name === heroName && pfRaises >= 1) p.threeBet = true;
          pfRaises++;
        }
      }
      actions.push({
        street,
        type: 'action',
        name,
        pos: p ? p.pos : null,
        verb,
        amount,
        to: verb === 'raises' ? num(a2) : null,
        allin: !!allin,
        pot,
        stackAfter: p ? p.stackNow : null,
      });
      continue;
    }
  }

  const hero = heroName ? byName.get(heroName) : null;
  const heroNet = hero ? (collected.get(heroName) || 0) - (invested.get(heroName) || 0) : null;
  const anteMode = anteCount === 0 ? 'none' : anteCount === 1 ? 'bb_ante' : 'classic';
  const heroPreActions = actions.filter((a) => a.type === 'action' && a.street === 'preflop' && a.name === heroName);

  return {
    site,
    handNo,
    tournamentId,
    playedAt,
    sb,
    bb,
    ante,
    anteMode,
    maxSeats,
    buttonSeat,
    heroName,
    heroCards,
    heroPos: hero ? hero.pos : null,
    heroStackBB: hero && bb ? Math.round((hero.stack / bb) * 10) / 10 : null,
    board,
    players: players.map((p) => ({ seat: p.seat, name: p.name, pos: p.pos || null, stack: p.stack, stackBB: bb ? Math.round((p.stack / bb) * 10) / 10 : null, vpip: p.vpip, pfr: p.pfr, showed: p.showed, sittingOut: p.sittingOut, bounty: p.bounty })),
    actions,
    resultBB: heroNet != null && bb ? Math.round((heroNet / bb) * 100) / 100 : null,
    showdown,
    heroVpip: !!(hero && hero.vpip),
    heroPfr: !!(hero && hero.pfr),
    hero3bet: !!(hero && hero.threeBet),
    heroAllinPre: heroPreActions.some((a) => a.allin),
  };
}

function parseText(text) {
  const hands = [];
  const errors = [];
  for (const raw of splitHands(text)) {
    try {
      const h = parseHand(raw);
      h.raw = raw;
      hands.push(h);
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { hands, errors };
}

// Wykrywa w ręce spot push/fold (open shove / call vs shove) do porównania z modelem.
function detectPushFoldSpot(h) {
  if (!h.heroName || !h.heroCards || !h.bb) return null;
  const pre = h.actions.filter((a) => a.type === 'action' && a.street === 'preflop');
  const heroI = pre.findIndex((a) => a.name === h.heroName);
  if (heroI < 0) return null;
  const before = pre.slice(0, heroI);
  const heroAct = pre[heroI];
  const active = h.players.filter((p) => !p.sittingOut && p.pos);
  if (active.length < 2 || active.length > 9) return null;
  const hero = active.find((p) => p.name === h.heroName);
  if (!hero || hero.stackBB > 25) return null;
  const nonFold = before.filter((a) => a.verb !== 'folds');
  let type = null;
  let villain = null;
  if (nonFold.length === 0 && hero.pos !== 'BB') {
    if (heroAct.verb === 'folds' || heroAct.allin || (heroAct.verb === 'raises' && heroAct.to >= hero.stack * 0.9)) type = 'open_shove';
  } else if (nonFold.length === 1 && nonFold[0].allin && (nonFold[0].verb === 'raises' || nonFold[0].verb === 'bets')) {
    villain = active.find((p) => p.name === nonFold[0].name);
    if (heroAct.verb === 'folds' || heroAct.verb === 'calls' || heroAct.allin) type = 'facing_shove';
  }
  if (!type) return null;
  const order = T.POSITIONS_BY_COUNT[active.length];
  const stacks = order.map((pos) => {
    const p = active.find((x) => x.pos === pos);
    return p ? p.stackBB : 20;
  });
  const chosen = heroAct.verb === 'folds' ? 'fold' : type === 'open_shove' ? 'shove' : 'call';
  return {
    input: {
      numPlayers: active.length,
      type,
      heroPos: hero.pos,
      villainPos: villain ? villain.pos : undefined,
      stacks,
      heroCards: h.heroCards.join(''),
      anteMode: h.anteMode,
    },
    chosen,
  };
}

module.exports = { splitHands, parseHand, parseText, detectPushFoldSpot };
