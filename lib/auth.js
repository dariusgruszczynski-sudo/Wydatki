'use strict';

const crypto = require('crypto');

// Logowanie per-osoba: każda osoba ma własny PIN. Zalogowany PIN identyfikuje
// osobę, więc aplikacja może podstawić konto (np. przy dodawaniu wydatku).
//
// PIN-y ustawiasz zmiennymi środowiskowymi:
//   PIN_DAREK (domyślnie 1991)
//   PIN_POLA  (domyślnie 1992)
// Zgodność wstecz: jeśli ustawisz APP_PIN, działa jako wspólny PIN dla obu osób.

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'wydatki_auth';
const MAX_AGE_DAYS = Number(process.env.SESSION_DAYS || 30);

// Mapa osoba -> PIN.
const PINS = {
  Darek: process.env.PIN_DAREK || process.env.APP_PIN || '1991',
  Pola: process.env.PIN_POLA || process.env.APP_PIN || '1992',
};

const enabled = Object.values(PINS).some((p) => p && p.length > 0);

function tokenFor(person) {
  return crypto.createHmac('sha256', SECRET).update('authorized:v2:' + person).digest('hex');
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

// Zwraca osobę zalogowaną na podstawie ciasteczka, albo null.
function currentPerson(req) {
  if (!enabled) return 'Darek'; // tryb otwarty — domyślna osoba
  const cookies = parseCookies(req);
  const val = cookies[COOKIE] || '';
  const sep = val.indexOf('|');
  if (sep < 0) return null;
  const person = val.slice(0, sep);
  const tok = val.slice(sep + 1);
  if (PINS[person] && timingSafeEqual(tok, tokenFor(person))) return person;
  return null;
}

function isAuthed(req) {
  return currentPerson(req) !== null;
}

function setAuthCookie(res, person) {
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60;
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  const val = encodeURIComponent(person + '|' + tokenFor(person));
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Zwraca osobę pasującą do PIN-u, albo null.
function personForPin(pin) {
  for (const [person, p] of Object.entries(PINS)) {
    if (p && timingSafeEqual(pin || '', p)) return person;
  }
  return null;
}

module.exports = {
  enabled,
  isAuthed,
  currentPerson,
  setAuthCookie,
  clearAuthCookie,
  personForPin,
};
