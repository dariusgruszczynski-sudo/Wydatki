const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

export function gridLabels() {
  const g = [];
  for (let i = 0; i < 13; i++) {
    const row = [];
    for (let j = 0; j < 13; j++) {
      if (i === j) row.push(RANKS[i] + RANKS[j]);
      else if (i < j) row.push(RANKS[i] + RANKS[j] + 's');
      else row.push(RANKS[j] + RANKS[i] + 'o');
    }
    g.push(row);
  }
  return g;
}

const GRID = gridLabels();
export const COMBOS = (label) => (label.length === 2 ? 6 : label.endsWith('s') ? 4 : 12);

// layers: [{labels:Set|Array, cls:'on'|'on2'|'on3'}] — późniejsze warstwy nadpisują wcześniejsze.
export function gridHtml({ layers = [], hero = null, edit = false, heat = null, title = '' } = {}) {
  const sets = layers.map((l) => ({ set: l.labels instanceof Set ? l.labels : new Set(l.labels || []), cls: l.cls }));
  let maxHeat = 0;
  if (heat) for (const v of Object.values(heat)) maxHeat = Math.max(maxHeat, v.errors || 0);
  const cells = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const l = GRID[i][j];
      let cls = i === j ? 'c pair' : 'c';
      for (const s of sets) if (s.set.has(l)) cls = `c ${s.cls}`;
      if (hero === l) cls += ' hero';
      let style = '';
      let tip = l;
      if (heat && heat[l]) {
        const e = heat[l].errors || 0;
        const a = maxHeat ? e / maxHeat : 0;
        style = e ? ` style="background:color-mix(in srgb, var(--danger) ${Math.round(15 + a * 85)}%, var(--panel-3));color:#fff"` : ` style="background:color-mix(in srgb, var(--accent) 25%, var(--panel-3))"`;
        tip = `${l}: ${e} błędów / ${heat[l].n}`;
      }
      cells.push(`<div class="${cls}" data-l="${l}" title="${tip}"${style}>${l}</div>`);
    }
  }
  return `${title ? `<div class="small muted mb">${title}</div>` : ''}<div class="rgrid ${edit ? 'edit' : ''}">${cells.join('')}</div>`;
}

export function rangePct(labels) {
  let n = 0;
  for (const l of labels) n += COMBOS(l);
  return Math.round((n / 1326) * 1000) / 10;
}

// Edytor zasięgu (C3): klik i przeciąganie zaznacza/odznacza.
export function attachEditor(container, selected, onChange) {
  let painting = null;
  const grid = container.querySelector('.rgrid');
  const apply = (cell) => {
    const l = cell.dataset.l;
    if (painting === 'add') selected.add(l);
    else selected.delete(l);
    cell.className = `c ${selected.has(l) ? 'on3' : l.length === 2 ? 'pair' : ''}`;
    onChange && onChange(selected);
  };
  grid.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.c');
    if (!cell) return;
    e.preventDefault();
    painting = selected.has(cell.dataset.l) ? 'remove' : 'add';
    apply(cell);
  });
  grid.addEventListener('pointerover', (e) => {
    if (!painting) return;
    const cell = e.target.closest('.c');
    if (cell) apply(cell);
  });
  window.addEventListener('pointerup', () => (painting = null));
}

export function legendHtml(items) {
  return `<div class="legend">${items.map(([cls, label]) => `<span><i style="background:var(${cls})"></i>${label}</span>`).join('')}</div>`;
}
