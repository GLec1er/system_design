// Проверка главы 2 (друзья рядом): node simulator/lab/test-ch2.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch2/ch2.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// цифры книги: 334 тыс. обновлений, 14 млн рассылок, 200 ГБ каналов, около 140 серверов Pub/Sub
const d = L.derive(est, deep0);
assert(Math.round(d.upd / 1000) === 333 && Math.round(d.push / 1e6) === 13 && d.memGB === 200 && d.psMem === 2 && Math.round(d.psCpu) === 133, 'оценка как в книге ' + JSON.stringify([d.upd, d.push, d.memGB, d.psCpu]));

// стрелки эталона разрешены, клиент в хранилища нет
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'locCache') && !E.canLink(L, 'client', 'pubsub') && !E.canLink(L, 'api', 'pubsub'), 'запрещённые стрелки');

// схема книги выполняет цели; Pub/Sub ограничен CPU
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))) + ' ' + JSON.stringify(r.warnings.filter((w) => w.lvl === 'bad')));
assert(r.nodes.pubsub.rep > 100 && r.nodes.ws.rep >= 100, 'Pub/Sub по CPU, WebSocket по соединениям ' + [r.nodes.pubsub.rep, r.nodes.ws.rep]);
// без стрелки Pub/Sub → WS рассылка не доходит
assert(!E.analyze(L, without(ref('base'), 'pubsub', 'ws'), est, deep0, 'base').m.routed, 'без рассылки');

// углубление: наивные решения ломают цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(F(r, 'fanout').lat > 10000 && r.m.ghost > 0 && r.m.dropped > 0, 'deep: проблемы видны');

// эталон под пик ×3 с решениями книги закрывает все цели
const good = { params: Object.assign({}, deep0.params, { peak: 3 }), choices: { fanout: 'pubsub', psSize: 'cpu', routing: 'ring', deploy: 'drain', ttl: 'ttl', history: 'cassandra', init: 'batch' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + ' ' + JSON.stringify(A.blockers) + ' ' + F(A.r, 'fanout').lat + ' ' + F(A.r, 'init').lat);
console.log('ok', 'adapt:', A.changes.join('; '));

const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
// Pub/Sub по памяти перегружен
assert(alt({ psSize: 'mem' }).nodes.pubsub.util > 10, 'по памяти: перегрузка');
// рассылка всем серверам тяжелее канала на пользователя
assert(alt({ fanout: 'broadcast' }).nodes.pubsub.load > A.r.nodes.pubsub.load * 2, 'broadcast тяжелее');
// хэш по модулю двигает почти все подписки
assert(alt({ routing: 'mod' }).m.resub > A.r.m.resub * 50, 'mod: переподписки');
// без etcd кольцо не работает
assert(!L.goals.deep[3].check(E.analyze(L, without(A.graph, 'ws', 'sd'), est, good, 'deep')), 'без etcd');
// MySQL не держит историю, по одному запросу открытие медленное
assert(alt({ history: 'mysql' }).nodes.histDB.util > 1, 'MySQL истории перегружен');
assert(F(alt({ init: 'each' }), 'init').lat > 200, 'по одному медленно');

// BEAM встаёт вместо Pub/Sub
const bm = E.addBlock(L, ref('base'), 'beam', [0, 0]), rb = E.analyze(L, bm.graph, est, deep0, 'base');
assert(bm.dropped.length >= 2 && F(rb, 'fanout').ok && F(rb, 'fanout').path.some((x) => rb.nodes[x.id].type === 'beam'), 'beam: рассылка через него');
console.log('ch2 ok');
