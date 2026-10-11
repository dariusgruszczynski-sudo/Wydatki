// Uproszczone, orientacyjne tabele % zasięgów. To NIE jest pełny solver GTO/ICM
// (jak ICMIZER/HRC) — edukacyjny model zbudowany na ogólnie znanych zasadach strategii
// turniejowej: krótszy stos i późniejsza pozycja = szerszy zasięg.

const STACK_BUCKETS = [
  { max: 6, label: '≤6bb' },
  { max: 10, label: '7-10bb' },
  { max: 15, label: '11-15bb' },
  { max: 20, label: '16-20bb' },
  { max: 25, label: '21-25bb' },
  { max: 40, label: '26-40bb' },
  { max: Infinity, label: '40bb+' },
];

function bucketIndex(stackBB) {
  for (let i = 0; i < STACK_BUCKETS.length; i++) if (stackBB <= STACK_BUCKETS[i].max) return i;
  return STACK_BUCKETS.length - 1;
}

function pfBucket(stackBB) {
  return Math.min(bucketIndex(stackBB), 4);
}

const POSITIONS_BY_COUNT = {
  2: ['SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['CO', 'BTN', 'SB', 'BB'],
  5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
  6: ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  7: ['MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};

const POSITION_GROUP = {
  UTG: 'EP', UTG1: 'EP', MP: 'MP', LJ: 'MP', HJ: 'MP', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB',
};

const POSITION_LABELS = {
  UTG: 'UTG', UTG1: 'UTG+1', MP: 'MP', LJ: 'LJ', HJ: 'HJ', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB',
};

const GROUP_LABELS = { EP: 'wczesna pozycja', MP: 'środkowa pozycja', CO: 'cutoff', BTN: 'button', SB: 'small blind', BB: 'big blind', HU: 'heads-up' };

function groupOf(position, numPlayers) {
  if (numPlayers === 2 && position === 'SB') return 'HU';
  return POSITION_GROUP[position];
}

// open-shove (pierwszy do akcji), kolumny = kubełki stosu ≤6 / 7-10 / 11-15 / 16-20 / 21-25
const SHOVE = {
  EP: [35, 20, 13, 8, 5],
  MP: [45, 28, 18, 11, 7],
  CO: [60, 38, 25, 16, 10],
  BTN: [72, 48, 33, 22, 14],
  SB: [85, 60, 42, 28, 18],
  HU: [100, 75, 58, 45, 35],
};

// call na BB przeciwko shove z danej grupy pozycji
const CALL_VS_SHOVE = {
  EP: [30, 16, 10, 6, 4],
  MP: [38, 22, 14, 9, 6],
  CO: [50, 30, 19, 12, 8],
  BTN: [58, 36, 24, 15, 10],
  SB: [65, 42, 28, 18, 12],
  HU: [75, 50, 36, 26, 20],
};

// otwarcie (raise first in) przy głębokich stosach, % rąk
const RFI_DEEP = { UTG: 12, UTG1: 14, MP: 17, LJ: 19, HJ: 23, CO: 28, BTN: 43, SB: 38 };

// otwarcie przy 15-40bb (min-raise / steal) — węższe niż deep z wczesnych pozycji
function openPercent(position, stackBB, numPlayers) {
  const base = RFI_DEEP[position] ?? 20;
  if (numPlayers <= 3 && position === 'BTN') return 48;
  if (stackBB >= 40) return base;
  return Math.round(base * (position === 'BTN' || position === 'SB' || position === 'CO' ? 1.05 : 0.9));
}

// jaki ułamek zasięgu otwarcia sprawdza nasz 3-bet shove (wg efektywnego stosu)
function callVs3betFraction(effBB) {
  if (effBB <= 12) return 0.5;
  if (effBB <= 16) return 0.42;
  if (effBB <= 20) return 0.36;
  if (effBB <= 25) return 0.3;
  return 0.25;
}

// flat-call (do squeeze) — jaki % rąk sprawdza otwarcie zamiast pasować
function flatCallPercent(position) {
  return position === 'BB' ? 30 : position === 'SB' ? 10 : position === 'BTN' ? 12 : 8;
}

const OPPONENT_TYPES = {
  nit: { label: 'Nit (bardzo ciasny)', shove: 0.6, call: 0.55, open: 0.7 },
  reg: { label: 'Regular (standard)', shove: 1, call: 1, open: 1 },
  lag: { label: 'LAG (luźno-agresywny)', shove: 1.3, call: 1.3, open: 1.35 },
  maniac: { label: 'Maniak', shove: 1.8, call: 1.8, open: 1.9 },
  fish: { label: 'Rekreacyjny (za dużo calluje)', shove: 0.85, call: 1.7, open: 1.1 },
};

// ICM: przeciwnicy na bąbelku/FT/satelitach sprawdzają ciaśniej
function stageCallFactor(stage, format) {
  if (format === 'satellite') return 0.55;
  if (stage === 'bubble') return 0.75;
  if (stage === 'final_table') return 0.85;
  return 1;
}

function clampPct(p) {
  return Math.max(1, Math.min(100, Math.round(p * 10) / 10));
}

function shovePercent(group, effBB, oppType = 'reg') {
  return clampPct(SHOVE[group][pfBucket(effBB)] * (OPPONENT_TYPES[oppType]?.shove ?? 1));
}

function callVsShovePercent(shoverGroup, effBB, oppType = 'reg', stage, format) {
  return clampPct(
    CALL_VS_SHOVE[shoverGroup][pfBucket(effBB)] * (OPPONENT_TYPES[oppType]?.call ?? 1) * stageCallFactor(stage, format)
  );
}

module.exports = {
  STACK_BUCKETS,
  bucketIndex,
  pfBucket,
  POSITIONS_BY_COUNT,
  POSITION_GROUP,
  POSITION_LABELS,
  GROUP_LABELS,
  groupOf,
  SHOVE,
  CALL_VS_SHOVE,
  RFI_DEEP,
  openPercent,
  callVs3betFraction,
  flatCallPercent,
  OPPONENT_TYPES,
  stageCallFactor,
  clampPct,
  shovePercent,
  callVsShovePercent,
};
