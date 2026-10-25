// Проверка песочницы: node simulator/lab/test-sandbox.js
const assert = require('assert');
global.window = global;
const M = require('../sandbox/model.js');
const labs = [];
for (let n = 1; n <= 99; n++) {
  try { require.resolve(`../ch${n}/ch${n}.js`); } catch (e) { break; }
  require(`../ch${n}/ch${n}.js`);
  labs.push({ n, title: global.LAB.title, blocks: global.LAB.blocks });
}
const cat = M.harvest(labs);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// каталог: базовые блоки на месте, одинаковые блоки глав слиты, у каждого блока понятная роль
assert(cat.users && cat.users.role === 'client' && cat.pg.role === 'db' && cat.kafka.role === 'queue');
assert(cat.lb.from.length >= 5, 'балансировщик встречается в нескольких главах: ' + cat.lb.from);
Object.values(cat).forEach((b) => assert(M.ROLES[b.role], b.name));
assert(Object.values(cat).some((b) => b.from.includes(7) && b.role === 'shield'), 'rate limiter главы 7 это защита входа');

const N = (id, type, o) => Object.assign({ id, type, x: 0, y: 0 }, o);
const E = (...p) => p.map(([from, to]) => ({ from, to }));
const env = { users: 1e5, rpu: 0.1, write: 0.1 }; // 10 000 rps

// один ДЦ: пользователи → балансировщик → сервис → кэш + PostgreSQL
const one = { nodes: [N('u', 'users'), N('lb', 'lb', { rep: 2 }), N('s', 'svc', { rep: 8 }), N('c', 'redis'), N('db', 'pg', { rep: 2 })],
  edges: E(['u', 'lb'], ['lb', 's'], ['s', 'c'], ['s', 'db']) };
let r = M.analyze(one, cat, env);
assert(near(r.m.total, 10000) && near(r.nodes.s.load, 10000), 'вход 10 000 rps');
assert(near(r.nodes.c.load, 9000), 'в кэш идут только чтения');
assert(near(r.nodes.db.r, 1800) && near(r.nodes.db.w, 1000), 'в БД промахи кэша и вся запись');
assert(near(r.nodes.db.util, (1000 + 1800 / 2) / 5000), 'запись в primary, чтения делятся между копиями');
assert(r.m.served > 0.999 && r.m.lat > 10, 'выдерживает: ' + r.m.served);

// упал кэш: всё чтение в БД, она перегружена
r = M.analyze(one, cat, Object.assign({}, env, { inc: [{ kind: 'node', id: 'c' }] }));
assert(r.nodes.c.down && near(r.nodes.db.r, 9000) && r.nodes.db.util > 1 && r.m.served < 0.95, 'без кэша БД тонет: ' + r.m.served);

// свет в ДЦ A: без резерва всё лежит, с ИБП держится; трансформатор переживает только дизель
const power = (kind, dc) => Object.assign({}, env, { inc: [{ kind, dc: 'A' }], dc: { A: dc || {} } });
assert(M.analyze(one, cat, power('power')).m.served === 0);
assert(M.analyze(one, cat, power('power', { ups: true })).m.served > 0.999);
assert(M.analyze(one, cat, power('trafo', { ups: true })).m.served === 0);
assert(M.analyze(one, cat, power('trafo', { diesel: true })).m.served > 0.999);
assert(M.analyze(one, cat, power('fire', { ups: true, diesel: true })).m.served === 0, 'пожар не спасает ничто');

// единые точки отказа: кэш и БД с одной копией... у БД две копии, у кэша одна
const res = M.resilience(one, cat, env);
assert(res.spof.some((x) => x.id === 'c') && !res.spof.some((x) => x.id === 's'), 'кэш один, сервисов восемь: ' + JSON.stringify(res.spof));
assert(res.dcLoss.length === 1 && res.dcLoss[0].served === 0, 'один ДЦ: его потеря роняет всё');

// два ДЦ: всё в A и B, БД с primary в A
const two = { nodes: [N('u', 'users'), N('lb', 'lb', { rep: 2, dcs: ['A', 'B'] }), N('s', 'svc', { rep: 12, dcs: ['A', 'B'] }), N('c', 'redis', { rep: 2, dcs: ['A', 'B'] }), N('db', 'pg', { rep: 2, dcs: ['A', 'B'] })],
  edges: one.edges };
r = M.analyze(two, cat, Object.assign({}, env, { inc: [{ kind: 'fire', dc: 'A' }] }));
assert(r.nodes.db.failover === 'B' && r.m.served > 0.99, 'потеря A: переключение на B: ' + r.m.served);
assert(r.nodes.s.live === 6, 'в B осталась половина сервисов');
// оптика до A перерублена: два ДЦ без кворума, запись останавливается
r = M.analyze(two, cat, Object.assign({}, env, { inc: [{ kind: 'cut', dc: 'A' }] }));
assert(r.nodes.db.split && near(r.m.served, 0.9, 0.02), 'split brain режет запись: ' + r.m.served);
// третий ДЦ даёт кворум
const three = JSON.parse(JSON.stringify(two)); three.nodes.find((n) => n.id === 'db').dcs = ['A', 'B', 'C']; three.nodes.find((n) => n.id === 'db').rep = 3;
r = M.analyze(three, cat, Object.assign({}, env, { inc: [{ kind: 'cut', dc: 'A' }] }));
assert(!r.nodes.db.split && r.nodes.db.failover && r.m.served > 0.99, 'с тремя ДЦ кворум есть');
// межрегиональная задержка: БД только в C, сервисы в A
const far = JSON.parse(JSON.stringify(one)); far.nodes.find((n) => n.id === 'db').dcs = ['C'];
assert(M.analyze(far, cat, env).m.lat > M.analyze(one, cat, env).m.lat + 5, 'поход в другой регион дороже');

// флешмоб ×10 и DDoS: защита на входе режет мусор
assert(M.analyze(one, cat, Object.assign({}, env, { inc: [{ kind: 'flash' }] })).m.served < 0.5, 'флешмоб ×10');
const ddos = Object.assign({}, env, { inc: [{ kind: 'ddos' }] });
assert(M.analyze(one, cat, ddos).m.served < 0.2, 'DDoS без защиты');
const shielded = { nodes: one.nodes.concat(N('w', 'waf')), edges: E(['u', 'w'], ['w', 'lb'], ['lb', 's'], ['s', 'c'], ['s', 'db']) };
const rs = M.analyze(shielded, cat, ddos);
assert(rs.m.served > M.analyze(one, cat, ddos).m.served * 2, 'WAF спасает от DDoS: ' + rs.m.served);

// очередь: перегрузка воркера не роняет ответы пользователю
const q = { nodes: one.nodes.concat(N('k', 'kafka'), N('wk', 'worker', { rep: 1 })), edges: one.edges.concat(E(['s', 'k'], ['k', 'wk'])) };
r = M.analyze(q, cat, env);
assert(r.nodes.wk.util > 1 && r.m.served > 0.999 && r.warnings.some((w) => w.lvl === 'warn' && /очеред/.test(w.text)), 'воркер отстаёт, но пользователь не видит');

// автомасштаб подбирает копии и заменяет упавшие
const auto = JSON.parse(JSON.stringify(one)); auto.nodes.find((n) => n.id === 's').auto = true; auto.nodes.find((n) => n.id === 's').rep = 1;
r = M.analyze(auto, cat, env);
assert(r.nodes.s.live === Math.ceil(10000 / (2000 * 0.7)) && r.nodes.s.util <= 0.7 + 1e-9, 'автомасштаб: ' + r.nodes.s.live);

// кольцо стрелок не зацикливает расчёт
M.analyze({ nodes: one.nodes, edges: one.edges.concat(E(['db', 's'], ['c', 'lb'])) }, cat, env);
// суточная кривая
assert(near(M.dayK(16), 1) && near(M.dayK(4), 0.25));
console.log('Песочница: все проверки прошли, блоков в каталоге', Object.keys(cat).length);
