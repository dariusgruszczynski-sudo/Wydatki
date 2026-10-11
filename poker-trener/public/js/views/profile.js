import { get, post, put } from '../api.js';
import { store, settings, saveSettings, loadProfile } from '../store.js';
import { esc, fmt, dateOnly, dateTime } from '../ui/dom.js';
import { errorToast, toast } from '../ui/overlay.js';
import { sound, vibrate } from '../ui/fx.js';

const TABS = [
  ['ustawienia', '⚙️ Ustawienia'],
  ['odznaki', '🏅 Odznaki'],
  ['cele', '🎯 Cele'],
  ['ranking', '🏆 Ranking'],
  ['konto', '👤 Profil i PIN'],
];
const GOALS = [['spots', 'Decyzje w trenerze'], ['accuracy', 'Trafność (%)'], ['lessons', 'Lekcje'], ['drills', 'Ćwiczenia podstaw'], ['review', 'Powtórki'], ['daily', 'Wyzwania dnia']];

function urlBase64ToUint8Array(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...b].map((c) => c.charCodeAt(0)));
}

async function settingsTab(box) {
  const s = settings();
  const tog = (k, label) => `<span class="chip ${s[k] ? 'on' : ''}" data-tog="${k}">${label}</span>`;
  box.innerHTML = `<div class="grid g2">
    <div class="panel"><h3>Wygląd</h3>
      <div class="chips mb" data-theme-pick>${[['premium', '🎰 Kasyno premium'], ['light', '☀️ Jasny'], ['contrast', '◐ Wysoki kontrast']].map(([k, l]) => `<span class="chip ${s.theme === k ? 'on' : ''}" data-t="${k}">${l}</span>`).join('')}</div>
      <div class="chips">${tog('fourColor', '🂡 Talia 4-kolorowa')}${tog('sound', '🔊 Dźwięki')}${tog('vibration', '📳 Wibracje')}</div>
      <div class="row mt"><button class="btn sm" id="tsound">Test dźwięku</button><button class="btn sm" id="tvib">Test wibracji</button></div></div>
    <div class="panel"><h3>Trening</h3>
      <div class="chips">${tog('autoNext', '⏭️ Seria (auto-następny)')}${tog('confidence', '🎚️ Pytaj o pewność')}${tog('adaptive', '🎯 Adaptacja do słabych punktów')}${tog('freeMode', '🔓 Tryb swobodny (bez blokad ścieżki)')}</div>
      <label class="field mt">Opóźnienie serii<select class="inp" id="delay">${[1500, 2500, 4000, 6000].map((v) => `<option value="${v}" ${Number(s.autoNextDelay) === v ? 'selected' : ''}>${v / 1000} s</option>`).join('')}</select></label>
      <p class="small muted mt">Filtry, format, tryb GTO/eksploatacji i trudność ustawisz w <a href="#/trening/standard">trenerze</a>.</p></div>
    <div class="panel"><h3>Przypomnienia o treningu</h3>
      <p class="small muted">Powiadomienie push, jeśli danego dnia jeszcze nie trenowałeś. Wymaga HTTPS (domena z certyfikatem) — na adresie IP:port przeglądarki blokują powiadomienia.</p>
      <div class="row"><label class="field">Godzina<input class="inp" type="time" id="rt" value="${esc(s.reminderTime)}"></label>${tog('reminders', '🔔 Włączone')}</div>
      <div class="row mt"><button class="btn sm" id="sub">Zezwól na tym urządzeniu</button><button class="btn sm" id="test">Wyślij test</button></div><div class="small mt" id="pushres"></div></div>
    <div class="panel"><h3>Instalacja na telefonie</h3><p class="small muted">Android (Chrome): menu ⋮ → „Zainstaluj aplikację”. iPhone (Safari): Udostępnij → „Do ekranu początkowego”. Aplikacja działa wtedy jak natywna, z ikoną i bez paska przeglądarki; podstawowe ekrany ładują się także offline.</p></div>
  </div>`;
  const save = async (patch) => {
    try {
      await saveSettings(patch);
    } catch (e) {
      errorToast(e);
    }
  };
  box.onclick = async (e) => {
    const t = e.target.closest('[data-t]');
    if (t) {
      box.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === t));
      save({ theme: t.dataset.t });
    }
    const g = e.target.closest('[data-tog]');
    if (g) {
      g.classList.toggle('on');
      save({ [g.dataset.tog]: g.classList.contains('on') });
    }
  };
  box.querySelector('#delay').onchange = (e) => save({ autoNextDelay: Number(e.target.value) });
  box.querySelector('#rt').onchange = (e) => save({ reminderTime: e.target.value });
  box.querySelector('#tsound').onclick = () => sound('level');
  box.querySelector('#tvib').onclick = () => vibrate([80, 50, 80]);
  const res = box.querySelector('#pushres');
  box.querySelector('#sub').onclick = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Ta przeglądarka nie obsługuje powiadomień push.');
      if (!window.isSecureContext) throw new Error('Powiadomienia wymagają HTTPS (domena z certyfikatem).');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Brak zgody na powiadomienia.');
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await get('/push/key');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await post('/push/subscribe', { subscription: sub.toJSON() });
      await save({ reminders: true });
      res.innerHTML = '<span class="ok">✅ Urządzenie zapisane.</span>';
    } catch (e) {
      res.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
    }
  };
  box.querySelector('#test').onclick = async () => {
    const r = await post('/push/test');
    res.textContent = `Wysłano na ${r.sent} z ${r.devices} urządzeń.`;
  };
}

async function achievementsTab(box) {
  const [list, xp] = await Promise.all([get('/achievements'), get('/xp/history')]);
  const got = list.filter((a) => a.awardedAt).length;
  box.innerHTML = `<div class="panel mb"><b>${got}/${list.length}</b> odznak zdobytych<div class="bar mt"><i style="width:${(got / list.length) * 100}%"></i></div></div>
    <div class="grid g3">${list.map((a) => `<div class="ach ${a.awardedAt ? 'on' : ''}"><span class="i">${a.icon}</span><div><b>${esc(a.label)}</b><div class="small muted">${esc(a.desc)}</div>${a.awardedAt ? `<div class="tiny gold">${dateOnly(a.awardedAt)}</div>` : ''}</div></div>`).join('')}</div>
    <div class="panel mt"><h3>Ostatnie XP</h3><div class="list">${xp.slice(0, 20).map((x) => `<div class="item small"><span>${esc(x.reason)}</span><span class="muted">${dateTime(x.created_at)}</span><b class="gold">+${x.amount}</b></div>`).join('')}</div></div>`;
}

async function goalsTab(box) {
  const g = await get('/goals');
  const by = Object.fromEntries(g.goals.map((x) => [x.kind, x]));
  box.innerHTML = `<div class="panel"><h3>Cele na tydzień od ${g.weekStart}</h3><p class="small muted">Ustaw 0, żeby usunąć cel. Nowe cele domyślne pojawiają się co poniedziałek.</p>
    <div class="grid g3">${GOALS.map(([k, l]) => {
      const x = by[k];
      return `<div class="stat" style="text-align:left"><b>${l}</b><input class="inp mt" type="number" min="0" data-g="${k}" value="${x ? x.target : 0}">${x ? `<div class="bar mt ${x.done ? 'green' : ''}"><i style="width:${Math.min(100, (x.value / x.target) * 100)}%"></i></div><div class="tiny muted">${fmt(x.value)} / ${fmt(x.target)} ${x.done ? '✅' : ''}</div>` : ''}</div>`;
    }).join('')}</div><button class="btn gold mt" id="save">Zapisz cele</button></div>`;
  box.querySelector('#save').onclick = async () => {
    const body = {};
    box.querySelectorAll('[data-g]').forEach((i) => (body[i.dataset.g] = Number(i.value)));
    await put('/goals', body);
    toast('Zapisano cele', 'ok');
    goalsTab(box);
  };
}

async function rankingTab(box) {
  const lb = await get('/leaderboard');
  box.innerHTML = `<div class="panel"><h3>Ranking profili (ten tydzień)</h3><div class="scroll-x"><table class="tbl"><thead><tr><th>#</th><th>Gracz</th><th>XP tydzień</th><th>Poziom</th><th>Seria</th><th>Trafność 7 dni</th><th>Wyzwanie dziś</th></tr></thead><tbody>${lb
    .map((p, i) => `<tr class="${p.id === store.profile.id ? 'gold' : ''}"><td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td><td>${esc(p.avatar)} ${esc(p.name)}</td><td><b>${fmt(p.weekXp)}</b></td><td>${p.level.level} · ${esc(p.level.name)}</td><td>🔥 ${p.streak}</td><td>${p.accuracy7d == null ? '—' : p.accuracy7d + '%'} <span class="tiny muted">(${p.spots7d})</span></td><td>${p.dailyToday || '—'}</td></tr>`)
    .join('')}</tbody></table></div><p class="small muted mt">Dodaj kolejny profil (np. dla znajomego) w zakładce „Profil i PIN”, żeby rywalizować.</p></div>`;
}

async function accountTab(box) {
  const p = store.profile;
  box.innerHTML = `<div class="grid g2">
    <div class="panel"><h3>Twój profil</h3><label class="field">Nazwa<input class="inp" id="nm" value="${esc(p.name)}"></label><label class="field mt">Awatar (emoji)<input class="inp" id="av" value="${esc(p.avatar)}" maxlength="4"></label><button class="btn gold mt" id="sv">Zapisz</button></div>
    <div class="panel"><h3>PIN</h3><p class="small muted">${p.hasPin ? 'Profil chroniony PIN-em.' : '⚠️ Profil bez PIN-u — każdy z dostępem do adresu może z niego korzystać (także z Coach AI). Ustaw PIN.'}</p>
      ${p.hasPin ? '<label class="field">Obecny PIN<input class="inp" id="cp" type="password" inputmode="numeric"></label>' : ''}
      <label class="field mt">Nowy PIN (4–8 cyfr, puste = usuń)<input class="inp" id="np" type="password" inputmode="numeric"></label><button class="btn mt" id="pin">Zmień PIN</button></div>
    <div class="panel"><h3>Nowy profil</h3><p class="small muted">Np. dla partnerki/partnera albo znajomego — osobne statystyki, wspólny ranking.</p><label class="field">Nazwa<input class="inp" id="pn"></label><label class="field mt">PIN (opcjonalnie)<input class="inp" id="pp" type="password" inputmode="numeric"></label><button class="btn mt" id="new">Utwórz</button></div>
    <div class="panel"><h3>Sesja</h3><button class="btn danger" id="out">Wyloguj</button></div></div>`;
  box.querySelector('#sv').onclick = async () => {
    try {
      await put('/me', { name: box.querySelector('#nm').value, avatar: box.querySelector('#av').value });
      await loadProfile();
      toast('Zapisano', 'ok');
    } catch (e) {
      errorToast(e);
    }
  };
  box.querySelector('#pin').onclick = async () => {
    try {
      await put('/me/pin', { currentPin: box.querySelector('#cp')?.value, newPin: box.querySelector('#np').value });
      await loadProfile();
      toast('PIN zmieniony', 'ok');
      accountTab(box);
    } catch (e) {
      errorToast(e);
    }
  };
  box.querySelector('#new').onclick = async () => {
    try {
      await post('/profiles', { name: box.querySelector('#pn').value, pin: box.querySelector('#pp').value || null });
      toast('Profil utworzony — przełączysz się na ekranie logowania', 'ok');
    } catch (e) {
      errorToast(e);
    }
  };
  box.querySelector('#out').onclick = async () => {
    await post('/profiles/logout');
    store.profile = null;
    location.hash = '#/login';
    location.reload();
  };
}

export default {
  async render(root, { parts }) {
    const tab = TABS.find((t) => t[0] === parts[0]) ? parts[0] : 'ustawienia';
    root.innerHTML = `<h1>${esc(store.profile.avatar)} ${esc(store.profile.name)}</h1><div class="tabs">${TABS.map(([k, l]) => `<a href="#/profil/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div id="pb"></div>`;
    const map = { ustawienia: settingsTab, odznaki: achievementsTab, cele: goalsTab, ranking: rankingTab, konto: accountTab };
    await map[tab](root.querySelector('#pb'));
  },
};
