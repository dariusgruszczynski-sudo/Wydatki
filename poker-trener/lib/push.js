const webpush = require('web-push');
const db = require('./db');
const { dayKey, timeOfDay } = require('./time');
const { loadProfile } = require('./auth');
const G = require('./gamification');

function vapidKeys() {
  let pub = db.getMeta('vapid_public');
  let priv = db.getMeta('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey;
    priv = k.privateKey;
    db.setMeta('vapid_public', pub);
    db.setMeta('vapid_private', priv);
  }
  return { pub, priv };
}

const { pub, priv } = vapidKeys();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:poker-trener@localhost', pub, priv);

function publicKey() {
  return pub;
}

function subscribe(profileId, sub) {
  if (!sub || !sub.endpoint || !sub.keys) throw new Error('Nieprawidłowa subskrypcja.');
  db.prepare(
    `INSERT INTO push_subs (profile_id, endpoint, keys_json, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET profile_id = excluded.profile_id, keys_json = excluded.keys_json`
  ).run(profileId, sub.endpoint, JSON.stringify(sub.keys), new Date().toISOString());
}

function unsubscribe(endpoint) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}

async function send(row, payload) {
  try {
    await webpush.sendNotification({ endpoint: row.endpoint, keys: JSON.parse(row.keys_json) }, JSON.stringify(payload));
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) unsubscribe(row.endpoint);
    return false;
  }
}

async function sendTest(profileId) {
  const rows = db.prepare('SELECT * FROM push_subs WHERE profile_id = ?').all(profileId);
  let ok = 0;
  for (const r of rows) if (await send(r, { title: 'Poker Trener', body: 'Powiadomienia działają! ♠️', url: '/' })) ok++;
  return { sent: ok, devices: rows.length };
}

async function tick() {
  const today = dayKey();
  const now = timeOfDay();
  const rows = db.prepare('SELECT * FROM push_subs WHERE last_notified_day IS NULL OR last_notified_day <> ?').all(today);
  for (const row of rows) {
    const profile = loadProfile(row.profile_id);
    if (!profile || !profile.settings.reminders) continue;
    if (now < (profile.settings.reminderTime || '19:00')) continue;
    const st = G.streak(row.profile_id);
    if (st.today) continue;
    const body = st.current > 0 ? `Nie przerywaj serii ${st.current} dni — 10 minut treningu wystarczy.` : 'Kilka spotów push/fold dziennie robi różnicę. Wpadnij na trening!';
    await send(row, { title: `♠️ ${profile.name}, czas na trening`, body, url: '/#/start' });
    db.prepare('UPDATE push_subs SET last_notified_day = ? WHERE id = ?').run(today, row.id);
  }
}

function startScheduler() {
  setInterval(() => tick().catch((e) => console.error('push tick:', e.message)), 5 * 60 * 1000).unref();
}

module.exports = { publicKey, subscribe, unsubscribe, sendTest, startScheduler };
