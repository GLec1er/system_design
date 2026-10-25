/* Глава 11. Payment System: данные для лаборатории (simulator/lab). */
(function (g) {
  // Числа в тексте: разряды пробелами, дробь через запятую.
  const num = (v) => Math.round(v).toLocaleString('ru-RU'), dec = (v) => String(+v.toFixed(1)).replace('.', ',');
  const big = (v) => (v >= 1e9 ? dec(v / 1e9) + ' млрд' : v >= 1e6 ? dec(v / 1e6) + ' млн' : v >= 1e4 ? num(v / 1e3) + ' тыс.' : v >= 10 ? num(v) : dec(v));
  const TIMEOUT = 0.002; // допущение: доля вызовов PSP, которые обрываются по таймауту
  const DOUBLE = 0.0005; // допущение: доля платежей, где покупатель жмёт «Оплатить» дважды
  const MISMATCH = 0.0001; // допущение: доля платежей, где PSP и мы расходимся (ошибка PSP, банка или наша)
  const BUG = 0.00002; // допущение: доля изменений баланса, которые ошибочны и без проводок не находятся
  const PEND = 0.05, PEND_MS = 20000; // допущение: 5% платежей PSP подтверждает не сразу (3-D Secure, банк), в среднем 20 с
  const EXEC = ['executor', 'temporal'], DB = ['payDB', 'crdb'];

  const FLOW_MORE = [
    { title: '💳 Путь платежа', items: [
      ['Payment event', 'Покупатель оформил заказ: одно событие оплаты (checkout_id), внутри один или несколько payment order, по одному на продавца.'],
      ['Payment service', 'Сохраняет событие и заказы в БД со статусом NOT_STARTED, проверяет риски и по каждому заказу зовёт Payment executor.'],
      ['Payment executor', 'Отправляет заказ в PSP и ведёт статус: EXECUTING, SUCCESS, FAILED.'],
      ['PSP', 'Stripe, Adyen, Braintree: говорит с сетями карт (Visa, Mastercard) и банками. Номера карт хранит PSP, а не мы.'],
      ['После успеха', 'Wallet увеличивает баланс продавца, Ledger пишет проводку. Деньги продавцу уходят отдельным pay-out через сервис выплат.'],
    ] },
    { title: '🧾 Hosted payment page', items: [
      ['Регистрация', 'Payment service регистрирует платёж в PSP с ключом идемпотентности (UUID заказа) и получает токен.'],
      ['Форма карты', 'Клиент показывает страницу или виджет PSP с этим токеном. Номер карты уходит сразу в PSP, мимо наших серверов: PCI DSS почти не касается нас.'],
      ['Результат', 'PSP перенаправляет клиента на redirect URL и вызывает наш webhook со статусом.'],
    ] },
  ];
  const EXACT_MORE = [
    { title: '🔁 Exactly-once = повтор + идемпотентность', items: [
      ['At-least-once', 'Ответа нет: повторяем. Стратегии книги: сразу, с фиксированным интервалом, с растущим, экспоненциальная задержка, отмена.'],
      ['At-most-once', 'Повтор не должен списать второй раз: заголовок Idempotency-Key, в БД уникальный ключ. Второй INSERT падает, отдаём сохранённый ответ.'],
      ['К PSP', 'Тот же ключ (nonce) уходит в PSP: если первый вызов дошёл, PSP вернёт его результат, а не спишет снова.'],
      ['Очереди', 'Временная ошибка → очередь повторов с задержкой. Исчерпали попытки → dead letter queue, разбирает человек.'],
    ] },
    { title: '🧪 Расширения (не из книги)', items: [
      ['Transactional outbox', 'Событие пишется в таблицу outbox в той же транзакции, что и статус платежа, а отдельный процесс (или CDC, Debezium) публикует его в Kafka. Нет «записали в БД, но не в Kafka».'],
      ['Durable workflow', 'Temporal или AWS Step Functions держат состояние платежа, таймеры и повторы сами: код исполнителя пишется как обычная функция.'],
      ['Второй PSP', 'Маршрутизация между двумя PSP: при сбое одного платежи идут во второй, заодно выбор по цене и проценту одобрений.'],
    ] },
  ];
  const LEDGER_MORE = [
    { title: '📒 Двойная запись', items: [
      ['Правило', 'Каждая операция это две проводки на одну сумму: дебет одного счёта и кредит другого. Сумма всех проводок всегда 0.'],
      ['Пример', 'Покупатель платит $1: buyer дебет $1, seller кредит $1. Ошибка видна сразу: сумма не сходится.'],
      ['Только добавление', 'Проводки не меняются и не удаляются: ошибку исправляют новой проводкой. Так любой баланс объясним по истории.'],
    ] },
    { title: '🔍 Сверка (reconciliation)', items: [
      ['Файл расчётов', 'PSP и банки раз в день присылают settlement file: все операции и комиссии за сутки.'],
      ['Сравнение', 'Сверка сравнивает файл с ledger и статусами в БД, а wallet с ledger.'],
      ['Расхождения', 'Классифицируемые и исправимые автоматически; классифицируемые, но исправляет финансовая команда по очереди задач; неклассифицируемые, разбирают вручную.'],
    ] },
  ];

  const CORE = ['Покупатель (клиент)', 'Payment service', 'Payment executor', 'PSP (Stripe, Adyen)', 'Payment DB', 'Wallet: балансы продавцов', 'Wallet DB', 'Ledger: двойная запись', 'Kafka: события платежа', 'Очередь повторов и DLQ', 'Сверка с PSP'];

  g.LAB = {
    id: 'ch11', n: 11, title: 'Payment System', subtitle: 'Платёжная система маркетплейса',
    intro: 'Маркетплейс принимает оплату картой за заказ (pay-in) и потом выплачивает деньги продавцам (pay-out). Карты обрабатывает внешний PSP, например Stripe. Нагрузка смешная: около 10 платежей в секунду. Глава не про масштаб, а про правильность: ни одного двойного списания, ни одного потерянного платежа, каждый цент объясним по ledger и сверен с PSP. Цифры по памяти книги, сверяйся с ней.',
    kpiFlows: [{ id: 'pay', label: 'Оплата' }, { id: 'status', label: 'Статус' }], mainFlow: 'pay',
    cx: [14, 20],
    bgNote: 'Оплата это не тормозит.',

    steps: [
      { id: 'req', title: 'Требования', sub: 'pay-in, pay-out, PSP', kind: 'req', tag: '~5 мин', guide: 'Отметь функции и ограничения. Главное: деньги через PSP, номера карт не храним, правильность важнее скорости.' },
      { id: 'est', title: 'Оценка нагрузки', sub: '1 млн платежей в день', kind: 'est', tag: '~3 мин', guide: 'Покрути слайдеры. Вывод: 10 платежей в секунду, это одна БД. Масштаб не главное.' },
      { id: 'api', title: 'API и данные', sub: 'payment event и order', kind: 'api', tag: '~5 мин', guide: 'POST /v1/payments и статус. Таблицы payment_event и payment_order в реляционной БД, сумма строкой.' },
      { id: 'hld', title: 'Дизайн', sub: 'схема на карте', kind: 'map', stage: 'base', tag: '~10 мин', guide: 'Покупатель → Payment service → Payment executor → PSP. После успеха Wallet и Ledger. PSP сообщает итог через webhook.' },
      { id: 'deep', title: 'Углубление', sub: 'проблемы и решения', kind: 'map', stage: 'deep', tag: '~15 мин', guide: 'Карты и PCI, долгие платежи, повторы и идемпотентность, Kafka для wallet и ledger, двойная запись, сверка, сбой PSP.' },
      { id: 'sum', title: 'Итог', sub: 'рассказ для интервью', kind: 'sum', tag: '~5 мин', guide: 'Перескажи решение по шагам и ответь на вопросы для повторения.' },
    ],

    requirements: {
      intro: 'Сначала договариваемся, что строим. Отметь то, что входит в задачу, и нажми «Проверить». Книга строит бэкенд платежей интернет-магазина вроде Amazon: приём оплаты картой через PSP и выплаты продавцам.',
      groups: [
        { kind: 'fr', title: 'Функциональные (FR)', q: 'Что система делает', desc: 'Функции из книги: pay-in, pay-out, работа через PSP, сверка.', items: [
          { text: 'Принять оплату заказа картой (pay-in)', in: true, why: 'Главный поток: деньги покупателя попадают на счёт маркетплейса.', to: 'POST /v1/payments', shapes: [
            ['exact', 2, 'Деньги списываются ровно один раз, даже при повторах.'],
            ['reliab', 1, 'Сбой сети или PSP не теряет платёж.'],
          ] },
          { text: 'Выплатить деньги продавцам (pay-out)', in: true, why: 'Продавец получает свою долю, книга делает это через сервис выплат вроде Tipalti.', to: 'Wallet: баланс продавца' },
          { text: 'Работать через PSP (Stripe, PayPal, Adyen)', in: true, why: 'Подключаться к Visa и банкам напрямую долго и дорого: это работа PSP.', to: 'Payment executor → PSP', shapes: [
            ['security', 1, 'PSP берёт на себя карты и PCI DSS.'],
          ] },
          { text: 'Сверять наши записи с PSP', in: true, why: 'Платёж идёт через несколько систем, и они расходятся. Книга посвящает этому отдельный раздел.', to: 'Сверка с PSP', shapes: [
            ['consistency', 2, 'Каждое расхождение найдено за сутки.'],
          ] },
          { text: 'Вести учёт каждой операции', in: true, why: 'Финансы и аудит: любой баланс должен объясняться историей.', to: 'Ledger: двойная запись', shapes: [
            ['consistency', 1, 'Проводки сходятся, ошибку видно.'],
          ] },
          { text: 'Хранить номера карт у себя', in: false, why: 'Тогда вся система в зоне PCI DSS. Книга берёт hosted payment page PSP: карту видит только PSP.' },
          { text: 'Свой процессинг: прямое подключение к Visa', in: false, why: 'Это уровень банка, а не маркетплейса.' },
          { text: 'Возвраты и чарджбэки', in: false, why: 'Книга не разбирает: те же механизмы в обратную сторону.' },
        ] },
        { kind: 'nfr', title: 'Нефункциональные (NFR)', q: 'Насколько хорошо система это делает', desc: 'Книга: надёжность и отказоустойчивость, сверка между сервисами. Скорость и масштаб второстепенны.', items: [
          { text: 'Ни двойных списаний, ни потерянных платежей', in: true, nfr: 'exact', why: 'Ошибка стоит денег и доверия.', to: 'повторы и ключ идемпотентности' },
          { text: 'Сбои сети и PSP не теряют платежи', in: true, nfr: 'reliab', why: 'Внешний вызов падает регулярно.', to: 'очередь повторов, DLQ' },
          { text: 'Наши записи и PSP сходятся', in: true, nfr: 'consistency', why: 'Расхождение находят до того, как его найдёт продавец.', to: 'ledger и сверка' },
          { text: 'Номера карт не проходят через нас', in: true, nfr: 'security', why: 'PCI DSS и утечки.', to: 'hosted payment page' },
          { text: 'Ответ на оплату за 50 мс', in: false, nfr: 'reliab', why: 'Банк и 3-D Secure отвечают секундами. Важнее не потерять платёж.' },
          { text: 'Миллион платежей в секунду', in: false, nfr: 'reliab', why: 'Книга: 10 в секунду. Масштаб тут не главное.' },
        ] },
      ],
      start: {
        title: 'Почему всё начинается здесь',
        text: 'Платёжная система редко упирается в нагрузку: 10 транзакций в секунду держит одна реляционная БД. На интервью проверяют другое: понимаешь ли ты, что сеть и PSP падают посередине платежа, и как ты добиваешься, чтобы деньги списались ровно один раз, а каждая копейка была объяснима и сверена.',
        chain: [
          { t: 'FR: что делаем', d: 'Pay-in через PSP, pay-out продавцам, учёт и сверка.' },
          { t: 'NFR: насколько хорошо', d: 'Ровно один раз, без потерь, всё сходится, карты не у нас.' },
          { t: 'Оценка: сколько', d: '1 млн платежей в день, это 10 в секунду.' },
          { t: 'Технологии: что следует', d: 'Реляционная БД с ACID, ключ идемпотентности, очередь повторов, ledger, сверка.' },
        ],
        skipTitle: 'Чего не берём',
        skip: [
          { t: 'Шардирование и NoSQL', d: '10 платежей в секунду. Важнее ACID и проверенная надёжность.' },
          { t: 'Хранение карт', d: 'Hosted payment page PSP: карта уходит мимо нас.' },
          { t: 'Синхронный вызов всего подряд', d: 'Wallet и ledger обновляются асинхронно после успеха.' },
        ],
        revisit: 'Решение верно, пока верны требования. Новое FR может поменять NFR, и тогда пересматривается архитектура. Примеры ниже.',
      },
      future: [
        { fr: 'Несколько стран и валют', breaks: ['consistency'],
          now: 'Одна валюта, один PSP.',
          why: 'Курсы меняются между оплатой и выплатой, местные методы оплаты у разных PSP.',
          fix: 'Сумма с валютой в каждой проводке, счёт под каждую валюту, маршрутизация по PSP.' },
        { fr: 'PSP падает на час в распродажу', breaks: ['reliab'],
          now: 'Один PSP и повторы.',
          why: 'Повторы спасают платёж, но покупатель ждёт.',
          fix: 'Второй PSP и переключение (расширение).' },
        { fr: 'Хотим хранить карты для оплаты в один клик', breaks: ['security'],
          now: 'Карту видит только PSP.',
          why: 'Хранение карт тянет всю систему в PCI DSS.',
          fix: 'Токены PSP (card on file) вместо номеров.' },
        { fr: 'Продавцам нужны выплаты каждый день', breaks: ['consistency'],
          now: 'Pay-out раз в период.',
          why: 'Баланс продавца должен быть точным каждый день.',
          fix: 'Ежедневная сверка wallet с ledger до выплаты.' },
      ],
      nfr: [
        { id: 'exact', name: 'Ровно один раз', en: 'Exactly-once', key: true, what: 'Деньги списаны ровно один раз.', metric: 'Двойных и потерянных платежей.', drives: 'Повторы + ключ идемпотентности.', here: '0 на миллион.' },
        { id: 'reliab', name: 'Надёжность', en: 'Reliability', key: true, what: 'Сбой не теряет платёж.', metric: 'Зависших платежей за день.', drives: 'Состояние в БД, очередь повторов, DLQ.', here: 'Каждый платёж доходит до SUCCESS или FAILED.' },
        { id: 'consistency', name: 'Сходимость', en: 'Reconciliation', key: true, what: 'Наши записи и PSP совпадают.', metric: 'Ненайденных расхождений.', drives: 'Ledger с двойной записью, ежедневная сверка.', here: 'Все расхождения найдены за сутки.' },
        { id: 'security', name: 'Безопасность', en: 'Security', key: false, what: 'Карты и деньги защищены.', metric: 'Карт в нашей зоне PCI.', drives: 'Hosted payment page, HTTPS, токены.', here: 'Номер карты видит только PSP.' },
      ],
      conclusion: 'Итог: приём оплаты через PSP, выплаты, учёт и сверка. Главное не скорость, а правильность. Дальше посчитаем нагрузку.',
    },

    estimate: {
      intro: 'Как в книге: 1 млн платежей в день. В сутках округлённо 100 тысяч секунд. Книга сразу делает вывод: 10 транзакций в секунду это немного, одна обычная БД справится, поэтому глава про правильность, а не про пропускную способность.',
      scnNote: 'Пик это распродажа: в Чёрную пятницу в разы больше среднего. Рост это масштаб бизнеса. Сбой PSP это минуты в месяц, когда PSP не отвечает: его увидишь в углублении.',
      inputs: [
        { id: 'txDay', label: 'Платежей в день', unit: 'млн', min: 0.1, max: 50, step: 0.1, value: 1 },
        { id: 'orders', label: 'Продавцов в одном заказе', unit: '', min: 1, max: 5, step: 0.5, value: 1 },
        { id: 'polls', label: 'Запросов статуса на платёж', unit: '', min: 0, max: 10, step: 1, value: 3 },
        { id: 'rowKB', label: 'Строка платежа или проводки', unit: 'КБ', min: 0.1, max: 2, step: 0.1, value: 0.5 },
      ],
      rows: (d) => [
        { short: 'Платежи', label: 'Платежей в секунду', uses: ['txDay', 'growth'], from: [], formula: 'платежи ÷ 100 000 с', v: d.tps,
          calc: (d, i, f) => `${f(i.txDay * 1e6 * d.growth)} ÷ 10⁵ = ${f(d.tps)}/с`,
          why: 'Цифра книги: 10 TPS. Одна реляционная БД держит тысячи.', to: 'все остальные строки' },
        { short: 'Пик', label: 'Платежей в пик', uses: ['peak'], from: [0], peak: true, flows: ['pay', 'save'], formula: 'платежи × пик', v: d.peakTps,
          calc: (d, i, f) => `${f(d.tps)} × ${d.k} = ${f(d.peakTps)}/с`,
          why: 'Распродажа. Даже ×30 это сотни в секунду: всё ещё одна БД.', to: 'карта: «Оплата»' },
        { short: 'К PSP', label: 'Заказов к PSP в пик', uses: ['orders'], from: [1], flows: ['pay', 'webhook'], formula: 'пик × продавцов в заказе', v: d.peakOrders,
          calc: (d, i, f) => `${f(d.peakTps)} × ${i.orders} = ${f(d.peakOrders)}/с`,
          why: 'Один payment event делится на payment order по продавцам, каждый идёт в PSP отдельно.', to: 'Payment executor, PSP' },
        { short: 'Ledger', label: 'Проводок в пик', uses: [], from: [2], flows: ['ledger'], formula: 'заказы × 2', v: d.ledgerW,
          calc: (d, i, f) => `${f(d.peakOrders)} × 2 = ${f(d.ledgerW)}/с`,
          why: 'Двойная запись: дебет одного счёта и кредит другого на каждый заказ.', to: 'Ledger' },
        { short: 'Данные', label: 'Данных за год, ГБ', uses: ['rowKB'], from: [0], formula: 'платежи в год × строки × размер', v: d.yearGB,
          calc: (d, i, f) => `${f(d.payDay * 365)} × ${dec(1 + i.orders * 3)} строки × ${dec(i.rowKB)} КБ = ${f(d.yearGB)} ГБ`,
          why: 'Событие, заказы и две проводки на заказ. Сотни гигабайт в год: одна БД с архивом.', to: 'Payment DB, Ledger' },
      ],
      conclusion: (d) => `${big(d.tps)} платежей в секунду, в пик ${big(d.peakTps)}, ${big(d.yearGB)} ГБ данных в год. ${d.peakTps * 4 < 5000 ? 'Это одна реляционная БД: главное не масштаб, а правильность.' : 'Уже тысячи записей в секунду: Payment DB понадобятся шарды.'}`,
    },

    api: {
      intro: 'Один главный запрос: оплатить заказ. Внутри событие оплаты (checkout) и заказы по продавцам. Книга подчёркивает две детали: сумма передаётся строкой, а не float, и у каждого заказа свой payment_order_id, он же ключ идемпотентности. Хранение в реляционной БД: ACID и проверенная надёжность важнее скорости.',
      journeyTitle: 'Путь оплаты',
      conventions: [
        { k: 'Сумма', v: 'Строка "10.00" и валюта ISO 4217: float теряет копейки' },
        { k: 'Идемпотентность', v: 'Заголовок Idempotency-Key = payment_order_id (UUID)' },
        { k: 'БД', v: 'Реляционная с ACID: стабильность важнее скорости' },
        { k: 'Статусы заказа', v: 'NOT_STARTED → EXECUTING → SUCCESS | FAILED' },
        { k: 'Карта', v: 'Только в hosted payment page PSP, у нас токен' },
        { k: 'Итог от PSP', v: 'Webhook: PSP сам зовёт нас со статусом' },
      ],
      journey: [
        { ep: 'pay', text: 'Покупатель жмёт «Оплатить»' },
        { ep: 'webhook', text: 'PSP сообщает итог' },
        { ep: 'status', text: 'Клиент спрашивает статус' },
      ],
      endpoints: [
        { id: 'pay', method: 'POST', path: '/v1/payments', title: 'Оплатить заказ', who: 'клиент', flow: 'pay', key: true,
          about: 'Событие оплаты из корзины. Payment service сохраняет его, по каждому заказу регистрирует платёж в PSP и возвращает токен для формы карты.',
          body: { buyer_info: { user_id: 'u42' }, checkout_id: 'c-7f3a', credit_card_info: 'токен PSP', payment_orders: [{ seller_account: 's-15', amount: '10.00', currency: 'USD', payment_order_id: 'po-91c2' }] },
          ok: { status: '202 Accepted', body: { checkout_id: 'c-7f3a', status: 'EXECUTING' } },
          errors: [['409', 'DUPLICATE', 'Этот payment_order_id уже обработан: возвращаем прошлый результат'], ['400', 'BAD_REQUEST', 'Сумма не строкой или нет валюты']],
          sql: "INSERT INTO payment_event (checkout_id, buyer_info, ...) VALUES ('c-7f3a', ...);\nINSERT INTO payment_order (payment_order_id, checkout_id, amount, currency, status)\n  VALUES ('po-91c2', 'c-7f3a', '10.00', 'USD', 'NOT_STARTED');  -- PK = ключ идемпотентности",
          reads: [], writes: ['payment_event', 'payment_order'] },
        { id: 'webhook', method: 'POST', path: '/v1/psp/webhook', title: 'Итог от PSP', who: 'PSP', flow: 'webhook', key: true,
          about: 'PSP вызывает наш webhook, когда платёж прошёл или отклонён. Повторная доставка того же события ничего не меняет: статус ставится, только если он ещё EXECUTING.',
          body: { payment_order_id: 'po-91c2', status: 'SUCCESS', psp_ref: 'pi_3Nk' },
          ok: { status: '200 OK', body: {} },
          errors: [['401', 'BAD_SIGNATURE', 'Подпись PSP не сошлась']],
          sql: "UPDATE payment_order SET status = 'SUCCESS'\n WHERE payment_order_id = 'po-91c2' AND status = 'EXECUTING'",
          reads: [], writes: ['payment_order'] },
        { id: 'status', method: 'GET', path: '/v1/payments/{id}', title: 'Статус платежа', who: 'клиент', flow: 'status', key: false,
          about: 'Клиент спрашивает, чем кончилось. Читаем с primary: реплика может отставать и показать «не оплачено» после оплаты.',
          params: [['id', 'path', 'string', true, 'checkout_id']],
          example: 'GET /v1/payments/c-7f3a',
          ok: { status: '200 OK', body: { checkout_id: 'c-7f3a', is_payment_done: true, orders: [{ payment_order_id: 'po-91c2', status: 'SUCCESS' }] } },
          errors: [['404', 'NOT_FOUND', 'Нет такого платежа']],
          sql: "SELECT payment_order_id, status FROM payment_order WHERE checkout_id = 'c-7f3a'",
          reads: ['payment_event', 'payment_order'], writes: [] },
      ],
      dbs: [
        { id: 'pay', name: 'Платежи', owner: 'Payment DB (MySQL, PostgreSQL)', why: 'Статусы событий и заказов, ACID.' },
        { id: 'wal', name: 'Балансы', owner: 'Wallet DB', why: 'Сколько маркетплейс должен каждому продавцу.' },
        { id: 'led', name: 'Проводки', owner: 'Ledger', why: 'Двойная запись, только добавление.' },
      ],
      tables: [
        { name: 'payment_event', db: 'pay', why: 'Одна оплата корзины.', rows: '≈ 1 млн в день',
          cols: [{ n: 'checkout_id', t: 'string', k: 'PK', d: 'Идентификатор корзины' }, { n: 'buyer_info', t: 'string', d: 'Кто платит' }, { n: 'credit_card_info', t: 'string', d: 'Токен PSP, не номер карты' }, { n: 'is_payment_done', t: 'boolean', d: 'Все заказы прошли' }] },
        { name: 'payment_order', db: 'pay', why: 'Заказ одному продавцу: то, что уходит в PSP.', rows: '≈ 1 млн в день',
          cols: [{ n: 'payment_order_id', t: 'string', k: 'PK', d: 'UUID, он же ключ идемпотентности' }, { n: 'checkout_id', t: 'string', d: 'Событие оплаты', ref: { t: 'payment_event', c: 'checkout_id' } }, { n: 'amount', t: 'string', d: '"10.00"' }, { n: 'currency', t: 'string', d: 'USD' }, { n: 'payment_order_status', t: 'enum', d: 'NOT_STARTED, EXECUTING, SUCCESS, FAILED' }, { n: 'ledger_updated', t: 'boolean', d: 'Проводка записана' }, { n: 'wallet_updated', t: 'boolean', d: 'Баланс продавца обновлён' }] },
        { name: 'ledger_entry', db: 'led', why: 'Две строки на каждую операцию, сумма всегда 0.', rows: '≈ 2 млн в день',
          cols: [{ n: 'entry_id', t: 'bigint', k: 'PK', d: 'Порядковый номер' }, { n: 'payment_order_id', t: 'string', d: 'Откуда', ref: { t: 'payment_order', c: 'payment_order_id' } }, { n: 'account', t: 'string', d: 'buyer:u42 или seller:s-15' }, { n: 'debit', t: 'decimal', d: 'Дебет' }, { n: 'credit', t: 'decimal', d: 'Кредит' }] },
        { name: 'wallet', db: 'wal', why: 'Текущий баланс продавца для выплат.', rows: '≈ число продавцов',
          cols: [{ n: 'seller_account', t: 'string', k: 'PK', d: 's-15' }, { n: 'balance', t: 'decimal', d: 'Сколько должны продавцу' }, { n: 'version', t: 'int', d: 'Оптимистичная блокировка' }] },
      ],
      more: {
        intro: 'Для интервью хватает таблиц выше. Ниже то, что добавляют, когда растут требования.',
        tables: [
          { name: 'outbox (расширение)', when: 'Событие для Kafka пишется в той же транзакции, что и статус.', cols: 'id, aggregate_id, type, payload, published_at' },
          { name: 'reconciliation_issue', when: 'Расхождения сверки, которые разбирает финансовая команда.', cols: 'id, payment_order_id, kind, psp_value, our_value, status' },
        ],
        endpoints: [
          { ep: 'POST /v1/payouts', when: 'Выплата продавцу из баланса wallet через сервис выплат.' },
        ],
      },
      quiz: [
        { q: 'Почему сумма строкой?', a: 'Float теряет точность при сериализации и в разных языках. Строка и decimal в БД.' },
        { q: 'Что служит ключом идемпотентности?', a: 'payment_order_id (UUID), он же PK: второй INSERT падает, отдаём прошлый результат.' },
        { q: 'Почему реляционная БД?', a: '10 TPS, а нужны ACID-транзакции и проверенная надёжность.' },
        { q: 'Зачем webhook?', a: 'Итог платежа бывает через секунды и минуты: PSP сам сообщает его, а не мы ждём.' },
      ],
    },

    board: { w: 1240, h: 820 },
    scenario: [
      { id: 'peak', label: 'Пик', unit: '×', stops: [1, 3, 10, 30], value: 3, hint: 'Во сколько раз пик выше среднего. Распродажа до ×30' },
      { id: 'growth', label: 'Рост', unit: '×', stops: [1, 10, 100], value: 1, hint: 'Во сколько раз больше платежей. Книга: 1 млн в день' },
      { id: 'outage', label: 'Сбой PSP', unit: 'мин', stops: [0, 15, 60, 240], value: 0, hint: 'Сколько минут в месяц PSP не отвечает. Проверка надёжности в углублении' },
    ],
    groups: ['Вход', 'Платёж', 'Деньги', 'Внешние'],
    expGroups: ['Платёж', 'Внешние'],

    blocks: {
      client: { name: 'Покупатель (клиент)', icon: '🛒', cat: 'edge', group: 'Вход', pos: [20, 360], cap: 0, tag: 'Браузер или приложение',
        learn: { what: 'Оформляет заказ и жмёт «Оплатить». Номер карты вводит в форму PSP, а статус спрашивает у Payment service.', plus: [], minus: [] } },
      paySvc: { name: 'Payment service', icon: '💳', cat: 'svc', group: 'Платёж', pos: [250, 360], cap: 1000, lat: 20, cost: 80, cx: 0.5, maxRep: 300,
        links: [['client', 'self'], ['self', EXEC], ['self', DB], ['self', 'wallet'], ['self', 'ledger'], ['psp', 'self']], tag: 'Принимает оплату, ведёт статусы',
        learn: { more: FLOW_MORE, what: 'Принимает событие оплаты, сохраняет его и заказы в БД, проверяет риски, по каждому заказу зовёт Payment executor. Принимает webhook от PSP. После успеха обновляет Wallet и Ledger.', plus: ['Без состояния: всё в БД'], minus: [] } },
      executor: { name: 'Payment executor', icon: '⚙️', cat: 'svc', group: 'Платёж', pos: [480, 200], cap: 500, lat: 10, cost: 80, cx: 0.5, maxRep: 300,
        links: [['paySvc', 'self'], ['self', 'psp'], ['self', 'retryQ']], tag: 'Заказ → PSP',
        learn: { more: EXACT_MORE, what: 'Отправляет payment order в PSP с ключом идемпотентности и ведёт статус заказа. Временную ошибку отправляет в очередь повторов.', plus: [], minus: [] } },
      psp: { name: 'PSP (Stripe, Adyen)', icon: '🏦', cat: 'edge', group: 'Внешние', pos: [720, 200], cap: 0, lat: 400, tag: 'Сети карт и банки',
        links: [['executor', 'self'], ['temporal', 'self'], ['self', 'paySvc'], ['self', 'recon']],
        learn: { more: FLOW_MORE, what: 'Внешний провайдер: говорит с Visa, Mastercard и банками, хранит карты, показывает hosted payment page. Отвечает сотни миллисекунд, а иногда минуты, и иногда не отвечает вовсе. Раз в день присылает файл расчётов.', plus: ['Карты и PCI DSS на нём'], minus: ['Внешний: падает и тормозит не по нашей вине'] } },
      payDB: { name: 'Payment DB', icon: '🗄️', cat: 'db', group: 'Платёж', pos: [250, 620], cap: 5000, lat: 5, cost: 300, cx: 1, db: true, tune: 'sql', repLabel: 'узл.',
        opts: { shards: [1, 2, 4, 8, 16, 32, 64] }, shardKeys: [{ v: 'checkout', label: 'checkout_id', note: 'Событие и его заказы в одном шарде: транзакция не выходит за шард.' }],
        links: [['paySvc', 'self']], tag: 'payment_event, payment_order',
        fit: { use: 'Статусы платежей, ACID, уникальный ключ идемпотентности.', avoid: 'NoSQL без транзакций: статус и ключ должны меняться атомарно.', limits: 'Тысячи записей в секунду на primary.' },
        learn: { more: EXACT_MORE, what: 'Реляционная БД: payment_event и payment_order со статусами. Книга выбирает её за ACID и проверенную стабильность. Статус читаем с primary: реплика может отставать.', plus: ['ACID', 'Уникальный ключ'], minus: [] } },
      wallet: { name: 'Wallet: балансы продавцов', icon: '👛', cat: 'svc', group: 'Деньги', pos: [720, 470], cap: 2000, lat: 5, cost: 60, cx: 0.5, maxRep: 100,
        links: [['paySvc', 'self'], ['kafka', 'self'], ['self', 'walletDB']], tag: 'Сколько должны продавцу',
        learn: { what: 'После успешного платежа увеличивает баланс продавца. Из этого баланса потом идёт pay-out.', plus: [], minus: [] } },
      walletDB: { name: 'Wallet DB', icon: '🗄️', cat: 'db', group: 'Деньги', pos: [960, 380], cap: 5000, lat: 5, cost: 200, cx: 1, db: true, tune: 'sql', repLabel: 'узл.',
        shardKeys: [{ v: 'seller', label: 'seller_account', note: 'Баланс продавца в одном шарде.' }],
        links: [['wallet', 'self']], tag: 'seller_account → balance',
        fit: { use: 'Текущие балансы продавцов.', avoid: 'Как единственный учёт: баланс без проводок не объяснить.', limits: 'Популярный продавец это горячая строка.' },
        learn: { what: 'Баланс каждого продавца. Его сверяют с ledger перед выплатой.', plus: [], minus: [] } },
      ledger: { name: 'Ledger: двойная запись', icon: '📒', cat: 'db', group: 'Деньги', pos: [960, 600], cap: 5000, lat: 5, cost: 250, cx: 1, db: true, tune: 'sql', repLabel: 'узл.',
        shardKeys: [{ v: 'account', label: 'account', note: 'Проводки счёта в одном шарде.' }],
        links: [['paySvc', 'self'], ['kafka', 'self'], ['recon', 'self']], tag: 'Дебет и кредит, только добавление',
        fit: { use: 'Финансовый учёт: каждая операция две проводки.', avoid: 'Изменять или удалять проводки: только новые.', limits: 'Две записи на каждый заказ.' },
        learn: { more: LEDGER_MORE, what: 'Принцип двойной записи: каждая операция это дебет одного счёта и кредит другого на одну сумму, всего всегда 0. Проводки только добавляются. Отсюда сверка и аудит.', plus: ['Ошибку видно сразу', 'Любой баланс объясним'], minus: ['Вдвое больше записей'] } },
      kafka: { name: 'Kafka: события платежа', logo: 'kafka', icon: '📨', cat: 'async', group: 'Платёж', via: true, pos: [480, 470], cap: 50000, lat: 3, cost: 150, cx: 1, maxRep: 20, repLabel: 'брок.',
        links: [['paySvc', 'self'], ['self', 'wallet'], ['self', 'ledger']], drop: [['paySvc', 'wallet'], ['paySvc', 'ledger']], tag: 'Платёж прошёл → wallet и ledger',
        fit: { use: 'Wallet, ledger, аналитика и письма реагируют на платёж независимо.', avoid: 'Если потребитель один и всё в одной БД.', limits: 'Обновления асинхронные, на доли секунды позже.' },
        learn: { more: EXACT_MORE, what: 'Книга сравнивает синхронные вызовы и асинхронные события. Payment service публикует «заказ оплачен», Wallet и Ledger читают сами: сбой одного не роняет платёж, новый потребитель не трогает Payment service.', plus: ['Слабая связность'], minus: ['Ещё кластер', 'Двойная запись в БД и Kafka'] } },
      retryQ: { name: 'Очередь повторов и DLQ', icon: '🔁', cat: 'async', group: 'Платёж', pos: [480, 30], cap: 20000, lat: 3, cost: 60, cx: 0.5, maxRep: 20,
        links: [['executor', 'self'], ['temporal', 'self']], tag: 'Повтор с задержкой, потом в DLQ',
        fit: { use: 'Временные ошибки PSP: повторить позже, не теряя платёж.', avoid: 'Ошибки вроде «недостаточно средств»: повтор не поможет.', limits: 'Покупатель ждёт итог дольше.' },
        learn: { more: EXACT_MORE, what: 'Книга: временная ошибка уходит в очередь повторов, её читают с экспоненциальной задержкой. Попытки кончились: сообщение в dead letter queue, разбирает человек.', plus: ['Платёж не теряется'], minus: [] } },
      recon: { name: 'Сверка с PSP', icon: '🔍', cat: 'svc', group: 'Деньги', pos: [960, 160], cap: 1000, lat: 50, cost: 40, cx: 0.5, maxRep: 20,
        links: [['psp', 'self'], ['self', 'ledger']], tag: 'Файл расчётов против ledger',
        learn: { more: LEDGER_MORE, what: 'Раз в день берёт файл расчётов PSP и сравнивает с ledger и статусами. Расхождения: исправимые автоматически, для финансовой команды и неклассифицируемые.', plus: ['Ошибки находятся за сутки'], minus: [] } },

      // ---------- эксперименты ----------
      temporal: { name: 'Temporal: workflow платежа', icon: '⏱️', cat: 'svc', extra: true, group: 'Платёж', pos: [480, 690], cap: 500, lat: 15, cost: 120, cx: 1, maxRep: 300,
        links: [['paySvc', 'self'], ['self', 'psp'], ['self', 'psp2']], drop: [['paySvc', 'executor']], tag: 'Durable execution вместо своего исполнителя',
        fit: { use: 'Долгие процессы с повторами и таймерами: платёж, выплата, возврат.', avoid: 'Если команда не готова держать ещё кластер.', limits: 'Ещё один кластер и своя модель программирования.' },
        learn: { more: EXACT_MORE, what: 'Расширение, в книге его нет. Temporal (или AWS Step Functions) хранит каждый шаг платежа: упал процесс, workflow продолжится с того же места. Повторы с экспоненциальной задержкой и таймеры встроены, очередь повторов писать не нужно.', plus: ['Повторы и таймеры даром'], minus: ['+5 мс на шаг', 'Ещё кластер'] } },
      psp2: { name: 'Второй PSP (маршрутизация)', icon: '🏧', cat: 'edge', extra: true, group: 'Внешние', pos: [720, 30], cap: 0, lat: 400, tag: 'Резерв и выбор по цене',
        links: [['executor', 'self'], ['temporal', 'self']],
        fit: { use: 'Сбой PSP стоит больших денег, или комиссии сильно разные.', avoid: 'Маленький магазин: второй договор и вторая сверка.', limits: 'Две интеграции, две сверки, разные коды ошибок.' },
        learn: { what: 'Расширение. Executor следит за здоровьем PSP и при сбое отправляет новые платежи во второй. Ключ идемпотентности тот же, поэтому платёж, ушедший в первый, во второй не дублируется: сначала спрашиваем статус.', plus: ['Сбой PSP не останавливает оплату'], minus: ['Две интеграции'] } },
      crdb: { name: 'CockroachDB (консенсус)', icon: '🪳', cat: 'db', extra: true, group: 'Платёж', pos: [20, 620], cap: 3000, lat: 12, cost: 250, cx: 1, db: true, maxRep: 100, repLabel: 'узл.',
        links: [['paySvc', 'self']], drop: [['paySvc', 'payDB']], tag: 'Распределённый SQL на Raft',
        fit: { use: 'Нужна запись в нескольких зонах без потери при отказе узла.', avoid: 'Одна зона и 10 TPS: обычная БД проще.', limits: 'Каждая запись ждёт кворум: +мс.' },
        learn: { what: 'Книга упоминает и это: вместо primary с репликами взять БД на консенсусе (CockroachDB, YugabyteDB). Нет отстающих реплик и ручного переключения, но запись медленнее.', plus: ['Нет отставания реплик', 'Отказ узла без потерь'], minus: ['Запись ждёт кворум'] } },
    },

    flows: [
      { id: 'pay', label: 'Оплата', color: 'var(--f1)', write: true, rate: (d) => d.peakOrders, chain: ['client', 'paySvc', EXEC, 'psp'] },
      { id: 'status', label: 'Статус', color: 'var(--f2)', rate: (d) => d.peakTps * d.polls, chain: ['client', 'paySvc', DB] },
      { id: 'save', side: true, label: 'Запись платежа', color: 'var(--f3)', write: true, rate: (d) => d.peakTps * (1 + d.orders), chain: ['paySvc', DB] },
      { id: 'webhook', label: 'Webhook PSP', color: 'var(--f4)', write: true, rate: (d) => d.peakOrders, chain: ['psp', 'paySvc', DB] },
      { id: 'wallet', side: true, label: 'Баланс продавца', color: 'var(--f5)', write: true, rate: (d) => d.peakOrders, chain: ['paySvc', 'wallet', 'walletDB'] },
      { id: 'ledger', side: true, label: 'Проводки', color: 'var(--f6)', write: true, rate: (d) => d.ledgerW, chain: ['paySvc', 'ledger'] },
      { id: 'settle', side: true, optional: true, label: 'Сверка', color: 'var(--f7)', rate: (d) => d.tps, chain: ['psp', 'recon', 'ledger'] },
      { id: 'retry', side: true, optional: true, label: 'Повторы', color: 'var(--f8)', write: true, rate: (d) => d.peakOrders * 0.01, chain: [EXEC, 'retryQ'] },
      { id: 'probe', side: true, optional: true, label: 'Резервный PSP', color: 'var(--f8)', rate: (d) => d.peakOrders * 0.01, chain: [EXEC, 'psp2'] },
    ],

    derive: (i, deep) => {
      const p = (deep && deep.params) || {};
      const growth = p.growth || 1, k = p.peak || 3, outage = p.outage || 0;
      const payDay = i.txDay * 1e6 * growth, tps = payDay / 1e5, peakTps = tps * k, peakOrders = peakTps * i.orders;
      return { k, growth, outage, payDay, tps, peakTps, orders: i.orders, polls: i.polls, peakOrders, ledgerW: peakOrders * 2,
        yearGB: (payDay * 365 * (1 + i.orders * 3) * i.rowKB) / 1e6, outPay: tps * 60 * outage };
    },

    reference: {
      base: {
        nodes: ['client', 'paySvc', 'executor', 'psp', 'payDB', 'wallet', 'walletDB', 'ledger'],
        edges: [['client', 'paySvc'], ['paySvc', 'executor'], ['executor', 'psp'], ['psp', 'paySvc'], ['paySvc', 'payDB'], ['paySvc', 'wallet'], ['wallet', 'walletDB'], ['paySvc', 'ledger']],
        cfg: { payDB: { replicas: 1, sync: 'semi' } },
        adapt: [],
      },
      deep: {
        nodes: ['client', 'paySvc', 'executor', 'retryQ', 'psp', 'recon', 'payDB', 'kafka', 'wallet', 'walletDB', 'ledger'],
        edges: [['client', 'paySvc'], ['paySvc', 'executor'], ['executor', 'psp'], ['executor', 'retryQ'], ['psp', 'paySvc'], ['psp', 'recon'], ['recon', 'ledger'], ['paySvc', 'payDB'], ['paySvc', 'kafka'], ['kafka', 'wallet'], ['kafka', 'ledger'], ['wallet', 'walletDB']],
        cfg: { payDB: { replicas: 1, sync: 'semi' } },
        adapt: [],
      },
    },

    problems: [
      { id: 'card', icon: '🔐', title: 'Где вводят номер карты', key: 'card',
        problem: 'Покупатель вводит номер карты. Через чьи серверы он проходит?',
        options: [
          { v: 'own', label: 'Своя форма', note: 'Форма на нашем сайте, номер идёт через Payment service в PSP. Вся система попадает в зону PCI DSS: аудит, шифрование, риск утечки.' },
          { v: 'hosted', label: 'Hosted payment page', note: 'Форма или виджет PSP: номер уходит прямо в PSP, у нас только токен. Так в книге.' },
        ],
        best: ['hosted'], say: 'Номер карты не трогаю: клиент вводит его в hosted payment page PSP, у меня только токен. Регистрирую платёж в PSP с ключом идемпотентности, получаю токен, PSP возвращает клиента на redirect URL и зовёт мой webhook.' },
      { id: 'pending', icon: '⏳', title: 'PSP отвечает не сразу', key: 'pending',
        problem: 'Часть платежей PSP подтверждает через секунды или минуты: 3-D Secure, проверка банка. Как ждать итог?',
        options: [
          { v: 'wait', label: 'Держать запрос', note: 'Executor держит соединение, пока PSP не ответит. Потоки висят, покупатель смотрит на крутилку, а таймаут обрывает платёж посередине.' },
          { v: 'webhook', label: 'Webhook и статус', note: 'Сразу отвечаем «в обработке», статус EXECUTING. PSP сам вызывает webhook с итогом, клиент спрашивает статус. Так в книге.' },
        ],
        best: ['webhook'], say: 'Не держу соединение: отвечаю «в обработке», заказ в статусе EXECUTING. Итог приходит webhook от PSP, клиент узнаёт его по GET /v1/payments/{id}. Webhook идемпотентен: статус меняется, только если он ещё EXECUTING.' },
      { id: 'retry', icon: '🔁', title: 'PSP не ответил', key: 'retry',
        problem: `Около ${dec(TIMEOUT * 100)}% вызовов PSP обрываются по таймауту: непонятно, прошло списание или нет. Что делать?`,
        options: [
          { v: 'none', label: 'Не повторять', note: 'Отмечаем FAILED или оставляем как есть. Часть платежей зависает: деньги списаны, а заказ не оплачен, или наоборот.' },
          { v: 'immediate', label: 'Сразу повторить', note: 'Повторяем тут же в цикле. При сбое PSP все повторы бьют в лежачий PSP разом и кончаются, пока он не поднялся.' },
          { v: 'backoff', label: 'Очередь с задержкой', note: 'Временную ошибку кладём в очередь повторов с экспоненциальной задержкой, исчерпанные попытки в DLQ. Нужен блок «Очередь повторов и DLQ». Так в книге.' },
        ],
        best: ['backoff'], say: 'Таймаут это неизвестный итог, поэтому повторяю. Временные ошибки кладу в очередь повторов с экспоненциальной задержкой, после N попыток в dead letter queue на разбор. Ошибки вроде «недостаточно средств» не повторяю.' },
      { id: 'idem', icon: '🔑', title: 'Повтор не должен списать дважды', key: 'idem',
        problem: 'Покупатель жмёт «Оплатить» дважды, а executor повторяет вызов после таймаута, хотя первый мог пройти. Как не списать второй раз?',
        options: [
          { v: 'none', label: 'Без защиты', note: 'Каждый запрос это новое списание. Двойной клик и повтор после таймаута списывают деньги дважды.' },
          { v: 'key', label: 'Ключ идемпотентности', note: 'Idempotency-Key = payment_order_id. В БД это PK: второй INSERT падает, отдаём прошлый ответ. Тот же ключ уходит в PSP. Так в книге.' },
        ],
        best: ['key'], say: 'Exactly-once это at-least-once плюс at-most-once: повторяю, но с ключом идемпотентности. Ключ это payment_order_id, в БД уникальный, и тот же ключ передаю в PSP. Повтор получает сохранённый результат, а не новое списание.' },
      { id: 'comm', icon: '📨', title: 'Wallet и ledger после платежа', key: 'comm',
        problem: 'Платёж прошёл. Payment service должен обновить баланс продавца и записать проводки. Как?',
        options: [
          { v: 'sync', label: 'Вызвать по очереди', note: 'Payment service ждёт Wallet и Ledger. Лёг Ledger, и успешный платёж выглядит упавшим, а ответ дольше.' },
          { v: 'kafka', label: 'Kafka', note: 'Payment service публикует событие, Wallet и Ledger читают сами. Нужен блок «Kafka: события платежа». Так в книге. Осторожно: запись в БД и в Kafka это две записи, одна может не случиться.' },
          { v: 'outbox', label: 'Kafka + outbox', ext: true, note: 'Расширение: событие пишется в таблицу outbox той же транзакцией, что и статус, а релей (или CDC) публикует его в Kafka. Событие не теряется и не появляется без платежа.' },
        ],
        best: ['kafka', 'outbox'], say: 'После успеха публикую событие в Kafka, Wallet и Ledger читают его сами: сбой одного не роняет платёж. Чтобы событие не потерялось между коммитом в БД и отправкой в Kafka, пишу его в outbox той же транзакцией.' },
      { id: 'ledger', icon: '📒', title: 'Как вести учёт денег', key: 'ledger',
        problem: 'Финансовая команда спрашивает, почему у продавца такой баланс. Как хранить деньги, чтобы ответить?',
        options: [
          { v: 'balance', label: 'Только баланс', note: 'UPDATE balance = balance + 10. Быстро, но ошибку не найти: история не сохранилась, сумма ни с чем не сверяется.' },
          { v: 'double', label: 'Двойная запись', note: 'Каждая операция это дебет и кредит на одну сумму в ledger, только добавление. Сумма всех проводок 0, ошибку видно сразу. Так в книге.' },
        ],
        best: ['double'], say: 'Веду ledger по принципу двойной записи: каждая операция это дебет одного счёта и кредит другого, сумма всегда ноль. Проводки только добавляются, ошибки правятся новой проводкой. Баланс в wallet сверяется с ledger.' },
      { id: 'recon', icon: '🔍', title: 'Мы и PSP разошлись', key: 'recon',
        problem: `Около ${dec(MISMATCH * 1e4)} платежа на 10 тысяч у нас и у PSP записаны по-разному: ошибка PSP, банка, наша или потерянный webhook. Как их найти?`,
        options: [
          { v: 'trust', label: 'Доверять ответам', note: 'Что PSP ответил, то и правда. Расхождения находит продавец или аудитор через месяц.' },
          { v: 'nightly', label: 'Ежедневная сверка', note: 'Раз в день файл расчётов PSP сравнивается с ledger, расхождения раскладываются по классам. Нужен блок «Сверка с PSP» со стрелками от PSP и в Ledger. Так в книге.' },
        ],
        best: ['nightly'], say: 'Раз в день сверяю файл расчётов PSP с ledger и статусами, а wallet с ledger. Расхождения делю на исправимые автоматически, для финансовой команды и неклассифицируемые. Сверка это последняя линия: она ловит всё, что пропустили повторы и идемпотентность.' },
      { id: 'scale', icon: '📈', title: 'Payment DB под рост', settings: 'payDB',
        problem: 'Рост и пик задаются над картой. Сколько шардов и реплик у Payment DB?',
        hint: 'При книжных 10 TPS хватает одной БД с репликой. Реплика нужна для отказа, а статус всё равно читаем с primary: полусинхронная репликация не теряет подтверждённый платёж. Шарды понадобятся только при росте ×100.',
        say: '10 платежей в секунду держит одна реляционная БД. Ставлю реплику с полусинхронной репликацией, чтобы подтверждённый платёж пережил падение primary. При росте шардирую по checkout_id: событие и его заказы в одном шарде.' },
    ],

    metrics: [
      { id: 'pci', label: 'Карт через нас', bad: true, sub: 'номеров карт за день в зоне PCI' },
      { id: 'dup', label: 'Двойные списания', bad: true },
      { id: 'stuck', label: 'Зависшие платежи', bad: true },
      { id: 'lostOut', label: 'Потеряно при сбое PSP', bad: true, sub: 'платежей за месяц' },
      { id: 'miss', label: 'Ошибки учёта', bad: true, sub: 'ненайденных за день' },
    ],

    model(ctx) {
      const { d, deep, nodes, flows, stage } = ctx, c = deep.choices, M = ctx.metrics;
      const all = Object.values(nodes), of = (t) => all.filter((n) => n.type === t), F = (id) => flows.find((f) => f.id === id);
      const badge = (n, icon, title) => n && n.badges.push({ icon, title });
      const addLoad = (n, fid, x) => { if (!n || !x) return; n.load += x; n.flows[fid] = (n.flows[fid] || 0) + x; if (F(fid).write) n.wload += x; };
      const scale = (n, fid, m) => n && addLoad(n, fid, (n.flows[fid] || 0) * (m - 1));
      const via = (f, t) => f.ok && f.path.some((x) => nodes[x.id].type === t);
      const on = (f, t) => { const x = f.ok && f.path.find((y) => [].concat(t).includes(nodes[y.id].type)); return x ? nodes[x.id] : null; };
      M.pci = M.dup = M.stuck = M.lostOut = M.miss = M.coupled = 0;
      const exec = on(F('pay'), EXEC), temporal = via(F('pay'), 'temporal');

      if (via(F('status'), 'crdb')) ctx.warn('info', 'CockroachDB: запись ждёт кворум (+мс), зато нет отстающих реплик и отказ узла не теряет платёж.');
      if (temporal) badge(exec, '⏱️', 'Шаги платежа переживают падение');
      if (stage !== 'deep') return;

      // ---------- карта ----------
      if (c.card === 'own') { M.pci = d.payDay; ctx.warn('warn', `Своя форма карты: ${big(d.payDay)} номеров в день идут через Payment service. Вся система в зоне PCI DSS.`); }
      else badge(of('paySvc')[0], '🔐', 'Карты видит только PSP');

      // ---------- долгие платежи ----------
      if (c.pending === 'wait') {
        F('pay').extraLat += PEND * PEND_MS; scale(exec, 'pay', 1 + PEND * 20);
        ctx.warn('warn', `${Math.round(PEND * 100)}% платежей PSP подтверждает в среднем через ${PEND_MS / 1000} с: executor держит потоки, средняя оплата растёт на ${dec((PEND * PEND_MS) / 1000)} с.`);
      } else badge(of('psp')[0], '🔔', 'Итог через webhook');

      // ---------- повторы ----------
      let retry = c.retry;
      if (temporal && retry !== 'none') retry = 'backoff';
      else if (retry === 'backoff' && !F('retry').ok) { retry = 'immediate'; ctx.warn('warn', 'Выбрана очередь повторов, но её нет на карте. Добавь «Очередь повторов и DLQ» за Payment executor: пока повторы идут сразу в цикле.'); }
      const T = d.payDay * TIMEOUT, failover = F('probe').ok;
      if (retry === 'none') { M.stuck = T; ctx.warn('warn', `Таймауты без повтора: около ${big(T)} платежей в день зависают с неизвестным итогом.`); }
      if (retry === 'immediate') scale(exec, 'pay', 1.2);
      if (retry === 'backoff') badge(of('retryQ')[0] || exec, '🔁', 'Повторы с задержкой, DLQ');
      if (d.outage > 0) {
        if (failover) { badge(of('psp2')[0], '🏧', 'Сбой PSP: платежи идут сюда'); ctx.warn('info', `Сбой PSP ${d.outage} мин: executor переключил ${big(d.outPay)} платежей на второй PSP.`); }
        else if (retry === 'backoff') ctx.warn('info', `Сбой PSP ${d.outage} мин: ${big(d.outPay)} платежей ждут в очереди повторов и проходят, когда PSP поднимется. Покупатель видит «в обработке».`);
        else {
          M.lostOut = d.outPay; if (retry === 'immediate') scale(exec, 'pay', 3);
          ctx.warn('warn', `Сбой PSP ${d.outage} мин: ${big(d.outPay)} платежей ${retry === 'immediate' ? 'исчерпали повторы, пока PSP лежал' : 'упали без повтора'}.`);
        }
      }

      // ---------- идемпотентность ----------
      if (c.idem === 'none') {
        M.dup = d.payDay * DOUBLE + (retry !== 'none' ? T * 0.5 : 0);
        ctx.warn('warn', `Без ключа идемпотентности около ${big(M.dup)} платежей в день списываются дважды: двойной клик${retry !== 'none' ? ' и повтор после таймаута, когда первый вызов на деле прошёл' : ''}.`);
      } else badge(of('payDB')[0] || of('crdb')[0], '🔑', 'Уникальный ключ идемпотентности');

      // ---------- wallet и ledger ----------
      if (c.comm === 'sync') { M.coupled = 1; F('pay').extraLat += 30; ctx.warn('warn', 'Payment service ждёт Wallet и Ledger: сбой Ledger делает успешный платёж упавшим.'); }
      else if (!via(F('wallet'), 'kafka') || !via(F('ledger'), 'kafka')) { M.coupled = 1; ctx.warn('warn', 'Kafka выбрана, но Wallet и Ledger получают платёж мимо неё. Поставь «Kafka: события платежа» за Payment service.'); }
      else if (c.comm === 'kafka') ctx.warn('info', 'Запись статуса в БД и событие в Kafka это две записи: если сервис упадёт между ними, wallet отстанет. Это поймает сверка, а закрывает outbox.');
      else { ctx.cx += 0.5; badge(of('kafka')[0], '📤', 'Outbox: событие в той же транзакции'); }

      // ---------- учёт и сверка ----------
      const led = of('ledger')[0];
      if (c.ledger === 'balance') { M.miss += d.payDay * BUG; scale(led, 'ledger', 0.5); ctx.warn('warn', `Только баланс: около ${big(d.payDay * BUG)} ошибочных изменений в день не видны, историю не восстановить.`); }
      else badge(led, '📒', 'Дебет = кредит');
      let rec = c.recon;
      if (rec === 'nightly' && !F('settle').ok) { rec = 'trust'; ctx.warn('warn', 'Сверка выбрана, но её нет на карте: нужны «Сверка с PSP» и стрелки PSP → Сверка → Ledger.'); }
      if (rec === 'trust') { M.miss += d.payDay * MISMATCH; ctx.warn('warn', `Без сверки около ${big(d.payDay * MISMATCH)} расхождений с PSP в день остаются ненайденными.`); }
      else badge(of('recon')[0], '🔍', 'Ежедневная сверка');
    },

    overload: 'больше копий или снять нагрузку раньше',
    linkWhy(a, b) {
      const B = this.blocks;
      if (a === 'client' && B[b].db) return 'Клиент не ходит в БД: только через Payment service.';
      if (a === 'client' && (b === 'psp' || b === 'psp2')) return 'Форма PSP открывается у клиента, но платёж регистрирует Payment service: на карте это его стрелка к PSP через executor.';
      if (a === 'psp' && B[b].db) return 'PSP сообщает итог webhook-ом в Payment service, а не пишет в нашу БД.';
      if (B[a].db) return 'БД отвечает на запросы, но сама никого не вызывает.';
      return '';
    },

    rules(ctx) {
      const { metrics: M, stage, d, flows } = ctx;
      if (M.dup > 0) ctx.warn('bad', `Около ${big(M.dup)} двойных списаний в день.`);
      if (M.stuck > 0) ctx.warn('bad', `Около ${big(M.stuck)} зависших платежей в день.`);
      if (M.lostOut > 0) ctx.warn('bad', `Сбой PSP теряет ${big(M.lostOut)} платежей.`);
      if (stage === 'base' && flows.every((f) => f.ok || f.optional)) ctx.warn('info', `Как показала оценка: в пик ${big(d.peakTps)} платежей в секунду. ${d.peakTps * 4 < 5000 ? 'Это одна БД с репликой: дальше важна правильность, а не масштаб.' : 'Это уже тысячи записей в секунду: Payment DB нужны шарды.'}`);
    },

    goals: {
      base: [
        { text: 'Оплата, статус, webhook, баланс и проводки доходят до цели', check: (r) => r.m.routed },
        { text: 'Оплата быстрее 1 с, статус быстрее 50 мс', check: (r) => r.m.routed && r.flows.find((f) => f.id === 'pay').lat <= 1000 && r.flows.find((f) => f.id === 'status').lat <= 50 },
        { text: 'Нагрузка выдерживается', check: (r) => r.m.served >= 1 && r.m.maxU <= 0.9 },
      ],
      deep: [
        { text: 'Нет двойных списаний и зависших платежей', check: (r) => r.m.routed && r.m.dup === 0 && r.m.stuck === 0 },
        { text: 'Номера карт не проходят через наши серверы', check: (r) => r.m.routed && r.m.pci === 0 },
        { text: 'Wallet и ledger не роняют платёж, учёт сходится с PSP', check: (r) => r.m.routed && r.m.coupled === 0 && r.m.miss === 0 },
        { text: 'Час сбоя PSP не теряет платежи', check: (r) => r.m.routed && r.d.outage >= 60 && r.m.lostOut === 0 },
        { text: 'Оплата быстрее 1 с при росте ×10', check: (r) => r.d.growth >= 10 && r.m.served >= 1 && r.m.maxU <= 0.9 && r.flows.find((f) => f.id === 'pay').lat <= 1000 },
      ],
    },

    summary: {
      db: 'payDB', core: CORE,
      estCard: (d, f) => `${f(d.tps)} платежей/с, пик ${f(d.peakTps)}`,
      badRow: { label: 'Двойные и зависшие платежи', ids: ['dup', 'stuck'] },
      script: (x) => {
        const t = x.fmt, d = x.d;
        return [
          { step: 'Требования', min: 4, text: 'Бэкенд платежей маркетплейса: pay-in картой через PSP, pay-out продавцам, учёт и сверка. Карты не храним, свой процессинг не строим. NFR: ровно одно списание, сбои не теряют платежи, наши записи сходятся с PSP.' },
          { step: 'Оценка', min: 2, text: `1 млн платежей в день это ${t(d.tps)} в секунду, в пик ×${d.k} ${t(d.peakTps)}. Это одна реляционная БД, значит, говорим о правильности, а не о масштабе.` },
          { step: 'API и данные', min: 3, text: 'POST /v1/payments с событием оплаты и заказами по продавцам, сумма строкой. Таблицы payment_event и payment_order со статусами NOT_STARTED, EXECUTING, SUCCESS, FAILED; payment_order_id это ключ идемпотентности. Реляционная БД ради ACID.' },
          { step: 'Дизайн', min: 4, text: `Payment service сохраняет событие, Payment executor${x.has('temporal') ? ' (у меня на Temporal)' : ''} отправляет каждый заказ в PSP. ${x.choice('card').say}` },
          { step: 'Долгие платежи', min: 2, text: x.choice('pending').say },
          { step: 'Повторы', min: 3, text: `${x.choice('retry').say} ${x.choice('idem').say}` },
          { step: 'Wallet и ledger', min: 3, text: `${x.choice('comm').say} ${x.choice('ledger').say}` },
          { step: 'Сверка', min: 2, text: x.choice('recon').say },
          { step: 'Что изменится, если…', min: 2, text: `PSP лежит час: ${x.has('psp2') ? 'у меня есть второй PSP, переключаюсь на него' : 'платежи ждут в очереди повторов, а со вторым PSP прошли бы сразу'}. Нужна запись в нескольких зонах: CockroachDB или YugabyteDB вместо primary с репликами. Много валют: валюта в каждой проводке и счёт под валюту.` },
        ];
      },
      says: {
        card: { own: 'Своя форма: вся система в зоне PCI.', hosted: 'Hosted payment page: карту видит только PSP.' },
        pending: { wait: 'Держим соединение до ответа PSP.', webhook: 'Ответ «в обработке», итог через webhook.' },
        retry: { none: 'Таймауты не повторяем: платежи зависают.', immediate: 'Повторяем сразу: шторм на лежачий PSP.', backoff: 'Очередь повторов с экспоненциальной задержкой и DLQ.' },
        idem: { none: 'Без ключа: двойные списания.', key: 'Ключ идемпотентности payment_order_id в БД и в PSP.' },
        comm: { sync: 'Wallet и Ledger синхронно: связаны с платежом.', kafka: 'Kafka раздаёт событие, двойная запись ловится сверкой.', outbox: 'Kafka и outbox: событие в той же транзакции.' },
        ledger: { balance: 'Только баланс: ошибку не найти.', double: 'Ledger с двойной записью.' },
        recon: { trust: 'Без сверки: расхождения не видны.', nightly: 'Ежедневная сверка с файлом PSP.' },
      },
      tradeoffs: [
        { pick: 'Hosted payment page', alt: 'Своя форма карты', why: 'Вне зоны PCI DSS. Цена: редирект и меньше контроля над дизайном формы.' },
        { pick: 'Реляционная БД', alt: 'NoSQL', why: 'ACID и уникальный ключ. Цена: шардировать вручную, но при 10 TPS не нужно.' },
        { pick: 'Повторы + идемпотентность', alt: 'Одна попытка', why: 'Ровно одно списание. Цена: ключи, статусы и очередь повторов.' },
        { pick: 'Webhook', alt: 'Ждать ответа', why: 'Потоки не висят. Цена: статус EXECUTING и опрос со стороны клиента.' },
        { pick: 'Kafka для wallet и ledger', alt: 'Синхронные вызовы', why: 'Сбой одного не роняет платёж. Цена: асинхронность и двойная запись (лечится outbox).' },
        { pick: 'Двойная запись', alt: 'Только баланс', why: 'Ошибку видно, баланс объясним. Цена: две строки на операцию.' },
        { pick: 'Ежедневная сверка', alt: 'Доверять PSP', why: 'Ловит всё, что пропустили остальные механизмы. Цена: процесс и люди для ручных случаев.' },
      ],
      pitfalls: [
        'Сразу шардировать и говорить о миллионах TPS: их тут нет.',
        'Хранить сумму во float.',
        'Повторять без ключа идемпотентности и списать дважды.',
        'Не повторять вовсе и терять платежи на таймаутах.',
        'Пропускать номера карт через свои серверы.',
        'Держать соединение, пока PSP думает минуты.',
        'Вести только баланс без ledger.',
        'Забыть про сверку: она ловит то, что не поймали остальные.',
      ],
      questions: [
        { q: 'Сколько транзакций в секунду?', a: '1 млн в день ÷ 10⁵ с = 10 TPS. Одна БД, главное правильность.' },
        { q: 'Что такое PSP и зачем он?', a: 'Stripe, Adyen и т.п.: связь с сетями карт и банками, хранение карт, hosted payment page.' },
        { q: 'Как добиться exactly-once?', a: 'At-least-once (повторы с задержкой) плюс at-most-once (ключ идемпотентности в БД и в PSP).' },
        { q: 'Что служит ключом идемпотентности?', a: 'payment_order_id (UUID), уникальный в БД. Тот же ключ уходит в PSP.' },
        { q: 'Что такое hosted payment page?', a: 'Форма PSP: номер карты уходит в PSP мимо наших серверов, мы получаем токен.' },
        { q: 'Как узнать итог долгого платежа?', a: 'PSP вызывает webhook, статус EXECUTING → SUCCESS/FAILED, клиент спрашивает статус.' },
        { q: 'Что такое двойная запись?', a: 'Каждая операция это дебет и кредит на одну сумму, сумма всех проводок 0, только добавление.' },
        { q: 'Зачем сверка, если есть идемпотентность?', a: 'Системы всё равно расходятся: ошибки PSP, банков, потерянные webhook. Сверка с файлом расчётов ловит всё раз в сутки.' },
        { q: 'Что делать с ошибкой, которая не лечится повтором?', a: 'Не повторять. Исчерпанные попытки отправлять в dead letter queue на ручной разбор.' },
        { q: 'Чем опасна запись в БД и в Kafka?', a: 'Это две записи без общей транзакции. Outbox: событие в той же транзакции, публикует релей.' },
      ],
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
