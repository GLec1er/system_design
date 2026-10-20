// Проверка главы 4 (очередь сообщений): node simulator/lab/test-ch4.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch4/ch4.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });
const withCfg = (g, type, cfg) => ({ nodes: g.nodes.map((n) => (n.type === type ? Object.assign({}, n, { cfg: Object.assign({}, n.cfg, cfg) }) : n)), edges: g.edges });

// оценка-допущение: 500 МБ/с, ×3 копии за 7 дней ≈ 907 ТБ, 46 брокеров по 20 ТБ
const d = L.derive(est, deep0);
assert(d.inMB === 500 && Math.round(d.storeTB) === 907 && d.brokersDisk === 46, 'оценка ' + JSON.stringify([d.inMB, d.storeTB, d.brokersDisk]));

['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'producer', 'consumer') && !E.canLink(L, 'producer', 'state'), 'запрещённые стрелки');

let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))) + ' ' + JSON.stringify(r.warnings.filter((w) => w.lvl === 'bad')));
// мало брокеров: диски не вмещают
assert(!E.analyze(L, withCfg(ref('base'), 'broker', { brokers: 12 }), est, deep0, 'base').m.diskOk, '12 брокеров мало по дискам');
// мало партиций: потребителей не хватает
assert(E.analyze(L, withCfg(ref('base'), 'broker', { partitions: 12 }), est, deep0, 'base').nodes.consumer.util > 1, 'партиции ограничивают потребителей');

r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(r.m.lost > 0 && r.m.stuck > 0 && r.m.moved > 0, 'deep: проблемы видны');

const good = { params: Object.assign({}, deep0.params, { peak: 3 }), choices: { storage: 'wal', batch: 'small', pull: 'pull', commit: 'after', rebalance: 'coord', leader: 'zk', grow: 'append' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + ' ' + JSON.stringify(A.blockers) + ' lat ' + F(A.r, 'consume').lat);
console.log('ok', 'adapt:', A.changes.join('; '));

const alt = (ch, g) => E.analyze(L, g || A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
assert(alt({ storage: 'db' }).m.maxU > 1, 'БД не тянет');
assert(alt({ batch: 'none' }).m.maxU > 1, 'без пачек не тянет');
assert(F(alt({ batch: 'large' }), 'consume').lat > 100, 'крупные пачки медленнее');
assert(alt({ pull: 'push' }).m.lost > 0, 'push теряет в пик');
assert(alt({ commit: 'before' }).m.lost > 0 && alt({ commit: 'exactly' }).m.dup === 0, 'гарантии');
assert(alt({}, withCfg(A.graph, 'broker', { acks: '1' })).m.lost > 0, 'ACK=1 теряет');
assert(alt({}, without(A.graph, 'broker', 'zk')).m.stuck > 0, 'без ZooKeeper нет лидеров');

const rb = E.addBlock(L, ref('base'), 'rabbit', [0, 0]), rr = E.analyze(L, rb.graph, est, deep0, 'base');
assert(rr.m.routed && rb.dropped.length >= 2 && F(rr, 'produce').path.some((x) => rr.nodes[x.id].type === 'rabbit'), 'rabbit вместо брокеров');
console.log('ch4 ok');
