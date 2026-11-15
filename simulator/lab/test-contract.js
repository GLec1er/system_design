// Каждая глава задаёт все поля, на которые опирается общий код: node simulator/lab/test-contract.js
// Общий код не подставляет умолчаний, поэтому пропущенное поле ловим здесь, а не на странице.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.window = global;
const E = require('./engine.js');
const root = path.join(__dirname, '..');
const dirs = fs.readdirSync(root).filter((d) => /^ch\d+$/.test(d)).sort((a, b) => a.slice(2) - b.slice(2));
assert(dirs.length >= 13, 'главы на месте');
const shell = fs.readFileSync(path.join(root, 'chapters.js'), 'utf8');
dirs.forEach((d) => {
  delete global.LAB;
  require(path.join(root, d, d + '.js'));
  const L = global.LAB, miss = E.contract(L);
  assert.deepStrictEqual(miss, [], `${d}: не хватает ${miss.join('; ')}`);
  assert.strictEqual(L.id, d, `${d}: id главы совпадает с папкой`);
  assert(new RegExp(`dir: '${d}'`).test(shell), `${d}: есть в списке глав chapters.js`);
  const html = fs.readFileSync(path.join(root, d, 'index.html'), 'utf8');
  assert(html.includes(`data-shell="${L.n}"`) && html.includes(`src="${d}.js"`), `${d}: index.html подключает свою главу`);
  // схема из книги с решениями из книги держит нагрузку по умолчанию без подгонки: иначе «📘 Оригинал» на карте
  // сразу перегружен, а «✨ Эталон» называет себя адаптацией ещё до того, как ученик тронул сценарий
  const est = {}, params = {};
  L.estimate.inputs.forEach((i) => (est[i.id] = i.value));
  L.problems.forEach((p) => (p.params || []).forEach((x) => (params[x.id] = x.value)));
  L.scenario.forEach((x) => (params[x.id] = x.value));
  const choices = Object.fromEntries(L.problems.filter((p) => p.options).map((p) => [p.key, (p.best || [p.options[0].v])[0]]));
  Object.keys(L.reference).forEach((stage) => {
    const A = E.adapt(L, stage, est, { params, choices });
    assert(A.original && A.ok, `${d}: эталон ${stage} держит нагрузку по умолчанию без изменений (${A.changes.join('; ')})`);
    // размеры в эталоне выбраны из тех, что можно выставить в настройках блока
    Object.entries(L.reference[stage].cfg || {}).forEach(([id, cfg]) => {
      const node = L.reference[stage].nodes.map((x) => [].concat(x)).find((x) => (x[1] || x[0]) === id), def = node && L.blocks[node[0]];
      assert(def && def.tune, `${d}: настройки эталона ${stage} заданы блоку ${id}, которого нет или у которого нет настроек`);
      Object.entries(cfg).forEach(([k, v]) => {
        const f = E.TUNE[def.tune].find((x) => x.id === k);
        assert(f, `${d}: у блока ${id} нет настройки ${k}`);
        const opts = E.optsOf(f, def).map((o) => (typeof o === 'object' ? o.v : o));
        assert(opts.includes(v), `${d}: эталон ${stage} ставит ${id}.${k} = ${v}, а в настройках есть только ${opts.join(', ')}`);
      });
    });
  });
  // цели углубления достижимы схемой из книги хотя бы при одном сценарии
  const combos = L.scenario.reduce((acc, x) => acc.flatMap((c) => x.stops.map((v) => Object.assign({}, c, { [x.id]: v }))), [{}]);
  assert(combos.some((c) => { const r = E.adapt(L, 'deep', est, { params: Object.assign({}, params, c), choices }).r; return L.goals.deep.every((g) => g.check(r)); }), `${d}: все цели углубления достижимы эталоном`);
  // решения углубления: у каждого варианта есть подпись и пояснение, лучший вариант существует
  L.problems.filter((p) => p.options).forEach((p) => {
    assert(p.options.every((o) => o.label && o.note), `${d}: варианты решения «${p.key}» с подписью и пояснением`);
    (p.best || []).forEach((v) => assert(p.options.some((o) => o.v === v), `${d}: лучший вариант «${v}» есть среди вариантов «${p.key}»`));
  });
});
// страницы глав собраны из одного шаблона и не разошлись с ним
const stale = require('./make-pages.js').sync(false);
assert.deepStrictEqual(stale, [], `страницы отличаются от шаблона: ${stale.join(', ')}. Запусти npm run pages`);
console.log('contract ok');
