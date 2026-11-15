// Проверка главы 18 (рекомендательная лента): node simulator/lab/test-ch18.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch18/ch18.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// оценка: 11,6 тыс. лент в секунду, пик ×3 около 34,7 тыс., 17,4 млн оценок модели, 1241 сервер, 347 тыс. событий, 2 ТБ в день
const d = L.derive(est, deep0);
assert(Math.round(d.req) === 11574 && Math.round(d.peakReq) === 34722 && Math.round(d.scores) === 17361111 && d.rankers === 1241 && Math.round(d.peakEv) === 347222 && d.evTB === 2 && d.indexGB === 51.2, 'оценка ' + JSON.stringify(d));

// стрелки эталона разрешены; мимо ступеней и шины нельзя
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'ranker') && !E.canLink(L, 'feedSvc', 'ann') && !E.canLink(L, 'feedSvc', 'features') && !E.canLink(L, 'collector', 'features') && !E.canLink(L, 'client', 'kafka'), 'запрещённые стрелки');

// типовая схема выполняет цели; серверов ранжирования столько, сколько дала оценка
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(r.nodes.ranker.rep === d.rankers && F(r, 'feed').lat < 200 && Math.abs(r.nodes.kafka.load - d.peakEv) < 1, 'ранжирование по оценке, шина считается один раз');
assert(!E.analyze(L, without(ref('base'), 'candSvc', 'ann'), est, deep0, 'base').m.routed, 'без индекса отбор не работает');

// углубление: наивные решения ломают все цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(L.goals.deep.every((g) => !g.check(r)) && r.m.lossQ === 75 && r.m.repeats > 0 && r.m.coldItems > 0 && r.m.empty > 0 && F(r, 'feed').lat > 2000, 'deep: проблемы видны');

// типовые решения при пике ×5 закрывают все цели; задач потоковых признаков не больше партиций
const good = { params: { peak: 5, growth: 1 }, choices: { funnel: 'cascade', sources: 'multi', ann: 'ann', fresh: 'stream', skew: 'store', seen: 'bloom', cold: 'explore', goal: 'multi', fallback: 'fallback', retrain: 'daily' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + JSON.stringify(A.blockers));
assert(A.r.nodes.stream.rep <= A.r.nodes.kafka.cfg.partitions, 'задач не больше партиций');
const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
const T = (x) => F(x, 'feed').lat;

// воронка: без лёгкой ступени серверов ранжирования вчетверо больше и лента медленнее
assert(alt({ funnel: 'one' }).nodes.ranker.rep > A.r.nodes.ranker.rep * 3.9 && T(alt({ funnel: 'one' })) > T(A.r) + 100, 'каскад');
// отбор и поиск
assert(alt({ sources: 'pop' }).m.lossQ > alt({ sources: 'cf' }).m.lossQ && alt({ sources: 'cf' }).m.lossQ > 0, 'источники кандидатов');
assert(T(alt({ ann: 'exact' })) > 2000 && alt({ ann: 'exact' }).nodes.ann.rep > A.r.nodes.ann.rep * 10, 'точный перебор');
// признаки, цель, переобучение
assert(alt({ fresh: 'batch' }).m.lossQ === 15 && alt({ skew: 'separate' }).m.lossQ === 10 && alt({ goal: 'click' }).m.lossQ === 12 && alt({ retrain: 'rare' }).m.lossQ === 8, 'потеря вовлечённости');
// повторы, холодный старт, деградация
assert(alt({ seen: 'none' }).m.repeats > 0 && T(alt({ seen: 'db' })) > T(A.r) + 40 && alt({ seen: 'db' }).m.repeats === 0, 'показанное');
assert(alt({ cold: 'none' }).m.coldItems > 0 && alt({ fallback: 'fail' }).m.empty > 0, 'холодный старт и деградация');
// без нужных блоков решения не работают
assert(E.analyze(L, without(A.graph, 'kafka', 'stream'), est, good, 'deep').m.lossQ === 15, 'свежие признаки без потока');
assert(E.analyze(L, without(A.graph, 'lake', 'trainer'), est, good, 'deep').m.lossQ === 8, 'переобучение без блока');

// эксперимент: кэш готовых лент снимает треть ранжирования
const rc = E.analyze(L, E.addBlock(L, A.graph, 'feedCache', [0, 0]).graph, est, good, 'deep');
assert(rc.m.routed && rc.nodes.ranker.rep < A.r.nodes.ranker.rep * 0.75, 'кэш лент');
console.log('ch18 ok');
