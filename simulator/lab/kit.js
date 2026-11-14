/* Общие мелочи глав: формат чисел в тексте, одинаковые шаги и цели, помощники модели.
   Раньше каждая глава держала свою копию. Подключается перед chN.js; в тестах его подтягивает engine.js. */
(function (root) {
  // Числа в тексте: разряды пробелами, дробь через запятую.
  const num = (v) => Math.round(v).toLocaleString('ru-RU');
  const dec = (v) => String(+v.toFixed(1)).replace('.', ',');
  const big = (v) => (v >= 1e9 ? dec(v / 1e9) + ' млрд' : v >= 1e6 ? dec(v / 1e6) + ' млн' : v >= 1e4 ? num(v / 1e3) + ' тыс.' : v >= 10 ? num(v) : dec(v));

  // «в 2 раза», «в 2,5 раза», «в 5 раз», «в 22 раза», «в 3 млн раз»: слово подбирается по уже отформатированному числу.
  const times = (text) => {
    const t = String(text), k = parseInt(t.replace(/\s/g, '').match(/\d+$/) || ['5'], 10);
    const word = /[а-яё.]$/i.test(t) ? 'раз' : /[,.]\d+$/.test(t) ? 'раза' : k % 10 >= 2 && k % 10 <= 4 && (k % 100 < 12 || k % 100 > 14) ? 'раза' : 'раз';
    return `${t} ${word}`;
  };

  // Слово по числу: plural('192', 'партиция', 'партиции', 'партиций') → «192 партиции». Число уже отформатировано;
  // после «тыс.», «млн» и дробей идёт форма для многих («1,5 млн серверов»).
  const plural = (text, one, few, many) => {
    const t = String(text);
    if (/[а-яё.]$/i.test(t) || /[,.]\d+$/.test(t)) return `${t} ${/[,.]\d+$/.test(t) && !/[а-яё]/i.test(t) ? few : many}`;
    const k = parseInt(t.replace(/\s/g, '').match(/\d+$/) || ['5'], 10), d = k % 10, h = k % 100;
    return `${t} ${d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many}`;
  };

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

  const api = { num, dec, big, times, plural, STEP_SUM, GOAL_LOAD, REVISIT, API_MORE, tools };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LabKit = api;
})(typeof window !== 'undefined' ? window : globalThis);
