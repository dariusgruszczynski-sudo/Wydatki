import { get, post, del } from '../api.js';
import { settings, saveSettings } from '../store.js';
import { esc, fmt, dateOnly } from '../ui/dom.js';
import { lineChart } from '../ui/charts.js';
import { errorToast, toast } from '../ui/overlay.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function render(root) {
  const b = await get('/bankroll');
  const s = b.summary;
  const st = settings();
  const statusTxt = { ok: ['ok', 'Twoje średnie wpisowe mieści się w zasadzie bankrollu.'], warning: ['warn', 'Grasz trochę za wysoko względem bankrollu.'], danger: ['bad', 'Średnie wpisowe znacznie przekracza zasadę bankrollu — ryzyko bankructwa jest wysokie.'], unknown: ['muted', 'Dodaj pierwszą sesję, żeby zobaczyć ocenę.'] }[s.status];
  root.innerHTML = `
    <h1>💰 Bankroll</h1>
    <div class="panel mb"><div class="stats">
      <div class="stat"><span class="v">${fmt(s.bankroll, 2)}</span><span class="l">bankroll</span></div>
      <div class="stat"><span class="v ${s.profit >= 0 ? 'ok' : 'bad'}">${s.profit >= 0 ? '+' : ''}${fmt(s.profit, 2)}</span><span class="l">zysk</span></div>
      <div class="stat"><span class="v">${s.roi == null ? '—' : fmt(s.roi, 1) + '%'}</span><span class="l">ROI${s.reliable ? '' : ' (mało danych)'}</span></div>
      <div class="stat"><span class="v">${fmt(s.tournaments)}</span><span class="l">turniejów</span></div>
      <div class="stat"><span class="v">${fmt(s.abi, 2)}</span><span class="l">średnie wpisowe (ABI)</span></div>
      <div class="stat"><span class="v">${fmt(s.maxAbi, 2)}</span><span class="l">maks. ABI (zasada ${s.rule})</span></div>
      ${s.hourly != null ? `<div class="stat"><span class="v">${fmt(s.hourly, 2)}</span><span class="l">na godzinę</span></div>` : ''}
    </div><p class="small ${statusTxt[0]} mt">${statusTxt[1]}</p>${!s.reliable && s.tournaments ? '<p class="tiny muted">ROI z mniej niż 300 turniejów to głównie wariancja — oceniaj grę po jakości decyzji.</p>' : ''}</div>
    <div class="grid g2">
      <div class="panel"><h3>Krzywa bankrollu</h3>${lineChart(b.curve.map((c) => ({ ...c, v: c.bankroll })), { key: 'v', label: (p) => p.day.slice(5), fmtY: (v) => fmt(v, 0) })}</div>
      <div class="panel"><h3>Dodaj sesję</h3><form id="f" class="grid g2">
        <label class="field">Data<input class="inp" type="date" name="day" value="${today()}"></label>
        <label class="field">Serwis<input class="inp" name="site" placeholder="np. PokerStars"></label>
        <label class="field">Liczba turniejów<input class="inp" type="number" name="tournaments" min="1" value="3"></label>
        <label class="field">Suma wpisowych<input class="inp" type="number" step="0.01" name="buyins" required></label>
        <label class="field">Suma wygranych<input class="inp" type="number" step="0.01" name="cashes" value="0"></label>
        <label class="field">Godziny<input class="inp" type="number" step="0.25" name="hours"></label>
        <label class="field" style="grid-column:1/-1">Notatki<input class="inp" name="notes"></label>
        <button class="btn gold" type="submit">Zapisz sesję</button></form></div>
      <div class="panel"><h3>Planer sesji</h3>
        <div class="grid g2"><label class="field">Ile turniejów?<input class="inp" id="pn" type="number" value="3" min="1"></label><label class="field">Wpisowe za turniej<input class="inp" id="pa" type="number" step="0.01" value="${fmt(s.abi || 5, 2).replace(',', '.')}"></label></div>
        <div id="pout" class="small mt"></div>
        <h3 class="mt">Ustawienia</h3>
        <div class="grid g2"><label class="field">Bankroll startowy<input class="inp" id="sb" type="number" step="0.01" value="${st.startingBankroll}"></label>
        <label class="field">Zasada (ile ABI w bankrollu)<select class="inp" id="rule">${[50, 100, 150, 200, 300].map((r) => `<option ${Number(st.bankrollRule) === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label></div>
        <button class="btn sm mt" id="saveset">Zapisz ustawienia</button></div>
      <div class="panel"><h3>Sesje</h3>${b.sessions.length ? `<div class="list">${b.sessions.map((x) => `<div class="item"><div><b>${dateOnly(x.day)}</b> ${esc(x.site || '')}<div class="small muted">${x.tournaments} turn. · wpisowe ${fmt(x.buyins, 2)} · wygrane ${fmt(x.cashes, 2)}${x.hours ? ` · ${x.hours} h` : ''}${x.notes ? ` · ${esc(x.notes)}` : ''}</div></div><span class="${x.cashes - x.buyins >= 0 ? 'ok' : 'bad'} nowrap">${x.cashes - x.buyins >= 0 ? '+' : ''}${fmt(x.cashes - x.buyins, 2)}</span><button class="btn sm ghost" data-del="${x.id}">🗑️</button></div>`).join('')}</div>` : '<p class="small muted">Brak sesji.</p>'}</div>
    </div>`;
  const plan = () => {
    const n = Number(root.querySelector('#pn').value) || 1;
    const a = Number(root.querySelector('#pa').value) || 0;
    const ok = a <= s.maxAbi;
    root.querySelector('#pout').innerHTML = `Koszt sesji: <b>${fmt(n * a, 2)}</b> (${s.bankroll ? fmt(((n * a) / s.bankroll) * 100, 1) : '—'}% bankrollu). ${ok ? '<span class="ok">✅ Wpisowe zgodne z zasadą.</span>' : `<span class="bad">⚠️ Wpisowe powyżej limitu ${fmt(s.maxAbi, 2)} — rozważ niższe stawki.</span>`}`;
  };
  root.querySelector('#pn').oninput = plan;
  root.querySelector('#pa').oninput = plan;
  plan();
  root.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await post('/bankroll/sessions', Object.fromEntries(new FormData(e.target)));
      toast('Zapisano sesję', 'ok');
      render(root);
    } catch (err) {
      errorToast(err);
    }
  };
  root.querySelector('#saveset').onclick = async () => {
    await saveSettings({ startingBankroll: Number(root.querySelector('#sb').value) || 0, bankrollRule: Number(root.querySelector('#rule').value) });
    render(root);
  };
  root.onclick = async (e) => {
    const d = e.target.closest('[data-del]');
    if (d) {
      await del(`/bankroll/sessions/${d.dataset.del}`);
      render(root);
    }
  };
}

export default { render };
