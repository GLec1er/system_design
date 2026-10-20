// Проверка главы 1 (поиск мест рядом): node simulator/lab/test-ch1.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch1/ch1.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const withCfg = (g, type, cfg) => ({ nodes: g.nodes.map((n) => (n.type === type ? Object.assign({}, n, { cfg: Object.assign({}, n.cfg, cfg) }) : n)), edges: g.edges });

// цифры книги: 5 тыс. поисков в секунду, кэш около 5 ГБ, quadtree около 1,7 ГБ
const d = L.derive(est, deep0);
assert(d.search === 5000 && Math.abs(d.cacheGB - 4.8) < 0.01 && Math.abs(d.qtGB - 1.71) < 0.01, 'оценка как в книге ' + JSON.stringify([d.search, d.cacheGB, d.qtGB]));
assert(d.L === 5, 'радиус 1 км: geohash длины 5');

// стрелки эталона разрешены, клиент в БД нет
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'geoDB') && !E.canLink(L, 'client', 'bizDB') && !E.canLink(L, 'geoDB', 'lbs'), 'запрещённые стрелки');

// схема книги выполняет цели дизайна
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
// L4 вместо L7 не проходит
assert(!L.goals.base[1].check(E.analyze(L, withCfg(ref('base'), 'lb', { layer: 'l4' }), est, deep0, 'base')), 'L4 не разводит по пути');

// углубление: наивные решения теряют места, правки и регион
const hard = { params: Object.assign({}, deep0.params, { peak: 5, radius: 5, conc: 1 }), choices: deep0.choices };
r = E.analyze(L, ref('deep'), est, hard, 'deep');
assert(F(r, 'search').ok, 'deep: поиск доходит');
const bad = { params: hard.params, choices: Object.assign({}, deep0.choices, { algo: 'geohash', border: 'own', idx: 'json', regions: 'one' }) };
r = E.analyze(L, ref('deep'), est, bad, 'deep');
assert(r.m.missed > 0 && r.m.lostUpd > 0 && r.m.abroad > 0, 'deep: проблемы видны');

// эталон, адаптированный под пик ×5 и радиус 5 км, с решениями книги закрывает все цели
const good = { params: hard.params, choices: { algo: 'geohash', border: 'expand', prec: 'radius', idx: 'row', cacheKey: 'geohash', fresh: 'nightly', deploy: 'rolling', regions: 'multi' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + ' ' + JSON.stringify(A.blockers));
console.log('ok', 'adapt:', A.changes.join('; '));

// quadtree тоже проходит, если выкатывать постепенно; разом роняет поиск
const qt = { params: hard.params, choices: Object.assign({}, good.choices, { algo: 'quadtree' }) };
const Aq = E.adapt(L, 'deep', est, qt);
assert(Aq.ok && L.goals.deep.every((g) => g.check(Aq.r)), 'quadtree: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(Aq.r))));
assert(Aq.r.nodes.geoDB.load < A.r.nodes.geoDB.load, 'quadtree: поиск не ходит в индекс');
assert(E.analyze(L, Aq.graph, est, { params: qt.params, choices: Object.assign({}, qt.choices, { deploy: 'all' }) }, 'deep').m.outage > 0, 'выкатка разом');

// длина 6 на радиусе 20 км: тысячи ключей и медленный поиск
const g20 = { params: Object.assign({}, good.params, { radius: 20, peak: 1 }), choices: good.choices };
const fixed6 = E.analyze(L, A.graph, est, { params: g20.params, choices: Object.assign({}, good.choices, { prec: 'fixed6' }) }, 'deep');
const byR = E.analyze(L, A.graph, est, g20, 'deep');
assert(F(fixed6, 'search').lat > F(byR, 'search').lat, 'длина 6 на 20 км медленнее');

// ключ кэша по координатам почти не попадает: индекс получает больше
const ll = E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, { cacheKey: 'latlng' }) }, 'deep');
assert(ll.nodes.geoDB.load > A.r.nodes.geoDB.load * 3, 'latlng: кэш бесполезен');

// Redis GEO встаёт вместо гео-индекса
const rg = E.addBlock(L, ref('base'), 'redisGeo', [0, 0]), rr = E.analyze(L, rg.graph, est, deep0, 'base');
assert(rg.dropped.length >= 1 && F(rr, 'search').path.some((x) => rr.nodes[x.id].type === 'redisGeo'), 'redisGeo: поиск идёт в него');
console.log('ch1 ok');
