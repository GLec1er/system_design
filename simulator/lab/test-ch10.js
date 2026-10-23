// Проверка главы 10 (рейтинг игроков): node simulator/lab/test-ch10.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch10/ch10.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { (p.params || []).forEach((x) => (deep0.params[x.id] = x.value)); if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const withCfg = (g, type, cfg) => ({ nodes: g.nodes.map((n) => (n.type === type ? Object.assign({}, n, { cfg: Object.assign({}, n.cfg, cfg) }) : n)), edges: g.edges });

// цифры книги: 50 игроков в секунду, 500 очков, пик 2500, топ-10 50 раз в секунду, 650 МБ; при ×100 65 ГБ
const d = L.derive(est, deep0);
assert(d.ups === 50 && d.score === 500 && d.peakScore === 2500 && d.top === 50 && d.memMB === 650, 'оценка ' + JSON.stringify([d.ups, d.score, d.peakScore, d.top, d.memMB]));
assert(L.derive(est, { params: { growth: 100, peak: 5 } }).memGB === 65, '×100: 65 ГБ');

// стрелки эталона разрешены, клиент в хранилища и Game service в Redis напрямую нет
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'redis') && !E.canLink(L, 'gameSvc', 'redis') && !E.canLink(L, 'client', 'mysql'), 'запрещённые стрелки');

// схема книги: один Redis с репликой держит пик, цели дизайна выполнены
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: все цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(r.nodes.redis.rep === 2 && r.nodes.redis.util < 0.1, 'один Redis и реплика, загрузка мала');

// MySQL с ORDER BY вместо Redis: место игрока за секунды
const sq = E.addBlock(L, ref('base'), 'sqlRank', [0, 0]), rs = E.analyze(L, sq.graph, est, deep0, 'base');
assert(sq.dropped.length === 1 && F(rs, 'rank').path.some((x) => rs.nodes[x.id].type === 'sqlRank') && F(rs, 'rank').lat > 1000 && !L.goals.base[1].check(rs), 'SQL: ранг медленный ' + F(rs, 'rank').lat);

// углубление: наивные решения видны в метриках
const hard = { params: Object.assign({}, deep0.params, { growth: 100 }), choices: deep0.choices };
r = E.analyze(L, ref('deep'), est, hard, 'deep');
assert(r.m.cheat > 0 && r.m.tie > 0 && r.m.lost > 0 && r.m.memOver > 0 && r.m.coupled === 1 && r.m.served < 1, 'deep: проблемы видны');

// эталон под ×100 с решениями книги закрывает все цели
const good = { params: hard.params, choices: { who: 'server', queue: 'kafka', shard: 'fixed', tie: 'time', recover: 'rebuild' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + ' ' + JSON.stringify(A.blockers) + ' ' + JSON.stringify(A.r.warnings.filter((w) => w.lvl !== 'info')));
assert(A.r.nodes.redis.cfg.shards > 1, 'шарды Redis под ×100');
console.log('ok', 'adapt:', A.changes.join('; '));

const alt = (ch, g = A.graph) => E.analyze(L, g, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
// один sorted set: шарды не помогают, память не влезает
const one = alt({ shard: 'one' });
assert(one.m.memOver > 0 && one.m.maxU > 0.9, 'один sorted set не делится');
// хэш по user_id: топ со всех шардов, ранг неточный
const hs = alt({ shard: 'hash' });
assert(hs.m.rankErr > 0 && F(hs, 'top').lat > F(A.r, 'top').lat && hs.nodes.redis.flows.top > A.r.nodes.redis.flows.top, 'хэш: scatter-gather и неточный ранг');
assert(alt({ who: 'client' }).m.cheat > 0 && alt({ tie: 'member' }).m.tie > 0 && alt({ recover: 'snapshot' }).m.lost > 0, 'наивные решения');
assert(alt({ queue: 'direct' }).m.coupled === 1 && F(alt({ queue: 'direct' }), 'score').lat > F(A.r, 'score').lat, 'прямые вызовы тормозят');
// без Kafka на пути очков решение «Kafka» не работает
assert(alt({}, E.analyze(L, ref('base'), est, good, 'deep').graph).m.coupled === 1, 'Kafka выбрана, но её нет');
// без реплики восстановление оставляет рейтинг без ответа
assert(alt({}, withCfg(A.graph, 'redis', { replicas: 0 })).warnings.some((w) => /нет реплики/.test(w.text)), 'без реплики');

// DynamoDB встаёт вместо Redis, ранг только процентилем; Lambda вместо своего сервиса
const dy = E.addBlock(L, A.graph, 'dynamo', [0, 0]), rd = E.analyze(L, dy.graph, est, good, 'deep');
assert(dy.dropped.length === 1 && rd.m.routed && rd.m.rankErr > 0, 'DynamoDB');
const la = E.addBlock(L, ref('base'), 'lambdaSvc', [0, 0]), rl = E.analyze(L, la.graph, est, deep0, 'base');
assert(la.dropped.length === 4 && rl.m.routed && F(rl, 'rank').path.some((x) => rl.nodes[x.id].type === 'lambdaSvc'), 'Lambda ' + la.dropped.length);
console.log('ch10 ok');
