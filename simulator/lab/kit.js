/* Общие мелочи глав: формат чисел в тексте, одинаковые шаги и цели, помощники модели.
   Раньше каждая глава держала свою копию. Подключается перед chN.js; в тестах его подтягивает engine.js. */
(function (root) {
  // Числа в тексте: разряды пробелами, дробь через запятую.
  const num = (v) => Math.round(v).toLocaleString('ru-RU');
  const dec = (v) => String(+v.toFixed(1)).replace('.', ',');
  const big = (v) => (v >= 1e9 ? dec(v / 1e9) + ' млрд' : v >= 1e6 ? dec(v / 1e6) + ' млн' : v >= 1e4 ? num(v / 1e3) + ' тыс.' : v >= 10 ? num(v) : dec(v));

  // Последний шаг и первая цель карты одинаковы во всех главах.
  const STEP_SUM = { id: 'sum', title: 'Итог', sub: 'рассказ для интервью', kind: 'sum', tag: '~5 мин', guide: 'Перескажи решение по шагам и ответь на вопросы для повторения.' };
  const GOAL_LOAD = { text: 'Нагрузка выдерживается', check: (r) => r.m.served >= 1 && r.m.maxU <= 0.9 };
  const REVISIT = 'Решение верно, пока верны требования. Новое FR может поменять NFR, и тогда пересматривается архитектура. Примеры ниже.';
  const API_MORE = 'Для интервью хватает таблиц выше. Ниже то, что добавляют, когда растут требования.';

  // Помощники для model(ctx) и rules(ctx) главы: найти блоки по типу, добавить нагрузку потоку, повесить значок.
  function tools(ctx) {
    const { nodes, flows } = ctx;
    const all = Object.values(nodes), of = (t) => all.filter((n) => n.type === t);
    const F = (id) => flows.find((f) => f.id === id), ok = (id) => F(id).ok;
    const badge = (n, icon, title) => n && n.badges.push({ icon, title });
    const addLoad = (n, fid, x) => { if (!n || !x) return; n.load += x; n.flows[fid] = (n.flows[fid] || 0) + x; if (F(fid).write) n.wload += x; };
    const scale = (n, fid, m) => n && addLoad(n, fid, (n.flows[fid] || 0) * (m - 1));
    const via = (f, t) => f.ok && f.path.some((x) => nodes[x.id].type === t);
    return { all, of, F, ok, badge, addLoad, scale, via };
  }

  const api = { num, dec, big, STEP_SUM, GOAL_LOAD, REVISIT, API_MORE, tools };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LabKit = api;
})(typeof window !== 'undefined' ? window : globalThis);
