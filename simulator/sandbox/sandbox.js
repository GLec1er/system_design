/* Песочница: свободная карта из блоков всех глав. Блоки перетаскиваются из палитры, стрелки тянутся от кружка,
   ползунки задают пользователей и нагрузку, а панель сбоев гасит свет, взрывает трансформаторы и рубит оптику.
   Расчёт в model.js, блоки глав берутся из chN/chN.js (window.LAB) при загрузке страницы. */
(function () {
  const M = window.SandboxModel;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  // Не перерисовываем то, что не изменилось: иначе переводчик заново переводит палитру на каждый клик.
  const html = (el, h) => { if (el._h !== h) { el._h = h; el.innerHTML = h; return true; } };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'sd-sandbox';
  const W = 1000, H = 640;
  let BW = W, BH = H;

  // ---------- числа ----------
  const U = window.SD_unit || ((x) => x);
  const fmt = (n) => U(fmt0(n).replace('.', ','));
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
  const ms = (n) => U(n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + ' с' : Math.round(n) + ' мс');
  const money = (n) => U('$' + (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '').replace('.', ',') + 'k' : Math.round(n)) + '/мес');
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
  const stepHead = (n, title, sub) => `<div class="sb-step"><span class="sb-num">${n}</span><div><b>${title}</b><small id="sub${n}">${sub}</small></div></div>`;

  // Три шага: собери схему → задай условия → сломай и проверь. Шаги 2 и 3 открываются, когда схема заработала.
  function view() {
    return `<section class="sb-head"><div><span class="eyebrow">Свободный режим · блоки глав 1–${CHS.length}</span><h1>Песочница</h1></div>
      <details class="sb-how"><summary>Как пользоваться</summary><ol>
        <li><b>Собери схему.</b> Добавь «Пользователи», потом вход и сервис, протяни стрелки от кружка на краю блока. Или начни с готовой схемы.</li>
        <li><b>Задай условия.</b> Сколько людей онлайн, как часто они ходят, сколько пишут. Пик, сутки или хаос со случайными сбоями.</li>
        <li><b>Сломай и проверь.</b> Выбери дата-центр и устрой сбой. Сверху видно, выдержала ли схема и что изменил последний клик.</li></ol></details></section>
      <section class="sb-verdict" id="verdict" aria-live="polite"></section>
      <div class="sb-grid">
        <aside class="card sb-col" id="step1">${stepHead(1, 'Собери схему', '')}
          <div class="sb-next" id="next"></div>
          <div class="sb-ex"><span>Начать с готовой:</span><button class="btn sm ghost" data-ex="one">Сайт в одном ДЦ</button><button class="btn sm ghost" data-ex="multi">Три ДЦ и резерв</button></div>
          <div class="sb-tabs" role="tablist"><button role="tab" data-tab="base">Базовые</button><button role="tab" data-tab="ch">Из глав 1–${CHS.length}</button></div>
          <input type="search" class="sb-q" id="q" placeholder="Найти: Redis, Kafka, CDN…" value="${esc(st.q)}" aria-label="Поиск блока">
          <div id="pal"></div></aside>
        <div class="sb-center">
          <section class="card sb-cond" id="step2">${stepHead(2, 'Условия', 'Нагрузка на схему')}
            <fieldset id="cond"><div class="scnbar">${LOADS.map(loadSlider).join('')}</div>
              <div class="sb-mode" role="radiogroup" aria-label="Режим">${[['peak', 'Пик'], ['day', 'Сутки'], ['chaos', 'Хаос']].map(([v, l]) => `<button role="radio" data-mode="${v}">${l}</button>`).join('')}<output class="sb-hour" id="hour"></output></div>
              <p class="tnote" id="modeNote"></p></fieldset>
            <div class="sb-lock" id="lock2"></div></section>
          <section class="card mapcard" id="mapcard">
            <div class="board-wrap" id="wrap">
              <div class="board" id="board" style="width:${W}px;height:${H}px">
                <svg id="edges" class="notranslate" width="${W}" height="${H}" aria-hidden="true"><defs>
                  <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" fill="var(--edge)"/></marker>
                  <marker id="arrS" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" fill="var(--accent)"/></marker></defs><g id="eg"></g></svg>
                <div id="nodes"></div><button class="edel" id="edel" hidden aria-label="Удалить стрелку">×</button>
              </div>
              <div class="hint" id="hint" hidden></div>
              <div class="empty-map" id="emptyMap" hidden><b>Карта пустая</b><span>Слева выбери «Пользователи» или готовую схему.</span></div>
            </div>
            <div class="sb-maptools"><div class="sb-legend"><span><i class="srv"></i>запрос пользователя</span><span><i class="bgl"></i>фоновое событие</span><span><i class="ev"></i>в упавший блок</span><span><b class="sb-dc" style="--d:var(--f1)">A</b><b class="sb-dc" style="--d:var(--f2)">B</b><b class="sb-dc" style="--d:var(--f3)">C</b> копии в ДЦ</span></div>
              <div class="tb"><button class="ib" data-z="-1" aria-label="Уменьшить" title="Уменьшить">−</button><button class="ib" data-z="0" title="Вписать">⤢</button><button class="ib" data-z="1" aria-label="Увеличить" title="Увеличить">+</button><button class="ib" id="full" title="Во весь экран">⛶</button><button class="btn sm ghost" id="clr">Очистить</button></div></div>
            <div class="sb-sel" id="sel"></div>
          </section>
        </div>
        <aside class="card sb-col sb-side" id="step3">${stepHead(3, 'Сломай и проверь', 'Сбои и что выдержит схема')}
          <div id="side"></div><div class="sb-lock" id="lock3"></div></aside>
      </div>
      <div class="below">
        <section class="card"><h3>Подсказки и предупреждения</h3><div class="warns" id="warns"></div></section>
        <section class="card" id="journal"><h3>Журнал</h3><div id="chart"></div><ol class="sb-log" id="log"></ol></section>
      </div>
      <div class="toast" id="toast" role="status" hidden></div>`;
  }

  function bind() {
    $$('[data-load]').forEach((el) => {
      el.oninput = () => { const x = LOADS.find((l) => l.id === el.dataset.load); $('#ld_' + x.id).textContent = x.val(x.stops[+el.value]); };
      el.onchange = () => { const x = LOADS.find((l) => l.id === el.dataset.load), v = x.stops[+el.value]; st.env[x.id] = v; changed(`${x.label}: ${x.val(v)}`); };
    });
    $('#q').oninput = (e) => { st.q = e.target.value; save(); renderPalette(); };
    $$('[data-tab]').forEach((b) => (b.onclick = () => { st.tab = b.dataset.tab; st.q = ''; $('#q').value = ''; save(); renderPalette(); }));
    $$('[data-ex]').forEach((b) => (b.onclick = () => example(b.dataset.ex)));
    $$('[data-mode]').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
    $$('[data-z]').forEach((b) => (b.onclick = () => { const z = +b.dataset.z; zoom = z ? Math.max(0.5, Math.min(2.5, zoom + z * 0.15)) : 1; fit(!z); }));
    $('#full').onclick = () => { $('#mapcard').classList.toggle('full'); document.body.classList.toggle('noscroll'); fit(true); };
    $('#clr').onclick = () => { if (confirm('Убрать все блоки и стрелки с карты?')) { stop(); st.graph = { nodes: [], edges: [] }; st.env.inc = []; selNode = null; changed('Карта очищена'); } };
    $('#edel').onclick = () => { if (selEdge != null) { st.graph.edges.splice(selEdge, 1); selEdge = null; changed('Стрелка удалена'); } };
    window.onresize = () => fit(true);
    bindBoard();
  }

  // Каждое действие видно: итог сверху сравнивает «до» и «после», а блоки, чьё состояние изменилось, мигают.
  let lastAct = null;
  const state = (n) => (n.down ? 'down' : n.split ? 'split' : n.util > 1 ? 'over' : n.util > 0.7 ? 'warm' : n.load ? 'ok' : 'idle');
  function changed(label) {
    const before = last && { ok: ready(), m: last.m, spof: res.spof.length, st: Object.fromEntries(Object.values(last.nodes).map((n) => [n.id, state(n)])) };
    save(); update();
    if (!label || !before) return;
    lastAct = { label, ok: before.ok && ready(), b: before.m, a: last.m, bs: before.spof, as: res.spof.length };
    renderVerdict();
    Object.values(last.nodes).forEach((n) => {
      const el = $(`.node[data-id="${CSS.escape(n.id)}"]`);
      if (el && before.st[n.id] && before.st[n.id] !== state(n)) { el.classList.remove('sb-flash'); void el.offsetWidth; el.classList.add('sb-flash'); }
    });
  }

  // Шаг 2 открывается, когда запросы пользователей доходят хотя бы до одного блока.
  const ready = () => last.m.routed && Object.values(last.nodes).some((n) => n.role !== 'client' && n.load > 0);

  function update() {
    res = M.resilience(st.graph, CAT, env());
    last = res.base;
    $('#emptyMap').hidden = st.graph.nodes.length > 0;
    renderNodes();
    sizeBoard();
    drawEdges();
    renderVerdict();
    renderNext();
    renderCond();
    renderSide();
    renderWarns();
    renderSel();
    renderPalette();
    sample();
  }

  // ---------- итог ----------
  // Самое слабое место для пользователя: лежащий блок или самый перегруженный на пути запросов.
  function worst() {
    const sync = Object.values(last.nodes).filter((n) => n.role !== 'client' && n.sync > 0);
    return sync.find((n) => n.down) || sync.find((n) => n.split) || sync.filter((n) => n.util > 1).sort((a, b) => b.util - a.util)[0];
  }
  function renderVerdict() {
    const m = last.m, ok = ready(), w = ok && worst(), spof = res.spof.length, dl = res.dcLoss, dlOk = dl.filter((x) => x.served > 0.99).length;
    const tone = !st.graph.nodes.length ? 'idle' : !ok ? 'warn' : m.served >= 0.999 ? 'ok' : m.served >= 0.95 ? 'warn' : 'bad';
    const head = { idle: ['🧱', 'Собери схему', 'Слева шаг 1: добавь пользователей и сервис или начни с готовой схемы.'], warn: ['⚠️', ok ? 'Система почти справляется' : 'Запросы никуда не доходят', ''], ok: ['✅', 'Система справляется', 'Все запросы получают ответ.'], bad: ['⛔', 'Система не справляется', ''] }[tone];
    const why = w ? `Причина: «${w.def.name}» ${w.down ? 'лежит' : w.split ? 'остановил запись (split brain)' : `перегружен на ${pct(w.util)}`}.` : !ok && st.graph.nodes.length ? 'Протяни стрелки от «Пользователи» к сервису: шаг 1 подскажет.' : head[2];
    const stat = (k, v, c, s) => `<div class="sb-stat"><span>${k}</span><b class="${c || ''}">${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
    const d = lastAct, delta = (a, b, f, good) => (Math.abs(a - b) > 1e-9 ? `<span class="chip ${good(b, a) ? 'good' : 'bad'}">${f(a)} → ${f(b)}</span>` : '');
    const chg = d ? (d.ok ? [delta(d.b.served, d.a.served, servedTxt, (b, a) => b > a), d.b.served && d.a.served ? (Math.abs(d.a.lat - d.b.lat) >= 1 ? delta(d.b.lat, d.a.lat, ms, (b, a) => b < a) : '') : '', Math.abs(d.a.cost - d.b.cost) >= 1 ? delta(d.b.cost, d.a.cost, money, (b, a) => b < a) : '', d.as !== d.bs ? `<span class="chip ${d.as < d.bs ? 'good' : 'bad'}">точек отказа ${d.bs} → ${d.as}</span>` : ''] : [Math.abs(d.a.cost - d.b.cost) >= 1 ? delta(d.b.cost, d.a.cost, money, (b, a) => b < a) : '', !ready() ? '' : '<span class="chip good">схема заработала</span>']).join('') : '';
    $('#verdict').className = 'sb-verdict t-' + tone;
    html($('#verdict'), `<div class="sb-vmain"><span class="sb-vi">${head[0]}</span><div><b>${head[1]}</b><p>${esc(why)}${w ? ` <button class="lnk" data-show="${esc(w.id)}">Показать на карте</button>` : ''}</p></div></div>
      ${tone === 'idle' ? '' : `<div class="sb-vstats">${stat('Нагрузка', fmt(m.total) + ' rps', '', timer ? String(hour).padStart(2, '0') + ':00' : 'пиковый час')}${stat('Обслужено', ok ? servedTxt(m.served) : '—', tone === 'ok' ? 'ok' : tone)}${stat('Задержка', ok && m.served ? ms(m.lat) : '—')}${stat('Цена', money(m.cost))}${stat('Точки отказа', ok ? String(spof) : '—', ok ? (spof ? 'bad' : 'ok') : '', 'упадёт 1 сервер')}${stat('Потеря ДЦ', ok && dl.length ? `${dlOk} из ${dl.length}` : '—', ok && dl.length ? (dlOk === dl.length ? 'ok' : 'bad') : '', 'переживёт')}</div>`}
      ${d ? `<div class="sb-last"><span class="muted">Последнее действие:</span> <b>${esc(d.label)}</b> ${chg || '<span class="muted">на итог не повлияло</span>'}</div>` : ''}`);
    const show = $('[data-show]');
    if (show) show.onclick = () => { select(show.dataset.show); const el = $(`.node[data-id="${CSS.escape(show.dataset.show)}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); };
  }

  // Подсказка следующего действия в шаге 1.
  function renderNext() {
    const N = Object.values(last.nodes), cl = N.find((n) => n.role === 'client'), ok = ready();
    const t = !N.length ? ['Начни с «Пользователи» из группы «Клиенты» или с готовой схемы.', '']
      : !cl ? ['Добавь «Пользователи»: от них пойдут запросы.', '']
      : !st.graph.edges.some((e) => e.from === cl.id) ? ['Протяни стрелку от кружка справа на «Пользователи» к балансировщику или сервису.', '']
      : !ok ? ['Запросы не доходят: соедини цепочку до сервиса.', '']
      : !N.some((n) => n.role === 'db' && n.load) ? ['Запросы доходят. Добавь хранилище за сервисом или сразу меняй нагрузку в шаге 2.', 'ok']
      : ['Схема работает. Шаги 2 и 3 открыты: меняй нагрузку и ломай.', 'ok'];
    $('#sub1').textContent = ok ? 'готово' : 'начни отсюда';
    html($('#next'), `<p class="sb-tip ${t[1]}">${t[1] ? '✓ ' : '→ '}${esc(t[0])}</p>`);
  }

  // ---------- палитра: базовые блоки по ролям или блоки глав, по одной открытой группе ----------
  const GROUPS = ['Клиенты', 'Балансировка и DNS', 'CDN и защита', 'Сервисы', 'Кэш', 'Хранилища', 'Очереди и потоки', 'Наблюдаемость'];
  function renderPalette() {
    const q = st.q.trim().toLowerCase(), tab = st.tab || 'base';
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab && !q));
    const item = ([t, b]) => `<button class="pi cat-${b.cat}" style="${brandStyle(b)}" data-t="${esc(t)}" title="Перетащи на карту или нажми">
      <span class="pic">${icon(b)}</span><span class="pin"><b>${esc(b.name)}</b><small>${esc(M.ROLES[b.role].label)}${b.cap ? ` · ≈${fmt(b.cap)} rps на копию` : ''}</small></span></button>`;
    const group = (key, title, items, sub) => `<details class="pgroup" name="sbpal" data-g="${esc(key)}" ${(st.open === undefined ? first : st.open) === key ? 'open' : ''}><summary>${esc(title)}<span>${items.length}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</summary>${items.map(item).join('')}</details>`;
    const all = Object.entries(CAT), first = 'b:' + GROUPS[0];
    let h;
    if (q) {
      const found = all.filter(([, b]) => (b.name + ' ' + b.tag).toLowerCase().includes(q));
      h = found.length ? `<p class="tnote">Найдено ${found.length}</p>${found.slice(0, 40).map(item).join('')}` : '<p class="muted small">Ничего не нашлось.</p>';
    } else if (tab === 'base') {
      h = GROUPS.map((g) => { const items = all.filter(([t, b]) => M.BASE[t] && b.group === g); return items.length ? group('b:' + g, g, items) : ''; }).join('');
    } else {
      h = CHS.map((c) => group('c:' + c.n, `Глава ${c.n}. ${c.title}`, all.filter(([, b]) => b.from.includes(c.n)))).join('');
    }
    if (!html($('#pal'), h)) return;
    $$('#pal .pi').forEach(bindPaletteItem);
    $$('#pal details').forEach((d) => (d.ontoggle = () => { if (d.open) st.open = d.dataset.g; else if (st.open === d.dataset.g) st.open = null; save(); }));
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
    changed(`Добавлен «${b.name}»`);
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
    drawEdges(); renderSel(); renderSide();
  }
  function link(from, to) {
    if (from === to) return;
    if (st.graph.edges.some((e) => e.from === from && e.to === to)) return toast('Такая стрелка уже есть.');
    if (CAT[st.graph.nodes.find((n) => n.id === to).type].role === 'client') return toast('Стрелка в пользователей не нужна: они только отправляют запросы, ответ возвращается по той же стрелке.');
    st.graph.edges.push({ from, to });
  }
  function removeNode(id) {
    const name = nameOf(id);
    st.graph.nodes = st.graph.nodes.filter((n) => n.id !== id);
    st.graph.edges = st.graph.edges.filter((x) => x.from !== id && x.to !== id);
    st.env.inc = st.env.inc.filter((i) => i.id !== id);
    if (selNode === id) selNode = null;
    selEdge = null; changed(`Удалён «${name}»`);
  }

  function bindBoard() {
    const board = $('#board');
    const pt = (e) => { const r = board.getBoundingClientRect(); return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]; };
    const drag = (onMove, onUp) => {
      const mv = (ev) => onMove(ev), up = (ev) => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); onUp(ev); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    };
    const addEdge = (from, to) => { pendingFrom = null; hint(null); link(from, to); changed(`Стрелка «${nameOf(from)}» → «${nameOf(to)}»`); };
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
      if (!ge) { selNode = null; renderSel(); renderSide(); $$('.node.sel').forEach((n) => n.classList.remove('sel')); }
      pendingFrom = null;
      hint(ge ? edgeText(st.graph.edges[selEdge]) + ' Delete или × удаляет стрелку.' : null);
      drawEdges();
    };
    board.onclick = (e) => { const d = e.target.closest('[data-del]'); if (d) removeNode(d.closest('.node').dataset.id); };
    document.onkeydown = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 'Escape') { pendingFrom = null; selEdge = null; hint(null); if ($('#mapcard').classList.contains('full')) $('#full').click(); drawEdges(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selEdge != null) { st.graph.edges.splice(selEdge, 1); selEdge = null; changed('Стрелка удалена'); }
        else if (selNode) removeNode(selNode);
      }
    };
  }


  // ---------- шаг 2: условия ----------
  let mode = 'peak';
  const MODE_NOTE = {
    peak: 'Считаем самый нагруженный час суток. Поменяй ползунок и отпусти: итог сверху покажет, что изменилось.',
    day: 'Прокручиваем сутки по часу в секунду: ночью нагрузка падает, вечером пик. Следи за графиком в журнале.',
    chaos: 'Сутки идут по кругу, и раз в несколько часов случается случайный сбой: свет, оптика, сервер, флешмоб.',
  };
  function renderCond() {
    const ok = ready();
    $('#cond').disabled = !ok;
    $('#step2').classList.toggle('locked', !ok);
    html($('#lock2'), ok ? '' : '🔒 Откроется, когда запросы пользователей дойдут до сервиса (шаг 1).');
    $$('[data-mode]').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === mode));
    $('#hour').textContent = timer ? String(hour).padStart(2, '0') + ':00' : '';
    $('#modeNote').textContent = MODE_NOTE[mode];
    $('#sub2').textContent = ok ? `${fmt(last.m.total)} rps в ${timer ? 'этот час' : 'пик'}` : 'закрыто';
  }
  function setMode(m) {
    if (!ready()) return;
    const was = mode;
    mode = m; chaos = m === 'chaos';
    if (m === 'peak') { stop(); renderCond(); if (was !== 'peak') addLog('⏹ Обратно к пиковому часу', last.m.served); }
    else if (!timer) play();
    else { addLog(chaos ? '🐒 Включили хаос' : '🐒 Хаос выключен', last.m.served); renderCond(); }
  }

  // ---------- выбранный блок, под картой ----------
  function renderSel() {
    const box = $('#sel'), g = selNode && st.graph.nodes.find((n) => n.id === selNode);
    if (!g) { html(box, `<p class="muted small">${st.graph.nodes.length ? 'Нажми на блок на карте: здесь появятся его копии, дата-центры и кнопка «Уронить сервер».' : 'Здесь будут настройки выбранного блока.'}</p>`); return; }
    const n = last.nodes[g.id], b = n.def, client = n.role === 'client', R = M.ROLES[n.role];
    const status = n.down ? `<div class="why sb-why-bad">💀 Лежит: ${esc(n.down)}.</div>` : n.split ? '<div class="why sb-why-bad">🧠 Split brain: ДЦ два, primary отрезан, большинства нет. Запись остановлена.</div>'
      : n.failover ? `<div class="why">🔀 Primary переехал в ${M.DC[n.failover].name}. Последние секунды асинхронной записи могли потеряться.</div>` : n.util > 1 ? `<div class="why">🔥 Перегружен: ${pct(n.util)}.${n.sync ? ' Добавь копий или нажми «Подобрать».' : ' Это фон: растёт очередь, ответы пользователю не страдают.'}</div>` : '';
    const stats = client ? '' : `<div class="istats"><div><span>Нагрузка</span><b>${fmt(n.load)} rps</b></div><div><span>Загрузка</span><b class="${n.down ? 'bad' : cls(n.util)}">${n.down ? 'лежит' : pct(n.util)}</b></div>
      <div><span>Живых копий</span><b>${Math.max(0, n.live)} из ${n.rep}</b></div><div><span>Задержка</span><b>${ms(b.lat * n.q)}</b></div>${n.role === 'db' ? `<div><span>Запись в primary</span><b>${fmt(n.w)} rps</b></div><div><span>Чтение</span><b>${fmt(n.r + n.j)} rps</b></div>` : ''}</div>`;
    const ctl = client ? '<p class="tnote">Пользователи только отправляют запросы. Их число задаётся в шаге 2.</p>' : `<div class="sb-ctl">
      <div><h5>Копии</h5><div class="tseg"><button data-rep="-1" ${n.auto || g.rep <= 1 ? 'disabled' : ''} aria-label="Меньше копий">−</button><button disabled>${n.rep}</button><button data-rep="1" ${n.auto ? 'disabled' : ''} aria-label="Больше копий">+</button><button data-fit>Подобрать</button></div>
        ${M.STATELESS.has(n.role) ? `<label class="sb-check"><input type="checkbox" data-auto ${g.auto ? 'checked' : ''}> Автомасштаб</label>` : `<p class="tnote">${n.role === 'db' || n.role === 'cache' ? 'Со состоянием: копии задаёшь ты.' : 'Число копий задаёшь ты.'}</p>`}</div>
      <div><h5>Дата-центры</h5><div class="tseg">${Object.keys(M.DC).map((k) => `<button data-dc="${k}" class="${n.dcs.includes(k) ? 'on' : ''}" title="${M.DC[k].where}">${k}</button>`).join('')}</div>
        <p class="tnote">${n.role === 'db' && !b.leaderless ? `Primary в ${M.DC[n.dcs[0]].name}. ` : ''}A и B рядом, C в другом регионе (+40 мс).</p></div>
      ${n.role === 'cache' || n.role === 'cdn' ? `<div><h5>Попадания</h5><label class="sb-range"><input type="range" data-hit min="0" max="99" value="${Math.round(n.hit * 100)}" aria-label="Доля попаданий"><output>${Math.round(n.hit * 100)}%</output></label></div>` : ''}</div>`;
    const mine = last.warnings.filter((w) => w.text.includes(b.name));
    html(box, `<div class="sb-selh" style="${brandStyle(b)}"><span class="ni">${icon(b)}</span><div><b>${esc(b.name)}</b><small>${R.label}${b.from.length ? ` · из глав ${b.from.join(', ')}` : ' · базовый'}</small></div>
        <div class="row-btns">${client ? '' : '<button class="btn sm" data-kill>🖥️ Уронить сервер</button>'}<button class="btn sm danger" data-rm>Удалить</button><button class="nx" data-close aria-label="Закрыть">×</button></div></div>
      ${status}${stats}${ctl}${mine.map((w) => `<div class="w ${w.lvl}">${esc(w.text)}</div>`).join('')}
      <details class="more"><summary>Как работает${b.what ? ' и что в книге' : ''}</summary><p>${esc(R.what)}</p>${b.what ? `<p>${esc(b.what)}</p>` : ''}</details>`);
    $('[data-close]', box).onclick = () => { selNode = null; $$('.node.sel').forEach((x) => x.classList.remove('sel')); renderSel(); };
    $$('[data-dc]', box).forEach((x) => (x.onclick = () => {
      const k = x.dataset.dc, has = g.dcs.includes(k);
      if (has && g.dcs.length === 1) return toast('Блок должен жить хотя бы в одном ДЦ.');
      g.dcs = has ? g.dcs.filter((d) => d !== k) : g.dcs.concat(k);
      g.rep = Math.max(g.rep || 1, g.dcs.length);
      changed(`«${b.name}»: ${has ? 'убрали из' : 'добавили в'} ${M.DC[k].name}`);
    }));
    $$('[data-rep]', box).forEach((x) => (x.onclick = () => { g.rep = Math.max(1, (g.rep || 1) + +x.dataset.rep); changed(`«${b.name}»: копий ${g.rep}`); }));
    const fitB = $('[data-fit]', box);
    if (fitB) fitB.onclick = () => {
      const cap = b.cap * M.TARGET;
      let want = Math.ceil(n.load / cap) || 1;
      if (n.role === 'db' && !b.leaderless) {
        if (n.w >= cap) { toast(`Запись ${fmt(n.w)} rps упирается в один primary (≈${fmt(cap)} rps при 70%): реплики не помогут. Нужны шарды (несколько блоков-БД) или очередь записи.`); want = 5; }
        else want = Math.ceil((n.r + n.j) / (cap - n.w)) || 1;
      }
      g.rep = Math.max(n.dcs.length, Math.min(want, 500));
      changed(`«${b.name}»: подобрали ${g.rep} коп.`);
    };
    const au = $('[data-auto]', box);
    if (au) au.onchange = () => { g.auto = au.checked; changed(`«${b.name}»: автомасштаб ${g.auto ? 'вкл' : 'выкл'}`); };
    const hit = $('[data-hit]', box);
    if (hit) { hit.oninput = () => { hit.nextElementSibling.textContent = hit.value + '%'; }; hit.onchange = () => { g.hit = +hit.value / 100; changed(`«${b.name}»: попаданий ${hit.value}%`); }; }
    const kill = $('[data-kill]', box);
    if (kill) kill.onclick = () => incident({ kind: 'node', id: g.id });
    $('[data-rm]', box).onclick = () => removeNode(g.id);
  }

  // ---------- шаг 3: сбои ----------
  const fixText = (i) => `🔧 Починили: ${i.kind === 'node' ? 'сервер «' + nameOf(i.id) + '»' : INC[i.kind].label.toLowerCase() + (i.dc ? ' в ' + M.DC[i.dc].name : '')}`;
  const incKey = (i) => i.kind + ':' + (i.dc || i.id || '');
  function incident(i, quiet) {
    const on = st.env.inc.some((x) => incKey(x) === incKey(i));
    // Сервер можно ронять несколько раз подряд, остальные сбои включаются и выключаются.
    if (on && i.kind !== 'node') st.env.inc = st.env.inc.filter((x) => incKey(x) !== incKey(i));
    else st.env.inc.push(i);
    const before = last.m.served;
    const txt = on && i.kind !== 'node' ? `Починили: ${INC[i.kind].say(i.dc, i.id).replace(/^./, (c) => c.toLowerCase())}` : INC[i.kind].say(i.dc, i.id);
    changed(`${INC[i.kind].icon} ${txt}`);
    addLog(`${INC[i.kind].icon} ${txt}`, before);
    if (!quiet) toast(`${txt}. Обслужено ${servedTxt(last.m.served)}${Math.abs(last.m.served - before) > 0.005 ? ` (было ${servedTxt(before)})` : ', ответы не пострадали'}.`);
  }

  function renderSide() {
    const ok = ready();
    $('#step3').classList.toggle('locked', !ok);
    html($('#lock3'), ok ? '' : '🔒 Сначала собери работающую схему: ломать пока нечего.');
    if (!ok) { html($('#side'), ''); $('#sub3').textContent = 'закрыто'; return; }
    const k = st.dcSel, d = last.dcs[k], o = st.env.dc[k] = st.env.dc[k] || {};
    const cnt = (dc) => Object.values(last.nodes).filter((n) => n.dcs.includes(dc)).length, empty = !cnt(k);
    const active = st.env.inc, on = (kind, dc) => active.some((i) => i.kind === kind && (i.dc || '') === (dc || ''));
    const dstate = (x) => { const s = last.dcs[x]; return s.down ? ['bad', 'лежит'] : s.iso ? ['bad', 'отрезан'] : s.backup ? ['warn', 'на ' + s.backup] : cnt(x) ? ['ok', 'работает'] : ['', 'пуст']; };
    const sel = selNode && last.nodes[selNode] && last.nodes[selNode].role !== 'client' && last.nodes[selNode];
    const fail = (x, dc, dis) => `<button class="sb-fail ${on(x, dc) ? 'on' : ''}" data-inc="${x}" aria-pressed="${on(x, dc)}" ${dis ? 'disabled' : ''}><span>${INC[x].icon}</span>${on(x, dc) ? 'Починить: ' + INC[x].label.toLowerCase() : INC[x].label}</button>`;
    const bar = (name, s) => `<li><span>${esc(name)}</span><i class="sb-bar"><i class="${s > 0.99 ? 'ok' : s > 0.5 ? 'warn' : 'bad'}" style="width:${Math.round(s * 100)}%"></i></i><b class="${s > 0.99 ? 'ok' : s > 0.5 ? 'warn' : 'bad'}">${servedTxt(s)}</b></li>`;
    $('#sub3').textContent = active.length ? `сбоев: ${active.length}` : 'выбери ДЦ и сбой';
    html($('#side'), `<h5>Где случится</h5>
      <div class="sb-dcsel" role="group" aria-label="Где случится сбой">${Object.keys(M.DC).map((x) => { const [c, t] = dstate(x); return `<button data-sel="${x}" class="${x === k ? 'on' : ''}" style="--d:${DC_COLORS[x]}"><b>${M.DC[x].name}</b><small class="${c}">${t}</small><small>блоков: ${cnt(x)}</small></button>`; }).join('')}</div>
      <p class="tnote">${esc(M.DC[k].where)}${empty ? '. В этом ДЦ нет блоков: ломать нечего. Добавь блок в него через панель под картой.' : ''}</p>
      <div class="sb-fails">${['power', 'trafo', 'fire', 'cut'].map((x) => fail(x, k, empty && !on(x, k))).join('')}</div>
      <h5>Везде</h5>
      <div class="sb-fails">${['flash', 'ddos'].map((x) => fail(x)).join('')}<button class="sb-fail wide" data-inc="node" ${sel ? '' : 'disabled'}><span>🖥️</span>${sel ? `Уронить сервер «${esc(sel.def.name)}»` : 'Уронить сервер: выбери блок на карте'}</button></div>
      ${active.length ? `<div class="sb-active">${active.map((i, n) => `<span class="sb-inc">${INC[i.kind].icon} ${esc(i.kind === 'node' ? nameOf(i.id) : i.dc ? INC[i.kind].label + ' · ' + i.dc : INC[i.kind].label)}<button data-fix="${n}" aria-label="Починить">×</button></span>`).join('')}</div><button class="btn sm" id="fixAll">🔧 Починить всё</button>` : ''}
      <h5>Защита ${M.DC[k].name}</h5>
      <label class="sb-check"><input type="checkbox" data-pw="ups" ${o.ups ? 'checked' : ''} ${empty ? 'disabled' : ''}> ИБП, 15 минут на батареях <small>+$${M.POWER.ups}/мес</small></label>
      <label class="sb-check"><input type="checkbox" data-pw="diesel" ${o.diesel ? 'checked' : ''} ${empty ? 'disabled' : ''}> Дизель, держит часами <small>+$${M.POWER.diesel}/мес</small></label>
      <p class="tnote">Свет переживёт ИБП или дизель, трансформатор только дизель. От пожара и оптики спасают копии в другом ДЦ.</p>
      <h5>Что выдержит</h5>
      <ul class="sb-res">${res.spof.length ? res.spof.map((x) => bar('1 сервер «' + x.name + '»', x.served)).join('') : '<li class="ok">✓ Падение одного сервера ответы не роняет</li>'}${res.dcLoss.map((x) => bar('Потеря ' + M.DC[x.dc].name, x.served)).join('')}</ul>`);
    $$('[data-sel]').forEach((b) => (b.onclick = () => { st.dcSel = b.dataset.sel; save(); renderSide(); }));
    $$('[data-inc]').forEach((b) => (b.onclick = () => {
      const kind = b.dataset.inc;
      if (kind === 'node') return sel && incident({ kind: 'node', id: sel.id });
      incident(INC[kind].dc ? { kind, dc: k } : { kind });
    }));
    $$('[data-fix]').forEach((b) => (b.onclick = () => { const i = st.env.inc[+b.dataset.fix], before = last.m.served; st.env.inc.splice(+b.dataset.fix, 1); changed(fixText(i)); addLog(fixText(i), before); }));
    const fa = $('#fixAll');
    if (fa) fa.onclick = () => { const before = last.m.served; st.env.inc = []; changed('🔧 Починили всё'); addLog('🔧 Починили всё', before); };
    $$('[data-pw]').forEach((c) => (c.onchange = () => { o[c.dataset.pw] = c.checked; changed(`${M.DC[k].name}: ${c.dataset.pw === 'ups' ? 'ИБП' : 'дизель'} ${c.checked ? 'поставили' : 'убрали'}`); }));
  }

  function renderWarns() {
    const ico = { bad: '⛔', warn: '⚠️', info: '💡' }, w = last.warnings.slice().sort((a, b) => ['bad', 'warn', 'info'].indexOf(a.lvl) - ['bad', 'warn', 'info'].indexOf(b.lvl));
    html($('#warns'), w.length ? w.map((x) => `<div class="w ${x.lvl}">${ico[x.lvl]} <span>${esc(x.text)}</span></div>`).join('') : st.graph.nodes.length ? '<div class="w ok">✅ Всё работает: перегрузок и упавших блоков нет.</div>' : '<p class="muted">Карта пустая.</p>');
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
    addLog(chaos ? '🐒 Начались сутки с хаосом' : '▶ Начались сутки', last.m.served);
    timer = setInterval(tick, 1000);
    tick();
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer); timer = null; mode = 'peak'; chaos = false;
    update();
  }
  function tick() {
    hour = (hour + 1) % 24;
    if (chaos) chaosStep();
    update();
    sample(true);
    if (hour === 23 && !chaos) { addLog('⏹ Сутки прошли', last.m.served); stop(); }
  }
  // Хаос-обезьяна: случайный сбой примерно раз в пять часов, починка чуть чаще.
  function chaosStep() {
    const r = Math.random(), used = Object.keys(M.DC).filter((k) => Object.values(last.nodes).some((n) => n.dcs.includes(k)));
    if (st.env.inc.length && r < 0.3) {
      const i = st.env.inc[Math.floor(Math.random() * st.env.inc.length)], before = last.m.served;
      st.env.inc = st.env.inc.filter((x) => x !== i);
      changed(fixText(i));
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
    st.env.inc = []; selNode = null; selEdge = null; lastAct = null;
    changed(kind === 'one' ? 'Готовая схема: сайт в одном ДЦ' : 'Готовая схема: три ДЦ и резерв');
    fit(true);
  }

  loadLabs().then(init);
})();
