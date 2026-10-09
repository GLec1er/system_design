/* Движок «карты»: по графу блоков и стрелок прокладывает потоки запросов,
   считает нагрузку, реплики, задержку. Не зависит от DOM (тесты: node simulator/lab/test.js).
   Модель учебная: числа правдоподобные, но не измерения. */
(function (root) {
  const TARGET = 0.7; // автомасштаб держит загрузку около 70%
  const queue = (u) => (u >= 0.95 ? 12 : Math.min(12, 1 + (0.5 * u * u) / (1 - u)));
  const has = (spec, t) => [].concat(spec).includes(t);
  const rps = (v) => (v >= 10 ? Math.round(v).toLocaleString('ru-RU') : String(+v.toFixed(1)));

  // Настройки «тяжёлых» блоков, общие для всех глав. book: так делают в книге (остальное эксперименты).
  // Блок включает их через def.tune: 'sql' или 'kafka'; варианты ключа шардирования задаёт глава (def.shardKeys).
  const TUNE = {
    sql: [
      { id: 'replicas', label: 'Реплики для чтения', book: true, opts: [0, 1, 2, 3, 5], value: 0,
        hint: 'Чтения делятся между primary и репликами. Запись всё равно идёт только в primary.' },
      { id: 'sync', label: 'Репликация', when: (c) => c.replicas > 0, value: 'async',
        opts: [{ v: 'async', label: 'Асинхронная', note: 'Запись не ждёт реплик, но реплика может отставать на доли секунды.' }, { v: 'sync', label: 'Синхронная', note: 'Запись ждёт подтверждения реплики: данные свежие, но запись медленнее.' }] },
      { id: 'shards', label: 'Шарды', book: true, opts: [1, 2, 4, 8, 16], value: 1,
        hint: 'Данные и запись делятся между независимыми БД. Масштабирует запись, но запросы через шарды становятся сложнее.' },
      { id: 'shardKey', label: 'Ключ шардирования', book: true, when: (c, def) => c.shards > 1 && def.shardKeys, opts: (def) => def.shardKeys, value: (def) => def.shardKeys && def.shardKeys[0].v },
      { id: 'partition', label: 'Партиционирование', value: 'none',
        opts: [{ v: 'none', label: 'Нет' }, { v: 'date', label: 'По дате', note: 'Таблица делится на части внутри одной БД: запросы читают меньше данных (+20% к запасу), старые даты легко архивировать.' }] },
    ],
    kafka: [
      { id: 'brokers', label: 'Брокеры', opts: [1, 3, 5, 9], value: 3,
        hint: 'Серверы кластера. Партиции и их копии раскладываются по брокерам; каждый брокер пишет на диск ограниченный поток.' },
      { id: 'partitions', label: 'Партиции', opts: [1, 3, 6, 12, 24], value: 3,
        hint: 'Единица параллелизма: в группе потребителей на одну партицию работает один потребитель. Больше партиций, больше потребителей.' },
      { id: 'rf', label: 'Репликация (RF)', opts: [1, 2, 3], value: 3,
        hint: 'Сколько брокеров хранят копию партиции. RF=1 дёшево, но падение брокера теряет события. Каждая копия это ещё одна запись на диск брокера.' },
      { id: 'acks', label: 'acks', value: 'all',
        opts: [{ v: '1', label: '1', note: 'Подтверждает только лидер: быстрее, но событие может потеряться при падении лидера.' }, { v: 'all', label: 'all', note: 'Ждём все синхронные реплики: надёжно, чуть медленнее.' }] },
    ],
    rabbit: [
      { id: 'queues', label: 'Очереди', opts: [1, 2, 4, 8], value: 1,
        hint: 'Exchange раскладывает сообщения по очередям. Одна очередь живёт на одном узле и обрабатывается одним ядром, поэтому масштабируют числом очередей.' },
      { id: 'qtype', label: 'Тип очереди', value: 'quorum',
        opts: [{ v: 'classic', label: 'Classic', note: 'Быстрее, но без репликации. Durable-очередь и persistent-сообщения переживут перезапуск узла, но не потерю его диска.' }, { v: 'quorum', label: 'Quorum', note: 'Реплицируется на 3 узла через Raft: надёжно, но пропускная способность примерно вдвое ниже.' }] },
      { id: 'prefetch', label: 'Prefetch', opts: [1, 10, 100], value: 10,
        hint: 'Сколько неподтверждённых сообщений потребитель берёт за раз. 1: честно, но потребитель простаивает в ожидании. 100: быстро, но сообщения копятся у медленного потребителя.' },
    ],
    lb: [
      { id: 'layer', label: 'Уровень', value: 'l4',
        opts: [{ v: 'l4', label: 'L4 (TCP)', note: 'Смотрит только IP и порт, TLS не расшифровывает. Очень быстрый и дешёвый, держит миллионы соединений, но не видит URL и не может разводить запросы по путям.' },
          { v: 'l7', label: 'L7 (HTTP)', note: 'Разбирает HTTP: видит путь, заголовки и cookie, сам снимает TLS, может слать /static и /api в разные пулы и повторять запрос. Дороже по CPU: в модели в 2,5 раза меньше запросов на копию и +1 мс.' }] },
      { id: 'alg', label: 'Алгоритм', value: 'rr',
        opts: [{ v: 'rr', label: 'Round robin', note: 'По кругу: 1, 2, 3, 1, 2, 3. Просто, но не учитывает, что бронь тяжелее просмотра: часть копий за ним перегружена, полезно около 90% их мощности.' },
          { v: 'least', label: 'Least connections', note: 'Шлёт туда, где меньше открытых запросов. Сам выравнивает долгие и короткие запросы: копии за ним загружены ровно.' },
          { v: 'hash', label: 'IP hash', note: 'Один клиент всегда попадает в одну копию (sticky). Нужно, если копия хранит сессию. Но клиенты за одним NAT (офис, мобильный оператор) садятся на одну копию: полезно около 80% мощности.' }] },
    ],
  };
  const PREFETCH = { 1: 0.6, 10: 1, 100: 1.1 };
  const LBALG = { rr: 0.9, least: 1, hash: 0.8 };
  // Шаги размеров для подбора под нагрузку (от дешёвых к дорогим).
  const SIZES = {
    sql: () => [1, 2, 4, 8, 16].flatMap((shards) => [0, 1, 2, 3, 5].map((replicas) => ({ shards, replicas, w: shards * (1 + 0.6 * replicas) }))),
    kafka: () => [1, 3, 5, 9].flatMap((brokers) => [1, 3, 6, 12, 24].map((partitions) => ({ brokers, partitions, w: brokers * 3 + partitions * 0.1 }))),
    rabbit: () => [1, 2, 4, 8].map((queues) => ({ queues, w: queues })),
  };
  const optsOf = (f, def) => (typeof f.opts === 'function' ? f.opts(def) : f.opts) || [];
  function tuneOf(def, cfg) {
    const out = {};
    (TUNE[def.tune] || []).forEach((f) => (out[f.id] = (cfg && cfg[f.id] !== undefined) ? cfg[f.id] : (typeof f.value === 'function' ? f.value(def) : f.value)));
    return out;
  }

  function analyze(lab, graph, inputs, deep, stage) {
    const d = lab.derive(inputs, deep);
    const nodes = {}, out = {}, edgeLoad = {};
    graph.nodes.forEach((n) => {
      const def = lab.blocks[n.type];
      if (!def) return;
      nodes[n.id] = { id: n.id, type: n.type, def, cfg: tuneOf(def, n.cfg), load: 0, wload: 0, flows: {}, capMult: 1, maxRep: def.maxRep || 1, badges: [] };
      out[n.id] = [];
    });
    graph.edges.forEach((e) => nodes[e.from] && nodes[e.to] && out[e.from].push(e.to));

    // Поток идёт по цепочке типов блоков, каждый шаг это прямая стрелка.
    // Блок с absorb (кэш, CDN, rate limiter) висит сбоку: если от текущего узла есть стрелка к нему,
    // он забирает свою долю запросов этого потока (кэш только перед походом в БД: at: 'db').
    const flows = lab.flows.map((f) => {
      const r = { id: f.id, label: f.label, color: f.color, optional: !!f.optional, rate: f.rate(d), ok: true, path: [], missing: null, extraLat: 0, lat: 0 };
      // Нагрузку применяем в конце: недостроенный обязательный поток всё равно виден на карте,
      // а недостроенный необязательный (например, Kafka без потребителей) ничего не нагружает.
      const ops = [];
      const touch = (n, p) => ops.push(() => { const l = r.rate * p; n.load += l; if (f.write) n.wload += l; n.flows[f.id] = (n.flows[f.id] || 0) + l; r.path.push({ id: n.id, p }); });
      const edge = (a, b, p) => ops.push(() => { const k = a + '>' + b; (edgeLoad[k] = edgeLoad[k] || {})[f.id] = r.rate * p; });
      let cur = Object.values(nodes).find((n) => has(f.chain[0], n.type));
      if (!cur) { r.ok = false; r.missing = [null, f.chain[0]]; return r; }
      let p = 1;
      const used = new Set();
      touch(cur, p);
      for (let i = 1; i < f.chain.length; i++) {
        let nextId = out[cur.id].find((id) => has(f.chain[i], nodes[id].type));
        // Прозрачный блок (via: балансировщик) стоит между шагами цепочки: поток проходит через него.
        const via = !nextId && out[cur.id].find((id) => nodes[id].def.via);
        if (via) nextId = out[via].find((id) => has(f.chain[i], nodes[id].type));
        if (!nextId) { r.ok = false; r.missing = [via ? nodes[via].type : cur.type, f.chain[i]]; break; }
        const nx = nodes[nextId];
        // Порядок обращения к кэшам задаёт не порядок стрелок, а скорость: сначала самый быстрый (L1), потом остальные.
        out[cur.id].slice().sort((x, y) => (nodes[x].def.lat || 0) - (nodes[y].def.lat || 0) || (x < y ? -1 : 1)).forEach((id) => {
          const a = nodes[id], h = a.def.absorb && a.def.absorb[f.id];
          if (!h || used.has(id) || (a.def.at === 'db' && !nx.def.db)) return;
          used.add(id); edge(cur.id, id, p); touch(a, p); p *= 1 - h;
          if (a.def.cache) r.cached = true;
        });
        if (via) { edge(cur.id, via, p); touch(nodes[via], p); cur = nodes[via]; }
        edge(cur.id, nextId, p);
        touch(nx, p);
        cur = nx;
      }
      if (r.ok || !r.optional) ops.forEach((op) => op());
      return r;
    });

    const ctx = { d, deep, stage, graph, nodes, flows, out, cx: 0, cost: 0, metrics: {}, warnings: [] };
    ctx.warn = (lvl, text) => ctx.warnings.push({ lvl, text });
    const names = (spec) => [].concat(spec).map((t) => lab.blocks[t].name).join(' или ');
    flows.forEach((f) => {
      if (f.ok || f.optional) return;
      const [from, to] = f.missing;
      ctx.warn('bad', from ? `«${f.label}» не доходит: нужна стрелка ${lab.blocks[from].name} → ${names(to)}.` : `«${f.label}» не начинается: добавь блок «${names(to)}».`);
    });
    // Потребители брокеров: за Kafka в группе не больше потребителей, чем партиций; у RabbitMQ темп задаёт prefetch.
    flows.forEach((f) => f.ok && f.path.forEach((x, i) => {
      const b = nodes[x.id], nx = f.path[i + 1] && nodes[f.path[i + 1].id];
      if (!nx || nx.def.db || nx.def.cache) return;
      if (b.def.tune === 'kafka') { nx.maxRep = Math.min(nx.maxRep, b.cfg.partitions); nx.consumerOf = b; }
      if (b.def.tune === 'rabbit') { nx.capMult = PREFETCH[b.cfg.prefetch] || 1; nx.consumerOf = b; }
      if (b.def.tune === 'lb') { nx.capMult = LBALG[b.cfg.alg] || 1; nx.lbBy = b; }
    }));
    Object.values(nodes).forEach((n) => { if (n.def.tune === 'lb' && n.cfg.layer === 'l7') { n.capMult = 0.4; n.latAdd = 1; } });
    if (lab.model) lab.model(ctx);

    Object.values(nodes).forEach((n) => { if (!Object.keys(n.flows).length) n.why = idleWhy(lab, nodes, flows, n); });

    let maxU = 0, bottleneck = null, bgU = 0;
    Object.values(nodes).forEach((n) => {
      const def = n.def;
      ctx.cx += def.cx || 0;
      n.rep = 1; n.util = 0; n.q = 1;
      if (!def.cap) return;
      const cap = def.cap * n.capMult, c = n.cfg, W = n.wload, Rd = n.load - n.wload;
      if (def.tune === 'sql') {
        // Размер задаёт ученик. Запись идёт только в primary своего шарда, чтения делятся между primary и репликами.
        // Неровный ключ шардирования (skew) отдаёт горячему шарду больше своей доли, считаем по нему.
        const s = c.shards, R = c.replicas, key = s > 1 && def.shardKeys && def.shardKeys.find((k) => k.v === c.shardKey);
        const hot = s > 1 ? Math.max(1 / s, (key && key.skew) || 0) : 1, one = cap * (c.partition !== 'none' ? 1.2 : 1);
        const part = (sh) => ({ share: sh, pU: (Rd * sh / (1 + R) + W * sh) / one, rU: R ? (Rd * sh) / (1 + R) / one : 0 });
        n.rep = s;
        n.util = part(hot).pU;
        n.capTotal = n.util ? n.load / n.util : one * s;
        n.cluster = { shards: [hot].concat(Array(s - 1).fill(s > 1 ? (1 - hot) / (s - 1) : 0)).map(part), replicas: R, key: key && key.label, sync: c.sync };
        n.explain = [
          `Запись ${rps(W)} rps идёт только в primary${s > 1 ? ' своего шарда' : ''}: реплики её не снимают.`,
          R ? `Чтение ${rps(Rd)} rps делится между primary и ${R} репл.: на каждую копию ${rps((Rd * hot) / (1 + R))} rps.` : `Чтение ${rps(Rd)} rps тоже идёт в primary: реплик нет.`,
          s > 1 ? (hot > 1 / s + 1e-9 ? `Ключ «${key.label}» неровный: горячий шард получает ${Math.round(hot * 100)}% запросов вместо ${Math.round(100 / s)}%.` : `Каждый из ${s} шардов хранит 1/${s} данных и получает 1/${s} запросов.`) : 'Шард один: весь объём и вся запись на одном primary.',
        ];
        if (n.util > 0.9) {
          const wr = W * hot >= (Rd * hot) / (1 + R);
          n.limit = wr ? 'запись в primary' : 'чтения';
          n.need = wr ? (s < 16 ? `больше шардов${hot > 1 / s + 1e-9 ? ' и ровный ключ шардирования' : ''}` : 'предел модели (16 шардов): нужна другая модель данных или очередь записи')
            : (R < 5 ? 'кэш перед БД или больше реплик' : 'кэш перед БД: реплик уже 5');
        }
        ctx.cost += (def.cost || 0) * s * (1 + 0.6 * R);
        ctx.cx += (s > 1 ? 1 + 0.3 * Math.log2(s) : 0) + 0.2 * R + (c.partition !== 'none' ? 0.5 : 0);
      } else if (def.tune === 'kafka') {
        // Предел дают партиции (параллелизм) и диски брокеров: каждое событие пишется RF раз.
        // acks=all ждёт копии на других брокерах: событие подтверждается позже (+5 мс), партиция пропускает меньше.
        const rf = Math.min(c.rf, c.brokers), pcap = cap * c.partitions * (c.acks === '1' ? 1.2 : 1), bcap = ((def.brokerCap || 20000) * c.brokers) / rf;
        n.rep = c.partitions;
        n.capTotal = Math.min(pcap, bcap);
        n.util = n.load / n.capTotal;
        n.cluster = { brokers: c.brokers, partitions: c.partitions, rf };
        n.explain = [
          `Поток ${rps(n.load)} rps делится по ${c.partitions} партициям, одна партиция ≈ ${rps(cap)} rps.`,
          `Каждое событие пишется на ${rf} брокер${rf === 1 ? '' : 'а'}: ${c.brokers} брокер${c.brokers === 1 ? '' : c.brokers < 5 ? 'а' : 'ов'} вместе принимают ${rps(bcap)} rps.`,
        ];
        n.latAdd = c.acks === 'all' && rf > 1 ? 5 : 0;
        if (c.rf > c.brokers) ctx.warn('bad', `Kafka: RF=${c.rf} при ${c.brokers} брокер${c.brokers === 1 ? 'е' : 'ах'} невозможен, копий будет только ${rf}.`);
        if (n.util > 0.9) { n.limit = pcap <= bcap ? 'партиции' : 'диски брокеров'; n.need = pcap <= bcap ? 'больше партиций' : 'больше брокеров'; }
        ctx.cost += (def.cost || 0) * (c.brokers / 3) * (0.7 + 0.1 * rf);
        ctx.cx += c.brokers > 3 ? 0.5 : 0;
      } else if (def.tune === 'rabbit') {
        const qc = cap * (c.qtype === 'quorum' ? 0.5 : 1);
        n.rep = c.queues;
        n.capTotal = qc * c.queues;
        n.util = n.load / n.capTotal;
        n.cluster = { queues: c.queues, qtype: c.qtype, prefetch: c.prefetch };
        n.explain = [`Exchange раскладывает ${rps(n.load)} rps по ${c.queues} очеред${c.queues === 1 ? 'и' : 'ям'}. Одна очередь ≈ ${rps(qc)} rps${c.qtype === 'quorum' ? ': quorum реплицирует каждое сообщение, поэтому вдвое медленнее' : ''}.`];
        if (n.util > 0.9) { n.limit = 'очереди'; n.need = c.queues < 8 ? 'больше очередей' : 'Kafka: у неё параллелизм выше'; }
        ctx.cost += (def.cost || 0) * (c.qtype === 'quorum' ? 1.5 : 1) * (1 + 0.1 * (c.queues - 1));
      } else {
        n.want = Math.ceil(n.load / (cap * TARGET));
        n.rep = Math.max(1, Math.min(n.maxRep, n.want));
        n.capTotal = cap * n.rep;
        n.util = n.load / n.capTotal;
        const P = n.consumerOf && n.consumerOf.def.tune === 'kafka' && n.consumerOf.cfg.partitions;
        n.explain = n.load ? [`${rps(n.load)} rps ÷ ${rps(cap)} rps на копию: копий ${n.rep}${n.want > n.rep ? `, а нужно ${n.want}` : ', загрузка около 70%'}.`] : [];
        if (def.tune === 'lb') n.explain.push(n.cfg.layer === 'l7' ? 'L7 разбирает HTTP и снимает TLS: копия держит в 2,5 раза меньше запросов, чем L4, и добавляет 1 мс.' : 'L4 только пересылает TCP-соединения: копия держит очень много запросов.');
        if (n.lbBy) n.explain.push(`Перед блоком балансировщик (${{ rr: 'round robin', least: 'least connections', hash: 'IP hash' }[n.lbBy.cfg.alg]}): копии загружены ${n.capMult < 1 ? `неровно, полезно ${Math.round(n.capMult * 100)}% их мощности` : 'ровно'}.`);
        if (P) n.explain.push(`Читает из Kafka: в группе потребителей не больше, чем партиций (${P}).`);
        if (n.consumerOf && n.consumerOf.def.tune === 'rabbit') n.explain.push(`Читает из RabbitMQ: потребители конкурируют за очередь, их число не ограничено. Prefetch ${n.consumerOf.cfg.prefetch} даёт ${Math.round(n.capMult * 100)}% скорости.`);
        if (n.util > 0.9) { n.limit = P ? `потребителей не больше, чем партиций (${P})` : `предел модели: ${n.maxRep} копий`; n.need = def.overload || 'снять нагрузку раньше (кэш, CDN, rate limiter) или делить систему по регионам, в модели этого нет'; }
        ctx.cost += (def.cost || 0) * n.rep;
        if (n.rep > 1 && (def.db || def.cache)) ctx.cx += 0.3 * Math.log2(n.rep); // stateless-реплики почти бесплатны по сложности
      }
      n.q = queue(n.util);
      // Фоновые узлы (только необязательные асинхронные потоки) не решают, выдерживает ли система запросы пользователя:
      // их перегрузка это растущая очередь и задержка доставки, а не отказ брони.
      n.bg = Object.keys(n.flows).length > 0 && Object.keys(n.flows).every((id) => flows.find((f) => f.id === id).optional);
      if (n.bg) {
        if (n.util > bgU) bgU = n.util;
        if (n.util > 1) ctx.warn('warn', `Фоновая обработка в «${def.name}» не успевает: очередь растёт на ${rps(n.load - n.capTotal)} событий/с, доставка отстаёт всё сильнее. Бронь это не тормозит. Упёрся: ${n.limit}. Нужно: ${n.need}.`);
        return;
      }
      if (n.util > maxU) { maxU = n.util; bottleneck = n; }
      if (n.util > 1) ctx.warn('bad', `«${def.name}» перегружен: ${n.util < 10 ? Math.round(n.util * 100) + '%' : `в ${Math.round(n.util)} раз сверх мощности`}. Упёрся: ${n.limit}. Нужно: ${n.need}.`);
      else if (!n.load && n.why) ctx.warn(n.why.kind === 'useless' ? 'info' : 'warn', `«${def.name}» простаивает. ${n.why.text}`);
    });
    flows.forEach((f) => {
      f.lat = f.extraLat + f.path.reduce((s, x) => s + ((nodes[x.id].def.lat || 0) + (nodes[x.id].latAdd || 0)) * nodes[x.id].q * x.p, 0);
    });
    if (lab.rules) lab.rules(ctx);

    // served считается только для достроенной схемы: недостроенная не «выдерживает 100%», у неё нет ответа на часть запросов.
    const routed = Object.keys(nodes).length > 0 && flows.every((f) => f.ok || f.optional);
    const m = Object.assign({ maxU, bottleneck, bgU, routed, served: !routed ? 0 : maxU > 1 ? 1 / maxU : 1, cost: ctx.cost, cx: ctx.cx }, ctx.metrics);
    return { d, graph, nodes, flows, edgeLoad, warnings: ctx.warnings, m };
  }

  // Почему через блок не идёт ни один поток. kind: off (не подключён: не хватает стрелки),
  // dup (такой блок уже работает), useless (блок не участвует в потоках главы, это не поломка).
  function idleWhy(lab, nodes, flows, n) {
    const def = n.def, name = (t) => lab.blocks[t].name, names = (spec) => [].concat(spec).map(name).join(' или ');
    if (Object.values(nodes).some((o) => o !== n && o.type === n.type && Object.keys(o.flows).length))
      return { kind: 'dup', text: `Такой блок уже есть, и потоки идут через него. Второй ничего не получает: убери его.` };
    if (def.via) return { kind: 'off', text: `Не подключён: нужны стрелки ${(def.links || []).map(([a, b]) => (a === 'self' ? `${def.name} → ${names(b)}` : `${names(a)} → ${def.name}`)).join(' и ')}.` };
    const absorbs = lab.flows.filter((f) => def.absorb && def.absorb[f.id]);
    if (absorbs.length) {
      const from = (def.links || []).filter(([a]) => a !== 'self').map(([a]) => names(a));
      return { kind: 'off', text: `Не подключён: нужна стрелка ${from.join(' или ')} → ${def.name}. Тогда он заберёт часть потока «${absorbs.map((f) => f.label).join('», «')}».` };
    }
    const own = lab.flows.filter((f) => f.chain.some((t) => [].concat(t).includes(n.type)));
    if (!own.length) return { kind: 'useless', text: `Это не поломка: блок не участвует ни в одном потоке главы, поэтому через него ничего не идёт. ${(def.learn && def.learn.minus[0]) || ''}`.trim().replace(/[^.]$/, '$&.') };
    const tips = own.map((f) => {
      const r = flows.find((x) => x.id === f.id);
      if (!r.ok && r.missing && r.missing[0]) {
        const [a, b] = r.missing, onMap = Object.values(nodes).some((o) => [].concat(b).includes(o.type));
        return `${onMap ? 'нужна стрелка' : `добавь «${names(b)}» и проведи стрелку`} ${name(a)} → ${names(b)}, тогда здесь пойдёт «${f.label}»`;
      }
      if (!r.ok) return `сначала добавь «${names(r.missing[1])}» для потока «${f.label}»`;
      const via = r.path.map((x) => nodes[x.id]).find((o) => o !== n && f.chain.some((t) => [].concat(t).includes(o.type) && [].concat(t).includes(n.type)));
      return via ? `«${f.label}» уже идёт через «${via.def.name}», а не сюда` : null;
    }).filter(Boolean);
    return { kind: 'off', text: tips.length ? `Не подключён: ${[...new Set(tips)].join('; ')}.` : 'Не подключён: проведи к нему стрелки.' };
  }

  // Добавляет блок и сам проводит типовые стрелки из def.links: [откуда, куда], где 'self' это новый блок,
  // а тип может быть списком (берётся первый подходящий). Узел, у которого уже есть такая связь, пропускается.
  function addBlock(lab, graph, type, pos) {
    const ids = new Set(graph.nodes.map((n) => n.id));
    let id = type, k = 2;
    while (ids.has(id)) id = type + k++;
    const g = { nodes: graph.nodes.concat({ id, type, x: pos[0], y: pos[1] }), edges: graph.edges.slice() };
    const typeOf = (nid) => (g.nodes.find((n) => n.id === nid) || {}).type;
    const pick = (spec, busy) => [].concat(spec).map((t) => g.nodes.filter((n) => n.type === t && n.id !== id)).flat().find((n) => !busy(n.id));
    const def = lab.blocks[type];
    (def.links || []).forEach(([a, b]) => {
      if (a === 'self') {
        const t = pick(b, (nid) => g.edges.some((e) => e.to === nid && typeOf(e.from) === type));
        if (t) g.edges.push({ from: id, to: t.id });
      } else {
        const f = pick(a, (nid) => g.edges.some((e) => e.from === nid && typeOf(e.to) === type));
        if (f) g.edges.push({ from: f.id, to: id });
      }
    });
    // bring: без каких блоков этот бесполезен (их добавляем следом); drop: какие стрелки он заменяет.
    let out = { graph: g, id, brought: [] };
    (def.bring || []).filter((t) => !out.graph.nodes.some((n) => n.type === t)).forEach((t) => {
      const r = addBlock(lab, out.graph, t, lab.blocks[t].pos);
      out = { graph: r.graph, id, brought: out.brought.concat(t) };
    });
    const dropped = out.graph.edges.filter((e) => (def.drop || []).some(([a, b]) => out.graph.nodes.find((n) => n.id === e.from).type === a && out.graph.nodes.find((n) => n.id === e.to).type === b));
    out.graph.edges = out.graph.edges.filter((e) => !dropped.includes(e));
    out.dropped = dropped;
    return out;
  }

  // Какие стрелки осмысленны: соседние шаги в цепочках потоков и типовые связи блоков (def.links).
  function linkPairs(lab) {
    if (lab._pairs) return lab._pairs;
    const ok = new Set(), add = (a, b) => [].concat(a).forEach((x) => [].concat(b).forEach((y) => ok.add(x + '>' + y)));
    lab.flows.forEach((f) => f.chain.slice(1).forEach((t, i) => add(f.chain[i], t)));
    Object.entries(lab.blocks).forEach(([type, def]) => (def.links || []).forEach(([a, b]) => add(a === 'self' ? type : a, b === 'self' ? type : b)));
    return (lab._pairs = ok);
  }
  const canLink = (lab, a, b) => linkPairs(lab).has(a + '>' + b);
  const linkTargets = (lab, a) => Object.keys(lab.blocks).filter((b) => canLink(lab, a, b));

  // Подбор размера блока с настройками: самый дешёвый, при котором он и те, кого он кормит, загружены не больше TARGET.
  // Если не хватает даже максимума, возвращает максимум с ok: false.
  function sizeFor(lab, graph, inputs, deep, stage, id) {
    const g0 = graph.nodes.find((n) => n.id === id), def = lab.blocks[g0.type], base = tuneOf(def, g0.cfg);
    const ids = [id].concat(graph.edges.filter((e) => e.from === id).map((e) => e.to));
    let best = null;
    for (const s of SIZES[def.tune]().sort((a, b) => a.w - b.w)) {
      if (s.brokers && s.brokers < base.rf) continue; // не жертвуем надёжностью ради подбора
      const cfg = Object.assign({}, base, s); delete cfg.w;
      const r = analyze(lab, { nodes: graph.nodes.map((n) => (n.id === id ? Object.assign({}, n, { cfg }) : n)), edges: graph.edges }, inputs, deep, stage);
      best = { cfg, r, ok: ids.every((x) => !r.nodes[x] || r.nodes[x].util <= TARGET + 0.001) };
      if (best.ok) break;
    }
    return best;
  }

  // Эталон главы как граф: узел задаётся типом или [тип, id, [x, y]], cfg по id.
  function refGraph(lab, stage) {
    const R = lab.reference[stage];
    return {
      nodes: R.nodes.map((n) => { const [type, id, pos] = [].concat(n), p = pos || lab.blocks[type].pos, cfg = R.cfg && R.cfg[id || type];
        return Object.assign({ id: id || type, type, x: p[0], y: p[1] }, cfg && { cfg: Object.assign({}, cfg) }); }),
      edges: R.edges.map(([from, to]) => ({ from, to })),
    };
  }

  // Эталон под текущий сценарий. Если оригинал из книги выдерживает (до 90%), он и возвращается.
  // Иначе по порядку: типовые добавки главы (reference.adapt: кэши, CDN…), пока они снижают перегрузку,
  // потом подбор размеров перегруженных БД и брокеров. Что не вытянуть, уходит в blockers с причиной.
  function adapt(lab, stage, inputs, deep) {
    const run = (g) => analyze(lab, g, inputs, deep, stage);
    const over = (r) => Object.values(r.nodes).reduce((s, n) => s + Math.max(0, n.util - 0.9), 0);
    let g = refGraph(lab, stage), r = run(g);
    const before = r, changes = [];
    (lab.reference[stage].adapt || []).forEach((a) => {
      if (a.replace) {
        // Замена технологии (например, Redis → Memcached): те же id и стрелки, другой тип, если это снижает перегрузку.
        // Каждый узел отдельно: второй кэш может обслуживать другой поток, где замена хуже.
        g.nodes.filter((n) => n.type === a.replace).forEach(({ id }) => {
          if (r.m.maxU <= 0.9) return;
          const g2 = { nodes: g.nodes.map((n) => (n.id === id ? Object.assign({}, n, { type: a.with }) : n)), edges: g.edges }, r2 = run(g2);
          if (over(r2) < over(r) - 0.01) { const by = g.edges.filter((e) => e.to === id).map((e) => lab.blocks[g.nodes.find((n) => n.id === e.from).type]).filter((b) => b.cat === 'svc').map((b) => b.name).join(', ');
            changes.push(`${lab.blocks[a.replace].name}${by ? ` у ${by}` : ''} → ${lab.blocks[a.with].name}: ${a.why}`); g = g2; r = r2; }
        });
        return;
      }
      const id = a.id || a.add, from = g.nodes.find((n) => n.type === a.from);
      if (r.m.maxU <= 0.9 || !from || g.nodes.some((n) => n.id === id)) return;
      const p = a.pos || lab.blocks[a.add].pos, g2 = { nodes: g.nodes.concat({ id, type: a.add, x: p[0], y: p[1] }), edges: g.edges.concat({ from: from.id, to: id }) };
      const r2 = run(g2);
      if (over(r2) < over(r) - 0.01) { changes.push(`+ ${lab.blocks[a.add].name}: ${a.why}`); g = g2; r = r2; }
    });
    const maxed = new Set();
    for (let i = 0; i < 20 && r.m.maxU > 0.9; i++) {
      const hot = Object.values(r.nodes).filter((n) => n.def.tune && n.util > 0.9 && !maxed.has(n.id)).sort((a, b) => b.util - a.util)[0];
      if (!hot) break;
      const s = sizeFor(lab, g, inputs, deep, stage, hot.id), diff = TUNE[hot.def.tune].filter((f) => s.cfg[f.id] !== hot.cfg[f.id]);
      maxed.add(hot.id);
      if (!diff.length || over(s.r) >= over(r) - 0.01) continue;
      changes.push(`${hot.def.name}: ${diff.map((f) => `${f.label.toLowerCase()} ${hot.cfg[f.id]} → ${s.cfg[f.id]}`).join(', ')}`);
      g = { nodes: g.nodes.map((n) => (n.id === hot.id ? Object.assign({}, n, { cfg: s.cfg }) : n)), edges: g.edges };
      r = s.r;
    }
    const blockers = Object.values(r.nodes).filter((n) => n.util > 0.9 && !n.bg).sort((a, b) => b.util - a.util).map((n) => ({ name: n.def.name, util: n.util, limit: n.limit, need: n.need }));
    return { graph: g, r, before, changes, original: !changes.length, ok: r.m.maxU <= 0.9, blockers };
  }

  const sizable = (t) => !!SIZES[t];
  const api = { sizable, analyze, addBlock, canLink, linkTargets, sizeFor, refGraph, adapt, TUNE, optsOf, tuneOf, TARGET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LabEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
