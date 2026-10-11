// Model ICM Malmutha-Harville'a liczony programowaniem dynamicznym po podzbiorach
// graczy, którzy już zajęli najwyższe miejsca: O(2^n · n) zamiast O(n!).

const MAX_LIVE = 16;

function icmLive(stacks, payouts) {
  const n = stacks.length;
  const ev = new Array(n).fill(0);
  const places = Math.min(payouts.length, n);
  if (n === 0 || places === 0) return ev;
  if (n === 1) {
    ev[0] = payouts[0];
    return ev;
  }
  if (n > MAX_LIVE) throw new Error(`ICM: za dużo graczy (${n} > ${MAX_LIVE})`);

  const total = stacks.reduce((a, b) => a + b, 0);
  const full = (1 << n) - 1;
  const prob = new Float64Array(1 << n);
  const sumMask = new Float64Array(1 << n);
  const popcount = new Uint8Array(1 << n);
  for (let m = 1; m <= full; m++) {
    const low = m & -m;
    const bit = 31 - Math.clz32(low);
    sumMask[m] = sumMask[m ^ low] + stacks[bit];
    popcount[m] = popcount[m ^ low] + 1;
  }
  prob[0] = 1;
  for (let mask = 0; mask <= full; mask++) {
    const p = prob[mask];
    if (p === 0) continue;
    const placed = popcount[mask];
    if (placed >= places) continue;
    const remaining = total - sumMask[mask];
    if (remaining <= 0) continue;
    const pay = payouts[placed];
    for (let j = 0; j < n; j++) {
      if (mask & (1 << j)) continue;
      const pj = (p * stacks[j]) / remaining;
      if (pj === 0) continue;
      ev[j] += pj * pay;
      prob[mask | (1 << j)] += pj;
    }
  }
  return ev;
}

function icmEquity(stacks, payouts, tiebreak) {
  const n = stacks.length;
  const ev = new Array(n).fill(0);
  const live = [];
  const busted = [];
  for (let i = 0; i < n; i++) (stacks[i] > 0 ? live : busted).push(i);

  const liveEv = icmLive(
    live.map((i) => stacks[i]),
    payouts.slice(0, live.length)
  );
  live.forEach((i, k) => (ev[i] = liveEv[k]));

  if (busted.length) {
    const bottom = [];
    for (let place = live.length; place < n; place++) bottom.push(payouts[place] || 0);
    if (tiebreak) {
      busted.sort((a, b) => (tiebreak[b] || 0) - (tiebreak[a] || 0));
      busted.forEach((i, k) => (ev[i] = bottom[k]));
    } else {
      const avg = bottom.reduce((a, b) => a + b, 0) / busted.length;
      busted.forEach((i) => (ev[i] = avg));
    }
  }
  return ev;
}

const cache = new Map();

function icmCached(stacks, payouts, tiebreak) {
  const key = stacks.join(',') + '|' + payouts.join(',') + '|' + (tiebreak ? tiebreak.join(',') : '');
  let v = cache.get(key);
  if (!v) {
    if (cache.size > 20000) cache.clear();
    v = icmEquity(stacks, payouts, tiebreak);
    cache.set(key, v);
  }
  return v;
}

module.exports = { icmEquity: icmCached, icmEquityUncached: icmEquity, MAX_LIVE };
