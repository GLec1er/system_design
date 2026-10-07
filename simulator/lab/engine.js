/* Движок «карты»: по графу блоков и стрелок прокладывает потоки запросов,
   считает нагрузку, реплики, задержку. Не зависит от DOM (тесты: node simulator/lab/test.js).
   Модель учебная: числа правдоподобные, но не измерения. */
(function (root) {
  const TARGET = 0.7; // автомасштаб держит загрузку около 70%
  const queue = (u) => (u >= 0.95 ? 12 : Math.min(12, 1 + (0.5 * u * u) / (1 - u)));
  const has = (spec, t) => [].concat(spec).includes(t);

  function analyze(lab, graph, inputs, deep, stage) {
    const d = lab.derive(inputs, deep);
    const nodes = {}, out = {}, edgeLoad = {};
    graph.nodes.forEach((n) => {
      const def = lab.blocks[n.type];
      if (!def) return;
      nodes[n.id] = { id: n.id, type: n.type, def, load: 0, flows: {}, capMult: 1, maxRep: def.maxRep || 1, badges: [] };
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
      const touch = (n, p) => ops.push(() => { const l = r.rate * p; n.load += l; n.flows[f.id] = (n.flows[f.id] || 0) + l; r.path.push({ id: n.id, p }); });
      const edge = (a, b, p) => ops.push(() => { const k = a + '>' + b; (edgeLoad[k] = edgeLoad[k] || {})[f.id] = r.rate * p; });
      let cur = Object.values(nodes).find((n) => has(f.chain[0], n.type));
      if (!cur) { r.ok = false; r.missing = [null, f.chain[0]]; return r; }
      let p = 1;
      const used = new Set();
      touch(cur, p);
      for (let i = 1; i < f.chain.length; i++) {
        const nextId = out[cur.id].find((id) => has(f.chain[i], nodes[id].type));
        if (!nextId) { r.ok = false; r.missing = [cur.type, f.chain[i]]; break; }
        const nx = nodes[nextId];
        out[cur.id].forEach((id) => {
          const a = nodes[id], h = a.def.absorb && a.def.absorb[f.id];
          if (!h || used.has(id) || (a.def.at === 'db' && !nx.def.db)) return;
          used.add(id); edge(cur.id, id, p); touch(a, p); p *= 1 - h;
          if (a.def.cache) r.cached = true;
        });
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
    if (lab.model) lab.model(ctx);

    Object.values(nodes).forEach((n) => { if (!Object.keys(n.flows).length) n.why = idleWhy(lab, nodes, flows, n); });

    let maxU = 0, bottleneck = null;
    Object.values(nodes).forEach((n) => {
      const def = n.def;
      ctx.cx += def.cx || 0;
      n.rep = 1; n.util = 0; n.q = 1;
      if (!def.cap) return;
      const cap = def.cap * n.capMult;
      n.rep = Math.max(1, Math.min(n.maxRep, Math.ceil(n.load / (cap * TARGET))));
      n.capTotal = cap * n.rep;
      n.util = n.load / n.capTotal;
      n.q = queue(n.util);
      ctx.cost += (def.cost || 0) * n.rep;
      if (n.rep > 1 && (def.db || def.cache)) ctx.cx += 0.3 * Math.log2(n.rep); // stateless-реплики почти бесплатны по сложности
      if (n.util > maxU) { maxU = n.util; bottleneck = n; }
      if (n.util > 1) ctx.warn('bad', `«${def.name}» перегружен: ${Math.round(n.util * 100)}% даже на ${n.rep} ${def.repLabel || 'репл.'}. ${def.overload || ''}`);
      else if (!n.load && n.why) ctx.warn(n.why.kind === 'useless' ? 'info' : 'warn', `«${def.name}» простаивает. ${n.why.text}`);
    });
    flows.forEach((f) => {
      f.lat = f.extraLat + f.path.reduce((s, x) => s + (nodes[x.id].def.lat || 0) * nodes[x.id].q * x.p, 0);
    });
    if (lab.rules) lab.rules(ctx);

    const m = Object.assign({ maxU, bottleneck, served: maxU > 1 ? 1 / maxU : 1, cost: ctx.cost, cx: ctx.cx, routed: flows.every((f) => f.ok || f.optional) }, ctx.metrics);
    return { d, graph, nodes, flows, edgeLoad, warnings: ctx.warnings, m };
  }

  // Почему через блок не идёт ни один поток. kind: off (не подключён: не хватает стрелки),
  // dup (такой блок уже работает), useless (блок не участвует в потоках главы, это не поломка).
  function idleWhy(lab, nodes, flows, n) {
    const def = n.def, name = (t) => lab.blocks[t].name, names = (spec) => [].concat(spec).map(name).join(' или ');
    if (Object.values(nodes).some((o) => o !== n && o.type === n.type && Object.keys(o.flows).length))
      return { kind: 'dup', text: `Такой блок уже есть, и потоки идут через него. Второй ничего не получает: убери его.` };
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

  const api = { analyze, addBlock, canLink, linkTargets, TARGET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LabEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
