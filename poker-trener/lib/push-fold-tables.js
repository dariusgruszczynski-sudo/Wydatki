// Uproszczone, orientacyjne tabele % zasięgów push/fold i call vs shove.
// To NIE jest pełny solver GTO/ICM (jak ICMIZER/HRC) — to edukacyjny model
// zbudowany na ogólnie znanych zasadach strategii turniejowej (krótszy stos
// i późniejsza pozycja = szerszy zasięg). Służy do ćwiczenia nawyków i matematyki
// ICM, nie do gry o realne pieniądze bez weryfikacji w profesjonalnym narzędziu.

const STACK_BUCKETS = [
  { max: 6, label: '≤6bb' },
  { max: 10, label: '7-10bb' },
  { max: 15, label: '11-15bb' },
  { max: 20, label: '16-20bb' },
  { max: 25, label: '21-25bb' },
];

function bucketIndex(effStackBB) {
  for (let i = 0; i < STACK_BUCKETS.length; i++) {
    if (effStackBB <= STACK_BUCKETS[i].max) return i;
  }
  return STACK_BUCKETS.length - 1;
}

const SHOVE_PERCENT = {
  UTG: [35, 20, 13, 8, 5],
  MP: [45, 28, 18, 11, 7],
  CO: [60, 38, 25, 16, 10],
  SB: [85, 60, 42, 28, 18],
};

const CALL_VS_SHOVE_PERCENT = {
  UTG: [30, 16, 10, 6, 4],
  MP: [38, 22, 14, 9, 6],
  CO: [50, 30, 19, 12, 8],
  SB: [65, 42, 28, 18, 12],
};

const POSITION_LABELS = {
  UTG: 'UTG (early)',
  MP: 'MP (middle)',
  CO: 'CO (cutoff)',
  SB: 'SB (small blind)',
  BB: 'BB (big blind)',
};

function shovePercent(position, effStackBB) {
  const table = SHOVE_PERCENT[position];
  if (!table) throw new Error(`Nieznana pozycja shove: ${position}`);
  return table[bucketIndex(effStackBB)];
}

function callVsShovePercent(shoverPosition, effStackBB) {
  const table = CALL_VS_SHOVE_PERCENT[shoverPosition];
  if (!table) throw new Error(`Nieznana pozycja shovera: ${shoverPosition}`);
  return table[bucketIndex(effStackBB)];
}

module.exports = {
  STACK_BUCKETS,
  bucketIndex,
  SHOVE_PERCENT,
  CALL_VS_SHOVE_PERCENT,
  POSITION_LABELS,
  shovePercent,
  callVsShovePercent,
};
