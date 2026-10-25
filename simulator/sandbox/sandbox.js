/* Песочница: свободная карта из блоков всех глав. Блоки перетаскиваются из палитры, стрелки тянутся от кружка,
   ползунки задают пользователей и нагрузку, а панель сбоев гасит свет, взрывает трансформаторы и рубит оптику.
   Расчёт в model.js, блоки глав берутся из chN/chN.js (window.LAB) при загрузке страницы. */
(function () {
  const M = window.SandboxModel;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'sd-sandbox';
  const W = 1000, H = 640;
  let BW = W, BH = H;

  // ---------- числа ----------
  const fmt = (n) => fmt0(n).replace('.', ',');
  function fmt0(n) {
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
  const ms = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + ' с' : Math.round(n) + ' мс');
  const money = (n) => '$' + (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '').replace('.', ',') + 'k' : Math.round(n)) + '/мес';
  const pct = (u) => (u < 10 ? Math.round(u * 100) + '%' : '×' + fmt(u));
  const servedTxt = (s) => (s > 0.9995 ? '100%' : s > 0.99 ? (s * 100).toFixed(1).replace('.', ',') + '%' : Math.round(s * 100) + '%');
  const cls = (u) => (u > 0.9 ? 'bad' : u > 0.7 ? 'warn' : '');
  const LOGO = window.LOGOS || {};
  const icon = (b) => (LOGO[b.logo] ? `<svg viewBox="0 0 24 24" fill="${LOGO[b.logo].color}" role="img" aria-label="${esc(b.name)}"><path d="${LOGO[b.logo].d}"/></svg>` : b.icon);
  const brandStyle = (b) => { const c = b.brand || (LOGO[b.logo] && LOGO[b.logo].color !== 'currentColor' && LOGO[b.logo].color); return c ? `--c:${c};` : ''; };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- нагрузка ----------
  const LOADS = [
    { id: 'users', label: 'Пользователей онлайн', stops: [100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8], val: (v) => fmt(v) },
    { id: 'rpu', label: 'Запросов в секунду на одного', stops: [0.01, 0.05, 0.1, 0.5, 1, 5], val: (v) => fmt(v) },
    { id: 'write', label: 'Доля записи', stops: [0, 0.05, 0.1, 0.2, 0.5, 0.9], val: (v) => Math.round(v * 100) + '%' },
  ];
  const INC = {
    power: { icon: '⚡', label: 'Отключить свет', dc: true, say: (k) => `В ${M.DC[k].name} отключили свет` },
    trafo: { icon: '💥', label: 'Взорвать трансформатор', dc: true, say: (k) => `В ${M.DC[k].name} взорвался трансформатор, город не подаст питание до утра` },
    fire: { icon: '🔥', label: 'Пожар в ДЦ', dc: true, say: (k) => `${M.DC[k].name} горит, ДЦ потерян` },
    cut: { icon: '✂️', label: 'Перерубить оптику', dc: true, say: (k) => `Экскаватор перерубил оптику до ${M.DC[k].name}` },
    flash: { icon: '🌊', label: 'Флешмоб ×10', say: () => 'Флешмоб: трафик вырос в 10 раз' },
    ddos: { icon: '🤖', label: 'DDoS ×30', say: () => 'DDoS: мусорных запросов в 30 раз больше настоящих' },
    node: { icon: '🖥️', label: 'Уронить сервер', say: (k, id) => `Упал сервер блока «${nameOf(id)}»` },
  };
  const DC_COLORS = { A: 'var(--f1)', B: 'var(--f2)', C: 'var(--f3)' };

  // ---------- состояние ----------
  const fresh = () => ({ v: 1, graph: { nodes: [], edges: [] }, env: { users: 1e5, rpu: 0.1, write: 0.1, dc: { A: {}, B: {}, C: {} }, inc: [] }, dcSel: 'A', palClosed: {}, chf: 'all', q: '' });
  let st = fresh();
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) st = Object.assign(fresh(), s, { env: Object.assign(fresh().env, s.env) }); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
  let CAT = {}, CHS = [], last = null, res = null, selNode = null, selEdge = null, pendingFrom = null;
  let scale = 1, zoom = 1, autoS = null, toastT = null, timer = null, hour = 16, chaos = false, history = [], log = [], lastSample = 0;
  const nameOf = (id) => { const g = st.graph.nodes.find((n) => n.id === id); return g && CAT[g.type] ? CAT[g.type].name : id; };
  const env = () => Object.assign({}, st.env, { day: timer ? M.dayK(hour) : 1 });

  // Блоки глав: подгружаем chN/chN.js по очереди, каждый пишет свой window.LAB.
  function loadLabs() {
    return (window.SD_CHAPTERS || []).reduce((p, c) => p.then((acc) => new Promise((done) => {
      const s = document.createElement('script');
      s.src = `../${c.dir}/${c.dir}.js`;
      s.onload = () => { if (window.LAB && window.LAB.blocks) acc.push({ n: c.n, title: c.title, blocks: window.LAB.blocks }); window.LAB = null; done(acc); };
      s.onerror = () => done(acc);
      document.head.appendChild(s);
    })), Promise.resolve([]));
  }

  // ---------- каркас ----------
  function init(labs) {
    CHS = labs;
    CAT = M.harvest(labs);
    st.graph.nodes = st.graph.nodes.filter((n) => CAT[n.type]);
    st.graph.edges = st.graph.edges.filter((e) => st.graph.nodes.some((n) => n.id === e.from) && st.graph.nodes.some((n) => n.id === e.to));
    st.env.inc = st.env.inc.filter((i) => i.kind !== 'node' || st.graph.nodes.some((n) => n.id === i.id));
    const crumb = $('#chapter');
    if (crumb) crumb.innerHTML = '<small>Свободный режим</small><b>Песочница</b>';
    $('#app').innerHTML = view();
    bind();
    update();
    fit(true);
  }

  function loadSlider(x) {
    const v = st.env[x.id], i = x.stops.reduce((b, s, k) => (Math.abs(s - v) < Math.abs(x.stops[b] - v) ? k : b), 0);
    return `<label class="load"><span>${esc(x.label)}</span><input type="range" data-load="${x.id}" min="0" max="${x.stops.length - 1}" step="1" value="${i}" aria-label="${esc(x.label)}"><output id="ld_${x.id}">${x.val(x.stops[i])}</output></label>`;
  }

  function view() {
    return `<section class="sb-head"><div><span class="eyebrow">Свободный режим · все блоки глав</span><h1>Песочница</h1></div>
      <div class="tips"><span>Перетащи блок на карту или нажми на него</span><span>Тяни стрелку от кружка на краю блока</span><span>Нажми на блок: ДЦ, копии, кэш</span><span>Ломай справа: свет, трансформатор, оптика</span></div></section>
      <div class="kpis" id="kpis"></div>
      <div class="lab-grid sb-grid">
        <aside class="card pal-card"><div class="palh"><b>🧱 Блоки</b><small>Базовые и из всех глав, по группам.</small></div>
          <div class="sb-filter"><input type="search" id="q" placeholder="Найти: Redis, Kafka, CDN…" value="${esc(st.q)}" aria-label="Поиск блока">
          <select id="chf" aria-label="Откуда блоки"><option value="all">Все блоки</option><option value="base">Базовые</option>${CHS.map((c) => `<option value="${c.n}">Глава ${c.n}. ${esc(c.title)}</option>`).join('')}</select></div>
          <div id="pal"></div></aside>
        <section class="card mapcard" id="mapcard">
          <div class="toolbar">
            <div class="scnbar">${LOADS.map(loadSlider).join('')}</div>
            <div class="tb">
              <button class="btn sm" id="play" title="Прогнать сутки: ночью четверть нагрузки, пик около 16:00">▶ Сутки</button><output class="sb-hour" id="hour" title="Время суток">пик</output>
              <button class="btn sm ghost" id="chaos" aria-pressed="false" title="Пока идут сутки, сбои случаются и чинятся сами">🐒 Хаос</button>
              <button class="ib" data-z="-1" aria-label="Уменьшить" title="Уменьшить">−</button><button class="ib" data-z="0" title="Вписать">⤢</button><button class="ib" data-z="1" aria-label="Увеличить" title="Увеличить">+</button>
              <button class="ib" id="full" title="Во весь экран">⛶</button>
              <select class="sb-ex" id="ex" aria-label="Примеры схем"><option value="">Примеры…</option><option value="one">Сайт в одном ДЦ</option><option value="multi">Три ДЦ и резерв</option></select>
              <button class="btn sm ghost" id="clr">Очистить</button>
            </div>
          </div>
          <p class="lghelp">Стрелка значит «вызывает». Синие точки это запросы пользователя, серые это фоновые события после очереди, красный пунктир ведёт в упавший блок. Цветные метки A, B, C на блоке показывают, в каких дата-центрах его копии.</p>
          <div class="board-wrap" id="wrap">
            <div class="board" id="board" style="width:${W}px;height:${H}px">
              <svg id="edges" width="${W}" height="${H}" aria-hidden="true"><defs>
                <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" fill="var(--edge)"/></marker>
                <marker id="arrS" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" fill="var(--accent)"/></marker></defs><g id="eg"></g></svg>
              <div id="nodes"></div><button class="edel" id="edel" hidden aria-label="Удалить стрелку">×</button>
            </div>
            <div class="hint" id="hint" hidden></div>
            <div class="empty-map" id="emptyMap" hidden><b>Карта пустая</b><span>Перетащи сюда «Пользователи» и что угодно из палитры или выбери пример.</span></div>
            <aside class="insp" id="insp" hidden></aside>
          </div>
        </section>
        <aside class="card sb-side" id="side"></aside>
      </div>
      <div class="below">
        <section class="card"><h3>Подсказки и предупреждения</h3><div class="warns" id="warns"></div></section>
        <section class="card"><h3>Журнал</h3><div id="chart"></div><ol class="sb-log" id="log"></ol></section>
      </div>
      <div class="toast" id="toast" role="status" hidden></div>`;
  }

  function bind() {
    $$('[data-load]').forEach((el) => (el.oninput = () => {
      const x = LOADS.find((l) => l.id === el.dataset.load), v = x.stops[+el.value];
      st.env[x.id] = v; $('#ld_' + x.id).textContent = x.val(v); changed();
    }));
    $('#q').oninput = (e) => { st.q = e.target.value; save(); renderPalette(); };
    $('#chf').value = st.chf;
    $('#chf').onchange = (e) => { st.chf = e.target.value; save(); renderPalette(); };
    $('#play').onclick = () => (timer ? stop() : play());
    $('#chaos').onclick = () => { chaos = !chaos; $('#chaos').setAttribute('aria-pressed', chaos); $('#chaos').classList.toggle('on', chaos); toast(chaos ? 'Хаос включён: пока идут сутки, сбои случаются и чинятся сами. Запусти «▶ Сутки».' : 'Хаос выключен.'); };
    $$('[data-z]').forEach((b) => (b.onclick = () => { const z = +b.dataset.z; zoom = z ? Math.max(0.5, Math.min(2.5, zoom + z * 0.15)) : 1; fit(!z); }));
    $('#full').onclick = () => { $('#mapcard').classList.toggle('full'); document.body.classList.toggle('noscroll'); fit(true); };
    $('#ex').onchange = (e) => { if (e.target.value) example(e.target.value); e.target.value = ''; };
    $('#clr').onclick = () => { if (confirm('Убрать все блоки и стрелки с карты?')) { st.graph = { nodes: [], edges: [] }; st.env.inc = []; selNode = null; changed(); } };
    $('#edel').onclick = () => { if (selEdge != null) { st.graph.edges.splice(selEdge, 1); selEdge = null; changed(); } };
    window.onresize = () => fit(true);
    bindBoard();
  }

  function changed() { save(); update(); }

  function update() {
    res = M.resilience(st.graph, CAT, env());
    last = res.base;
    $('#emptyMap').hidden = st.graph.nodes.length > 0;
    renderNodes();
    sizeBoard();
    drawEdges();
    renderKpis();
    renderSide();
    renderWarns();
    renderInspector();
    renderPalette();
    sample();
  }

  // ---------- KPI ----------
  let prevKpi = null;
  function renderKpis() {
    const m = last.m, spof = res.spof.length, dl = res.dcLoss, ok = dl.filter((x) => x.served > 0.99).length;
    const t = (v, good, bad) => (v >= good ? 't-ok' : v >= bad ? 't-warn' : 't-bad');
    const k = [
      ['Нагрузка', fmt(m.total) + ' rps', `${fmt(st.env.users)} онлайн${timer ? `, ${hour}:00` : ', пиковый час'}`, 't-acc'],
      ['Обслужено', m.routed ? servedTxt(m.served) : '—', m.routed ? (m.served > 0.999 ? 'все запросы получают ответ' : `теряем ${fmt(m.total * (1 - m.served))} rps`) : 'нет пользователей', m.routed ? t(m.served, 0.999, 0.95) : 't-warn'],
      ['Задержка', m.routed && m.served ? ms(m.lat) : '—', 'средний ответ пользователю', m.lat < 100 ? 't-ok' : m.lat < 300 ? 't-warn' : 't-bad'],
      ['Цена', money(m.cost), 'копии блоков и резервное питание', 't-acc'],
      ['Точки отказа', String(spof), spof ? 'один сервер роняет часть ответов' : 'один сервер ничего не ломает', spof ? 't-bad' : 't-ok'],
      ['Потеря ДЦ', dl.length ? `${ok} из ${dl.length}` : '—', dl.length ? 'ДЦ, без которых всё работает' : 'нет блоков в ДЦ', !dl.length ? 't-warn' : ok === dl.length ? 't-ok' : ok ? 't-warn' : 't-bad'],
    ];
    const now = { s: m.served, l: m.lat, r: m.routed };
    const dlt = (i) => {
      if (!prevKpi || !prevKpi.r || !m.routed) return '';
      const d = i === 1 ? now.s - prevKpi.s : i === 2 ? now.l - prevKpi.l : 0;
      if (i === 1 && Math.abs(d) > 0.005) return `<span class="dlt ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}%</span>`;
      if (i === 2 && Math.abs(d) >= 5) return `<span class="dlt ${d < 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${ms(Math.abs(d))}</span>`;
      return '';
    };
    $('#kpis').innerHTML = k.map(([a, v, s, c], i) => `<div class="kpi ${c}"><div class="k"><i></i>${a}</div><div class="v">${v}${dlt(i)}</div><div class="s" title="${esc(s)}">${esc(s)}</div></div>`).join('');
    prevKpi = now;
  }

  // ---------- палитра ----------
  const GROUPS = ['Клиенты', 'Балансировка и DNS', 'CDN и защита', 'Сервисы', 'Кэш', 'Хранилища', 'Очереди и потоки', 'Наблюдаемость'];
  function renderPalette() {
    const q = st.q.trim().toLowerCase();
    const list = Object.entries(CAT).filter(([t, b]) => (st.chf === 'all' || (st.chf === 'base' ? M.BASE[t] : b.from.includes(+st.chf))) && (!q || (b.name + ' ' + b.tag).toLowerCase().includes(q)));
    const item = ([t, b]) => `<button class="pi cat-${b.cat}" style="${brandStyle(b)}" data-t="${esc(t)}" title="Перетащи на карту или нажми">
      <span class="pic">${icon(b)}</span><span class="pin"><b>${esc(b.name)}</b><span class="pmeta">${M.BASE[t] ? '<span class="ptag bk">базовый</span>' : ''}${b.from.length ? `<span class="ptag xp">гл. ${b.from.join(', ')}</span>` : ''}</span>
      <small>${esc(b.tag)}${b.cap ? `${b.tag ? ' · ' : ''}≈${fmt(b.cap)} rps на копию` : ''}</small></span></button>`;
    $('#pal').innerHTML = GROUPS.map((g) => {
      const items = list.filter(([, b]) => b.group === g);
      if (!items.length) return '';
      return `<details class="pgroup" data-g="${esc(g)}" ${st.palClosed[g] && !q ? '' : 'open'}><summary>${esc(g)}<span>${items.length}</span></summary>${items.map(item).join('')}</details>`;
    }).join('') || '<p class="muted small">Ничего не нашлось.</p>';
    $$('#pal .pi').forEach(bindPaletteItem);
    $$('#pal details').forEach((d) => (d.ontoggle = () => { if (!q) { st.palClosed[d.dataset.g] = !d.open; save(); } }));
  }

  function bindPaletteItem(el) {
    let dragged = false;
    el.onclick = () => { if (dragged) { dragged = false; return; } addNode(el.dataset.t); };
    el.onpointerdown = (e) => {
      if (e.button > 0) return;
      const sx = e.clientX, sy = e.clientY, b = CAT[el.dataset.t];
      let ghost = null;
      const mv = (ev) => {
        if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        if (!ghost) { ghost = document.createElement('div'); ghost.className = 'dragghost cat-' + b.cat; ghost.style.cssText = brandStyle(b); ghost.innerHTML = `<span class="pic">${icon(b)}</span>${esc(b.name)}`; document.body.appendChild(ghost); $('#wrap').classList.add('drop'); }
        ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
      };
      const up = (ev) => {
        removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
        if (!ghost) return;
        dragged = true; ghost.remove(); $('#wrap').classList.remove('drop');
        const r = $('#board').getBoundingClientRect(), w = $('#wrap').getBoundingClientRect();
        if (ev.clientX < w.left || ev.clientX > w.right || ev.clientY < w.top || ev.clientY > w.bottom) return;
        addNode(el.dataset.t, [(ev.clientX - r.left) / scale - 85, (ev.clientY - r.top) / scale - 30]);
      };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    };
  }

  // Свободное место рядом с точкой: блоки не должны лечь друг на друга.
  function freePos([x, y]) {
    const rects = st.graph.nodes.map((n) => rectOf(n.id) || { x: n.x, y: n.y, w: 180, h: 120 }), bw = 190, bh = 130;
    for (let i = 0; i < 300; i++) {
      const k = i % 10, cx = Math.max(0, x + ((k + 1) >> 1) * 60 * (k % 2 ? 1 : -1)), cy = Math.max(0, y + Math.floor(i / 10) * 40);
      if (!rects.some((r) => cx < r.x + r.w + 12 && r.x < cx + bw && cy < r.y + r.h + 12 && r.y < cy + bh)) return [Math.round(cx / 10) * 10, Math.round(cy / 10) * 10];
    }
    return [x, y];
  }

  function addNode(type, pos) {
    const b = CAT[type], base = type.replace(/\W/g, '_');
    let id = base, k = 2;
    while (st.graph.nodes.some((n) => n.id === id)) id = base + k++;
    const p = freePos(pos || [40 + st.graph.nodes.length * 30, 40 + st.graph.nodes.length * 20]);
    st.graph.nodes.push({ id, type, x: p[0], y: p[1], dcs: b.role === 'client' ? [] : [st.dcSel], rep: b.role === 'svc' || b.role === 'lb' ? 2 : 1 });
    selNode = id; selEdge = null;
    toast(`Добавлен «${b.name}» в ${b.role === 'client' ? 'интернет' : M.DC[st.dcSel].name}. ${b.role === 'client' ? 'Протяни от него стрелку к входу системы.' : 'Протяни к нему стрелку от того, кто его вызывает.'}`);
    changed();
  }

  // ---------- узлы ----------
  function renderNodes() {
    $('#nodes').innerHTML = st.graph.nodes.map((g) => {
      const n = last.nodes[g.id], b = n.def, client = n.role === 'client';
      const dcs = client ? '' : `<div class="sb-dcs">${n.dcs.map((k) => { const d = last.dcs[k]; return `<span class="sb-dc ${d.down ? 'down' : d.iso ? 'iso' : d.backup ? 'bk' : ''}" style="--d:${DC_COLORS[k]}" title="${M.DC[k].name}: ${n.perDC[k]} коп.${d.down ? ', лежит' : d.iso ? ', отрезан' : d.backup ? ', на ' + d.backup : ''}">${k}<small>${n.perDC[k]}</small></span>`; }).join('')}</div>`;
      const body = client ? `<div class="nf"><span class="pill">${fmt(last.m.total / Math.max(1, Object.values(last.nodes).filter((x) => x.role === 'client').length))} rps</span></div>`
        : b.cap ? `<div class="meter"><i class="${n.down ? 'bad' : cls(n.util)}" style="width:${n.down ? 100 : Math.min(100, n.util * 100)}%"></i></div>
          <div class="nmx"><span>${fmt(n.load)} rps</span><b class="${n.down ? 'bad' : cls(n.util)}">${n.down ? 'лежит' : pct(n.util)}</b></div>
          <div class="nf"><span class="pill" title="Живых копий из всех">×${n.live < n.rep ? `${Math.max(0, n.live)}/${n.rep}` : n.rep}</span>${n.auto ? '<span class="pill bd" title="Автомасштаб">авто</span>' : ''}${n.hit ? `<span class="pill" title="Доля ответов из кэша">hit ${Math.round(n.hit * 100)}%</span>` : ''}<span class="pill">${ms(b.lat * n.q)}</span>${n.bg && !n.sync ? '<span class="pill" title="Только фоновые события">фон</span>' : ''}</div>` : '';
      const flag = n.down ? '<div class="nwhy sb-bad">💀 Лежит</div>' : n.split ? '<div class="nwhy sb-bad">🧠 Split brain: запись стоит</div>' : n.failover ? `<div class="nwhy">🔀 Primary в ${M.DC[n.failover].name}</div>` : n.lag ? '<div class="nwhy">⏳ Реплика отстаёт</div>' : '';
      const hot = !n.down && n.util > 1 && n.sync > 0;
      return `<div class="node cat-${b.cat} ${n.down ? 'sb-down' : ''} ${hot ? 'hot' : ''} ${!client && !n.load ? 'idle' : ''} ${selNode === g.id ? 'sel' : ''}" data-id="${esc(g.id)}" style="left:${g.x}px;top:${g.y}px;${brandStyle(b)}">
        <div class="nh"><span class="ni">${icon(b)}</span><span class="nt"><b>${esc(b.name)}</b><small>${M.ROLES[n.role].label}${b.from.length ? ' · гл. ' + b.from.join(', ') : ''}</small></span><button class="nx" data-del aria-label="Удалить ${esc(b.name)}" title="Удалить">×</button></div>
        ${body}${dcs}${flag}
        <button class="port" data-port aria-label="Провести стрелку от «${esc(b.name)}»" title="Потяни к другому блоку"></button></div>`;
    }).join('');
  }

  function rectOf(id) {
    const el = $(`.node[data-id="${CSS.escape(id)}"]`);
    return el && { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }
  function clip(r, tx, ty, pad) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx || 0.01, dy = ty - cy || 0.01;
    const s = Math.min(Math.abs((r.w / 2 + pad) / dx), Math.abs((r.h / 2 + pad) / dy));
    return [cx + dx * s, cy + dy * s];
  }
  function curve(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, h = Math.abs(dx) >= Math.abs(dy);
    const c1 = h ? [x1 + dx * 0.45, y1] : [x1, y1 + dy * 0.45], c2 = h ? [x2 - dx * 0.45, y2] : [x2, y2 - dy * 0.45];
    return `M${x1},${y1} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x2},${y2}`;
  }

  function drawEdges(temp) {
    const out = [];
    let delAt = null;
    st.graph.edges.forEach((e, i) => {
      const a = rectOf(e.from), b = rectOf(e.to);
      if (!a || !b) return;
      const [x1, y1] = clip(a, b.x + b.w / 2, b.y + b.h / 2, 3), [x2, y2] = clip(b, a.x + a.w / 2, a.y + a.h / 2, 7);
      const d = curve(x1, y1, x2, y2), v = last.edgeLoad[e.from + '>' + e.to] || 0, to = last.nodes[e.to], from = last.nodes[e.from];
      const dead = to.down || from.down, bg = from.role === 'queue' || (from.bg > 0 && !from.sync), color = bg ? 'var(--f8)' : 'var(--f1)', sel = selEdge === i, id = 'p' + i;
      const n = Math.max(1, Math.min(4, Math.round(1 + Math.log10(v + 1)))), dur = Math.max(0.9, 2.8 - 0.3 * Math.log10(v + 1));
      const dots = v > 0 && !dead && !reduceMotion ? Array.from({ length: n }, (_, j) => `<circle r="4" fill="${color}"><animateMotion dur="${dur}s" begin="-${((j * dur) / n).toFixed(2)}s" repeatCount="indefinite"><mpath href="#${id}"/></animateMotion></circle>`).join('') : '';
      const len = Math.hypot(x2 - x1, y2 - y1);
      const label = v > 0 && len > 90 ? `<text class="elab ${dead ? 'cut' : ''}" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}">${fmt(v)} rps</text>` : '';
      out.push(`<g class="edge ${sel ? 'sel' : ''} ${v > 0 && !dead ? 'live' : ''} ${dead ? 'sb-dead' : ''}" data-e="${i}"><path class="hit" d="${d}"><title>${esc(edgeText(e))}</title></path><path class="base" d="${d}" marker-end="url(#${sel ? 'arrS' : 'arr'})"/>${v > 0 && !dead ? `<path id="${id}" class="fl" d="${d}" style="stroke:${color}"/>` : ''}${dots}${label}</g>`);
      if (sel) delAt = [(x1 + x2) / 2, (y1 + y2) / 2];
    });
    if (temp) out.push(`<path class="temp" d="${curve(...temp)}"/>`);
    $('#eg').innerHTML = out.join('');
    const del = $('#edel');
    del.hidden = !delAt;
    if (delAt) { del.style.left = delAt[0] - 13 + 'px'; del.style.top = delAt[1] - 13 + 'px'; }
  }
  function edgeText(e) {
    const v = last.edgeLoad[e.from + '>' + e.to] || 0, to = last.nodes[e.to];
    return `«${nameOf(e.from)}» вызывает «${nameOf(e.to)}». ${to.down ? 'Блок лежит, запросы в него не проходят.' : v ? `Идёт ${fmt(v)} rps.` : 'Пока ничего не идёт.'}`;
  }

  // ---------- доска ----------
  function contentSize() {
    let w = W, h = H;
    st.graph.nodes.forEach((n) => { const r = rectOf(n.id) || { x: n.x, y: n.y, w: 180, h: 120 }; w = Math.max(w, r.x + r.w + 20); h = Math.max(h, r.y + r.h + 20); });
    return { w, h };
  }
  function fit(refit) {
    const wrap = $('#wrap'), full = $('#mapcard').classList.contains('full'), c = contentSize();
    if (refit || autoS == null) autoS = full ? Math.max(0.45, Math.min(2, (wrap.clientWidth - 2) / c.w, (wrap.clientHeight - 2) / c.h)) : Math.max(0.45, Math.min(1, (wrap.clientWidth - 2) / c.w));
    scale = autoS * zoom;
    $('#board').style.transform = `scale(${scale})`;
    sizeBoard();
    if (last) drawEdges();
  }
  function sizeBoard() {
    const wrap = $('#wrap'), board = $('#board'), full = $('#mapcard').classList.contains('full'), c = contentSize();
    BW = Math.max(c.w, full ? Math.floor((wrap.clientWidth - 2) / scale) : 0);
    BH = Math.max(c.h, full ? Math.floor((wrap.clientHeight - 2) / scale) : 0);
    board.style.width = BW + 'px'; board.style.height = BH + 'px';
    $('#edges').setAttribute('width', BW); $('#edges').setAttribute('height', BH);
    board.style.marginBottom = `${BH * scale - BH}px`;
    board.style.marginRight = `${BW * scale - BW}px`;
  }
  const hint = (text) => { const h = $('#hint'); h.hidden = !text; h.textContent = text || ''; };
  function select(id) {
    selNode = id; selEdge = null;
    $$('.node').forEach((n) => n.classList.toggle('sel', n.dataset.id === id));
    drawEdges(); renderInspector();
  }
  function link(from, to) {
    if (from === to) return;
    if (st.graph.edges.some((e) => e.from === from && e.to === to)) return toast('Такая стрелка уже есть.');
    if (CAT[st.graph.nodes.find((n) => n.id === to).type].role === 'client') return toast('Стрелка в пользователей не нужна: они только отправляют запросы, ответ возвращается по той же стрелке.');
    st.graph.edges.push({ from, to });
  }
  function removeNode(id) {
    st.graph.nodes = st.graph.nodes.filter((n) => n.id !== id);
    st.graph.edges = st.graph.edges.filter((x) => x.from !== id && x.to !== id);
    st.env.inc = st.env.inc.filter((i) => i.id !== id);
    if (selNode === id) selNode = null;
    selEdge = null; changed();
  }

  function bindBoard() {
    const board = $('#board');
    const pt = (e) => { const r = board.getBoundingClientRect(); return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]; };
    const drag = (onMove, onUp) => {
      const mv = (ev) => onMove(ev), up = (ev) => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); onUp(ev); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    };
    const addEdge = (from, to) => { pendingFrom = null; hint(null); link(from, to); changed(); };
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
          g.x = Math.max(0, Math.min(BW - nodeEl.offsetWidth, Math.round((ox + x - sx) / 10) * 10));
          g.y = Math.max(0, Math.min(BH - nodeEl.offsetHeight, Math.round((oy + y - sy) / 10) * 10));
          nodeEl.style.left = g.x + 'px'; nodeEl.style.top = g.y + 'px';
          drawEdges();
        }, () => { nodeEl.classList.remove('drag'); if (moved) { save(); sizeBoard(); } select(g.id); });
        return;
      }
      const ge = e.target.closest('.edge');
      selEdge = ge ? +ge.dataset.e : null;
      if (!ge) { selNode = null; renderInspector(); $$('.node.sel').forEach((n) => n.classList.remove('sel')); }
      pendingFrom = null;
      hint(ge ? edgeText(st.graph.edges[selEdge]) + ' Delete или × удаляет стрелку.' : null);
      drawEdges();
    };
    board.onclick = (e) => { const d = e.target.closest('[data-del]'); if (d) removeNode(d.closest('.node').dataset.id); };
    document.onkeydown = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 'Escape') { pendingFrom = null; selEdge = null; hint(null); if ($('#mapcard').classList.contains('full')) $('#full').click(); drawEdges(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selEdge != null) { st.graph.edges.splice(selEdge, 1); selEdge = null; changed(); }
        else if (selNode) removeNode(selNode);
      }
    };
  }

  // ---------- инспектор ----------
  function renderInspector() {
    const box = $('#insp'), g = selNode && st.graph.nodes.find((n) => n.id === selNode);
    if (!g) { box.hidden = true; return; }
    const n = last.nodes[g.id], b = n.def, client = n.role === 'client', R = M.ROLES[n.role];
    const status = n.down ? `<div class="why sb-why-bad">💀 Лежит: ${esc(n.down)}.</div>` : n.split ? '<div class="why sb-why-bad">🧠 Split brain: ДЦ два, primary отрезан, большинства нет. Запись остановлена.</div>'
      : n.failover ? `<div class="why">🔀 Primary переехал в ${M.DC[n.failover].name}. Последние секунды асинхронной записи могли потеряться.</div>` : n.util > 1 ? `<div class="why">🔥 Перегружен: ${pct(n.util)}.${n.sync ? '' : ' Это фон: растёт очередь, ответы пользователю не страдают.'}</div>` : '';
    const stats = client ? '' : `<div class="istats"><div><span>Нагрузка</span><b>${fmt(n.load)} rps</b></div><div><span>Загрузка</span><b class="${n.down ? 'bad' : cls(n.util)}">${n.down ? 'лежит' : pct(n.util)}</b></div>
      <div><span>Живых копий</span><b>${Math.max(0, n.live)} из ${n.rep}</b></div><div><span>Задержка блока</span><b>${ms(b.lat * n.q)}</b></div>${n.role === 'db' ? `<div><span>Запись в primary</span><b>${fmt(n.w)} rps</b></div><div><span>Чтение</span><b>${fmt(n.r + n.j)} rps</b></div>` : ''}</div>`;
    const dcSeg = client ? '' : `<h5>Дата-центры</h5><div class="tseg">${Object.keys(M.DC).map((k) => `<button data-dc="${k}" class="${n.dcs.includes(k) ? 'on' : ''}" title="${M.DC[k].where}">${k}</button>`).join('')}</div>
      <p class="tnote">${n.role === 'db' && !b.leaderless ? `Primary в ${M.DC[n.dcs[0]].name} (первый выбранный), реплики в остальных. ` : ''}Копии делятся между ДЦ поровну. A и B рядом (2 мс), C в другом регионе (+40 мс).</p>`;
    const repSeg = client ? '' : `<h5>Копии</h5><div class="tseg"><button data-rep="-1" ${n.auto || g.rep <= 1 ? 'disabled' : ''} aria-label="Меньше копий">−</button><button disabled>${n.rep}</button><button data-rep="1" ${n.auto ? 'disabled' : ''} aria-label="Больше копий">+</button><button data-fit>Подобрать</button></div>
      ${M.STATELESS.has(n.role) ? `<label class="sb-check"><input type="checkbox" data-auto ${g.auto ? 'checked' : ''}> Автомасштаб: копий под нагрузку, упавшие заменяются</label>` : `<p class="tnote">${n.role === 'db' || n.role === 'cache' ? 'Со состоянием: копию не поднять за секунду, их число задаёшь ты.' : 'Число копий задаёшь ты.'}</p>`}`;
    const hitSeg = n.role === 'cache' || n.role === 'cdn' ? `<h5>Попадания (hit ratio)</h5><label class="sb-range"><input type="range" data-hit min="0" max="99" value="${Math.round(n.hit * 100)}"><output>${Math.round(n.hit * 100)}%</output></label>` : '';
    box.hidden = false;
    box.innerHTML = `<div class="ih" style="${brandStyle(b)}"><span class="ni">${icon(b)}</span><div><b>${esc(b.name)}</b><small>${R.label}${b.from.length ? ` · из глав ${b.from.join(', ')}` : ' · базовый'}</small></div><button class="nx" data-close aria-label="Закрыть">×</button></div>
      ${status}${stats}${dcSeg}${repSeg}${hitSeg}
      <h5>Как работает в песочнице</h5><p class="tnote">${esc(R.what)}</p>${b.what ? `<details class="more"><summary>Из книги</summary><p>${esc(b.what)}</p></details>` : ''}
      <div class="row-btns">${client ? '' : '<button class="btn sm" data-kill>🖥️ Уронить сервер</button>'}<button class="btn sm danger" data-rm>Удалить</button></div>`;
    $('[data-close]', box).onclick = () => { selNode = null; box.hidden = true; $$('.node.sel').forEach((x) => x.classList.remove('sel')); };
    $$('[data-dc]', box).forEach((x) => (x.onclick = () => {
      const k = x.dataset.dc, has = g.dcs.includes(k);
      if (has && g.dcs.length === 1) return toast('Блок должен жить хотя бы в одном ДЦ.');
      g.dcs = has ? g.dcs.filter((d) => d !== k) : g.dcs.concat(k);
      g.rep = Math.max(g.rep || 1, g.dcs.length);
      changed();
    }));
    $$('[data-rep]', box).forEach((x) => (x.onclick = () => { g.rep = Math.max(1, (g.rep || 1) + +x.dataset.rep); changed(); }));
    const fitB = $('[data-fit]', box);
    if (fitB) fitB.onclick = () => {
      const cap = b.cap * M.TARGET;
      let want = Math.ceil(n.load / cap) || 1;
      if (n.role === 'db' && !b.leaderless) {
        if (n.w >= cap) { toast(`Запись ${fmt(n.w)} rps упирается в один primary (≈${fmt(cap)} rps при 70%): реплики не помогут. Нужны шарды (несколько блоков-БД) или очередь записи.`); want = 5; }
        else want = Math.ceil((n.r + n.j) / (cap - n.w)) || 1;
      }
      g.rep = Math.max(n.dcs.length, Math.min(want, 500));
      changed();
    };
    const au = $('[data-auto]', box);
    if (au) au.onchange = () => { g.auto = au.checked; changed(); };
    const hit = $('[data-hit]', box);
    if (hit) { hit.oninput = () => { hit.nextElementSibling.textContent = hit.value + '%'; }; hit.onchange = () => { g.hit = +hit.value / 100; changed(); }; }
    const kill = $('[data-kill]', box);
    if (kill) kill.onclick = () => incident({ kind: 'node', id: g.id });
    $('[data-rm]', box).onclick = () => removeNode(g.id);
  }

  // ---------- сбои и ДЦ ----------
  const fixText = (i) => `🔧 Починили: ${i.kind === 'node' ? 'сервер «' + nameOf(i.id) + '»' : INC[i.kind].label.toLowerCase() + (i.dc ? ' в ' + M.DC[i.dc].name : '')}`;
  const incKey = (i) => i.kind + ':' + (i.dc || i.id || '');
  function incident(i, quiet) {
    const on = st.env.inc.some((x) => incKey(x) === incKey(i));
    // Сервер можно ронять несколько раз подряд, остальные сбои включаются и выключаются.
    if (on && i.kind !== 'node') st.env.inc = st.env.inc.filter((x) => incKey(x) !== incKey(i));
    else st.env.inc.push(i);
    const before = last.m.served;
    changed();
    const txt = on && i.kind !== 'node' ? `Починили: ${INC[i.kind].say(i.dc, i.id).replace(/^./, (c) => c.toLowerCase())}` : INC[i.kind].say(i.dc, i.id);
    addLog(`${INC[i.kind].icon} ${txt}`, before);
    if (!quiet) toast(`${txt}. Обслужено ${servedTxt(last.m.served)}${Math.abs(last.m.served - before) > 0.005 ? ` (было ${servedTxt(before)})` : ', ответы не пострадали'}.`);
  }

  function renderSide() {
    const k = st.dcSel, d = last.dcs[k], o = st.env.dc[k] = st.env.dc[k] || {};
    const used = (dc) => Object.values(last.nodes).some((n) => n.dcs.includes(dc));
    const active = st.env.inc;
    const on = (kind, dc) => active.some((i) => i.kind === kind && (i.dc || '') === (dc || ''));
    const spof = res.spof, dl = res.dcLoss;
    $('#side').innerHTML = `<h3>⚠️ Сбои</h3>
      <div class="sb-dcsel" role="group" aria-label="Где случится сбой">${Object.keys(M.DC).map((x) => `<button data-sel="${x}" class="${x === k ? 'on' : ''}" style="--d:${DC_COLORS[x]}">${M.DC[x].name}${used(x) ? '' : ' <small>пуст</small>'}</button>`).join('')}</div>
      <div class="sb-fails">${['power', 'trafo', 'fire', 'cut'].map((x) => `<button class="sb-fail ${on(x, k) ? 'on' : ''}" data-inc="${x}" aria-pressed="${on(x, k)}"><span>${INC[x].icon}</span>${INC[x].label}</button>`).join('')}</div>
      <div class="sb-fails">${['flash', 'ddos'].map((x) => `<button class="sb-fail ${on(x) ? 'on' : ''}" data-inc="${x}" aria-pressed="${on(x)}"><span>${INC[x].icon}</span>${INC[x].label}</button>`).join('')}<button class="sb-fail" data-inc="node"><span>🖥️</span>Уронить сервер</button></div>
      ${active.length ? `<div class="sb-active">${active.map((i, n) => `<span class="sb-inc">${INC[i.kind].icon} ${esc(i.kind === 'node' ? nameOf(i.id) : i.dc ? INC[i.kind].label + ' · ' + i.dc : INC[i.kind].label)}<button data-fix="${n}" aria-label="Починить">×</button></span>`).join('')}</div><button class="btn sm" id="fixAll">🔧 Починить всё</button>` : '<p class="tnote">Сбоев нет. Выбери ДЦ и нажми на сбой, второе нажатие чинит.</p>'}
      <h3 class="sb-h">🏢 ${M.DC[k].name} <small>${M.DC[k].where}</small></h3>
      <div class="sb-state ${d.down ? 'bad' : d.iso ? 'bad' : d.backup ? 'warn' : 'ok'}">${d.down ? '💀 ' + esc(d.down) : d.iso ? '✂️ Отрезан от сети' : d.backup ? `🔋 На ${d.backup}` : '✅ Работает'}</div>
      <label class="sb-check"><input type="checkbox" data-pw="ups" ${o.ups ? 'checked' : ''}> ИБП, батареи на 15 минут (+$${M.POWER.ups}/мес)</label>
      <label class="sb-check"><input type="checkbox" data-pw="diesel" ${o.diesel ? 'checked' : ''}> Дизель-генератор, держит часами (+$${M.POWER.diesel}/мес)</label>
      <p class="tnote">Короткое отключение света переживёт ИБП или дизель. Взрыв трансформатора надолго: спасёт только дизель. Пожар и обрыв оптики не спасает ничто внутри ДЦ: нужны копии в другом.</p>
      <h3 class="sb-h">🧯 Устойчивость</h3>
      <div class="sb-res"><b>Упадёт один сервер</b>${!last.m.routed ? '<p class="tnote">Добавь пользователей и схему.</p>' : spof.length ? `<ul>${spof.map((x) => `<li><span>${esc(x.name)}</span><b class="${x.served < 0.95 ? 'bad' : 'warn'}">${servedTxt(x.served)}</b></li>`).join('')}</ul><p class="tnote">Единые точки отказа: одна копия или нет запаса мощности (N+1).</p>` : '<p class="ok">✓ Ни один сервер не роняет ответы</p>'}</div>
      <div class="sb-res"><b>Сгорит целый ДЦ</b>${dl.length ? `<ul>${dl.map((x) => `<li><span>${M.DC[x.dc].name}</span><b class="${x.served > 0.99 ? 'ok' : x.served > 0.5 ? 'warn' : 'bad'}">${servedTxt(x.served)}</b></li>`).join('')}</ul>` : '<p class="tnote">Нет живых ДЦ с блоками.</p>'}</div>`;
    $$('[data-sel]').forEach((b) => (b.onclick = () => { st.dcSel = b.dataset.sel; save(); renderSide(); }));
    $$('[data-inc]').forEach((b) => (b.onclick = () => {
      const kind = b.dataset.inc;
      if (kind === 'node') {
        const g = selNode && st.graph.nodes.find((n) => n.id === selNode && last.nodes[n.id].role !== 'client');
        const pool = Object.values(last.nodes).filter((n) => n.role !== 'client' && !n.down && n.load > 0);
        const pick = g ? last.nodes[g.id] : pool[Math.floor(Math.random() * pool.length)];
        if (!pick) return toast('Ронять нечего: нет блоков с нагрузкой.');
        return incident({ kind: 'node', id: pick.id });
      }
      incident(INC[kind].dc ? { kind, dc: k } : { kind });
    }));
    $$('[data-fix]').forEach((b) => (b.onclick = () => { const i = st.env.inc[+b.dataset.fix]; const before = last.m.served; st.env.inc.splice(+b.dataset.fix, 1); changed(); addLog(fixText(i), before); }));
    const fa = $('#fixAll');
    if (fa) fa.onclick = () => { const before = last.m.served; st.env.inc = []; changed(); addLog('🔧 Починили всё', before); };
    $$('[data-pw]').forEach((c) => (c.onchange = () => { o[c.dataset.pw] = c.checked; changed(); }));
  }

  function renderWarns() {
    const ico = { bad: '⛔', warn: '⚠️', info: '💡' }, w = last.warnings.slice().sort((a, b) => ['bad', 'warn', 'info'].indexOf(a.lvl) - ['bad', 'warn', 'info'].indexOf(b.lvl));
    $('#warns').innerHTML = w.length ? w.map((x) => `<div class="w ${x.lvl}">${ico[x.lvl]} <span>${esc(x.text)}</span></div>`).join('') : st.graph.nodes.length ? '<div class="w ok">✅ Всё работает: перегрузок и упавших блоков нет.</div>' : '<p class="muted">Карта пустая.</p>';
  }

  // ---------- журнал и время ----------
  const clock = () => (timer ? `${String(hour).padStart(2, '0')}:00` : new Date().toTimeString().slice(0, 5));
  function addLog(text, before) {
    log.unshift({ t: clock(), text, s: last.m.served, b: before });
    log = log.slice(0, 30);
    history.push({ s: last.m.served, l: last.m.lat, ev: true });
    renderLog();
  }
  function sample(force) {
    const now = Date.now();
    if (!force && now - lastSample < 500 && history.length) { history[history.length - 1] = Object.assign(history[history.length - 1], { s: last.m.served, l: last.m.lat }); renderLog(); return; }
    lastSample = now;
    history.push({ s: last.m.routed ? last.m.served : 0, l: last.m.lat });
    history = history.slice(-60);
    renderLog();
  }
  function renderLog() {
    const h = history, w = 600, ht = 110, maxL = Math.max(100, ...h.map((x) => x.l)), x = (i) => (h.length < 2 ? w : (i / (h.length - 1)) * w);
    const line = (f) => h.map((p, i) => `${x(i).toFixed(1)},${f(p).toFixed(1)}`).join(' ');
    $('#chart').innerHTML = h.length ? `<svg class="sb-chart" viewBox="0 0 ${w} ${ht + 4}" preserveAspectRatio="none" role="img" aria-label="Обслужено и задержка во времени">
      <line x1="0" x2="${w}" y1="${ht * 0.01 + 2}" y2="${ht * 0.01 + 2}" class="gl"/><line x1="0" x2="${w}" y1="${ht / 2 + 2}" y2="${ht / 2 + 2}" class="gl"/>
      ${h.map((p, i) => (p.ev ? `<line x1="${x(i)}" x2="${x(i)}" y1="0" y2="${ht + 4}" class="ev"/>` : '')).join('')}
      <polyline class="lat" points="${line((p) => ht + 2 - (p.l / maxL) * ht)}"/><polyline class="srv" points="${line((p) => ht + 2 - p.s * ht)}"/></svg>
      <div class="sb-legend"><span><i class="srv"></i>обслужено, 0–100%</span><span><i class="lat"></i>задержка, до ${ms(maxL)}</span><span><i class="ev"></i>событие</span></div>` : '';
    $('#log').innerHTML = log.map((e) => `<li><time>${e.t}</time><span>${esc(e.text)}</span><b class="${e.s < e.b - 0.005 ? 'bad' : e.s > e.b + 0.005 ? 'ok' : ''}">${servedTxt(e.s)}</b></li>`).join('') || '<li class="muted sb-empty">Здесь появятся сбои и починки с долей обслуженных запросов.</li>';
  }

  function play() {
    hour = 0;
    $('#play').textContent = '⏸ Стоп';
    addLog('▶ Начались сутки', last.m.served);
    timer = setInterval(tick, 1000);
    tick();
  }
  function stop() {
    clearInterval(timer); timer = null;
    $('#play').textContent = '▶ Сутки'; $('#hour').textContent = 'пик';
    update();
  }
  function tick() {
    hour = (hour + 1) % 24;
    $('#hour').textContent = String(hour).padStart(2, '0') + ':00';
    if (chaos) chaosStep();
    update();
    sample(true);
    if (hour === 23) { addLog('⏹ Сутки прошли', last.m.served); stop(); }
  }
  // Хаос-обезьяна: случайный сбой примерно раз в пять часов, починка чуть чаще.
  function chaosStep() {
    const r = Math.random(), used = Object.keys(M.DC).filter((k) => Object.values(last.nodes).some((n) => n.dcs.includes(k)));
    if (st.env.inc.length && r < 0.3) {
      const i = st.env.inc[Math.floor(Math.random() * st.env.inc.length)], before = last.m.served;
      st.env.inc = st.env.inc.filter((x) => x !== i);
      changed();
      return addLog(fixText(i), before);
    }
    if (r > 0.8 && used.length) {
      const kinds = ['power', 'power', 'trafo', 'cut', 'node', 'node', 'node', 'flash', 'fire'], kind = kinds[Math.floor(Math.random() * kinds.length)];
      const pool = Object.values(last.nodes).filter((n) => n.role !== 'client' && !n.down && n.load > 0);
      if (kind === 'node') { if (pool.length) incident({ kind, id: pool[Math.floor(Math.random() * pool.length)].id }, true); }
      else incident(INC[kind].dc ? { kind, dc: used[Math.floor(Math.random() * used.length)] } : { kind }, true);
    }
  }

  function toast(text) {
    const t = $('#toast');
    t.textContent = text; t.hidden = false; t.classList.remove('out');
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.classList.add('out'); toastT = setTimeout(() => (t.hidden = true), 300); }, 4800);
  }

  // ---------- примеры ----------
  function example(kind) {
    const N = (id, type, x, y, o) => Object.assign({ id, type, x, y, dcs: ['A'], rep: 1 }, o);
    const E = (...p) => p.map(([from, to]) => ({ from, to }));
    if (kind === 'one') {
      st.graph = { nodes: [N('users', 'users', 20, 240, { dcs: [] }), N('lb', 'lb', 230, 240, { rep: 2 }), N('svc', 'svc', 440, 240, { rep: 8 }), N('redis', 'redis', 680, 100), N('pg', 'pg', 680, 360, { rep: 2 })],
        edges: E(['users', 'lb'], ['lb', 'svc'], ['svc', 'redis'], ['svc', 'pg']) };
      st.env.dc = { A: {}, B: {}, C: {} };
      toast('Сайт в одном ДЦ: работает, пока ДЦ жив. Попробуй отключить свет в ДЦ A или уронить кэш.');
    } else {
      const AB = ['A', 'B'];
      st.graph = { nodes: [N('users', 'users', 10, 120, { dcs: [] }), N('waf', 'waf', 10, 330, { dcs: AB, rep: 2 }), N('lb', 'lb', 210, 330, { dcs: AB, rep: 2 }), N('svc', 'svc', 410, 330, { dcs: AB, rep: 12, auto: true }),
        N('redis', 'redis', 620, 60, { dcs: AB, rep: 2 }), N('pg', 'pg', 620, 290, { dcs: ['A', 'B', 'C'], rep: 3 }), N('kafka', 'kafka', 620, 500, { dcs: AB, rep: 2 }), N('worker', 'worker', 820, 500, { dcs: AB, rep: 2, auto: true }), N('s3', 's3', 820, 290, { dcs: ['A', 'B', 'C'], rep: 3 })],
        edges: E(['users', 'waf'], ['waf', 'lb'], ['lb', 'svc'], ['svc', 'redis'], ['svc', 'pg'], ['svc', 'kafka'], ['kafka', 'worker'], ['worker', 's3']) };
      st.env.dc = { A: { ups: true, diesel: true }, B: { ups: true, diesel: true }, C: { ups: true } };
      toast('Три ДЦ: сервисы в A и B, база с кворумом в A, B и C, резервное питание. Попробуй пожар, оптику и DDoS.');
    }
    st.env.inc = []; selNode = null; selEdge = null;
    changed();
    fit(true);
  }

  loadLabs().then(init);
})();
