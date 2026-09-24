'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Prosty, bezzależnościowy magazyn danych oparty na pliku JSON.
// W zupełności wystarcza dla aplikacji dla 2 osób (mały wolumen, jeden proces).
// Zapis jest atomowy (zapis do pliku tymczasowego + rename).

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Kategorie mają ikonę (emoji) — do szybkiego wyboru kafelkiem.
const DEFAULT_CATEGORIES = [
  { name: 'Jedzenie', icon: '🍽️' },
  { name: 'Spożywcze', icon: '🛒' },
  { name: 'Alkohol', icon: '🍺' },
  { name: 'Paliwo', icon: '⛽' },
  { name: 'Restauracje', icon: '🍕' },
  { name: 'Kawa', icon: '☕' },
  { name: 'Chemia', icon: '🧴' },
  { name: 'Dom', icon: '🏠' },
  { name: 'Rachunki', icon: '🧾' },
  { name: 'Zdrowie', icon: '💊' },
  { name: 'Rozrywka', icon: '🎬' },
  { name: 'Ubrania', icon: '👕' },
  { name: 'Transport', icon: '🚌' },
  { name: 'Auto', icon: '🚗' },
  { name: 'Dzieci', icon: '🧸' },
  { name: 'Zwierzęta', icon: '🐾' },
  { name: 'Prezenty', icon: '🎁' },
  { name: 'Podróże', icon: '✈️' },
  { name: 'Inne', icon: '📦' },
];

// Dwa stałe "tory" — zgodnie z wymaganiem (Darek i Pola).
const PEOPLE = ['Darek', 'Pola'];

function iconFor(name) {
  const found = DEFAULT_CATEGORIES.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
  return found ? found.icon : '🏷️';
}

// Normalizuje kategorię do postaci { name, icon }.
function normCat(c) {
  if (typeof c === 'string') return { name: c, icon: iconFor(c) };
  if (c && typeof c === 'object' && c.name) return { name: c.name, icon: c.icon || iconFor(c.name) };
  return null;
}

function emptyDb() {
  return {
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    people: PEOPLE.slice(),
    expenses: [], // { id, date, category, amount, person, fund: 'wspolne'|'wlasne', note, recurringId?, auto? }
    savings: [], // { id, date, person, amount, label } — amount może być ujemny
    recurring: [], // { id, name, amount, category, person, fund, dayOfMonth, startMonth, active, note, lastPostedMonth }
    savingsGoals: { Darek: 0, Pola: 0 }, // cel skarbonki per osoba (0 = brak)
    categoriesSeeded2: true,
  };
}

let db = null;

function load() {
  if (db) return db;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {
    /* ignore */
  }
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      db = Object.assign(emptyDb(), JSON.parse(raw));
      // Zapewnij spójność struktury po ewentualnych zmianach schematu.
      if (!Array.isArray(db.people) || db.people.length === 0) db.people = PEOPLE.slice();
      if (!Array.isArray(db.expenses)) db.expenses = [];
      if (!Array.isArray(db.savings)) db.savings = [];
      if (!Array.isArray(db.recurring)) db.recurring = [];
      if (!db.savingsGoals || typeof db.savingsGoals !== 'object') db.savingsGoals = { Darek: 0, Pola: 0 };
      for (const p of db.people) if (typeof db.savingsGoals[p] !== 'number') db.savingsGoals[p] = 0;

      // Migracja kategorii: stringi -> obiekty { name, icon }.
      if (!Array.isArray(db.categories) || db.categories.length === 0) {
        db.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
      } else {
        db.categories = db.categories.map(normCat).filter(Boolean);
      }
      // Jednorazowe dodanie brakujących kategorii domyślnych (z ikonami).
      if (!db.categoriesSeeded2) {
        const names = new Set(db.categories.map((c) => c.name.toLowerCase()));
        for (const dc of DEFAULT_CATEGORIES) {
          if (!names.has(dc.name.toLowerCase())) db.categories.push({ ...dc });
        }
        db.categoriesSeeded2 = true;
      }
      persist();
    } catch (e) {
      // Nie nadpisujemy uszkodzonego pliku — robimy kopię i startujemy pusto.
      const backup = DB_FILE + '.corrupt-' + Date.now();
      try { fs.copyFileSync(DB_FILE, backup); } catch (_) { /* ignore */ }
      db = emptyDb();
    }
  } else {
    db = emptyDb();
    persist();
  }
  return db;
}

function persist() {
  if (!db) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {
    /* ignore */
  }
  const tmp = DB_FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function id() {
  return crypto.randomBytes(9).toString('hex');
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = {
  DATA_DIR,
  DB_FILE,
  DEFAULT_CATEGORIES,
  PEOPLE,
  iconFor,
  normCat,
  load,
  persist,
  id,
  round2,
  get db() {
    return load();
  },
};
