// Проверка лаборатории: node simulator/lab/test.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch7/ch7.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k);

// стрелки эталонов разрешены, а клиент напрямую в БД нет
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'resDB') && !E.canLink(L, 'hotelDB', 'hotel'), 'бессмысленные стрелки запрещены');
assert(E.linkTargets(L, 'client').includes('gateway'), 'клиент → gateway');

// эталон базового дизайна: все потоки доходят, нагрузка ~3 TPS влезает
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(r.m.routed, 'base: все потоки доходят');
assert(Math.abs(r.d.tps - 2.7) < 0.1, 'оценка ≈ 3 TPS');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели');

// без стрелки reservation → resDB бронь не доходит
const g = ref('base'); g.edges = g.edges.filter((e) => !(e.from === 'reservation' && e.to === 'resDB'));
r = E.analyze(L, g, est, deep0, 'base');
assert(!r.flows.find((f) => f.id === 'book').ok, 'бронь без стрелки в БД не доходит');

// углубление: без решений есть дубли и перепродажи, распродажа кладёт БД
const hard = { params: { dup: 3, conflict: 2, flash: 60, growth: 10 }, choices: { idem: 'none', lock: 'none', shard: 'none', txn: 'none' } };
r = E.analyze(L, ref('base'), est, hard, 'deep');
assert(r.m.dup > 0 && r.m.oversell > 0 && r.m.incons > 0 && r.m.served < 1, 'deep: проблемы видны');

// эталон углубления с правильными решениями закрывает все цели
const good = { params: hard.params, choices: { idem: 'key', lock: 'opt', shard: 'hotel', txn: 'saga' } };
r = E.analyze(L, ref('deep'), est, good, 'deep');
assert(L.goals.deep.every((x) => x.check(r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((x) => x.check(r))));
// кэш снимает чтения с БД
assert(r.nodes.cache.load > 0 && r.nodes.cacheR.load > 0, 'кэши в работе');
console.log('ok', 'cx', r.m.cx.toFixed(1), 'book', r.flows.find((f) => f.id === 'book').lat.toFixed(0) + 'ms');

// балансировщик встаёт между клиентом и Gateway: стрелку client → gateway заменяет, потоки идут через него
{
  const lb = E.addBlock(L, ref('deep'), 'lb', [0, 0]), t = (id) => lb.graph.nodes.find((n) => n.id === id).type;
  assert(lb.dropped.length === 1 && !lb.graph.edges.some((e) => t(e.from) === 'client' && t(e.to) === 'gateway'), 'lb: client → gateway заменена');
  const rl = E.analyze(L, lb.graph, est, good, 'deep');
  assert(rl.m.routed && rl.flows.every((f) => f.optional || f.path.some((x) => x.id === 'lb')), 'lb: все потоки идут через балансировщик');
  assert(L.goals.deep.every((x) => x.check(rl)) && !rl.warnings.some((w) => /в обход/.test(w.text)), 'lb: цели не ломаются');
  const gw = (alg) => E.analyze(L, { nodes: lb.graph.nodes.map((n) => (n.id === 'lb' ? Object.assign({}, n, { cfg: { alg } }) : n)), edges: lb.graph.edges }, est, good, 'deep').nodes.gateway, per = (alg) => gw(alg).capTotal / gw(alg).rep;
  assert(per('least') > per('rr') && per('rr') > per('hash'), 'lb: алгоритм влияет на мощность копий за ним');
  // без стрелки lb → gateway поток не доходит и подсказка называет балансировщик
  const cut = { nodes: lb.graph.nodes, edges: lb.graph.edges.filter((e) => !(e.from === 'lb' && t(e.to) === 'gateway')) };
  assert(E.analyze(L, cut, est, good, 'deep').flows.find((f) => f.id === 'view').missing[0] === 'lb', 'lb: подсказка про стрелку от балансировщика');
}

// необязательные блоки: addBlock сам проводит стрелки, эффекты видны
const bookLat = (g, deep) => E.analyze(L, g, est, deep, 'deep').flows.find((f) => f.id === 'book').lat;
let g2 = E.addBlock(L, ref('deep'), 'notification', [0, 0]).graph;
assert(g2.edges.some((e) => e.from === 'reservation' && e.to === 'notification'), 'без Kafka письмо подключается к сервису');
assert(bookLat(g2, good) > bookLat(ref('deep'), good) + 100, 'синхронное письмо тормозит бронь');
// Kafka сама приводит Notification Service и подключает его через очередь
let g3 = E.addBlock(L, ref('deep'), 'kafka', [0, 0]).graph;
assert(g3.nodes.filter((n) => n.type === 'notification').length === 1, 'Kafka приводит потребителя');
assert(g3.edges.some((e) => e.from === 'kafka' && e.to === 'notification') && !g3.edges.some((e) => e.from === 'reservation' && e.to === 'notification'), 'с Kafka письмо идёт через очередь');
r = E.analyze(L, g3, est, good, 'deep');
assert(r.flows.find((f) => f.id === 'events').ok && Math.abs(r.flows.find((f) => f.id === 'book').lat - bookLat(ref('deep'), good)) < 1, 'асинхронное письмо не тормозит бронь');
// Kafka после синхронного письма заменяет стрелку Reservation → Notification
const g3b = E.addBlock(L, g2, 'kafka', [0, 0]).graph;
assert(!g3b.edges.some((e) => e.from === 'reservation' && e.to === 'notification') && g3b.edges.some((e) => e.from === 'kafka' && e.to === 'notification'), 'Kafka заменяет синхронное письмо');
// Cassandra вместо SQL: при добавлении брони сразу идут в неё, оптимистичная блокировка больше не спасает
const g4 = E.addBlock(L, ref('deep'), 'nosql', [0, 0]).graph;
r = E.analyze(L, g4, est, good, 'deep');
assert(r.m.routed && r.m.oversell > 0, 'NoSQL: перепродажи возвращаются');
// CDN забирает часть просмотров до Gateway
const g5 = E.addBlock(L, ref('base'), 'cdn', [0, 0]).graph;
assert(E.analyze(L, g5, est, deep0, 'base').nodes.gateway.load < E.analyze(L, ref('base'), est, deep0, 'base').nodes.gateway.load * 0.6, 'CDN разгружает Gateway');
// почему блок простаивает: не подключён, лишний дубль или не нужен в главе
const g6 = E.addBlock(L, ref('base'), 'client', [0, 0]).graph;
let g7 = E.addBlock(L, g6, 'search', [0, 0]).graph;
g7.nodes.push({ id: 'k', type: 'kafka' }); g7.edges.push({ from: 'reservation', to: 'k' });
r = E.analyze(L, g7, est, deep0, 'base');
assert.equal(r.nodes.client2.why.kind, 'dup');
assert.equal(r.nodes.search.why.kind, 'useless');
assert(r.nodes.k.why.kind === 'off' && /Kafka → Notification/.test(r.nodes.k.why.text), r.nodes.k.why.text);
// настройки БД: реплики снимают чтения, шарды запись; ×100 без кэша лечится настройками
const x100 = { params: Object.assign({}, deep0.params, { flash: 100 }), choices: deep0.choices };
const util = (g, id) => E.analyze(L, g, est, x100, 'base').nodes[id].util;
const gb = ref('base');
assert(util(gb, 'hotelDB') > 1 && util(gb, 'resDB') > 1, '×100 без кэша и настроек БД перегружены');
gb.nodes.find((n) => n.id === 'hotelDB').cfg = { replicas: 5, shards: 2 };
gb.nodes.find((n) => n.id === 'resDB').cfg = { replicas: 1, shards: 4 };
assert(util(gb, 'hotelDB') < 0.9 && util(gb, 'resDB') < 0.9, 'реплики и шарды вытягивают ×100');
// Kafka: потребителей не больше, чем партиций
const gk = E.addBlock(L, ref('deep'), 'kafka', [0, 0]).graph;
const kx = (pt) => { gk.nodes.find((n) => n.type === 'kafka').cfg = { partitions: pt }; return E.analyze(L, gk, est, x100, 'deep').nodes.notification; };
assert(kx(1).util > 1 && kx(24).util < 1, 'мало партиций душит Notification Service');
// NoSQL: DynamoDB защищает условной записью, MongoDB работает с блокировками, но медленнее
const gd = E.addBlock(L, ref('deep'), 'dynamo', [0, 0]).graph;
r = E.analyze(L, gd, est, hard, 'deep');
assert(r.m.routed && r.m.oversell === 0 && r.nodes.dynamo.load > 0, 'DynamoDB: условная запись без перепродаж');
const gm = E.addBlock(L, ref('deep'), 'mongo', [0, 0]).graph;
r = E.analyze(L, gm, est, good, 'deep');
assert(r.m.oversell === 0 && r.flows.find((f) => f.id === 'book').lat > bookLat(ref('deep'), good), 'MongoDB: транзакции есть, но медленнее');
console.log('extras ok');

// сценарий: ×1000 при росте ×20 кладёт даже сервисы, причина и что нужно названы
const huge = { params: Object.assign({}, deep0.params, { flash: 1000, growth: 20 }), choices: good.choices };
r = E.analyze(L, ref('deep'), est, huge, 'deep');
assert(r.m.served < 1 && r.nodes.hotel.util > 1 && /предел/.test(r.nodes.hotel.limit) && r.nodes.hotel.need, '×1000×20: Hotel Service упёрся в предел реплик');
assert(r.warnings.some((w) => w.lvl === 'bad' && /Упёрся/.test(w.text)), 'перегрузка объяснена');
// шарды по дате: горячий шард берёт половину, по отелю ровно
const shard = (key) => { const g = ref('base'); g.nodes.find((n) => n.id === 'resDB').cfg = { shards: 4, shardKey: key }; return E.analyze(L, g, est, x100, 'base').nodes.resDB; };
assert(shard('date').util > shard('hotel').util * 1.9 && shard('date').cluster.shards[0].share === 0.5, 'ключ по дате перекошен');
assert.equal(shard('hotel').cluster.shards.length, 4);
// Kafka: RF больше брокеров предупреждает, диски брокеров ограничивают поток
const gkb = E.addBlock(L, ref('deep'), 'kafka', [0, 0]).graph;
gkb.nodes.find((n) => n.type === 'kafka').cfg = { brokers: 1, rf: 3, partitions: 24 };
r = E.analyze(L, gkb, est, huge, 'deep');
assert(r.warnings.some((w) => /RF=3 при 1/.test(w.text)) && r.nodes.kafka.cluster.rf === 1, 'RF ограничен числом брокеров');
// RabbitMQ: письма идут через очередь, потребители не ограничены партициями, CDC через неё нельзя
const gr = E.addBlock(L, ref('deep'), 'rabbit', [0, 0]).graph;
r = E.analyze(L, gr, est, x100, 'deep');
assert(r.flows.find((f) => f.id === 'events').ok && r.nodes.notification.maxRep === L.blocks.notification.maxRep && r.nodes.notification.consumerOf.type === 'rabbit', 'RabbitMQ: конкурирующие потребители');
assert(!E.canLink(L, 'resDB', 'rabbit'), 'CDC только через Kafka');
// Memcached и PostgreSQL как кэш снимают чтения с Hotel DB
['memcached', 'pgcache'].forEach((t) => {
  const g = ref('base'); const a = E.addBlock(L, g, t, [0, 0]).graph;
  assert(E.analyze(L, a, est, x100, 'base').nodes.hotelDB.load < E.analyze(L, g, est, x100, 'base').nodes.hotelDB.load * 0.3, t + ' разгружает Hotel DB');
});
// эталон: при книжной нагрузке оригинал, под ×100 адаптация выдерживает, под ×1000×20 нет и объясняет почему
let ad = E.adapt(L, 'base', est, deep0);
assert(ad.original && ad.ok, 'книжная нагрузка: оригинал');
ad = E.adapt(L, 'base', est, x100);
assert(!ad.original && ad.ok && ad.changes.some((c) => /Кэш/.test(c)), 'адаптация под ×100: ' + ad.changes.join('; '));
ad = E.adapt(L, 'deep', est, huge);
assert(!ad.ok && ad.blockers.length && ad.blockers[0].need, 'под ×1000×20 эталон не вытягивает и говорит почему');
assert(ad.changes.some((c) => /CDN: страницы целиком/.test(c)), 'эталон кэширует страницу отеля целиком на CDN: ' + ad.changes.join('; '));
// ×300 на 24 ч при росте ×5: без full-page CDN Hotel Service упирается в 200 копий, с ним эталон выдерживает
const x300 = { params: Object.assign({}, deep0.params, { flash: 300, hours: 24, growth: 5 }), choices: good.choices };
assert(E.adapt(L, 'deep', est, x300).ok && E.adapt(L, 'base', est, x300).ok, '×300×5: эталон выдерживает');
console.log('scenario ok:', E.adapt(L, 'base', est, x100).changes.join('; '), '|', ad.changes.join('; '), '| blockers:', ad.blockers.map((b) => b.name + ' ' + Math.round(b.util * 100) + '%').join(', '));

// аудит: пустая карта не «выдерживает», недостроенная бронь не даёт бизнес-ошибок
r = E.analyze(L, { nodes: [], edges: [] }, est, hard, 'deep');
assert(!r.m.routed && r.m.served === 0 && r.m.dup === 0 && r.m.oversell === 0, 'пустая карта: нет ложного успеха');
assert(!L.goals.base[2].check(E.analyze(L, { nodes: [], edges: [] }, est, deep0, 'base')), 'цель по нагрузке не засчитана на пустой карте');
// ошибки «в день» зависят от длительности пика
const day = (h) => E.analyze(L, ref('base'), est, { params: Object.assign({}, hard.params, { hours: h }), choices: hard.choices }, 'deep').m.dup;
assert(day(8) > day(2) * 1.5, 'длиннее пик, больше дублей за день');
// фоновый потребитель не роняет «выдерживаем», но виден как очередь
const gq = E.addBlock(L, ref('deep'), 'kafka', [0, 0]).graph, dq = { params: Object.assign({}, deep0.params, { flash: 1000 }), choices: good.choices };
r = E.analyze(L, gq, est, dq, 'deep');
const r0 = E.analyze(L, ref('deep'), est, dq, 'deep');
assert(Math.abs(r.m.served - r0.m.served) < 1e-9 && r.m.bgU > 1 && r.warnings.some((w) => /очередь растёт/.test(w.text)), 'фон отдельно от брони');
// acks меняет задержку и пропускную способность Kafka
const ack = (a) => { gq.nodes.find((n) => n.type === 'kafka').cfg = { acks: a }; const x = E.analyze(L, gq, est, dq, 'deep'); return [x.nodes.kafka.capTotal, x.flows.find((f) => f.id === 'events').lat]; };
assert(ack('1')[0] > ack('all')[0] && ack('1')[1] < ack('all')[1], 'acks влияет на расчёт');
// порядок стрелок к кэшам не меняет расчёт
const gc = ref('base'); gc.nodes.push({ id: 'c1', type: 'cache' }, { id: 'c2', type: 'pgcache' }); gc.edges.push({ from: 'hotel', to: 'c1' }, { from: 'hotel', to: 'c2' });
const ca = E.analyze(L, gc, est, deep0, 'base'), cb = E.analyze(L, { nodes: gc.nodes, edges: gc.edges.slice().reverse() }, est, deep0, 'base');
assert(ca.nodes.c1.load === cb.nodes.c1.load && ca.nodes.c1.load > ca.nodes.c2.load, 'быстрый кэш первым при любом порядке стрелок');
// кэш: шарды делят ключи, но горячий ключ упирается в один шард; его снимают реплики и локальный кэш
{
  const cg = (cfg) => { const g2 = ref('deep'); g2.nodes = g2.nodes.map((n) => (n.id === 'cache' ? Object.assign({}, n, { cfg }) : n)); return E.analyze(L, g2, est, good, 'deep').nodes.cache; };
  const c1 = cg({ shards: 1, replicas: 0 }), c12 = cg({ shards: 12, replicas: 0 }), c48 = cg({ shards: 48, replicas: 0 }), c48r = cg({ shards: 48, replicas: 2 }), c48n = cg({ shards: 48, replicas: 0, near: 'on' });
  assert(c12.util < c1.util / 10, 'шарды делят чтения');
  assert(c48.cluster.key === 'горячий ключ' && c48.util > c12.util / 3, '48 шардов упираются в горячий ключ: вчетверо больше шардов дают меньше чем вчетверо');
  assert(c48r.util < c48.util / 2.9 && c48n.util < c48.util / 4, 'реплики и L1 снимают горячий ключ');
  const mc = (() => { const g2 = ref('deep'); g2.nodes = g2.nodes.map((n) => (n.id === 'cache' ? Object.assign({}, n, { type: 'memcached', cfg: { shards: 1, replicas: 2 } }) : n)); return E.analyze(L, g2, est, good, 'deep').nodes.cache; })();
  assert(mc.cluster.replicas === 0, 'у Memcached реплик нет');
}
// стрелки после перегруженного блока несут только то, что он пропустил
{
  const hot = E.analyze(L, ref('base'), est, x300, 'deep'), gw = hot.nodes.hotel, k = 'hotel>hotelDB';
  const need = Object.values(hot.edgeLoad[k]).reduce((a, b) => a + b, 0), got = Object.values(hot.edgePass[k]).reduce((a, b) => a + b, 0);
  assert(gw.util > 1, 'Hotel Service перегружен');
  assert(got < need && Math.abs(Object.values(hot.edgePass['client>gateway']).reduce((a, b) => a + b, 0) - Object.values(hot.edgeLoad['client>gateway']).reduce((a, b) => a + b, 0)) < 1e-6, 'до перегрузки проходит всё, после меньше ' + gw.util);
}
console.log('audit ok');
