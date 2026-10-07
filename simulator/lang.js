// Кнопка EN/RU для всех страниц. Перевод делает виджет Google Translate.
// ponytail: машинный перевод; ручной словарь, если качество терминов не устроит.
(function () {
  const en = /(^|;\s*)googtrans=\/ru\/en/.test(document.cookie);
  const b = document.createElement('button');
  b.className = 'lang notranslate';
  b.textContent = en ? 'RU' : 'EN';
  b.title = en ? 'Вернуть русский' : 'Translate to English';
  b.onclick = () => {
    const tail = en ? '; expires=Thu, 01 Jan 1970 00:00:00 GMT' : '';
    // виджет может сам поставить куку на домен, поэтому чистим оба варианта
    ['', '; domain=' + location.hostname, '; domain=.' + location.hostname].forEach((d) => (document.cookie = 'googtrans=' + (en ? '' : '/ru/en') + tail + '; path=/' + d));
    location.reload();
  };
  document.body.appendChild(b);
  if (!en) return;
  const box = document.createElement('div');
  box.id = 'gt'; box.hidden = true; document.body.appendChild(box);
  window.gtInit = () => new google.translate.TranslateElement({ pageLanguage: 'ru', includedLanguages: 'en', autoDisplay: false }, 'gt');
  const s = document.createElement('script');
  s.src = 'https://translate.google.com/translate_a/element.js?cb=gtInit';
  s.onerror = () => { b.title = 'Переводчик Google недоступен'; };
  document.head.appendChild(s);
})();
