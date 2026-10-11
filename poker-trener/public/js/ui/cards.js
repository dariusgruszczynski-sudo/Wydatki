const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK = { T: '10' };

export function cardHtml(card, { size = '', deal = false, back = false } = {}) {
  if (back || !card) return `<span class="card back ${size} ${deal ? 'deal' : ''}"></span>`;
  const r = card[0];
  const s = card[1].toLowerCase();
  const red = s === 'h' || s === 'd';
  return `<span class="card ${size} ${s} ${red ? 'red' : ''} ${deal ? 'deal' : ''}" aria-label="${r}${s}"><span class="r">${RANK[r] || r}</span><span class="s">${SUIT[s]}</span></span>`;
}

export function cardsHtml(cards, opts = {}) {
  return `<span class="cards">${(cards || []).map((c) => cardHtml(c, opts)).join('')}</span>`;
}

export function cardsFromString(str) {
  return (String(str || '').match(/[2-9TJQKA][shdc]/gi) || []).map((c) => c[0].toUpperCase() + c[1].toLowerCase());
}

export function suitText(card) {
  return `${card[0]}${SUIT[card[1].toLowerCase()]}`;
}
