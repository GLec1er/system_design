/* Движок симулятора. Не зависит от DOM, работает и в браузере, и в Node (для тестов).
   Модель учебная: цифры правдоподобные, но не измерения. Цель: почувствовать компромиссы. */
(function (root) {
  const TARGET_UTIL = 0.7;

  const clampInt = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

  function queueFactor(u) {
    if (u >= 0.95) return 12;
    return Math.min(12, 1 + (0.5 * u * u) / (1 - u));
  }

  function baseCompute(sc, st) {
    const d = sc.derive(st.inputs);
    const s = { stages: {}, cost: 0, cx: 0, quality: sc.baseQuality, comps: [], extra: {} };

    sc.stages.forEach((g) => {
      s.stages[g.id] = Object.assign({ capMult: 1, effReplicas: null, redundant: true, scalable: true, path: true, avail: 0.999, cost: 0, lat: 0, flow: sc.flows[0].id }, g, {
        replicas: clampInt(st.replicas[g.id] ?? g.replicas ?? 1, 1, g.maxRep || 200),
        hidden: !!g.hidden,
        load: 0,
        badges: [],
      });
    });
    const L = sc.load(d);
    Object.keys(L).forEach((k) => (s.stages[k].load = L[k]));
    sc.stages.forEach((g) => {
      if (g.follow) s.stages[g.id].replicas = s.stages[g.follow].replicas;
    });

    sc.components.forEach((c) => {
      if (!st.active[c.id]) return;
      if (c.apply) c.apply(s, d, st);
      s.cx += c.cx || 0;
      s.cost += c.cost || 0;
      s.quality += c.q || 0;
      s.comps.push(c);
      if (c.at && s.stages[c.at]) s.stages[c.at].badges.push(c);
    });

    // итоги по стадиям
    const visible = Object.values(s.stages).filter((x) => !x.hidden);
    let maxU = 0, bottleneck = null, availProd = 1, cost = s.cost, cx = s.cx;
    visible.forEach((x) => {
      const eff = x.follow ? x.replicas : x.effReplicas ?? x.replicas;
      x.capTotal = x.cap * x.capMult * (x.scalable ? eff : 1);
      x.util = x.capTotal > 0 ? x.load / x.capTotal : 0;
      x.qf = queueFactor(x.util);
      x.latEff = x.lat * x.qf;
      const repForAvail = x.scalable ? x.replicas : 1;
      const k = !x.redundant ? 1 : repForAvail >= 3 ? 3 : repForAvail >= 2 ? 2 : 1;
      x.availEff = 1 - Math.pow(1 - x.avail, k);
      if (x.critical !== false) availProd *= x.availEff;
      cost += x.cost * (x.scalable ? x.replicas : 1);
      if (x.scalable && !x.follow && x.replicas > 1) cx += (x.cxRep ?? 0.25) * Math.log2(x.replicas);
      if (x.util > maxU) { maxU = x.util; bottleneck = x; }
    });

    const lat = {};
    sc.flows.forEach((f) => (lat[f.id] = 0));
    visible.forEach((x) => { if (x.path) lat[x.flow] += x.latEff; });

    const m = {
      maxU, bottleneck, headroom: maxU > 0 ? 1 / maxU : Infinity,
      served: maxU > 1 ? 1 / maxU : 1,
      lat, avail: availProd, cost, cx,
      quality: Math.max(0, Math.min(100, s.quality)),
    };
    s.visible = visible;
    s.warnings = [];
    const warn = (lvl, text) => s.warnings.push({ lvl, text });
    visible.forEach((x) => {
      if (x.util > 1) warn('bad', `«${x.name}» перегружен: ${Math.round(x.util * 100)}% от мощности. Узкое место системы.`);
      else if (x.util > 0.85) warn('warn', `«${x.name}» близок к пределу (${Math.round(x.util * 100)}%): любой всплеск нагрузки его положит.`);
      if (x.scalable && !x.follow && x.replicas >= 4 && x.util < 0.12 && x.load > 0) warn('info', `«${x.name}» простаивает (${Math.round(x.util * 100)}%) при ${x.replicas} репликах: переплачиваешь.`);
    });
    if (sc.rules) sc.rules(s, d, st, m, warn);
    return { d, s, m };
  }

  function compute(sc, st) {
    if (!st.auto) return baseCompute(sc, st);
    const work = Object.assign({}, st, { replicas: Object.assign({}, st.replicas) });
    const free = sc.stages.filter((g) => g.scalable !== false && !g.follow);
    for (let pass = 0; pass < 3; pass++) {
      free.forEach((g) => {
        const max = g.maxRep || 200;
        let best = 1, prevCap = -1;
        for (let r = 1; r <= max; r++) {
          work.replicas[g.id] = r;
          const res = baseCompute(sc, work);
          const x = res.s.stages[g.id];
          if (x.hidden) { best = 1; break; }
          best = r;
          const deps = sc.stages.filter((o) => o.follow === g.id).map((o) => res.s.stages[o.id].util);
          if (Math.max(x.util, ...deps) <= TARGET_UTIL) break;
          if (x.capTotal <= prevCap) { best = r - 1 || 1; break; } // дальше мощность не растёт
          prevCap = x.capTotal;
        }
        work.replicas[g.id] = best;
      });
    }
    const res = baseCompute(sc, work);
    res.replicas = work.replicas;
    return res;
  }

  function cascade(sc, active) {
    let changed = true;
    while (changed) {
      changed = false;
      sc.components.forEach((x) => {
        if (active[x.id] && (x.requires || []).some((r) => !active[r])) { delete active[x.id]; changed = true; }
      });
    }
  }

  function toggle(sc, st, id) {
    const next = { inputs: st.inputs, replicas: st.replicas, auto: st.auto, active: Object.assign({}, st.active) };
    const c = sc.components.find((x) => x.id === id);
    if (next.active[id]) {
      delete next.active[id];
    } else {
      if ((c.requires || []).some((r) => !next.active[r])) return st;
      if (c.group) sc.components.forEach((x) => { if (x.group === c.group) delete next.active[x.id]; });
      next.active[id] = true;
    }
    cascade(sc, next.active);
    return next;
  }

  function canEnable(sc, st, id) {
    const c = sc.components.find((x) => x.id === id);
    const miss = (c.requires || []).filter((r) => !st.active[r]);
    return { ok: miss.length === 0, missing: miss.map((r) => sc.components.find((x) => x.id === r).name) };
  }

  function preview(sc, st, id) {
    const a = compute(sc, st).m;
    const b = compute(sc, toggle(sc, st, id)).m;
    return { before: a, after: b };
  }

  const api = { compute, toggle, canEnable, preview, TARGET_UTIL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SimEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
