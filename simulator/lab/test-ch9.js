// Проверка главы 9 (объектное хранилище): node simulator/lab/test-ch9.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch9/ch9.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });
const withCfg = (g, type, cfg) => ({ nodes: g.nodes.map((n) => (n.type === type ? Object.assign({}, n, { cfg: Object.assign({}, n.cfg, cfg) }) : n)), edges: g.edges });

// цифры книги: 0,68 млрд объектов и 0,68 ТБ метаданных при 100 ПБ и заполненности 40%
const d = L.derive(est, deep0);
assert(Math.abs(d.avgMB - 59.3) < 0.01 && Math.abs(d.objects / 1e9 - 0.68) < 0.01 && Math.abs(d.metaTB - 0.68) < 0.01, 'оценка как в книге');
assert(d.nodes3 === 1250, 'узлов при трёх копиях: 100 ПБ × 3 ÷ 240 ТБ');

// стрелки эталона разрешены, клиент в хранилища и API в узлы данных напрямую нет
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'metaDB') && !E.canLink(L, 'api', 'dataNode') && !E.canLink(L, 'client', 'dataNode'), 'запрещённые стрелки');

// схема из книги держит нагрузку и выполняет цели дизайна; узлов данных столько, сколько нужно под объём
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(r.nodes.dataNode.rep === 1250 && r.nodes.dataNode.util < 0.2, 'узлы по объёму, а не по запросам');
assert(F(r, 'get').lat > F(r, 'getMeta').lat + F(r, 'auth').lat, 'скачивание ждёт метаданные и права');

// без heartbeat цель не выполнена, без Placement загрузка не доходит
assert(!L.goals.base[2].check(E.analyze(L, without(ref('base'), 'dataNode', 'placement'), est, deep0, 'base')), 'без heartbeat');
assert(!E.analyze(L, without(ref('base'), 'router', 'placement'), est, deep0, 'base').m.routed, 'без Placement');

// углубление: с наивными решениями объекты теряются, версии затираются, мусор копится
const hard = { params: Object.assign({}, deep0.params, { peak: 3, tiny: 100 }), choices: deep0.choices };
r = E.analyze(L, ref('deep'), est, hard, 'deep');
assert(r.m.lost > 1000 && r.m.overwritten > 0 && r.m.garbage > 0 && r.m.corrupt > 0 && r.m.reup > 0 && r.m.nines < 6, 'deep: проблемы видны');

// эталон, адаптированный под пик ×3 и мелкие объекты ×100, с решениями книги закрывает все цели
const good = { params: hard.params, choices: { redund: 'ec', domain: 'az', consist: 'all', layout: 'sqlite', integrity: 'scrub', listing: 'denorm', version: 'version', mpu: 'mpu', gc: 'compact' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + ' ' + JSON.stringify(A.blockers));
console.log('ok', 'adapt:', A.changes.join('; '));

// EC вдвое дешевле трёх копий по узлам
const rep3 = E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, { redund: 'rep3' }) }, 'deep');
assert(rep3.nodes.dataNode.rep >= A.r.nodes.dataNode.rep * 1.9 && rep3.m.nines >= 6, 'EC: вдвое меньше узлов');

// листинг опросом всех шардов медленный
const sc = E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, { listing: 'scatter' }) }, 'deep');
assert(A.r.nodes.metaDB.cfg.shards > 1 && F(sc, 'list').lat > 200, 'scatter: листинг медленнее 200 мс');

// файл на объект при мелких объектах ×1000 упирается в IOPS дисков, склейка нет
const tiny = { params: Object.assign({}, good.params, { tiny: 1000, peak: 1 }), choices: good.choices };
const fileR = E.analyze(L, A.graph, est, { params: tiny.params, choices: Object.assign({}, good.choices, { layout: 'file', redund: 'rep3' }) }, 'deep');
const packR = E.analyze(L, A.graph, est, { params: tiny.params, choices: Object.assign({}, good.choices, { redund: 'rep3' }) }, 'deep');
assert(fileR.nodes.dataNode.util > packR.nodes.dataNode.util * 2, 'файл на объект: диски заняты сильнее');

// ключ object_id: поиск по имени через все шарды
const oid = E.analyze(L, withCfg(A.graph, 'metaDB', { shardKey: 'oid' }), est, good, 'deep');
assert(F(oid, 'getMeta').lat > F(A.r, 'getMeta').lat + 20, 'object_id: поиск медленнее');

// CDN снимает скачивания вместе с поиском метаданных и проверкой прав
const cd = E.addBlock(L, ref('base'), 'cdn', [0, 0]), rc = E.analyze(L, cd.graph, est, deep0, 'base'), r0 = E.analyze(L, ref('base'), est, deep0, 'base');
assert(rc.nodes.metaDB.load < r0.nodes.metaDB.load * 0.6 && rc.nodes.iam.load < r0.nodes.iam.load * 0.7, 'CDN снимает метаданные и IAM');

// Cassandra встаёт вместо Metadata DB
const cs = E.addBlock(L, ref('base'), 'cassMeta', [0, 0]), rcs = E.analyze(L, cs.graph, est, deep0, 'base');
assert(cs.dropped.length >= 1 && F(rcs, 'getMeta').path.some((x) => rcs.nodes[x.id].type === 'cassMeta'), 'cassMeta: потоки идут в неё');
console.log('ch9 ok');
