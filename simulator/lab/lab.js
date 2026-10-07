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
  const pct = (u) => (u < 10 ? Math.round(u * 100) + '%' : '×' + fmt(u)); // ×1800 читается легче, чем 180 000%
  const cls = (u) => (u > 0.9 ? 'bad' : u > 0.7 ? 'warn' : '');

  // ---------- состояние ----------
  function fresh() {
    const est = {}, params = {}, choices = {};
    L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
    L.problems.forEach((p) => { (p.params || []).forEach((x) => (params[x.id] = x.value)); if (p.options) choices[p.key] = p.options[0].v; });
    L.scenario.forEach((x) => (params[x.id] = x.value));
    return { step: 0, visited: {}, req: {}, reqChecked: false, est, graph: { nodes: [], edges: [] }, deep: { params, choices }, show: null, palClosed: {} };
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
  L.scenario.forEach((x) => { const v = st.deep.params[x.id]; if (!x.stops.includes(v)) st.deep.params[x.id] = x.stops.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)); });
  let selNode = null, selEdge = null, pendingFrom = null, last = null;

  const step = () => L.steps[st.step];
  // На шаге дизайна решения углубления не действуют, но сценарий нагрузки (пик и рост) общий для всех шагов.
  const scn = () => Object.fromEntries(L.scenario.map((x) => [x.id, st.deep.params[x.id]]));
  const deepFor = (stage) => (stage === 'deep' ? st.deep : { params: Object.assign({}, defaults.deep.params, scn()), choices: defaults.deep.choices });
  const scnText = () => L.scenario.map((x) => `${x.label.toLowerCase()} ${x.unit}${st.deep.params[x.id]}`).join(', ');
  // Эталон под тот же сценарий и те же решения, что у ученика; считается только при их изменении.
  let refMemo = {};
  const refFor = (stage) => { const k = JSON.stringify([stage, st.est, deepFor(stage)]); return refMemo[k] || (refMemo = { [k]: E.adapt(L, stage, st.est, deepFor(stage)) })[k]; };
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
    $('#steps').innerHTML = L.steps.map((s, i) => { const done = st.visited[s.id] && i !== st.step;
      return `<button class="stp ${done ? 'done' : ''}" data-i="${i}" aria-current="${i === st.step ? 'step' : 'false'}"><span class="num">${done ? '✓' : i + 1}</span><span class="stt"><b>${esc(s.title)}</b><small>${esc(s.sub || '')}</small></span></button>`; }).join('<span class="sline" aria-hidden="true"></span>');
    $$('#steps .stp').forEach((b) => (b.onclick = () => go(+b.dataset.i)));
  }

  function nav() {
    const i = st.step, prev = L.steps[i - 1], next = L.steps[i + 1];
    return `<div class="pager">${prev ? `<button class="btn" data-go="${i - 1}">← ${esc(prev.title)}</button>` : '<span></span>'}${next ? `<button class="btn primary" data-go="${i + 1}">${esc(next.title)} →</button>` : ''}</div>`;
  }

  function head(s, intro, tips) {
    return `<section class="stage-head"><div class="sh"><span class="snum">${st.step + 1}</span><h2>${esc(s.title)}</h2><span class="spill">${esc(s.sub || '')}</span><span class="muted">шаг ${st.step + 1} из ${L.steps.length}</span></div>
      ${st.step === 0 ? `<p class="lead">${esc(L.intro)}</p>` : ''}<p>${esc(intro)}</p>
      ${tips ? `<div class="tips">${tips.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}</section>`;
  }

  // Боковая панель: вся глава по шагам, текущий подсвечен
  function guide() {
    return `<aside class="side card"><h3 class="side-t">🧭 Как пройти главу</h3><div class="side-sub">ГЛАВА ПО ШАГАМ</div>
      <ol class="tl">${L.steps.map((s, i) => `<li class="${i === st.step ? 'cur' : st.visited[s.id] ? 'done' : ''}"><span class="tn">${st.visited[s.id] && i !== st.step ? '✓' : i + 1}</span><div>
        <span class="tag">${esc(s.tag || '')}</span><b data-go="${i}" role="link" tabindex="0">${esc(s.title)}</b><p>${esc(s.guide || '')}</p></div></li>`).join('')}</ol></aside>`;
  }

  function renderStep() {
    const s = step(), box = $('#app');
    const body = ({ req: reqView, est: estView, api: apiView, map: mapView, sum: sumView }[s.kind])() + nav();
    box.innerHTML = s.kind === 'map' ? body : `<div class="page"><div class="main">${body}</div>${guide()}</div>`;
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
  // Ползунок сценария ходит по stops (1, 2, 5, 10 …), чтобы и ×2, и ×1000 были под рукой.
  function scnHtml(x) {
    const v = st.deep.params[x.id], i = Math.max(0, x.stops.indexOf(v));
    return `<label class="load" title="${esc(x.hint)}"><span>${esc(x.label)}</span><input type="range" data-scn="${x.id}" min="0" max="${x.stops.length - 1}" step="1" value="${i}" aria-label="${esc(x.label)}"><output id="scn_${x.id}">${esc(x.unit)}${v}</output></label>`;
  }
  function bindScn(then) {
    $$('[data-scn]').forEach((el) => (el.oninput = () => {
      const x = L.scenario.find((q) => q.id === el.dataset.scn), v = x.stops[+el.value];
      st.deep.params[x.id] = v; $('#scn_' + x.id).textContent = x.unit + v; save(); then();
    }));
  }
  function estView() {
    return `${head(step(), L.estimate.intro)}<section class="card">
      <div class="est"><div>${L.estimate.inputs.map((i) => sliderHtml(i, st.est[i.id], 'data-est')).join('')}
        <div class="scn"><h4 class="grp">📐 Сценарий нагрузки</h4><p class="muted">Один на всю главу: по этим цифрам считаются карта, узкие места и эталон.</p>${L.scenario.map(scnHtml).join('')}</div></div>
      <div id="estOut"></div></div></section>`;
  }
  function renderEst() {
    const now = L.derive(st.est, { params: {} }), d = L.derive(st.est, { params: scn() });
    $('#estOut').innerHTML = `<table class="tbl"><thead><tr><th>Что считаем</th><th>Как</th><th>Сейчас</th><th>Сценарий</th></tr></thead><tbody>
      ${L.estimate.rows(now).map((r, i) => { const v = L.estimate.rows(d)[i].v * (r.peak ? d.k : 1);
        return `<tr><td>${esc(r.label)}</td><td class="muted">${esc(r.formula)}${r.peak && d.k > 1 ? ` × пик ${d.k}` : ''}</td><td class="num">${fmt(r.v)}</td><td class="num ${v > r.v ? 'up' : ''}">${fmt(v)}</td></tr>`; }).join('')}</tbody></table>
      <div class="w info">${esc(L.estimate.conclusion(d))}</div>`;
  }
  function bindEst() {
    $$('[data-est]').forEach((el) => (el.oninput = () => {
      const i = L.estimate.inputs.find((x) => x.id === el.dataset.est);
      st.est[i.id] = +el.value; $('#out_' + i.id).textContent = fmt(+el.value) + ' ' + i.unit; save(); renderEst();
    }));
    bindScn(renderEst);
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
  let scale = 1, zoom = 1, autoS = null, lastDpr = window.devicePixelRatio, prevKpi = null, toastT = null;

  function mapView() {
    const s = step(), deep = s.stage === 'deep';
    const intro = deep
      ? 'Схема та же, но теперь появляются проблемы. Выбирай решения в карточках под картой, крути нагрузку и пробуй необязательные блоки: метрики покажут, что стало лучше и что хуже.'
      : 'Собери архитектуру. Каждый поток должен дойти от клиента до своих данных. Попробуй и необязательные блоки: у каждого в палитре видно, что изменится, если его добавить.';
    return `${head(s, intro, ['Перетащи блок из палитры на карту или нажми на него', 'Тяни стрелку от кружка на краю блока', 'Нажми на блок, чтобы увидеть детали', 'Нажми на стрелку, чтобы удалить её'])}
      <div class="kpis" id="kpis"></div>
      <section class="broken" id="broken" hidden></section>
      <div class="lab-grid">
        <aside class="card pal-card pal-book"><div class="palh"><b>📘 По книге</b><small>Этих блоков хватает для ответа на интервью.</small></div><div id="palBook"></div></aside>
        <section class="card mapcard" id="mapcard">
          <div class="toolbar">
            <div class="scnbar">${L.scenario.map(scnHtml).join('')}<span class="scnsrc" id="scnsrc"></span></div>
            <div class="tb">
              <button class="ib" data-z="-1" aria-label="Уменьшить" title="Уменьшить">−</button><button class="ib" data-z="0" title="Вписать">⤢</button><button class="ib" data-z="1" aria-label="Увеличить" title="Увеличить">+</button>
              <button class="ib" id="full" title="Во весь экран">⛶</button>
              <button class="btn sm" id="ref" title="Эталон под текущий сценарий: оригинал из книги или его адаптация">✨ Эталон</button><button class="btn sm ghost" id="refBook" title="Схема ровно как в книге">📘 Оригинал</button><button class="btn sm ghost" id="clr">Очистить</button>
            </div>
          </div>
          <div class="cmp" id="cmp"></div>
          <div class="bookline" id="bookline"></div>
          <div class="legend" id="legend"></div>
          <p class="lghelp">Стрелка значит «вызывает»: запрос идёт по стрелке, ответ возвращается обратно. Точки на стрелке это запросы, цвет показывает поток, число это запросов в секунду. Серый пунктир: по стрелке ничего не идёт, а на блоке написано почему: 🔌 не подключён (не хватает стрелки) или 💤 не нужен в этой схеме. Нажми на стрелку или блок, чтобы увидеть подробности.</p>
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
        <aside class="card pal-card pal-exp"><div class="palh"><b>🧪 Эксперименты</b><small>В книге их нет. Добавь и посмотри, что станет лучше, а что хуже.</small></div><div id="palExp"></div></aside>
      </div>
      ${deep ? '<h3 class="sec">Проблемы углубления</h3><div class="probs" id="probs"></div>' : ''}
      <section class="card ai" id="ai"></section>
      <div class="below">
        <section class="card"><h3>Цели</h3><div id="goals"></div></section>
        <section class="card"><h3>Подсказки и предупреждения</h3><div class="warns" id="warns"></div></section>
      </div>
      <div class="toast" id="toast" role="status" hidden></div>`;
  }

  function bindMap() {
    $('#ref').onclick = () => {
      const A = refFor(step().stage);
      loadRef(A.graph);
      toast(A.original ? 'Разложен эталон: при этом сценарии схема из книги выдерживает нагрузку как есть.' : `Эталон адаптирован под сценарий (${scnText()}): ${A.changes.join('; ')}.${A.ok ? '' : ' Но и так не выдерживает: причины над картой.'}`);
    };
    $('#refBook').onclick = () => { loadRef(E.refGraph(L, step().stage)); toast('Разложена схема ровно как в книге. Сравни её метрики с адаптацией под нагрузку.'); };
    $('#clr').onclick = () => { if (confirm('Убрать все блоки и стрелки с карты?')) { st.graph = { nodes: [], edges: [] }; selNode = null; changed(); } };
    $('#edel').onclick = () => { if (selEdge != null) { st.graph.edges.splice(selEdge, 1); selEdge = null; changed(); } };
    bindScn(update);
    $$('[data-z]').forEach((b) => (b.onclick = () => { const z = +b.dataset.z; zoom = z ? Math.max(0.5, Math.min(2.5, zoom + z * 0.15)) : 1; fit(!z); }));
    $('#full').onclick = () => { $('#mapcard').classList.toggle('full'); document.body.classList.toggle('noscroll'); fit(true); };
    fit();
    // Зум браузера (Cmd +) меняет devicePixelRatio: тогда масштаб доски не трогаем, и карта растёт вместе со страницей.
    window.onresize = () => {
      if (step().kind !== 'map') return;
      const dpr = window.devicePixelRatio;
      fit(dpr === lastDpr);
      lastDpr = dpr;
    };
    bindBoard();
    renderAi();
    if (step().stage === 'deep') renderProbs();
    prevKpi = null;
    update();
  }

  // Доска рисуется в своих координатах W×H и вписывается в рамку (плюс ручной зум).
  // Во весь экран вписываем по обеим сторонам и разрешаем увеличение.
  function fit(refit) {
    const wrap = $('#wrap'), board = $('#board'), full = $('#mapcard').classList.contains('full');
    if (refit || autoS == null) autoS = full ? Math.max(0.45, Math.min(2, (wrap.clientWidth - 2) / W, (wrap.clientHeight - 2) / H)) : Math.max(0.45, Math.min(1, (wrap.clientWidth - 2) / W));
    scale = autoS * zoom;
    board.style.transform = `scale(${scale})`;
    board.style.marginBottom = `${H * scale - H}px`;
    board.style.marginRight = `${W * scale - W}px`;
    if (last) drawEdges();
  }

  function loadRef(g) {
    st.graph = JSON.parse(JSON.stringify(g));
    selNode = null;
    changed();
  }

  function freePos([x, y]) {
    while (st.graph.nodes.some((n) => Math.abs(n.x - x) < 30 && Math.abs(n.y - y) < 30)) { x += 28; y += 28; }
    return [Math.max(0, Math.min(x, W - 180)), Math.max(0, Math.min(y, H - 120))];
  }

  // Блок добавляется сразу рабочим: с типовыми стрелками, нужными соседями (bring) и без стрелок, которые он заменяет (drop).
  function addNode(type, pos) {
    const def = L.blocks[type], have = st.graph.nodes.find((n) => n.type === type);
    if (have && !def.multi) { select(have.id); toast(`«${def.name}» уже на карте. Второй ничего не получит: потоки идут через первый, а масштабируется блок сам, репликами.`); return; }
    const before = st.graph, res = E.addBlock(L, before, type, freePos(pos || def.pos));
    const key = (e) => e.from + '>' + e.to, old = new Set(before.edges.map(key)), nm = (g, id) => L.blocks[g.nodes.find((n) => n.id === id).type].name;
    const added = res.graph.edges.filter((e) => !old.has(key(e)));
    st.graph = res.graph;
    selNode = res.id;
    const parts = [`Добавлен «${def.name}»`];
    if (res.brought.length) parts.push(`вместе с ним «${res.brought.map((t) => L.blocks[t].name).join('», «')}», без него он бесполезен`);
    if (added.length) parts.push(`стрелки: ${added.map((e) => nm(st.graph, e.from) + ' → ' + nm(st.graph, e.to)).join(', ')}`);
    if (res.dropped.length) parts.push(`убрана стрелка ${res.dropped.map((e) => nm(before, e.from) + ' → ' + nm(before, e.to)).join(', ')}, он её заменяет`);
    toast(parts.join('; ') + '.' + (added.length ? '' : ' Проведи к нему стрелки.'));
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

  const fitHtml = (f) => `<p><b class="fy">Хорош для:</b> ${esc(f.use)}</p><p><b class="fn">Не стоит:</b> ${esc(f.avoid)}</p><p><b>Ограничения:</b> ${esc(f.limits)}</p>`;
  const infoOpen = new Set();

  // Две палитры: слева блоки из книги, справа эксперименты; внутри тематические группы, которые можно свернуть.
  function renderPalette(r) {
    const rank = (g, extra) => { const i = ((extra && L.expGroups) || L.groups || []).indexOf(g); return i < 0 ? 99 : i; };
    const item = ([t, b]) => {
      const onMap = st.graph.nodes.some((n) => n.type === t);
      const done = onMap && !b.multi, chips = done ? [] : effects(r, analyzeG(E.addBlock(L, st.graph, t, [0, 0]).graph, step().stage));
      return `<div class="pwrap"><button class="pi cat-${b.cat}" data-t="${t}" title="Перетащи на карту или нажми">
        <span class="pic">${b.icon}</span><span class="pin"><b>${esc(b.name)}</b><span class="pmeta"><span class="ptag ${b.extra ? 'xp' : 'bk'}">${b.extra ? '🧪 эксперимент' : '📘 книга'}</span>${onMap ? '<em>на карте</em>' : ''}</span><small>${esc(b.tag || '')}</small>
        ${done ? '' : `<span class="chips">${chips.length ? chips.slice(0, 4).map(([t, good]) => `<span class="chip ${good ? 'good' : 'bad'}">${esc(t)}</span>`).join('') : '<span class="chip">сейчас без эффекта</span>'}</span>`}</span></button>
        ${b.fit ? `<button class="pinfo" data-info="${t}" aria-expanded="${infoOpen.has(t)}" title="Для чего подходит, когда не стоит, ограничения">ⓘ</button>${infoOpen.has(t) ? `<div class="pfit">${fitHtml(b.fit)}</div>` : ''}` : ''}</div>`;
    };
    const side = (extra) => {
      const list = Object.entries(L.blocks).filter(([, b]) => !!b.extra === extra);
      return [...new Set(list.map(([, b]) => b.group || 'Другое'))].sort((a, b) => rank(a, extra) - rank(b, extra)).map((g) => {
        const key = (extra ? 'x:' : 'b:') + g, items = list.filter(([, b]) => (b.group || 'Другое') === g);
        return `<details class="pgroup" data-g="${esc(key)}" ${st.palClosed && st.palClosed[key] ? '' : 'open'}><summary>${esc(g)}<span>${items.length}</span></summary>${items.map(item).join('')}</details>`;
      }).join('');
    };
    $('#palBook').innerHTML = side(false);
    $('#palExp').innerHTML = side(true);
    $$('.pal-card .pi').forEach(bindPaletteItem);
    $$('.pal-card details').forEach((d) => (d.ontoggle = () => { st.palClosed = Object.assign({}, st.palClosed, { [d.dataset.g]: !d.open }); save(); }));
    $$('.pal-card [data-info]').forEach((b) => (b.onclick = () => { const t = b.dataset.info; infoOpen.has(t) ? infoOpen.delete(t) : infoOpen.add(t); renderPalette(last); }));
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
           <div class="nmx"><span>${fmt(n.load)} rps</span><b class="${cls(n.util)}">${pct(n.util)}</b></div>
           <div class="nf">${sizePills(b, n)}<span class="pill">${ms(b.lat * n.q)}</span>${n.badges.map((x) => `<span class="pill bd" title="${esc(x.title)}">${x.icon}</span>`).join('')}</div>`
        : `<div class="nf"><span class="pill">${fmt(Object.values(n.flows).reduce((s, v) => s + v, 0))} rps</span></div>`;
      const cl = clusterHtml(b, n, r);
      return `<div class="node cat-${b.cat} ${b.extra ? 'exp' : ''} ${cl ? 'wide' : ''} ${hot ? 'hot' : ''} ${n.load || !b.cap ? '' : 'idle'} ${selNode === g.id ? 'sel' : ''}" data-id="${g.id}" style="left:${g.x}px;top:${g.y}px">
        <div class="nh"><span class="ni">${b.icon}</span><span class="nt"><b>${esc(b.name)}</b><small>${CAT[b.cat] || ''}${b.extra ? ' · 🧪 эксперимент' : ''}</small></span><button class="nx" data-del aria-label="Удалить ${esc(b.name)}" title="Удалить">×</button></div>
        ${body}${cl}
        ${n.why ? `<div class="nwhy ${n.why.kind}">${n.why.kind === 'useless' ? '💤 Не нужен в этой главе' : n.why.kind === 'dup' ? '💤 Лишний дубль' : '🔌 Не подключён'}</div>` : ''}
        <button class="port" data-port aria-label="Провести стрелку от «${esc(b.name)}»" title="Потяни к другому блоку"></button></div>`;
    }).join('');
  }

  function sizePills(b, n) {
    const c = n.cfg;
    if (b.tune === 'sql') return `<span class="pill" title="Шарды">${c.shards} шард.</span>${c.replicas ? `<span class="pill" title="Реплики для чтения">+${c.replicas} репл.</span>` : ''}`;
    if (b.tune === 'kafka') return `<span class="pill" title="Брокеры, партиции и репликация">${c.brokers} брок. · ${c.partitions} парт. · RF${n.cluster.rf}</span>`;
    if (b.tune === 'rabbit') return `<span class="pill" title="Очереди и их тип">${c.queues} очер. · ${c.qtype}</span>`;
    return `<span class="pill" title="${esc(b.repLabel || 'реплик')}, подбираются сами">×${n.rep}</span>`;
  }

  // Что внутри блока: шарды и реплики БД, брокеры и партиции Kafka, exchange и очереди RabbitMQ.
  function consumersOf(r, id) {
    const out = new Map();
    r.flows.forEach((f) => f.ok && f.path.forEach((x, i) => { const nx = f.path[i + 1]; if (x.id === id && nx) out.set(nx.id, r.nodes[nx.id]); }));
    return [...out.values()];
  }
  const producersOf = (r, id) => [...new Set(st.graph.edges.filter((e) => e.to === id && r.nodes[e.from]).map((e) => r.nodes[e.from].def.name))].join(', ') || 'никто';
  function clusterHtml(b, n, r) {
    const c = n.cluster;
    if (!c) return '';
    if (b.tune === 'sql') {
      const S = c.shards.length;
      if (S < 2 && !c.replicas) return '';
      const even = c.shards.every((x) => Math.abs(x.share - 1 / S) < 1e-9), show = S > 8 ? c.shards.slice(0, 7) : c.shards;
      return `<div class="cl">${S > 1 ? `<div class="clr">🧭 Роутер${c.key ? `: по ${esc(c.key)}` : ''}${even ? '' : ' · <b class="warn">перекос</b>'}</div>` : ''}
        <div class="shs">${show.map((x, i) => `<div class="shd" title="Шард ${i + 1}: ${pct(x.share)} данных и запросов. Primary ${pct(x.pU)}${c.replicas ? `, реплики по ${pct(x.rU)}` : ''}">
          ${S > 1 ? `<span class="shn">S${i + 1}${even ? '' : ' · ' + pct(x.share)}</span>` : ''}<span class="pp ${cls(x.pU)}">P ${pct(x.pU)}</span>
          ${c.replicas ? `<span class="rl" title="${c.sync === 'sync' ? 'Синхронная' : 'Асинхронная'} репликация primary → реплики">${c.sync === 'sync' ? '⇊' : '⇣'}</span><span class="rs">${Array.from({ length: c.replicas }, () => `<i class="${cls(x.rU)}"></i>`).join('')}</span>` : ''}</div>`).join('')}
          ${S > 8 ? `<div class="shd more">+${S - 7}</div>` : ''}</div>
        <div class="clk"><span>✍️ запись → P</span><span>👁 чтение → ${c.replicas ? 'P и R' : 'P'}</span></div></div>`;
    }
    if (b.tune === 'kafka') {
      const B = c.brokers, P = c.partitions, on = (k) => Array.from({ length: P }, (_, p) => p).filter((p) => (k - (p % B) + B) % B < c.rf);
      const cons = consumersOf(r, n.id);
      return `<div class="cl"><div class="clr">✍️ ${esc(producersOf(r, n.id))} → топик, ${P} парт.</div>
        <div class="brs">${Array.from({ length: B }, (_, k) => { const all = on(k), lead = all.filter((p) => p % B === k);
          return `<div class="br" title="Брокер ${k + 1}: лидер для ${lead.length} партиций, копии ещё ${all.length - lead.length}"><span class="shn">B${k + 1}</span><span class="pts">${lead.slice(0, 6).map((p) => `<i class="ld">P${p}</i>`).join('')}${lead.length > 6 ? `<i>+${lead.length - 6}</i>` : ''}</span>${all.length > lead.length ? `<small>+${all.length - lead.length} коп.</small>` : ''}</div>`; }).join('')}</div>
        <div class="clk">${cons.length ? cons.map((x) => x.def.cache ? `<span>📥 ${esc(x.def.name)}: CDC</span>` : `<span>👥 ${esc(x.def.name)}: ${x.rep} потреб., ${x.rep >= P ? 'по 1 партиции' : `по ${Math.ceil(P / x.rep)} парт.`}${x.want > P ? `; нужно ${x.want}, но лишним не досталось бы партиций` : ''}</span>`).join('') : '<span>👥 потребителей нет</span>'}<span>RF ${c.rf}: лидер + ${c.rf - 1} коп.</span></div></div>`;
    }
    if (b.tune === 'rabbit') {
      const cons = consumersOf(r, n.id);
      return `<div class="cl"><div class="clr">✍️ ${esc(producersOf(r, n.id))} → exchange</div>
        <div class="qs">${Array.from({ length: c.queues }, (_, i) => `<i class="q ${cls(n.util)}" title="Очередь ${i + 1}: ${pct(n.util)}">q${i + 1} ${pct(n.util)}</i>`).join('')}</div>
        <div class="clk">${cons.length ? cons.map((x) => `<span>👥 ${esc(x.def.name)}: ${x.rep} конкурируют</span>`).join('') : '<span>👥 потребителей нет</span>'}<span>${c.qtype} · prefetch ${c.prefetch}</span></div></div>`;
    }
    return '';
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
      const d = curve(x1, y1, x2, y2), sel = selEdge === i, sum = fl.reduce((s, f) => s + loads[f.id], 0);
      const lab = sum && len > 90 ? `<text class="elab" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}">${fmt(sum)} rps</text>` : '';
      out.push(`<g class="edge ${sel ? 'sel' : ''} ${fl.length ? 'live' : ''}" data-e="${i}"><path class="hit" d="${d}"><title>${esc(r ? edgeText(e) : '')}</title></path><path class="base" d="${d}" marker-end="url(#${sel ? 'arrS' : 'arr'})"/>${lines}${lab}</g>`);
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
      pendingFrom = null; hint(null); marks(null);
      const msg = link(from, to);
      if (msg) toast(msg);
      changed();
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
        marks(id);
        drag((ev) => { const [x, y] = pt(ev); if (Math.hypot(x - sx, y - sy) > 4) moved = true; drawEdges([a.x + a.w, a.y + a.h / 2, x, y]); }, (ev) => {
          $('#wrap').classList.remove('linking');
          const t = document.elementFromPoint(ev.clientX, ev.clientY), to = t && t.closest('.node');
          if (to && to.dataset.id !== id) addEdge(id, to.dataset.id);
          else if (!moved) { pendingFrom = id; hint('Теперь нажми на блок, куда ведёт стрелка. Подсвечены блоки, куда её можно провести. Esc отменяет.'); drawEdges(); }
          else { marks(null); drawEdges(); }
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
      pendingFrom = null; marks(null);
      hint(ge ? edgeText(st.graph.edges[selEdge]) + ' Delete или × удаляет стрелку.' : null);
      drawEdges();
    };
    board.onclick = (e) => {
      const d = e.target.closest('[data-del]');
      if (d) removeNode(d.closest('.node').dataset.id);
    };
    document.onkeydown = (e) => {
      if (step().kind !== 'map' || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'Escape') { pendingFrom = null; selEdge = null; hint(null); marks(null); if ($('#mapcard').classList.contains('full')) $('#full').click(); drawEdges(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selEdge != null) { st.graph.edges.splice(selEdge, 1); selEdge = null; changed(); }
        else if (selNode) removeNode(selNode);
      }
    };
  }

  const typeOf = (id) => (st.graph.nodes.find((n) => n.id === id) || {}).type;
  const bname = (type) => L.blocks[type].name;

  // Проводит стрелку, если она осмысленна; иначе возвращает объяснение. Перевёрнутую стрелку разворачивает.
  function link(from, to) {
    const a = typeOf(from), b = typeOf(to);
    if (from === to || !a || !b) return null;
    if (!E.canLink(L, a, b)) {
      if (E.canLink(L, b, a)) { [from, to] = [to, from]; link(from, to); return `Развернул стрелку: запрос идёт от «${bname(b)}» к «${bname(a)}».`; }
      const ok = E.linkTargets(L, a).map(bname);
      return `Стрелка «${bname(a)} → ${bname(b)}» не нужна. ${(L.linkWhy && L.linkWhy(a, b)) || ''} ${ok.length ? `Из «${bname(a)}» стрелка ведёт в: ${ok.join(', ')}.` : `«${bname(a)}» никого не вызывает, стрелки идут только к нему.`}`.replace(/  +/g, ' ');
    }
    if (!st.graph.edges.some((e) => e.from === from && e.to === to)) st.graph.edges.push({ from, to });
    return null;
  }

  // Пока тянем стрелку, подсвечиваем блоки, куда её можно провести.
  function marks(from) {
    const a = from && typeOf(from);
    $$('.node').forEach((n) => {
      const t = typeOf(n.dataset.id), on = !!a && n.dataset.id !== from;
      n.classList.toggle('can', on && E.canLink(L, a, t));
      n.classList.toggle('cant', on && !E.canLink(L, a, t) && !E.canLink(L, t, a));
    });
  }

  function edgeText(e) {
    const loads = (last && last.edgeLoad[e.from + '>' + e.to]) || {}, fl = last.flows.filter((f) => loads[f.id] > 0);
    const head = `«${bname(typeOf(e.from))}» вызывает «${bname(typeOf(e.to))}».`;
    return fl.length ? `${head} По стрелке идёт: ${fl.map((f) => `${f.label} ${fmt(loads[f.id])} rps`).join(', ')}.` : `${head} По стрелке пока ничего не идёт. ${(last.nodes[e.to] && last.nodes[e.to].why && last.nodes[e.to].why.text) || stuck(e)}`;
  }

  // Стрелка есть, но поток по ней обрывается дальше: говорим, какой стрелки не хватает.
  function stuck(e) {
    const a = typeOf(e.from), b = typeOf(e.to), has = (spec, t) => [].concat(spec).includes(t);
    const tips = L.flows.filter((f) => f.chain.some((t, i) => i && has(f.chain[i - 1], a) && has(t, b))).map((f) => last.flows.find((x) => x.id === f.id))
      .filter((f) => !f.ok && f.missing && f.missing[0]).map((f) => `«${f.label}» обрывается дальше: нужна стрелка ${bname(f.missing[0])} → ${[].concat(f.missing[1]).map(bname).join(' или ')}.`);
    return tips.join(' ') || 'Ни одному потоку главы эта стрелка не нужна.';
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
      return `<div class="kpi t-${t.cls || 'acc'}"><div class="k"><i></i>${esc(t.label)}</div><div class="v">${esc(t.show)}${delta}</div><div class="s">${esc(t.sub)}</div></div>`;
    }).join('');
    prevKpi = kp;

    $('#legend').innerHTML = r.flows.filter((f) => !f.optional || f.ok).map((f) => `<button class="lg ${st.show === f.id ? 'on' : ''} ${f.ok ? '' : 'off'}" data-f="${f.id}" title="Показать только этот поток"><i style="background:${f.color}"></i>${esc(f.label)}<span>${fmt(f.rate)} rps · ${f.ok ? ms(f.lat) : 'не доходит'}</span></button>`).join('');
    $$('#legend .lg').forEach((b) => (b.onclick = () => { st.show = st.show === b.dataset.f ? null : b.dataset.f; save(); renderPanels(last); drawEdges(); }));

    $$('[data-pset]').forEach((box) => {
      const t = box.dataset.pset, g = st.graph.nodes.find((x) => x.type === t), n = g && r.nodes[g.id], def = L.blocks[t];
      if (!n) { box.innerHTML = `<p class="onote">«${esc(def.name)}» нет на карте.</p>`; return; }
      const c = n.cfg, key = c.shards > 1 && def.shardKeys ? `, ключ ${def.shardKeys.find((k) => k.v === c.shardKey).label}` : '';
      box.closest('.prob').classList.toggle('solved', n.util <= 0.9 && c.shardKey !== 'date');
      box.innerHTML = `<p class="onote">Сейчас: ${c.shards} шард.${key}, реплик ${c.replicas}. Загрузка ${Math.round(n.util * 100)}%.</p><button class="btn sm" data-open="${g.id}">⚙️ Настроить ${esc(def.name)}</button>`;
      $('[data-open]', box).onclick = () => { select(g.id); $('#mapcard').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    });
    const d = r.d;
    $('#scnsrc').innerHTML = `📐 Из оценки: ${fmt(d.tps)} броней/с, в пике ${fmt(d.tps * d.k)}/с, просмотров ${fmt(d.view * d.k)}/с <button class="lnk" data-go="${L.steps.findIndex((x) => x.kind === 'est')}">изменить</button>`;
    $('[data-go]', $('#scnsrc')).onclick = (e) => go(+e.target.dataset.go);
    renderCmp(r);
    const nb = st.graph.nodes.filter((g) => !L.blocks[g.type].extra).length, nx = st.graph.nodes.length - nb;
    $('#bookline').innerHTML = `<span class="bk">📘 По книге: ${nb}</span><span class="xp">🧪 Эксперименты: ${nx}</span><span class="muted">Блоки-эксперименты на карте с пунктирной рамкой.</span>`;
    const goals = L.goals[step().stage], done = goals.filter((g) => g.check(r)).length;
    $('#goals').innerHTML = `<div class="gprog"><i style="width:${(done / goals.length) * 100}%"></i></div><p class="muted">Выполнено ${done} из ${goals.length}${done === goals.length ? ' 🎉' : ''}</p>
      <ul class="goals">${goals.map((g) => { const ok = g.check(r); return `<li class="${ok ? 'done' : ''}"><span class="${ok ? 'y' : 'n'}">${ok ? '✔' : '○'}</span><span>${esc(g.text)}</span></li>`; }).join('')}</ul>`;
    const order = { bad: 0, warn: 1, info: 2 }, icon = { bad: '⛔', warn: '⚠️', info: '💡' };
    const ws = r.warnings.slice().sort((a, b) => order[a.lvl] - order[b.lvl]), bad = ws.filter((w) => w.lvl === 'bad'), rest = ws.filter((w) => w.lvl !== 'bad');
    $('#broken').hidden = !bad.length;
    $('#broken').innerHTML = `<h4><span>❗</span> Что сломалось</h4><ul>${bad.map((w) => `<li>${esc(w.text)}</li>`).join('')}</ul>`;
    $('#warns').innerHTML = rest.length ? rest.map((w) => `<div class="w ${w.lvl}"><span>${icon[w.lvl]}</span><span>${esc(w.text)}</span></div>`).join('') : '<div class="note">Пока всё спокойно.</div>';
    renderInspector();
  }

  // Эталон и схема ученика под одним сценарием и одними решениями.
  function renderCmp(r) {
    const A = refFor(step().stage);
    const k = (x) => { const b = x.flows.find((f) => f.id === 'book');
      return `<span class="${x.m.served >= 1 && x.m.maxU <= 0.9 ? 'ok' : 'bad'}">выдерживает ${pct(x.m.served)}, пик загрузки ${pct(x.m.maxU)}</span> · бронь ${b && b.ok ? ms(b.lat) : '—'} · ${money(x.m.cost)} · сложность ${x.m.cx.toFixed(1)}`; };
    $('#cmp').innerHTML = `<div class="cref ${A.ok ? '' : 'nok'}"><div class="ct"><b>${A.original ? '📘 Эталон: оригинал из книги' : `🔧 Эталон: адаптация под ${esc(scnText())}`}</b><small>${k(A.r)}</small></div>
      ${A.original ? '<p class="muted">При этом сценарии схема из книги выдерживает нагрузку без изменений.</p>'
        : `<details><summary>Чем отличается от книги (${A.changes.length})</summary><ul>${A.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul><p class="muted">Оригинал из книги здесь: ${k(A.before)}</p></details>`}
      ${A.ok ? '' : `<div class="blk">⛔ Даже адаптированный эталон не выдерживает. Упёрлись: ${A.blockers.map((x) => `«${esc(x.name)}» ${pct(x.util)} (${esc(x.limit)})`).join(', ')}. Нужно: ${[...new Set(A.blockers.map((x) => x.need))].map(esc).join('; ')}.</div>`}</div>
      <div class="cmine"><div class="ct"><b>🧩 Твоя схема</b><small>${st.graph.nodes.length ? k(r) : 'карта пустая'}</small></div></div>`;
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
    box.innerHTML = `<div class="ih cat-${b.cat}"><span class="ni">${b.icon}</span><div><b>${esc(b.name)}</b><small>${CAT[b.cat] || ''} · ${b.extra ? '🧪 эксперимент, в книге его нет' : '📘 по книге'}</small></div><button class="nx" id="inspX" aria-label="Закрыть">×</button></div>
      <p>${esc(b.learn.what)}</p>
      ${b.cap ? `<div class="istats"><div><span>Нагрузка</span><b>${fmt(n.load)} / ${fmt(n.capTotal)} rps</b></div><div><span>Загрузка</span><b class="${cls(n.util)}">${pct(n.util)}</b></div><div><span>${esc(b.repLabel || 'Реплик')}</span><b>${n.rep}${!b.tune && n.rep >= n.maxRep ? ' (макс.)' : ''}</b></div><div><span>Задержка</span><b>${ms(b.lat * n.q)}</b></div></div>` : ''}
      ${n.explain && n.explain.length ? `<h5>Почему такая нагрузка</h5><ul class="expl">${n.explain.map((t) => `<li>${esc(t)}</li>`).join('')}${n.limit ? `<li class="lim">Упёрся: ${esc(n.limit)}. Нужно: ${esc(n.need)}.</li>` : ''}</ul>` : ''}
      ${tuneHtml(b, n)}
      ${flows.length ? `<h5>Какие потоки идут</h5>${flows.map((f) => `<div class="fbar"><span>${esc(f.label)}</span><i style="width:${(n.flows[f.id] / max) * 100}%;background:${f.color}"></i><b>${fmt(n.flows[f.id])}</b></div>`).join('')}` : `<p class="why ${n.why ? n.why.kind : ''}">${n.why ? (n.why.kind === 'useless' ? '💤 ' : '🔌 ') + esc(n.why.text) : 'Через блок не идёт ни один поток.'}</p>`}
      ${b.learn.plus && b.learn.plus.length ? `<h5 class="plus">Что даёт</h5>${li(b.learn.plus)}` : ''}
      ${b.learn.minus && b.learn.minus.length ? `<h5 class="minus">Чем платим</h5>${li(b.learn.minus)}` : ''}
      ${b.fit ? `<h5>Когда брать</h5><div class="pfit">${fitHtml(b.fit)}</div>` : ''}
      <button class="btn sm ghost danger" id="inspDel">Убрать с карты</button>`;
    $$('#insp [data-tf]').forEach((el) => (el.onclick = () => setCfg(g, el.dataset.tf, el.dataset.v)));
    if ($('#autoTune')) $('#autoTune').onclick = () => autoTune(g);
    $('#inspX').onclick = () => select(null);
    $('#inspDel').onclick = () => removeNode(g.id);
  }

  // ----- настройки БД и Kafka -----
  const tuneOpts = (f, def) => E.optsOf(f, def).map((o) => (typeof o === 'object' ? o : { v: o, label: String(o) }));
  function tuneHtml(def, n) {
    if (!def.tune) return '';
    const fields = E.TUNE[def.tune].filter((f) => !f.when || f.when(n.cfg, def));
    return `<h5>⚙️ Настройки</h5><div class="tune">${fields.map((f) => {
      const opts = tuneOpts(f, def), cur = opts.find((o) => o.v === n.cfg[f.id]);
      return `<div class="tf"><div class="tfl">${esc(f.label)}<span class="${f.book ? 'bk' : 'xp'}">${f.book ? '📘 по книге' : '🧪 эксперимент'}</span></div>
        <div class="tseg">${opts.map((o) => `<button class="${o === cur ? 'on' : ''}" data-tf="${f.id}" data-v="${esc(o.v)}">${esc(o.label)}</button>`).join('')}</div>
        <p class="tnote">${esc((cur && cur.note) || f.hint || '')}</p></div>`;
    }).join('')}</div>
    <button class="btn sm" id="autoTune">✨ Подобрать под нагрузку</button>`;
  }
  function setCfg(g, id, raw) {
    const def = L.blocks[g.type], f = E.TUNE[def.tune].find((x) => x.id === id), o = tuneOpts(f, def).find((x) => String(x.v) === raw);
    g.cfg = Object.assign({}, g.cfg, { [id]: o.v });
    changed();
  }
  // Самый дешёвый размер, при котором блок и те, кого он кормит, загружены не больше чем на 70% (подбирает движок).
  function autoTune(g) {
    const def = L.blocks[g.type], res = E.sizeFor(L, st.graph, st.est, deepFor(step().stage), step().stage, g.id), c = res.cfg, n = res.r.nodes[g.id];
    g.cfg = c;
    const what = { sql: `${c.shards} шард., реплик ${c.replicas}`, kafka: `${c.brokers} брокер., ${c.partitions} партиций`, rabbit: `${c.queues} очеред.` }[def.tune];
    const reads = def.tune === 'sql' && n.wload < 0.2 * n.load ? ' Почти всё здесь чтения: кэш перед БД обойдётся дешевле реплик.' : '';
    toast(res.ok ? `Подобрал: ${what}. Загрузка ${pct(n.util)}.${reads}` : `Даже ${what} не хватает (${pct(n.util)}). ${n.need ? 'Нужно: ' + n.need + '.' : ''}`);
    changed();
  }

  function renderProbs() {
    const D = st.deep;
    $('#probs').innerHTML = L.problems.map((p, i) => {
      if (!p.options) return `<article class="card prob"><div class="ph"><span class="pnum">${i + 1}</span><h4>${p.icon} ${esc(p.title)}</h4></div><p class="pr">${esc(p.problem)}</p>
        ${(p.params || []).map((x) => sliderHtml(x, D.params[x.id], 'data-par')).join('')}
        ${p.hint ? `<p class="note">${esc(p.hint)}</p>` : ''}<div class="pset" data-pset="${p.settings}"></div>
        <details><summary>🗣️ Как сказать на интервью</summary><p>${esc(p.say)}</p></details></article>`;
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

  // ---------- Разбор схемы от Claude ----------
  // Страница статическая и без ключей: собираем запрос с картой и метриками, ученик отправляет его Claude,
  // а ответ с JSON вставляет обратно, и предложения можно применить к карте.
  let aiRes = null, aiErr = null;

  function renderAi() {
    const box = $('#ai');
    const sug = aiRes && aiRes.suggestions.map((x, i) => `<article class="sug"><b>${esc(x.title)}</b><p>${esc(x.why)}</p>${x.tradeoff ? `<p class="muted">Чем платим: ${esc(x.tradeoff)}</p>` : ''}${(x.actions || []).length ? `<button class="btn sm" data-apply="${i}">Применить на карте</button>` : ''}</article>`).join('');
    box.innerHTML = `<h3>🤖 Разбор от Claude</h3>
      <p class="muted">1. Скопируй запрос: в нём твоя карта, метрики и решения. 2. Отправь его Claude. 3. Вставь ответ сюда: предложения можно применить к карте одной кнопкой.</p>
      <div class="row-btns"><button class="btn primary" id="aiCopy">Скопировать запрос</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Открыть Claude ↗</a></div>
      <textarea id="aiAns" rows="3" placeholder="Вставь сюда ответ Claude целиком"></textarea>
      <button class="btn sm" id="aiRead">Разобрать ответ</button>
      ${aiErr ? `<p class="aierr">${esc(aiErr)}</p>` : ''}
      ${aiRes ? `<div class="aiout"><p class="verdict">${esc(aiRes.verdict)}</p>${(aiRes.issues || []).length ? `<ul>${aiRes.issues.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}<div class="sugs">${sug}</div></div>` : ''}`;
    $('#aiCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(aiPrompt()); toast('Запрос скопирован. Вставь его в чат с Claude.'); }
      catch (e) { $('#aiAns').value = aiPrompt(); $('#aiAns').select(); toast('Не удалось скопировать сам: запрос в поле ниже, скопируй его вручную.'); }
    };
    $('#aiRead').onclick = () => {
      const t = $('#aiAns').value, a = t.indexOf('{'), b = t.lastIndexOf('}');
      try { aiRes = JSON.parse(t.slice(a, b + 1)); if (!Array.isArray(aiRes.suggestions)) throw 0; aiErr = null; }
      catch (e) { aiRes = null; aiErr = 'Не нашёл в ответе JSON с предложениями. Вставь ответ Claude целиком.'; }
      renderAi();
    };
    $$('[data-apply]').forEach((b) => (b.onclick = () => applyAi(aiRes.suggestions[+b.dataset.apply])));
  }

  function aiContext() {
    const r = last, s = step();
    return {
      chapter: `Глава ${L.n}. ${L.title}`,
      stage: s.stage === 'deep' ? 'углубление: конкурентность, масштаб, транзакции' : 'высокоуровневый дизайн',
      blocks: Object.fromEntries(Object.entries(L.blocks).map(([t, b]) => [t, { name: b.name, what: b.learn.what, plus: b.learn.plus, minus: b.learn.minus, can_call: E.linkTargets(L, t) }])),
      map: { nodes: st.graph.nodes.map((g) => ({ id: g.id, type: g.type, load_rps: Math.round(r.nodes[g.id].load), util: +r.nodes[g.id].util.toFixed(2), replicas: r.nodes[g.id].rep, limit: r.nodes[g.id].limit })), edges: st.graph.edges },
      flows: r.flows.map((f) => ({ id: f.id, label: f.label, optional: f.optional, rps: +f.rate.toFixed(1), reaches_data: f.ok, latency_ms: f.ok ? Math.round(f.lat) : null })),
      metrics: { served: +r.m.served.toFixed(2), bottleneck: r.m.bottleneck && r.m.bottleneck.def.name, cost_month: Math.round(r.m.cost), complexity: +r.m.cx.toFixed(1), ...Object.fromEntries(L.metrics.map((x) => [x.label, Math.round(r.m[x.id] || 0)])) },
      scenario: scn(),
      reference: (() => { const A = refFor(s.stage); return { original_from_book: A.original, changes_for_this_load: A.changes, holds: A.ok, blockers: A.blockers.map((x) => `${x.name}: ${x.limit}`) }; })(),
      decisions: s.stage === 'deep' ? L.problems.filter((p) => p.options).map((p) => ({ problem: p.title, chosen: p.options.find((o) => o.v === st.deep.choices[p.key]).label, options: p.options.map((o) => o.label) })) : null,
      db_settings: Object.fromEntries(st.graph.nodes.filter((g) => L.blocks[g.type].tune).map((g) => [g.id, last.nodes[g.id].cfg])),
      warnings: r.warnings.map((w) => w.text),
    };
  }

  function aiPrompt() {
    return `Ты наставник по system design. Я прохожу учебный симулятор по книге Алекса Сюя и собрал схему. Разбери её по-русски, коротко, как на собеседовании.
Ответь одним JSON-блоком такого вида:
{"verdict": "1–2 предложения: насколько схема хороша для этого этапа",
 "issues": ["до 5 главных проблем со ссылкой на цифры из метрик"],
 "suggestions": [{"title": "что сделать", "why": "что станет лучше", "tradeoff": "чем платим",
   "actions": [{"op": "add|link|unlink|remove", "type": "тип блока для add", "from": "id узла или тип", "to": "id узла или тип"}]}]}
Предложений до 3, самое полезное первым. Типы блоков бери из blocks, стрелки проводи только из can_call. Если правка карты не нужна (например, выбрать другое решение в карточке проблемы), оставь actions пустым и скажи это в why.

Моя схема:
${JSON.stringify(aiContext(), null, 1)}`;
  }

  function applyAi(sg) {
    const made = {}, notes = [];
    const idOf = (x) => made[x] || (st.graph.nodes.some((n) => n.id === x) ? x : (st.graph.nodes.find((n) => n.type === x) || {}).id);
    sg.actions.filter((a) => a.op === 'add' && L.blocks[a.type]).forEach((a) => {
      const res = E.addBlock(L, st.graph, a.type, freePos(L.blocks[a.type].pos));
      st.graph = res.graph; made[a.type] = res.id;
    });
    sg.actions.forEach((a) => {
      const f = idOf(a.from), t = idOf(a.to);
      if (a.op === 'link' && f && t) { const m = link(f, t); if (m) notes.push(m); }
      if (a.op === 'unlink') st.graph.edges = st.graph.edges.filter((e) => !(e.from === f && e.to === t));
      if (a.op === 'remove' && f) { st.graph.nodes = st.graph.nodes.filter((n) => n.id !== f); st.graph.edges = st.graph.edges.filter((e) => e.from !== f && e.to !== f); }
    });
    selNode = null; selEdge = null;
    changed();
    toast(`Применил: «${sg.title}». Посмотри, как изменились метрики.` + (notes.length ? ' ' + notes.join(' ') : ''));
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
