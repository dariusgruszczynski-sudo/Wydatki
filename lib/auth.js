'use strict';

const crypto = require('crypto');

// Lekkie logowanie wspólnym PIN-em, bez zewnętrznych zależności.
// PIN ustawiasz w zmiennej środowiskowej APP_PIN. Jeśli nie ustawisz —
// aplikacja jest otwarta (wygodne przy testach lokalnych, NIE na publicznym IP).

const PIN = process.env.APP_PIN || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'wydatki_auth';
const MAX_AGE_DAYS = Number(process.env.SESSION_DAYS || 30);

function token() {
  // Token nie zawiera PIN-u; to podpis HMAC znanej wartości sekretem serwera.
  return crypto.createHmac('sha256', SECRET).update('authorized:v1').digest('hex');
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

const enabled = PIN.length > 0;

function isAuthed(req) {
  if (!enabled) return true;
  const cookies = parseCookies(req);
  return cookies[COOKIE] && timingSafeEqual(cookies[COOKIE], token());
}

function setAuthCookie(res) {
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60;
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function checkPin(pin) {
  if (!enabled) return true;
  return timingSafeEqual(pin || '', PIN);
}

module.exports = {
  enabled,
  isAuthed,
  setAuthCookie,
  clearAuthCookie,
  checkPin,
};
