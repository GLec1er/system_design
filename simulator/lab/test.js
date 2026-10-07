// Проверка лаборатории: node simulator/lab/test.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch7/ch7.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); deep0.choices[p.key] = p.options[0].v; });
const ref = (k) => ({
  nodes: L.reference[k].nodes.map((n) => { const [type, id] = [].concat(n); return { id: id || type, type }; }),
  edges: L.reference[k].edges.map(([from, to]) => ({ from, to })),
});

// эталон базового дизайна: все потоки доходят, нагрузка ~3 TPS влезает
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(r.m.routed, 'base: все потоки доходят');
assert(Math.abs(r.d.tps - 2.7) < 0.1, 'оценка ≈ 3 TPS');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели');

// без стрелки reservation → resDB бронь не доходит
const g = ref('base'); g.edges = g.edges.filter((e) => !(e.from === 'reservation' && e.to === 'resDB'));
r = E.analyze(L, g, est, deep0, 'base');
assert(!r.flows.find((f) => f.id === 'book').ok, 'бронь без стрелки в БД не доходит');

// углубление: без решений есть дубли и перепродажи, распродажа кладёт БД
const hard = { params: { dup: 3, conflict: 2, flash: 60, growth: 10 }, choices: { idem: 'none', lock: 'none', shard: 'none', txn: 'none' } };
r = E.analyze(L, ref('base'), est, hard, 'deep');
assert(r.m.dup > 0 && r.m.oversell > 0 && r.m.incons > 0 && r.m.served < 1, 'deep: проблемы видны');

// эталон углубления с правильными решениями закрывает все цели
const good = { params: hard.params, choices: { idem: 'key', lock: 'opt', shard: 'hotel', txn: 'saga' } };
r = E.analyze(L, ref('deep'), est, good, 'deep');
assert(L.goals.deep.every((x) => x.check(r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((x) => x.check(r))));
// кэш снимает чтения с БД
assert(r.nodes.cache.load > 0 && r.nodes.cacheR.load > 0, 'кэши в работе');
console.log('ok', 'cx', r.m.cx.toFixed(1), 'book', r.flows.find((f) => f.id === 'book').lat.toFixed(0) + 'ms');

// необязательные блоки: addBlock сам проводит стрелки, эффекты видны
const bookLat = (g, deep) => E.analyze(L, g, est, deep, 'deep').flows.find((f) => f.id === 'book').lat;
let g2 = E.addBlock(L, ref('deep'), 'notification', [0, 0]).graph;
assert(g2.edges.some((e) => e.from === 'reservation' && e.to === 'notification'), 'без Kafka письмо подключается к сервису');
assert(bookLat(g2, good) > bookLat(ref('deep'), good) + 100, 'синхронное письмо тормозит бронь');
let g3 = E.addBlock(L, ref('deep'), 'kafka', [0, 0]).graph;
g3 = E.addBlock(L, g3, 'notification', [0, 0]).graph;
assert(g3.edges.some((e) => e.from === 'kafka' && e.to === 'notification') && !g3.edges.some((e) => e.from === 'reservation' && e.to === 'notification'), 'с Kafka письмо идёт через очередь');
r = E.analyze(L, g3, est, good, 'deep');
assert(r.flows.find((f) => f.id === 'events').ok && Math.abs(r.flows.find((f) => f.id === 'book').lat - bookLat(ref('deep'), good)) < 1, 'асинхронное письмо не тормозит бронь');
// Cassandra вместо SQL: оптимистичная блокировка больше не спасает
const g4 = E.addBlock(L, ref('deep'), 'nosql', [0, 0]).graph;
g4.edges = g4.edges.filter((e) => !(e.from === 'reservation' && e.to === 'resDB'));
r = E.analyze(L, g4, est, good, 'deep');
assert(r.m.routed && r.m.oversell > 0, 'NoSQL: перепродажи возвращаются');
// CDN забирает часть просмотров до Gateway
const g5 = E.addBlock(L, ref('base'), 'cdn', [0, 0]).graph;
assert(E.analyze(L, g5, est, deep0, 'base').nodes.gateway.load < E.analyze(L, ref('base'), est, deep0, 'base').nodes.gateway.load * 0.6, 'CDN разгружает Gateway');
console.log('extras ok');
