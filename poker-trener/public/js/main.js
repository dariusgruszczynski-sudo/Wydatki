import { store, loadProfile, refreshSummary, subscribe } from './store.js';
import { setUnauthorizedHandler, get } from './api.js';
import { esc, fmt } from './ui/dom.js';
import { clearKeys } from './ui/input.js';
import { modal } from './ui/overlay.js';

const NAV = [
  { key: 'start', icon: '🏠', label: 'Start' },
  { key: 'trening', icon: '🎯', label: 'Trening' },
  { key: 'nauka', icon: '📘', label: 'Nauka' },
  { key: 'turniej', icon: '🏆', label: 'Turniej' },
  { key: 'narzedzia', icon: '🧮', label: 'Narzędzia' },
  { key: 'dziennik', icon: '📝', label: 'Dziennik' },
  { key: 'statystyki', icon: '📊', label: 'Statystyki' },
  { key: 'bankroll', icon: '💰', label: 'Bankroll' },
  { key: 'coach', icon: '🤖', label: 'Coach AI' },
  { key: 'profil', icon: '👤', label: 'Profil' },
];
const MOBILE_NAV = ['start', 'trening', 'nauka', 'statystyki'];

const VIEWS = {
  login: () => import('./views/login.js'),
  start: () => import('./views/home.js'),
  trening: () => import('./views/train.js'),
  turniej: () => import('./views/tournament.js'),
  nauka: () => import('./views/learn.js'),
  narzedzia: () => import('./views/tools.js'),
  dziennik: () => import('./views/journal.js'),
  statystyki: () => import('./views/stats.js'),
  raport: () => import('./views/report.js'),
  bankroll: () => import('./views/bankroll.js'),
  coach: () => import('./views/coach.js'),
  profil: () => import('./views/profile.js'),
};

let current = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  return { name: parts[0] || 'start', parts: parts.slice(1), params };
}

function renderChrome() {
  const p = store.profile;
  const { name } = parseHash();
  const sidebar = document.getElementById('sidebar');
  const bottom = document.getElementById('bottom-nav');
  const top = document.getElementById('topbar');
  if (!p) {
    sidebar.innerHTML = '';
    bottom.innerHTML = '';
    top.innerHTML = `<div class="brand"><span class="logo">♠</span> Poker Trener</div>`;
    return;
  }
  sidebar.innerHTML = `
    <div class="brand"><span class="logo">♠</span> Poker Trener</div>
    ${NAV.map((n) => `<a href="#/${n.key}" class="${name === n.key ? 'active' : ''}"><span>${n.icon}</span>${n.label}</a>`).join('')}
    <div class="side-foot small muted">${esc(p.avatar)} ${esc(p.name)}</div>`;
  bottom.innerHTML = `${MOBILE_NAV.map((k) => {
    const n = NAV.find((x) => x.key === k);
    return `<a href="#/${k}" class="${name === k ? 'active' : ''}"><span>${n.icon}</span>${n.label}</a>`;
  }).join('')}<a href="#" data-more class="${!MOBILE_NAV.includes(name) ? 'active' : ''}"><span>☰</span>Więcej</a>`;
  const s = store.summary;
  const title = NAV.find((n) => n.key === name)?.label || (name === 'raport' ? 'Raport' : '');
  top.innerHTML = `
    <div class="brand"><span class="logo">♠</span> ${esc(title || 'Poker Trener')}</div>
    <div class="hide-mobile"><b>${esc(title)}</b></div>
    <div class="top-stats">
      ${s ? `<span class="pill gold" title="Poziom ${s.level.level}: ${esc(s.level.name)}">⭐ ${s.level.level}</span>
      <span class="pill" title="Seria dni treningu">🔥 ${s.streak.current}</span>
      <span class="pill hide-mobile" title="Wirtualny bankroll">💰 ${fmt(s.virtualBankroll)}</span>` : ''}
      <a class="pill" href="#/profil" title="Profil">${esc(p.avatar)}</a>
    </div>`;
}

function moreMenu() {
  const items = NAV.filter((n) => !MOBILE_NAV.includes(n.key));
  const { el, close } = modal(`<h2>Więcej</h2><div class="grid g2">${items.map((n) => `<a class="tile" href="#/${n.key}"><span class="ic">${n.icon}</span><span class="t">${n.label}</span></a>`).join('')}</div>`);
  el.addEventListener('click', (e) => {
    if (e.target.closest('a.tile')) close();
  });
}

document.getElementById('bottom-nav').addEventListener('click', (e) => {
  if (e.target.closest('[data-more]')) {
    e.preventDefault();
    moreMenu();
  }
});

async function route() {
  const r = parseHash();
  if (!store.profile && r.name !== 'login') {
    location.hash = '#/login';
    return;
  }
  if (store.profile && r.name === 'login') {
    location.hash = '#/start';
    return;
  }
  const loader = VIEWS[r.name] || VIEWS.start;
  if (current && current.cleanup) {
    try {
      current.cleanup();
    } catch {
      /* widok już usunięty */
    }
  }
  clearKeys();
  renderChrome();
  // Świeży element przy każdej nawigacji — handlery poprzedniego widoku nie przeżyją zmiany.
  const old = document.getElementById('view');
  const root = old.cloneNode(false);
  old.replaceWith(root);
  root.innerHTML = '<div class="center muted mt">Ładowanie…</div>';
  try {
    const mod = await loader();
    current = mod.default;
    root.innerHTML = '';
    await current.render(root, r);
    root.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="panel"><h2>Nie udało się załadować widoku</h2><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Odśwież</button></div>`;
  }
}

subscribe(() => renderChrome());
setUnauthorizedHandler(() => {
  store.profile = null;
  location.hash = '#/login';
});
window.addEventListener('hashchange', route);

async function boot() {
  await loadProfile();
  if (store.profile) {
    await refreshSummary();
    get('/coach/status').then((s) => (store.coach = s)).catch(() => {});
  }
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
