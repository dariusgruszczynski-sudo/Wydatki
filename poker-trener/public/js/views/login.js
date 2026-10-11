import { get, post } from '../api.js';
import { esc } from '../ui/dom.js';
import { errorToast } from '../ui/overlay.js';
import { loadProfile, refreshSummary } from '../store.js';
import { go } from '../router.js';

const AVATARS = ['♠️', '♥️', '♦️', '♣️', '🃏', '🦈', '🐟', '👑', '🎯', '🔥', '🌸', '🐺'];

export default {
  async render(root) {
    const profiles = await get('/profiles');
    root.innerHTML = `
      <div style="max-width:520px;margin:6vh auto 0">
        <div class="hero-banner center mb">
          <div style="font-size:3rem">♠️</div>
          <div class="big">Poker Trener</div>
          <div class="small" style="opacity:.85">ICM · push/fold · lekcje · symulator turnieju</div>
        </div>
        <div class="panel">
          <h2>Kto gra?</h2>
          <div class="list" id="plist">
            ${profiles.map((p) => `<div class="item click" data-id="${p.id}" data-pin="${p.hasPin ? 1 : 0}"><span style="font-size:1.4rem">${esc(p.avatar)}</span><b class="grow">${esc(p.name)}</b><span class="muted small">${p.hasPin ? '🔒 PIN' : ''}</span></div>`).join('')}
          </div>
          <div id="pinbox" class="hidden mt">
            <label class="field">PIN<input id="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" /></label>
            <button class="btn primary wide mt" id="login">Wejdź</button>
          </div>
          <details class="more mt"><summary>Nowy profil</summary><div>
            <label class="field">Nazwa<input id="nname" maxlength="30" /></label>
            <label class="field mt">PIN (opcjonalnie, 4–8 cyfr)<input id="npin" type="password" inputmode="numeric" maxlength="8" /></label>
            <div class="chips mt" id="avs">${AVATARS.map((a, i) => `<span class="chip ${i === 4 ? 'on' : ''}" data-a="${a}">${a}</span>`).join('')}</div>
            <button class="btn gold wide mt" id="create">Utwórz profil</button>
          </div></details>
        </div>
      </div>`;
    let chosen = null;
    let avatar = AVATARS[4];
    const enter = async (id, pin) => {
      try {
        await post('/profiles/login', { id, pin });
        await loadProfile();
        await refreshSummary();
        go('#/start');
      } catch (e) {
        errorToast(e);
      }
    };
    root.querySelector('#plist').addEventListener('click', (e) => {
      const it = e.target.closest('.item');
      if (!it) return;
      chosen = Number(it.dataset.id);
      root.querySelectorAll('#plist .item').forEach((x) => x.classList.toggle('good', x === it));
      if (it.dataset.pin === '1') {
        root.querySelector('#pinbox').classList.remove('hidden');
        root.querySelector('#pin').focus();
      } else enter(chosen);
    });
    root.querySelector('#login').onclick = () => enter(chosen, root.querySelector('#pin').value);
    root.querySelector('#pin').addEventListener('keydown', (e) => e.key === 'Enter' && enter(chosen, e.target.value));
    root.querySelector('#avs').addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      avatar = c.dataset.a;
      root.querySelectorAll('#avs .chip').forEach((x) => x.classList.toggle('on', x === c));
    });
    root.querySelector('#create').onclick = async () => {
      try {
        await post('/profiles', { name: root.querySelector('#nname').value, pin: root.querySelector('#npin').value || null, avatar });
        await loadProfile();
        await refreshSummary();
        go('#/start');
      } catch (e) {
        errorToast(e);
      }
    };
  },
};
