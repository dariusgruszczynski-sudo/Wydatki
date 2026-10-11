function icmEquityRaw(stacks, payouts) {
  const n = stacks.length;
  if (n === 0) return [];
  const total = stacks.reduce((s, v) => s + v, 0);
  if (payouts.length === 0 || total === 0) return new Array(n).fill(0);
  if (n === 1) return [payouts[0]];

  const result = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (stacks[i] <= 0) continue;
    const pFirst = stacks[i] / total;
    result[i] += pFirst * payouts[0];
    if (payouts.length > 1 && n > 1) {
      const subStacks = stacks.filter((_, idx) => idx !== i);
      const subResult = icmEquityRaw(subStacks, payouts.slice(1));
      let k = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        result[j] += pFirst * subResult[k];
        k++;
      }
    }
  }
  return result;
}

const memoCache = new Map();

function icmEquity(stacks, payouts) {
  const key = stacks.join(',') + '|' + payouts.join(',');
  if (memoCache.has(key)) return memoCache.get(key);
  const result = icmEquityRaw(stacks, payouts);
  if (memoCache.size > 50000) memoCache.clear();
  memoCache.set(key, result);
  return result;
}

function payoutsForPlaces(payoutStructure, playersLeft) {
  return payoutStructure.slice(0, playersLeft);
}

module.exports = { icmEquity, payoutsForPlaces };
