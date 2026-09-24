'use strict';

// ---------- Helpery ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const PLN = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const fmt = (n) => PLN.format(Number(n) || 0);

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('unauth');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Błąd serwera');
  return data;
}

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function dayLabel(iso) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
  } catch (_) {
    return iso;
  }
}

function monthLabel(ym) {
  try {
    const d = new Date(ym + '-01T00:00:00');
    return d.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  } catch (_) {
    return ym;
  }
}

// ---------- Stan ----------
let PEOPLE = [];
let CATEGORIES = [];
let selExpPerson = null;
let selExpFund = 'wspolne';
let selSavPerson = null;
let curMonth = todayISO().slice(0, 7);
let savFilter = ''; // '' = wszyscy

// ---------- Logowanie ----------
function showLogin() {
  $('#login').classList.remove('hidden');
  $('#app').classList.add('hidden');
}
function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#loginError');
  err.classList.add('hidden');
  try {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ pin: $('#pin').value }) });
    await boot();
  } catch (_) {
    err.textContent = 'Nieprawidłowy PIN';
    err.classList.remove('hidden');
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

// ---------- Nawigacja zakładek ----------
$$('.tabbtn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.tab;
    $$('.tabbtn').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

// ---------- Segmented builders ----------
function buildPersonSeg(container, onPick, current) {
  container.innerHTML = '';
  PEOPLE.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg' + (p === current ? ' active' : '');
    b.dataset.person = p;
    b.textContent = p;
    b.addEventListener('click', () => {
      $$('.seg', container).forEach((s) => s.classList.remove('active'));
      b.classList.add('active');
      onPick(p);
    });
    container.appendChild(b);
  });
}

// ---------- Kategorie ----------
async function loadCategories() {
  CATEGORIES = await api('/categories');
  const sel = $('#expCategory');
  const prev = sel.value;
  sel.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = c;
    sel.appendChild(o);
  });
  if (CATEGORIES.includes(prev)) sel.value = prev;

  const list = $('#catList');
  list.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span>${escapeHtml(c)}</span>`;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Usuń kategorię';
    del.addEventListener('click', async () => {
      await api('/categories/' + encodeURIComponent(c), { method: 'DELETE' });
      await loadCategories();
    });
    chip.appendChild(del);
    list.appendChild(chip);
  });
}

$('#catForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#newCat').value.trim();
  if (!name) return;
  try {
    await api('/categories', { method: 'POST', body: JSON.stringify({ name }) });
    $('#newCat').value = '';
    await loadCategories();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Wydatki ----------
$$('.seg[data-fund]').forEach((b) => {
  b.addEventListener('click', () => {
    $$('.seg[data-fund]').forEach((s) => s.classList.remove('active'));
    b.classList.add('active');
    selExpFund = b.dataset.fund;
  });
});

$('#expenseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#expError');
  err.classList.add('hidden');
  const body = {
    amount: $('#expAmount').value,
    date: $('#expDate').value,
    category: $('#expCategory').value,
    person: selExpPerson,
    fund: selExpFund,
    note: $('#expNote').value,
  };
  try {
    await api('/expenses', { method: 'POST', body: JSON.stringify(body) });
    $('#expAmount').value = '';
    $('#expNote').value = '';
    await Promise.all([loadExpenses(), loadSummary()]);
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove('hidden');
  }
});

async function loadExpenses() {
  const rows = await api('/expenses?month=' + curMonth);
  const list = $('#expenseList');
  $('#expCount').textContent = rows.length + (rows.length === 1 ? ' wpis' : ' wpisów');
  if (!rows.length) {
    list.innerHTML = '<div class="empty">Brak wydatków w tym miesiącu.</div>';
    return;
  }
  list.innerHTML = '';
  rows.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'item';
    const fundLabel = r.fund === 'wspolne' ? '🤝 wspólne' : '👤 własne';
    item.innerHTML = `
      <div class="item-main">
        <div class="item-title">
          ${escapeHtml(r.category)}
          <span class="tag person-${r.person}">${escapeHtml(r.person)}</span>
          <span class="tag">${fundLabel}</span>
        </div>
        <div class="item-sub">${dayLabel(r.date)}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
      </div>
      <div class="item-amount neg">${fmt(r.amount)}</div>
    `;
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '🗑';
    del.title = 'Usuń';
    del.addEventListener('click', async () => {
      if (!confirm('Usunąć ten wydatek?')) return;
      await api('/expenses/' + r.id, { method: 'DELETE' });
      await Promise.all([loadExpenses(), loadSummary()]);
    });
    item.appendChild(del);
    list.appendChild(item);
  });
}

async function loadSummary() {
  const s = await api('/summary?month=' + curMonth);

  // Przełącznik miesięcy
  const picker = $('#monthPicker');
  const months = new Set(s.months || []);
  months.add(curMonth);
  const sorted = Array.from(months).sort().reverse();
  picker.innerHTML = '';
  sorted.forEach((m) => {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = monthLabel(m);
    if (m === curMonth) o.selected = true;
    picker.appendChild(o);
  });

  $('#sumTotal').textContent = fmt(s.total);
  $('#sumShared').textContent = fmt(s.byFund.wspolne || 0);
  $('#sumOwn').textContent = fmt(s.byFund.wlasne || 0);

  // Wg osoby
  const maxPerson = Math.max(1, ...Object.values(s.byPerson));
  const bp = $('#byPerson');
  bp.innerHTML = '';
  Object.entries(s.byPerson).forEach(([person, amount]) => {
    bp.appendChild(barRow(person, amount, (amount / maxPerson) * 100, person === 'Pola' ? 'var(--pola)' : 'var(--darek)'));
  });

  // Wg kategorii
  const bc = $('#byCategory');
  bc.innerHTML = '';
  if (!s.byCategory.length) {
    bc.innerHTML = '<div class="empty">Brak danych.</div>';
  } else {
    const maxCat = Math.max(1, ...s.byCategory.map((c) => c.amount));
    s.byCategory.forEach((c) => {
      bc.appendChild(barRow(c.category, c.amount, (c.amount / maxCat) * 100, 'var(--primary)'));
    });
  }
}

function barRow(label, amount, pct, color) {
  const row = document.createElement('div');
  row.className = 'bar-row';
  row.innerHTML = `
    <div class="bar-label">${escapeHtml(label)}</div>
    <div class="bar-amount">${fmt(amount)}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, pct)}%;background:${color}"></div></div>
  `;
  return row;
}

$('#monthPicker').addEventListener('change', async (e) => {
  curMonth = e.target.value;
  await Promise.all([loadExpenses(), loadSummary()]);
});

// ---------- Oszczędności ----------
$$('.quick').forEach((b) => {
  b.addEventListener('click', () => {
    const input = $('#savAmount');
    let v = input.value.replace(',', '.').replace(/[+-]/g, '').trim();
    input.value = (b.dataset.sign === '-' ? '-' : '') + v;
    input.focus();
  });
});

$('#savingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#savError');
  err.classList.add('hidden');
  const body = {
    amount: $('#savAmount').value,
    date: $('#savDate').value,
    person: selSavPerson,
    label: $('#savLabel').value,
  };
  try {
    await api('/savings', { method: 'POST', body: JSON.stringify(body) });
    $('#savAmount').value = '';
    $('#savLabel').value = '';
    await Promise.all([loadSavingReport(), loadSavings()]);
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove('hidden');
  }
});

async function loadSavingReport() {
  const rep = await api('/savings/report');
  const wrap = $('#tracks');
  wrap.innerHTML = '';
  rep.tracks.forEach((t) => {
    const el = document.createElement('div');
    el.className = 'track ' + t.person;
    const balCls = t.balance < 0 ? 'neg' : t.balance > 0 ? 'pos' : '';
    const badge = t.inDebt
      ? '<span class="track-badge debt">Na minusie</span>'
      : t.balance > 0
        ? '<span class="track-badge ok">Odłożone</span>'
        : '';
    el.innerHTML = `
      <div class="track-name">${escapeHtml(t.person)}</div>
      <div class="track-balance ${balCls}">${fmt(t.balance)}</div>
      ${badge}
      <div class="track-meta">
        <div><span class="k">Spłacono długu</span><span>${fmt(t.debtPaid)}</span></div>
        <div><span class="k">Odłożono</span><span>${fmt(t.saved)}</span></div>
        <div><span class="k">Wpłaty razem</span><span>${fmt(t.deposits)}</span></div>
        <div><span class="k">Wypłaty razem</span><span>${fmt(t.withdrawals)}</span></div>
      </div>
    `;
    wrap.appendChild(el);
  });
}

async function loadSavings() {
  const q = savFilter ? '?person=' + encodeURIComponent(savFilter) : '';
  const rows = await api('/savings' + q);
  const list = $('#savingList');
  if (!rows.length) {
    list.innerHTML = '<div class="empty">Brak wpisów. Dodaj pierwszy powyżej.</div>';
    return;
  }
  list.innerHTML = '';
  rows.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'item';
    const cls = r.amount < 0 ? 'neg' : 'pos';
    const sign = r.amount > 0 ? '+' : '';
    item.innerHTML = `
      <div class="item-main">
        <div class="item-title">
          <span class="tag person-${r.person}">${escapeHtml(r.person)}</span>
          ${r.label ? escapeHtml(r.label) : (r.amount < 0 ? 'Wypłata / dług' : 'Odłożenie / spłata')}
        </div>
        <div class="item-sub">${dayLabel(r.date)}</div>
      </div>
      <div class="item-amount ${cls}">${sign}${fmt(r.amount)}</div>
    `;
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '🗑';
    del.addEventListener('click', async () => {
      if (!confirm('Usunąć ten wpis?')) return;
      await api('/savings/' + r.id, { method: 'DELETE' });
      await Promise.all([loadSavingReport(), loadSavings()]);
    });
    item.appendChild(del);
    list.appendChild(item);
  });
}

function buildSavFilter() {
  const wrap = $('#savFilter');
  wrap.innerHTML = '';
  const opts = [['', 'Wszyscy']].concat(PEOPLE.map((p) => [p, p]));
  opts.forEach(([val, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg' + (val === savFilter ? ' active' : '');
    if (val) b.dataset.person = val;
    b.textContent = label;
    b.addEventListener('click', async () => {
      savFilter = val;
      $$('.seg', wrap).forEach((s) => s.classList.remove('active'));
      b.classList.add('active');
      await loadSavings();
    });
    wrap.appendChild(b);
  });
}

// ---------- util ----------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ---------- Bootstrap ----------
async function boot() {
  showApp();
  PEOPLE = await api('/people');
  selExpPerson = selExpPerson || PEOPLE[0];
  selSavPerson = selSavPerson || PEOPLE[0];

  buildPersonSeg($('#expPerson'), (p) => { selExpPerson = p; }, selExpPerson);
  buildPersonSeg($('#savPerson'), (p) => { selSavPerson = p; }, selSavPerson);
  $$('.seg[data-fund]').forEach((s) => s.classList.toggle('active', s.dataset.fund === selExpFund));
  buildSavFilter();

  $('#expDate').value = todayISO();
  $('#savDate').value = todayISO();

  $('#whoami').classList.add('hidden');
  await loadCategories();
  await Promise.all([loadExpenses(), loadSummary(), loadSavingReport(), loadSavings()]);
}

async function init() {
  try {
    const st = await api('/auth/status');
    $('#logoutBtn').classList.toggle('hidden', !st.enabled);
    if (st.authed) {
      await boot();
    } else {
      showLogin();
    }
  } catch (_) {
    showLogin();
  }
}

// Service worker (PWA)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
