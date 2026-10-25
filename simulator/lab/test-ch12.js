// Проверка главы 12 (цифровой кошелёк): node simulator/lab/test-ch12.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch12/ch12.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const withCfg = (g, type, cfg) => ({ nodes: g.nodes.map((n) => (n.type === type ? Object.assign({}, n, { cfg: Object.assign({}, n.cfg, cfg) }) : n)), edges: g.edges });

// цифры книги: 1 млн переводов это 2 млн операций, при 1 000 TPS на узел 2 000 узлов
const d = L.derive(est, deep0);
assert(d.transfers === 1e6 && d.ops === 2e6 && d.nodes === 2000, 'оценка ' + JSON.stringify([d.transfers, d.ops, d.nodes]));
assert(L.derive(Object.assign({}, est, { nodeTps: 100 }), deep0).nodes === 20000 && L.derive(Object.assign({}, est, { nodeTps: 10000 }), deep0).nodes === 200, 'таблица узлов книги');

['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'sqlBal') && !E.canLink(L, 'client', 'esRaft'), 'клиент в хранилище напрямую нельзя');

// схема книги: 4 000 реляционных шардов держат 2 млн операций
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))) + JSON.stringify(r.warnings));
assert(F(r, 'transfer').path.some((x) => x.id === 'txc'), 'перевод идёт через координатор');

// углубление: наивные решения видны
r = E.analyze(L, ref('base'), est, deep0, 'deep');
assert(r.m.lost > 0 && r.m.unrepro > 0 && r.m.lostEv > 0 && r.m.polls > 0, 'deep: проблемы видны ' + JSON.stringify(r.m));

// эталон с решениями книги закрывает все цели
const good = { params: deep0.params, choices: { atomic: 'tcc', audit: 'es', perf: 'local', rel: 'raft', reply: 'push' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + ' ' + JSON.stringify(A.blockers) + ' ' + JSON.stringify(A.r.warnings.filter((w) => w.lvl !== 'info')));
console.log('ok', 'перевод', Math.round(F(A.r, 'transfer').lat) + 'ms', 'партиций', A.r.nodes.esRaft.rep);

const alt = (ch, g = A.graph, p = good.params) => E.analyze(L, g, est, { params: p, choices: Object.assign({}, good.choices, ch) }, 'deep');
// Saga медленнее TC/C, 2PC режет пропускную способность
assert(F(alt({ atomic: 'saga' }), 'transfer').lat > F(A.r, 'transfer').lat && alt({ atomic: '2pc' }).nodes.esRaft.rep > A.r.nodes.esRaft.rep, 'Saga и 2PC');
assert(alt({ perf: 'db' }).m.maxU > 0.9, 'события по сети не держат 2 млн');
assert(alt({ rel: 'single' }).m.lostEv > 0 && alt({ reply: 'poll' }).m.polls > 0, 'одна копия и опрос');
// без координатора TC/C не работает, без прокси push не работает
const noTxc = { nodes: A.graph.nodes.filter((n) => n.type !== 'txc'), edges: A.graph.edges.filter((e) => e.to !== 'txc' && e.from !== 'txc').concat({ from: 'walletSvc', to: 'esRaft' }) };
assert(alt({}, noTxc).m.lost > 0, 'TC/C без координатора');
// горячий счёт 10%: одна партиция становится потолком, суб-счета спасают
const hotP = Object.assign({}, good.params, { hot: 10 }), rh = alt({}, A.graph, hotP);
assert(rh.m.maxU > 0.9 && /горячий счёт/.test(rh.nodes.esRaft.limit), 'горячий счёт ' + rh.nodes.esRaft.limit);
const sa = E.addBlock(L, A.graph, 'subAcc', [0, 0]), rs = alt({}, sa.graph, hotP);
assert(rs.m.maxU <= 0.9 && F(rs, 'sub').ok, 'суб-счета ' + rs.m.maxU);
// горячий счёт в реляционных шардах
assert(E.analyze(L, ref('base'), est, { params: hotP, choices: deep0.choices }, 'base').nodes.sqlBal.util > 1, 'горячий счёт в SQL');
// Redis: решение 1, без координатора деньги теряются; Spanner и TigerBeetle атомарны сами
const rd = E.addBlock(L, ref('base'), 'redisBal', [0, 0]);
const rr = alt({}, rd.graph);
assert(rd.dropped.length === 1 && F(rr, 'transfer').path.some((x) => x.id === 'redisBal') && rr.m.lost === 0 && rr.warnings.some((w) => /Redis/.test(w.text)) && alt({ atomic: 'none' }, rd.graph).m.lost > 0, 'Redis');
const sp = alt({ atomic: 'none' }, E.addBlock(L, noTxc, 'spanner', [0, 0]).graph), tb = alt({ atomic: 'none' }, E.addBlock(L, noTxc, 'tiger', [0, 0]).graph);
assert(sp.m.lost === 0 && sp.m.unrepro > 0 && tb.m.lost === 0 && tb.m.unrepro === 0 && tb.nodes.tiger.util < 0.9, 'Spanner и TigerBeetle ' + tb.nodes.tiger.util);
console.log('ch12 ok');
