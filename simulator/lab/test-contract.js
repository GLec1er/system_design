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
  // решения углубления: у каждого варианта есть подпись и пояснение, лучший вариант существует
  L.problems.filter((p) => p.options).forEach((p) => {
    assert(p.options.every((o) => o.label && o.note), `${d}: варианты решения «${p.key}» с подписью и пояснением`);
    (p.best || []).forEach((v) => assert(p.options.some((o) => o.v === v), `${d}: лучший вариант «${v}» есть среди вариантов «${p.key}»`));
  });
});
console.log('contract ok');
