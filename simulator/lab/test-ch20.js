// Проверка главы 20 (хранилище ключ-значение): node simulator/lab/test-ch20.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch20/ch20.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// оценка: 10 ТБ, 30 ТБ с копиями, 22 узла по объёму, 900 тыс. операций в пик, 1,98 млн на узлах, 142 узла
const d = L.derive(est, deep0);
assert(d.dataTB === 10 && d.rawTB === 30 && d.nodesVol === 22 && d.peakOps === 900000 && d.nodeOps === 1980000 && d.nodesOps === 142, 'оценка ' + JSON.stringify(d));

// стрелки эталона разрешены; клиент только через координатор
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'nodes') && !E.canLink(L, 'nodes', 'coord') && !E.canLink(L, 'coord', 'repair'), 'запрещённые стрелки');

// типовая схема: узлов столько, сколько нужно по операциям с копиями, задержка в миллисекунды
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(r.nodes.nodes.rep === d.nodesOps && F(r, 'read').lat <= 10 && r.m.moved < 1, 'узлы по операциям, перенос меньше 1%');
// при малой нагрузке узлов не меньше, чем по объёму
const low = Object.assign({}, est, { ops: 10 });
assert(E.analyze(L, ref('base'), low, deep0, 'base').nodes.nodes.rep === d.nodesVol, 'узлы по объёму');

// углубление: наивные решения дают потери, отказы, расхождения и полный переезд
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(L.goals.deep.slice(1, 4).every((g) => !g.check(r)) && r.m.moved > 90 && r.m.stale > 0, 'deep: проблемы видны');

// типовые решения при пике ×5 закрывают все цели
const good = { params: { peak: 5, growth: 1 }, choices: { part: 'vnodes', quorum: 'quorum', conflict: 'vclock', hinted: 'sloppy', repair: 'merkle', members: 'gossip', engine: 'lsm' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + JSON.stringify(A.blockers));
const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
const N = (x) => x.nodes.nodes.rep;

// раскладка: модуль переносит почти всё, кольцо без виртуальных узлов требует больше узлов
assert(alt({ part: 'mod' }).m.moved > 90 && N(alt({ part: 'ring' })) > N(A.r) * 1.4, 'раскладка');
// кворум: R=1 даёт устаревшие чтения и меньше операций, R=W=3 отказы и задержку
assert(alt({ quorum: 'one' }).m.stale > 0 && N(alt({ quorum: 'one' })) < N(A.r), 'R=1, W=1');
assert(alt({ quorum: 'all' }).m.failW > 0 && F(alt({ quorum: 'all' }), 'write').lat > F(A.r, 'write').lat + 2, 'R=3, W=3');
// версии, отказы, сверка, членство, диск
assert(alt({ conflict: 'lww' }).m.lostUpd > 0 && alt({ hinted: 'strict' }).m.failW > 0 && alt({ members: 'static' }).m.failW > 0, 'потери и отказы');
assert(alt({ repair: 'none' }).m.diverged > 0 && alt({ repair: 'scan' }).m.diverged === 0 && alt({ repair: 'scan' }).m.maxU > A.r.m.maxU, 'сверка');
assert(N(alt({ engine: 'btree' })) > N(A.r) * 1.4, 'B-дерево держит меньше');
// без нужных блоков решения не работают
assert(E.analyze(L, without(A.graph, 'coord', 'hints'), est, good, 'deep').m.failW > 0, 'подсказки без блока');
assert(E.analyze(L, without(A.graph, 'repair', 'nodes'), est, good, 'deep').m.diverged > 0, 'сверка без блока');

// эксперимент: кэш снимает часть чтений с узлов
const rc = E.analyze(L, E.addBlock(L, A.graph, 'cache', [0, 0]).graph, est, good, 'deep');
assert(rc.m.routed && N(rc) < N(A.r), 'кэш горячих ключей');
console.log('ch20 ok');
