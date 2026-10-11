const { icmEquity } = require('./icm');
const { equityVsRange } = require('./equity');
const { topPercentCombos } = require('./ranges');
const { randomHoleCards } = require('./deck');
const { shovePercent, callVsShovePercent, POSITION_LABELS } = require('./push-fold-tables');

const OPEN_SHOVE_POSITIONS = ['UTG', 'MP', 'CO', 'SB'];
const FACING_SHOVE_POSITIONS = ['UTG', 'MP', 'CO', 'SB'];

function randInt(min, max, rng) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function generatePayoutCurve(paidPlaces, poolTotal, exponent = 1.05) {
  if (paidPlaces <= 0) return [];
  const weights = [];
  for (let i = 1; i <= paidPlaces; i++) weights.push(1 / Math.pow(i, exponent));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.round((w / sum) * poolTotal));
}

function otherStacks(count, rng) {
  const stacks = [];
  for (let i = 0; i < count; i++) stacks.push(randInt(4, 55, rng));
  return stacks;
}

function buildScenario(options = {}, rng = Math.random) {
  const decisionType = options.decisionType || (rng() < 0.5 ? 'open_shove' : 'facing_shove');
  const numPlayers = options.numPlayers || randInt(3, 9, rng);
  const bubbleGap = rng() < 0.45 ? randInt(0, Math.min(3, numPlayers - 1), rng) : 0;
  const paidPlaces = Math.max(1, numPlayers - bubbleGap);
  const poolTotal = options.poolTotal || pick([2000, 5000, 10000, 25000, 50000], rng);
  const payouts = generatePayoutCurve(paidPlaces, poolTotal);

  const heroIdx = 0;
  const villainIdx = 1;
  let heroStackBB;
  let villainStackBB;
  let heroPosition;
  let villainPosition;
  let rangePercent;
  let rangeCombos;

  if (decisionType === 'open_shove') {
    heroPosition = pick(OPEN_SHOVE_POSITIONS, rng);
    villainPosition = 'BB';
    heroStackBB = randInt(3, 25, rng);
    villainStackBB = randInt(4, 45, rng);
    const effStack = Math.min(heroStackBB, villainStackBB);
    rangePercent = callVsShovePercent(heroPosition, effStack);
    rangeCombos = topPercentCombos(rangePercent);
  } else {
    heroPosition = 'BB';
    villainPosition = pick(FACING_SHOVE_POSITIONS, rng);
    villainStackBB = randInt(3, 25, rng);
    heroStackBB = randInt(4, 45, rng);
    const effStack = Math.min(heroStackBB, villainStackBB);
    rangePercent = shovePercent(villainPosition, effStack);
    rangeCombos = topPercentCombos(rangePercent);
  }

  const heroCombo = randomHoleCards([], rng);
  const othersCount = numPlayers - 2;
  const otherStacksBB = otherStacks(othersCount, rng);
  const stacks = [heroStackBB, villainStackBB, ...otherStacksBB];
  const baseline = icmEquity(stacks, payouts);
  const evFold = baseline[heroIdx];
  const effStack = Math.min(heroStackBB, villainStackBB);

  return {
    decisionType,
    numPlayers,
    paidPlaces,
    poolTotal,
    payouts,
    stacks,
    heroIdx,
    villainIdx,
    heroPosition,
    villainPosition,
    heroPositionLabel: POSITION_LABELS[heroPosition],
    villainPositionLabel: POSITION_LABELS[villainPosition],
    heroStackBB,
    villainStackBB,
    effStack,
    heroCombo,
    rangePercent,
    rangeCombos,
    evFold,
  };
}

function resolveDecision(scenario, action, trials = 2500, rng = Math.random) {
  const { stacks, heroIdx, villainIdx, payouts, heroStackBB, villainStackBB, effStack, heroCombo, rangeCombos, decisionType, evFold } = scenario;

  const winBranchStacks = stacks.slice();
  winBranchStacks[heroIdx] = heroStackBB + effStack;
  winBranchStacks[villainIdx] = villainStackBB - effStack;
  const evWin = icmEquity(winBranchStacks, payouts)[heroIdx];

  const loseBranchStacks = stacks.slice();
  loseBranchStacks[heroIdx] = heroStackBB - effStack;
  loseBranchStacks[villainIdx] = villainStackBB + effStack;
  const evLose = icmEquity(loseBranchStacks, payouts)[heroIdx];

  const winProb = equityVsRange(heroCombo, rangeCombos, [], trials, rng) ?? 0.5;

  let evShoveOrCall;
  if (decisionType === 'open_shove') {
    const callFreq = scenario.rangePercent / 100;
    const foldBranchStacks = stacks.slice();
    const potWon = 1.5;
    foldBranchStacks[heroIdx] = heroStackBB + potWon;
    const evVillainFolds = icmEquity(foldBranchStacks, payouts)[heroIdx];
    const evIfCalled = winProb * evWin + (1 - winProb) * evLose;
    evShoveOrCall = (1 - callFreq) * evVillainFolds + callFreq * evIfCalled;
  } else {
    evShoveOrCall = winProb * evWin + (1 - winProb) * evLose;
  }

  const optimalAction = evShoveOrCall > evFold ? (decisionType === 'open_shove' ? 'shove' : 'call') : 'fold';
  const evDelta = evShoveOrCall - evFold;
  const chosenEv = action === 'fold' ? evFold : evShoveOrCall;
  const correct = action === optimalAction;
  const evLostByChoice = (action === optimalAction ? 0 : Math.abs(evDelta));

  return {
    winProb,
    evFold,
    evAggressive: evShoveOrCall,
    optimalAction,
    chosenAction: action,
    correct,
    evDelta,
    evLostByChoice,
  };
}

module.exports = { buildScenario, resolveDecision, generatePayoutCurve };
