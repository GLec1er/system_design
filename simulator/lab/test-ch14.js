// Проверка главы 14 (пакетное озеро данных): node simulator/lab/test-ch14.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch14/ch14.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);

// оценка: 500 ГБ сырого в день, 37,5 тыс. строк в секунду в окне 4 ч, 5 узлов под таблицы
const d = L.derive(est, deep0);
assert(d.rawGB === 500 && Math.round(d.xform) === 37500 && d.dwhNodes === 5 && Math.round(d.full / d.incr) === 50, 'оценка ' + JSON.stringify([d.rawGB, d.xform, d.dwhNodes]));

// стрелки эталона разрешены; мимо Kafka, загрузчика и SQL-движка нельзя
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'apps', 'raw') && !E.canLink(L, 'oltp', 'raw') && !E.canLink(L, 'analyst', 'dwh') && !E.canLink(L, 'trino', 'raw'), 'запрещённые стрелки');

// типовая схема выполняет цели; узлы хранения считаются по объёму, а не по нагрузке
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(r.nodes.dwh.rep === 5 && r.nodes.dwh.util < 0.5 && r.nodes.raw.rep === 3, 'узлы по объёму ' + [r.nodes.dwh.rep, r.nodes.raw.rep]);
// окно вдвое короче: узлов Spark вдвое больше
const short = E.analyze(L, ref('base'), est, { params: { growth: 1, window: 2 }, choices: deep0.choices }, 'base');
assert(short.nodes.spark.rep >= r.nodes.spark.rep * 2 - 1, 'короткое окно ' + [r.nodes.spark.rep, short.nodes.spark.rep]);

// углубление: наивные решения ломают все цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(r.m.dupRows > 0 && r.m.badRows > 0 && r.m.stale > 0 && r.m.filesM > 30 && F(r, 'query').lat > 10000, 'deep: проблемы видны');
assert(r.nodes.dwh.rep > 15 && r.nodes.ingest.rep > 20, 'текстовый формат и полный снимок стоят узлов ' + [r.nodes.dwh.rep, r.nodes.ingest.rep]);

// типовые решения при росте ×5 закрывают все цели
const good = { params: { growth: 5, window: 4 }, choices: { format: 'columnar', part: 'date', load: 'incr', rerun: 'overwrite', orch: 'airflow', dq: 'wap', files: 'compact' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + JSON.stringify(A.blockers));
const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
assert(alt({ rerun: 'append' }).m.dupRows > 0 && alt({ dq: 'none' }).m.badRows > 0 && alt({ orch: 'cron' }).m.stale > 0, 'повтор, качество, cron');
assert(F(alt({ format: 'text' }), 'query').lat > 10000 && F(alt({ part: 'none' }), 'query').lat > 10000, 'формат и партиции замедляют запрос');
assert(alt({ part: 'fine' }).m.filesM > 30 && alt({ files: 'asis' }).m.filesM > 30, 'мелкие файлы');
assert(alt({ load: 'full' }).nodes.ingest.load > A.r.nodes.ingest.load * 10 && alt({ load: 'cdc' }).m.cx > A.r.m.cx, 'полный снимок и CDC');

// S3 встаёт вместо таблиц на HDFS, Hive вместо Trino отвечает минутами
const s3 = E.addBlock(L, A.graph, 's3', [0, 0]), rs = E.analyze(L, s3.graph, est, good, 'deep');
assert(s3.dropped.length === 2 && rs.m.routed && F(rs, 'query').path.some((x) => rs.nodes[x.id].type === 's3') && rs.m.cost < A.r.m.cost, 's3 дешевле ' + [rs.m.cost, A.r.m.cost]);
const hv = E.addBlock(L, A.graph, 'hiveQl', [0, 0]), rh = E.analyze(L, hv.graph, est, good, 'deep');
assert(rh.m.routed && F(rh, 'query').lat > 10000, 'hive медленный ' + F(rh, 'query').lat);
console.log('ch14 ok');
