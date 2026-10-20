// Проверка главы 3 (карты): node simulator/lab/test-ch3.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch3/ch3.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// цифры книги: 440 ПБ на зуме 21, около 100 ПБ всего, 3 млн точек и 200 тыс. пачек, 62 500 МБ/с
const d = L.derive(est, deep0);
assert(d.rawPB === 440 && d.tilePB === 98 && d.gps === 3e6 && d.loc === 2e5 && d.mbs === 62500, 'оценка как в книге ' + JSON.stringify([d.rawPB, d.tilePB, d.gps, d.loc, d.mbs]));

['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'tileStore') && !E.canLink(L, 'client', 'kafka') && !E.canLink(L, 'client', 'locDB'), 'запрещённые стрелки');

let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))) + ' ' + JSON.stringify(r.warnings.filter((w) => w.lvl === 'bad')));
assert(!E.analyze(L, without(ref('base'), 'client', 'cdn'), est, deep0, 'base').m.routed, 'без CDN тайлы не доходят');

// наивные решения видны
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(F(r, 'nav').lat > 1000 && r.m.etaErr > 10 && r.m.missedJam > 0, 'deep: проблемы видны');

const good = { params: Object.assign({}, deep0.params, { peak: 5 }), choices: { batch: 'batch', render: 'pre', fmt: 'vector', tileUrl: 'service', graph: 'hier', etaM: 'ml', reroute: 'hier', push: 'ws' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + ' ' + JSON.stringify(A.blockers) + ' nav ' + F(A.r, 'nav').lat + ' tile ' + F(A.r, 'tileGet').lat);
console.log('ok', 'adapt:', A.changes.join('; '));

const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
assert(alt({ batch: 'each' }).m.maxU > 1, 'каждая точка: перегрузка');
assert(alt({ render: 'dynamic' }).m.maxU > 1, 'тайлы на лету: перегрузка');
assert(alt({ fmt: 'raster' }).m.mbHour > 50, 'растр тяжелее');
assert(F(alt({ graph: 'flat' }), 'nav').lat > 1000, 'плоские тайлы медленнее');
assert(alt({ reroute: 'scan' }).nodes.adaptSvc.load > A.r.nodes.adaptSvc.load * 100, 'перебор дорогой');
assert(alt({ push: 'mobile' }).m.missedJam > 0, 'пуш теряет веб');
assert(!L.goals.deep[3].check(E.analyze(L, without(A.graph, 'adaptSvc', 'wsGw'), est, good, 'deep')), 'без WebSocket');
console.log('ch3 ok');
