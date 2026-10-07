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
    // Если у сервиса есть стрелка в кэш, а следующий шаг БД, часть чтений забирает кэш (cache-aside).
    const flows = lab.flows.map((f) => {
      const r = { id: f.id, label: f.label, color: f.color, rate: f.rate(d), ok: true, path: [], missing: null, extraLat: 0, lat: 0 };
      const touch = (n, p) => { const l = r.rate * p; n.load += l; n.flows[f.id] = (n.flows[f.id] || 0) + l; r.path.push({ id: n.id, p }); };
      const edge = (a, b, p) => { const k = a + '>' + b; (edgeLoad[k] = edgeLoad[k] || {})[f.id] = r.rate * p; };
      let cur = Object.values(nodes).find((n) => has(f.chain[0], n.type));
      if (!cur) { r.ok = false; r.missing = [null, f.chain[0]]; return r; }
      let p = 1;
      touch(cur, p);
      for (let i = 1; i < f.chain.length; i++) {
        const nextId = out[cur.id].find((id) => has(f.chain[i], nodes[id].type));
        if (!nextId) { r.ok = false; r.missing = [cur.type, f.chain[i]]; break; }
        const nx = nodes[nextId];
        if (f.cacheHit && nx.def.db) {
          const c = out[cur.id].find((id) => nodes[id].def.cache);
          if (c) { edge(cur.id, c, p); touch(nodes[c], p); r.cached = true; p *= 1 - f.cacheHit; }
        }
        edge(cur.id, nextId, p);
        touch(nx, p);
        cur = nx;
      }
      return r;
    });

    const ctx = { d, deep, stage, graph, nodes, flows, out, cx: 0, cost: 0, metrics: {}, warnings: [] };
    ctx.warn = (lvl, text) => ctx.warnings.push({ lvl, text });
    const names = (spec) => [].concat(spec).map((t) => lab.blocks[t].name).join(' или ');
    flows.forEach((f) => {
      if (f.ok) return;
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
      else if (!n.load) ctx.warn('info', `«${def.name}» ни с чем не связан: через него не идёт ни один поток.`);
    });
    flows.forEach((f) => {
      f.lat = f.extraLat + f.path.reduce((s, x) => s + (nodes[x.id].def.lat || 0) * nodes[x.id].q * x.p, 0);
    });
    if (lab.rules) lab.rules(ctx);

    const m = Object.assign({ maxU, bottleneck, served: maxU > 1 ? 1 / maxU : 1, cost: ctx.cost, cx: ctx.cx, routed: flows.every((f) => f.ok) }, ctx.metrics);
    return { d, graph, nodes, flows, edgeLoad, warnings: ctx.warnings, m };
  }

  const api = { analyze, TARGET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LabEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
