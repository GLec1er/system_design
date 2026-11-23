// Проверка главы 19 (RAG): node simulator/lab/test-ch19.js
const assert = require('assert');
global.window = global;
const E = require('./engine.js');
require('../ch19/ch19.js');
const L = global.LAB;
const est = {}; L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
const deep0 = { params: {}, choices: {} };
L.problems.forEach((p) => { if (p.options) deep0.choices[p.key] = p.options[0].v; });
L.scenario.forEach((x) => (deep0.params[x.id] = x.value));
const ref = (k) => E.refGraph(L, k), F = (r, id) => r.flows.find((f) => f.id === id);
const without = (g, a, b) => ({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === a && e.to === b)) });

// оценка: 579 вопросов в секунду, пик 1736, 1,6 млрд фрагментов, 2,4 ТБ индекса, 370 фрагментов в секунду, 546 GPU
const d = L.derive(est, deep0);
assert(Math.round(d.q) === 579 && Math.round(d.peakQ) === 1736 && d.nChunks === 1.6e9 && d.indexGB === 2400 && Math.round(d.chunkRate) === 370 && d.promptTok === 2500 && d.gpus === 546, 'оценка ' + JSON.stringify(d));

// стрелки эталона разрешены; мимо шлюза, сервиса ответов, поиска и Kafka нельзя
['base', 'deep'].forEach((k) => ref(k).edges.forEach((e) => {
  const t = (id) => ref(k).nodes.find((n) => n.id === id).type;
  assert(E.canLink(L, t(e.from), t(e.to)), `${k}: стрелка ${e.from} → ${e.to} разрешена`);
}));
assert(!E.canLink(L, 'client', 'llm') && !E.canLink(L, 'ragSvc', 'vecIdx') && !E.canLink(L, 'connector', 'ingest') && !E.canLink(L, 'api', 'retriever'), 'запрещённые стрелки');

// типовая схема выполняет цели; узлы индекса считаются по объёму, GPU по токенам
let r = E.analyze(L, ref('base'), est, deep0, 'base');
assert(L.goals.base.every((g) => g.check(r)), 'base: цели ' + JSON.stringify(L.goals.base.map((g) => g.check(r))));
assert(r.nodes.vecIdx.rep === 76 && r.nodes.llm.rep === d.gpus && F(r, 'ask').lat < 2000, 'индекс по объёму, GPU по оценке');
assert(!E.analyze(L, without(ref('base'), 'ingest', 'vecIdx'), est, deep0, 'base').m.routed, 'без записи в индекс индексация не доходит');

// углубление: наивные решения ломают все цели
r = E.analyze(L, ref('deep'), est, deep0, 'deep');
assert(L.goals.deep.every((g) => !g.check(r)) && r.m.leaks > 0 && r.m.unsafe > 0 && r.m.halluc > 0 && r.m.staleH === 24, 'deep: проблемы видны');

// типовые решения при пике ×5 закрывают все цели
const good = { params: { peak: 5, growth: 1 }, choices: { chunk: 'struct', search: 'hybrid', rerank: 'cross', k: 'few', acl: 'pre', fresh: 'events', ground: 'cite', inject: 'data', eval: 'golden' } };
const A = E.adapt(L, 'deep', est, good);
assert(A.ok && L.goals.deep.every((g) => g.check(A.r)), 'deep: все цели ' + JSON.stringify(L.goals.deep.map((g) => g.check(A.r))) + JSON.stringify(A.blockers));
const alt = (ch) => E.analyze(L, A.graph, est, { params: good.params, choices: Object.assign({}, good.choices, ch) }, 'deep');
const T = (x) => F(x, 'ask').lat, G = (x) => x.nodes.llm.rep;

// нарезка и размер контекста: длинный промпт ломает первый токен и требует в разы больше GPU
assert(alt({ chunk: 'doc' }).m.lossQ === 25 && T(alt({ chunk: 'doc' })) > 3000 && G(alt({ chunk: 'doc' })) > G(A.r) * 3, 'документ целиком');
assert(alt({ k: 'many' }).m.lossQ === 5 && T(alt({ k: 'many' })) > 2000 && G(alt({ k: 'many' })) > G(A.r) * 2, 'двадцать фрагментов');
// поиск и переранжирование
assert(alt({ search: 'vec' }).m.lossQ === 12 && alt({ search: 'bm25' }).m.lossQ === 15 && alt({ chunk: 'fixed' }).m.lossQ === 8, 'поиск и нарезка');
assert(alt({ rerank: 'none' }).m.lossQ === 8 && T(alt({ rerank: 'none' })) < T(A.r) - 50, 'переранжирование стоит времени');
// права, свежесть, ответ, инъекции, оценка
assert(alt({ acl: 'none' }).m.leaks > 0 && alt({ acl: 'post' }).m.lossQ === 10 && alt({ acl: 'post' }).m.leaks === 0, 'права');
assert(alt({ fresh: 'nightly' }).m.staleH === 24 && alt({ fresh: 'nightly' }).nodes.ingest.rep > A.r.nodes.ingest.rep * 20, 'ночная переиндексация');
assert(alt({ ground: 'free' }).m.halluc > 0 && alt({ inject: 'trust' }).m.unsafe > 0 && alt({ eval: 'none' }).m.lossQ === 5, 'ответ, инъекции, оценка');
// без нужных блоков решения не работают
assert(E.analyze(L, without(A.graph, 'retriever', 'kwIdx'), est, good, 'deep').m.lossQ === 12, 'гибрид без полнотекстового индекса');
assert(E.analyze(L, without(A.graph, 'ragSvc', 'reranker'), est, good, 'deep').m.lossQ === 8, 'переранжирование без блока');

// эксперимент: кэш ответов снимает часть нагрузки с модели
const rc = E.analyze(L, E.addBlock(L, A.graph, 'semCache', [0, 0]).graph, est, good, 'deep');
assert(rc.m.routed && G(rc) < G(A.r) * 0.9, 'кэш ответов');
console.log('ch19 ok');
