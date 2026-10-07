(function () {
  const E = window.SimEngine;
  const SC = window.SIM_SCENARIOS.slice().sort((a, b) => a.n - b.n);
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let sc = null, st = null, selected = null;

  function fmt(n) {
    if (!isFinite(n)) return '∞';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + ' млрд';
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' млн';
    if (a >= 1e4) return (n / 1e3).toFixed(0) + ' тыс';
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + ' тыс';
    if (a >= 100) return n.toFixed(0);
    if (a >= 10) return n.toFixed(1).replace(/\.0$/, '');
    return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }
  const money = (n) => '$' + (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Math.round(n)) + '/мес';
  const ms = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + ' с' : Math.round(n) + ' мс');
  const cls = (u) => (u > 0.9 ? 'bad' : u > 0.7 ? 'warn' : '');

  function downtime(a) {
    const mins = (1 - a) * 365 * 24 * 60;
    if (mins < 1) return '< 1 мин в год';
    if (mins < 120) return '≈ ' + Math.round(mins) + ' мин в год';
    if (mins < 60 * 48) return '≈ ' + (mins / 60).toFixed(1) + ' ч в год';
    return '≈ ' + (mins / 1440).toFixed(1) + ' дн в год';
  }
  function tier(cx) {
    if (cx <= 4) return 'Просто: хватит одного инженера';
    if (cx <= 8) return 'Средне: нужна небольшая команда';
    if (cx <= 13) return 'Сложно: нужны выделенные инженеры и дежурства';
    return 'Очень сложно: платформенная команда и зрелый SRE';
  }

  function init(id) {
    sc = SC.find((x) => x.id === id) || SC[0];
    const inputs = {};
    sc.inputs.forEach((i) => (inputs[i.id] = i.value));
    st = { inputs, replicas: {}, active: {}, auto: true };
    selected = null;
    try { history.replaceState(null, '', '#' + sc.id); } catch (e) {}
    buildShell();
    render();
    renderTabs();
  }

  function renderTabs() {
    $('#tabs').innerHTML = SC.map((s) => `<button class="tab" data-id="${s.id}" aria-current="${s.id === sc.id}">${s.n}. ${esc(s.title)}</button>`).join('');
    document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => init(b.dataset.id)));
  }

  function buildShell() {
    $('#app').innerHTML = `
      <section class="intro">
        <h2>Глава ${sc.n}. ${esc(sc.title)}</h2>
        <p class="sub">${esc(sc.subtitle)}</p>
        <p>${esc(sc.intro)}</p>
        <ul class="try">${sc.tryThis.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </section>
      <div class="grid">
        <div class="col col-l">
          <section class="card"><h3>Нагрузка</h3><div id="inputs"></div>
            <label class="auto"><input type="checkbox" id="auto" checked><span><b>Автомасштаб</b><small>Подбирает число серверов так, чтобы загрузка была ≈ 70%. Так удобно сравнивать архитектуры по цене и сложности.</small></span></label>
          </section>
          <section class="card"><h3>Блоки архитектуры</h3><div class="pal" id="pal"></div></section>
        </div>
        <div class="col col-c"><section class="card"><h3>Путь запроса</h3><div id="pipe"></div></section></div>
        <div class="col col-r">
          <section class="card"><h3>Итог</h3><div id="metrics"></div></section>
          <section class="card"><h3>Цели</h3><ul class="goals" id="goals"></ul></section>
          <section class="card"><h3>Что подсказывает симулятор</h3><div class="warns" id="warns"></div></section>
          <section class="card learn"><h3>Что нужно понимать</h3><div id="learn"></div></section>
        </div>
      </div>`;
    $('#inputs').innerHTML = sc.inputs.map((i) => `
      <div class="slider"><label for="in_${i.id}"><span>${esc(i.label)}</span><output id="out_${i.id}">${i.value} ${esc(i.unit)}</output></label>
      <input type="range" id="in_${i.id}" min="${i.min}" max="${i.max}" step="${i.step}" value="${i.value}"></div>`).join('');
    sc.inputs.forEach((i) => {
      $('#in_' + i.id).oninput = (e) => { st.inputs[i.id] = +e.target.value; $('#out_' + i.id).textContent = fmt(+e.target.value) + ' ' + i.unit; render(); };
    });
    $('#auto').onchange = (e) => { st = Object.assign({}, st, { auto: e.target.checked }); render(); };
  }

  function render() {
    const res = E.compute(sc, st);
    const { s, m } = res;
    const reps = res.replicas || {};
    // пайплайн
    $('#pipe').innerHTML = sc.flows.map((f) => {
      const stages = s.visible.filter((x) => x.flow === f.id);
      if (!stages.length) return '';
      const items = stages.map((x, idx) => stageHtml(x, x === m.bottleneck && m.maxU > 0.7, reps)).join('<span class="arrow">→</span>');
      return `<div class="flow"><h4>${esc(f.label)} <span class="tag">p50 ≈ ${ms(m.lat[f.id])}</span></h4><div class="row">${items}</div></div>`;
    }).join('');
    document.querySelectorAll('[data-rep]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.id, d = +b.dataset.rep;
        const cur = (st.replicas[id] ?? (s.stages[id].replicas));
        st = Object.assign({}, st, { replicas: Object.assign({}, st.replicas, { [id]: Math.max(1, cur + d) }) });
        render();
      };
    });
    // палитра
    const groups = {};
    sc.components.forEach((c) => { const k = c.group || '_' + c.id; (groups[k] = groups[k] || []).push(c); });
    $('#pal').innerHTML = sc.components.map((c) => compHtml(c)).join('');
    document.querySelectorAll('.comp .tg').forEach((b) => (b.onclick = () => { st = E.toggle(sc, st, b.dataset.id); selected = b.dataset.id; render(); }));
    document.querySelectorAll('.comp .nm').forEach((b) => (b.onclick = () => { selected = b.dataset.id; render(); }));
    // метрики
    const util = m.served >= 1 ? m.maxU : 1;
    const servedCls = m.served >= 1 ? (m.maxU > 0.9 ? 'warn' : 'ok') : 'bad';
    const cxPct = Math.min(100, (m.cx / 20) * 100), qPct = m.quality;
    $('#metrics').innerHTML = `<div class="metrics">
      <div class="m"><div class="k">Выдерживаем</div><div class="v ${servedCls}">${Math.round(m.served * 100)}%</div><div class="s">${m.served >= 1 ? 'запас ×' + fmt(m.headroom) : 'не хватает мощности'}</div></div>
      <div class="m"><div class="k">Узкое место</div><div class="v" style="font-size:14px">${m.bottleneck ? esc(m.bottleneck.name) : '—'}</div><div class="s">${m.bottleneck ? Math.round(m.maxU * 100) + '% загрузки' : ''}</div></div>
      <div class="m"><div class="k">Доступность</div><div class="v">${(m.avail * 100).toFixed(m.avail > 0.9999 ? 3 : 2)}%</div><div class="s">${downtime(m.avail)}</div></div>
      <div class="m"><div class="k">Стоимость</div><div class="v">${money(m.cost)}</div><div class="s">железо и сервисы (условно)</div></div>
      <div class="m full"><div class="k">Сложность решения: ${m.cx.toFixed(1)} из 20</div><div class="gauge"><i style="width:${cxPct}%;background:${m.cx > 13 ? 'var(--bad)' : m.cx > 8 ? 'var(--warn)' : 'var(--ok)'}"></i></div><div class="s">${tier(m.cx)}</div></div>
      <div class="m full"><div class="k">${esc(sc.qualityLabel)}: ${Math.round(m.quality)} из 100</div><div class="gauge"><i style="width:${qPct}%"></i></div><div class="s">${esc(sc.qualityHint)}</div></div>
    </div>${st.auto && m.served < 1 ? '<div class="w bad" style="margin-top:10px">Даже с автомасштабом эта архитектура упирается в ограничение (серверов не хватает или добавление серверов не помогает). Смотри подсказки ниже: скорее всего, нужен другой блок.</div>' : ''}`;
    $('#goals').innerHTML = sc.goals.map((g) => { const ok = g.check(m); return `<li><span class="${ok ? 'y' : 'n'}">${ok ? '✔' : '○'}</span><span>${esc(g.text)}</span></li>`; }).join('');
    const order = { bad: 0, warn: 1, info: 2 };
    const ws = s.warnings.slice().sort((a, b) => order[a.lvl] - order[b.lvl]);
    $('#warns').innerHTML = ws.length ? ws.map((w) => `<div class="w ${w.lvl}">${esc(w.text)}</div>`).join('') : '<div class="note">Пока всё спокойно. Измени нагрузку или добавь блок.</div>';
    renderLearn(m);
  }

  function stageHtml(x, hot, reps) {
    const pct = Math.min(100, x.util * 100);
    const rep = x.scalable
      ? `<div class="step"><button data-id="${x.id}" data-rep="-1" ${st.auto || x.follow ? 'disabled' : ''} aria-label="меньше">−</button><span>${x.replicas} ${x.follow ? '(по брокерам)' : st.auto ? 'авто' : 'шт.'}</span><button data-id="${x.id}" data-rep="1" ${st.auto || x.follow ? 'disabled' : ''} aria-label="больше">+</button></div>`
      : '<div class="note">масштабируется внешним сервисом</div>';
    return `<div class="stage ${x.path ? '' : 'async'} ${hot ? 'hot' : ''}">
      <div class="hd"><span class="si">${x.icon}</span><div><div class="sn">${esc(x.name)}${x.path ? '' : '<span class="tag">async</span>'}${hot ? '<span class="tag" style="color:var(--bad);border-color:var(--bad)">узкое место</span>' : ''}</div></div></div>
      ${x.badges.length ? `<div class="badges">${x.badges.map((b) => `<span title="${esc(b.name)}">${b.icon}</span>`).join('')}</div>` : ''}
      <div class="bar"><i class="${cls(x.util)}" style="width:${pct}%"></i></div>
      <div class="nums"><span>${fmt(x.load)} / ${fmt(x.capTotal)} ${esc(x.unit)}</span><span>${Math.round(x.util * 100)}%</span></div>
      ${rep}
      ${x.lat ? `<div class="note">≈ ${ms(x.latEff)}${x.qf > 1.3 ? ' (с очередью)' : ''}</div>` : ''}
      ${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}
    </div>`;
  }

  function compHtml(c) {
    const on = !!st.active[c.id];
    const can = E.canEnable(sc, st, c.id);
    const pv = E.preview(sc, st, c.id);
    const sign = on ? -1 : 1; // показываем эффект действия кнопки
    const chips = [];
    const dCx = pv.after.cx - pv.before.cx, dQ = pv.after.quality - pv.before.quality, dCost = pv.after.cost - pv.before.cost;
    const latB = Math.max(...Object.values(pv.before.lat)), latA = Math.max(...Object.values(pv.after.lat));
    const dServed = pv.after.served - pv.before.served;
    if (Math.abs(dServed) > 0.005) chips.push([`выдерж. ${dServed > 0 ? '+' : ''}${Math.round(dServed * 100)}%`, dServed > 0]);
    if (Math.abs(latA - latB) >= 2) chips.push([`задержка ${latA > latB ? '+' : '−'}${ms(Math.abs(latA - latB))}`, latA < latB]);
    if (Math.abs(dCost) >= 50) chips.push([`цена ${dCost > 0 ? '+' : '−'}${money(Math.abs(dCost)).replace('/мес', '')}`, dCost < 0]);
    if (Math.abs(dCx) >= 0.2) chips.push([`сложность ${dCx > 0 ? '+' : '−'}${Math.abs(dCx).toFixed(1)}`, dCx < 0]);
    if (Math.abs(dQ) >= 1) chips.push([`${sc.qualityLabel.split(' ')[0].toLowerCase()} ${dQ > 0 ? '+' : '−'}${Math.round(Math.abs(dQ))}`, dQ > 0]);
    return `<div class="comp" data-on="${on}" data-sel="${selected === c.id}">
      <span class="ic">${c.icon}</span>
      <button class="nm" data-id="${c.id}">${esc(c.name)}</button>
      <button class="tg" data-id="${c.id}" ${!on && !can.ok ? 'disabled' : ''}>${on ? 'Убрать' : 'Добавить'}</button>
      <div class="chips"><span class="note">${on ? 'если убрать:' : 'если добавить:'}</span>${chips.map(([t, good]) => `<span class="chip ${good ? 'good' : 'bad'}">${esc(t)}</span>`).join('') || '<span class="chip">без видимого эффекта</span>'}</div>
      ${!on && !can.ok ? `<div class="req">сначала добавь: ${esc(can.missing.join(', '))}</div>` : ''}
      ${c.group ? '' : ''}
    </div>`;
  }

  function renderLearn(m) {
    const c = sc.components.find((x) => x.id === selected);
    if (!c) {
      $('#learn').innerHTML = '<p class="empty">Нажми на название блока слева, чтобы увидеть, что это такое, что нужно понимать перед добавлением и чем придётся заплатить.</p>';
      return;
    }
    const L = c.learn, li = (a) => (a && a.length ? '<ul>' + a.map((t) => `<li>${esc(t)}</li>`).join('') + '</ul>' : '<p class="empty">Нет ярко выраженных.</p>');
    $('#learn').innerHTML = `<h3 style="margin:0 0 6px;font-size:16px;text-transform:none;letter-spacing:0;color:var(--ink)">${c.icon} ${esc(c.name)}</h3>
      <div class="meta"><span class="chip">вклад в сложность +${c.cx}</span>${c.cost ? `<span class="chip">+${money(c.cost)}</span>` : ''}${c.group ? '<span class="chip">взаимоисключающий выбор</span>' : ''}</div>
      <h5>Что это</h5><p>${esc(L.what)}</p>
      <h5>Зачем (какую проблему решает)</h5><p>${esc(L.why)}</p>
      <h5>Что нужно понимать, чтобы добавить</h5>${li(L.must)}
      <h5>Чем придётся заплатить</h5>${li(L.risks)}`;
  }

  const start = (location.hash || '').slice(1);
  init(SC.some((x) => x.id === start) ? start : SC[0].id);
})();
