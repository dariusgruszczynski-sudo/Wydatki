import { get, post } from '../api.js';
import { esc } from '../ui/dom.js';
import { cardsHtml } from '../ui/cards.js';
import { feedback } from '../ui/fx.js';
import { errorToast, achievementToasts } from '../ui/overlay.js';
import { setKeys } from '../ui/input.js';
import { updateProgress } from '../store.js';

const ICONS = { hand_compare: '⚖️', hand_name: '🏷️', action_order: '🔄', board_nuts: '🥜', outs: '🎯', pot_odds: '🧮' };

export function dataHtml(d) {
  const x = d.data;
  switch (d.type) {
    case 'hand_compare':
      return `<div class="grid g2"><div class="center"><div class="small muted mb">Układ A</div>${cardsHtml(x.handA, { deal: true })}</div><div class="center"><div class="small muted mb">Układ B</div>${cardsHtml(x.handB, { deal: true })}</div></div>`;
    case 'hand_name':
      return `<div class="row" style="justify-content:center;gap:28px"><div class="center"><div class="small muted mb">Twoje karty</div>${cardsHtml(x.hole, { size: 'lg', deal: true })}</div><div class="center"><div class="small muted mb">Stół</div>${cardsHtml(x.board, { deal: true })}</div></div>`;
    case 'action_order':
      return `<div class="center"><div class="chips" style="justify-content:center">${x.positions.map((p) => `<span class="chip ${x.inHand.includes(p) ? 'on' : 'locked'}">${p}</span>`).join('')}</div><div class="small muted mt">${x.street === 'preflop' ? 'Przed flopem' : 'Po flopie'} · podświetleni gracze są w rozdaniu</div></div>`;
    case 'board_nuts':
      return `<div class="center"><div class="small muted mb">Board</div>${cardsHtml(x.board, { size: 'lg', deal: true })}</div>`;
    case 'outs':
      return `<div class="row" style="justify-content:center;gap:24px"><div class="center"><div class="small muted mb">Ty</div>${cardsHtml(x.hero, { size: 'lg', deal: true })}</div><div class="center"><div class="small muted mb">Flop</div>${cardsHtml(x.board, { deal: true })}</div><div class="center"><div class="small muted mb">Przeciwnik</div>${cardsHtml(x.villain, { size: 'lg', deal: true })}</div></div>`;
    case 'pot_odds':
      return `<div class="center"><div class="stats" style="max-width:420px;margin:auto"><div class="stat"><span class="v">${x.pot}</span><span class="l">pula (bb)</span></div><div class="stat"><span class="v">${x.bet}</span><span class="l">zakład</span></div><div class="stat"><span class="v">${Math.round(x.equity * 100)}%</span><span class="l">Twoje equity</span></div></div></div>`;
    default:
      return '';
  }
}

export function optionsHtml(d) {
  return d.options
    .map((o, i) => `<button class="btn lg" data-opt="${esc(o.key)}">${o.cards ? cardsHtml(o.cards, { size: 'sm' }) : esc(o.label)} <kbd>${i + 1}</kbd></button>`)
    .join('');
}

export async function renderDrills(root, type) {
  const types = await get('/drills/types');
  if (!type) {
    root.innerHTML = `<div class="row between mb"><h1>🧩 Ćwiczenia podstaw</h1><a class="btn sm ghost" href="#/trening">← tryby</a></div>
      <div class="grid g3">${types.map((t) => `<a class="tile ${t.unlocked ? '' : 'locked'}" href="${t.unlocked ? `#/trening/drills/${t.key}` : '#/nauka'}"><span class="ic">${ICONS[t.key]}</span><span class="t">${esc(t.label)}</span><span class="d">Poziom ścieżki ${t.level}${t.unlocked ? '' : ' · 🔒 zablokowane'}</span></a>`).join('')}
      <a class="tile" href="#/trening/drills/mix"><span class="ic">🎲</span><span class="t">Mix</span><span class="d">Losowe ćwiczenia z odblokowanych</span></a></div>`;
    return;
  }
  const allowed = types.filter((t) => t.unlocked).map((t) => t.key);
  let streak = 0;
  let total = 0;
  let ok = 0;
  let current = null;
  let started = 0;
  let answered = false;
  root.innerHTML = `<div class="row between mb"><h1>🧩 ${esc(types.find((t) => t.key === type)?.label || 'Mix')}</h1><a class="btn sm ghost" href="#/trening/drills">← ćwiczenia</a></div>
    <div class="panel"><div class="row between small mb"><span>Seria: <b class="d-streak">0</b></span><span>Wynik: <b class="d-score">0/0</b></span></div>
    <div class="prompt d-prompt"></div><div class="d-data mb"></div><div class="actions d-opts"></div><div class="d-res"></div></div>`;
  const q = (s) => root.querySelector(s);

  async function next() {
    answered = false;
    q('.d-res').innerHTML = '';
    const t = type === 'mix' ? allowed[Math.floor(Math.random() * allowed.length)] : type;
    try {
      current = await post('/drills/next', { type: t });
    } catch (e) {
      return errorToast(e);
    }
    q('.d-prompt').textContent = current.prompt;
    q('.d-data').innerHTML = dataHtml(current);
    q('.d-opts').innerHTML = optionsHtml(current);
    started = Date.now();
  }

  async function answer(key) {
    if (answered || !current) return;
    answered = true;
    try {
      const r = await post('/drills/answer', { id: current.id, choice: key, timeTakenMs: Date.now() - started });
      feedback(r.correct, false);
      updateProgress(r);
      achievementToasts(r.newAchievements);
      total++;
      if (r.correct) {
        ok++;
        streak++;
      } else streak = 0;
      q('.d-streak').textContent = streak;
      q('.d-score').textContent = `${ok}/${total}`;
      q('.d-opts').querySelectorAll('[data-opt]').forEach((b) => {
        b.disabled = true;
        if (b.dataset.opt === String(r.answer)) b.classList.add('primary');
        else if (b.dataset.opt === String(key)) b.classList.add('danger');
      });
      q('.d-res').innerHTML = `<div class="result ${r.correct ? 'good' : 'bad'} pop"><div class="verdict">${r.correct ? '✅ Dobrze' : '❌ Źle'}</div><ul class="explain">${r.explanation.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${r.reveal ? `<div class="list">${r.reveal.map((o) => `<div class="item ${o.key === r.answer ? 'good' : ''}">${cardsHtml(o.cards, { size: 'sm' })}<span class="small">${esc(o.descr)}</span></div>`).join('')}</div>` : ''}<button class="btn primary mt" data-next>Następne <kbd>Spacja</kbd></button></div>`;
    } catch (e) {
      answered = false;
      errorToast(e);
    }
  }

  root.addEventListener('click', (e) => {
    const o = e.target.closest('[data-opt]');
    if (o) answer(o.dataset.opt);
    if (e.target.closest('[data-next]')) next();
  });
  const pick = (i) => () => {
    const b = q('.d-opts').querySelectorAll('[data-opt]')[i];
    if (b) answer(b.dataset.opt);
  };
  setKeys({ 1: pick(0), 2: pick(1), 3: pick(2), 4: pick(3), Space: () => answered && next(), Enter: () => answered && next() });
  next();
}
