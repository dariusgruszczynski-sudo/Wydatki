'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Prosty, bezzależnościowy magazyn danych oparty na pliku JSON.
// W zupełności wystarcza dla aplikacji dla 2 osób (mały wolumen, jeden proces).
// Zapis jest atomowy (zapis do pliku tymczasowego + rename).

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_CATEGORIES = [
  'Spożywcze',
  'Chemia / Higiena',
  'Dom',
  'Restauracje / Na mieście',
  'Transport / Paliwo',
  'Rachunki',
  'Zdrowie / Apteka',
  'Rozrywka',
  'Ubrania',
  'Dzieci',
  'Zwierzęta',
  'Prezenty',
  'Podróże',
  'Inne',
];

// Dwa stałe "tory" — zgodnie z wymaganiem (Darek i Pola).
const PEOPLE = ['Darek', 'Pola'];

function emptyDb() {
  return {
    categories: DEFAULT_CATEGORIES.slice(),
    people: PEOPLE.slice(),
    expenses: [], // { id, date, category, amount, person, fund: 'wspolne'|'wlasne', note, recurringId?, auto? }
    savings: [], // { id, date, person, amount, label } — amount może być ujemny
    recurring: [], // { id, name, amount, category, person, fund, dayOfMonth, startMonth, active, note, lastPostedMonth }
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
      if (!Array.isArray(db.categories) || db.categories.length === 0) db.categories = DEFAULT_CATEGORIES.slice();
      if (!Array.isArray(db.people) || db.people.length === 0) db.people = PEOPLE.slice();
      if (!Array.isArray(db.expenses)) db.expenses = [];
      if (!Array.isArray(db.savings)) db.savings = [];
      if (!Array.isArray(db.recurring)) db.recurring = [];
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
  load,
  persist,
  id,
  round2,
  get db() {
    return load();
  },
};
