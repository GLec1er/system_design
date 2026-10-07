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
      else if (!n.load) ctx.warn('info', `«${def.name}» простаивает: через него не идёт ни один поток.`);
    });
    flows.forEach((f) => {
      f.lat = f.extraLat + f.path.reduce((s, x) => s + (nodes[x.id].def.lat || 0) * nodes[x.id].q * x.p, 0);
    });
    if (lab.rules) lab.rules(ctx);

    const m = Object.assign({ maxU, bottleneck, served: maxU > 1 ? 1 / maxU : 1, cost: ctx.cost, cx: ctx.cx, routed: flows.every((f) => f.ok || f.optional) }, ctx.metrics);
    return { d, graph, nodes, flows, edgeLoad, warnings: ctx.warnings, m };
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
    (lab.blocks[type].links || []).forEach(([a, b]) => {
      if (a === 'self') {
        const t = pick(b, (nid) => g.edges.some((e) => e.to === nid && typeOf(e.from) === type));
        if (t) g.edges.push({ from: id, to: t.id });
      } else {
        const f = pick(a, (nid) => g.edges.some((e) => e.from === nid && typeOf(e.to) === type));
        if (f) g.edges.push({ from: f.id, to: id });
      }
    });
    return { graph: g, id };
  }

  const api = { analyze, addBlock, TARGET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LabEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
