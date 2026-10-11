import { h, esc } from './dom.js';

export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const t = h(`<div class="toast ${kind}">${esc(msg)}</div>`);
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'gold' ? 4200 : 2600);
}

export function errorToast(e) {
  toast(e?.message || 'Coś poszło nie tak', 'err');
}

export function modal(html, { wide = false, onClose } = {}) {
  const m = h(`<div class="modal" role="dialog" aria-modal="true"><div class="box ${wide ? 'wide' : ''}"></div></div>`);
  const box = m.firstElementChild;
  if (typeof html === 'string') box.innerHTML = html;
  else box.appendChild(html);
  const close = () => {
    m.remove();
    document.removeEventListener('keydown', esc_);
    onClose && onClose();
  };
  const esc_ = (e) => {
    if (e.key === 'Escape') close();
  };
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', esc_);
  document.body.appendChild(m);
  return { el: box, close };
}

export function confirmBox(text) {
  return new Promise((resolve) => {
    const { el, close } = modal(`<p>${esc(text)}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-no>Anuluj</button><button class="btn danger" data-yes>Tak</button></div>`, { onClose: () => resolve(false) });
    el.querySelector('[data-no]').onclick = () => close();
    el.querySelector('[data-yes]').onclick = () => {
      resolve(true);
      close();
    };
  });
}

export function achievementToasts(list) {
  for (const a of list || []) toast(`${a.icon} Odznaka: ${a.label}`, 'gold');
}
