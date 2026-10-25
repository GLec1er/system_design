/* Модель песочницы: свободная схема из блоков всех глав, три дата-центра и сбои.
   Нагрузка идёт от пользователей по стрелкам, каждый блок знает свою роль (балансировщик делит, кэш отвечает
   на часть чтений, очередь отвязывает потребителей), а сбои выключают копии, дата-центры и связь между ними.
   Не зависит от DOM (проверка: node simulator/lab/test-sandbox.js). Модель учебная: числа правдоподобные, но не измерения. */
(function (root) {
  const TARGET = 0.7; // автомасштаб и подбор копий держат загрузку около 70%
  const queue = (u) => (u >= 0.95 ? 12 : Math.min(12, 1 + (0.5 * u * u) / (1 - u))); // как в lab/engine.js
  // A и B: две зоны одного региона (пара миллисекунд друг до друга), C: другой регион.
  const DC = { A: { name: 'ДЦ A', where: 'регион 1, зона 1', region: 1 }, B: { name: 'ДЦ B', where: 'регион 1, зона 2', region: 1 }, C: { name: 'ДЦ C', where: 'регион 2', region: 2 } };
  const NET = (a, b) => (a === b ? 0.5 : DC[a].region === DC[b].region ? 2 : 40);
  const POWER = { ups: 150, diesel: 500 }; // $/мес за ИБП и дизель в одном ДЦ
  const HIT = { cache: 0.8, cdn: 0.9 };
  const STATELESS = new Set(['svc', 'lb', 'cdn', 'shield']); // автомасштаб только для блоков без состояния

  const ROLES = {
    client: { label: 'Пользователи', group: 'Клиенты', cat: 'edge', what: 'Отсюда идут запросы. Число пользователей и запросов задают ползунки над картой.' },
    lb: { label: 'Балансировщик', group: 'Балансировка и DNS', cat: 'edge', what: 'Делит запросы поровну между блоками, к которым ведут стрелки. Упавшие пропускает: health check.' },
    cdn: { label: 'CDN', group: 'CDN и защита', cat: 'edge', what: 'Отвечает на долю чтений с края сети, дальше уходят только промахи. Мусорный трафик DDoS гасит почти весь.' },
    shield: { label: 'Защита входа', group: 'CDN и защита', cat: 'edge', what: 'Пропускает настоящие запросы и режет 95% мусорных (DDoS, боты).' },
    svc: { label: 'Сервис', group: 'Сервисы', cat: 'svc', what: 'Без состояния: копии взаимозаменяемы. Вызывает всех, к кому ведут стрелки, и ждёт ответа.' },
    cache: { label: 'Кэш', group: 'Кэш', cat: 'cache', what: 'Отвечает на долю чтений (hit ratio). Промахи и вся запись идут в хранилище. Упал кэш: всё чтение сразу в БД.' },
    db: { label: 'Хранилище', group: 'Хранилища', cat: 'db', what: 'Запись идёт в primary, чтения делятся между копиями. Primary в первом ДЦ из списка, при его потере переезжает в другой.' },
    queue: { label: 'Очередь', group: 'Очереди и потоки', cat: 'async', what: 'Принимает события и отвечает сразу. Потребители за ней работают в своём темпе: их перегрузка это растущая очередь, а не ошибки у пользователя.' },
  };

  // Базовые блоки песочницы. Блоки глав добавляет harvest(); одинаковые по имени сливаются.
  const BASE = {
    users: { name: 'Пользователи', icon: '👥', role: 'client', tag: 'Браузеры и приложения' },
    geodns: { name: 'GeoDNS', icon: '🌐', role: 'lb', cap: 1e6, lat: 1, cost: 50, maxRep: 4, tag: 'Шлёт в ближайший живой ДЦ' },
    waf: { name: 'Анти-DDoS и WAF', icon: '🛡️', role: 'shield', cap: 1e6, lat: 1, cost: 300, maxRep: 50, tag: 'Режет мусорный трафик' },
    cdn: { name: 'CDN', icon: '🛰️', role: 'cdn', cap: 500000, lat: 5, cost: 300, maxRep: 50, tag: 'Статика и кэш на краю сети' },
    lb: { name: 'Балансировщик нагрузки', icon: '⚖️', role: 'lb', cap: 100000, lat: 1, cost: 80, maxRep: 20, tag: 'Делит запросы между копиями' },
    svc: { name: 'Сервис', icon: '⚙️', role: 'svc', cap: 2000, lat: 10, cost: 100, maxRep: 300, tag: 'Stateless API' },
    worker: { name: 'Воркер', icon: '🧰', role: 'svc', cap: 1000, lat: 50, cost: 80, maxRep: 300, tag: 'Фоновая обработка из очереди' },
    redis: { name: 'Кэш (Redis)', logo: 'redis', icon: '⚡', role: 'cache', cap: 100000, lat: 1, cost: 200, tag: 'Горячие данные в памяти' },
    pg: { name: 'PostgreSQL', logo: 'postgresql', icon: '🐘', role: 'db', cap: 5000, lat: 8, cost: 300, tag: 'Primary и реплики' },
    cass: { name: 'Cassandra', logo: 'cassandra', icon: '🗃️', role: 'db', cap: 20000, lat: 8, cost: 500, tag: 'Без единого primary' },
    s3: { name: 'Объектное хранилище (S3)', icon: '🪣', role: 'db', cap: 5000, lat: 30, cost: 100, tag: 'Файлы и медиа' },
    kafka: { name: 'Kafka', logo: 'kafka', icon: '📨', role: 'queue', cap: 50000, lat: 3, cost: 400, tag: 'Поток событий' },
  };
  // Cassandra и S3 пишут на любой узел: у них нет primary, поэтому нет переключения и split brain.
  BASE.cass.leaderless = BASE.s3.leaderless = true;

  function roleOf(b) {
    if (b.role) return b.role;
    if (b.cat === 'edge' && !b.cap) return 'client';
    if (b.tune === 'lb' || b.tune === 'cell' || /балансир|dns/i.test(b.name)) return 'lb';
    if (b.absorb && /cdn/i.test(b.name)) return 'cdn';
    if (b.absorb && b.gate) return 'shield';
    if (b.cat === 'cache') return 'cache';
    if (b.db || b.cat === 'db') return 'db';
    if (b.cat === 'async') return 'queue';
    return 'svc';
  }

  // Каталог: базовые блоки и блоки глав. labs: [{ n, title, blocks }]. Ключ блока главы 'chN:тип'.
  function harvest(labs) {
    const cat = {}, byName = {};
    const add = (type, b, ch) => {
      const key = b.name.trim().toLowerCase();
      if (byName[key]) { if (ch && !byName[key].from.includes(ch.n)) byName[key].from.push(ch.n); return; }
      const role = roleOf(b);
      const group = b.group === 'Наблюдаемость' ? 'Наблюдаемость' : ROLES[role].group;
      cat[type] = byName[key] = {
        name: b.name, icon: b.icon || '▫️', logo: b.logo, brand: b.brand, role, group, cat: ROLES[role].cat,
        cap: b.cap || 0, lat: b.lat || 0, cost: b.cost || 0, maxRep: Math.max(b.maxRep || 0, role === 'svc' ? 300 : 50),
        leaderless: !!b.leaderless || /cassandra|dynamo|s3|узлы данных/i.test(b.name + (b.logo || '')),
        tag: b.tag || '', what: b.what || (b.learn && b.learn.what) || '', from: ch ? [ch.n] : [],
      };
    };
    Object.entries(BASE).forEach(([t, b]) => add(t, b));
    labs.forEach((ch) => Object.entries(ch.blocks || {}).forEach(([t, b]) => add(`ch${ch.n}:${t}`, b, ch)));
    return cat;
  }

  // Копии раскладываются по ДЦ по кругу: 3 копии в A и B это 2 + 1.
  const spread = (rep, dcs) => dcs.map((_, i) => Math.floor(rep / dcs.length) + (i < rep % dcs.length ? 1 : 0));

  function dcState(env, force) {
    const out = {};
    Object.keys(DC).forEach((k) => {
      const o = (env.dc && env.dc[k]) || {}, has = (kind) => (env.inc || []).some((i) => i.dc === k && i.kind === kind);
      let down = null;
      if (has('fire')) down = 'пожар, ДЦ потерян целиком';
      else if (has('trafo') && !o.diesel) down = 'взорвался трансформатор, а дизеля нет: ИБП хватило на 15 минут';
      else if (has('power') && !o.ups && !o.diesel) down = 'отключили свет, а ИБП и дизеля нет';
      if (force && force.dc === k) down = 'проверка: ДЦ потерян';
      const iso = !down && has('cut');
      out[k] = { down, iso, ok: !down && !iso, backup: !down && (has('power') || has('trafo')) ? (has('trafo') || !o.ups ? 'дизель' : 'ИБП') : null };
    });
    return out;
  }

  const DEFAULT_ENV = { users: 1e5, rpu: 0.1, write: 0.1, day: 1, dc: { A: {}, B: {}, C: {} }, inc: [] };

  // force: { dc } теряет ДЦ, { node } роняет одну копию блока; так считаются проверки устойчивости.
  function analyze(graph, cat, env, force) {
    env = Object.assign({}, DEFAULT_ENV, env);
    const dcs = dcState(env, force), inc = env.inc || [];
    const N = {}, out = {}, warnings = [];
    const warn = (lvl, text) => warnings.push({ lvl, text });
    graph.nodes.forEach((g) => {
      const def = cat[g.type];
      if (!def) return;
      const client = def.role === 'client', all = client ? [] : (g.dcs && g.dcs.length ? g.dcs : ['A']);
      const fails = inc.filter((i) => i.kind === 'node' && i.id === g.id).length + (force && force.node === g.id ? 1 : 0);
      N[g.id] = { id: g.id, g, def, role: def.role, dcs: all, alive: all.filter((k) => dcs[k].ok), fails, r: 0, w: 0, j: 0, bg: 0, sync: 0,
        hit: g.hit != null ? g.hit : HIT[def.role] || 0, auto: !!g.auto && STATELESS.has(def.role), rep: Math.max(1, g.rep || 1) };
      out[g.id] = [];
    });
    graph.edges.forEach((e) => e.from !== e.to && N[e.from] && N[e.to] && !out[e.from].includes(e.to) && out[e.from].push(e.to));

    // Что живо до нагрузки: копии в живых ДЦ минус упавшие серверы. Автомасштаб упавшие заменяет сам.
    Object.values(N).forEach((n) => {
      if (n.role === 'client') { n.live = 1; return; }
      const per = spread(n.rep, n.dcs);
      n.perDC = Object.fromEntries(n.dcs.map((k, i) => [k, per[i]]));
      n.live = n.dcs.reduce((s, k, i) => s + (dcs[k].ok ? per[i] : 0), 0) - (n.auto ? 0 : n.fails);
      if (n.auto && n.alive.length) n.live = Math.max(n.live, n.alive.length);
      if (!n.alive.length) n.down = n.dcs.map((k) => `${DC[k].name}: ${dcs[k].down || 'нет связи с остальной сетью'}`).join('; ');
      else if (n.live <= 0) n.down = n.fails ? 'упали все живые копии' : 'в живых ДЦ нет копий';
      if (n.down || n.role !== 'db' || n.def.leaderless) return;
      // Primary живёт в первом ДЦ из списка. Потерян ДЦ: переключаемся на реплику. Но если ДЦ только два и один
      // просто отрезан, большинства нет: обе стороны могут считать себя primary, поэтому запись останавливается.
      const prim = n.dcs[0];
      if (!dcs[prim].ok) {
        if (dcs[prim].iso && n.dcs.length === 2) n.split = true;
        else n.failover = n.alive[0];
      } else if (n.dcs.length === 2 && n.dcs.some((k) => dcs[k].iso)) n.lag = true;
    });

    // Нагрузка: обход от пользователей по стрелкам. Путь помним, чтобы не ходить по кругу.
    const flash = inc.some((i) => i.kind === 'flash'), ddos = inc.some((i) => i.kind === 'ddos');
    const total = env.users * env.rpu * (env.day || 1) * (flash ? 10 : 1);
    const clients = Object.values(N).filter((n) => n.role === 'client');
    const edgeLoad = {}, scale = (l, k) => ({ r: l.r * k, w: l.w * k, j: l.j * k });
    let budget = 20000;
    function visit(n, L, bg, path) {
      const t = L.r + L.w + L.j;
      n.r += L.r; n.w += L.w; n.j += L.j; if (bg) n.bg += t; else n.sync += t;
      if (n.down || --budget < 0 || path.length > 40) return;
      const kids = out[n.id].filter((id) => !path.includes(id)).map((id) => N[id]), p = path.concat(n.id), b = bg || n.role === 'queue';
      const send = (c, l) => { const k = n.id + '>' + c.id; edgeLoad[k] = (edgeLoad[k] || 0) + l.r + l.w + l.j; visit(c, l, b, p); };
      if (n.role === 'lb' || n.role === 'cdn') {
        // Балансировщик (и CDN к origin) делит поровну между живыми: упавших health check убирает из пула.
        const live = kids.filter((c) => !c.down), f = n.role === 'cdn' ? { r: L.r * (1 - n.hit), w: L.w, j: L.j * 0.02 } : L;
        live.forEach((c) => send(c, scale(f, 1 / live.length)));
        return;
      }
      const f = n.role === 'shield' ? { r: L.r, w: L.w, j: L.j * 0.05 } : L;
      const caches = kids.filter((c) => c.role === 'cache').sort((x, y) => x.def.lat - y.def.lat);
      let miss = f.r;
      // Кэши по скорости: сначала самый быстрый. Мусорные запросы с случайными ключами кэш не ловит.
      caches.forEach((c) => { send(c, { r: miss, w: 0, j: 0 }); if (!c.down) miss *= 1 - c.hit; });
      kids.filter((c) => c.role === 'db').forEach((c) => send(c, { r: miss, w: f.w, j: f.j }));
      kids.filter((c) => c.role === 'queue').forEach((c) => send(c, { r: 0, w: f.r + f.w, j: 0 }));
      kids.filter((c) => !['cache', 'db', 'queue'].includes(c.role)).forEach((c) => send(c, f));
    }
    clients.forEach((c) => { const t = total / clients.length; visit(c, { r: t * (1 - env.write), w: t * env.write, j: ddos ? t * 30 : 0 }, false, []); });
    if (budget < 0) warn('bad', 'Схема слишком запутанная: слишком много путей между блоками. Убери лишние стрелки.');

    // Копии и загрузка. У хранилища запись идёт только в primary, чтения делятся между копиями.
    let cost = 0;
    Object.values(N).forEach((n) => {
      const cap = n.def.cap, load = n.r + n.w + n.j;
      n.load = load; n.util = 0; n.q = 1;
      if (n.role === 'client') return;
      if (n.auto && !n.down) { n.want = Math.ceil(load / (cap * TARGET)) || 1; n.live = Math.max(n.alive.length, Math.min(n.def.maxRep, n.want)); n.rep = Math.max(n.live, n.dcs.length); }
      cost += n.def.cost * n.rep;
      if (!cap || n.down) return;
      n.util = n.role === 'db' && !n.def.leaderless ? (n.w + (n.r + n.j) / n.live) / cap : load / (cap * n.live);
      n.q = queue(n.util);
    });
    Object.keys(DC).forEach((k) => { const o = (env.dc && env.dc[k]) || {}; if (o.ups) cost += POWER.ups; if (o.diesel) cost += POWER.diesel; });

    // Доля успешных ответов (s) и задержка (t) для запроса, пришедшего в блок. Очередь отвечает сразу.
    const netLat = (a, b) => {
      if (a.role === 'client' || b.role === 'client') return 0;
      const x = a.alive.length ? a.alive : a.dcs, y = b.alive.length ? b.alive : b.dcs;
      return Math.min(...x.flatMap((p) => y.map((q) => NET(p, q))));
    };
    const memo = {};
    function ST(n) {
      if (memo[n.id]) return memo[n.id];
      memo[n.id] = { s: 1, t: 0 }; // по кругу не считаем
      let res;
      if (n.down) res = { s: 0, t: 0 };
      else {
        const own = n.util > 1 ? 1 / n.util : 1, base = n.def.lat * n.q, kids = out[n.id].map((id) => N[id]);
        const sub = (c) => { const x = ST(c); return { s: x.s, t: x.t + netLat(n, c) }; };
        if (n.role === 'queue') res = { s: own, t: base };
        else if (n.role === 'lb' || n.role === 'cdn') {
          const live = kids.filter((c) => !c.down).map(sub), h = n.role === 'cdn' ? n.hit : 0;
          const a = live.length ? { s: live.reduce((s, x) => s + x.s, 0) / live.length, t: live.reduce((s, x) => s + x.t, 0) / live.length } : { s: kids.length ? 0 : 1, t: 0 };
          res = { s: own * (h + (1 - h) * a.s), t: base + (1 - h) * a.t };
        } else {
          let pr = 1, sr = 0, tr = 0;
          kids.filter((c) => c.role === 'cache').sort((x, y) => x.def.lat - y.def.lat).forEach((c) => {
            if (c.down) return;
            const x = sub(c); tr += pr * x.t; sr += pr * c.hit * x.s; pr *= 1 - c.hit;
          });
          const st = kids.filter((c) => c.role === 'db').map(sub), sSt = st.reduce((s, x) => s * x.s, 1), tSt = st.reduce((s, x) => s + x.t, 0);
          sr += pr * sSt; tr += pr * tSt;
          const mix = n.r + n.w ? n.w / (n.r + n.w) : env.write;
          let s = (1 - mix) * sr + mix * sSt, t = (1 - mix) * tr + mix * tSt;
          kids.filter((c) => c.role !== 'cache' && c.role !== 'db').forEach((c) => { const x = sub(c); s *= x.s; t += x.t; });
          if (n.split) s *= 1 - mix;
          res = { s: own * s, t: base + t };
        }
      }
      return (memo[n.id] = res);
    }
    const res = clients.map(ST);
    const served = clients.length ? res.reduce((s, x) => s + x.s, 0) / clients.length : 0;
    const lat = clients.length ? res.reduce((s, x) => s + x.t, 0) / clients.length : 0;

    // Подсказки и предупреждения
    const nm = (n) => `«${n.def.name}»`;
    if (!clients.length && graph.nodes.length) warn('bad', 'Нет пользователей: добавь блок «Пользователи», от него пойдут запросы.');
    Object.keys(DC).forEach((k) => {
      if (!Object.values(N).some((n) => n.dcs.includes(k))) return;
      if (dcs[k].down) warn('bad', `${DC[k].name}: ${dcs[k].down}.`);
      else if (dcs[k].iso) warn('bad', `${DC[k].name} отрезан от сети: копии в нём недоступны остальным.`);
      else if (dcs[k].backup) warn('info', `${DC[k].name} без городского питания, держится на ${dcs[k].backup === 'ИБП' ? 'ИБП: батарей хватит минут на 15, длинную аварию переживёт только дизель' : 'дизеле'}.`);
    });
    Object.values(N).forEach((n) => {
      if (n.role === 'client') return;
      if (n.down) return warn('bad', `${nm(n)} лежит: ${n.down}.${n.def.role === 'db' ? ' Данные недоступны, пока ДЦ не вернётся.' : ''}`);
      if (n.split) warn('bad', `${nm(n)}: split brain. ДЦ всего два, primary отрезан, и большинства нет. Запись остановлена, чтобы обе стороны не писали каждая своё. Третий ДЦ (хотя бы свидетель) даёт кворум.`);
      if (n.failover) warn('info', `${nm(n)}: primary переехал в ${DC[n.failover].name}. При асинхронной репликации последние секунды записи могли потеряться.`);
      if (n.lag) warn('warn', `${nm(n)}: связь с репликой оборвана, она отстаёт. Если сейчас потерять primary, свежие записи пропадут.`);
      if (n.util > 1 && n.sync > 0) warn('bad', `${nm(n)} перегружен: ${Math.round(n.util * 100)}%. ${n.role === 'db' ? (n.w / n.def.cap > 0.9 ? 'Упирается запись в primary: шарды или очередь записи.' : 'Добавь реплик или кэш перед ним.') : n.auto ? 'Автомасштаб упёрся в предел копий.' : 'Добавь копий или включи автомасштаб.'}`);
      else if (n.util > 1) warn('warn', `${nm(n)} не успевает за очередью: отставание растёт на ${Math.round(n.load - n.load / n.util)} событий/с. Пользователь этого не видит, но обработка запаздывает.`);
      if (!n.load && clients.length) warn('info', `${nm(n)} простаивает: к нему не ведёт ни одна стрелка с нагрузкой.`);
      if (n.rep < n.dcs.length) warn('warn', `${nm(n)}: копий ${n.rep}, а ДЦ ${n.dcs.length}. В части ДЦ копий нет.`);
    });
    if (ddos && !Object.values(N).some((n) => (n.role === 'shield' || n.role === 'cdn') && n.load)) warn('warn', 'Идёт DDoS, а на входе нет защиты: поставь «Анти-DDoS и WAF» или CDN перед балансировщиком.');

    return { nodes: N, out, dcs, edgeLoad, warnings, m: { total, served, lat, cost, routed: clients.length > 0 } };
  }

  // Устойчивость: что будет, если упадёт один сервер любого блока или целый ДЦ.
  function resilience(graph, cat, env) {
    const base = analyze(graph, cat, env), b = base.m.served;
    const spof = Object.values(base.nodes).filter((n) => n.role !== 'client' && n.load > 0 && !n.down).map((n) => {
      const r = analyze(graph, cat, env, { node: n.id });
      return { id: n.id, name: n.def.name, served: r.m.served, drop: b - r.m.served };
    }).filter((x) => x.drop > 0.01).sort((x, y) => y.drop - x.drop);
    const dcLoss = Object.keys(DC).filter((k) => Object.values(base.nodes).some((n) => n.dcs.includes(k)) && base.dcs[k].ok)
      .map((k) => ({ dc: k, served: analyze(graph, cat, env, { dc: k }).m.served }));
    return { base, spof, dcLoss };
  }

  // Суточная кривая: ночью четверть пиковой нагрузки, пик около 16 часов.
  const dayK = (h) => 0.25 + 0.75 * (0.5 - 0.5 * Math.cos((2 * Math.PI * (h - 4)) / 24));

  const api = { DC, NET, ROLES, BASE, POWER, HIT, STATELESS, TARGET, roleOf, harvest, spread, dcState, analyze, resilience, dayK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SandboxModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
