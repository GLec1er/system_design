// Все проверки движка и глав подряд: npm test (или node simulator/lab/run-tests.js).
// Каждая проверка идёт в своём процессе: главы кладут данные в общий global.LAB.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter((f) => /^test.*\.js$/.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✘'} ${f}`);
  if (!ok) console.log((r.stdout + r.stderr).trim().split('\n').map((l) => '    ' + l).join('\n'));
}
console.log(failed ? `\nУпало проверок: ${failed} из ${files.length}` : `\nВсе ${files.length} проверок прошли`);
process.exit(failed ? 1 : 0);
