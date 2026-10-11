import { esc, fmt, money } from './dom.js';
import { cardHtml } from './cards.js';
import { sound } from './fx.js';

function seatXY(k, n) {
  const theta = Math.PI / 2 + (k * 2 * Math.PI) / n;
  return { x: 50 + 44 * Math.cos(theta), y: 50 + 42 * Math.sin(theta) };
}

function toward(p, f) {
  return { x: p.x + (50 - p.x) * f, y: p.y + (50 - p.y) * f };
}

function statusTag(s, spot) {
  if (s.status === 'allin') return '<span class="tag allin">ALL-IN</span>';
  if (s.status === 'opened') return `<span class="tag raise">RAISE ${fmt(s.posted, 1)}</span>`;
  if (s.status === 'called') return '<span class="tag call">CALL</span>';
  if (s.role === 'hero' && spot.type) return '';
  return '';
}

export function tableHtml(spot, { revealed = {}, compact = false } = {}) {
  const n = spot.seats.length;
  const hero = spot.heroIdx;
  const parts = [];
  const unit = spot.valueMode === 'icm';
  spot.seats.forEach((s, i) => {
    const k = (i - hero + n) % n;
    const p = seatXY(k, n);
    const cls = ['seat', s.role, s.status === 'folded' ? 'folded' : ''].join(' ');
    const show = revealed[i];
    const cardsPart = s.role === 'hero'
      ? ''
      : s.status === 'folded'
        ? ''
        : `<div class="cards">${show ? show.map((c) => cardHtml(c, { size: 'sm', deal: true })).join('') : `${cardHtml(null, { size: 'sm', back: true })}${cardHtml(null, { size: 'sm', back: true })}`}</div>`;
    parts.push(`
      <div class="${cls}" data-seat="${i}" style="left:${p.x}%;top:${p.y}%">
        ${p.y < 50 ? cardsPart : ''}
        <div class="plate">
          <div class="pos">${esc(s.posLabel)}${s.role === 'hero' ? ' · TY' : ''}</div>
          <div class="stack">${fmt(s.stack, 1)} bb</div>
          ${unit && s.icmValue != null && !compact ? `<div class="val">ICM ${money(s.icmValue)}</div>` : ''}
          ${s.bounty ? `<div class="bounty">🎯 $${fmt(s.bounty)}</div>` : ''}
          ${s.oppTypeLabel ? `<div class="opp">${esc(s.oppTypeLabel.split(' (')[0])}</div>` : ''}
          ${statusTag(s, spot)}
        </div>
        ${p.y >= 50 ? cardsPart : ''}
      </div>`);
    if (s.posted > 0) {
      const c = toward(p, 0.42);
      const color = s.status === 'allin' ? '' : s.posted >= 2 ? 'b' : 'g';
      parts.push(`<div class="chipstack" data-chips="${i}" style="left:${c.x}%;top:${c.y}%"><span class="chip-i ${color}"></span>${s.status === 'allin' ? fmt(s.stack, 1) : fmt(s.posted, 1)}</div>`);
    }
  });
  const btn = spot.buttonIdx >= 0 ? toward(seatXY((spot.buttonIdx - hero + n) % n, n), 0.25) : null;
  const meta = [spot.formatLabel, spot.stageLabel, spot.valueMode === 'icm' ? `pula ${money(spot.poolTotal)}` : 'chip EV'].filter(Boolean).join(' · ');
  return `
    <div class="table-wrap">
      <div class="table-oval"></div>
      <div class="table-logo">POKER TRENER</div>
      <div class="table-center"><div class="pot" data-pot>Pula ${fmt(spot.pot, 1)} bb</div><div class="meta">${esc(meta)}</div>${spot.offTable ? `<div class="meta">+${spot.offTable.count} graczy przy innych stołach</div>` : ''}</div>
      ${btn ? `<div class="dealer" style="left:${btn.x}%;top:${btn.y}%">D</div>` : ''}
      ${parts.join('')}
    </div>`;
}

export function mountTable(container, spot, opts = {}) {
  container.innerHTML = tableHtml(spot, opts);
  sound('deal');
}

// E1: żetony bohatera lecą do puli.
export function animateBet(container, seatIdx, amountText) {
  const wrap = container.querySelector('.table-wrap');
  const seat = wrap && wrap.querySelector(`.seat[data-seat="${seatIdx}"]`);
  if (!seat) return;
  const chip = document.createElement('div');
  chip.className = 'chipstack fly';
  chip.innerHTML = `<span class="chip-i k"></span>${esc(amountText || '')}`;
  chip.style.left = seat.style.left;
  chip.style.top = seat.style.top;
  wrap.appendChild(chip);
  sound('chips');
  requestAnimationFrame(() => {
    chip.style.left = '50%';
    chip.style.top = '50%';
  });
  setTimeout(() => (chip.style.opacity = '0.0'), 900);
  setTimeout(() => chip.remove(), 1400);
}

export function revealSeat(container, seatIdx, cards) {
  const seat = container.querySelector(`.seat[data-seat="${seatIdx}"] .cards`);
  if (seat && cards) seat.innerHTML = cards.map((c) => cardHtml(c, { size: 'sm', deal: true })).join('');
}

// D3: wypłaty i wartość ICM graczy.
export function payoutsHtml(spot) {
  if (spot.valueMode !== 'icm' || !spot.payouts?.length) {
    return `<p class="small muted">Faza chip EV — wypłaty jeszcze nie wpływają na decyzje, liczą się żetony.</p>`;
  }
  const rows = spot.payouts.map((p, i) => `<tr><td>${i + 1}.</td><td>${money(p)}</td><td class="muted">${fmt((p / spot.poolTotal) * 100, 1)}%</td></tr>`).join('');
  const players = spot.seats
    .slice()
    .sort((a, b) => b.stack - a.stack)
    .map((s) => `<tr${s.role === 'hero' ? ' class="gold"' : ''}><td>${esc(s.posLabel)}${s.role === 'hero' ? ' (Ty)' : ''}</td><td class="nowrap">${fmt(s.stack, 1)} bb</td><td>${money(s.icmValue)}</td></tr>`)
    .join('');
  const unpaid = spot.numPlayers + (spot.offTable?.count || 0) - spot.payouts.length;
  return `
    <div class="small muted mb">${esc(spot.templateLabel || '')}${unpaid > 0 ? ` · <b class="warn">${unpaid} ${unpaid === 1 ? 'gracz odpadnie' : 'graczy odpadnie'} bez nagrody</b>` : ' · wszyscy w pieniądzach'}</div>
    <table class="tbl mb"><thead><tr><th>Miejsce</th><th>Nagroda</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <table class="tbl"><thead><tr><th>Gracz</th><th class="nowrap">Stos</th><th>ICM</th></tr></thead><tbody>${players}</tbody></table>`;
}
