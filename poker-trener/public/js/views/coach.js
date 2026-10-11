import { get, post, del } from '../api.js';
import { store } from '../store.js';
import { esc } from '../ui/dom.js';
import { errorToast, confirmBox } from '../ui/overlay.js';
import { feedback } from '../ui/fx.js';

const TABS = [
  ['czat', '💬 Czat'],
  ['plan', '🗓️ Plan treningowy'],
  ['quiz', '❓ Quiz z błędów'],
];

function disabledNote() {
  return `<div class="panel mb" style="border-color:var(--warn)"><b>Coach AI jest wyłączony.</b><p class="small muted">Żeby go włączyć, dopisz klucz API Anthropic do pliku <code>.env</code> na serwerze (<code>ANTHROPIC_API_KEY=...</code>) i zrestartuj kontener. Bez klucza działają: wyjaśnienia regułowe w trenerze, plan treningowy z reguł i quiz z Twoich błędów.</p></div>`;
}

async function chat(box) {
  if (!store.coach.enabled) {
    box.innerHTML = disabledNote();
    return;
  }
  const hist = await get('/coach/chat');
  box.innerHTML = `<div class="panel"><div class="chat" id="msgs">${hist.length ? hist.map((m) => `<div class="msg ${m.role}">${esc(m.content)}</div>`).join('') : '<div class="msg assistant">Cześć! Znam Twoje statystyki z aplikacji. Zapytaj o dowolny spot, pojęcie (ICM, fold equity, zasięgi) albo o to, nad czym pracować.</div>'}</div>
    <form id="f" class="row mt"><textarea class="inp grow" id="m" rows="2" placeholder="np. Dlaczego na bąbelku mam pasować AJo na BB?"></textarea><button class="btn gold" type="submit">Wyślij</button></form>
    <div class="row mt"><span class="chips">${['Jakie mam największe leaki?', 'Wyjaśnij risk premium prostymi słowami', 'Jak grać na bąbelku krótkim stosem?', 'Ile stołów powinienem grać?'].map((q) => `<span class="chip" data-q="${esc(q)}">${esc(q)}</span>`).join('')}</span><button class="btn sm ghost" id="clr">🗑️ Wyczyść</button></div></div>`;
  const msgs = box.querySelector('#msgs');
  msgs.scrollTop = msgs.scrollHeight;
  const send = async (text) => {
    if (!text.trim()) return;
    msgs.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(text)}</div><div class="msg assistant muted" id="typing">Coach pisze…</div>`);
    msgs.scrollTop = msgs.scrollHeight;
    box.querySelector('#m').value = '';
    try {
      const r = await post('/coach/chat', { message: text });
      box.querySelector('#typing').outerHTML = `<div class="msg assistant">${esc(r.reply)}</div>`;
    } catch (e) {
      box.querySelector('#typing').outerHTML = `<div class="msg assistant bad">${esc(e.message)}</div>`;
    }
    msgs.scrollTop = msgs.scrollHeight;
  };
  box.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    send(box.querySelector('#m').value);
  };
  box.querySelector('#m').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(e.target.value);
    }
  });
  box.addEventListener('click', async (e) => {
    const q = e.target.closest('[data-q]');
    if (q) send(q.dataset.q);
    if (e.target.closest('#clr') && (await confirmBox('Wyczyścić rozmowę?'))) {
      await del('/coach/chat');
      chat(box);
    }
  });
}

async function plan(box) {
  box.innerHTML = `${store.coach.enabled ? '' : disabledNote()}<div class="panel mb row"><label class="field">Minut dziennie<select class="inp" id="min">${[15, 30, 45, 60, 90].map((m) => `<option ${m === 30 ? 'selected' : ''}>${m}</option>`).join('')}</select></label><button class="btn gold" id="go">${store.coach.enabled ? '🤖 Ułóż plan (AI)' : 'Ułóż plan'}</button>${store.coach.enabled ? '<button class="btn" id="rules">Plan z reguł</button>' : ''}</div><div id="out"></div>`;
  const run = async (rules) => {
    const out = box.querySelector('#out');
    out.innerHTML = '<p class="muted">Układam plan…</p>';
    try {
      const p = await post('/coach/plan', { minutes: Number(box.querySelector('#min').value), rules });
      out.innerHTML = `<div class="panel mb"><p>${esc(p.summary)}</p>${p.focus?.length ? `<h3>Cele tygodnia</h3><ul>${p.focus.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</div><div class="grid g3">${p.days.map((d) => `<div class="panel"><div class="row between"><b>${esc(d.day)}</b><span class="pill">${d.minutes} min</span></div><div class="gold small mb">${esc(d.theme)}</div><ul class="small">${d.tasks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('')}</div>`;
    } catch (e) {
      out.innerHTML = '';
      errorToast(e);
    }
  };
  box.querySelector('#go').onclick = () => run(false);
  box.querySelector('#rules')?.addEventListener('click', () => run(true));
}

async function quiz(box) {
  box.innerHTML = `<div class="panel mb"><p class="small muted">Pytania zbudowane z Twoich ostatnich błędów w trenerze — żeby utrwalić zasady, a nie tylko konkretne ręce.</p><div class="row"><button class="btn gold" id="rule">Quiz ze spotów</button>${store.coach.enabled ? '<button class="btn" id="ai">🤖 Quiz z zasad (AI)</button>' : ''}</div></div><div id="out"></div>`;
  const start = async (path) => {
    const out = box.querySelector('#out');
    out.innerHTML = '<p class="muted">Przygotowuję pytania…</p>';
    let q;
    try {
      q = await post(path);
    } catch (e) {
      out.innerHTML = '';
      return errorToast(e);
    }
    let score = 0;
    out.innerHTML = `<div class="panel"><h2>${esc(q.title)}</h2>${q.questions.map((x, i) => `<div class="mb qq" data-i="${i}"><p><b>${i + 1}. ${esc(x.q)}</b></p>${x.options.map((o, k) => `<button class="quiz-opt" data-k="${k}">${esc(o)}</button>`).join('')}<div class="small muted ex"></div></div>`).join('')}<div class="score"></div></div>`;
    let answered = 0;
    out.addEventListener('click', (e) => {
      const b = e.target.closest('.quiz-opt');
      if (!b || b.disabled) return;
      const wrap = b.closest('.qq');
      const item = q.questions[Number(wrap.dataset.i)];
      const k = Number(b.dataset.k);
      wrap.querySelectorAll('.quiz-opt').forEach((x, idx) => {
        x.disabled = true;
        if (idx === item.correctIndex) x.classList.add('right');
        else if (idx === k) x.classList.add('wrong');
      });
      wrap.querySelector('.ex').textContent = item.explanation;
      const ok = k === item.correctIndex;
      feedback(ok, false);
      if (ok) score++;
      answered++;
      if (answered === q.questions.length) out.querySelector('.score').innerHTML = `<h3>Wynik: ${score}/${q.questions.length}</h3>`;
    });
  };
  box.querySelector('#rule').onclick = () => start('/quizzes/mistakes');
  box.querySelector('#ai')?.addEventListener('click', () => start('/coach/mistake-quiz'));
}

export default {
  async render(root, { parts }) {
    try {
      store.coach = await get('/coach/status');
    } catch {
      /* zostaw poprzedni stan */
    }
    const tab = TABS.find((t) => t[0] === parts[0]) ? parts[0] : 'czat';
    root.innerHTML = `<h1>🤖 Coach AI</h1><div class="tabs">${TABS.map(([k, l]) => `<a href="#/coach/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div id="cb"></div>`;
    const map = { czat: chat, plan, quiz };
    await map[tab](root.querySelector('#cb'));
  },
};
