// Szablony struktur wypłat (B7) jako % puli dla kolejnych miejsc (od 1.).
const TEMPLATES = {
  mtt_top: {
    label: 'MTT final table (top-heavy)',
    format: 'mtt',
    pct: [27, 18, 13, 10, 8.2, 6.8, 5.8, 5.4, 5],
  },
  mtt_flat: {
    label: 'MTT final table (płaska)',
    format: 'mtt',
    pct: [20, 15, 12.5, 11, 10, 9, 8.5, 7.5, 6.5],
  },
  sng9: { label: 'SNG 9-max (50/30/20)', format: 'sng', pct: [50, 30, 20] },
  sng6: { label: 'SNG 6-max (65/35)', format: 'sng', pct: [65, 35] },
  double_up: { label: 'Double-up (połowa stołu wygrywa)', format: 'satellite', pct: [20, 20, 20, 20, 20] },
  satellite3: { label: 'Satelita — 3 bilety', format: 'satellite', pct: [33.34, 33.33, 33.33] },
  satellite5: { label: 'Satelita — 5 biletów', format: 'satellite', pct: [20, 20, 20, 20, 20] },
  winner_all: { label: 'Zwycięzca bierze wszystko', format: 'wta', pct: [100] },
  pko: {
    label: 'PKO final table (połowa puli w bounty)',
    format: 'pko',
    pct: [27, 18, 13, 10, 8.2, 6.8, 5.8, 5.4, 5],
  },
};

const FORMAT_TEMPLATES = {
  mtt: ['mtt_top', 'mtt_flat'],
  sng: ['sng9', 'sng6'],
  satellite: ['satellite3', 'satellite5', 'double_up'],
  pko: ['pko'],
  wta: ['winner_all'],
};

const FORMAT_LABELS = {
  mtt: 'MTT',
  sng: 'Sit & Go',
  satellite: 'Satelita',
  pko: 'PKO / bounty',
  wta: 'Winner takes all',
};

// Wypłaty dla pozostałych graczy: miejsca 1..playersLeft (wyższe już wypłacone).
function payoutsFor(templateKey, playersLeft, poolTotal) {
  const t = TEMPLATES[templateKey];
  if (!t) throw new Error(`Nieznany szablon wypłat: ${templateKey}`);
  const pct = t.pct.slice(0, playersLeft);
  return pct.map((p) => Math.round((p / 100) * poolTotal));
}

function generatePayoutCurve(paidPlaces, poolTotal, exponent = 1.05) {
  if (paidPlaces <= 0) return [];
  const weights = [];
  for (let i = 1; i <= paidPlaces; i++) weights.push(1 / Math.pow(i, exponent));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.round((w / sum) * poolTotal));
}

// Struktura dla dużego pola (symulator turnieju): płatne ~15% pola, krzywa top-heavy.
function fieldPayouts(field, poolTotal, paidFraction = 0.15) {
  const paid = Math.max(1, Math.round(field * paidFraction));
  return generatePayoutCurve(paid, poolTotal, 1.15);
}

module.exports = { TEMPLATES, FORMAT_TEMPLATES, FORMAT_LABELS, payoutsFor, generatePayoutCurve, fieldPayouts };
