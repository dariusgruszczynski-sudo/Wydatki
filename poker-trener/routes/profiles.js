const express = require('express');
const db = require('../lib/db');
const Auth = require('../lib/auth');
const { h, httpError } = require('./util');

const router = express.Router();

router.get('/profiles', h(() => db.prepare('SELECT id, name, avatar, pin_hash IS NOT NULL AS hasPin FROM profiles ORDER BY id').all().map((p) => ({ ...p, hasPin: !!p.hasPin }))));

router.post('/profiles', h((req, res) => {
  const anyPin = db.prepare('SELECT 1 FROM profiles WHERE pin_hash IS NOT NULL LIMIT 1').get();
  if (anyPin && !req.profile) throw httpError(403, 'Nowy profil może dodać tylko zalogowany gracz.');
  const name = String(req.body?.name || '').trim().slice(0, 30);
  if (!name) throw httpError(400, 'Podaj nazwę profilu.');
  const pin = req.body?.pin ? String(req.body.pin) : null;
  if (pin && !/^\d{4,8}$/.test(pin)) throw httpError(400, 'PIN: 4–8 cyfr.');
  try {
    const r = db
      .prepare('INSERT INTO profiles (name, pin_hash, avatar, created_at) VALUES (?, ?, ?, ?)')
      .run(name, pin ? Auth.hashPin(pin) : null, String(req.body?.avatar || '🃏').slice(0, 8), new Date().toISOString());
    const id = Number(r.lastInsertRowid);
    if (!req.profile) Auth.setSessionCookie(res, id);
    return Auth.loadProfile(id);
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw httpError(409, 'Taki profil już istnieje.');
    throw e;
  }
}));

router.post('/profiles/login', h((req, res) => {
  const ip = req.ip;
  if (!Auth.loginAllowed(ip)) throw httpError(429, 'Za dużo prób — odczekaj chwilę.');
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(Number(req.body?.id));
  if (!row) throw httpError(404, 'Nie ma takiego profilu.');
  if (!Auth.verifyPin(req.body?.pin, row.pin_hash)) {
    Auth.loginFailed(ip);
    throw httpError(401, 'Zły PIN.');
  }
  Auth.loginOk(ip);
  Auth.setSessionCookie(res, row.id);
  return Auth.loadProfile(row.id);
}));

router.post('/profiles/logout', h((req, res) => {
  Auth.clearSessionCookie(res);
  return { ok: true };
}));

router.get('/me', h((req) => {
  if (!req.profile) throw httpError(401, 'Niezalogowany.');
  return req.profile;
}));

router.put('/me', Auth.requireProfile, h((req) => {
  const name = req.body?.name != null ? String(req.body.name).trim().slice(0, 30) : null;
  const avatar = req.body?.avatar != null ? String(req.body.avatar).slice(0, 8) : null;
  if (name === '') throw httpError(400, 'Nazwa nie może być pusta.');
  try {
    if (name) db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(name, req.profile.id);
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw httpError(409, 'Taka nazwa jest zajęta.');
    throw e;
  }
  if (avatar) db.prepare('UPDATE profiles SET avatar = ? WHERE id = ?').run(avatar, req.profile.id);
  return Auth.loadProfile(req.profile.id);
}));

router.put('/me/pin', Auth.requireProfile, h((req) => {
  const row = db.prepare('SELECT pin_hash FROM profiles WHERE id = ?').get(req.profile.id);
  if (row.pin_hash && !Auth.verifyPin(req.body?.currentPin, row.pin_hash)) throw httpError(401, 'Obecny PIN jest nieprawidłowy.');
  const pin = req.body?.newPin ? String(req.body.newPin) : null;
  if (pin && !/^\d{4,8}$/.test(pin)) throw httpError(400, 'PIN: 4–8 cyfr.');
  db.prepare('UPDATE profiles SET pin_hash = ? WHERE id = ?').run(pin ? Auth.hashPin(pin) : null, req.profile.id);
  return { ok: true, hasPin: !!pin };
}));

router.put('/me/settings', Auth.requireProfile, h((req) => {
  const allowed = Object.keys(Auth.DEFAULT_SETTINGS);
  const patch = {};
  for (const [k, v] of Object.entries(req.body || {})) if (allowed.includes(k)) patch[k] = v;
  return Auth.saveSettings(req.profile.id, patch);
}));

module.exports = router;
