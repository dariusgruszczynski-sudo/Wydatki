let keyHandler = null;

// D2: jeden aktywny zestaw skrótów naraz (ustawia go bieżący widok).
export function setKeys(map) {
  keyHandler = map;
}

export function clearKeys() {
  keyHandler = null;
}

document.addEventListener('keydown', (e) => {
  if (!keyHandler) return;
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const fn = keyHandler[k];
  if (fn) {
    e.preventDefault();
    fn(e);
  }
});

// D6: gest przesunięcia w lewo/prawo na elemencie.
export function onSwipe(el, { left, right }) {
  let x0 = null;
  let y0 = null;
  let t0 = 0;
  el.addEventListener(
    'touchstart',
    (e) => {
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
    },
    { passive: true }
  );
  el.addEventListener(
    'touchend',
    (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Date.now() - t0 > 700 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.7) return;
      if (dx < 0 && left) left();
      if (dx > 0 && right) right();
    },
    { passive: true }
  );
}
