// Проверка главы 16 (CDC и lakehouse): node simulator/lab/test-ch16.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch16/ch16.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });
const fresh = (r) => F(r, 'land').lat + F(r, 'apply').lat;

// оценка: 5 тыс. изменений в секунду, пик ×2, 70% правок, 432 ГБ журнала в день
const d = L.derive(est, deep0);
assert(d.ch === 5000 && d.peakCh === 10000 && d.upserts === 7000 && d.gbDay === 432, 'оценка ' + JSON.stringify([d.ch, d.peakCh, d.upserts, d.gbDay]));

// стрелки эталона разрешены; мимо Debezium, Kafka и SQL-движка нельзя
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'oltp', 'kafka') && !E.canLink(L, 'cdc', 'silver') && !E.canLink(L, 'analyst', 'silver') && !E.canLink(L, 'trino', 'bronze'), 'запрещённые стрелки');

// типовая схема выполняет цели: изменение в таблице быстрее двух минут
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(fresh(r) < 120000 && fresh(r) > 30000, 'свежесть около минуты ' + fresh(r));

// углубление: наивные решения ломают цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(r.m.lostCh > 0 && r.m.stale > 0 && r.m.missPct > 0 && r.m.undeleted > 0 && r.m.stuckH > 0 && F(r, 'query').lat > 10000, 'deep: проблемы видны');
assert(r.nodes.merge.rep > 50, 'каталоги Hive: правка переписывает партицию ' + r.nodes.merge.rep);

// типовые решения при пике ×5 закрывают все цели
const good = { params: { peak: 5, growth: 1 }, choices: { capture: 'log', key: 'pk', boot: 'snap', format: 'table', upsert: 'mor', maint: 'compact', schema: 'evolve', del: 'apply' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + JSON.stringify(A.blockers));
const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
assert(alt({ capture: 'dual' }).m.lostCh > 0 && alt({ capture: 'poll' }).m.lostCh > alt({ capture: 'dual' }).m.lostCh, 'двойная запись и опрос теряют изменения');
assert(fresh(alt({ capture: 'poll' })) > 120000, 'опрос не даёт двух минут');
assert(alt({ key: 'rr' }).m.stale > 0 && alt({ boot: 'now' }).m.missPct > 0 && alt({ del: 'ignore' }).m.undeleted > 0 && alt({ schema: 'break' }).m.stuckH > 0, 'порядок, снимок, удаления, схема');
assert(alt({ upsert: 'cow' }).nodes.merge.rep > A.r.nodes.merge.rep * 3, 'copy-on-write при 70% правок дороже в записи');
assert(F(alt({ upsert: 'cow' }), 'query').lat < F(A.r, 'query').lat, 'зато читать быстрее');
assert(F(alt({ maint: 'none' }), 'query').lat > 10000 && alt({ format: 'hive' }).nodes.merge.rep > A.r.nodes.merge.rep * 5, 'без компакции и без табличного формата');
// редкие правки: copy-on-write почти не дороже
const rare = Object.assign({}, est, { upd: 5 });
const mor = E.analyze(L, A.graph, rare, good, 'deep'), cow = E.analyze(L, A.graph, rare, { params: good.params, choices: Object.assign({}, good.choices, { upsert: 'cow' }) }, 'deep');
assert(cow.nodes.merge.rep <= mor.nodes.merge.rep * 1.3, 'при редких правках copy-on-write дёшев ' + [mor.nodes.merge.rep, cow.nodes.merge.rep]);
// без нужных блоков решения не работают
assert(F(E.analyze(L, without(A.graph, 'compact', 'silver'), est, good, 'deep'), 'query').lat > 10000, 'компакция без блока');
assert(E.analyze(L, without(A.graph, 'cdc', 'registry'), est, good, 'deep').m.stuckH > 0, 'эволюция схемы без реестра');
// метрики убирают предупреждение про журнал боевой базы
const noMon = A.r.warnings.some((w) => /журнал заполнит диск/.test(w.text));
const mon = E.addBlock(L, A.graph, 'metrics', [0, 0]), rm = E.analyze(L, mon.graph, est, good, 'deep');
assert(noMon && !rm.warnings.some((w) => /журнал заполнит диск/.test(w.text)), 'метрики отставания');
console.log('ch16 ok');
