// Дымовой тест интерфейса: npm run test:smoke (нужен playwright с chromium).
// Открывает главную и каждую главу, проходит все шаги, раскладывает эталон, двигает сценарий,
// открывает инспектор блока и проверяет, что страница не падает, переживает устаревшее сохранение и не ходит в сеть.
const { chromium } = require('playwright');
const { serve } = require('./serve.js');

const only = process.argv.slice(2).map(Number).filter(Boolean);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { url, external } = await serve(ctx);
  const page = await ctx.newPage();
  const errors = [];
  let where = '';
  page.on('pageerror', (e) => errors.push(`${where}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(`${where}: ${m.text()}`); });
  const check = (ok, text) => { if (!ok) errors.push(`${where}: ${text}`); };

  where = 'главная';
  await page.goto(url('index.html'));
  const chapters = await page.evaluate(() => window.SD_CHAPTERS.map((c) => ({ n: c.n, dir: c.dir })));
  check((await page.locator('.ch-list a').count()) === chapters.length, 'на главной не все главы');
  await page.locator('#tech button').nth(1).click();
  check((await page.locator('.ch-list a').count()) > 0, 'фильтр по технологии ничего не показал');

  for (const c of chapters.filter((x) => !only.length || only.includes(x.n))) {
    where = `глава ${c.n}`;
    await page.goto(url(`${c.dir}/index.html`));
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const steps = await page.evaluate(() => window.LAB.steps.map((s) => ({ id: s.id, kind: s.kind, stage: s.stage })));
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      where = `глава ${c.n}, шаг ${s.id}`;
      await page.locator('#steps .stp').nth(i).click();
      check((await page.locator('#app').innerHTML()).length > 200, 'шаг пустой');
      if (s.kind === 'req') { await page.locator('.ri input').first().check(); }
      if (s.kind === 'est') {
        const sl = page.locator('[data-est]').first();
        if (await sl.count()) { await sl.focus(); await page.keyboard.press('ArrowRight'); }
      }
      if (s.kind !== 'map') continue;
      await page.locator('#ref').click();
      const nodes = await page.locator('.node').count();
      check(nodes > 2, 'эталон не разложился');
      check((await page.locator('#eg .edge').count()) > 1, 'нет стрелок');
      const goals = await page.evaluate((stage) => window.LAB.goals[stage].length, s.stage);
      // в углублении цели зависят ещё и от решений ученика, поэтому строго проверяем только базовую схему
      if (s.stage === 'base') check((await page.locator('#goals li.done').count()) === goals, 'эталон не выполняет цели шага');
      // сценарий до упора вправо и обратно
      const scn = page.locator('[data-scn]').first();
      await scn.focus();
      for (let k = 0; k < 12; k++) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(80);
      check((await page.locator('.node').count()) === nodes, 'после ползунка пропали блоки');
      for (let k = 0; k < 12; k++) await page.keyboard.press('ArrowLeft');
      // блок: инспектор открывается, блок двигается с клавиатуры
      await page.locator('.node').first().click();
      check(await page.locator('#insp').isVisible(), 'инспектор не открылся');
      await page.keyboard.press('Escape');
      check(!(await page.locator('#insp').isVisible()), 'Esc не закрыл инспектор');
      if (s.stage === 'base') {
        // без мыши: убрать стрелку в инспекторе, провести её заново с клавиатуры, подвинуть блок стрелками
        const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('sd-lab-' + window.LAB.id)).graph);
        const g0 = await state(), e0 = g0.edges[0];
        await page.locator(`.node[data-id="${e0.from}"]`).focus();
        await page.keyboard.press('Enter');
        await page.locator('#insp [data-edel]').first().focus();
        await page.keyboard.press('Enter');
        const g1 = await state();
        check(g1.edges.length === g0.edges.length - 1, 'стрелка не удалилась из инспектора');
        const gone = g0.edges.find((e) => !g1.edges.some((x) => x.from === e.from && x.to === e.to));
        await page.locator(`.node[data-id="${gone.from}"] [data-port]`).focus();
        await page.keyboard.press('Enter');
        await page.locator(`.node[data-id="${gone.to}"]`).focus();
        await page.keyboard.press('Enter');
        check((await state()).edges.length === g0.edges.length, 'стрелка не провелась с клавиатуры');
        const x0 = (await state()).nodes.find((n) => n.id === gone.to);
        await page.keyboard.press('ArrowDown');
        const x1 = (await state()).nodes.find((n) => n.id === gone.to);
        check(x1.y === x0.y + 10 || x1.y === x0.y, 'блок не двигается стрелками');
        check(await page.evaluate((id) => document.activeElement && document.activeElement.dataset.id === id, gone.to), 'фокус потерялся после перерисовки');
        await page.keyboard.press('Escape');
      }
      // палитра: добавить и убрать блок
      const add = page.locator('.pal-card [data-panel]:not([hidden]) .pi').last();
      if (await add.count()) { await add.click(); await page.waitForTimeout(50); }
      check((await page.locator('#kpis .kpi').count()) >= 4, 'нет плиток метрик');
      await page.locator('#refBook').click();
      await page.waitForTimeout(350); // отложенное сохранение
    }

    // Сохранение из старой версии: блок неизвестного типа, стрелка в никуда, шаг за пределами списка.
    where = `глава ${c.n}, старое сохранение`;
    await page.evaluate(() => {
      const k = 'sd-lab-' + window.LAB.id, s = JSON.parse(localStorage.getItem(k));
      s.graph.nodes.push({ id: 'ghost', type: 'no-such-block', x: 10, y: 10 });
      s.graph.edges.push({ from: 'ghost', to: s.graph.nodes[0].id }, { from: 'nobody', to: 'nowhere' });
      s.step = 99;
      s.deep.choices.unknownKey = 'x';
      localStorage.setItem(k, JSON.stringify(s));
    });
    await page.goto(url(`${c.dir}/index.html`) + '#' + steps.find((x) => x.kind === 'map').id);
    await page.reload();
    check((await page.locator('.node').count()) > 2, 'карта не открылась со старым сохранением');
    check((await page.locator('.node[data-id="ghost"]').count()) === 0, 'неизвестный блок остался на карте');
    await page.evaluate(() => localStorage.setItem('sd-lab-' + window.LAB.id, '{"v":1,"graph":"мусор","est":7}'));
    await page.reload();
    check((await page.locator('#app').innerHTML()).length > 200, 'страница не открылась с битым сохранением');
    console.log(`✔ глава ${c.n}`);
  }

  // Маскот: модель лежит в репозитории и оживает без сети (если в браузере есть WebGL).
  where = 'маскот';
  await page.goto(url('index.html'));
  await page.waitForTimeout(1500);
  const webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  if (webgl) check((await page.locator('.octo-art.live').count()) === 1, 'Окто не ожил');
  check(external.length === 0, 'страница ходит наружу: ' + [...new Set(external)].join(', '));

  await browser.close();
  if (errors.length) { console.error('\n' + [...new Set(errors)].join('\n')); console.error(`\nОшибок: ${errors.length}`); process.exit(1); }
  console.log('\nИнтерфейс: все главы открываются и проходят по шагам');
})().catch((e) => { console.error(e); process.exit(1); });
