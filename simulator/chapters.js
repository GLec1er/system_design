// Общая оболочка всех страниц: боковая полоса, шапка, тема, язык и список глав.
// Подключается сразу после <header data-shell="7" data-root="../">, чтобы тема встала до отрисовки страницы.
// Новая глава = одна строка в CH (по порядку) + папка chN/ с index.html.
(function () {
  const CH = [
    { n: 1, dir: 'ch1', title: 'Proximity Service', about: 'Поиск мест рядом, как Yelp: 5000 поисков в секунду, geohash или quadtree, кэш по ячейкам.' },
    { n: 2, dir: 'ch2', title: 'Nearby Friends', about: 'Друзья рядом в реальном времени: 334 тысячи обновлений в секунду, WebSocket и Pub/Sub на каждого пользователя.' },
    { n: 3, dir: 'ch3', title: 'Google Maps', about: 'Карты и навигация: миллиард пользователей, тайлы через CDN, граф дорог по тайлам, пробки через Kafka.' },
    { n: 4, dir: 'ch4', title: 'Distributed Message Queue', about: 'Своя Kafka: партиции, лог на диске, pull, группы потребителей, репликация и ISR.' },
    { n: 5, dir: 'ch5', title: 'Metrics Monitoring', about: 'Мониторинг метрик и алерты: 10 млн рядов, pull или push, TSDB со сжатием и downsampling.' },
    { n: 6, dir: 'ch6', title: 'Ad Click Aggregation', about: 'Клики по рекламе: миллиард в день, потоковая агрегация, event time и watermark, exactly-once.' },
    { n: 7, dir: 'ch7', title: 'Hotel Reservation', about: 'Бронирование отелей: нельзя продать один номер дважды. Инвентарь по типу и дате, идемпотентность, транзакции.' },
    { n: 8, dir: 'ch8', title: 'Distributed Email Service', about: 'Почта масштаба Gmail: миллиард ящиков, SMTP на входе и выходе, сотни петабайт писем и вложений в год.' },
    { n: 9, dir: 'ch9', title: 'S3-like Object Storage', about: 'Объектное хранилище в стиле S3: 100 ПБ в год, шесть девяток надёжности, метаданные отдельно от байтов.' },
  ];
  window.SD_CHAPTERS = CH;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  // ---------- тема: системная, светлая или тёмная ----------
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const theme = () => get('sd-theme', 'system');
  const applyTheme = () => { const p = theme(); document.documentElement.dataset.theme = p === 'system' ? (mq.matches ? 'dark' : 'light') : p; };
  applyTheme();
  mq.addEventListener('change', applyTheme);
  // Маскота можно спрятать и вернуть в меню оформления.
  const octo = () => get('sd-octo', '1') === '1';
  const motion = () => get('sd-octo-motion', '1') === '1';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.dataset.octo = octo() ? 'on' : 'off';

  const el = document.querySelector('[data-shell]');
  if (!el) return;
  const root = el.dataset.root || '';
  const cur = el.dataset.shell; // номер главы или '' на главной
  const url = (c) => `${root}${c.dir}/index.html`;
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>',
    github: '<path d="M9 19c-4 1-4-2-6-2m12 5v-4c0-1 .1-1.7-.5-2.3 3.3-.4 6.5-1.6 6.5-7A5.5 5.5 0 0 0 19.5 5c.2-1 .1-2-.3-3-1.3 0-2.7.6-3.7 1.4a13 13 0 0 0-7 0A7 7 0 0 0 4.8 2a6 6 0 0 0-.3 3A5.5 5.5 0 0 0 3 8.7c0 5.4 3.2 6.6 6.5 7C9 16.3 9 17 9 18v4"/>',
    system: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    dark: '<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/>',
  };
  const REPO = 'https://github.com/GLec1er/system_design';
  const en = /(^|;\s*)googtrans=\/ru\/en/.test(document.cookie);
  const THEMES = { system: 'Системная', light: 'Светлая', dark: 'Тёмная' };

  el.className = 'shell';
  el.innerHTML = `
    <aside class="rail" aria-label="Разделы">
      <a class="rail-brand" href="${root}index.html" aria-label="System Design Lab"><img src="${root}img/brand-mark.svg" width="46" height="46" alt=""></a>
      <nav aria-label="Главы">
        <a href="${root}index.html" title="Все главы" aria-label="Все главы"${cur ? '' : ' aria-current="page"'}>${ic(I.home)}</a>
        ${CH.map((c) => `<a href="${url(c)}" class="rail-ch" title="Глава ${c.n}. ${esc(c.title)}" aria-label="Глава ${c.n}"${String(c.n) === cur ? ' aria-current="page"' : ''}>${String(c.n).padStart(2, '0')}</a>`).join('')}
      </nav>
      <a class="rail-source" href="${REPO}" target="_blank" rel="noreferrer" title="GitHub" aria-label="Репозиторий GitHub">${ic(I.github)}</a>
    </aside>
    <div class="topbar">
      <a class="brand" href="${root}index.html" aria-label="System Design Lab: все главы"><img class="brand-mark" src="${root}img/brand-mark.svg" width="30" height="30" alt=""><span class="brand-word">System Design <b>Lab</b></span></a>
      ${cur ? `<span class="crumb" id="chapter"></span>
      <nav class="chtabs" aria-label="Главы">${CH.map((c) => `<a href="${url(c)}" title="Глава ${c.n}. ${esc(c.title)}"${String(c.n) === cur ? ' aria-current="page"' : ''}>${String(c.n).padStart(2, '0')}</a>`).join('')}</nav>` : ''}
      <div class="topbar-right">
        <div class="lang-seg notranslate" role="group" aria-label="Язык"><button data-lang="en" aria-pressed="${en}">EN</button><button data-lang="ru" aria-pressed="${!en}">RU</button></div>
        <div class="appearance">
          <button class="appearance-btn" aria-expanded="false" aria-haspopup="dialog" aria-label="Оформление">${ic(I[theme()])}<span>Оформление</span><small aria-hidden="true">⌄</small></button>
          <div class="appearance-panel" role="dialog" aria-label="Оформление" hidden>
            <span class="eyebrow">ОФОРМЛЕНИЕ</span>
            <div class="theme-options">${Object.keys(THEMES).map((t) => `<label><input type="radio" name="sd-theme" value="${t}"${t === theme() ? ' checked' : ''}>${ic(I[t])}<span>${THEMES[t]}</span></label>`).join('')}</div>
            <label class="octo-pref"><input type="checkbox"${octo() ? ' checked' : ''}><span>Показывать Окто</span></label>
            <label class="octo-pref anim"><input type="checkbox"${motion() ? ' checked' : ''}><span>Анимировать Окто</span></label>
            ${reduced ? '<p class="octo-note">В системе включено уменьшение движения, Окто стоит на месте.</p>' : ''}
          </div>
        </div>
        <a class="github-link" href="${REPO}" target="_blank" rel="noreferrer" aria-label="Репозиторий GitHub">${ic(I.github)}</a>
      </div>
    </div>`;

  // Оформление: выпадающая панель с темой и маскотом.
  const btn = el.querySelector('.appearance-btn'), panel = el.querySelector('.appearance-panel');
  const open = (v) => { panel.hidden = !v; btn.setAttribute('aria-expanded', v); };
  btn.onclick = () => open(panel.hidden);
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.appearance')) open(false); });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { open(false); btn.focus(); } });
  panel.querySelectorAll('[name="sd-theme"]').forEach((r) => (r.onchange = () => {
    set('sd-theme', r.value); applyTheme(); btn.querySelector('svg').outerHTML = ic(I[r.value]);
  }));
  panel.querySelector('.octo-pref input').onchange = (e) => window.SD_OCTO(e.target.checked);
  panel.querySelector('.octo-pref.anim input').onchange = (e) => { set('sd-octo-motion', e.target.checked ? '1' : '0'); octoLive(); };
  window.SD_OCTO = (on) => {
    set('sd-octo', on ? '1' : '0');
    document.documentElement.dataset.octo = on ? 'on' : 'off';
    panel.querySelector('.octo-pref input').checked = on;
    octoLive();
  };

  // Язык: перевод на английский делает виджет Google Translate.
  // ponytail: машинный перевод; ручной словарь, если качество терминов не устроит.
  el.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => {
    const toEn = b.dataset.lang === 'en';
    if (toEn === en) return;
    const tail = toEn ? '' : '; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    // виджет может сам поставить куку на домен, поэтому чистим оба варианта
    ['', '; domain=' + location.hostname, '; domain=.' + location.hostname].forEach((d) => (document.cookie = 'googtrans=' + (toEn ? '/ru/en' : '') + tail + '; path=/' + d));
    location.reload();
  }));
  if (en) {
    const box = document.createElement('div');
    box.id = 'gt'; box.hidden = true; document.body.appendChild(box);
    window.gtInit = () => new google.translate.TranslateElement({ pageLanguage: 'ru', includedLanguages: 'en', autoDisplay: false }, 'gt');
    const s = document.createElement('script');
    s.src = 'https://translate.google.com/translate_a/element.js?cb=gtInit';
    document.head.appendChild(s);
  }

  // Маскот Окто: статичный кадр img/octo.png, а поверх него живая 3D-модель из octo3d.js (three.js с CDN).
  // Модель грузится, только когда Окто виден и анимация разрешена; без WebGL или сети остаётся картинка.
  window.SD_octoHTML = (caption) => {
    setTimeout(octoLive);
    return `<aside class="octo"><div class="octo-art"><img src="${root}img/octo.png" width="240" height="224" alt="Окто, робот-осьминог"><canvas aria-hidden="true"></canvas></div><div class="octo-cap"><span>ОКТО${caption ? ` <i>/</i> ${esc(caption)}` : ''}</span><button type="button" onclick="SD_OCTO(false)" aria-label="Спрятать Окто" title="Спрятать Окто · вернуть в оформлении">×</button></div></aside>`;
  };
  let mod = null;
  function octoLive() {
    const on = octo() && motion() && !reduced;
    document.querySelectorAll('.octo-art').forEach((host) => {
      if (!on) { if (host.octo) { host.octo.stop(); host.octo = null; } return; }
      if (host.octo || host.dataset.loading) return;
      host.dataset.loading = '1';
      (mod = mod || import(new URL('octo3d.js', document.querySelector('script[src$="chapters.js"]').src).href))
        .then((m) => { if (octo() && motion() && host.isConnected) host.octo = m.mount(host); })
        .catch(() => {}) // нет WebGL или CDN: остаётся картинка
        .finally(() => delete host.dataset.loading);
    });
  }
  // Смена шага: Окто поднимает щупальца.
  window.SD_octoCheer = () => document.querySelectorAll('.octo-art').forEach((h) => h.octo && h.octo.cheer());
})();
