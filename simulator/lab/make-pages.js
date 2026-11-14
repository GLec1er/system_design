// Страницы глав chN/index.html собираются из одного шаблона: npm run pages.
// Сайт работает без сборки, поэтому готовые страницы лежат в репозитории, а test-contract.js проверяет,
// что они совпадают с шаблоном. Правишь страницу главы — правь шаблон здесь и запускай npm run pages.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = 'https://github.com/GLec1er/system_design';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Список глав живёт в chapters.js, который рассчитан на браузер: даём ему ровно столько окружения, сколько он трогает.
function chapters() {
  const g = globalThis, saved = { window: g.window, document: g.document, matchMedia: g.matchMedia, localStorage: g.localStorage };
  g.window = g;
  g.matchMedia = () => ({ matches: false, addEventListener() {} });
  g.document = { documentElement: { dataset: {} }, querySelector: () => null, cookie: '' };
  g.localStorage = { getItem: () => null, setItem() {} };
  delete require.cache[require.resolve('../chapters.js')];
  require('../chapters.js');
  const list = g.SD_CHAPTERS;
  Object.assign(g, saved);
  return list;
}
// Папка конспекта по номеру главы: chapters/07-hotel-reservation.
function notesDir(n) {
  const dir = fs.readdirSync(path.join(ROOT, '..', 'chapters')).find((d) => parseInt(d, 10) === n);
  if (!dir) throw new Error(`нет конспекта для главы ${n} в chapters/`);
  return dir;
}

function page(c) {
  const notes = notesDir(c.n);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Глава ${c.n}. ${esc(c.title)}</title>
<meta name="description" content="${esc(c.about)}">
<link rel="icon" type="image/svg+xml" href="../img/brand-mark.svg">
<link rel="stylesheet" href="../style.css">
<link rel="stylesheet" href="../lab/lab.css">
</head>
<body class="lab">
<header data-shell="${c.n}" data-root="../"></header>
<script src="../chapters.js"></script>
<main class="wrap">
  <section id="hero" class="hero"></section>
  <nav id="steps" class="stepper" aria-label="Шаги проектирования"></nav>
  <div id="app"></div>
</main>
<footer class="wrap foot">Учебная модель: цифры правдоподобные, но не измерения. Прогресс хранится только в этом браузере. Конспект главы: <a href="${REPO}/blob/main/chapters/${notes}/README.md">chapters/${notes}</a>.</footer>
<script src="../lab/engine.js"></script>
<script src="../lab/kit.js"></script>
<script src="../lab/logos.js"></script>
<script src="${c.dir}.js"></script>
<script src="../lab/lab.js"></script>
</body>
</html>
`;
}

// Возвращает главы, чья страница отличается от шаблона; с write = true переписывает их.
function sync(write) {
  return chapters().filter((c) => {
    const file = path.join(ROOT, c.dir, 'index.html'), want = page(c);
    const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === want;
    if (!same && write) fs.writeFileSync(file, want);
    return !same;
  }).map((c) => c.dir);
}

module.exports = { sync, page };
if (require.main === module) {
  const check = process.argv.includes('--check'), changed = sync(!check);
  if (check && changed.length) { console.error(`Страницы отличаются от шаблона: ${changed.join(', ')}. Запусти npm run pages.`); process.exit(1); }
  console.log(changed.length ? `Обновлены страницы: ${changed.join(', ')}` : 'Страницы глав совпадают с шаблоном');
}
