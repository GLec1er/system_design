// Проверка главы 21 (совместный редактор): node simulator/lab/test-ch21.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch21/ch21.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// оценка: 417 тыс. редакторов в среднем, 1,25 млн в пик, 13 шлюзов, 1,25 млн операций, 179 серверов, 3,6 ТБ журнала в день
const d = L.derive(est, deep0);
assert(Math.round(d.avgEd) === 416667 && d.peakEd === 1250000 && d.gws === 13 && d.ops === 1250000 && d.servers === 179 && Math.round(d.logTB * 10) === 36, 'оценка ' + JSON.stringify(d));

// стрелки эталона разрешены; мимо шлюза и сервера правки нельзя
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'collab') && !E.canLink(L, 'gw', 'opLog') && !E.canLink(L, 'client', 'opLog'), 'запрещённые стрелки');

// типовая схема выполняет цели; серверов правки столько, сколько дала оценка, шлюзов не меньше, чем по соединениям
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(r.nodes.collab.rep === d.servers && r.nodes.gw.rep >= d.gws && F(r, 'edit').lat < 100, 'серверы по оценке');

// углубление: наивные решения ломают цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(r.m.blocked > 0 && r.m.lostEdits > 0 && F(r, 'edit').lat > 1000, 'deep: проблемы видны');

// типовые решения при пике ×5 закрывают все цели
const good = { params: { peak: 5, growth: 1 }, choices: { sync: 'ot', home: 'sticky', transport: 'ws', batch: 'batch', store: 'log', durable: 'logfirst', offline: 'queue', presence: 'ephemeral' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + JSON.stringify(A.blockers));
const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
const T = (x) => F(x, 'edit').lat, CS = (x) => x.nodes.collab.rep;

// CRDT тоже закрывает цели, но серверов правки нужно больше
const C = E.adapt(L, 'deep', est, { params: good.params, choices: Object.assign({}, good.choices, { sync: 'crdt' }) });
assert(C.ok && L.goals.deep.every((g) => g.check(C.r)) && CS(C.r) > CS(A.r), 'CRDT');
assert(alt({ sync: 'lock' }).m.blocked > 0 && alt({ sync: 'lww' }).m.lostEdits > 0, 'блокировка и последний сохранивший');
// дом документа и транспорт
assert(alt({ home: 'any' }).m.diverged > 0 && T(alt({ home: 'any' })) > 100, 'любой сервер');
assert(T(alt({ transport: 'poll' })) > 1000 && alt({ transport: 'poll' }).nodes.gw.rep > A.r.nodes.gw.rep, 'опрос');
assert(CS(alt({ batch: 'key' })) > CS(A.r) * 4, 'каждое нажатие');
// хранение, подтверждение, офлайн, курсоры
assert(alt({ store: 'full' }).nodes.snap.rep > A.r.nodes.snap.rep * 20, 'документ целиком');
assert(alt({ durable: 'memory' }).m.lostEdits > 0 && alt({ offline: 'block' }).m.lostEdits > 0, 'потери правок');
assert(alt({ presence: 'store' }).nodes.opLog.rep > A.r.nodes.opLog.rep * 2, 'курсоры в журнале');
// без маршрутизатора один сервер на документ не работает
assert(E.analyze(L, without(A.graph, 'gw', 'router'), est, good, 'deep').m.diverged > 0, 'без маршрутизатора');

// эксперимент: кэш снимков снимает открытия
const rc = E.analyze(L, E.addBlock(L, A.graph, 'cache', [0, 0]).graph, est, good, 'deep');
assert(rc.m.routed && rc.nodes.snap.flows.open < A.r.nodes.snap.flows.open, 'кэш открытых документов');
console.log('ch21 ok');
