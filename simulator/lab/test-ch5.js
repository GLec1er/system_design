// Проверка главы 5 (мониторинг метрик): node simulator/lab/test-ch5.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch5/ch5.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// цифры книги: 10 млн рядов, миллион точек в секунду, неделя сырых почти 10 ТБ
const d = L.derive(est, deep0);
assert(d.series === 1e7 && d.pts === 1e6 && Math.round(d.raw7) === 10 && Math.round(d.rawYear) === 505, 'оценка ' + JSON.stringify([d.series, d.pts, d.raw7, d.rawYear]));

// стрелки эталона разрешены, серверы не пишут в TSDB
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'targets', 'tsdb') && !E.canLink(L, 'engineer', 'tsdb') && !E.canLink(L, 'tsdb', 'query'), 'запрещённые стрелки');

// схема книги выполняет цели
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))) + ' ' + JSON.stringify(r.warnings.filter((w) => w.lvl === 'bad')));
assert(!E.analyze(L, without(ref('base'), 'query', 'tsdb'), est, deep0, 'base').m.routed, 'без чтения TSDB');

// углубление: наивные решения ломают цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(r.m.storm > 0 && F(r, 'dash').lat > 300 && r.m.storeTB > 20, 'deep: проблемы видны ' + [r.m.storm, F(r, 'dash').lat, r.m.storeTB]);

// эталон в инцидент ×10 с решениями книги закрывает все цели
const good = { params: Object.assign({}, deep0.params, { incident: 10 }), choices: { collect: 'pull', agg: 'pipeline', encode: 'gorilla', retain: 'downsample', dedupe: 'dedupe' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + ' ' + JSON.stringify(A.blockers) + ' ' + F(A.r, 'dash').lat + ' ' + A.r.m.storeTB);
console.log('ok', 'adapt:', A.changes.join('; '));

const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
assert(alt({ encode: 'raw' }).m.storeTB > A.r.m.storeTB * 5, 'без сжатия больше');
assert(alt({ retain: 'none' }).m.storeTB > 20, 'сырые весь год');
assert(alt({ retain: 'cold' }).m.storeTB < A.r.m.storeTB, 'холодное меньше');
assert(F(alt({ agg: 'query' }), 'dash').lat > F(A.r, 'dash').lat, 'агрегаты при запросе медленнее');
assert(alt({ dedupe: 'none' }).m.storm > 0, 'шторм уведомлений');
assert(alt({ collect: 'push' }).m.missed === 0, 'push без discovery допустим');
// без Kafka точки теряются, без очереди алертов теряются уведомления, без discovery серверы забыты
assert(E.analyze(L, { nodes: A.graph.nodes, edges: A.graph.edges.filter((e) => !(e.from === 'collector' || e.to === 'collector') || e.from === 'targets').concat([{ from: 'collector', to: 'tsdb' }, { from: 'collector', to: 'sd' }]) }, est, good, 'deep').m.lostPts > 0, 'без Kafka');
assert(E.analyze(L, { nodes: A.graph.nodes, edges: A.graph.edges.filter((e) => e.to !== 'alertQ' && e.from !== 'alertQ').concat([{ from: 'alertMgr', to: 'notifier' }]) }, est, good, 'deep').m.lostAlerts > 0, 'без очереди алертов');
assert(E.analyze(L, without(A.graph, 'collector', 'sd'), est, good, 'deep').m.missed > 0, 'без discovery');
console.log('ch5 ok');
