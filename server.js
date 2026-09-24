'use strict';

const path = require('path');
const express = require('express');
const store = require('./lib/store');
const auth = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// --- Autoryzacja (wspólny PIN) --------------------------------------------

app.get('/api/auth/status', (req, res) => {
  res.json({ enabled: auth.enabled, authed: auth.isAuthed(req) });
});

app.post('/api/auth/login', (req, res) => {
  const pin = (req.body && req.body.pin) || '';
  if (auth.checkPin(pin)) {
    auth.setAuthCookie(res);
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Nieprawidłowy PIN' });
});

app.post('/api/auth/logout', (req, res) => {
  auth.clearAuthCookie(res);
  res.json({ ok: true });
});

// Brama chroniąca API danych.
function requireAuth(req, res, next) {
  if (auth.isAuthed(req)) return next();
  return res.status(401).json({ error: 'Wymagane logowanie' });
}

// --- Helpery ---------------------------------------------------------------

function toAmount(v) {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? store.round2(n) : NaN;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isValidPerson(p) {
  return store.db.people.includes(p);
}

// --- Kategorie -------------------------------------------------------------

app.get('/api/categories', requireAuth, (req, res) => {
  res.json(store.db.categories);
});

app.post('/api/categories', requireAuth, (req, res) => {
  const name = (req.body && String(req.body.name || '').trim()) || '';
  if (!name) return res.status(400).json({ error: 'Podaj nazwę kategorii' });
  if (store.db.categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Taka kategoria już istnieje' });
  }
  store.db.categories.push(name);
  store.persist();
  res.status(201).json(store.db.categories);
});

app.delete('/api/categories/:name', requireAuth, (req, res) => {
  const name = req.params.name;
  const idx = store.db.categories.findIndex((c) => c === name);
  if (idx < 0) return res.status(404).json({ error: 'Nie znaleziono kategorii' });
  store.db.categories.splice(idx, 1);
  store.persist();
  res.json(store.db.categories);
});

// --- Osoby -----------------------------------------------------------------

app.get('/api/people', requireAuth, (req, res) => {
  res.json(store.db.people);
});

// --- Wydatki ---------------------------------------------------------------

app.get('/api/expenses', requireAuth, (req, res) => {
  const { month, person, fund, category } = req.query;
  let rows = store.db.expenses.slice();
  if (month) rows = rows.filter((e) => e.date && e.date.startsWith(month)); // YYYY-MM
  if (person) rows = rows.filter((e) => e.person === person);
  if (fund) rows = rows.filter((e) => e.fund === fund);
  if (category) rows = rows.filter((e) => e.category === category);
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1)));
  res.json(rows);
});

app.post('/api/expenses', requireAuth, (req, res) => {
  const b = req.body || {};
  const amount = toAmount(b.amount);
  const person = String(b.person || '').trim();
  const category = String(b.category || '').trim();
  const fund = b.fund === 'wlasne' ? 'wlasne' : 'wspolne';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : todayISO();
  const note = String(b.note || '').trim().slice(0, 500);

  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Kwota musi być większa od zera' });
  if (!isValidPerson(person)) return res.status(400).json({ error: 'Wybierz osobę' });
  if (!category) return res.status(400).json({ error: 'Wybierz kategorię' });

  const row = {
    id: store.id(),
    date,
    category,
    amount,
    person,
    fund, // 'wspolne' (wspólne konto) albo 'wlasne' (prywatne)
    note,
    createdAt: new Date().toISOString(),
  };
  store.db.expenses.push(row);
  store.persist();
  res.status(201).json(row);
});

app.delete('/api/expenses/:id', requireAuth, (req, res) => {
  const idx = store.db.expenses.findIndex((e) => e.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Nie znaleziono wpisu' });
  const [removed] = store.db.expenses.splice(idx, 1);
  store.persist();
  res.json(removed);
});

// Podsumowanie wydatków (opcjonalnie za dany miesiąc YYYY-MM).
app.get('/api/summary', requireAuth, (req, res) => {
  const { month } = req.query;
  let rows = store.db.expenses.slice();
  if (month) rows = rows.filter((e) => e.date && e.date.startsWith(month));

  const total = store.round2(rows.reduce((s, e) => s + e.amount, 0));

  const byCategory = {};
  const byPerson = {};
  const byFund = { wspolne: 0, wlasne: 0 };
  for (const p of store.db.people) byPerson[p] = 0;

  for (const e of rows) {
    byCategory[e.category] = store.round2((byCategory[e.category] || 0) + e.amount);
    byPerson[e.person] = store.round2((byPerson[e.person] || 0) + e.amount);
    byFund[e.fund] = store.round2((byFund[e.fund] || 0) + e.amount);
  }

  const categoriesSorted = Object.entries(byCategory)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  // Lista dostępnych miesięcy (do przełącznika w UI).
  const months = Array.from(new Set(store.db.expenses.map((e) => (e.date || '').slice(0, 7)).filter(Boolean))).sort().reverse();

  res.json({
    month: month || null,
    total,
    count: rows.length,
    byCategory: categoriesSorted,
    byPerson,
    byFund,
    months,
  });
});

// --- Oszczędności ----------------------------------------------------------

app.get('/api/savings', requireAuth, (req, res) => {
  const { person } = req.query;
  let rows = store.db.savings.slice();
  if (person) rows = rows.filter((s) => s.person === person);
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1)));
  res.json(rows);
});

app.post('/api/savings', requireAuth, (req, res) => {
  const b = req.body || {};
  const amount = toAmount(b.amount); // może być ujemny (minus = dług / wypłata)
  const person = String(b.person || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : todayISO();
  const label = String(b.label || '').trim().slice(0, 200);

  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'Podaj kwotę (dodatnią lub ujemną)' });
  if (!isValidPerson(person)) return res.status(400).json({ error: 'Wybierz tor (osobę)' });

  const row = {
    id: store.id(),
    date,
    person,
    amount,
    label,
    createdAt: new Date().toISOString(),
  };
  store.db.savings.push(row);
  store.persist();
  res.status(201).json(row);
});

app.delete('/api/savings/:id', requireAuth, (req, res) => {
  const idx = store.db.savings.findIndex((s) => s.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Nie znaleziono wpisu' });
  const [removed] = store.db.savings.splice(idx, 1);
  store.persist();
  res.json(removed);
});

// Raport oszczędności per tor: saldo, wpłaty, wypłaty, ile spłacono długu, ile odłożono.
// Metoda: idziemy chronologicznie i każdą DODATNIĄ wpłatę dzielimy na część,
// która zeruje dług (saldo < 0), oraz część, która buduje oszczędności (saldo > 0).
function reportFor(person) {
  const rows = store.db.savings
    .filter((s) => s.person === person)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt < b.createdAt ? -1 : 1)));

  let balance = 0;
  let deposits = 0; // suma dodatnich ruchów
  let withdrawals = 0; // suma ujemnych ruchów (jako wartość dodatnia)
  let debtPaid = 0; // ile poszło na spłatę długu (saldo poniżej zera)
  let saved = 0; // ile netto zbudowano oszczędności ponad zero

  for (const r of rows) {
    const a = r.amount;
    if (a >= 0) {
      deposits = store.round2(deposits + a);
      if (balance < 0) {
        const toDebt = Math.min(a, -balance);
        debtPaid = store.round2(debtPaid + toDebt);
        const rest = a - toDebt;
        if (rest > 0) saved = store.round2(saved + rest);
      } else {
        saved = store.round2(saved + a);
      }
    } else {
      withdrawals = store.round2(withdrawals + -a);
      // Wypłata najpierw uszczupla odłożone oszczędności.
      if (balance > 0) {
        const fromSaved = Math.min(-a, balance);
        saved = store.round2(saved - fromSaved);
      }
    }
    balance = store.round2(balance + a);
  }

  return {
    person,
    balance,
    deposits,
    withdrawals,
    debtPaid, // "ile się spłaciło"
    saved: store.round2(Math.max(0, saved)), // "ile się odłożyło"
    inDebt: balance < 0,
    count: rows.length,
  };
}

app.get('/api/savings/report', requireAuth, (req, res) => {
  const tracks = store.db.people.map((p) => reportFor(p));
  const totals = {
    balance: store.round2(tracks.reduce((s, t) => s + t.balance, 0)),
    debtPaid: store.round2(tracks.reduce((s, t) => s + t.debtPaid, 0)),
    saved: store.round2(tracks.reduce((s, t) => s + t.saved, 0)),
  };
  res.json({ tracks, totals });
});

// --- Frontend --------------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Fallback do SPA (poza /api).
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Wydatki działa na porcie ${PORT} (PIN: ${auth.enabled ? 'wymagany' : 'WYŁĄCZONY'})`);
});
