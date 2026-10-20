// Проверка главы 6 (агрегация кликов по рекламе): node simulator/lab/test-ch6.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch6/ch6.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// цифры книги: 10 тыс. кликов в секунду, пик 50 тыс., 100 ГБ в день, 3 ТБ в месяц
const d = L.derive(est, deep0);
assert(d.clicks === 1e4 && d.peakClicks === 5e4 && d.gbDay === 100 && d.tbMonth === 3, 'оценка ' + JSON.stringify([d.clicks, d.peakClicks, d.gbDay, d.tbMonth]));

// стрелки эталона разрешены, лишние запрещены
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'watcher', 'aggr') && !E.canLink(L, 'querySvc', 'rawDB') && !E.canLink(L, 'advertiser', 'aggDB'), 'запрещённые стрелки');

// схема книги выполняет цели; без второго Kafka цель не выполнена
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))) + ' ' + JSON.stringify(r.warnings.filter((w) => w.lvl === 'bad')));
assert(r.nodes.aggr.rep > 10 && r.nodes.aggr.rep <= 32, 'узлов агрегации по пику ' + r.nodes.aggr.rep);
const direct = { nodes: ref('base').nodes.filter((n) => n.id !== 'aggQ'), edges: ref('base').edges.filter((e) => e.from !== 'aggQ' && e.to !== 'aggQ').concat({ from: 'aggr', to: 'aggWriter' }) };
const rd = E.analyze(L, direct, est, deep0, 'base');
assert(rd.m.routed && !L.goals.base[1].check(rd), 'без второго Kafka');

// углубление: наивные решения ломают цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(r.m.wrong > 0 && r.m.lost > 0 && F(r, 'report').lat > 200 && r.m.recoverMin > 5, 'deep: проблемы видны ' + [r.m.wrong, r.m.lost, F(r, 'report').lat, r.m.recoverMin]);

// эталон под пик ×10 с решениями книги закрывает все цели
const good = { params: Object.assign({}, deep0.params, { peak: 10 }), choices: { time: 'watermark', window: 'sliding', once: 'exactly', hot: 'more', recover: 'snapshot', arch: 'kappa' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + ' ' + JSON.stringify(A.blockers) + ' ' + JSON.stringify(A.r.warnings.filter((w) => w.lvl !== 'info')));
console.log('ok', 'adapt:', A.changes.join('; '));

const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
assert(alt({ time: 'proc' }).m.wrong > 0 && alt({ time: 'event' }).m.wrong > 0, 'без watermark');
assert(alt({ once: 'atLeast' }).m.dup > 0 && alt({ once: 'atMost' }).m.lost > 0, 'не exactly-once');
assert(alt({ hot: 'none' }).m.hotLag > 0 && alt({ hot: 'split' }).m.hotLag === 0, 'горячее объявление');
assert(alt({ recover: 'replay' }).m.recoverMin > 5, 'без снапшотов');
assert(alt({ arch: 'lambda' }).m.noFix === 0 && alt({ arch: 'lambda' }).m.cx > A.r.m.cx, 'lambda сложнее');
assert(F(alt({ window: 'query' }), 'report').lat > 200, 'топ при запросе медленный');
// без сверки остаются совсем поздние, без пересчёта Kappa не чинит прошлое, без второго Kafka exactly-once нет
assert(E.analyze(L, without(A.graph, 'reconcile', 'rawDB'), est, good, 'deep').m.wrong > 0, 'без сверки');
assert(E.analyze(L, without(A.graph, 'recalc', 'rawDB'), est, good, 'deep').m.noFix === 1, 'без пересчёта');
const noQ = { nodes: A.graph.nodes.filter((n) => n.id !== 'aggQ'), edges: A.graph.edges.filter((e) => e.from !== 'aggQ' && e.to !== 'aggQ').concat({ from: 'aggr', to: 'aggWriter' }) };
assert(E.analyze(L, noQ, est, good, 'deep').m.dup > 0, 'exactly-once без второго Kafka');

// OLAP встаёт вместо БД агрегатов, топ при запросе в нём быстрый
const ol = E.addBlock(L, A.graph, 'olap', [0, 0]), ro = E.analyze(L, ol.graph, est, { params: good.params, choices: Object.assign({}, good.choices, { window: 'query' }) }, 'deep');
assert(ol.dropped.length === 2 && ro.m.routed && F(ro, 'report').path.some((x) => ro.nodes[x.id].type === 'olap') && F(ro, 'report').lat <= 200, 'olap ' + F(ro, 'report').lat);
console.log('ch6 ok');
