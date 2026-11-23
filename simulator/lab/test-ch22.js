// Проверка главы 22 (мессенджер): node simulator/lab/test-ch22.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch22/ch22.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// оценка: 231 тыс. сообщений в секунду, 694 тыс. в пик, 4,6 получателя, 4,8 млн доставок, 225 млн соединений, 750 шлюзов, 20 ТБ в день
const d = L.derive(est, deep0);
assert(Math.round(d.msg) === 231481 && Math.round(d.peakMsg) === 694444 && Math.round(d.fan * 10) === 46 && Math.round(d.deliv) === 4791667 && d.conns === 225e6 && d.gws === 750 && d.dayTB === 20, 'оценка ' + JSON.stringify(d));

// стрелки эталона разрешены; приложение только через шлюз
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'chat') && !E.canLink(L, 'gw', 'msgDB') && !E.canLink(L, 'client', 'push'), 'запрещённые стрелки');

// типовая схема: шлюзов по соединениям, хранилище только под недоставленное
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(r.nodes.gw.rep === d.gws && F(r, 'send').lat < 200 && r.nodes.msgDB.rep < 100, 'шлюзы по соединениям');

// углубление: наивные решения ломают все цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(L.goals.deep.every((g) => !g.check(r)) && r.m.lost > 0 && r.m.misorder > 0 && r.m.missed > 0 && r.m.readable > 0, 'deep: проблемы видны');

// типовые решения при пике ×5 закрывают все цели, при любом сроке хранения
const good = { params: { peak: 5, growth: 1 }, choices: { link: 'ws', route: 'registry', order: 'seq', ack: 'acks', offline: 'inbox', group: 'server', devices: 'each', e2e: 'signal', keep: 'until' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + JSON.stringify(A.blockers));
const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
const T = (x) => F(x, 'send').lat, GW = (x) => x.nodes.gw.rep;
assert(L.goals.deep.every((g) => g.check(alt({ keep: 'forever' }))) && alt({ keep: 'forever' }).nodes.msgDB.rep > A.r.nodes.msgDB.rep * 100, 'вся история в сотни раз дороже');

// транспорт и маршрут
assert(T(alt({ link: 'poll' })) > 2000 && GW(alt({ link: 'poll' })) > GW(A.r), 'опрос');
assert(alt({ link: 'long' }).nodes.gw.load > A.r.nodes.gw.load * 1.5, 'long polling');
assert(alt({ route: 'broadcast' }).m.maxU > 1, 'рассылка всем шлюзам');
// порядок, подтверждения, офлайн, устройства, группы, шифрование
assert(alt({ order: 'ts' }).m.misorder > 0 && alt({ ack: 'fire' }).m.lost > 0 && alt({ offline: 'drop' }).m.lost > alt({ ack: 'fire' }).m.lost, 'порядок и потери');
assert(alt({ devices: 'one' }).m.missed > 0 && alt({ e2e: 'none' }).m.readable > 0, 'устройства и шифрование');
assert(alt({ group: 'client' }).nodes.gw.load > A.r.nodes.gw.load * 1.3, 'раздача с телефона');
// без нужных блоков решения не работают
assert(E.analyze(L, without(A.graph, 'chat', 'push'), est, good, 'deep').m.lost > 0, 'офлайн без push');
assert(E.analyze(L, without(A.graph, 'chat', 'keys'), est, good, 'deep').m.readable > 0, 'шифрование без сервера ключей');
assert(E.analyze(L, without(A.graph, 'chat', 'sessions'), est, good, 'deep').m.maxU > 1, 'без реестра сессий');

// эксперимент: кэш последних сообщений снимает синхронизацию с очередей
const rc = E.analyze(L, E.addBlock(L, A.graph, 'cache', [0, 0]).graph, est, good, 'deep');
assert(rc.m.routed && rc.nodes.inbox.flows.sync < A.r.nodes.inbox.flows.sync, 'кэш последних сообщений');
console.log('ch22 ok');
