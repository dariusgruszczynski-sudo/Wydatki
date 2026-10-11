import { get, post, put, del } from '../api.js';
import { store, updateProgress } from '../store.js';
import { esc, fmt, dateTime, ACTION_PL } from '../ui/dom.js';
import { cardsHtml, cardsFromString } from '../ui/cards.js';
import { tableHtml } from '../ui/table.js';
import { modal, errorToast, toast, confirmBox, achievementToasts } from '../ui/overlay.js';

const TABS = [
  ['wpisy', '📝 Wpisy'],
  ['import', '📥 Import HH'],
  ['rece', '🃏 Ręce'],
  ['przeciwnicy', '👥 Przeciwnicy'],
  ['tagi', '🏷️ Tagi'],
];
const STAGE = { early: 'Wczesny', mid: 'Środek', bubble: 'Bąbelek', final_table: 'Final table' };
const RES = { win: 'Wygrana', loss: 'Przegrana', fold: 'Pas' };
const OPP = { nit: 'Nit', reg: 'Regular', lag: 'LAG', maniac: 'Maniak', fish: 'Rekreacyjny' };

function entryForm(e = {}) {
  return `<div class="grid g2">
    <label class="field">Tytuł / spot<input class="inp" name="title" value="${esc(e.title || '')}" placeholder="np. AQo call vs shove na bąbelku"></label>
    <label class="field">Etap<select class="inp" name="stage">${Object.entries(STAGE).map(([k, v]) => `<option value="${k}" ${e.stage === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="field">Pozycja<input class="inp" name="position" value="${esc(e.position || '')}" placeholder="np. CO"></label>
    <label class="field">Stos (bb)<input class="inp" name="stackBb" type="number" step="0.1" value="${e.stack_bb ?? ''}"></label>
    <label class="field">Karty<input class="inp" name="heroCards" value="${esc(e.hero_cards || '')}" placeholder="AhKd"></label>
    <label class="field">Board<input class="inp" name="board" value="${esc(e.board || '')}" placeholder="Qs 7h 2c"></label>
    <label class="field">Przeciwnik<input class="inp" name="opponent" value="${esc(e.opponent || '')}"></label>
    <label class="field">Wynik<select class="inp" name="result">${Object.entries(RES).map(([k, v]) => `<option value="${k}" ${e.result === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="field">Wynik (bb)<input class="inp" name="resultBb" type="number" step="0.1" value="${e.result_bb ?? ''}"></label>
    <label class="field">Tagi (po przecinku)<input class="inp" name="tags" value="${esc(e.tags || '')}" placeholder="icm, leak-call"></label>
  </div>
  <label class="field mt">Przebieg akcji<textarea class="inp" name="actionSummary" rows="2">${esc(e.action_summary || '')}</textarea></label>
  <label class="field mt">Notatki / wnioski<textarea class="inp" name="notes" rows="3">${esc(e.notes || '')}</textarea></label>`;
}

function formData(el) {
  const o = {};
  el.querySelectorAll('[name]').forEach((i) => (o[i.name] = i.value));
  o.tags = o.tags.split(',').map((t) => t.trim()).filter(Boolean);
  o.stackBb = o.stackBb === '' ? null : Number(o.stackBb);
  o.resultBb = o.resultBb === '' ? null : Number(o.resultBb);
  return o;
}

async function entries(box) {
  const rows = await get('/journal');
  box.innerHTML = `<div class="grid g2"><div class="panel"><h3>Nowy wpis</h3><form id="f">${entryForm()}<button class="btn gold mt" type="submit">Zapisz</button></form></div>
    <div class="panel"><h3>Historia (${rows.length})</h3>${rows.length ? `<div class="list">${rows
      .map((r) => `<div class="item"><div class="grow"><b>${esc(r.title || '(bez tytułu)')}</b> ${r.result ? `<span class="pill ${r.result === 'win' ? 'ok' : r.result === 'loss' ? 'bad' : ''}">${RES[r.result] || r.result}${r.result_bb != null ? ` ${fmt(r.result_bb, 1)}bb` : ''}</span>` : ''}
        <div class="small muted">${[STAGE[r.stage], r.position, r.stack_bb != null ? `${fmt(r.stack_bb, 1)}bb` : '', dateTime(r.created_at)].filter(Boolean).join(' · ')}</div>
        ${r.hero_cards ? `<div class="mt">${cardsHtml(cardsFromString(r.hero_cards), { size: 'sm' })} ${r.board ? cardsHtml(cardsFromString(r.board), { size: 'sm' }) : ''}</div>` : ''}
        ${r.notes ? `<div class="small mt">📝 ${esc(r.notes)}</div>` : ''}
        ${r.tags ? `<div class="chips mt">${r.tags.split(',').map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}</div>
        <div class="col">${store.coach.enabled ? `<button class="btn sm" data-ai="${r.id}">🤖</button>` : ''}${r.hand_id ? `<button class="btn sm" data-replay="${r.hand_id}">▶️</button>` : ''}<button class="btn sm ghost" data-edit="${r.id}">✏️</button><button class="btn sm ghost" data-del="${r.id}">🗑️</button></div></div>`)
      .join('')}</div>` : '<p class="muted small">Brak wpisów. Zapisuj trudne ręce z sesji — to najlepszy materiał do nauki.</p>'}</div></div>`;
  box.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await post('/journal', formData(e.target));
      achievementToasts(r.newAchievements);
      toast('Zapisano', 'ok');
      entries(box);
    } catch (err) {
      errorToast(err);
    }
  };
  box.onclick = async (e) => {
    const d = e.target.closest('[data-del]');
    if (d && (await confirmBox('Usunąć wpis?'))) {
      await del(`/journal/${d.dataset.del}`);
      entries(box);
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const r = rows.find((x) => x.id === Number(ed.dataset.edit));
      const { el, close } = modal(`<h2>Edycja wpisu</h2><form>${entryForm(r)}<div class="row mt"><button class="btn gold" type="submit">Zapisz</button><button class="btn ghost" type="button" data-close>Anuluj</button></div></form>`);
      el.querySelector('form').onsubmit = async (ev) => {
        ev.preventDefault();
        await put(`/journal/${r.id}`, { ...formData(ev.target), handId: r.hand_id });
        close();
        entries(box);
      };
    }
    const ai = e.target.closest('[data-ai]');
    if (ai) aiModal(`/coach/journal/${ai.dataset.ai}`);
    const rp = e.target.closest('[data-replay]');
    if (rp) replayer(Number(rp.dataset.replay));
  };
}

async function aiModal(path) {
  const { el } = modal('<h2>🤖 Analiza coacha</h2><p class="muted">Analizuję rozdanie…</p>');
  try {
    const r = await post(path);
    el.innerHTML = `<h2>🤖 Analiza coacha</h2><div style="white-space:pre-wrap;line-height:1.6">${esc(r.text)}</div><button class="btn mt" data-close>Zamknij</button>`;
  } catch (e) {
    el.innerHTML = `<h2>🤖 Analiza coacha</h2><p class="bad">${esc(e.message)}</p><button class="btn" data-close>Zamknij</button>`;
  }
}

function importTab(box) {
  box.innerHTML = `<div class="grid g2"><div class="panel"><h3>Import historii rąk</h3>
    <p class="small muted">Obsługiwane: <b>PokerStars</b> i <b>GGPoker</b> (pliki .txt z historią turniejów). W PokerStars: Ustawienia → Historia rąk → katalog z plikami. W GGPoker: PokerCraft → pobierz historię rąk.</p>
    <input type="file" class="inp" id="files" multiple accept=".txt,text/plain">
    <label class="field mt">…albo wklej tekst<textarea class="inp" id="txt" rows="8" placeholder="PokerStars Hand #…"></textarea></label>
    <button class="btn gold mt" id="go">📥 Importuj</button><div id="res" class="mt small"></div></div>
    <div class="panel"><h3>Analiza spotów push/fold</h3><p class="small muted">Apka znajduje rozdania, w których byłeś pierwszy do akcji z krótkim stosem (≤25bb) albo stałeś przed all-inem, i porównuje Twoją decyzję z modelem (w chip EV — plik HH nie zawiera struktury wypłat).</p>
    <button class="btn" id="rev">🎯 Przeanalizuj zaimportowane ręce</button><div id="rv" class="mt small"></div></div></div>`;
  box.querySelector('#go').onclick = async () => {
    let text = box.querySelector('#txt').value;
    for (const f of box.querySelector('#files').files) text += '\n\n' + (await f.text());
    if (!text.trim()) return toast('Wybierz pliki albo wklej tekst');
    const res = box.querySelector('#res');
    res.textContent = 'Importuję…';
    try {
      const r = await post('/hands/import', { text });
      updateProgress(r);
      achievementToasts(r.newAchievements);
      res.innerHTML = `✅ Odczytano ${r.parsed} rąk, nowych: <b>${r.added}</b>, duplikaty: ${r.duplicates}${r.errors ? `, błędy: ${r.errors}` : ''}.`;
    } catch (e) {
      res.textContent = '';
      errorToast(e);
    }
  };
  box.querySelector('#rev').onclick = async (e) => {
    const btn = e.target;
    btn.disabled = true;
    const out = box.querySelector('#rv');
    let spots = 0;
    let mistakes = 0;
    try {
      for (;;) {
        const r = await post('/hands/review-batch');
        spots += r.spots;
        mistakes += r.mistakes;
        out.textContent = `Przeanalizowano… spotów: ${spots}, niezgodnych z modelem: ${mistakes}, zostało rąk: ${r.remaining}`;
        if (!r.remaining || !r.processed) break;
      }
      out.innerHTML = `✅ Gotowe: ${spots} spotów push/fold, <b class="${mistakes ? 'bad' : 'ok'}">${mistakes} niezgodnych z modelem</b>. <a href="#/dziennik/rece?flagged=1">Pokaż je</a>`;
    } catch (err) {
      errorToast(err);
    } finally {
      btn.disabled = false;
    }
  };
}

async function handsTab(box, params) {
  const flagged = params.flagged === '1';
  const [stats, list] = await Promise.all([get('/hands/stats'), get(`/hands?limit=150${flagged ? '&flagged=1' : ''}`)]);
  box.innerHTML = `<div class="panel mb"><div class="stats">
      <div class="stat"><span class="v">${fmt(stats.hands)}</span><span class="l">rąk</span></div>
      <div class="stat"><span class="v">${stats.vpip ?? '—'}%</span><span class="l">VPIP</span></div>
      <div class="stat"><span class="v">${stats.pfr ?? '—'}%</span><span class="l">PFR</span></div>
      <div class="stat"><span class="v">${stats.threeBet ?? '—'}%</span><span class="l">3-bet</span></div>
      <div class="stat"><span class="v ${stats.resultBB >= 0 ? 'ok' : 'bad'}">${fmt(stats.resultBB, 1)}</span><span class="l">wynik (bb)</span></div>
      <div class="stat"><span class="v">${stats.pushFold.mistakes}/${stats.pushFold.reviewed}</span><span class="l">spoty niezgodne z modelem</span></div>
    </div>
    ${stats.byPos.length ? `<div class="scroll-x mt"><table class="tbl"><thead><tr><th>Pozycja</th><th>Ręce</th><th>VPIP</th><th>PFR</th><th>bb</th><th>bb/100</th></tr></thead><tbody>${stats.byPos.map((p) => `<tr><td>${p.pos}</td><td>${p.n}</td><td>${p.vpip}%</td><td>${p.pfr}%</td><td class="${p.resultBB >= 0 ? 'ok' : 'bad'}">${fmt(p.resultBB, 1)}</td><td>${fmt(p.bbPer100, 1)}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>
    <div class="panel"><div class="row between mb"><h3>${flagged ? 'Spoty niezgodne z modelem' : 'Ostatnie ręce'} (${list.total})</h3><div class="row">${flagged ? '<a class="btn sm" href="#/dziennik/rece">Wszystkie</a>' : '<a class="btn sm" href="#/dziennik/rece?flagged=1">Tylko niezgodne</a>'}</div></div>
    ${list.rows.length ? `<div class="list">${list.rows
      .map((h) => `<div class="item ${h.review ? (h.review.correct ? 'good' : 'badline') : ''}"><div class="grow"><div class="row">${h.hero_cards ? cardsHtml(cardsFromString(h.hero_cards), { size: 'sm' }) : ''}<b>${esc(h.hero_pos || '?')}</b><span class="small muted">${fmt(h.hero_stack_bb, 1)}bb · ${dateTime(h.played_at)} · ${esc(h.site)}</span></div>
        ${h.review ? `<div class="small mt">${h.review.correct ? '✅' : '❌'} ${h.review.type === 'open_shove' ? 'open shove' : 'call vs shove'}: zagrałeś <b>${ACTION_PL[h.review.chosen]}</b>, model: <b>${ACTION_PL[h.review.optimal]}</b>${h.review.close ? ' (granicznie)' : ''}</div>` : ''}</div>
        <div class="row"><span class="${h.result_bb > 0 ? 'ok' : h.result_bb < 0 ? 'bad' : 'muted'} nowrap">${h.result_bb > 0 ? '+' : ''}${fmt(h.result_bb, 1)}bb</span><button class="btn sm" data-replay="${h.id}">▶️</button><button class="btn sm ghost" data-tojournal="${h.id}">📝</button>${store.coach.enabled ? `<button class="btn sm ghost" data-ai="${h.id}">🤖</button>` : ''}</div></div>`)
      .join('')}</div>` : '<p class="muted small">Brak rąk — zaimportuj historię w zakładce „Import HH”.</p>'}</div>`;
  box.onclick = async (e) => {
    const r = e.target.closest('[data-replay]');
    if (r) replayer(Number(r.dataset.replay));
    const j = e.target.closest('[data-tojournal]');
    if (j) {
      await post(`/hands/${j.dataset.tojournal}/journal`, {});
      toast('Dodano do dziennika', 'ok');
    }
    const ai = e.target.closest('[data-ai]');
    if (ai) aiModal(`/coach/hand/${ai.dataset.ai}`);
  };
}

// C7: odtwarzanie rozdania krok po kroku.
async function replayer(id) {
  const h = await get(`/hands/${id}`);
  const players = h.players.filter((p) => !p.sittingOut && p.pos);
  const order = ['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  players.sort((a, b) => order.indexOf(a.pos) - order.indexOf(b.pos));
  const heroIdx = players.findIndex((p) => p.name === h.hero_name);
  const steps = h.actions.filter((a) => ['action', 'board', 'collect', 'show', 'return'].includes(a.type));
  const bb = h.bb || 1;
  let i = 0;
  let timer = null;
  const { el } = modal('', { wide: true, onClose: () => clearInterval(timer) });
  const state = (upto) => {
    const stacks = Object.fromEntries(players.map((p) => [p.name, p.stack]));
    const folded = new Set();
    const shown = {};
    let board = [];
    let pot = 0;
    for (let k = 0; k < upto; k++) {
      const a = steps[k];
      if (a.type === 'board') board = board.concat(a.cards);
      if (a.type === 'action') {
        if (a.stackAfter != null) stacks[a.name] = a.stackAfter;
        if (a.verb === 'folds') folded.add(a.name);
      }
      if (a.type === 'show') shown[a.name] = a.cards;
      if (a.type === 'collect' || a.type === 'return') stacks[a.name] = (stacks[a.name] || 0) + a.amount;
      if (a.pot != null) pot = a.pot;
    }
    return { stacks, folded, shown, board, pot };
  };
  const draw = () => {
    const s = state(i);
    const spot = {
      seats: players.map((p, k) => ({ posLabel: p.pos, stack: s.stacks[p.name] / bb, posted: 0, role: k === heroIdx ? 'hero' : 'villain', status: s.folded.has(p.name) ? 'folded' : 'active' })),
      heroIdx: Math.max(0, heroIdx),
      buttonIdx: players.findIndex((p) => p.pos === 'BTN'),
      pot: s.pot / bb,
      formatLabel: `${h.site} #${h.hand_no}`,
      stageLabel: `blindy ${fmt(h.sb)}/${fmt(h.bb)}${h.ante ? ` ante ${fmt(h.ante)}` : ''}`,
      valueMode: 'chips',
    };
    const revealed = {};
    players.forEach((p, k) => {
      if (s.shown[p.name] && k !== heroIdx) revealed[k] = s.shown[p.name];
    });
    const log = steps
      .map((a, k) => {
        const txt = a.type === 'board' ? `— ${a.street.toUpperCase()}: ${a.cards.join(' ')}` : a.type === 'action' ? `${a.pos || a.name}: ${a.verb}${a.amount ? ` ${fmt(a.amount / bb, 1)}bb` : ''}${a.allin ? ' (all-in)' : ''}` : a.type === 'show' ? `${a.name} pokazuje ${a.cards.join(' ')}` : a.type === 'collect' ? `${a.name} zgarnia ${fmt(a.amount / bb, 1)}bb` : `zwrot ${fmt(a.amount / bb, 1)}bb dla ${a.name}`;
        return `<div class="${k === i - 1 ? 'cur' : k >= i ? 'muted' : ''}">${esc(txt)}</div>`;
      })
      .join('');
    el.innerHTML = `<div class="row between mb"><h2>▶️ Replayer</h2><button class="btn sm ghost" data-close>✕</button></div>
      <div class="grid g2"><div><div class="rp-table">${tableHtml(spot, { revealed, compact: true })}</div>
        <div class="row" style="justify-content:center">${h.hero_cards ? cardsHtml(cardsFromString(h.hero_cards), { size: 'lg' }) : ''}<span style="width:16px"></span>${cardsHtml(s.board)}</div></div>
        <div><div class="replayer-log panel flat">${log}</div>
        <div class="row mt"><button class="btn" data-k="first">⏮</button><button class="btn" data-k="prev">◀</button><button class="btn gold" data-k="play">${timer ? '⏸' : '▶'}</button><button class="btn" data-k="next">▶</button><button class="btn" data-k="last">⏭</button></div>
        <div class="small muted mt">Krok ${i}/${steps.length} · wynik bohatera: <b class="${h.result_bb >= 0 ? 'ok' : 'bad'}">${fmt(h.result_bb, 1)}bb</b></div>
        ${h.review ? `<div class="result ${h.review.correct ? 'good' : 'bad'} small">${h.review.correct ? '✅' : '❌'} Spot push/fold: zagrałeś ${ACTION_PL[h.review.chosen]}, model: ${ACTION_PL[h.review.optimal]}<ul class="explain">${(h.review.explanation || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}</div></div>`;
  };
  el.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    if (k === 'first') i = 0;
    if (k === 'prev') i = Math.max(0, i - 1);
    if (k === 'next') i = Math.min(steps.length, i + 1);
    if (k === 'last') i = steps.length;
    if (k === 'play') {
      if (timer) {
        clearInterval(timer);
        timer = null;
      } else {
        timer = setInterval(() => {
          if (i >= steps.length) {
            clearInterval(timer);
            timer = null;
          } else i++;
          draw();
        }, 900);
      }
    }
    draw();
  });
  draw();
}

async function opponentsTab(box) {
  const d = await get('/opponents');
  const noteFor = (name) => d.notes.find((n) => n.name === name);
  box.innerHTML = `<div class="grid g2"><div class="panel"><h3>Notatka o przeciwniku</h3><form id="of" class="col">
      <label class="field">Nick<input class="inp" name="name" required></label>
      <label class="field">Serwis<input class="inp" name="site" placeholder="pokerstars / ggpoker"></label>
      <label class="field">Typ<select class="inp" name="type"><option value="">—</option>${Object.entries(OPP).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="field">Notatki<textarea class="inp" name="notes" rows="3"></textarea></label>
      <button class="btn gold" type="submit">Zapisz</button></form>
      <h3 class="mt">Twoje notatki (${d.notes.length})</h3>${d.notes.length ? `<div class="list">${d.notes.map((n) => `<div class="item"><div><b>${esc(n.name)}</b> <span class="small muted">${esc(n.site)}</span> ${n.type ? `<span class="pill">${OPP[n.type] || n.type}</span>` : ''}<div class="small">${esc(n.notes || '')}</div></div><button class="btn sm ghost" data-del="${n.id}">🗑️</button></div>`).join('')}</div>` : '<p class="small muted">Brak notatek.</p>'}</div>
    <div class="panel"><h3>Gracze z zaimportowanych rąk</h3><p class="small muted">Statystyki z Twoich rąk (min. 3 wspólne ręce). Sugerowany typ pojawia się od 20 rąk.</p>
      ${d.seen.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Nick</th><th>Ręce</th><th>VPIP</th><th>PFR</th><th>Typ</th><th></th></tr></thead><tbody>${d.seen
        .map((s) => `<tr><td>${esc(s.name)}${noteFor(s.name) ? ' 📝' : ''}</td><td>${s.hands}</td><td>${s.vpip}%</td><td>${s.pfr}%</td><td>${s.suggestedType ? OPP[s.suggestedType] : '—'}</td><td><button class="btn sm ghost" data-note="${esc(s.name)}" data-site="${esc(s.site)}" data-type="${s.suggestedType || ''}">📝</button></td></tr>`)
        .join('')}</tbody></table></div>` : '<p class="small muted">Zaimportuj ręce, żeby zobaczyć statystyki rywali.</p>'}</div></div>`;
  const form = box.querySelector('#of');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(form));
    try {
      await post('/opponents', o);
      toast('Zapisano', 'ok');
      opponentsTab(box);
    } catch (err) {
      errorToast(err);
    }
  };
  box.onclick = async (e) => {
    const d2 = e.target.closest('[data-del]');
    if (d2) {
      await del(`/opponents/${d2.dataset.del}`);
      opponentsTab(box);
    }
    const n = e.target.closest('[data-note]');
    if (n) {
      form.name.value = n.dataset.note;
      form.site.value = n.dataset.site;
      form.type.value = n.dataset.type;
      form.notes.focus();
    }
  };
}

async function tagsTab(box) {
  const t = await get('/journal/tags');
  box.innerHTML = `<div class="panel"><h3>Statystyki tagów</h3>${t.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Tag</th><th>Wpisy</th><th>Wygrane</th><th>Przegrane</th><th>Pasy</th><th>Wynik (bb)</th></tr></thead><tbody>${t.map((x) => `<tr><td><span class="chip">${esc(x.tag)}</span></td><td>${x.count}</td><td>${x.win}</td><td>${x.loss}</td><td>${x.fold}</td><td class="${x.resultBB >= 0 ? 'ok' : 'bad'}">${fmt(x.resultBB, 1)}</td></tr>`).join('')}</tbody></table></div><p class="small muted mt">Tagi takie jak „leak-call-za-szeroki” pokazują, które błędy wracają najczęściej i ile kosztują.</p>` : '<p class="muted small">Dodawaj tagi do wpisów w dzienniku, żeby zobaczyć tu statystyki.</p>'}</div>`;
}

export default {
  async render(root, { parts, params }) {
    const tab = TABS.find((t) => t[0] === parts[0]) ? parts[0] : 'wpisy';
    root.innerHTML = `<h1>📝 Dziennik rozdań</h1><div class="tabs">${TABS.map(([k, l]) => `<a href="#/dziennik/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div id="jb"></div>`;
    const box = root.querySelector('#jb');
    const map = { wpisy: entries, import: importTab, rece: (b) => handsTab(b, params), przeciwnicy: opponentsTab, tagi: tagsTab };
    await map[tab](box);
  },
};
