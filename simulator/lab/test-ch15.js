// Проверка главы 15 (потоковый конвейер): node simulator/lab/test-ch15.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch15/ch15.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// оценка: 58 тыс. событий в секунду, пик ×3 около 174 тыс., 2,5 ТБ в день
const d = L.derive(est, deep0);
assert(Math.round(d.ev) === 57870 && Math.round(d.peakEv) === 173611 && d.gbDay === 2500 && d.kafkaTB === 52.5, 'оценка ' + JSON.stringify([d.ev, d.peakEv, d.gbDay, d.kafkaTB]));

// стрелки эталона разрешены; мимо шины и Query service нельзя
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'collector', 'olap') && !E.canLink(L, 'sdk', 'kafka') && !E.canLink(L, 'viewer', 'olap') && !E.canLink(L, 'querySvc', 'lake'), 'запрещённые стрелки');

// типовая схема выполняет цели; обработка и загрузка читают Kafka независимо и не нагружают её дважды
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(Math.abs(r.nodes.kafka.load - d.peakEv) < 1 && r.nodes.stream.rep <= r.nodes.kafka.cfg.partitions, 'шина считается один раз, задач не больше партиций');

// углубление: наивные решения ломают цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(r.m.lostEv > 0 && r.m.wrongWin > 0 && r.m.stuckMin > 0 && F(r, 'process').lat > 5000, 'deep: проблемы видны');

// типовые решения при пике ×5 закрывают все цели
const good = { params: { peak: 5, growth: 1 }, choices: { produce: 'safe', schema: 'registry', poison: 'dlq', time: 'watermark', once: 'exactly', trigger: 'micro', insert: 'batch', arch: 'kappa' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + JSON.stringify(A.blockers));
const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
assert(alt({ produce: 'fire' }).m.lostEv > 0 && alt({ once: 'atMost' }).m.lostEv > 0 && alt({ once: 'atLeast' }).m.dupEv > 0, 'потери и дубли');
assert(alt({ poison: 'crash' }).m.stuckMin > 0 && alt({ poison: 'skip' }).m.lostEv > 0, 'битые события');
assert(alt({ schema: 'json', poison: 'skip' }).m.lostEv > alt({ poison: 'skip' }).m.lostEv * 5, 'без схемы битых событий на порядок больше');
assert(alt({ time: 'proc' }).m.wrongWin > 0 && F(alt({ trigger: 'minute' }), 'process').lat > 5000, 'время и триггер');
assert(F(alt({ trigger: 'event' }), 'process').lat < F(A.r, 'process').lat, 'Flink быстрее микробатчей');
assert(alt({ insert: 'row' }).nodes.olap.rep > A.r.nodes.olap.rep * 5, 'вставка по строке требует в разы больше узлов OLAP');
assert(alt({ arch: 'lambda' }).m.cx > A.r.m.cx && alt({ arch: 'lambda' }).m.noFix === 0, 'lambda сложнее');
// без нужных блоков решения не работают
assert(E.analyze(L, without(A.graph, 'stream', 'dlq'), est, good, 'deep').m.lostEv > 0, 'DLQ без блока');
assert(E.analyze(L, without(A.graph, 'lake', 'batch'), est, good, 'deep').m.noFix === 1, 'Kappa без пересчёта');
assert(E.analyze(L, without(A.graph, 'collector', 'registry'), est, Object.assign({}, good, { choices: Object.assign({}, good.choices, { poison: 'skip' }) }), 'deep').m.lostEv > alt({ poison: 'skip' }).m.lostEv, 'схема без реестра');

// Druid встаёт вместо ClickHouse, кэш снимает запросы дашбордов
const dr = E.addBlock(L, A.graph, 'druid', [0, 0]), rd = E.analyze(L, dr.graph, est, good, 'deep');
assert(dr.dropped.length === 3 && rd.m.routed && F(rd, 'query').path.some((x) => rd.nodes[x.id].type === 'druid'), 'druid');
const ca = E.addBlock(L, A.graph, 'cache', [0, 0]), rc = E.analyze(L, ca.graph, est, good, 'deep');
assert(rc.nodes.olap.flows.query < A.r.nodes.olap.flows.query * 0.5, 'кэш дашбордов');
console.log('ch15 ok');
