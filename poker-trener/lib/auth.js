const crypto = require('crypto');
const db = require('./db');

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = db.getMeta('session_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    db.setMeta('session_secret', s);
  }
  return s;
}

const SECRET = sessionSecret();
const COOKIE = 'pt_profile';
const COOKIE_DAYS = Number(process.env.SESSION_DAYS || 60);

const DEFAULT_SETTINGS = {
  theme: 'premium',
  fourColor: false,
  sound: true,
  vibration: true,
  autoNext: false,
  autoNextDelay: 2500,
  confidence: true,
  speedMs: 0,
  mode: 'gto',
  difficulty: 'normal',
  anteMode: 'bb_ante',
  formatFocus: 'mix',
  adaptive: true,
  freeMode: false,
  filters: { types: [], heroPositions: [], stackRange: [3, 25], stage: 'any', numPlayers: [2, 9] },
  reminderTime: '19:00',
  reminders: false,
  startingBankroll: 1000,
  bankrollRule: 100,
};

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPin(pin, stored) {
  if (!stored) return true;
  const [, salt, hash] = stored.split('$');
  const test = crypto.scryptSync(String(pin || ''), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(String(value)).digest('hex').slice(0, 32);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, profileId) {
  const value = `${profileId}.${sign(profileId)}`;
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_DAYS * 86400}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function loadProfile(id) {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!row) return null;
  let settings = {};
  try {
    settings = JSON.parse(row.settings || '{}');
  } catch {
    settings = {};
  }
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    hasPin: !!row.pin_hash,
    createdAt: row.created_at,
    virtualBankroll: row.virtual_bankroll,
    pathStage: row.path_stage,
    placementDone: !!row.placement_done,
    settings: { ...DEFAULT_SETTINGS, ...settings, filters: { ...DEFAULT_SETTINGS.filters, ...(settings.filters || {}) } },
  };
}

function attachProfile(req, res, next) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (raw) {
    const [id, sig] = raw.split('.');
    if (id && sig && sig.length === 32 && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(id)))) {
      req.profile = loadProfile(Number(id));
    }
  }
  next();
}

function requireProfile(req, res, next) {
  if (!req.profile) return res.status(401).json({ error: 'Zaloguj się na profil.' });
  next();
}

const attempts = new Map();

function loginAllowed(ip) {
  const a = attempts.get(ip);
  if (!a) return true;
  if (a.until && a.until > Date.now()) return false;
  return true;
}

function loginFailed(ip) {
  const a = attempts.get(ip) || { count: 0 };
  a.count++;
  if (a.count >= 5) {
    a.until = Date.now() + 60_000 * Math.min(15, a.count - 4);
  }
  attempts.set(ip, a);
}

function loginOk(ip) {
  attempts.delete(ip);
}

function saveSettings(profileId, patch) {
  const current = loadProfile(profileId).settings;
  const next = { ...current, ...patch };
  if (patch.filters) next.filters = { ...current.filters, ...patch.filters };
  db.prepare('UPDATE profiles SET settings = ? WHERE id = ?').run(JSON.stringify(next), profileId);
  return next;
}

module.exports = {
  DEFAULT_SETTINGS,
  hashPin,
  verifyPin,
  setSessionCookie,
  clearSessionCookie,
  loadProfile,
  attachProfile,
  requireProfile,
  loginAllowed,
  loginFailed,
  loginOk,
  saveSettings,
};
