import { get, post } from '../api.js';
import { saveSettings, refreshSummary, updateProgress } from '../store.js';
import { esc, ACTION_PL } from '../ui/dom.js';
import { cardsHtml } from '../ui/cards.js';
import { tableHtml } from '../ui/table.js';
import { illustration } from '../ui/illustrations.js';
import { modal, errorToast, achievementToasts, toast } from '../ui/overlay.js';
import { confetti, sound } from '../ui/fx.js';
import { dataHtml, optionsHtml } from './drills.js';
import { go } from '../router.js';

async function pathView(root) {
  const p = await get('/learn/path');
  root.innerHTML = `
    <div class="row between mb"><h1>📘 Ścieżka nauki</h1>
      <div class="row"><a class="btn sm" href="#/nauka/test">🧪 Test wstępny</a>
      <span class="chip ${p.freeMode ? 'on' : ''}" data-free title="Odblokowuje wszystkie lekcje, typy spotów i formaty">🔓 Tryb swobodny</span></div></div>
    <p class="muted small">Przechodzisz 6 poziomów od podstaw do mistrzostwa. Każdy poziom: 5 lekcji z quizami, ćwiczenia, a na końcu egzamin (min. 80%), który odblokowuje kolejny poziom — razem z nowymi typami spotów i formatami w trenerze.</p>
    <div class="col">${p.stages
      .map((s) => {
        const current = s.stage === p.pathStage;
        const done = s.lessons.filter((l) => l.completed).length;
        return `<div class="stage-card ${current ? 'current' : ''} ${s.locked ? 'locked' : ''}">
          <div class="row between mb"><div><h2 style="margin:0">${s.icon} Poziom ${s.stage}: ${esc(s.name)} ${s.passed ? '<span class="pill ok">zaliczony</span>' : current ? '<span class="pill gold">obecny</span>' : s.locked ? '<span class="pill">🔒</span>' : ''}</h2><div class="small muted">${esc(s.desc)}</div></div>
            <div class="row">${s.examBest != null ? `<span class="pill">egzamin: ${s.examBest}%</span>` : ''}${!s.locked ? `<a class="btn sm ${current ? 'gold' : ''}" href="#/nauka/egzamin/${s.stage}">📝 Egzamin</a>` : ''}</div></div>
          <div class="bar green mb"><i style="width:${(done / s.lessons.length) * 100}%"></i></div>
          <div class="list">${s.lessons
            .map((l) => `<a class="item click" href="${s.locked ? '#/nauka' : `#/nauka/lekcja/${l.id}`}" style="text-decoration:none;color:inherit"><span>${l.completed ? '✅' : s.locked ? '🔒' : '📄'} <b>${esc(l.title)}</b><div class="small muted">${esc(l.summary)}</div></span><span class="small muted nowrap">${l.quizBest != null ? `quiz ${l.quizBest}%` : ''}</span></a>`)
            .join('')}</div>
          ${s.drills?.length ? `<div class="small mt">Ćwiczenia: ${s.drills.map((d) => `<a href="#/trening/drills/${d}">${d.replace('_', ' ')}</a>`).join(' · ')}</div>` : ''}
          ${s.spotTypes?.length ? `<div class="small muted mt">Odblokowuje w trenerze: ${s.spotTypes.join(', ').replace(/_/g, ' ')}${s.formats ? ` · formaty: ${s.formats.join(', ')}` : ''}${s.mode ? ' · tryb eksploatacji' : ''}</div>` : ''}
        </div>`;
      })
      .join('')}</div>`;
  root.querySelector('[data-free]').onclick = async (e) => {
    const on = !e.target.classList.contains('on');
    await saveSettings({ freeMode: on });
    toast(on ? 'Tryb swobodny: wszystko odblokowane' : 'Tryb ścieżki: blokady według poziomu');
    pathView(root);
  };
}

async function quizModal(quizId, onDone) {
  const quiz = await get(`/quizzes/${quizId}`);
  const sel = new Array(quiz.questions.length).fill(null);
  const { el, close } = modal('');
  const draw = (res) => {
    el.innerHTML = `<h2>${esc(quiz.title)}${res ? ` — ${res.score}/${res.total}` : ''}</h2>${quiz.questions
      .map((q, qi) => {
        const r = res?.results[qi];
        return `<div class="mb"><p><b>${qi + 1}. ${esc(q.q)}</b></p>${q.options
          .map((o, oi) => {
            let cls = 'quiz-opt';
            if (r) cls += oi === r.correctIndex ? ' right' : oi === sel[qi] ? ' wrong' : '';
            else if (sel[qi] === oi) cls += ' sel';
            return `<button class="${cls}" data-q="${qi}" data-o="${oi}" ${res ? 'disabled' : ''}>${esc(o)}</button>`;
          })
          .join('')}${r ? `<p class="small muted">${esc(r.explanation)}</p>` : ''}</div>`;
      })
      .join('')}<div class="row">${res ? '<button class="btn primary" data-close>Zamknij</button>' : '<button class="btn primary" data-submit>Sprawdź</button><button class="btn ghost" data-close>Anuluj</button>'}</div>`;
  };
  draw(null);
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-q]');
    if (b && !b.disabled) {
      sel[Number(b.dataset.q)] = Number(b.dataset.o);
      draw(null);
    }
    if (e.target.closest('[data-submit]')) {
      if (sel.some((x) => x == null)) return toast('Odpowiedz na wszystkie pytania');
      try {
        const res = await post(`/quizzes/${quizId}/submit`, { answers: sel });
        res.score === res.total ? (confetti(40), sound('good')) : sound(res.score ? 'tick' : 'bad');
        updateProgress(res);
        achievementToasts(res.newAchievements);
        draw(res);
        onDone && onDone(res);
      } catch (err) {
        errorToast(err);
      }
    }
  });
  return close;
}

async function lessonView(root, id) {
  let l;
  try {
    l = await get(`/lessons/${id}`);
  } catch (e) {
    root.innerHTML = `<div class="panel"><h2>🔒 Lekcja zablokowana</h2><p>${esc(e.message)}</p><a class="btn" href="#/nauka">Wróć do ścieżki</a></div>`;
    return;
  }
  root.innerHTML = `
    <div class="row between mb"><a class="btn sm ghost" href="#/nauka">← ścieżka</a><span class="pill">Poziom ${l.stage} · lekcja ${l.order}/5</span></div>
    <div class="panel lesson-body" style="max-width:860px;margin:auto">
      <h1>${esc(l.title)}</h1>
      <p class="muted">${esc(l.summary)}</p>
      ${illustration(l.illustration)}
      <ul class="key-points">${l.keyPoints.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>
      ${l.body.map((p) => `<p>${esc(p)}</p>`).join('')}
      <div class="row mt">
        <button class="btn ${l.completed ? '' : 'primary'}" data-done>${l.completed ? '✅ Ukończona' : 'Oznacz jako ukończoną'}</button>
        ${l.quizId ? '<button class="btn gold" data-quiz>📝 Quiz</button>' : ''}
      </div>
      <div class="row between mt">${l.prevId ? `<a class="btn sm ghost" href="#/nauka/lekcja/${l.prevId}">← poprzednia</a>` : '<span></span>'}${l.nextId ? `<a class="btn sm ghost" href="#/nauka/lekcja/${l.nextId}">następna →</a>` : ''}</div>
    </div>`;
  root.querySelector('[data-done]').onclick = async (e) => {
    try {
      const r = await post(`/lessons/${id}/complete`);
      e.target.textContent = '✅ Ukończona';
      e.target.classList.remove('primary');
      if (r.firstTime) toast('+30 XP za lekcję', 'ok');
      updateProgress(r);
      achievementToasts(r.newAchievements);
    } catch (err) {
      errorToast(err);
    }
  };
  const qb = root.querySelector('[data-quiz]');
  if (qb) qb.onclick = () => quizModal(l.quizId);
}

async function examView(root, stage, kind) {
  let exam;
  try {
    exam = await post(kind === 'placement' ? '/placement/start' : '/exams/start', kind === 'placement' ? {} : { stage });
  } catch (e) {
    root.innerHTML = `<div class="panel"><h2>Egzamin niedostępny</h2><p>${esc(e.message)}</p><a class="btn" href="#/nauka">Wróć</a></div>`;
    return;
  }
  const answers = new Array(exam.items.length).fill(null);
  let i = 0;
  root.innerHTML = `<div class="row between mb"><h1>${kind === 'placement' ? '🧪 Test wstępny' : `📝 Egzamin — poziom ${stage}`}</h1><a class="btn sm ghost" href="#/nauka">przerwij</a></div><div class="panel"><div class="row between small mb"><span>Pytanie <b class="ei">1</b>/${exam.items.length}</span><div class="bar grow" style="max-width:300px"><i class="eb" style="width:0%"></i></div></div><div class="ebox"></div></div>`;
  const box = root.querySelector('.ebox');
  const draw = () => {
    const it = exam.items[i];
    root.querySelector('.ei').textContent = i + 1;
    root.querySelector('.eb').style.width = `${(i / exam.items.length) * 100}%`;
    if (it.kind === 'quiz') {
      box.innerHTML = `<p><b>${esc(it.q)}</b></p>${it.options.map((o, oi) => `<button class="quiz-opt" data-a="${oi}">${esc(o)}</button>`).join('')}`;
    } else if (it.kind === 'drill') {
      box.innerHTML = `<div class="prompt">${esc(it.drill.prompt)}</div>${dataHtml(it.drill)}<div class="actions mt">${optionsHtml(it.drill).replace(/data-opt=/g, 'data-a=')}</div>`;
    } else {
      const s = it.spot;
      box.innerHTML = `${tableHtml(s, { compact: true })}<div class="hero-hand">${cardsHtml(s.heroCombo, { size: 'lg' })}</div><div class="prompt">${esc(s.prompt)}</div><div class="actions">${s.actions.map((a) => `<button class="btn lg ${a === 'fold' ? '' : 'primary'}" data-a="${a}">${ACTION_PL[a]}</button>`).join('')}</div>`;
    }
  };
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const it = exam.items[i];
    answers[i] = it.kind === 'quiz' ? Number(b.dataset.a) : b.dataset.a;
    i++;
    if (i < exam.items.length) return draw();
    box.innerHTML = '<p class="muted">Sprawdzam…</p>';
    try {
      const res = await post('/exams/submit', { id: exam.id, answers });
      updateProgress(res);
      achievementToasts(res.newAchievements);
      if (res.promoted) {
        confetti();
        sound('level');
      }
      refreshSummary();
      const head = kind === 'placement'
        ? `<h2>Wynik: ${res.score}/${res.total}</h2><p>${res.promoted ? `Startujesz od poziomu <b>${res.pathStage}</b> 🎉` : `Zaczynasz od poziomu ${res.pathStage}.`}</p>`
        : `<h2>${res.passed ? '✅ Zdany!' : '❌ Niezdany'} — ${res.score}/${res.total} (${Math.round((res.score / res.total) * 100)}%)</h2><p class="muted">Próg: ${Math.round(res.passThreshold * 100)}%. ${res.promoted ? `Odblokowano poziom ${res.pathStage}! 🎉` : res.passed ? 'Ten poziom był już zaliczony.' : 'Powtórz lekcje i spróbuj ponownie.'}</p>`;
      box.innerHTML = `${head}<div class="list">${res.results
        .map((r, k) => `<div class="item ${r.correct ? 'good' : 'badline'}"><div><b>${k + 1}.</b> ${r.correct ? '✅' : '❌'} <span class="small muted">${esc(r.explanation || '')}</span></div></div>`)
        .join('')}</div><div class="row mt"><a class="btn primary" href="#/nauka">Ścieżka nauki</a><a class="btn" href="#/trening">Trening</a></div>`;
      root.querySelector('.eb').style.width = '100%';
    } catch (err) {
      errorToast(err);
      go('#/nauka');
    }
  });
  draw();
}

export default {
  async render(root, { parts }) {
    if (parts[0] === 'lekcja' && parts[1]) return lessonView(root, parts[1]);
    if (parts[0] === 'egzamin' && parts[1]) return examView(root, Number(parts[1]), 'exam');
    if (parts[0] === 'test') return examView(root, null, 'placement');
    return pathView(root);
  },
};

