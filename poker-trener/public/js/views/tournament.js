import { get, post } from '../api.js';
import { refreshSummary } from '../store.js';
import { esc, fmt, money, dateTime } from '../ui/dom.js';
import { confetti, sound } from '../ui/fx.js';
import { errorToast, achievementToasts, toast } from '../ui/overlay.js';
import { setKeys } from '../ui/input.js';
import { createSpotPlayer } from './spotplayer.js';
import { go } from '../router.js';

let players = [];
let timers = [];

function runHeader(run) {
  const itm = run.playersLeft <= run.paid;
  return `<div class="stats">
    <div class="stat"><span class="v">${run.playersLeft}<span class="small muted">/${run.field}</span></span><span class="l">graczy · płatne ${run.paid}</span></div>
    <div class="stat"><span class="v">${run.level}</span><span class="l">poziom · BB ${fmt(run.bb)}</span></div>
    <div class="stat"><span class="v ${run.heroBB < 10 ? 'bad' : ''}">${fmt(run.heroBB, 1)}</span><span class="l">Twój stos (bb)</span></div>
    <div class="stat"><span class="v">${fmt(run.avgBB, 1)}</span><span class="l">średni stos (bb)</span></div>
    <div class="stat"><span class="v ${itm ? 'ok' : ''}">${itm ? '💰 ITM' : run.playersLeft - run.paid}</span><span class="l">${itm ? 'w pieniądzach' : 'do pieniędzy'}</span></div>
  </div>`;
}

function finishHtml(run) {
  const won = run.status === 'won';
  return `<div class="panel center pop"><div style="font-size:3rem">${won ? '🏆' : run.prize ? '💰' : '💀'}</div>
    <h2>${won ? 'Wygrywasz turniej!' : `Koniec na ${run.finishPlace}. miejscu z ${run.field}`}</h2>
    <p class="big gold" style="font-size:1.6rem;font-weight:900">${run.prize ? `Nagroda: ${money(run.prize)}` : 'Bez nagrody'}</p>
    <p class="muted small">Wpisowe ${money(run.buyin)} · pula ${money(run.poolTotal)}</p>
    <div class="row" style="justify-content:center"><a class="btn primary" href="#/turniej">Nowy turniej</a><a class="btn" href="#/statystyki">Statystyki</a></div></div>`;
}

function historyHtml(run) {
  return `<details class="more"><summary>Przebieg turnieju</summary><div class="list">${run.history
    .slice()
    .reverse()
    .map((h) => `<div class="item small"><span>Poz. ${h.level} · ${h.playersLeft} graczy · ${fmt(h.heroBB, 1)}bb</span><span class="muted">${esc(h.summary)}</span></div>`)
    .join('')}</div></details>`;
}

async function setup(root) {
  const [fields, runs] = await Promise.all([get('/tournament-fields'), get('/tournament/runs')]);
  root.innerHTML = `
    <h1>🏆 Symulator turnieju</h1>
    <div class="tabs"><a class="on" href="#/turniej">Pojedynczy turniej</a><a href="#/turniej/multi">Multi-table (2–3 stoły)</a></div>
    <div class="grid g2">
      <div class="panel">
        <h3>Nowy turniej</h3>
        <p class="small muted">Przechodzisz cały turniej: blindy rosną, gracze odpadają, a każda Twoja decyzja ma realny skutek — rozdanie jest rozgrywane do końca. Przy głębokim stosie ćwiczysz otwarcia, przy krótkim push/fold, na bąbelku i final table — ICM.</p>
        <label class="field">Pole<select class="inp" id="field">${fields.map((f) => `<option value="${f.field}" ${f.field === 45 ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>
        <div class="grid g2 mt">
          <label class="field">Wpisowe ($)<input class="inp" id="buyin" type="number" min="1" value="10"></label>
          <label class="field">Format<select class="inp" id="fmt"><option value="mtt">MTT</option><option value="pko">PKO (bounty)</option></select></label>
        </div>
        <button class="btn gold lg wide mt" id="start">Start turnieju</button>
      </div>
      <div class="panel">
        <h3>Twoje turnieje</h3>
        ${runs.length ? `<div class="list">${runs.map((r) => `<a class="item click" href="#/turniej/run/${r.id}" style="text-decoration:none;color:inherit"><span>${r.status === 'running' ? '▶️' : r.status === 'won' ? '🏆' : r.prize ? '💰' : '💀'} ${r.field} graczy · ${money(r.buyin)}</span><span class="small muted">${r.status === 'running' ? 'w toku' : `${r.finishPlace}. miejsce${r.prize ? ` · ${money(r.prize)}` : ''}`} · ${dateTime(r.createdAt)}</span></a>`).join('')}</div>` : '<p class="muted small">Jeszcze żadnego.</p>'}
      </div>
    </div>`;
  root.querySelector('#start').onclick = async () => {
    try {
      const run = await post('/tournament/start', { field: Number(root.querySelector('#field').value), buyin: Number(root.querySelector('#buyin').value), format: root.querySelector('#fmt').value });
      sound('shuffle');
      go(`#/turniej/run/${run.id}`);
    } catch (e) {
      errorToast(e);
    }
  };
}

async function single(root, id) {
  const run = await get(`/tournament/${id}`);
  root.innerHTML = `<div class="row between mb"><h1>🏆 Turniej ${run.field} graczy</h1><a class="btn sm ghost" href="#/turniej">← turnieje</a></div><div class="rh mb"></div><div class="sp"></div><div class="hist mt"></div>`;
  const rh = root.querySelector('.rh');
  const show = (r) => {
    rh.innerHTML = runHeader(r);
    root.querySelector('.hist').innerHTML = historyHtml(r);
  };
  show(run);
  if (run.status !== 'running') {
    root.querySelector('.sp').innerHTML = finishHtml(run);
    return;
  }
  const p = createSpotPlayer(root.querySelector('.sp'), {
    mode: 'tournament',
    confidence: false,
    fetchSpot: async () => {
      const r = await post(`/tournament/${id}/next`, {});
      show(r.run);
      if (!r.spot) return null;
      return r.spot;
    },
    onEmpty: async (c) => {
      const r = await get(`/tournament/${id}`);
      show(r);
      c.innerHTML = finishHtml(r);
    },
    onResult: (res) => {
      if (res.run) {
        show(res.run);
        if (res.run.status !== 'running') {
          if (res.run.status === 'won' || res.run.prize) confetti();
          refreshSummary();
        }
      }
    },
  });
  players.push(p);
  p.next();
}

async function multiSetup(root) {
  root.innerHTML = `
    <h1>🖥️ Multi-table</h1>
    <div class="tabs"><a href="#/turniej">Pojedynczy turniej</a><a class="on" href="#/turniej/multi">Multi-table (2–3 stoły)</a></div>
    <div class="panel" style="max-width:640px">
      <p class="small muted">Grasz kilka symulowanych turniejów naraz. Decyzje przychodzą asynchronicznie na różnych stołach, każda ma limit czasu (brak decyzji = pas). Stół czekający na Ciebie jest podświetlony na złoto. Klawisze <b>S/C/R</b> (agresja) i <b>F</b> (pas) działają na stole, który czeka najdłużej.</p>
      <div class="grid g2">
        <label class="field">Liczba stołów<select class="inp" id="n"><option value="2">2</option><option value="3" selected>3</option></select></label>
        <label class="field">Czas na decyzję<select class="inp" id="t"><option value="15000">15 s</option><option value="12000" selected>12 s</option><option value="9000">9 s</option><option value="6000">6 s</option></select></label>
        <label class="field">Pole<select class="inp" id="f"><option value="18">18 graczy (szybko)</option><option value="45" selected>45 graczy</option></select></label>
        <label class="field">Wpisowe ($)<input class="inp" id="b" type="number" value="5" min="1"></label>
      </div>
      <button class="btn gold lg wide mt" id="go">Start sesji</button>
    </div>`;
  root.querySelector('#go').onclick = () => multi(root, {
    n: Number(root.querySelector('#n').value),
    speedMs: Number(root.querySelector('#t').value),
    field: Number(root.querySelector('#f').value),
    buyin: Number(root.querySelector('#b').value),
  });
}

async function multi(root, cfg) {
  const sessionKey = `mt-${Date.now()}`;
  const runs = [];
  for (let i = 0; i < cfg.n; i++) runs.push(await post('/tournament/start', { field: cfg.field, buyin: cfg.buyin, sessionKey }));
  sound('shuffle');
  const stats = { n: 0, ok: 0, timeouts: 0 };
  root.innerHTML = `<div class="row between mb"><h1>🖥️ Sesja ${cfg.n} stołów</h1><span class="row small"><span class="pill">✅ <b class="mt-ok">0</b>/<b class="mt-n">0</b></span><span class="pill">⏱️ timeouty <b class="mt-to">0</b></span><button class="btn sm danger" data-stop>Zakończ</button></span></div>
    <div class="mt-tables n${cfg.n}">${runs.map((r, i) => `<div class="mt-table" data-t="${i}"><div class="row between small mb"><b>Stół ${i + 1}</b><span class="mt-h muted">${r.playersLeft}/${r.field} · ${fmt(r.heroBB, 1)}bb</span></div><div class="mt-sp"></div></div>`).join('')}</div>
    <div class="mt-end mt"></div>`;
  const pending = new Map();
  const finished = new Set();
  const tables = runs.map((run, i) => {
    const box = root.querySelector(`.mt-table[data-t="${i}"]`);
    const p = createSpotPlayer(box.querySelector('.mt-sp'), {
      mode: 'multitable',
      compact: true,
      side: false,
      keys: false,
      confidence: false,
      manualNext: true,
      speedMs: cfg.speedMs,
      fetchSpot: async () => {
        const r = await post(`/tournament/${run.id}/next`, { multitable: true, speedMs: cfg.speedMs });
        box.querySelector('.mt-h').textContent = `${r.run.playersLeft}/${r.run.field} · ${fmt(r.run.heroBB, 1)}bb · poz. ${r.run.level}`;
        if (!r.spot) return null;
        return r.spot;
      },
      onSpot: () => {
        pending.set(i, Date.now());
        box.classList.add('need');
        sound('tick');
      },
      onEmpty: async (c) => {
        finished.add(i);
        pending.delete(i);
        box.classList.remove('need');
        const r = await get(`/tournament/${run.id}`);
        c.innerHTML = `<div class="center small"><div style="font-size:2rem">${r.status === 'won' ? '🏆' : r.prize ? '💰' : '💀'}</div><b>${r.finishPlace}. miejsce</b>${r.prize ? ` · ${money(r.prize)}` : ''}</div>`;
        checkEnd();
      },
      onResult: (res) => {
        pending.delete(i);
        box.classList.remove('need');
        stats.n++;
        if (res.correct) stats.ok++;
        if (res.chosen === 'fold' && res.mode === 'multitable' && res.timedOut) stats.timeouts++;
        root.querySelector('.mt-ok').textContent = stats.ok;
        root.querySelector('.mt-n').textContent = stats.n;
        root.querySelector('.mt-to').textContent = stats.timeouts;
        if (res.run) box.querySelector('.mt-h').textContent = `${res.run.playersLeft}/${res.run.field} · ${fmt(res.run.heroBB, 1)}bb · poz. ${res.run.level}`;
        const delay = 1500 + Math.random() * 4500;
        const t = setTimeout(() => p.next(), delay);
        timers.push(t);
      },
    });
    players.push(p);
    return p;
  });
  tables.forEach((p, i) => timers.push(setTimeout(() => p.next(), 400 + i * 1300)));

  const urgent = () => {
    let best = null;
    for (const [i, t] of pending) if (best == null || t < pending.get(best)) best = i;
    return best == null ? null : tables[best];
  };
  setKeys({
    s: () => urgent()?.decide(urgent().spot.actions[0]),
    c: () => urgent()?.decide(urgent().spot.actions[0]),
    r: () => urgent()?.decide(urgent().spot.actions[0]),
    a: () => urgent()?.decide(urgent().spot.actions[0]),
    f: () => urgent()?.decide('fold'),
  });

  let ended = false;
  async function checkEnd(force = false) {
    if (ended || (!force && finished.size < runs.length)) return;
    ended = true;
    players.forEach((p) => p.destroy());
    timers.forEach(clearTimeout);
    const results = await Promise.all(runs.map((r) => get(`/tournament/${r.id}`)));
    const prize = results.reduce((a, r) => a + (r.prize || 0), 0);
    if (!force) {
      const rec = await post('/modes/record', { mode: 'multitable', score: runs.length, detail: { prize, accuracy: stats.n ? stats.ok / stats.n : null } });
      achievementToasts(rec.newAchievements);
      if (prize > 0) confetti();
    }
    root.querySelector('.mt-end').innerHTML = `<div class="panel pop"><h2>Podsumowanie sesji</h2><div class="stats">
      <div class="stat"><span class="v">${stats.n ? Math.round((stats.ok / stats.n) * 100) : 0}%</span><span class="l">trafność (${stats.ok}/${stats.n})</span></div>
      <div class="stat"><span class="v">${stats.timeouts}</span><span class="l">timeoutów</span></div>
      <div class="stat"><span class="v">${money(prize)}</span><span class="l">nagrody razem</span></div>
      <div class="stat"><span class="v">${money(prize - cfg.buyin * runs.length)}</span><span class="l">wynik netto</span></div></div>
      <div class="list mt">${results.map((r, i) => `<div class="item"><span>Stół ${i + 1}</span><span>${r.status === 'running' ? 'przerwany' : `${r.finishPlace}. miejsce`}${r.prize ? ` · ${money(r.prize)}` : ''}</span></div>`).join('')}</div>
      <a class="btn primary mt" href="#/turniej/multi">Nowa sesja</a></div>`;
    refreshSummary();
  }
  root.querySelector('[data-stop]').onclick = () => {
    toast('Sesja zakończona');
    checkEnd(true);
  };
}

export default {
  async render(root, { parts }) {
    players = [];
    timers = [];
    if (parts[0] === 'run' && parts[1]) return single(root, Number(parts[1]));
    if (parts[0] === 'multi') return multiSetup(root);
    return setup(root);
  },
  cleanup() {
    players.forEach((p) => p.destroy());
    timers.forEach(clearTimeout);
    players = [];
    timers = [];
  },
};
