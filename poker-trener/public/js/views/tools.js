import { get, post, del, api } from '../api.js';
import { esc, fmt, money } from '../ui/dom.js';
import { gridHtml, attachEditor, rangePct } from '../ui/grid.js';
import { tableHtml } from '../ui/table.js';
import { cardsHtml } from '../ui/cards.js';
import { errorToast, toast } from '../ui/overlay.js';
import { evBarsHtml, rangesHtml } from './spotplayer.js';

const TABS = [
  ['icm', '🧮 Kalkulator ICM'],
  ['equity', '🎲 Equity'],
  ['zasiegi', '🔲 Edytor zasięgów'],
  ['sciagawki', '🖨️ Ściągawki'],
  ['spot', '🛠️ Własny spot'],
  ['dane', '💾 Eksport / backup'],
];

const POS_BY_N = {
  2: ['SB', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['CO', 'BTN', 'SB', 'BB'], 5: ['HJ', 'CO', 'BTN', 'SB', 'BB'], 6: ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  7: ['MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'], 8: ['UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'], 9: ['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};

async function icmTab(box) {
  const templates = await get('/tools/payout-templates');
  box.innerHTML = `<div class="grid g2"><div class="panel">
    <p class="small muted">Wpisz stosy graczy (żetony lub bb) i wypłaty pozostałych miejsc — dostaniesz wartość $ każdego stosu wg modelu ICM (Malmuth-Harville) i porównanie z „chip chop”.</p>
    <label class="field">Stosy (po przecinku)<input class="inp" id="st" value="5000, 3000, 2000"></label>
    <label class="field mt">Wypłaty (po przecinku)<input class="inp" id="pa" value="500, 300, 200"></label>
    <div class="row mt"><select class="inp" id="tpl" style="max-width:260px"><option value="">…albo wybierz szablon</option>${templates.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join('')}</select><input class="inp" id="pool" type="number" value="1000" style="max-width:120px" title="Pula"></div>
    <button class="btn gold mt" id="go">Policz</button></div>
    <div class="panel"><div id="out" class="muted small">Wynik pojawi się tutaj.</div></div></div>`;
  box.querySelector('#tpl').onchange = (e) => {
    const t = templates.find((x) => x.key === e.target.value);
    if (!t) return;
    const pool = Number(box.querySelector('#pool').value) || 1000;
    const n = box.querySelector('#st').value.split(',').filter((x) => x.trim()).length;
    box.querySelector('#pa').value = t.pct.slice(0, n).map((p) => Math.round((p / 100) * pool)).join(', ');
  };
  box.querySelector('#go').onclick = async () => {
    try {
      const nums = (s) => s.split(/[,;\s]+/).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
      const r = await post('/tools/icm', { stacks: nums(box.querySelector('#st').value), payouts: nums(box.querySelector('#pa').value) });
      box.querySelector('#out').innerHTML = `<table class="tbl"><thead><tr><th>Gracz</th><th>Stos</th><th>% żetonów</th><th>ICM $</th><th>% puli</th><th>Chip chop</th></tr></thead><tbody>${r.players
        .map((p, i) => `<tr><td>${i + 1}</td><td>${fmt(p.stack)}</td><td>${fmt(p.chipPct, 1)}%</td><td><b>${money(p.equity)}</b></td><td>${fmt(p.equityPct, 1)}%</td><td class="${p.equity > p.chipChop ? 'ok' : 'bad'}">${money(p.chipChop)}</td></tr>`)
        .join('')}</tbody></table><p class="small muted mt">Duże stosy są w ICM warte mniej niż ich udział w żetonach, krótkie — więcej. To dlatego lider nie powinien ryzykować bez wyraźnej przewagi.</p>`;
    } catch (e) {
      errorToast(e);
    }
  };
  box.querySelector('#go').click();
}

function equityTab(box) {
  box.innerHTML = `<div class="grid g2"><div class="panel">
    <p class="small muted">Ręce (np. <code>AhKd</code>) albo zasięgi (np. <code>QQ+, AKs, 22-55</code> lub <code>15%</code>). 2–6 graczy. Board opcjonalny (3–5 kart).</p>
    <div class="col" id="pl">${['AhKh', 'QQ+, AKo', ''].map((v, i) => `<label class="field">Gracz ${i + 1}<input class="inp pl" value="${v}"></label>`).join('')}</div>
    <div class="row mt"><button class="btn sm" id="add">+ gracz</button></div>
    <label class="field mt">Board<input class="inp" id="board" placeholder="np. Kd 7h 2c"></label>
    <button class="btn gold mt" id="go">Policz equity</button></div>
    <div class="panel"><div id="out" class="muted small">Wynik pojawi się tutaj.</div></div></div>`;
  box.querySelector('#add').onclick = () => {
    const n = box.querySelectorAll('.pl').length;
    if (n >= 6) return;
    box.querySelector('#pl').insertAdjacentHTML('beforeend', `<label class="field">Gracz ${n + 1}<input class="inp pl"></label>`);
  };
  box.querySelector('#go').onclick = async () => {
    const out = box.querySelector('#out');
    out.innerHTML = 'Liczę…';
    try {
      const r = await post('/tools/equity', { players: [...box.querySelectorAll('.pl')].map((i) => i.value).filter((v) => v.trim()), board: box.querySelector('#board').value });
      out.innerHTML = `${r.board.length ? `<div class="mb">${cardsHtml(r.board, { size: 'sm' })}</div>` : ''}${r.players
        .map((p) => `<div class="mb"><div class="row between"><b>${esc(p.label)}</b><b>${fmt(p.equity, 2)}%</b></div>${p.pct ? `<div class="tiny muted">zasięg ${p.pct}% rąk</div>` : ''}<div class="bar"><i style="width:${p.equity}%"></i></div></div>`)
        .join('')}<div class="tiny muted">${r.exact ? 'Wynik dokładny (wszystkie karty do rozdania)' : `Monte Carlo: ${fmt(r.samples)} symulacji`}</div>`;
    } catch (e) {
      out.innerHTML = '';
      errorToast(e);
    }
  };
}

async function rangesTab(box) {
  const selected = new Set();
  let saved = [];
  let redraw = () => {};
  box.addEventListener('click', async (e) => {
    const l = e.target.closest('[data-load]');
    if (l) {
      const r = saved.find((x) => x.id === Number(l.dataset.load));
      selected.clear();
      r.labels.forEach((x) => selected.add(x));
      box.querySelector('#name').value = r.name;
      redraw();
    }
    const d = e.target.closest('[data-del]');
    if (d) {
      await del(`/ranges/custom/${d.dataset.del}`);
      render();
    }
  });
  const render = async () => {
    saved = await get('/ranges/custom');
    box.innerHTML = `<div class="grid g2"><div class="panel">
      <div class="row between mb"><b>Zaznaczone: <span id="pct">${rangePct(selected)}</span>% rąk</b><button class="btn sm ghost" id="clr">Wyczyść</button></div>
      <div id="ed">${gridHtml({ layers: [{ labels: selected, cls: 'on3' }], edit: true })}</div>
      <div class="tiny muted mt">Kliknij albo przeciągnij po polach. Nad przekątną: suited, pod: offsuit.</div>
    </div><div class="panel">
      <label class="field">Wpisz zasięg tekstem<input class="inp" id="txt" placeholder="np. 22+, A2s+, KTs+, ATo+"></label>
      <div class="row mt"><button class="btn sm" id="parse">Zaznacz z tekstu</button><input class="inp" id="topn" type="number" min="1" max="100" placeholder="top %" style="max-width:100px"><button class="btn sm" id="top">Top %</button></div>
      <label class="field mt">Nazwa<input class="inp" id="name" placeholder="np. Mój shove SB 10bb"></label>
      <button class="btn gold mt" id="save">💾 Zapisz zasięg</button>
      <h3 class="mt">Zapisane</h3>
      ${saved.length ? `<div class="list">${saved.map((r) => `<div class="item"><span class="click" data-load="${r.id}"><b>${esc(r.name)}</b> <span class="small muted">${r.pct}%</span></span><button class="btn sm ghost" data-del="${r.id}">🗑️</button></div>`).join('')}</div>` : '<p class="small muted">Brak zapisanych zasięgów.</p>'}
    </div></div>`;
    const ed = box.querySelector('#ed');
    attachEditor(ed, selected, () => (box.querySelector('#pct').textContent = rangePct(selected)));
    redraw = () => {
      ed.innerHTML = gridHtml({ layers: [{ labels: selected, cls: 'on3' }], edit: true });
      attachEditor(ed, selected, () => (box.querySelector('#pct').textContent = rangePct(selected)));
      box.querySelector('#pct').textContent = rangePct(selected);
    };
    box.querySelector('#clr').onclick = () => {
      selected.clear();
      redraw();
    };
    box.querySelector('#parse').onclick = async () => {
      try {
        const r = await post('/ranges/parse', { text: box.querySelector('#txt').value });
        r.labels.forEach((l) => selected.add(l));
        redraw();
      } catch (e) {
        errorToast(e);
      }
    };
    box.querySelector('#top').onclick = async () => {
      const r = await post('/ranges/top', { pct: Number(box.querySelector('#topn').value) });
      selected.clear();
      r.labels.forEach((l) => selected.add(l));
      redraw();
    };
    box.querySelector('#save').onclick = async () => {
      try {
        await post('/ranges/custom', { name: box.querySelector('#name').value, labels: [...selected] });
        toast('Zapisano zasięg', 'ok');
        render();
      } catch (e) {
        errorToast(e);
      }
    };
  };
  render();
}

async function chartsTab(box) {
  const c = await get('/ranges/charts');
  const block = (title, rows, cls) => `<div class="panel"><h3>${title}</h3><div class="grid g3">${rows
    .map((r) => r.cells.map((cell, i) => `<div><div class="small"><b>${esc(c.groups.find((g) => g.key === r.group).label)}</b> · ${c.buckets[i]} · ${cell.pct}%</div>${gridHtml({ layers: [{ labels: cell.labels, cls }] })}</div>`).join(''))
    .join('')}</div></div>`;
  box.innerHTML = `<div class="row between mb no-print"><p class="small muted">Orientacyjne zasięgi z modelu aplikacji (bez ICM). Wydrukuj albo zapisz jako PDF.</p><button class="btn gold" onclick="window.print()">🖨️ Drukuj / PDF</button></div>
    <div class="tabs no-print" id="ct"><button class="on" data-c="shove">Open shove</button><button data-c="call">Call vs shove (BB)</button><button data-c="rfi">Otwarcia deep</button></div>
    <div id="cc"></div>`;
  const show = (k) => {
    const cc = box.querySelector('#cc');
    if (k === 'shove') cc.innerHTML = block('Open shove — % rąk wg pozycji i stosu', c.shove, 'on');
    if (k === 'call') cc.innerHTML = block('Call na BB vs shove z pozycji', c.call, 'on3');
    if (k === 'rfi') cc.innerHTML = `<div class="panel"><h3>Otwarcia (RFI) przy 40–100bb</h3><div class="grid g3">${c.rfi.map((r) => `<div><div class="small"><b>${r.pos}</b> · ${r.pct}%</div>${gridHtml({ layers: [{ labels: r.labels, cls: 'on3' }] })}</div>`).join('')}</div></div>`;
    box.querySelectorAll('#ct button').forEach((b) => b.classList.toggle('on', b.dataset.c === k));
  };
  box.querySelector('#ct').onclick = (e) => e.target.dataset.c && show(e.target.dataset.c);
  show('shove');
}

async function spotTab(box) {
  const templates = await get('/tools/payout-templates');
  const draw = () => {
    const n = Number(box.querySelector('#n')?.value || 6);
    const pos = POS_BY_N[n];
    return `<div class="grid g2"><div class="panel">
      <p class="small muted">Odtwórz sytuację z prawdziwego turnieju i sprawdź ją w modelu ICM.</p>
      <div class="grid g2">
        <label class="field">Graczy przy stole<select class="inp" id="n">${[2, 3, 4, 5, 6, 7, 8, 9].map((x) => `<option ${x === n ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="field">Typ<select class="inp" id="type"><option value="facing_shove">Call vs shove</option><option value="open_shove">Open shove (pierwszy do akcji)</option></select></label>
        <label class="field">Twoja pozycja<select class="inp" id="hp">${pos.map((p) => `<option ${p === 'BB' ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label class="field">Shover (dla call vs shove)<select class="inp" id="vp">${pos.map((p, i) => `<option ${i === Math.max(0, pos.length - 3) ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label class="field">Twoje karty<input class="inp" id="hc" value="AhJd"></label>
        <label class="field">Ante<select class="inp" id="ante"><option value="bb_ante">BB ante</option><option value="classic">klasyczne</option><option value="none">brak</option></select></label>
      </div>
      <div class="field mt">Stosy (bb) wg pozycji<div class="grid g3">${pos.map((p) => `<label class="field">${p}<input class="inp stk" data-p="${p}" type="number" step="0.5" value="${p === 'BB' ? 20 : 15}"></label>`).join('')}</div></div>
      <div class="grid g2 mt">
        <label class="field">Wypłaty (szablon)<select class="inp" id="tpl"><option value="">chip EV (bez wypłat)</option>${templates.map((t) => `<option value="${t.key}" ${t.key === 'mtt_top' ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
        <label class="field">Pula ($)<input class="inp" id="pool" type="number" value="1000"></label>
        <label class="field">Albo własne wypłaty<input class="inp" id="pays" placeholder="np. 500, 300, 200"></label>
        <label class="field">Zasięg przeciwnika (opcjonalnie)<input class="inp" id="vr" placeholder="np. 22+, A2s+, KTs+"></label>
        <label class="field">Typ przeciwnika<select class="inp" id="ot"><option value="reg">Regular</option><option value="nit">Nit</option><option value="lag">LAG</option><option value="maniac">Maniak</option><option value="fish">Rekreacyjny</option></select></label>
      </div>
      <button class="btn gold mt" id="go">Przelicz spot</button></div>
      <div class="panel" id="out"><p class="muted small">Wynik pojawi się tutaj.</p></div></div>`;
  };
  box.innerHTML = draw();
  const bind = () => {
    box.querySelector('#n').onchange = () => {
      box.innerHTML = draw();
      bind();
    };
    box.querySelector('#go').onclick = async () => {
      const out = box.querySelector('#out');
      out.innerHTML = '<p class="muted">Liczę…</p>';
      const pays = box.querySelector('#pays').value.split(/[,;\s]+/).map(Number).filter((x) => x > 0);
      try {
        const r = await post('/spots/custom', {
          numPlayers: Number(box.querySelector('#n').value),
          type: box.querySelector('#type').value,
          heroPos: box.querySelector('#hp').value,
          villainPos: box.querySelector('#vp').value,
          stacks: [...box.querySelectorAll('.stk')].map((i) => Number(i.value)),
          heroCards: box.querySelector('#hc').value,
          anteMode: box.querySelector('#ante').value,
          templateKey: pays.length ? null : box.querySelector('#tpl').value || null,
          payouts: pays.length ? pays : null,
          poolTotal: Number(box.querySelector('#pool').value) || 1000,
          villainRange: box.querySelector('#vr').value || null,
          oppType: box.querySelector('#ot').value,
        });
        const res = r.result;
        out.innerHTML = `${tableHtml(r.spot, { compact: true })}<div class="hero-hand">${cardsHtml(r.spot.heroCombo)}</div><div class="result ${res.close ? 'close' : 'good'}"><div class="verdict">Najlepiej: ${res.optimal === 'fold' ? 'Pas' : res.optimal === 'call' ? 'Call' : 'All-in'}${res.close ? ' (granicznie)' : ''}</div>${evBarsHtml(res, r.spot)}<ul class="explain">${res.explanation.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div><details class="more"><summary>Zasięg przeciwnika</summary><div>${rangesHtml(res, r.spot)}</div></details>`;
      } catch (e) {
        out.innerHTML = '';
        errorToast(e);
      }
    };
  };
  bind();
}

function dataTab(box) {
  box.innerHTML = `<div class="grid g2"><div class="panel"><h3>Eksport</h3><p class="small muted">Pełny backup profilu (JSON) albo dane do arkusza (CSV).</p>
    <div class="col"><a class="btn" href="/api/export.json">💾 Backup JSON (wszystko)</a><a class="btn" href="/api/export/attempts.csv">📄 Decyzje z trenera (CSV)</a><a class="btn" href="/api/export/hands.csv">📄 Zaimportowane ręce (CSV)</a></div></div>
    <div class="panel"><h3>Import backupu</h3><p class="small muted">Wczytaj plik JSON z eksportu — dane zostaną dopisane do bieżącego profilu (bez duplikatów tam, gdzie to możliwe).</p>
    <input type="file" id="f" accept="application/json,.json" class="inp"><button class="btn gold mt" id="imp">Importuj</button><div id="res" class="small mt"></div></div></div>`;
  box.querySelector('#imp').onclick = async () => {
    const f = box.querySelector('#f').files[0];
    if (!f) return toast('Wybierz plik');
    try {
      const data = JSON.parse(await f.text());
      const r = await api('/import.json', { method: 'POST', body: data });
      box.querySelector('#res').innerHTML = `✅ Zaimportowano: ${Object.entries(r.imported).map(([k, v]) => `${k}: ${v}`).join(', ') || 'nic nowego'}`;
    } catch (e) {
      errorToast(e);
    }
  };
}

export default {
  async render(root, { parts }) {
    const tab = TABS.find((t) => t[0] === parts[0]) ? parts[0] : 'icm';
    root.innerHTML = `<h1>🧮 Narzędzia</h1><div class="tabs no-print">${TABS.map(([k, l]) => `<a href="#/narzedzia/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div id="tool"></div>`;
    const box = root.querySelector('#tool');
    const map = { icm: icmTab, equity: equityTab, zasiegi: rangesTab, sciagawki: chartsTab, spot: spotTab, dane: dataTab };
    await map[tab](box);
  },
};
