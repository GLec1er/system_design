// Проверка главы 23 (подбор машины в такси): node simulator/lab/test-ch23.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch23/ch23.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// оценка: 250 тыс. координат в секунду, 694 заказа в пик, 6944 цены и расчёта подачи, 5 шлюзов
const d = L.derive(est, deep0);
assert(d.locs === 250000 && Math.round(d.orders) === 694 && Math.round(d.quotes) === 6944 && Math.round(d.etas) === 6944 && d.gws === 5 && Math.round(d.trips) === 4167, 'оценка ' + JSON.stringify(d));

// стрелки эталона разрешены; пассажир и водитель только через свои шлюзы
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'rider', 'dispatch') && !E.canLink(L, 'driver', 'locSvc') && !E.canLink(L, 'api', 'geoIdx') && !E.canLink(L, 'geoIdx', 'dispatch'), 'запрещённые стрелки');

// типовая схема: координат в сотни раз больше заказов, а гео-индекс в памяти держит их на нескольких узлах
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(r.nodes.geoIdx.flows.loc > r.nodes.geoIdx.flows.order * 300 && r.nodes.geoIdx.rep <= 5 && r.nodes.drvGw.rep === d.gws, 'поток координат');

// углубление: наивные решения ломают цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(L.goals.deep.slice(1).every((g) => !g.check(r)) && r.m.doubleBook > 0 && r.m.lostTrips > 0 && r.m.unmatched > 0 && r.m.waitMin > 0, 'deep: проблемы видны');

// типовые решения при пике ×5 закрывают все цели, и с подбором по ETA, и с пакетным
const good = { params: { peak: 5, growth: 1 }, choices: { ping: 'normal', geo: 'cells', match: 'eta', lock: 'cas', offer: 'timeout', surge: 'dynamic', state: 'db' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + JSON.stringify(A.blockers));
const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
const T = (x) => F(x, 'order').lat, GEO = (x) => x.nodes.geoIdx.rep;
assert(L.goals.deep.every((g) => g.check(alt({ match: 'batch' }))) && T(alt({ match: 'batch' })) > T(A.r) + 1500, 'пакетный подбор');

// координаты и индекс
assert(GEO(alt({ ping: 'fast' })) > GEO(A.r) * 3 && alt({ ping: 'slow' }).m.waitMin > 0, 'частота координат');
assert(GEO(alt({ geo: 'sql' })) > GEO(A.r) * 20 && GEO(alt({ geo: 'quadtree' })) > GEO(A.r) * 2, 'гео-индекс');
// подбор, блокировка, предложение, цена, поездка
assert(alt({ match: 'line' }).m.waitMin === 3 && alt({ lock: 'none' }).m.doubleBook > 0 && alt({ offer: 'wait' }).m.unmatched > 0, 'подбор');
assert(alt({ surge: 'fixed' }).m.unmatched > 0 && alt({ state: 'memory' }).m.lostTrips > 0, 'цена и поездка');
// без потока спроса динамической цены нет
assert(E.analyze(L, without(A.graph, 'surge', 'pricing'), est, good, 'deep').m.unmatched > 0, 'без коэффициентов');
assert(E.analyze(L, without(A.graph, 'locSvc', 'kafka'), est, good, 'deep').m.unmatched > 0, 'без потока координат');

// эксперимент: кэш цен снимает запросы цены
const rc = E.analyze(L, E.addBlock(L, A.graph, 'cache', [0, 0]).graph, est, good, 'deep');
assert(rc.m.routed && rc.nodes.pricing.rep < A.r.nodes.pricing.rep, 'кэш цен');
console.log('ch23 ok');
