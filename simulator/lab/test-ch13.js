// Проверка главы 13 (биржа): node simulator/lab/test-ch13.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch13/ch13.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);

// цифры книги: 1 млрд за 6,5 часа ≈ 43 тысячи в секунду, пик ×5 ≈ 215 тысяч
const d = L.derive(est, deep0);
assert(Math.round(d.qps) === 42735 && Math.round(d.peakQps / 1000) === 214, 'оценка ' + JSON.stringify([d.qps, d.peakQps]));

['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'broker', 'matching') && !E.canLink(L, 'broker', 'sequencer') && !E.canLink(L, 'broker', 'reportDB'), 'брокер только через gateway');

// схема книги: сервисы по сети, миллисекунды, нагрузка держится
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))) + JSON.stringify(r.warnings));
assert(F(r, 'order').lat > 1 && F(r, 'fill').ok && F(r, 'md').ok && F(r, 'report').ok, 'по сети миллисекунды ' + F(r, 'order').lat);

// углубление: наивные решения видны, DDoS кладёт gateway без периметра
const hard = { params: Object.assign({}, deep0.params, { ddos: 10 }), choices: deep0.choices };
r = E.analyze(L, ref('base'), est, hard, 'deep');
assert(r.m.jitter > 0 && r.m.down > 0 && r.m.unfair > 0 && r.m.served < 1 && F(r, 'order').lat > 1, 'deep: проблемы видны');

// эталон с решениями книги закрывает все цели
const good = { params: hard.params, choices: { path: 'mmap', loop: 'pinned', book: 'dll', ha: 'raft', md: 'multicast' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + ' ' + JSON.stringify(A.blockers) + ' ' + JSON.stringify(A.r.warnings.filter((w) => w.lvl !== 'info')));
console.log('ok', 'заявка', Math.round(F(A.r, 'order').lat * 1000) + ' мкс');

const alt = (ch, g = A.graph) => E.analyze(L, g, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
assert(F(alt({ path: 'net' }), 'order').lat > 1, 'по сети миллисекунды');
assert(alt({ book: 'list' }).m.maxU > 0.9 && /торгуемый символ/.test(alt({ book: 'list' }).nodes.matching.limit), 'стакан списком не держит пик');
assert(alt({ ha: 'hotwarm' }).m.down > 0 && alt({ ha: 'cold' }).m.down > alt({ ha: 'hotwarm' }).m.down, 'резерв');
assert(alt({ md: 'tcp' }).m.unfair > 0 && alt({ loop: 'threads' }).m.jitter > 0, 'данные и хвост');

// Kafka как секвенсор: миллисекунды и одна партиция не держит пик
const kq = E.addBlock(L, A.graph, 'kafkaSeq', [0, 0]), rk = alt({}, kq.graph);
assert(rk.m.routed && F(rk, 'order').path.some((x) => rk.nodes[x.id].type === 'kafkaSeq') && F(rk, 'order').lat > 2 && rk.nodes.kafkaSeq.util > 0.9, 'Kafka как секвенсор ' + JSON.stringify(rk.warnings.filter((w) => w.lvl === 'bad')));
// kernel bypass и FPGA ускоряют путь, аукцион убирает гонку, но заявка ждёт
const kb = E.addBlock(L, A.graph, 'kbGw', [0, 0]), fp = E.addBlock(L, kb.graph, 'fpga', [0, 0]), rf = alt({}, fp.graph);
assert(rf.m.routed && F(rf, 'order').lat < F(A.r, 'order').lat && F(rf, 'fill').path.some((x) => rf.nodes[x.id].type === 'kbGw'), 'kernel bypass и FPGA ' + F(rf, 'order').lat);
const au = E.addBlock(L, A.graph, 'auction', [0, 0]), ra = alt({ md: 'tcp' }, au.graph);
assert(ra.m.routed && ra.m.unfair === 0 && F(ra, 'order').lat > 40, 'частые аукционы');
console.log('ch13 ok');
