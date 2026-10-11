import { gridHtml } from './grid.js';
import { cardsHtml } from './cards.js';

const W = 600;
const st = (fill, extra = '') => `style="fill:${fill};${extra}"`;
const txt = (x, y, s, { size = 13, anchor = 'middle', fill = 'var(--text)', weight = 500 } = {}) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" style="fill:${fill};font-size:${size}px;font-weight:${weight}">${s}</text>`;
const rect = (x, y, w, h, fill, r = 10, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${st(fill, extra)}/>`;
const line = (x1, y1, x2, y2, color = 'var(--muted)', w = 2, dash = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${color};stroke-width:${w};${dash ? `stroke-dasharray:${dash}` : ''}"/>`;
const arrow = (x1, y1, x2, y2, color = 'var(--gold)') => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const hx = x2 - 9 * Math.cos(a - 0.4);
  const hy = y2 - 9 * Math.sin(a - 0.4);
  const hx2 = x2 - 9 * Math.cos(a + 0.4);
  const hy2 = y2 - 9 * Math.sin(a + 0.4);
  return `${line(x1, y1, x2, y2, color, 2.4)}<polygon points="${x2},${y2} ${hx},${hy} ${hx2},${hy2}" ${st(color)}/>`;
};
const svg = (h, body) => `<svg viewBox="0 0 ${W} ${h}" role="img">${body}</svg>`;

function tableSeats(labels, { highlight = {}, h = 260 } = {}) {
  const cx = 300;
  const cy = h / 2;
  let s = `<ellipse cx="${cx}" cy="${cy}" rx="210" ry="${h / 2 - 40}" style="fill:var(--felt-2);stroke:var(--rail-1);stroke-width:10"/>`;
  labels.forEach((l, i) => {
    const t = Math.PI / 2 + (i * 2 * Math.PI) / labels.length;
    const x = cx + 235 * Math.cos(t);
    const y = cy + (h / 2 - 22) * Math.sin(t);
    const c = highlight[l] || 'var(--panel-3)';
    s += rect(x - 34, y - 14, 68, 28, c, 8, 'stroke:var(--border)') + txt(x, y + 5, l, { size: 12, weight: 700 });
  });
  return s;
}

const ILL = {
  'hand-flow': () => {
    const steps = [['Blindy', 'SB, BB, ante'], ['Preflop', '2 karty'], ['Flop', '3 karty'], ['Turn', '+1'], ['River', '+1'], ['Showdown', 'najlepsza 5']];
    let s = '';
    steps.forEach(([a, b], i) => {
      const x = 12 + i * 98;
      s += rect(x, 70, 86, 70, i === 5 ? 'var(--gold)' : 'var(--panel-3)', 12, 'stroke:var(--border)');
      s += txt(x + 43, 100, a, { weight: 800, fill: i === 5 ? '#2a1e04' : 'var(--text)' }) + txt(x + 43, 120, b, { size: 11, fill: i === 5 ? '#2a1e04' : 'var(--muted)' });
      if (i < 5) s += arrow(x + 88, 105, x + 98, 105);
    });
    s += txt(300, 40, '4 rundy licytacji: preflop → flop → turn → river', { size: 14, weight: 700, fill: 'var(--gold)' });
    s += txt(300, 185, 'Na każdej rundzie: pas · check · call · bet · raise', { size: 12, fill: 'var(--muted)' });
    return svg(210, s);
  },
  'hand-rankings': () => {
    const rows = [['Poker królewski', 'AsKsQsJsTs'], ['Poker', '9h8h7h6h5h'], ['Kareta', 'QcQdQhQs2d'], ['Full', 'JsJdJh4c4d'], ['Kolor', 'Ad9d7d4d2d'], ['Strit', 'Tc9h8s7d6c'], ['Trójka', '7s7h7dKc2h'], ['Dwie pary', 'KsKd5c5h9s'], ['Para', 'AhAc8d6s3c'], ['Wysoka karta', 'AsJd9c6h3d']];
    return `<div class="list">${rows.map(([n, c], i) => `<div class="item"><span><b class="gold">${10 - i}.</b> ${n}</span>${cardsHtml(c.match(/../g), { size: 'sm' })}</div>`).join('')}</div>`;
  },
  'table-positions': () => {
    const pos = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'];
    const hl = { UTG: 'color-mix(in srgb, var(--danger) 45%, var(--panel-3))', 'UTG+1': 'color-mix(in srgb, var(--danger) 35%, var(--panel-3))', MP: 'color-mix(in srgb, var(--warn) 35%, var(--panel-3))', LJ: 'color-mix(in srgb, var(--warn) 30%, var(--panel-3))', HJ: 'color-mix(in srgb, var(--warn) 25%, var(--panel-3))', CO: 'color-mix(in srgb, var(--accent) 35%, var(--panel-3))', BTN: 'color-mix(in srgb, var(--accent) 55%, var(--panel-3))' };
    return svg(270, tableSeats(pos, { highlight: hl, h: 270 }) + txt(300, 128, 'Wczesne (czerwone) → późne (zielone)', { size: 13, weight: 700, fill: '#fff' }) + txt(300, 148, 'Im później działasz, tym szerzej grasz', { size: 11, fill: '#d6e9dd' }));
  },
  'blinds-structure': () => {
    const lv = [[1, '50/100', 50], [3, '100/200', 25], [5, '200/400', 12.5], [7, '400/800', 6.3]];
    let s = txt(300, 22, 'Ten sam stos 5000 żetonów przy rosnących blindach', { weight: 700, fill: 'var(--gold)' });
    lv.forEach(([l, b, bb], i) => {
      const x = 40 + i * 140;
      const hgt = bb * 3.2;
      s += rect(x, 200 - hgt, 90, hgt, bb > 20 ? 'var(--accent)' : bb > 10 ? 'var(--warn)' : 'var(--danger)', 8);
      s += txt(x + 45, 192 - hgt, `${bb}bb`, { weight: 800 }) + txt(x + 45, 220, `Poziom ${l}`, { size: 11, fill: 'var(--muted)' }) + txt(x + 45, 236, b, { size: 11, fill: 'var(--muted)' });
    });
    return svg(250, s);
  },
  'starting-hands-grid': () => gridHtml({ layers: [{ labels: ['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AQs', 'AJs', 'KQs', 'AKo'], cls: 'on3' }, { labels: ['99', '88', '77', 'ATs', 'KJs', 'QJs', 'JTs', 'T9s', '98s', 'AQo', 'KQo'], cls: 'on2' }], title: 'Zielone: najsilniejsze ręce · pomarańczowe: grywalne z późnych pozycji. Nad przekątną suited, pod nią offsuit.' }),
  'pot-odds-bar': () => {
    let s = txt(300, 24, 'Pula 100, zakład 50 → dopłacasz 50, by wygrać 200', { weight: 700, fill: 'var(--gold)' });
    s += rect(40, 60, 520, 40, 'var(--panel-3)', 10) + rect(40, 60, 130, 40, 'var(--danger)', 10);
    s += txt(105, 86, 'Twoje 50', { weight: 700, fill: '#fff' }) + txt(365, 86, 'Pula po callu: 200', { weight: 700 });
    s += txt(300, 135, 'Potrzebne equity = 50 / 200 = 25%', { size: 16, weight: 800 });
    s += txt(300, 160, 'Masz więcej niż 25% → call jest +EV', { size: 12, fill: 'var(--muted)' });
    return svg(180, s);
  },
  outs: () => `<div class="row" style="justify-content:center;gap:24px"><div class="center"><div class="small muted">Twoja ręka</div>${cardsHtml(['8h', '7h'])}</div><div class="center"><div class="small muted">Flop</div>${cardsHtml(['Kh', '5h', '6c'])}</div></div><p class="center small mt">Kolor (9 kierów) + strit (4 dziewiątki + 4 czwórki, bez 9♥ i 4♥) = <b class="gold">15 outów</b> → reguła 4: ok. 54% (z poprawką ok. 53%).</p>`,
  'board-texture': () => `<div class="grid g2"><div class="center"><div class="small muted mb">Suchy board</div>${cardsHtml(['Kc', '7d', '2h'])}<p class="small">Mało stritów i kolorów — para jest silna.</p></div><div class="center"><div class="small muted mb">Mokry board</div>${cardsHtml(['Jh', 'Th', '9c'])}<p class="small">Strity, drawy do koloru — jedna para jest słaba.</p></div></div>`,
  'ev-tree': () => {
    let s = rect(20, 105, 110, 44, 'var(--gold)', 10) + txt(75, 132, 'All-in 10bb', { weight: 800, fill: '#2a1e04' });
    s += arrow(130, 120, 260, 55) + arrow(130, 135, 260, 185);
    s += rect(260, 35, 150, 40, 'var(--panel-3)', 10, 'stroke:var(--border)') + txt(335, 60, 'Pas (60%): +2.5bb', { size: 12, weight: 700 });
    s += rect(260, 165, 150, 40, 'var(--panel-3)', 10, 'stroke:var(--border)') + txt(335, 190, 'Call (40%)', { size: 12, weight: 700 });
    s += arrow(410, 178, 470, 140) + arrow(410, 192, 470, 230);
    s += txt(530, 135, 'Wygrana 35%: +12.5', { size: 11, fill: 'var(--accent)', weight: 700 }) + txt(530, 235, 'Przegrana 65%: −10', { size: 11, fill: 'var(--danger)', weight: 700 });
    s += txt(300, 255, 'EV = 0.6×2.5 + 0.4×(0.35×12.5 − 0.65×10) ≈ +0.66bb', { size: 13, weight: 800, fill: 'var(--gold)' });
    return svg(265, s);
  },
  'range-grid': () => gridHtml({ layers: [{ labels: ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', 'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'AKo', 'AQo', 'AJo', 'ATo', 'KQo'], cls: 'on' }], hero: 'AJo', title: 'Zasięg shove ok. 15% (czerwony). Złota ramka: Twoja ręka — myślisz, jak wypada przeciwko całemu zasięgowi.' }),
  'push-fold-chart': () => {
    const rows = [['UTG', [35, 20, 13, 8, 5]], ['MP', [45, 28, 18, 11, 7]], ['CO', [60, 38, 25, 16, 10]], ['BTN', [72, 48, 33, 22, 14]], ['SB', [85, 60, 42, 28, 18]]];
    const head = ['≤6bb', '7-10', '11-15', '16-20', '21-25'];
    return `<table class="tbl"><thead><tr><th>Pozycja</th>${head.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(([p, v]) => `<tr><td><b>${p}</b></td>${v.map((x) => `<td style="background:color-mix(in srgb, var(--accent) ${Math.round(x * 0.7)}%, transparent)">${x}%</td>`).join('')}</tr>`).join('')}</tbody></table><p class="small muted mt">Orientacyjny % rąk do open shove (model aplikacji). Krótszy stos i późniejsza pozycja = szerzej.</p>`;
  },
  'icm-chips-vs-money': () => {
    const pl = [['A', 50, 38.4], ['B', 30, 32.8], ['C', 20, 28.9]];
    let s = txt(300, 22, 'Stosy 5000 / 3000 / 2000 · wypłaty 50% / 30% / 20%', { weight: 700, fill: 'var(--gold)' });
    pl.forEach(([n, c, m], i) => {
      const y = 50 + i * 60;
      s += txt(30, y + 20, n, { weight: 800 }) + rect(50, y, c * 9, 18, 'var(--info)', 5) + txt(56 + c * 9, y + 14, `${c}% żetonów`, { size: 11, anchor: 'start' });
      s += rect(50, y + 22, m * 9, 18, 'var(--gold)', 5) + txt(56 + m * 9, y + 36, `${m}% pieniędzy (ICM)`, { size: 11, anchor: 'start' });
    });
    s += txt(300, 240, 'Lider ma 50% żetonów, ale tylko 38% wartości — kolejne żetony są warte coraz mniej', { size: 12, fill: 'var(--muted)' });
    return svg(250, s);
  },
  'rfi-chart': () => {
    const p = [['UTG', 12], ['MP', 17], ['HJ', 23], ['CO', 28], ['BTN', 43], ['SB', 38]];
    let s = txt(300, 22, 'Otwarcie (RFI) przy 40–100bb — % rąk', { weight: 700, fill: 'var(--gold)' });
    p.forEach(([n, v], i) => {
      const x = 40 + i * 90;
      s += rect(x, 210 - v * 4, 60, v * 4, 'var(--accent)', 8) + txt(x + 30, 202 - v * 4, `${v}%`, { weight: 800 }) + txt(x + 30, 230, n, { weight: 700 });
    });
    return svg(245, s);
  },
  'call-vs-shove': () => {
    let s = txt(300, 22, 'Próg equity do calla: chip EV vs ICM', { weight: 700, fill: 'var(--gold)' });
    s += txt(110, 70, 'Chip EV', { weight: 700 }) + rect(170, 55, 380, 22, 'var(--panel-3)', 6) + rect(170, 55, 380 * 0.4, 22, 'var(--info)', 6) + txt(180 + 380 * 0.4, 71, '40%', { anchor: 'start', weight: 700 });
    s += txt(110, 120, 'ICM (bąbelek)', { weight: 700 }) + rect(170, 105, 380, 22, 'var(--panel-3)', 6) + rect(170, 105, 380 * 0.55, 22, 'var(--danger)', 6) + txt(180 + 380 * 0.55, 121, '55%', { anchor: 'start', weight: 700 });
    s += txt(300, 170, 'Różnica 15 pp to „risk premium” — dodatkowe equity, którego wymaga ICM', { size: 12, fill: 'var(--muted)' });
    return svg(190, s);
  },
  'stack-zones': () => {
    const z = [['<7bb', 'Pierwszy dobry spot = all-in', 'var(--danger)'], ['8-12bb', 'Czysty push/fold', 'var(--warn)'], ['13-25bb', '3-bet shove, resteal', 'var(--info)'], ['25bb+', 'Normalna gra, otwarcia', 'var(--accent)']];
    let s = '';
    z.forEach(([a, b, c], i) => {
      const x = 15 + i * 145;
      s += rect(x, 40, 135, 120, c, 14) + txt(x + 67, 90, a, { size: 20, weight: 900, fill: '#111' }) + txt(x + 67, 120, b, { size: 11, weight: 700, fill: '#111' });
    });
    s += txt(300, 195, 'Fold equity rośnie razem z Twoim stosem', { size: 13, fill: 'var(--muted)' });
    return svg(210, s);
  },
  bubble: () => {
    let s = txt(300, 22, '10 graczy, płatne 9 miejsc', { weight: 700, fill: 'var(--gold)' });
    for (let i = 0; i < 10; i++) {
      const x = 40 + i * 54;
      const paid = i < 9;
      s += `<circle cx="${x}" cy="90" r="20" ${st(paid ? 'var(--accent)' : 'var(--danger)')}/>` + txt(x, 95, `${i + 1}`, { weight: 800, fill: '#111' });
    }
    s += txt(526, 135, 'bąbelek', { size: 12, weight: 700, fill: 'var(--danger)' });
    s += txt(300, 175, 'Odpadnięcie teraz = 0 zł. Krótkie stosy grają bardzo ciasno — duże stosy naciskają.', { size: 12, fill: 'var(--muted)' });
    return svg(190, s);
  },
  'payout-pyramid': () => {
    const p = [27, 18, 13, 10, 8.2, 6.8, 5.8, 5.4, 5];
    let s = txt(300, 20, 'Typowe wypłaty final table (% puli)', { weight: 700, fill: 'var(--gold)' });
    p.forEach((v, i) => {
      const x = 30 + i * 61;
      s += rect(x, 220 - v * 6.5, 45, v * 6.5, i === 0 ? 'var(--gold)' : 'var(--info)', 6) + txt(x + 22, 213 - v * 6.5, `${v}%`, { size: 11, weight: 700 }) + txt(x + 22, 238, `${i + 1}.`, { size: 11 });
    });
    return svg(250, s);
  },
  threebet: () => svg(230, tableSeats(['BTN', 'SB', 'BB', 'CO'], { highlight: { CO: 'color-mix(in srgb, var(--warn) 50%, var(--panel-3))', BB: 'color-mix(in srgb, var(--gold) 55%, var(--panel-3))' }, h: 230 }) + txt(300, 105, 'CO otwiera 2.2bb (kradzież)', { size: 13, weight: 700, fill: '#fff' }) + txt(300, 128, 'BB: all-in 18bb (resteal)', { size: 13, weight: 800, fill: '#ffe08a' })),
  squeeze: () => svg(230, tableSeats(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'], { highlight: { HJ: 'color-mix(in srgb, var(--warn) 50%, var(--panel-3))', CO: 'color-mix(in srgb, var(--info) 45%, var(--panel-3))', BTN: 'color-mix(in srgb, var(--gold) 55%, var(--panel-3))' }, h: 230 }) + txt(300, 100, 'HJ open → CO call', { size: 13, weight: 700, fill: '#fff' }) + txt(300, 122, 'BTN: squeeze all-in', { size: 13, weight: 800, fill: '#ffe08a' }) + txt(300, 142, 'call CO = zasięg ograniczony', { size: 11, fill: '#d6e9dd' })),
  'heads-up': () => svg(200, tableSeats(['SB/BTN', 'BB'], { highlight: { 'SB/BTN': 'color-mix(in srgb, var(--gold) 55%, var(--panel-3))' }, h: 200 }) + txt(300, 95, 'Heads-up: SB = button', { size: 14, weight: 800, fill: '#fff' }) + txt(300, 118, 'shove przy 10bb: ok. 60-75% rąk', { size: 12, fill: '#d6e9dd' })),
  satellite: () => {
    let s = txt(300, 22, '6 graczy, 5 biletów — każdy bilet wart tyle samo', { weight: 700, fill: 'var(--gold)' });
    [3, 1.6, 1.2, 0.9, 0.6, 0.3].forEach((v, i) => {
      const x = 40 + i * 92;
      s += rect(x, 180 - v * 40, 60, v * 40, i < 5 ? 'var(--accent)' : 'var(--danger)', 8) + txt(x + 30, 200, i < 5 ? '🎟️' : '✖', { size: 16 }) + txt(x + 30, 172 - v * 40, `${v}×`, { size: 11, weight: 700 });
    });
    s += txt(300, 228, 'Lider z 3× średnią może pasować nawet AA — ma bilet niemal pewny', { size: 12, fill: 'var(--muted)' });
    return svg(240, s);
  },
  pko: () => {
    let s = rect(60, 60, 180, 90, 'var(--panel-3)', 14, 'stroke:var(--border)') + txt(150, 95, 'Bounty rywala', { weight: 700 }) + txt(150, 125, '$40', { size: 24, weight: 900, fill: 'var(--gold)' });
    s += arrow(245, 85, 370, 55) + arrow(245, 125, 370, 165);
    s += rect(370, 30, 200, 50, 'var(--accent)', 12) + txt(470, 61, '$20 gotówką od razu', { weight: 800, fill: '#052414' });
    s += rect(370, 140, 200, 50, 'var(--info)', 12) + txt(470, 171, '$20 na Twoją głowę', { weight: 800, fill: '#001a33' });
    return svg(220, s);
  },
  'opponent-types': () => {
    const t = [['Nit', '12/9', 'Kradnij częściej, sprawdzaj rzadziej'], ['Regular', '22/18', 'Gra standardowa'], ['LAG', '30/24', 'Sprawdzaj szerzej'], ['Maniak', '45/35', 'Pułapki, call szeroko'], ['Rekreacyjny', '40/8', 'Value bet, bez blefów']];
    return `<table class="tbl"><thead><tr><th>Typ</th><th>VPIP/PFR</th><th>Jak grać przeciwko</th></tr></thead><tbody>${t.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table>`;
  },
  'hh-review': () => {
    const st2 = [['Eksport HH', '📤'], ['Import', '📥'], ['Spoty push/fold vs model', '🎯'], ['Replayer', '▶️'], ['Tagi i dziennik', '🏷️']];
    let s = '';
    st2.forEach(([a, ic], i) => {
      const x = 10 + i * 118;
      s += rect(x, 50, 104, 90, 'var(--panel-3)', 12, 'stroke:var(--border)') + txt(x + 52, 88, ic, { size: 24 }) + txt(x + 52, 118, a.length > 14 ? a.slice(0, 13) + '…' : a, { size: 11, weight: 700 });
      if (i < 4) s += arrow(x + 106, 95, x + 118, 95);
    });
    return svg(170, s);
  },
  'bankroll-curve': () => {
    const pts = [100, 96, 90, 93, 85, 80, 84, 120, 112, 108, 101, 97, 140, 132, 128];
    const path = pts.map((v, i) => `${i ? 'L' : 'M'}${30 + i * 39},${220 - v}`).join(' ');
    return svg(240, `${txt(300, 22, 'Typowa krzywa MTT: długie spadki, rzadkie duże wygrane', { weight: 700, fill: 'var(--gold)' })}${line(30, 220, 580, 220, 'var(--border)')}<path d="${path}" style="fill:none;stroke:var(--gold);stroke-width:3"/>${txt(300, 236, 'Bankroll 100+ wpisowych pozwala przetrwać wariancję', { size: 12, fill: 'var(--muted)' })}`);
  },
  multitable: () => {
    let s = '';
    [0, 1, 2].forEach((i) => {
      const x = 20 + i * 192;
      s += rect(x, 40, 176, 110, 'var(--felt-2)', 50, `stroke:${i === 1 ? 'var(--gold)' : 'var(--rail-1)'};stroke-width:${i === 1 ? 5 : 4}`);
      s += txt(x + 88, 100, i === 1 ? 'TWOJA DECYZJA' : 'czeka…', { size: 12, weight: 800, fill: i === 1 ? '#ffe08a' : '#d6e9dd' });
    });
    s += txt(300, 185, 'Gotowe odruchy (push/fold, ICM) = mniej myślenia na każdym stole', { size: 12, fill: 'var(--muted)' });
    return svg(200, s);
  },
  'tilt-meter': () => {
    let s = '';
    const segs = [['var(--accent)', 'Spokój'], ['var(--warn)', 'Irytacja'], ['var(--danger)', 'Tilt']];
    segs.forEach(([c, l], i) => {
      const a0 = Math.PI + (i * Math.PI) / 3;
      const a1 = Math.PI + ((i + 1) * Math.PI) / 3;
      const p = (a, r) => `${300 + r * Math.cos(a)},${170 + r * Math.sin(a)}`;
      s += `<path d="M${p(a0, 130)} A130,130 0 0,1 ${p(a1, 130)} L${p(a1, 80)} A80,80 0 0,0 ${p(a0, 80)} Z" ${st(c)}/>`;
      s += txt(300 + 150 * Math.cos((a0 + a1) / 2), 175 + 150 * Math.sin((a0 + a1) / 2), l, { size: 12, weight: 700 });
    });
    s += line(300, 170, 300 + 110 * Math.cos(Math.PI * 1.72), 170 + 110 * Math.sin(Math.PI * 1.72), 'var(--text)', 4) + `<circle cx="300" cy="170" r="8" ${st('var(--text)')}/>`;
    s += txt(300, 205, 'Po 2–3 błędach z rzędu: przerwa', { size: 13, weight: 700, fill: 'var(--gold)' });
    return svg(215, s);
  },
  routine: () => {
    const r = [['Rozgrzewka', '10 min trenera'], ['Sesja', 'limit turniejów i czasu'], ['Analiza', 'import HH, dziennik'], ['Tydzień', 'raport leaków, cele']];
    return `<div class="grid g4">${r.map(([a, b], i) => `<div class="stat"><span class="v gold">${i + 1}</span><b>${a}</b><div class="small muted">${b}</div></div>`).join('')}</div>`;
  },
  plan: () => `<div class="list"><div class="item"><span>📊 Raport leaków</span><span class="muted">→</span></div><div class="item"><span>🎯 Wybierz 1–2 leaki</span><span class="muted">→</span></div><div class="item"><span>🧪 Filtry trenera: typ, pozycja, stos</span><span class="muted">→</span></div><div class="item"><span>📈 Mierz trafność w tej samej komórce</span><span class="gold">↺</span></div></div>`,
  'risk-premium': () => {
    let s = txt(300, 22, 'Risk premium (dodatkowe equity do calla) wg starcia', { weight: 700, fill: 'var(--gold)' });
    const r = [['Duży vs krótki', 3], ['Duży vs średni', 6], ['Średni vs duży', 14], ['Średni vs średni', 16]];
    r.forEach(([a, v], i) => {
      const y = 45 + i * 45;
      s += txt(150, y + 18, a, { anchor: 'end', weight: 700 }) + rect(165, y + 4, v * 22, 22, v > 10 ? 'var(--danger)' : 'var(--accent)', 6) + txt(172 + v * 22, y + 20, `+${v} pp`, { anchor: 'start', weight: 700 });
    });
    return svg(235, s);
  },
};

export function illustration(key) {
  const fn = ILL[key];
  return fn ? `<div class="illus">${fn()}</div>` : '';
}
