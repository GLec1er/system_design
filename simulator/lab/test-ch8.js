// Проверка главы 8 (почта): node simulator/lab/test-ch8.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch8/ch8.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// цифры книги: ~100 тыс. отправок в секунду, 730 ПБ метаданных и 1460 ПБ вложений в год
const d = L.derive(est, deep0);
assert(Math.abs(d.send - 115741) < 1 && Math.round(d.metaPB) === 730 && Math.round(d.attPB) === 1460, 'оценка как в книге');

// стрелки эталона разрешены, клиент в хранилища напрямую нет
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'metaDB') && !E.canLink(L, 'web', 'smtpOut'), 'клиент в БД и web мимо очереди запрещены');

// схема из книги держит нагрузку по умолчанию и выполняет цели дизайна
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
// очередь и воркер считаются один раз, а не на каждый поток за ними
assert(Math.abs(r.nodes.inQ.load - F(r, 'in').rate) < 1 && Math.abs(r.nodes.mailProc.load - F(r, 'proc').rate) < 1, 'side-потоки не нагружают очередь и воркер повторно');
assert(r.nodes.mailProc.maxRep <= r.nodes.inQ.cfg.partitions, 'воркеров не больше, чем партиций');

// без push клиенты опрашивают сервер: нагрузка на web растёт
const noPush = E.analyze(L, without(ref('base'), 'mailProc', 'rt'), est, deep0, 'base');
assert(!F(noPush, 'push').ok && noPush.nodes.web.load > r.nodes.web.load * 2 && noPush.warnings.some((w) => /опрашивают/.test(w.text)), 'опрос вместо push');

// без очереди исходящих письма наружу не уходят, цель не выполнена
const noOut = E.analyze(L, without(ref('base'), 'web', 'outQ'), est, deep0, 'base');
assert(!F(noOut, 'out').ok && !L.goals.base[1].check(noOut), 'без очереди исходящих');

// углубление: без решений письма теряются, спам доходит, копии расходятся
const hard = { params: Object.assign({}, deep0.params, { peak: 2, growth: 2 }), choices: deep0.choices };
r = E.analyze(L, ref('deep'), est, hard, 'deep');
assert(r.m.lost > 0 && r.m.spamIn > d.Rday * 0.01 && r.m.conflicts > 0 && r.m.junked > 0, 'deep: проблемы видны');

// эталон, адаптированный под пик ×2 и рост ×2, с решениями книги закрывает все цели
const good = { params: hard.params, choices: { filter: 'ml', unread: 'denorm', cons: 'single', retry: 'errq', deliv: 'full' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))));
console.log('ok', 'adapt:', A.changes.join('; '));

// фильтр непрочитанных сканом делает список медленным
const scan = E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, { unread: 'scan' }) }, 'deep');
assert(F(scan, 'list').lat > 200, 'scan: список медленнее 200 мс');

// ключ раздела: email_id даёт scatter-gather, дата горячий узел
const key = (k) => E.analyze(L, { nodes: A.graph.nodes.map((n) => (n.type === 'metaDB' ? Object.assign({}, n, { cfg: Object.assign({}, n.cfg, { shardKey: k }) }) : n)), edges: A.graph.edges }, est, good, 'deep');
assert(F(key('email'), 'list').lat > F(key('user'), 'list').lat + 20, 'email_id: список медленнее');
assert(key('date').nodes.metaDB.util > key('user').nodes.metaDB.util * 10, 'дата: горячий узел');

// фильтр на входе снимает спам до воркеров
const dn = E.addBlock(L, ref('base'), 'dnsbl', [0, 0]);
const rd = E.analyze(L, dn.graph, est, Object.assign({}, deep0, { params: Object.assign({}, deep0.params, { wave: 10 }) }), 'base');
const r0 = E.analyze(L, ref('base'), est, Object.assign({}, deep0, { params: Object.assign({}, deep0.params, { wave: 10 }) }), 'base');
assert(rd.nodes.mailProc.load < r0.nodes.mailProc.load * 0.4, 'DNSBL снимает спам-волну с воркеров');

// экспериментальные хранилища встают вместо Metadata DB
['pgMeta', 's3Meta'].forEach((t) => {
  const x = E.addBlock(L, ref('base'), t, [0, 0]), rx = E.analyze(L, x.graph, est, deep0, 'base');
  assert(x.dropped.length >= 2 && F(rx, 'list').path.some((p) => rx.nodes[p.id].type === t), `${t}: потоки идут в него`);
});
console.log('ch8 ok');
