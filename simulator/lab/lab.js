/* Лаборатория главы: шаги как в книге (требования → оценка → API → дизайн → углубление → итог)
   и карта, где блоки перетаскиваются, соединяются стрелками, а по стрелкам идёт поток данных.
   Данные главы лежат в window.LAB (например, simulator/ch7/ch7.js). */
(function () {
  const L = window.LAB, E = window.LabEngine;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'sd-lab-' + L.id;
  const W = L.board.w, H = L.board.h;

  function fmt(n) {
    if (!isFinite(n)) return '∞';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + ' млрд';
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' млн';
    if (a >= 1e4) return (n / 1e3).toFixed(0) + ' тыс';
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + ' тыс';
    if (a >= 100) return n.toFixed(0);
    if (a >= 10) return n.toFixed(1).replace(/\.0$/, '');
    return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') || '0';
  }
  const ms = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + ' с' : Math.round(n) + ' мс');
  const money = (n) => '$' + (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Math.round(n)) + '/мес';
  const cls = (u) => (u > 0.9 ? 'bad' : u > 0.7 ? 'warn' : '');

  // ---------- состояние ----------
  function fresh() {
    const est = {}, params = {}, choices = {};
    L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
    L.problems.forEach((p) => { (p.params || []).forEach((x) => (params[x.id] = x.value)); choices[p.key] = p.options[0].v; });
    return { step: 0, req: {}, reqChecked: false, est, graph: { nodes: [], edges: [] }, deep: { params, choices }, show: null };
  }
  const defaults = fresh();
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1) {
        const f = fresh();
        return Object.assign(f, s, { est: Object.assign(f.est, s.est), deep: { params: Object.assign(f.deep.params, s.deep.params), choices: Object.assign(f.deep.choices, s.deep.choices) } });
      }
    } catch (e) {}
    return fresh();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(Object.assign({ v: 1 }, st))); } catch (e) {} }
  let st = load();
  let selNode = null, selEdge = null, pendingFrom = null, last = null;

  const step = () => L.steps[st.step];
  const analyze = (stage) => E.analyze(L, st.graph, st.est, stage === 'deep' ? st.deep : defaults.deep, stage);

  // ---------- каркас ----------
  function init() {
    document.title = `Глава ${L.n}. ${L.title}`;
    $('#chapter').innerHTML = `<h2>Глава ${L.n}. ${esc(L.title)}</h2><p class="sub">${esc(L.subtitle)}</p><p>${esc(L.intro)}</p>`;
    const h = location.hash.slice(1), i = L.steps.findIndex((s) => s.id === h);
    if (i >= 0) st.step = i;
    renderSteps();
    renderStep();
  }

  function go(i) {
    st.step = Math.max(0, Math.min(L.steps.length - 1, i));
    selNode = selEdge = pendingFrom = null;
    save();
    try { history.replaceState(null, '', '#' + step().id); } catch (e) {}
    renderSteps();
    renderStep();
    window.scrollTo({ top: 0 });
  }

  function renderSteps() {
    $('#steps').innerHTML = L.steps.map((s, i) => `<button class="stp" data-i="${i}" aria-current="${i === st.step ? 'step' : 'false'}"><span class="num">${i + 1}</span>${esc(s.title)}</button>`).join('');
    $$('#steps .stp').forEach((b) => (b.onclick = () => go(+b.dataset.i)));
  }

  function nav() {
    const i = st.step, prev = L.steps[i - 1], next = L.steps[i + 1];
    return `<div class="pager">${prev ? `<button class="btn" data-go="${i - 1}">← ${esc(prev.title)}</button>` : '<span></span>'}${next ? `<button class="btn primary" data-go="${i + 1}">${esc(next.title)} →</button>` : ''}</div>`;
  }

  function renderStep() {
    const s = step(), box = $('#app');
    box.innerHTML = ({ req: reqView, est: estView, api: apiView, map: mapView, sum: sumView }[s.kind])() + nav();
    $$('[data-go]', box).forEach((b) => (b.onclick = () => go(+b.dataset.go)));
    ({ req: bindReq, est: bindEst, api: () => {}, map: bindMap, sum: bindSum }[s.kind])();
  }

  // ---------- 1. Требования ----------
  function reqState(it, key) {
    const on = !!st.req[key];
    if (!st.reqChecked) return '';
    if (it.in) return on ? 'ok' : 'miss';
    return on ? 'wrong' : 'skip';
  }
  function reqScore() {
    let ok = 0, total = 0;
    L.requirements.groups.forEach((g, gi) => g.items.forEach((it, ii) => { total++; if (!!st.req[gi + '.' + ii] === it.in) ok++; }));
    return { ok, total };
  }
  function reqView() {
    const R = L.requirements, sc = reqScore();
    const mark = { ok: '✔ входит', miss: '○ пропущено', wrong: '✗ вне рамок', skip: '✔ верно, вне рамок' };
    return `<section class="card"><h3>1. Требования</h3><p>${esc(R.intro)}</p>
      ${R.groups.map((g, gi) => `<h4 class="grp">${esc(g.title)}</h4><div class="reqs">${g.items.map((it, ii) => {
        const k = gi + '.' + ii, s = reqState(it, k);
        return `<label class="ri ${s}"><input type="checkbox" data-k="${k}" ${st.req[k] ? 'checked' : ''}><span><b>${esc(it.text)}</b>${s ? `<small><em>${mark[s]}.</em> ${esc(it.why)}</small>` : ''}</span></label>`;
      }).join('')}</div>`).join('')}
      <div class="row-btns"><button class="btn primary" id="reqCheck">${st.reqChecked ? 'Скрыть ответы' : 'Проверить'}</button>${st.reqChecked ? `<span class="score">Верно ${sc.ok} из ${sc.total}</span>` : ''}</div>
      ${st.reqChecked ? `<div class="w info">${esc(R.conclusion)}</div>` : ''}</section>`;
  }
  function bindReq() {
    $$('.ri input').forEach((c) => (c.onchange = () => { st.req[c.dataset.k] = c.checked; save(); renderStep(); }));
    $('#reqCheck').onclick = () => { st.reqChecked = !st.reqChecked; save(); renderStep(); };
  }

  // ---------- 2. Оценка ----------
  function sliderHtml(i, v, attr) {
    return `<div class="slider"><label for="in_${i.id}"><span>${esc(i.label)}</span><output id="out_${i.id}">${fmt(v)} ${esc(i.unit)}</output></label>
      <input type="range" id="in_${i.id}" ${attr}="${i.id}" min="${i.min}" max="${i.max}" step="${i.step}" value="${v}"></div>`;
  }
  function estView() {
    return `<section class="card"><h3>2. Оценка нагрузки</h3><p>${esc(L.estimate.intro)}</p>
      <div class="est"><div>${L.estimate.inputs.map((i) => sliderHtml(i, st.est[i.id], 'data-est')).join('')}</div><div id="estOut"></div></div></section>`;
  }
  function renderEst() {
    const d = L.derive(st.est, defaults.deep);
    $('#estOut').innerHTML = `<table class="tbl"><thead><tr><th>Что считаем</th><th>Как</th><th>Итог</th></tr></thead><tbody>
      ${L.estimate.rows(d).map((r) => `<tr><td>${esc(r.label)}</td><td class="muted">${esc(r.formula)}</td><td class="num">${fmt(r.v)}</td></tr>`).join('')}</tbody></table>
      <div class="w info">${esc(L.estimate.conclusion(d))}</div>`;
  }
  function bindEst() {
    $$('[data-est]').forEach((el) => (el.oninput = () => {
      const i = L.estimate.inputs.find((x) => x.id === el.dataset.est);
      st.est[i.id] = +el.value; $('#out_' + i.id).textContent = fmt(+el.value) + ' ' + i.unit; save(); renderEst();
    }));
    renderEst();
  }

  // ---------- 3. API и данные ----------
  function apiView() {
    const A = L.api;
    return `<section class="card"><h3>3. API и модель данных</h3><p>${esc(A.intro)}</p>
      <h4 class="grp">Эндпоинты</h4><table class="tbl"><tbody>${A.endpoints.map(([m, p, t]) => `<tr><td><code>${esc(m)}</code></td><td><code>${esc(p)}</code></td><td>${esc(t)}</td></tr>`).join('')}</tbody></table>
      <h4 class="grp">Таблицы</h4><div class="tables">${A.tables.map((t) => `<div class="tcard"><b><code>${esc(t.name)}</code></b><div class="muted">${esc(t.fields)}</div><p>${esc(t.why)}</p></div>`).join('')}</div>
      <h4 class="grp">Проверь себя</h4><div class="quiz">${A.quiz.map((q) => `<details><summary>${esc(q.q)}</summary><p>${esc(q.a)}</p></details>`).join('')}</div></section>`;
  }

  // ---------- 4–5. Карта ----------
  function mapView() {
    const s = step(), deep = s.stage === 'deep';
    const intro = deep
      ? 'Схема та же, но теперь появляются проблемы. Выбирай решения в карточках под картой и смотри, как меняются метрики. Блоки и стрелки по-прежнему можно менять.'
      : 'Собери архитектуру: добавляй блоки из палитры, перетаскивай их и тяни стрелку от кружка справа на блоке к другому блоку. Каждый поток должен дойти от клиента до своих данных. Клик по стрелке выделяет её, × удаляет.';
    return `<section class="card"><h3>${st.step + 1}. ${esc(s.title)}</h3><p>${intro}</p></section>
      <div class="lab-grid">
        <div class="col">
          <section class="card"><h3>Карта</h3>
            <div class="palette" id="pal"></div>
            <div class="legend" id="legend"></div>
            <div class="hint" id="hint" hidden></div>
            <div class="board-wrap" id="wrap"><div class="board" id="board" style="width:${W}px;height:${H}px">
              <svg id="edges" width="${W}" height="${H}" aria-hidden="true"><defs>
                <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--muted)"/></marker></defs><g id="eg"></g></svg>
              <div id="nodes"></div><button class="edel" id="edel" hidden aria-label="Удалить стрелку">×</button>
            </div></div>
            ${!st.graph.nodes.length ? '<p class="empty" id="emptyMsg">Карта пустая. Начни с блока «Клиент» или нажми «Показать эталон».</p>' : ''}
          </section>
          ${deep ? '<div class="probs" id="probs"></div>' : ''}
        </div>
        <aside class="col">
          <section class="card"><h3>Итог</h3><div id="metrics"></div></section>
          <section class="card"><h3>Цели</h3><ul class="goals" id="goals"></ul></section>
          <section class="card"><h3>Подсказки</h3><div class="warns" id="warns"></div></section>
          <section class="card learn"><h3>Что это за блок</h3><div id="learn"></div></section>
        </aside>
      </div>`;
  }

  function bindMap() {
    $('#pal').innerHTML = Object.entries(L.blocks).map(([t, b]) => `<button class="pb" data-t="${t}" title="Добавить на карту"><span>${b.icon}</span>${esc(b.name)}</button>`).join('')
      + '<span class="sp"></span><button class="btn" id="ref">Показать эталон</button><button class="btn" id="clr">Очистить</button>';
    $$('#pal .pb').forEach((b) => (b.onclick = () => addNode(b.dataset.t)));
    $('#ref').onclick = () => { loadRef(step().stage); };
    $('#clr').onclick = () => { if (confirm('Убрать все блоки и стрелки с карты?')) { st.graph = { nodes: [], edges: [] }; changed(); } };
    $('#edel').onclick = () => { if (selEdge != null) { st.graph.edges.splice(selEdge, 1); selEdge = null; changed(); } };
    fit();
    window.onresize = () => { if (step().kind === 'map') { fit(); drawEdges(); } };
    bindBoard();
    if (step().stage === 'deep') renderProbs();
    update();
  }

  // Доска рисуется в своих координатах W×H и ужимается под ширину колонки (не мельче 0.6, дальше скролл).
  let scale = 1;
  function fit() {
    const wrap = $('#wrap'), board = $('#board');
    scale = Math.max(0.6, Math.min(1, (wrap.clientWidth - 2) / W));
    board.style.transform = `scale(${scale})`;
    board.style.marginBottom = `${H * scale - H}px`;
    board.style.marginRight = `${W * scale - W}px`;
  }

  function loadRef(stage) {
    const R = L.reference[stage];
    st.graph = {
      nodes: R.nodes.map((n) => { const [type, id, pos] = [].concat(n); const p = pos || L.blocks[type].pos; return { id: id || type, type, x: p[0], y: p[1] }; }),
      edges: R.edges.map(([from, to]) => ({ from, to })),
    };
    changed();
  }

  function addNode(type) {
    const used = new Set(st.graph.nodes.map((n) => n.id));
    let id = type, k = 2;
    while (used.has(id)) id = type + k++;
    let [x, y] = L.blocks[type].pos;
    while (st.graph.nodes.some((n) => Math.abs(n.x - x) < 20 && Math.abs(n.y - y) < 20)) { x += 24; y += 24; }
    st.graph.nodes.push({ id, type, x: Math.min(x, W - 170), y: Math.min(y, H - 100) });
    selNode = id;
    changed();
  }

  function changed() { save(); if ($('#emptyMsg') && st.graph.nodes.length) $('#emptyMsg').remove(); update(); }

  function update() {
    last = analyze(step().stage);
    renderNodes(last);
    drawEdges();
    renderPanels(last);
  }

  function renderNodes(r) {
    $('#nodes').innerHTML = st.graph.nodes.map((g) => {
      const n = r.nodes[g.id], b = n.def, hot = n === r.m.bottleneck && r.m.maxU > 0.7;
      const body = b.cap
        ? `<div class="bar"><i class="${cls(n.util)}" style="width:${Math.min(100, n.util * 100)}%"></i></div>
           <div class="nums"><span>${fmt(n.load)} / ${fmt(n.capTotal)} rps</span><span>${Math.round(n.util * 100)}%</span></div>
           <div class="note">${n.rep} ${esc(b.repLabel || 'репл.')} · ${ms(b.lat * n.q)}</div>`
        : '<div class="note">источник запросов</div>';
      return `<div class="node ${hot ? 'hot' : ''} ${selNode === g.id ? 'sel' : ''}" data-id="${g.id}" style="left:${g.x}px;top:${g.y}px">
        <div class="nh"><span class="ni">${b.icon}</span><span class="nn">${esc(b.name)}</span><button class="nx" data-del aria-label="Удалить ${esc(b.name)}">×</button></div>
        ${body}${n.badges.length ? `<div class="badges">${n.badges.map((x) => `<span title="${esc(x.title)}">${x.icon}</span>`).join('')}</div>` : ''}
        <button class="port" data-port aria-label="Провести стрелку от «${esc(b.name)}»" title="Потяни к другому блоку"></button></div>`;
    }).join('');
  }

  function rectOf(id) {
    const el = $(`.node[data-id="${id}"]`);
    return el && { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }
  function clip(r, tx, ty) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
    const s = Math.min(Math.abs((r.w / 2 + 4) / dx), Math.abs((r.h / 2 + 4) / dy));
    return [cx + dx * s, cy + dy * s];
  }

  function drawEdges(temp) {
    const r = last, out = [];
    let delAt = null;
    st.graph.edges.forEach((e, i) => {
      const a = rectOf(e.from), b = rectOf(e.to);
      if (!a || !b) return;
      const [x1, y1] = clip(a, b.x + b.w / 2, b.y + b.h / 2), [x2, y2] = clip(b, a.x + a.w / 2, a.y + a.h / 2);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
      const loads = (r && r.edgeLoad[e.from + '>' + e.to]) || {};
      const fl = r.flows.filter((f) => loads[f.id] > 0 && (!st.show || st.show === f.id));
      const lines = fl.map((f, k) => {
        const o = (k - (fl.length - 1) / 2) * 5, v = loads[f.id];
        const w = 1.5 + Math.min(4, Math.log10(v + 1)), dur = Math.max(0.35, 2.4 - Math.log10(v + 1) * 0.5);
        return `<line class="fl" x1="${x1 + nx * o}" y1="${y1 + ny * o}" x2="${x2 + nx * o}" y2="${y2 + ny * o}" style="stroke:${f.color};stroke-width:${w};animation-duration:${dur}s"><title>${esc(f.label)}: ${fmt(v)} rps</title></line>`;
      }).join('');
      out.push(`<g class="edge ${selEdge === i ? 'sel' : ''}" data-e="${i}"><line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line class="base" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#arr)"/>${lines}</g>`);
      if (selEdge === i) delAt = [(x1 + x2) / 2, (y1 + y2) / 2];
    });
    if (temp) out.push(`<line class="temp" x1="${temp[0]}" y1="${temp[1]}" x2="${temp[2]}" y2="${temp[3]}"/>`);
    $('#eg').innerHTML = out.join('');
    const del = $('#edel');
    del.hidden = !delAt;
    if (delAt) { del.style.left = delAt[0] - 12 + 'px'; del.style.top = delAt[1] - 12 + 'px'; }
  }

  function hint(text) { const h = $('#hint'); h.hidden = !text; h.textContent = text || ''; }

  function bindBoard() {
    const board = $('#board');
    const pt = (e) => { const r = board.getBoundingClientRect(); return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]; };
    const addEdge = (from, to) => {
      if (from !== to && !st.graph.edges.some((e) => e.from === from && e.to === to)) st.graph.edges.push({ from, to });
      pendingFrom = null; hint(null); changed();
    };
    const drag = (e, onMove, onUp) => {
      const mv = (ev) => onMove(ev), up = (ev) => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); onUp(ev); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    };

    board.onpointerdown = (e) => {
      if (e.button > 0) return;
      const nodeEl = e.target.closest('.node');
      if (e.target.closest('[data-del]') || e.target.closest('#edel')) return;
      if (pendingFrom && nodeEl) { addEdge(pendingFrom, nodeEl.dataset.id); return; }
      if (e.target.closest('[data-port]')) {
        e.preventDefault();
        const id = nodeEl.dataset.id, a = rectOf(id), [sx, sy] = pt(e);
        let moved = false;
        drag(e, (ev) => { const [x, y] = pt(ev); if (Math.hypot(x - sx, y - sy) > 4) moved = true; drawEdges([a.x + a.w, a.y + a.h / 2, x, y]); }, (ev) => {
          const t = document.elementFromPoint(ev.clientX, ev.clientY);
          const to = t && t.closest('.node');
          if (to && to.dataset.id !== id) addEdge(id, to.dataset.id);
          else if (!moved) { pendingFrom = id; hint('Теперь нажми на блок, куда ведёт стрелка. Esc отменяет.'); drawEdges(); }
          else drawEdges();
        });
        return;
      }
      if (nodeEl) {
        e.preventDefault();
        const g = st.graph.nodes.find((n) => n.id === nodeEl.dataset.id), [sx, sy] = pt(e), ox = g.x, oy = g.y;
        let moved = false;
        drag(e, (ev) => {
          const [x, y] = pt(ev);
          if (Math.hypot(x - sx, y - sy) > 3) moved = true;
          g.x = Math.max(0, Math.min(W - nodeEl.offsetWidth, ox + x - sx));
          g.y = Math.max(0, Math.min(H - nodeEl.offsetHeight, oy + y - sy));
          nodeEl.style.left = g.x + 'px'; nodeEl.style.top = g.y + 'px';
          drawEdges();
        }, () => {
          if (moved) save();
          selNode = g.id; selEdge = null;
          $$('.node').forEach((n) => n.classList.toggle('sel', n.dataset.id === g.id));
          drawEdges(); renderLearn();
        });
        return;
      }
      const ge = e.target.closest('.edge');
      selEdge = ge ? +ge.dataset.e : null;
      pendingFrom = null; hint(null);
      drawEdges();
    };
    board.onclick = (e) => {
      const d = e.target.closest('[data-del]');
      if (!d) return;
      const id = d.closest('.node').dataset.id;
      st.graph.nodes = st.graph.nodes.filter((n) => n.id !== id);
      st.graph.edges = st.graph.edges.filter((x) => x.from !== id && x.to !== id);
      if (selNode === id) selNode = null;
      selEdge = null; changed();
    };
    document.onkeydown = (e) => {
      if (step().kind !== 'map') return;
      if (e.key === 'Escape') { pendingFrom = null; selEdge = null; hint(null); drawEdges(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selEdge != null && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { st.graph.edges.splice(selEdge, 1); selEdge = null; changed(); }
    };
  }

  function renderPanels(r) {
    const m = r.m, deep = step().stage === 'deep';
    $('#legend').innerHTML = r.flows.map((f) => `<button class="lg ${st.show === f.id ? 'on' : ''} ${f.ok ? '' : 'off'}" data-f="${f.id}" title="Показать только этот поток"><i style="background:${f.color}"></i>${esc(f.label)} <span>${fmt(f.rate)} rps · ${f.ok ? ms(f.lat) : 'не доходит'}</span></button>`).join('');
    $$('#legend .lg').forEach((b) => (b.onclick = () => { st.show = st.show === b.dataset.f ? null : b.dataset.f; save(); renderPanels(last); drawEdges(); }));

    const served = m.served >= 1 ? (m.maxU > 0.9 ? 'warn' : 'ok') : 'bad';
    const extra = deep ? L.metrics.map((x) => { const v = m[x.id] || 0; return `<div class="m"><div class="k">${esc(x.label)}</div><div class="v ${v > 0 ? (x.bad ? 'bad' : 'warn') : 'ok'}">${fmt(v)}</div><div class="s">в день</div></div>`; }).join('') : '';
    $('#metrics').innerHTML = `<div class="metrics">
      <div class="m"><div class="k">Выдерживаем</div><div class="v ${served}">${Math.round(m.served * 100)}%</div><div class="s">${m.bottleneck ? 'узкое место: ' + esc(m.bottleneck.def.name) : 'нет нагрузки'}</div></div>
      <div class="m"><div class="k">Бронь, задержка</div><div class="v">${(() => { const b = r.flows.find((f) => f.id === 'book'); return b && b.ok ? ms(b.lat) : '—'; })()}</div><div class="s">p50, условно</div></div>
      ${extra}
      <div class="m"><div class="k">Стоимость</div><div class="v">${money(m.cost)}</div><div class="s">условно</div></div>
      <div class="m"><div class="k">Сложность</div><div class="v ${m.cx > 20 ? 'bad' : m.cx > 14 ? 'warn' : ''}">${m.cx.toFixed(1)}</div><div class="s">условных баллов</div></div></div>`;

    $('#goals').innerHTML = L.goals[step().stage].map((g) => { const ok = g.check(r); return `<li><span class="${ok ? 'y' : 'n'}">${ok ? '✔' : '○'}</span><span>${esc(g.text)}</span></li>`; }).join('');
    const order = { bad: 0, warn: 1, info: 2 };
    const ws = r.warnings.slice().sort((a, b) => order[a.lvl] - order[b.lvl]);
    $('#warns').innerHTML = ws.length ? ws.map((w) => `<div class="w ${w.lvl}">${esc(w.text)}</div>`).join('') : '<div class="note">Пока всё спокойно.</div>';
    renderLearn();
  }

  function renderLearn() {
    const g = st.graph.nodes.find((n) => n.id === selNode), b = g && L.blocks[g.type];
    $('#learn').innerHTML = b
      ? `<h4>${b.icon} ${esc(b.name)}</h4><h5>Что это</h5><p>${esc(b.learn.what)}</p><h5>Зачем</h5><p>${esc(b.learn.why)}</p>`
      : '<p class="empty">Нажми на блок на карте, чтобы узнать, что он делает.</p>';
  }

  function renderProbs() {
    const D = st.deep;
    $('#probs').innerHTML = L.problems.map((p) => {
      const cur = p.options.find((o) => o.v === D.choices[p.key]);
      return `<article class="card prob"><h4>${p.icon} ${esc(p.title)}</h4><p class="pr">${esc(p.problem)}</p>
        ${(p.params || []).map((x) => sliderHtml(x, D.params[x.id], 'data-par')).join('')}
        ${p.hint ? `<p class="note">${esc(p.hint)}</p>` : ''}
        <fieldset><legend>Решение</legend>${p.options.map((o) => `<label class="opt"><input type="radio" name="${p.key}" value="${o.v}" ${o === cur ? 'checked' : ''}>${esc(o.label)}</label>`).join('')}</fieldset>
        <p class="onote">${esc(cur.note)}</p>
        <details><summary>Как сказать на интервью</summary><p>${esc(p.say)}</p></details></article>`;
    }).join('');
    $$('#probs input[type=radio]').forEach((r) => (r.onchange = () => { D.choices[r.name] = r.value; save(); renderProbs(); update(); }));
    $$('#probs [data-par]').forEach((el) => (el.oninput = () => {
      const x = L.problems.flatMap((p) => p.params || []).find((q) => q.id === el.dataset.par);
      D.params[x.id] = +el.value; $('#out_' + x.id).textContent = fmt(+el.value) + ' ' + x.unit; save(); update();
    }));
  }

  // ---------- 6. Итог ----------
  function sumView() {
    const S = L.summary, sc = reqScore();
    const res = { base: analyze('base'), deep: analyze('deep') };
    const goals = (k) => L.goals[k].map((g) => { const ok = g.check(res[k]); return `<li><span class="${ok ? 'y' : 'n'}">${ok ? '✔' : '○'}</span><span>${esc(g.text)}</span></li>`; }).join('');
    return `<section class="card"><h3>6. Итог</h3>
      <h4 class="grp">Рассказ на интервью по шагам</h4><ol class="script">${S.script.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <div class="sum-grid">
        <div><h4 class="grp">Твой прогресс</h4><p>Требования: ${st.reqChecked ? `верно ${sc.ok} из ${sc.total}` : 'ещё не проверены'}.</p>
          <p class="muted">Высокоуровневый дизайн</p><ul class="goals">${goals('base')}</ul>
          <p class="muted">Углубление</p><ul class="goals">${goals('deep')}</ul></div>
        <div><h4 class="grp">Вопросы для повторения</h4><div class="quiz">${S.questions.map((q) => `<details><summary>${esc(q.q)}</summary><p>${esc(q.a)}</p></details>`).join('')}</div></div>
      </div>
      <div class="row-btns"><button class="btn" id="reset">Начать главу заново</button></div></section>`;
  }
  function bindSum() {
    $('#reset').onclick = () => { if (confirm('Сбросить ответы, карту и решения этой главы?')) { st = fresh(); save(); go(0); } };
  }

  init();
})();
