'use strict';

// ---------- Helpery ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const PLN = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const fmt = (n) => PLN.format(Number(n) || 0);

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { showLogin(); throw new Error('unauth'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Błąd serwera');
  return data;
}

function todayISO() {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function dayLabel(iso) { try { return new Date(iso + 'T00:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }); } catch (_) { return iso; } }
function monthLabel(ym) { try { return new Date(ym + '-01T00:00:00').toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }); } catch (_) { return ym; } }
function monthShort(ym) { try { return new Date(ym + '-01T00:00:00').toLocaleDateString('pl-PL', { month: 'short' }); } catch (_) { return ym; } }
function escapeHtml(str) { return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// ---------- Stan ----------
let PEOPLE = [];
let CATEGORIES = []; // [{name, icon}]
let catIcon = {}; // name -> icon
let currentUser = null;
let selQePerson = null, selQeFund = 'wspolne';
let selSavPerson = null;
let selRecPerson = null, selRecFund = 'wspolne';
let selEmoji = '🏷️';
let curMonth = todayISO().slice(0, 7);
let savFilter = '';

// ---------- Animacje / feedback ----------
function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function confetti(emojis = ['🪙', '💸', '✨', '🎉']) {
  const wrap = $('#confetti');
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    p.style.left = Math.random() * 100 + 'vw';
    p.style.animationDuration = (1.4 + Math.random() * 1.4) + 's';
    p.style.fontSize = (14 + Math.random() * 16) + 'px';
    wrap.appendChild(p);
    setTimeout(() => p.remove(), 2900);
  }
}

// Wystrzał monet z punktu (x,y) — efekt "kasa!" przy dodaniu.
function coinBurst(x, y, emoji = '🪙') {
  for (let i = 0; i < 12; i++) {
    const c = document.createElement('div');
    c.className = 'burst-coin';
    c.textContent = Math.random() < 0.35 ? '✨' : emoji;
    c.style.left = x + 'px';
    c.style.top = y + 'px';
    document.body.appendChild(c);
    const ang = (Math.PI * 2 * i) / 12 + Math.random() * 0.5;
    const dist = 60 + Math.random() * 90;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - 40;
    c.animate(
      [
        { transform: 'translate(-50%,-50%) scale(.4) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.1) rotate(${(Math.random() * 720 - 360) | 0}deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(calc(-50% + ${dx * 1.2}px), calc(-50% + ${dy + 120}px)) scale(.7)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 400, easing: 'cubic-bezier(.2,.8,.3,1)' },
    ).onfinish = () => c.remove();
  }
}

// Efekt fali (ripple) na klikniętych elementach.
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.btn, .seg, .cat-tile, .icon-btn, .toggle');
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const r = document.createElement('span');
  r.className = 'ripple';
  r.style.width = r.style.height = size + 'px';
  r.style.left = (e.clientX - rect.left - size / 2) + 'px';
  r.style.top = (e.clientY - rect.top - size / 2) + 'px';
  el.appendChild(r);
  setTimeout(() => r.remove(), 600);
});

function animateAmount(el, to) {
  const from = Number(el._val) || 0;
  const dur = 650;
  const start = performance.now();
  el._val = to;
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---------- Logowanie ----------
function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
function showApp() { $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); }

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#loginError');
  err.classList.add('hidden');
  try {
    const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ pin: $('#pin').value }) });
    currentUser = r.person;
    $('#pin').value = '';
    await boot();
  } catch (_) {
    err.textContent = 'Nieprawidłowy PIN';
    err.classList.remove('hidden');
  }
});
$('#logoutBtn').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); location.reload(); });

// ---------- Nawigacja ----------
$$('.tabbtn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.tab;
    $$('.tabbtn').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

// ---------- Panel kontrolny (ustawienia) ----------
const EMOJIS = ['🍽️','🛒','🍺','⛽','🍕','☕','🧴','🏠','🧾','💊','🎬','👕','🚌','🚗','🧸','🐾','🎁','✈️','💡','📱','🏋️','💇','🎮','📦','💰','🍰','🚕','🩺'];
$('#settingsBtn').addEventListener('click', () => { $('#settings').classList.remove('hidden'); renderEmojiPicker(); });
$('#settingsClose').addEventListener('click', () => $('#settings').classList.add('hidden'));
$('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') $('#settings').classList.add('hidden'); });

function renderEmojiPicker() {
  const wrap = $('#emojiPick');
  wrap.innerHTML = '';
  EMOJIS.forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emoji-opt' + (em === selEmoji ? ' active' : '');
    b.textContent = em;
    b.addEventListener('click', () => {
      selEmoji = em;
      $('#emojiCurrent').textContent = em;
      $$('.emoji-opt', wrap).forEach((x) => x.classList.toggle('active', x.textContent === em));
    });
    wrap.appendChild(b);
  });
}

$('#catForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#catError');
  err.classList.add('hidden');
  const name = $('#newCat').value.trim();
  if (!name) return;
  try {
    await api('/categories', { method: 'POST', body: JSON.stringify({ name, icon: selEmoji }) });
    $('#newCat').value = '';
    selEmoji = '🏷️'; $('#emojiCurrent').textContent = '🏷️';
    await loadCategories();
    toast('Dodano kategorię');
  } catch (e2) { err.textContent = e2.message; err.classList.remove('hidden'); }
});

// ---------- Kategorie ----------
async function loadCategories() {
  CATEGORIES = await api('/categories');
  catIcon = {};
  CATEGORIES.forEach((c) => { catIcon[c.name] = c.icon; });

  // Select w formularzu cyklicznym
  const sel = $('#recCategory');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '';
    CATEGORIES.forEach((c) => {
      const o = document.createElement('option');
      o.value = c.name; o.textContent = c.icon + '  ' + c.name;
      sel.appendChild(o);
    });
    if (CATEGORIES.some((c) => c.name === prev)) sel.value = prev;
  }

  // Kafelki szybkiego wydatku
  const grid = $('#catGrid');
  grid.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'cat-tile';
    tile.innerHTML = `<span class="cat-emoji">${c.icon}</span><span class="cat-name">${escapeHtml(c.name)}</span>`;
    tile.addEventListener('click', () => quickAdd(c, tile));
    grid.appendChild(tile);
  });

  // Zarządzanie w panelu
  const man = $('#catManage');
  man.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const chip = document.createElement('span');
    chip.className = 'cat-mchip';
    chip.innerHTML = `<span>${c.icon} ${escapeHtml(c.name)}</span>`;
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = '×'; del.title = 'Usuń';
    del.addEventListener('click', async () => {
      await api('/categories/' + encodeURIComponent(c.name), { method: 'DELETE' });
      await loadCategories();
    });
    chip.appendChild(del);
    man.appendChild(chip);
  });
}

// ---------- Szybki wydatek ----------
$$('.qe-fund').forEach((b) => {
  b.addEventListener('click', () => {
    $$('.qe-fund').forEach((s) => s.classList.remove('active'));
    b.classList.add('active');
    selQeFund = b.dataset.fund;
  });
});

async function quickAdd(cat, tile) {
  const err = $('#qeError');
  err.classList.add('hidden');
  const amount = $('#qeAmount').value;
  const n = Number(String(amount).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) {
    err.textContent = 'Najpierw wpisz kwotę';
    err.classList.remove('hidden');
    $('#qeAmount').focus();
    return;
  }
  try {
    await api('/expenses', { method: 'POST', body: JSON.stringify({
      amount, category: cat.name, person: selQePerson, fund: selQeFund, date: todayISO(),
    }) });
    tile.classList.add('flash');
    setTimeout(() => tile.classList.remove('flash'), 500);
    const rect = tile.getBoundingClientRect();
    coinBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, cat.icon);
    $('#qeAmount').value = '';
    confetti(['💸', cat.icon, '🪙']);
    toast(`${cat.icon} ${cat.name} · ${fmt(n)}`);
    await refreshAll();
  } catch (e2) { err.textContent = e2.message; err.classList.remove('hidden'); }
}

// ---------- Wydatki: historia + podsumowanie ----------
async function loadExpenses() {
  const rows = await api('/expenses?month=' + curMonth);
  const list = $('#expenseList');
  $('#expCount').textContent = rows.length + (rows.length === 1 ? ' wpis' : ' wpisów');
  if (!rows.length) { list.innerHTML = '<div class="empty">Brak wydatków w tym miesiącu.</div>'; return; }
  list.innerHTML = '';
  rows.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'item';
    const fundLabel = r.fund === 'wspolne' ? '🤝 wspólne' : '👤 własne';
    const ic = catIcon[r.category] || '🏷️';
    const autoBadge = r.auto ? '<span class="tag auto">🔁 cykl.</span>' : '';
    item.innerHTML = `
      <div class="item-main">
        <div class="item-title">${ic} ${escapeHtml(r.category)}
          <span class="tag person-${r.person}">${escapeHtml(r.person)}</span>
          <span class="tag">${fundLabel}</span>${autoBadge}
        </div>
        <div class="item-sub">${dayLabel(r.date)}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
      </div>
      <div class="item-amount neg">${fmt(r.amount)}</div>`;
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '🗑';
    del.addEventListener('click', async () => { if (confirm('Usunąć ten wydatek?')) { await api('/expenses/' + r.id, { method: 'DELETE' }); await refreshAll(); } });
    item.appendChild(del);
    list.appendChild(item);
  });
}

async function loadSummary() {
  const s = await api('/summary?month=' + curMonth);
  const picker = $('#monthPicker');
  const months = new Set(s.months || []); months.add(curMonth);
  const sorted = Array.from(months).sort().reverse();
  picker.innerHTML = '';
  sorted.forEach((m) => { const o = document.createElement('option'); o.value = m; o.textContent = monthLabel(m); if (m === curMonth) o.selected = true; picker.appendChild(o); });

  animateAmount($('#sumTotal'), s.total);
  $('#sumShared').textContent = fmt(s.byFund.wspolne || 0);
  $('#sumOwn').textContent = fmt(s.byFund.wlasne || 0);

  const maxPerson = Math.max(1, ...Object.values(s.byPerson));
  const bp = $('#byPerson'); bp.innerHTML = '';
  Object.entries(s.byPerson).forEach(([p, a]) => bp.appendChild(barRow(p, a, (a / maxPerson) * 100, p === 'Pola' ? 'var(--pola)' : 'var(--darek)')));

  const bc = $('#byCategory'); bc.innerHTML = '';
  if (!s.byCategory.length) { bc.innerHTML = '<div class="empty">Brak danych.</div>'; }
  else {
    const maxCat = Math.max(1, ...s.byCategory.map((c) => c.amount));
    s.byCategory.forEach((c) => bc.appendChild(barRow((catIcon[c.category] || '') + ' ' + c.category, c.amount, (c.amount / maxCat) * 100, 'var(--primary)')));
  }
}

function barRow(label, amount, pct, color) {
  const row = document.createElement('div');
  row.className = 'bar-row';
  row.innerHTML = `<div class="bar-label">${escapeHtml(label)}</div><div class="bar-amount">${fmt(amount)}</div><div class="bar-track"><div class="bar-fill" style="background:${color}"></div></div>`;
  requestAnimationFrame(() => { const f = row.querySelector('.bar-fill'); if (f) f.style.width = Math.max(2, pct) + '%'; });
  return row;
}
$('#monthPicker').addEventListener('change', async (e) => { curMonth = e.target.value; await loadExpenses(); await loadSummary(); });

// ---------- Płatności cykliczne ----------
$$('.rec-fund').forEach((b) => { b.addEventListener('click', () => { $$('.rec-fund').forEach((s) => s.classList.remove('active')); b.classList.add('active'); selRecFund = b.dataset.recfund; }); });
$('#recForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#recError'); err.classList.add('hidden');
  try {
    await api('/recurring', { method: 'POST', body: JSON.stringify({ name: $('#recName').value, amount: $('#recAmount').value, dayOfMonth: $('#recDay').value, category: $('#recCategory').value, person: selRecPerson, fund: selRecFund }) });
    $('#recName').value = ''; $('#recAmount').value = '';
    toast('Dodano płatność cykliczną');
    await refreshAll();
  } catch (e2) { err.textContent = e2.message; err.classList.remove('hidden'); }
});
async function loadRecurring() {
  const rows = await api('/recurring');
  const list = $('#recList');
  const total = rows.filter((r) => r.active).reduce((s, r) => s + r.amount, 0);
  $('#recTotal').textContent = fmt(total) + ' / mies.';
  if (!rows.length) { list.innerHTML = '<div class="empty">Brak płatności cyklicznych.</div>'; return; }
  list.innerHTML = '';
  rows.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'item' + (r.active ? '' : ' rec-off');
    const ic = catIcon[r.category] || '🏷️';
    item.innerHTML = `
      <div class="item-main">
        <div class="item-title">${ic} ${escapeHtml(r.name)} <span class="tag person-${r.person}">${escapeHtml(r.person)}</span></div>
        <div class="item-sub">${escapeHtml(r.category)} · ${r.fund === 'wspolne' ? '🤝' : '👤'} · ${r.dayOfMonth}. dnia mies.</div>
      </div>
      <div class="item-amount neg">${fmt(r.amount)}</div>`;
    const toggle = document.createElement('button');
    toggle.className = 'toggle' + (r.active ? ' on' : ''); toggle.textContent = r.active ? 'wł.' : 'wył.';
    toggle.addEventListener('click', async () => { await api('/recurring/' + r.id, { method: 'PATCH', body: JSON.stringify({ active: !r.active }) }); await refreshAll(); });
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '🗑';
    del.addEventListener('click', async () => { if (confirm('Usunąć płatność cykliczną? Wpisy z przeszłości pozostaną.')) { await api('/recurring/' + r.id, { method: 'DELETE' }); await refreshAll(); } });
    item.appendChild(toggle); item.appendChild(del);
    list.appendChild(item);
  });
}

// ---------- Dashboard ----------
function deltaBadge(delta, pct) {
  if (!delta) return { cls: 'flat', text: 'bez zmian' };
  const arrow = delta > 0 ? '▲' : '▼';
  const cls = delta > 0 ? 'up' : 'down';
  const pctTxt = (pct === null || pct === undefined) ? '' : ` (${delta > 0 ? '+' : ''}${pct}%)`;
  return { cls, text: `${arrow} ${fmt(Math.abs(delta))}${pctTxt}` };
}
async function loadDashboard() {
  const d = await api('/dashboard?months=6');
  $('#dashMonthLabel').textContent = monthLabel(d.month);
  animateAmount($('#dashTotal'), d.current.total);
  const badge = deltaBadge(d.delta, d.deltaPct);
  const db = $('#dashDelta'); db.className = 'dash-delta ' + badge.cls; db.textContent = badge.text + ' vs poprz.';
  $('#dashPrev').textContent = fmt(d.previous.total);
  $('#dashAvg').textContent = fmt(d.average);
  $('#dashRecurring').textContent = fmt(d.recurringMonthly);
  $('#dashShared').textContent = fmt(d.current.byFund.wspolne || 0);
  $('#dashOwn').textContent = fmt(d.current.byFund.wlasne || 0);

  const trend = $('#dashTrend'); trend.innerHTML = '';
  const maxT = Math.max(1, ...d.trend.map((t) => t.total));
  d.trend.forEach((t) => {
    const col = document.createElement('div');
    col.className = 'trend-col' + (t.month === d.month ? ' current' : '');
    col.innerHTML = `<div class="trend-val">${t.total ? Math.round(t.total) : ''}</div><div class="trend-bar"></div><div class="trend-lbl">${monthShort(t.month)}</div>`;
    trend.appendChild(col);
    const h = Math.round((t.total / maxT) * 120);
    requestAnimationFrame(() => { col.querySelector('.trend-bar').style.height = (t.total ? Math.max(3, h) : 3) + 'px'; });
  });

  const bp = $('#dashByPerson'); bp.innerHTML = '';
  const maxP = Math.max(1, ...Object.values(d.current.byPerson));
  Object.entries(d.current.byPerson).forEach(([p, a]) => bp.appendChild(barRow(p, a, (a / maxP) * 100, p === 'Pola' ? 'var(--pola)' : 'var(--darek)')));

  const cc = $('#dashCategories'); cc.innerHTML = '';
  const cats = d.categoryCompare.filter((c) => c.current > 0 || c.previous > 0);
  if (!cats.length) { cc.innerHTML = '<div class="empty">Brak danych.</div>'; }
  else cats.forEach((c) => {
    const row = document.createElement('div'); row.className = 'cmp-row';
    const dcls = c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : 'flat';
    const arrow = c.delta > 0 ? '▲' : c.delta < 0 ? '▼' : '·';
    const dtxt = c.delta ? `${arrow} ${fmt(Math.abs(c.delta))}` : '—';
    row.innerHTML = `<div class="cmp-name">${(catIcon[c.category] || '')} ${escapeHtml(c.category)}</div><div class="cmp-cur">${fmt(c.current)}</div><div class="cmp-delta ${dcls}">${dtxt}</div>`;
    cc.appendChild(row);
  });
}

// ---------- Skarbonki (oszczędności) ----------
$$('.quick').forEach((b) => {
  b.addEventListener('click', () => {
    const input = $('#savAmount');
    const v = input.value.replace(',', '.').replace(/[+-]/g, '').trim();
    input.value = (b.dataset.sign === '-' ? '-' : '') + v;
    input.focus();
  });
});
$('#savingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#savError'); err.classList.add('hidden');
  const amountStr = $('#savAmount').value;
  const n = Number(String(amountStr).replace(',', '.'));
  try {
    await api('/savings', { method: 'POST', body: JSON.stringify({ amount: amountStr, date: $('#savDate').value, person: selSavPerson, label: $('#savLabel').value }) });
    $('#savAmount').value = ''; $('#savLabel').value = '';
    if (n > 0) { confetti(['🪙', '💰', '✨']); toast('Do skarbonki! ' + fmt(n)); }
    else { toast('Zapisano', 'ok'); }
    await Promise.all([loadSavingReport(), loadSavings()]);
  } catch (e2) { err.textContent = e2.message; err.classList.remove('hidden'); }
});

async function loadSavingReport() {
  const rep = await api('/savings/report');
  const wrap = $('#jars'); wrap.innerHTML = '';
  rep.tracks.forEach((t) => {
    const color = t.person === 'Pola' ? 'var(--pola)' : 'var(--darek)';
    const card = document.createElement('div');
    card.className = 'jar-card ' + t.person;
    const balCls = t.balance < 0 ? 'neg' : t.balance > 0 ? 'pos' : '';
    let badge = '';
    if (t.inDebt) badge = '<span class="jar-badge debt">Na minusie</span>';
    else if (t.goal > 0 && t.fillPct >= 100) badge = '<span class="jar-badge full">🎉 Cel osiągnięty!</span>';
    else if (t.balance > 0) badge = '<span class="jar-badge ok">Rośnie</span>';

    const coins = t.balance > 0 && !t.inDebt
      ? '<span class="jar-coin" style="left:24%;bottom:10%">🪙</span><span class="jar-coin" style="left:58%;bottom:16%;animation-delay:.7s">🪙</span>'
      : '';
    const emptyHint = (t.goal === 0 && t.balance <= 0) ? '<div class="jar-empty-hint">🐷</div>' : '';
    const pctLine = t.goal > 0 ? `<div class="jar-pct">${Math.round(t.fillPct)}% z ${fmt(t.goal)}</div>` : '<div class="jar-pct">ustaw cel niżej 👇</div>';

    card.innerHTML = `
      <div class="jar-title ${t.person}">${t.person}</div>
      <div class="jar-lid"></div>
      <div class="jar-slot"></div>
      <div class="jar ${t.inDebt ? 'debt' : ''}">
        ${emptyHint}
        <div class="jar-fill" style="--fillc:${color}"></div>
        ${coins}
      </div>
      <div class="jar-balance ${balCls}">${fmt(t.balance)}</div>
      ${pctLine}
      ${badge}
      <div class="jar-meta">Spłacono <b>${fmt(t.debtPaid)}</b> · Odłożono <b>${fmt(t.saved)}</b></div>
      <div class="jar-goal">
        <input type="text" inputmode="decimal" placeholder="cel zł" value="${t.goal > 0 ? t.goal : ''}" data-person="${t.person}" />
        <button type="button" class="btn btn-ghost" title="Ustaw cel">🎯</button>
      </div>`;
    wrap.appendChild(card);

    // Animacja wypełnienia
    const fill = card.querySelector('.jar-fill');
    const target = t.inDebt ? 0 : t.goal > 0 ? t.fillPct : (t.balance > 0 ? 22 : 0);
    setTimeout(() => { fill.style.height = target + '%'; }, 80);

    // Licznik salda (liczy się w górę)
    animateAmount(card.querySelector('.jar-balance'), t.balance);

    // Bąbelki unoszące się w cieczy
    if (target > 4) {
      const jarEl = card.querySelector('.jar');
      for (let i = 0; i < 4; i++) {
        const b = document.createElement('span');
        b.className = 'jar-bubble';
        b.style.left = (18 + Math.random() * 60) + '%';
        b.style.animationDuration = (2.4 + Math.random() * 2) + 's';
        b.style.animationDelay = (Math.random() * 3) + 's';
        jarEl.appendChild(b);
      }
    }

    // Ustawianie celu
    const input = card.querySelector('.jar-goal input');
    const setGoal = async () => {
      const val = input.value.trim();
      await api('/savings/goal', { method: 'POST', body: JSON.stringify({ person: t.person, goal: val || 0 }) });
      toast('Zapisano cel');
      await loadSavingReport();
    };
    card.querySelector('.jar-goal button').addEventListener('click', setGoal);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') setGoal(); });
  });
}

async function loadSavings() {
  const q = savFilter ? '?person=' + encodeURIComponent(savFilter) : '';
  const rows = await api('/savings' + q);
  const list = $('#savingList');
  if (!rows.length) { list.innerHTML = '<div class="empty">Brak wpisów. Dodaj pierwszy powyżej.</div>'; return; }
  list.innerHTML = '';
  rows.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'item';
    const cls = r.amount < 0 ? 'neg' : 'pos';
    const sign = r.amount > 0 ? '+' : '';
    item.innerHTML = `
      <div class="item-main">
        <div class="item-title"><span class="tag person-${r.person}">${escapeHtml(r.person)}</span> ${r.label ? escapeHtml(r.label) : (r.amount < 0 ? 'Wypłata / dług' : 'Odłożenie / spłata')}</div>
        <div class="item-sub">${dayLabel(r.date)}</div>
      </div>
      <div class="item-amount ${cls}">${sign}${fmt(r.amount)}</div>`;
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '🗑';
    del.addEventListener('click', async () => { if (confirm('Usunąć ten wpis?')) { await api('/savings/' + r.id, { method: 'DELETE' }); await Promise.all([loadSavingReport(), loadSavings()]); } });
    item.appendChild(del);
    list.appendChild(item);
  });
}

function buildSavFilter() {
  const wrap = $('#savFilter'); wrap.innerHTML = '';
  [['', 'Wszyscy']].concat(PEOPLE.map((p) => [p, p])).forEach(([val, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'seg' + (val === savFilter ? ' active' : ''); if (val) b.dataset.person = val; b.textContent = label;
    b.addEventListener('click', async () => { savFilter = val; $$('.seg', wrap).forEach((s) => s.classList.remove('active')); b.classList.add('active'); await loadSavings(); });
    wrap.appendChild(b);
  });
}

// ---------- Segmented builder ----------
function buildPersonSeg(container, onPick, current) {
  container.innerHTML = '';
  PEOPLE.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'seg' + (p === current ? ' active' : ''); b.dataset.person = p; b.textContent = p;
    b.addEventListener('click', () => { $$('.seg', container).forEach((s) => s.classList.remove('active')); b.classList.add('active'); onPick(p); });
    container.appendChild(b);
  });
}

// ---------- Odświeżanie ----------
async function refreshAll() { await Promise.all([loadExpenses(), loadSummary(), loadRecurring(), loadDashboard()]); }

// ---------- Bootstrap ----------
async function boot() {
  showApp();
  PEOPLE = await api('/people');
  currentUser = currentUser || PEOPLE[0];
  selQePerson = currentUser;
  selSavPerson = selSavPerson || currentUser;
  selRecPerson = selRecPerson || currentUser;

  $('#whoami').textContent = currentUser;
  $('#whoami').className = 'pill person-pill ' + currentUser;
  $('#logoutBtn').classList.remove('hidden');

  buildPersonSeg($('#qePerson'), (p) => { selQePerson = p; }, selQePerson);
  buildPersonSeg($('#savPerson'), (p) => { selSavPerson = p; }, selSavPerson);
  buildPersonSeg($('#recPerson'), (p) => { selRecPerson = p; }, selRecPerson);
  $$('.qe-fund').forEach((s) => s.classList.toggle('active', s.dataset.fund === selQeFund));
  buildSavFilter();

  $('#savDate').value = todayISO();
  $('#emojiCurrent').textContent = selEmoji;

  await loadCategories();
  await Promise.all([loadExpenses(), loadSummary(), loadRecurring(), loadDashboard(), loadSavingReport(), loadSavings()]);
}

async function init() {
  try {
    const st = await api('/auth/status');
    if (st.authed) { currentUser = st.person; await boot(); }
    else showLogin();
  } catch (_) { showLogin(); }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
init();
