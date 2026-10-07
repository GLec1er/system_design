// Быстрая проверка моделей: node simulator/test.js
global.window = global;
const E = require('./engine.js');
require('fs').readdirSync(__dirname + '/scenarios').sort().forEach((f) => require('./scenarios/' + f));
const fmt = (m) => `served ${(m.served * 100).toFixed(0)}% | bottleneck ${m.bottleneck && m.bottleneck.name} (${(m.maxU * 100).toFixed(0)}%) | lat ${Object.entries(m.lat).map(([k, v]) => k + ':' + v.toFixed(0)).join(' ')} | avail ${(m.avail * 100).toFixed(2)}% | $${m.cost.toFixed(0)} | cx ${m.cx.toFixed(1)} | q ${m.quality}`;
SIM_SCENARIOS.forEach((sc) => {
  const inputs = {}; sc.inputs.forEach((i) => (inputs[i.id] = i.value));
  let st = { inputs, replicas: {}, active: {}, auto: true };
  console.log(`\n== ${sc.id} ${sc.title}`);
  console.log('baseline  ', fmt(E.compute(sc, st).m));
  sc.components.forEach((c) => { if (E.canEnable(sc, st, c.id).ok) st = E.toggle(sc, st, c.id); });
  // последовательное включение в порядке списка (с учётом requires)
  const all = {}; sc.components.forEach((c) => (all[c.id] = true));
  let st2 = { inputs, replicas: {}, active: {}, auto: true };
  sc.components.forEach((c) => { st2 = E.toggle(sc, st2, c.id); });
  const r = E.compute(sc, st2);
  console.log('all-on    ', fmt(r.m));
  r.s.warnings.forEach((w) => console.log('   ', w.lvl, w.text));
  const r0 = E.compute(sc, { inputs, replicas: {}, active: {}, auto: false });
  console.log('no-auto   ', fmt(r0.m));
});
