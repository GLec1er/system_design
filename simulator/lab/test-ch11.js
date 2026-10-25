// Проверка главы 11 (платёжная система): node simulator/lab/test-ch11.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch11/ch11.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);

// цифры книги: 1 млн платежей в день это 10 TPS
const d = L.derive(est, { params: { peak: 1 } });
assert(d.tps === 10 && d.peakOrders === 10 && d.ledgerW === 20, 'оценка ' + JSON.stringify([d.tps, d.peakOrders, d.ledgerW]));

// стрелки эталона разрешены, клиент в БД и в PSP напрямую нет
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'payDB') && !E.canLink(L, 'client', 'psp') && !E.canLink(L, 'psp', 'payDB'), 'запрещённые стрелки');

// схема книги: одна БД с репликой, цели дизайна выполнены
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))) + JSON.stringify(r.warnings));
assert(r.nodes.payDB.util < 0.1, 'одной БД хватает с запасом');

// углубление: наивные решения видны в метриках
const hard = { params: Object.assign({}, deep0.params, { growth: 10, outage: 60 }), choices: deep0.choices };
r = E.analyze(L, ref('deep'), est, hard, 'deep');
assert(r.m.pci > 0 && r.m.dup > 0 && r.m.stuck > 0 && r.m.lostOut > 0 && r.m.miss > 0 && r.m.coupled === 1 && F(r, 'pay').lat > 1000, 'deep: проблемы видны');

// эталон с решениями книги закрывает все цели
const good = { params: hard.params, choices: { card: 'hosted', pending: 'webhook', retry: 'backoff', idem: 'key', comm: 'kafka', ledger: 'double', recon: 'nightly' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + ' ' + JSON.stringify(A.blockers) + ' ' + JSON.stringify(A.r.warnings.filter((w) => w.lvl !== 'info')));
console.log('ok', 'adapt:', A.changes.join('; ') || 'оригинал', 'pay', Math.round(F(A.r, 'pay').lat) + 'ms');

const alt = (ch, g = A.graph) => E.analyze(L, g, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
// повтор без ключа списывает дважды, сразу повторять при сбое PSP теряет платежи
assert(alt({ idem: 'none' }).m.dup > alt({ idem: 'none', retry: 'none' }).m.dup, 'повтор без ключа: больше дублей');
assert(alt({ retry: 'immediate' }).m.lostOut > 0 && alt({ retry: 'none' }).m.stuck > 0, 'наивные повторы');
// очередь повторов выбрана, но её нет на карте
const noQ = { nodes: A.graph.nodes.filter((n) => n.type !== 'retryQ'), edges: A.graph.edges.filter((e) => e.to !== 'retryQ') };
assert(alt({}, noQ).m.lostOut > 0, 'без очереди повторов backoff не работает');
// сверка выбрана, но её нет на карте; Kafka выбрана, но её нет
const noRec = { nodes: A.graph.nodes.filter((n) => n.type !== 'recon'), edges: A.graph.edges.filter((e) => e.to !== 'recon' && e.from !== 'recon') };
assert(alt({}, noRec).m.miss > 0, 'без сверки расхождения не находятся');
assert(alt({}, E.analyze(L, ref('base'), est, good, 'deep').graph).m.coupled === 1, 'Kafka выбрана, но её нет');
assert(alt({ comm: 'outbox' }).m.coupled === 0 && alt({ comm: 'sync' }).m.coupled === 1, 'outbox и синхронно');
assert(alt({ pending: 'wait' }).flows.find((f) => f.id === 'pay').lat > 1000, 'ждать PSP долго');

// Temporal встаёт вместо executor и сам повторяет; второй PSP спасает от сбоя даже без повторов
const tm = E.addBlock(L, noQ, 'temporal', [0, 0]), rt = alt({}, tm.graph);
assert(tm.dropped.length === 1 && rt.m.routed && F(rt, 'pay').path.some((x) => rt.nodes[x.id].type === 'temporal') && rt.m.lostOut === 0, 'Temporal ' + JSON.stringify(rt.warnings));
const p2 = E.addBlock(L, A.graph, 'psp2', [0, 0]), r2 = alt({ retry: 'immediate' }, p2.graph);
assert(r2.m.lostOut === 0 && F(r2, 'probe').ok, 'второй PSP');
// CockroachDB вместо Payment DB
const cr = E.addBlock(L, A.graph, 'crdb', [0, 0]), rc = alt({}, cr.graph);
assert(cr.dropped.length === 1 && rc.m.routed && F(rc, 'status').path.some((x) => rc.nodes[x.id].type === 'crdb'), 'CockroachDB');
console.log('ch11 ok');
