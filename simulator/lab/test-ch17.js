// Проверка главы 17 (сервис инференса LLM): node simulator/lab/test-ch17.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch17/ch17.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// оценка: 2315 запросов в секунду, пик ×3 около 6944, 2,1 млн выходных токенов в секунду, 1786 GPU-серверов
const d = L.derive(est, deep0);
assert(Math.round(d.req) === 2315 && Math.round(d.peakReq) === 6944 && Math.round(d.outPeak) === 2083333 && d.units === 450 && d.gpus === 1786 && d.answerS === 6 && d.histGB === 400, 'оценка ' + JSON.stringify(d));

// стрелки эталона разрешены; мимо шлюза, сервиса чата и роутера нельзя
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'gpu') && !E.canLink(L, 'gateway', 'gpu') && !E.canLink(L, 'chatSvc', 'gpu') && !E.canLink(L, 'client', 'convDB') && !E.canLink(L, 'gateway', 'router'), 'запрещённые стрелки');

// типовая схема выполняет цели; GPU-серверов столько, сколько дала оценка, первый токен это prefill 1500 токенов
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(r.nodes.gpu.rep === d.gpus && F(r, 'chat').lat > 300 && F(r, 'chat').lat < 1000, 'GPU по оценке, первый токен ' + F(r, 'chat').lat);
assert(!E.analyze(L, without(ref('base'), 'router', 'gpu'), est, deep0, 'base').m.routed, 'без GPU-серверов запрос не доходит');

// углубление: наивные решения ломают все цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(L.goals.deep.every((g) => !g.check(r)) && r.m.broken > 0 && r.m.unsafe > 0 && r.m.ctxErr > 0 && r.m.noisy > 0 && F(r, 'chat').lat > 5000, 'deep: проблемы видны');

// типовые решения при пике ×5 закрывают все цели
const good = { params: { peak: 5, growth: 1 }, choices: { batch: 'cont', stream: 'sse', limit: 'tokens', route: 'affinity', scale: 'queue', prio: 'prio', cancel: 'abort', ctx: 'window', fail: 'retry', safe: 'async' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + JSON.stringify(A.blockers));
const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
const G = (x) => x.nodes.gpu.rep, T = (x) => F(x, 'chat').lat;

// батчинг и стриминг
assert(G(alt({ batch: 'static' })) > G(A.r) * 1.9 && alt({ batch: 'one' }).m.maxU > 1 && T(alt({ batch: 'static' })) > T(A.r) + 400, 'батчинг');
assert(T(alt({ stream: 'whole' })) > 6000, 'без стриминга ждём весь ответ');
// кэш префиксов: меньше GPU и быстрее первый токен; round robin хуже наименее загруженной
assert(G(alt({ route: 'least' })) > G(A.r) && T(alt({ route: 'least' })) > T(A.r) * 1.3 && G(alt({ route: 'rr' })) > G(alt({ route: 'least' })), 'маршрутизация по префиксу');
// лимиты, отмена, история
assert(alt({ limit: 'rps' }).m.noisy > 0 && G(alt({ limit: 'rps' })) > G(A.r) * 1.25, 'лимит в запросах');
assert(alt({ cancel: 'finish' }).m.wasted > 0 && G(alt({ cancel: 'finish' })) > G(A.r), 'брошенные ответы');
assert(alt({ ctx: 'full' }).m.ctxErr > 0 && T(alt({ ctx: 'full' })) > T(A.r) * 2 && G(alt({ ctx: 'full' })) > G(A.r), 'вся история');
// всплеск: загрузка GPU даёт отказы, мощность под пик простаивает и стоит дороже
assert(alt({ scale: 'util' }).m.rejected > 0 && alt({ scale: 'peak' }).m.idle > 0.5 && alt({ scale: 'peak' }).m.cost > A.r.m.cost * 1.3, 'автомасштабирование');
assert(T(alt({ prio: 'fifo' })) > T(A.r) + 700 && alt({ fail: 'error' }).m.broken > 0, 'очередь и сбои');
// модерация: синхронная медленнее, без неё нарушения проходят
assert(alt({ safe: 'none' }).m.unsafe > 0 && T(alt({ safe: 'inline' })) > T(A.r) + 200 && alt({ safe: 'inline' }).m.unsafe === 0, 'модерация');
// без нужных блоков решения не работают
assert(E.analyze(L, without(A.graph, 'gateway', 'limits'), est, good, 'deep').m.noisy > 0, 'лимит токенов без блока');
assert(E.analyze(L, without(A.graph, 'chatSvc', 'moder'), est, good, 'deep').m.unsafe > 0, 'модерация без блока');

// эксперименты: малая модель и кэш ответов снимают часть запросов с больших GPU
const sm = E.addBlock(L, A.graph, 'small', [0, 0]), rs = E.analyze(L, sm.graph, est, good, 'deep');
assert(rs.m.routed && G(rs) < G(A.r) * 0.65 && rs.nodes.small.rep > 0, 'малая модель');
const rc = E.analyze(L, E.addBlock(L, A.graph, 'respCache', [0, 0]).graph, est, good, 'deep');
assert(G(rc) < G(A.r) && G(rc) > G(A.r) * 0.9, 'кэш ответов даёт мало');
console.log('ch17 ok');
