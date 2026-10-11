const TZ = process.env.TZ_APP || 'Europe/Warsaw';

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

function dayKey(d = new Date()) {
  return dayFmt.format(new Date(d));
}

function hourOf(d) {
  return Number(hourFmt.format(new Date(d))) % 24;
}

function timeOfDay(d = new Date()) {
  return timeFmt.format(new Date(d));
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekStart(d = new Date()) {
  const day = dayKey(d);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

// Zakres UTC odpowiadający lokalnym dniom [fromDay, toDay) — z zapasem na strefę.
function utcRangeForDays(fromDay, toDayExclusive) {
  return [`${addDays(fromDay, -1)}T00:00:00.000Z`, `${addDays(toDayExclusive, 1)}T00:00:00.000Z`];
}

module.exports = { TZ, dayKey, hourOf, timeOfDay, addDays, weekStart, utcRangeForDays };
