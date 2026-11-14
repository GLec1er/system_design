// Отдаёт папку simulator/ страницам Playwright с адреса http://lab.test/ без настоящего сервера.
// С диска (file://) браузер не грузит ES-модули, поэтому маскот там не оживает; так он проверяется как на сайте.
// Всё, что уходит наружу, не пропускается и попадает в список external: страница обязана работать без сети.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'http://lab.test/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };

async function serve(ctx) {
  const external = [];
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin + '/' !== ORIGIN) { external.push(u.href); return route.abort(); }
    const file = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  return { url: (p) => ORIGIN + p, external };
}
module.exports = { serve, ROOT };
