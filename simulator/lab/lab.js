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
    params[L.load.id] = L.load.value;
    return { step: 0, visited: {}, req: {}, reqChecked: false, est, graph: { nodes: [], edges: [] }, deep: { params, choices }, show: null };
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
  // На шаге дизайна решения углубления не действуют, но ползунок нагрузки общий.
  const deepFor = (stage) => (stage === 'deep' ? st.deep : { params: Object.assign({}, defaults.deep.params, { [L.load.id]: st.deep.params[L.load.id] }), choices: defaults.deep.choices });
  const analyzeG = (g, stage) => E.analyze(L, g, st.est, deepFor(stage), stage);
  const analyze = (stage) => analyzeG(st.graph, stage);

  // ---------- каркас ----------
  function init() {
    document.title = `Глава ${L.n}. ${L.title}`;
    $('#chapter').textContent = `Глава ${L.n}. ${L.title}`;
    const h = location.hash.slice(1), i = L.steps.findIndex((s) => s.id === h);
    if (i >= 0) st.step = i;
    renderSteps();
    renderStep();
  }

  function go(i) {
    st.visited[step().id] = true;
    st.step = Math.max(0, Math.min(L.steps.length - 1, i));
    selNode = selEdge = pendingFrom = null;
    save();
    try { history.replaceState(null, '', '#' + step().id); } catch (e) {}
    renderSteps();
    renderStep();
    window.scrollTo({ top: 0 });
  }

  function renderSteps() {
    $('#steps').innerHTML = L.steps.map((s, i) => `<button class="stp ${st.visited[s.id] && i !== st.step ? 'done' : ''}" data-i="${i}" aria-current="${i === st.step ? 'step' : 'false'}"><span class="num">${st.visited[s.id] && i !== st.step ? '✓' : i + 1}</span><span class="stt">${esc(s.title)}</span></button>`).join('<span class="sline" aria-hidden="true"></span>');
    $$('#steps .stp').forEach((b) => (b.onclick = () => go(+b.dataset.i)));
  }

  function nav() {
    const i = st.step, prev = L.steps[i - 1], next = L.steps[i + 1];
    return `<div class="pager">${prev ? `<button class="btn" data-go="${i - 1}">← ${esc(prev.title)}</button>` : '<span></span>'}${next ? `<button class="btn primary" data-go="${i + 1}">${esc(next.title)} →</button>` : ''}</div>`;
  }

  function head(s, intro, tips) {
    return `<section class="stage-head"><div class="eyebrow">Шаг ${st.step + 1} из ${L.steps.length}</div><h2>${esc(s.title)}</h2>${st.step === 0 ? `<p class="lead">${esc(L.intro)}</p>` : ''}<p>${esc(intro)}</p>
      ${tips ? `<div class="tips">${tips.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}</section>`;
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
    return `${head(step(), R.intro)}<section class="card">
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
    return `${head(step(), L.estimate.intro)}<section class="card">
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
    return `${head(step(), A.intro)}<section class="card">
      <h4 class="grp first">Эндпоинты</h4><table class="tbl"><tbody>${A.endpoints.map(([m, p, t]) => `<tr><td><code>${esc(m)}</code></td><td><code>${esc(p)}</code></td><td>${esc(t)}</td></tr>`).join('')}</tbody></table>
      <h4 class="grp">Таблицы</h4><div class="tables">${A.tables.map((t) => `<div class="tcard"><b><code>${esc(t.name)}</code></b><div class="muted">${esc(t.fields)}</div><p>${esc(t.why)}</p></div>`).join('')}</div>
      <h4 class="grp">Проверь себя</h4><div class="quiz">${A.quiz.map((q) => `<details><summary>${esc(q.q)}</summary><p>${esc(q.a)}</p></details>`).join('')}</div></section>`;
  }

  // ---------- 4–5. Карта ----------
  const CAT = { edge: 'Вход', svc: 'Сервис', db: 'Хранилище', cache: 'В памяти', async: 'Асинхронно' };
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let scale = 1, zoom = 1, prevKpi = null, toastT = null;

  function mapView() {
    const s = step(), deep = s.stage === 'deep', ld = L.load;
    const intro = deep
      ? 'Схема та же, но теперь появляются проблемы. Выбирай решения в карточках под картой, крути нагрузку и пробуй необязательные блоки: метрики покажут, что стало лучше и что хуже.'
      : 'Собери архитектуру. Каждый поток должен дойти от клиента до своих данных. Попробуй и необязательные блоки: у каждого в палитре видно, что изменится, если его добавить.';
    return `${head(s, intro, ['Перетащи блок из палитры на карту или нажми на него', 'Тяни стрелку от кружка на краю блока', 'Нажми на блок, чтобы увидеть детали', 'Нажми на стрелку, чтобы удалить её'])}
      <div class="kpis" id="kpis"></div>
      <div class="lab-grid">
        <aside class="card pal-card"><h3>Палитра</h3><div id="pal"></div></aside>
        <section class="card mapcard" id="mapcard">
          <div class="toolbar">
            <label class="load" title="${esc(ld.hint)}"><span>⚡ ${esc(ld.label)}</span><input type="range" id="load" min="${ld.min}" max="${ld.max}" step="${ld.step}" value="${st.deep.params[ld.id]}"><output id="loadOut">×${st.deep.params[ld.id]}</output></label>
            <div class="tb">
              <button class="ib" data-z="-1" aria-label="Уменьшить" title="Уменьшить">−</button><button class="ib" data-z="0" title="Вписать">⤢</button><button class="ib" data-z="1" aria-label="Увеличить" title="Увеличить">+</button>
              <button class="ib" id="full" title="Во весь экран">⛶</button>
              <button class="btn sm" id="ref">✨ Эталон</button><button class="btn sm ghost" id="clr">Очистить</button>
            </div>
          </div>
          <div class="legend" id="legend"></div>
          <div class="board-wrap" id="wrap">
            <div class="board" id="board" style="width:${W}px;height:${H}px">
              <svg id="edges" width="${W}" height="${H}" aria-hidden="true"><defs>
                <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" fill="var(--edge)"/></marker>
                <marker id="arrS" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" fill="var(--accent)"/></marker></defs><g id="eg"></g></svg>
              <div id="nodes"></div><button class="edel" id="edel" hidden aria-label="Удалить стрелку">×</button>
            </div>
            <div class="hint" id="hint" hidden></div>
            <div class="empty-map" id="emptyMap" hidden><b>Карта пустая</b><span>Перетащи сюда «Клиент» из палитры или нажми «✨ Эталон».</span></div>
            <aside class="insp" id="insp" hidden></aside>
          </div>
        </section>
      </div>
      ${deep ? '<h3 class="sec">Проблемы углубления</h3><div class="probs" id="probs"></div>' : ''}
      <div class="below">
        <section class="card"><h3>Цели</h3><div id="goals"></div></section>
        <section class="card"><h3>Подсказки</h3><div class="warns" id="warns"></div></section>
      </div>
      <div class="toast" id="toast" role="status" hidden></div>`;
  }

  function bindMap() {
    $('#ref').onclick = () => { loadRef(step().stage); toast('Разложена эталонная схема. Попробуй что-то изменить и посмотри на метрики.'); };
    $('#clr').onclick = () => { if (confirm('Убрать все блоки и стрелки с карты?')) { st.graph = { nodes: [], edges: [] }; selNode = null; changed(); } };
    $('#edel').onclick = () => { if (selEdge != null) { st.graph.edges.splice(selEdge, 1); selEdge = null; changed(); } };
    $('#load').oninput = (e) => { st.deep.params[L.load.id] = +e.target.value; $('#loadOut').textContent = '×' + e.target.value; save(); update(); };
    $$('[data-z]').forEach((b) => (b.onclick = () => { const z = +b.dataset.z; zoom = z ? Math.max(0.5, Math.min(1.8, zoom + z * 0.15)) : 1; fit(); drawEdges(); }));
    $('#full').onclick = () => { $('#mapcard').classList.toggle('full'); document.body.classList.toggle('noscroll'); fit(); drawEdges(); };
    fit();
    window.onresize = () => { if (step().kind === 'map') { fit(); drawEdges(); } };
    bindBoard();
    if (step().stage === 'deep') renderProbs();
    prevKpi = null;
    update();
  }

  // Доска рисуется в своих координатах W×H и масштабируется под ширину (плюс ручной зум).
  function fit() {
    const wrap = $('#wrap'), board = $('#board');
    scale = Math.max(0.45, Math.min(1, (wrap.clientWidth - 2) / W)) * zoom;
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
    selNode = null;
    changed();
  }

  function freePos([x, y]) {
    while (st.graph.nodes.some((n) => Math.abs(n.x - x) < 30 && Math.abs(n.y - y) < 30)) { x += 28; y += 28; }
    return [Math.max(0, Math.min(x, W - 180)), Math.max(0, Math.min(y, H - 120))];
  }

  function addNode(type, pos) {
    const res = E.addBlock(L, st.graph, type, freePos(pos || L.blocks[type].pos));
    const added = res.graph.edges.slice(st.graph.edges.length);
    st.graph = res.graph;
    selNode = res.id;
    const nm = (id) => L.blocks[st.graph.nodes.find((n) => n.id === id).type].name;
    toast(`Добавлен «${L.blocks[type].name}»` + (added.length ? `. Стрелки проведены сами: ${added.map((e) => nm(e.from) + ' → ' + nm(e.to)).join(', ')}. Лишние удали кликом.` : '. Проведи к нему стрелки.'));
    changed();
  }

  function toast(text) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = text; t.hidden = false; t.classList.remove('out');
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.classList.add('out'); toastT = setTimeout(() => (t.hidden = true), 300); }, 4200);
  }

  function changed() { save(); update(); }

  function update() {
    last = analyzeG(st.graph, step().stage);
    $('#emptyMap').hidden = st.graph.nodes.length > 0;
    renderNodes(last);
    drawEdges();
    renderPanels(last);
    renderPalette(last);
  }

  // ----- палитра с предпросмотром эффекта -----
  function effects(before, after) {
    const a = before, b = after, chips = [];
    const lat = (r, id) => { const f = r.flows.find((x) => x.id === id); return f && f.ok ? f.lat : null; };
    const dS = b.m.served - a.m.served;
    if (Math.abs(dS) > 0.005) chips.push([`выдерживаем ${dS > 0 ? '+' : '−'}${Math.round(Math.abs(dS) * 100)}%`, dS > 0]);
    [['view', 'просмотр'], ['book', 'бронь']].forEach(([id, label]) => {
      const x = lat(a, id), y = lat(b, id);
      if (x != null && y != null && Math.abs(y - x) >= 5) chips.push([`${label} ${y > x ? '+' : '−'}${ms(Math.abs(y - x))}`, y < x]);
      if (x == null && y != null) chips.push([`${label}: поток заработал`, true]);
    });
    if (step().stage === 'deep') L.metrics.forEach((k) => {
      const x = a.m[k.id] || 0, y = b.m[k.id] || 0;
      if (Math.abs(y - x) >= 1) chips.push([`${k.label.toLowerCase()} ${y > x ? '+' : '−'}${x ? Math.round((Math.abs(y - x) / x) * 100) + '%' : fmt(y - x)}`, y < x]);
    });
    const dC = b.m.cost - a.m.cost, dX = b.m.cx - a.m.cx;
    if (Math.abs(dC) >= 50) chips.push([`цена ${dC > 0 ? '+' : '−'}${money(Math.abs(dC)).replace('/мес', '')}`, dC < 0]);
    if (Math.abs(dX) >= 0.2) chips.push([`сложность ${dX > 0 ? '+' : '−'}${Math.abs(dX).toFixed(1)}`, dX < 0]);
    return chips;
  }

  function renderPalette(r) {
    const groups = [['Основные блоки', (b) => !b.extra], ['Попробовать', (b) => b.extra]];
    $('#pal').innerHTML = groups.map(([title, f]) => `<div class="pgroup"><div class="pgt">${title}</div>${Object.entries(L.blocks).filter(([, b]) => f(b)).map(([t, b]) => {
      const onMap = st.graph.nodes.some((n) => n.type === t);
      const chips = effects(r, analyzeG(E.addBlock(L, st.graph, t, [0, 0]).graph, step().stage));
      return `<button class="pi cat-${b.cat}" data-t="${t}" title="Перетащи на карту или нажми">
        <span class="pic">${b.icon}</span><span class="pin"><b>${esc(b.name)}</b>${onMap ? '<em>на карте</em>' : ''}<small>${esc(b.tag || '')}</small>
        <span class="chips">${chips.length ? chips.slice(0, 4).map(([t, good]) => `<span class="chip ${good ? 'good' : 'bad'}">${esc(t)}</span>`).join('') : '<span class="chip">сейчас без эффекта</span>'}</span></span></button>`;
    }).join('')}</div>`).join('');
    $$('#pal .pi').forEach(bindPaletteItem);
  }

  function bindPaletteItem(el) {
    let dragged = false;
    el.onclick = () => { if (dragged) { dragged = false; return; } addNode(el.dataset.t); };
    el.onpointerdown = (e) => {
      if (e.button > 0) return;
      const sx = e.clientX, sy = e.clientY;
      let ghost = null;
      const mv = (ev) => {
        if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        if (!ghost) { ghost = document.createElement('div'); ghost.className = 'dragghost cat-' + L.blocks[el.dataset.t].cat; ghost.innerHTML = `<span>${L.blocks[el.dataset.t].icon}</span>${esc(L.blocks[el.dataset.t].name)}`; document.body.appendChild(ghost); $('#wrap').classList.add('drop'); }
        ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
      };
      const up = (ev) => {
        removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
        if (!ghost) return;
        dragged = true; ghost.remove(); $('#wrap').classList.remove('drop');
        const r = $('#board').getBoundingClientRect(), w = $('#wrap').getBoundingClientRect();
        if (ev.clientX < w.left || ev.clientX > w.right || ev.clientY < w.top || ev.clientY > w.bottom) return;
        const snap = (v) => Math.round(v / 10) * 10;
        addNode(el.dataset.t, [snap((ev.clientX - r.left) / scale - 85), snap((ev.clientY - r.top) / scale - 30)]);
      };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    };
  }

  // ----- узлы и стрелки -----
  function renderNodes(r) {
    $('#nodes').innerHTML = st.graph.nodes.map((g) => {
      const n = r.nodes[g.id], b = n.def, hot = n === r.m.bottleneck && r.m.maxU > 0.7;
      const body = b.cap
        ? `<div class="meter"><i class="${cls(n.util)}" style="width:${Math.min(100, n.util * 100)}%"></i></div>
           <div class="nmx"><span>${fmt(n.load)} rps</span><b class="${cls(n.util)}">${Math.round(n.util * 100)}%</b></div>
           <div class="nf"><span class="pill" title="${esc(b.repLabel || 'реплик')}">×${n.rep}</span><span class="pill">${ms(b.lat * n.q)}</span>${n.badges.map((x) => `<span class="pill bd" title="${esc(x.title)}">${x.icon}</span>`).join('')}</div>`
        : `<div class="nf"><span class="pill">${fmt(Object.values(n.flows).reduce((s, v) => s + v, 0))} rps</span></div>`;
      return `<div class="node cat-${b.cat} ${hot ? 'hot' : ''} ${n.load || !b.cap ? '' : 'idle'} ${selNode === g.id ? 'sel' : ''}" data-id="${g.id}" style="left:${g.x}px;top:${g.y}px">
        <div class="nh"><span class="ni">${b.icon}</span><span class="nt"><b>${esc(b.name)}</b><small>${CAT[b.cat] || ''}${b.extra ? ' · необязательный' : ''}</small></span><button class="nx" data-del aria-label="Удалить ${esc(b.name)}" title="Удалить">×</button></div>
        ${body}
        <button class="port" data-port aria-label="Провести стрелку от «${esc(b.name)}»" title="Потяни к другому блоку"></button></div>`;
    }).join('');
  }

  function rectOf(id) {
    const el = $(`.node[data-id="${id}"]`);
    return el && { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }
  function clip(r, tx, ty, pad) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
    const s = Math.min(Math.abs((r.w / 2 + pad) / dx), Math.abs((r.h / 2 + pad) / dy));
    return [cx + dx * s, cy + dy * s];
  }
  function curve(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, h = Math.abs(dx) >= Math.abs(dy);
    const c1 = h ? [x1 + dx * 0.45, y1] : [x1, y1 + dy * 0.45], c2 = h ? [x2 - dx * 0.45, y2] : [x2, y2 - dy * 0.45];
    return `M${x1},${y1} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x2},${y2}`;
  }

  function drawEdges(temp) {
    const r = last, out = [];
    let delAt = null;
    st.graph.edges.forEach((e, i) => {
      const a = rectOf(e.from), b = rectOf(e.to);
      if (!a || !b) return;
      const [x1, y1] = clip(a, b.x + b.w / 2, b.y + b.h / 2, 3), [x2, y2] = clip(b, a.x + a.w / 2, a.y + a.h / 2, 7);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
      const loads = (r && r.edgeLoad[e.from + '>' + e.to]) || {};
      const fl = r.flows.filter((f) => loads[f.id] > 0 && (!st.show || st.show === f.id));
      const lines = fl.map((f, k) => {
        const o = (k - (fl.length - 1) / 2) * 6, v = loads[f.id], id = `p${i}_${k}`;
        const d = curve(x1 + nx * o, y1 + ny * o, x2 + nx * o, y2 + ny * o);
        const n = Math.max(1, Math.min(4, Math.round(1 + Math.log10(v + 1)))), dur = Math.max(0.9, 2.8 - 0.4 * Math.log10(v + 1));
        const dots = reduceMotion ? '' : Array.from({ length: n }, (_, j) => `<circle r="4" fill="${f.color}"><animateMotion dur="${dur}s" begin="-${((j * dur) / n).toFixed(2)}s" repeatCount="indefinite"><mpath href="#${id}"/></animateMotion></circle>`).join('');
        return `<path id="${id}" class="fl" d="${d}" style="stroke:${f.color}"><title>${esc(f.label)}: ${fmt(v)} rps</title></path>${dots}`;
      }).join('');
      const d = curve(x1, y1, x2, y2), sel = selEdge === i;
      out.push(`<g class="edge ${sel ? 'sel' : ''} ${fl.length ? 'live' : ''}" data-e="${i}"><path class="hit" d="${d}"/><path class="base" d="${d}" marker-end="url(#${sel ? 'arrS' : 'arr'})"/>${lines}</g>`);
      if (sel) delAt = [(x1 + x2) / 2, (y1 + y2) / 2];
    });
    if (temp) out.push(`<path class="temp" d="${curve(...temp)}"/>`);
    $('#eg').innerHTML = out.join('');
    const del = $('#edel');
    del.hidden = !delAt;
    if (delAt) { del.style.left = delAt[0] - 13 + 'px'; del.style.top = delAt[1] - 13 + 'px'; }
  }

  function hint(text) { const h = $('#hint'); h.hidden = !text; h.textContent = text || ''; }

  function select(id) {
    selNode = id; selEdge = null;
    $$('.node').forEach((n) => n.classList.toggle('sel', n.dataset.id === id));
    drawEdges(); renderInspector();
  }

  function bindBoard() {
    const board = $('#board');
    const pt = (e) => { const r = board.getBoundingClientRect(); return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]; };
    const addEdge = (from, to) => {
      if (from !== to && !st.graph.edges.some((e) => e.from === from && e.to === to)) st.graph.edges.push({ from, to });
      pendingFrom = null; hint(null); changed();
    };
    const drag = (onMove, onUp) => {
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
        $('#wrap').classList.add('linking');
        drag((ev) => { const [x, y] = pt(ev); if (Math.hypot(x - sx, y - sy) > 4) moved = true; drawEdges([a.x + a.w, a.y + a.h / 2, x, y]); }, (ev) => {
          $('#wrap').classList.remove('linking');
          const t = document.elementFromPoint(ev.clientX, ev.clientY), to = t && t.closest('.node');
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
        nodeEl.classList.add('drag');
        drag((ev) => {
          const [x, y] = pt(ev);
          if (Math.hypot(x - sx, y - sy) > 3) moved = true;
          g.x = Math.max(0, Math.min(W - nodeEl.offsetWidth, Math.round((ox + x - sx) / 10) * 10));
          g.y = Math.max(0, Math.min(H - nodeEl.offsetHeight, Math.round((oy + y - sy) / 10) * 10));
          nodeEl.style.left = g.x + 'px'; nodeEl.style.top = g.y + 'px';
          drawEdges();
        }, () => { nodeEl.classList.remove('drag'); if (moved) save(); select(g.id); });
        return;
      }
      const ge = e.target.closest('.edge');
      selEdge = ge ? +ge.dataset.e : null;
      if (!ge) { selNode = null; renderInspector(); $$('.node.sel').forEach((n) => n.classList.remove('sel')); }
      pendingFrom = null; hint(null);
      drawEdges();
    };
    board.onclick = (e) => {
      const d = e.target.closest('[data-del]');
      if (d) removeNode(d.closest('.node').dataset.id);
    };
    document.onkeydown = (e) => {
      if (step().kind !== 'map' || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'Escape') { pendingFrom = null; selEdge = null; hint(null); if ($('#mapcard').classList.contains('full')) $('#full').click(); drawEdges(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selEdge != null) { st.graph.edges.splice(selEdge, 1); selEdge = null; changed(); }
        else if (selNode) removeNode(selNode);
      }
    };
  }

  function removeNode(id) {
    st.graph.nodes = st.graph.nodes.filter((n) => n.id !== id);
    st.graph.edges = st.graph.edges.filter((x) => x.from !== id && x.to !== id);
    if (selNode === id) selNode = null;
    selEdge = null; changed();
  }

  // ----- панели -----
  function renderPanels(r) {
    const m = r.m, deep = step().stage === 'deep';
    const lat = (id) => { const f = r.flows.find((x) => x.id === id); return f && f.ok ? f.lat : null; };
    const tiles = [
      { k: 'served', label: 'Выдерживаем', v: m.served, show: Math.round(m.served * 100) + '%', cls: m.served >= 1 ? (m.maxU > 0.9 ? 'warn' : 'ok') : 'bad', sub: m.bottleneck ? 'узкое место: ' + m.bottleneck.def.name : 'нет нагрузки', better: 1 },
      { k: 'view', label: 'Просмотр', v: lat('view'), show: lat('view') == null ? '—' : ms(lat('view')), sub: 'задержка p50', better: -1 },
      { k: 'book', label: 'Бронь', v: lat('book'), show: lat('book') == null ? '—' : ms(lat('book')), sub: 'задержка p50', better: -1 },
      ...(deep ? L.metrics.map((x) => ({ k: x.id, label: x.label, v: m[x.id] || 0, show: fmt(m[x.id] || 0), cls: m[x.id] > 0 ? (x.bad ? 'bad' : 'warn') : 'ok', sub: 'в день', better: -1 })) : []),
      { k: 'cost', label: 'Стоимость', v: m.cost, show: money(m.cost).replace('/мес', ''), sub: 'в месяц, условно', better: -1 },
      { k: 'cx', label: 'Сложность', v: m.cx, show: m.cx.toFixed(1), cls: m.cx > 20 ? 'bad' : m.cx > 14 ? 'warn' : '', sub: 'условных баллов', better: -1 },
    ];
    const kp = {};
    $('#kpis').innerHTML = tiles.map((t) => {
      kp[t.k] = t.v;
      const p = prevKpi && prevKpi[t.k], dv = p != null && t.v != null ? t.v - p : 0;
      const rel = p ? Math.abs(dv / p) : Math.abs(dv);
      const delta = rel > 0.01 ? `<span class="dlt ${dv * t.better > 0 ? 'up' : 'down'}">${dv > 0 ? '▲' : '▼'}</span>` : '';
      return `<div class="kpi ${t.cls || ''}"><div class="k">${esc(t.label)}</div><div class="v">${esc(t.show)}${delta}</div><div class="s">${esc(t.sub)}</div></div>`;
    }).join('');
    prevKpi = kp;

    $('#legend').innerHTML = r.flows.filter((f) => !f.optional || f.ok).map((f) => `<button class="lg ${st.show === f.id ? 'on' : ''} ${f.ok ? '' : 'off'}" data-f="${f.id}" title="Показать только этот поток"><i style="background:${f.color}"></i>${esc(f.label)}<span>${fmt(f.rate)} rps · ${f.ok ? ms(f.lat) : 'не доходит'}</span></button>`).join('');
    $$('#legend .lg').forEach((b) => (b.onclick = () => { st.show = st.show === b.dataset.f ? null : b.dataset.f; save(); renderPanels(last); drawEdges(); }));

    const goals = L.goals[step().stage], done = goals.filter((g) => g.check(r)).length;
    $('#goals').innerHTML = `<div class="gprog"><i style="width:${(done / goals.length) * 100}%"></i></div><p class="muted">Выполнено ${done} из ${goals.length}${done === goals.length ? ' 🎉' : ''}</p>
      <ul class="goals">${goals.map((g) => { const ok = g.check(r); return `<li class="${ok ? 'done' : ''}"><span class="${ok ? 'y' : 'n'}">${ok ? '✔' : '○'}</span><span>${esc(g.text)}</span></li>`; }).join('')}</ul>`;
    const order = { bad: 0, warn: 1, info: 2 }, icon = { bad: '⛔', warn: '⚠️', info: '💡' };
    const ws = r.warnings.slice().sort((a, b) => order[a.lvl] - order[b.lvl]);
    $('#warns').innerHTML = ws.length ? ws.map((w) => `<div class="w ${w.lvl}"><span>${icon[w.lvl]}</span><span>${esc(w.text)}</span></div>`).join('') : '<div class="note">Пока всё спокойно.</div>';
    renderInspector();
  }

  function renderInspector() {
    const box = $('#insp'), g = st.graph.nodes.find((n) => n.id === selNode);
    box.hidden = !g;
    if (!g) return;
    // открываем с той стороны, где не стоит выбранный блок
    const wrap = $('#wrap');
    box.classList.toggle('left', (g.x + 85) * scale - wrap.scrollLeft > wrap.clientWidth / 2);
    const n = last.nodes[g.id], b = L.blocks[g.type];
    const flows = last.flows.filter((f) => n.flows[f.id] > 0), max = Math.max(...flows.map((f) => n.flows[f.id]), 1);
    const li = (a) => (a && a.length ? '<ul>' + a.map((t) => `<li>${esc(t)}</li>`).join('') + '</ul>' : '');
    box.innerHTML = `<div class="ih cat-${b.cat}"><span class="ni">${b.icon}</span><div><b>${esc(b.name)}</b><small>${CAT[b.cat] || ''}${b.extra ? ' · необязательный' : ''}</small></div><button class="nx" id="inspX" aria-label="Закрыть">×</button></div>
      <p>${esc(b.learn.what)}</p>
      ${b.cap ? `<div class="istats"><div><span>Нагрузка</span><b>${fmt(n.load)} / ${fmt(n.capTotal)} rps</b></div><div><span>Загрузка</span><b class="${cls(n.util)}">${Math.round(n.util * 100)}%</b></div><div><span>${esc(b.repLabel || 'Реплик')}</span><b>${n.rep}${n.rep >= n.maxRep ? ' (макс.)' : ''}</b></div><div><span>Задержка</span><b>${ms(b.lat * n.q)}</b></div></div>` : ''}
      ${flows.length ? `<h5>Какие потоки идут</h5>${flows.map((f) => `<div class="fbar"><span>${esc(f.label)}</span><i style="width:${(n.flows[f.id] / max) * 100}%;background:${f.color}"></i><b>${fmt(n.flows[f.id])}</b></div>`).join('')}` : '<p class="muted">Через блок не идёт ни один поток: проведи к нему стрелки.</p>'}
      ${b.learn.plus && b.learn.plus.length ? `<h5 class="plus">Что даёт</h5>${li(b.learn.plus)}` : ''}
      ${b.learn.minus && b.learn.minus.length ? `<h5 class="minus">Чем платим</h5>${li(b.learn.minus)}` : ''}
      <button class="btn sm ghost danger" id="inspDel">Убрать с карты</button>`;
    $('#inspX').onclick = () => select(null);
    $('#inspDel').onclick = () => removeNode(g.id);
  }

  function renderProbs() {
    const D = st.deep;
    $('#probs').innerHTML = L.problems.map((p, i) => {
      const cur = p.options.find((o) => o.v === D.choices[p.key]), solved = cur !== p.options[0];
      return `<article class="card prob ${solved ? 'solved' : ''}"><div class="ph"><span class="pnum">${i + 1}</span><h4>${p.icon} ${esc(p.title)}</h4></div><p class="pr">${esc(p.problem)}</p>
        ${(p.params || []).map((x) => sliderHtml(x, D.params[x.id], 'data-par')).join('')}
        ${p.hint ? `<p class="note">${esc(p.hint)}</p>` : ''}
        <div class="seg" role="radiogroup" aria-label="Решение">${p.options.map((o) => `<label class="opt ${o === cur ? 'on' : ''}"><input type="radio" name="${p.key}" value="${o.v}" ${o === cur ? 'checked' : ''}>${esc(o.label)}</label>`).join('')}</div>
        <p class="onote">${esc(cur.note)}</p>
        <details><summary>🗣️ Как сказать на интервью</summary><p>${esc(p.say)}</p></details></article>`;
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
    return `${head(step(), 'Собери всё вместе: короткий рассказ для интервью, твой прогресс и вопросы для повторения.')}<section class="card">
      <h4 class="grp first">Рассказ на интервью по шагам</h4><ol class="script">${S.script.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
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
