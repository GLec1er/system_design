// Список глав-лабораторий и навигация между ними.
// Новая глава = одна строка в CH (по порядку) + папка chN/ с index.html.
(function () {
  const CH = [
    { n: 7, dir: 'ch7', title: 'Hotel Reservation' },
    { n: 8, dir: 'ch8', title: 'Distributed Email Service' },
    { n: 9, dir: 'ch9', title: 'S3-like Object Storage' },
  ];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // Страница главы: <nav data-chnav="7" data-root="../"> → ‹ [список] ›
  document.querySelectorAll('[data-chnav]').forEach((el) => {
    const root = el.dataset.root || '';
    const url = (c) => `${root}${c.dir}/index.html`;
    const i = CH.findIndex((c) => String(c.n) === el.dataset.chnav);
    const arrow = (c, sym, label) => c
      ? `<a class="chnav-arr" href="${url(c)}" title="${label}: глава ${c.n}. ${esc(c.title)}" aria-label="${label}: глава ${c.n}">${sym}</a>`
      : `<span class="chnav-arr" aria-hidden="true">${sym}</span>`;
    el.innerHTML = arrow(CH[i - 1], '‹', 'Назад')
      + `<select aria-label="Перейти к главе">`
      + CH.map((c, k) => `<option value="${url(c)}"${k === i ? ' selected' : ''}>Глава ${c.n} · ${esc(c.title)}</option>`).join('')
      + `<option value="${root}index.html">Главы 1–6 (старый формат)</option></select>`
      + arrow(CH[i + 1], '›', 'Дальше');
    el.querySelector('select').onchange = (e) => (location.href = e.target.value);
  });

  // Главная: <span data-chlinks> → ссылки на все главы-лаборатории
  document.querySelectorAll('[data-chlinks]').forEach((el) => {
    el.innerHTML = CH.map((c) => `<a href="${c.dir}/index.html" style="color:var(--accent)">Глава ${c.n}: ${esc(c.title)} →</a>`).join(' · ');
  });
})();
