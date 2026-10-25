/* Глава 13. Stock Exchange: данные для лаборатории (simulator/lab). Задержки здесь в миллисекундах, но живут в микросекундах. */
(function (g) {
  // Числа в тексте: разряды пробелами, дробь через запятую.
  const num = (v) => Math.round(v).toLocaleString('ru-RU'), dec = (v) => String(+v.toFixed(1)).replace('.', ',');
  const big = (v) => (v >= 1e9 ? dec(v / 1e9) + ' млрд' : v >= 1e6 ? dec(v / 1e6) + ' млн' : v >= 1e4 ? num(v / 1e3) + ' тыс.' : v >= 10 ? num(v) : dec(v));
  const us = (ms) => num(ms * 1000) + ' мкс';
  const NET = 0.25; // допущение: один сетевой переход внутри ЦОД, мс (книга: круг по сети около 500 мкс)
  const JITTER = 0.5; // допущение: пул потоков, блокировки и переключения контекста добавляют к p99 около 500 мкс
  const HOTSYM = 0.05; // допущение: самый торгуемый символ берёт 5% заявок
  const BROKERS = 100, SEND_US = 5; // допущение: брокеров на рыночных данных и мкс на отправку одному по TCP
  const REPLAY_S = 1000, SNAP_S = 60; // допущение: переиграть день событий с нуля около 1000 с, со снапшота около минуты
  const GW = ['gateway', 'kbGw'], RISK = ['risk', 'fpga'], SEQ = ['sequencer', 'kafkaSeq'], ME = ['matching', 'auction'];

  const ME_MORE = [
    { title: '📗 Стакан заявок', items: [
      ['Уровни цены', 'Для каждой цены очередь заявок по времени (FIFO). Покупки отсортированы по убыванию, продажи по возрастанию.'],
      ['Двусвязный список', 'Заявки уровня в двусвязном списке, а map order_id → узел списка: добавить, отменить и исполнить за O(1).'],
      ['Матчинг', 'Пришла покупка по цене не ниже лучшей продажи: исполняем с головы очереди лучшего уровня, остаток встаёт в стакан.'],
      ['Детерминизм', 'Одни и те же входные события в том же порядке дают те же сделки. Отсюда восстановление переигрыванием и горячий резерв.'],
      ['FIFO с LMM', 'Вариант книги: часть объёма сначала получает ведущий маркет-мейкер (lead market maker), остальное по времени.'],
    ] },
    { title: '🔢 Sequencer', items: [
      ['Зачем', 'Ставит порядковый номер каждой входящей заявке и каждому исходящему исполнению. Номер задаёт единый порядок.'],
      ['Что даёт', 'Своевременность и честность, быстрое восстановление и переигрывание, ровно один раз: пропуск номера сразу виден.'],
      ['Event store', 'Последовательность событий это event store: всё состояние биржи из него выводится.'],
    ] },
  ];
  const PERF_MORE = [
    { title: '⚡ Задержка критического пути', items: [
      ['Формула', 'Задержка = сумма задержек компонентов на пути заявки. Уменьшаем число шагов и время каждого.'],
      ['Один сервер', 'Gateway → order manager → sequencer → matching на одной машине: нет сетевых переходов по 250 мкс.'],
      ['mmap', 'Компоненты общаются через файл, отображённый в память (/dev/shm): запись это запись в память, без сети и диска на пути.'],
      ['Application loop', 'Один поток в цикле опрашивает задачи, поток прибит к ядру CPU: нет блокировок, переключений контекста и пауз.'],
      ['p99', 'Важна не только медиана, но и хвост: джиттер в p99 это то, что видят трейдеры. Нельзя пауз GC и блокировок.'],
    ] },
    { title: '🧪 Расширения (не из книги)', items: [
      ['Kernel bypass', 'DPDK, Solarflare Onload: сетевая карта пишет прямо в память процесса, мимо ядра. Гейтвей отвечает за единицы микросекунд.'],
      ['FPGA', 'Проверка рисков на плате FPGA рядом с сетевой картой: сотни наносекунд.'],
      ['Частые аукционы', 'Вместо непрерывного матчинга аукцион раз в 100 мс по одной цене: гонка за микросекунды теряет смысл (Budish и др.). Цена: заявка ждёт до 100 мс.'],
    ] },
  ];
  const HA_MORE = [
    { title: '🛟 Отказоустойчивость', items: [
      ['Горячий-тёплый', 'Тёплый matching engine читает тот же поток событий и строит тот же стакан, но не публикует. Упал горячий: тёплый становится горячим за доли секунды.'],
      ['Детектор', 'Heartbeat от горячего. Ложное срабатывание опасно: два горячих сразу. Поэтому лидер один.'],
      ['Raft', 'Event store реплицируется на кластер из 5 серверов через Raft. Упал сервер целиком: новый лидер с теми же событиями, RTO секунды, RPO почти ноль.'],
      ['Снапшоты', 'Без них восстановление это переигрывание всего дня.'],
    ] },
    { title: '📡 Рыночные данные', items: [
      ['Публикатор', 'Market data publisher строит из исполнений стакан (L1, L2, L3) и свечи, кольцевые буферы вместо очередей.'],
      ['Честность', 'Тот, кто получил данные раньше, торгует раньше. Рассылка по TCP по очереди даёт первым преимущество.'],
      ['Multicast', 'Надёжный UDP multicast: все подписчики получают пакет одновременно. Плюс колокация: стойки брокеров в ЦОД биржи с одинаковыми кабелями.'],
      ['Безопасность', 'Публичные сервисы (данные) отделены от торговых. Кэш данных, rate limiting, safelist и blocklist IP против DDoS.'],
    ] },
  ];

  const CORE = ['Брокер (клиенты)', 'Периметр: rate limit, safelist', 'Client gateway', 'Order manager', 'Risk manager', 'Wallet: средства', 'Sequencer', 'Matching engine', 'Market data publisher', 'Data service', 'Reporter', 'История и отчёты'];

  g.LAB = {
    id: 'ch13', n: 13, title: 'Stock Exchange', subtitle: 'Биржа: матчинг заявок за микросекунды',
    intro: 'Электронная биржа: брокеры шлют лимитные заявки на покупку и продажу, matching engine сводит их в сделки, а рыночные данные расходятся всем участникам. Миллиард заявок в день на 100 символов, в пик больше 200 тысяч в секунду. Но главное не пропускная способность, а задержка: критический путь заявки укладывается в микросекунды, и хвост p99 так же важен, как медиана. Цифры по памяти книги, сверяйся с ней.',
    kpiFlows: [{ id: 'order', label: 'Заявка' }, { id: 'md', label: 'Рыночные данные' }], mainFlow: 'order',
    cx: [16, 24],

    steps: [
      { id: 'req', title: 'Требования', sub: 'заявки, стакан, данные', kind: 'req', tag: '~5 мин', guide: 'Отметь функции и ограничения. Главное: лимитные заявки и отмена, matching, рыночные данные, задержка в миллисекундах и стабильный p99.' },
      { id: 'est', title: 'Оценка нагрузки', sub: 'миллиард заявок в день', kind: 'est', tag: '~3 мин', guide: 'Покрути слайдеры. Вывод: 43 тысячи заявок в секунду, в пик 215 тысяч: это не много, трудность в задержке.' },
      { id: 'api', title: 'API и данные', sub: 'заявка, исполнения, стакан', kind: 'api', tag: '~5 мин', guide: 'POST /v1/order, исполнения, стакан L2, свечи. Стакан в памяти matching engine, история в БД.' },
      { id: 'hld', title: 'Дизайн', sub: 'схема на карте', kind: 'map', stage: 'base', tag: '~10 мин', guide: 'Брокер → gateway → order manager (риски, средства) → sequencer → matching engine. Исполнения обратно, рыночные данные через publisher, отчёты отдельно.' },
      { id: 'deep', title: 'Углубление', sub: 'проблемы и решения', kind: 'map', stage: 'deep', tag: '~15 мин', guide: 'Один сервер и mmap, application loop, стакан за O(1), горячий-тёплый и Raft, честные рыночные данные, DDoS.' },
      { id: 'sum', title: 'Итог', sub: 'рассказ для интервью', kind: 'sum', tag: '~5 мин', guide: 'Перескажи решение по шагам и ответь на вопросы для повторения.' },
    ],

    requirements: {
      intro: 'Сначала договариваемся, что строим. Отметь то, что входит в задачу, и нажми «Проверить». Книга строит электронную биржу акций: лимитные заявки, отмена, matching, рыночные данные.',
      groups: [
        { kind: 'fr', title: 'Функциональные (FR)', q: 'Что система делает', desc: 'Функции из книги: лимитные заявки, отмена, рыночные данные, проверка рисков и средств.', items: [
          { text: 'Принять лимитную заявку на покупку или продажу', in: true, why: 'Главная операция биржи.', to: 'POST /v1/order', shapes: [
            ['latency', 2, 'Критический путь за микросекунды.'],
            ['fair', 1, 'Порядок заявок честный и единый.'],
          ] },
          { text: 'Отменить заявку', in: true, why: 'Трейдеры отменяют большую часть заявок.', to: 'стакан за O(1)' },
          { text: 'Получать исполнения в реальном времени', in: true, why: 'Брокер должен знать о сделке сразу.', to: 'исполнения через sequencer' },
          { text: 'Видеть стакан и свечи в реальном времени', in: true, why: 'Рыночные данные для всех участников.', to: 'Market data publisher', shapes: [
            ['fair', 2, 'Все получают данные одновременно.'],
          ] },
          { text: 'Проверить риски и средства до матчинга', in: true, why: 'Книга: лимит, например не больше миллиона акций Apple в день, и хватает ли денег.', to: 'Risk manager, Wallet' },
          { text: 'Рыночные заявки и стоп-заявки', in: false, why: 'Книга берёт только лимитные: остальные строятся поверх.' },
          { text: 'Маржинальная торговля и деривативы', in: false, why: 'Вне рамок главы.' },
          { text: 'Клиринг и расчёты после торгов', in: false, why: 'Отдельная система: отчёты передаются туда.' },
        ] },
        { kind: 'nfr', title: 'Нефункциональные (NFR)', q: 'Насколько хорошо система это делает', desc: 'Книга: доступность 99,99%, отказоустойчивость, задержка в миллисекундах с упором на p99, безопасность.', items: [
          { text: 'Задержка в миллисекундах, стабильный p99', in: true, nfr: 'latency', why: 'Хвост задержки видят трейдеры: он важнее медианы.', to: 'один сервер, mmap, application loop' },
          { text: 'Доступность 99,99%', in: true, nfr: 'avail', why: 'Минута простоя биржи стоит огромных денег.', to: 'горячий-тёплый и Raft' },
          { text: 'Честный доступ к данным', in: true, nfr: 'fair', why: 'Никто не должен видеть цены раньше других.', to: 'multicast, колокация' },
          { text: 'Защита от DDoS и мошенничества', in: true, nfr: 'avail', why: 'Биржа это мишень. KYC и защита периметра.', to: 'периметр, rate limit' },
          { text: 'Миллионы заявок в секунду на старте', in: false, nfr: 'latency', why: 'Книга: 215 тысяч в пик. Трудность в задержке, а не в объёме.' },
        ] },
      ],
      start: {
        title: 'Почему всё начинается здесь',
        text: 'Нагрузка биржи скромная по меркам главы 12: сотни тысяч заявок в секунду. Зато каждая микросекунда на критическом пути стоит денег, и хвост p99 важнее медианы. На интервью проверяют, сможешь ли ты разложить задержку по шагам и убрать с пути сеть, диск и потоки, и как при этом сохранить единый порядок и отказоустойчивость.',
        chain: [
          { t: 'FR: что делаем', d: 'Лимитные заявки, отмена, исполнения, рыночные данные, риски.' },
          { t: 'NFR: насколько хорошо', d: 'Микросекунды и стабильный p99, 99,99%, честность.' },
          { t: 'Оценка: сколько', d: '43 тысячи заявок в секунду, пик 215 тысяч.' },
          { t: 'Технологии: что следует', d: 'Sequencer, matching в памяти, один сервер, mmap, Raft, multicast.' },
        ],
        skipTitle: 'Чего не берём',
        skip: [
          { t: 'Микросервисы по сети на критическом пути', d: 'Каждый переход это сотни микросекунд.' },
          { t: 'Kafka как секвенсор', d: 'Диск и сеть: миллисекунды и одна партиция на весь порядок.' },
          { t: 'БД на пути заявки', d: 'Стакан в памяти, события в mmap, БД только для отчётов.' },
        ],
        revisit: 'Решение верно, пока верны требования. Новое FR может поменять NFR, и тогда пересматривается архитектура. Примеры ниже.',
      },
      future: [
        { fr: 'Тысячи символов вместо сотни', breaks: ['latency'],
          now: 'Несколько matching engine на сервере.',
          why: 'Один сервер не держит все символы.',
          fix: 'Шардировать символы по серверам, у каждой группы свой sequencer и event store.' },
        { fr: 'Регулятор требует аудит каждой заявки', breaks: ['avail'],
          now: 'Event store и reporter.',
          why: 'Нужна неизменная история и выгрузки.',
          fix: 'Всё уже в event store: reporter выгружает в хранилище отчётов.' },
        { fr: 'Хотим торги в облаке', breaks: ['fair'],
          now: 'Свой ЦОД и колокация.',
          why: 'Нет multicast и одинаковых кабелей, задержка неровная.',
          fix: 'Выравнивание задержек (speed bump) или частые аукционы.' },
        { fr: 'Крипто-биржа 24/7', breaks: ['avail'],
          now: 'Торги днём, обслуживание ночью.',
          why: 'Окна на обслуживание нет.',
          fix: 'Raft и переключение без остановки, rolling-обновления.' },
      ],
      nfr: [
        { id: 'latency', name: 'Задержка', en: 'Latency', key: true, what: 'Критический путь заявки.', metric: 'p50 и p99 до matching.', drives: 'Один сервер, mmap, application loop.', here: 'Десятки микросекунд.' },
        { id: 'avail', name: 'Доступность', en: 'Availability', key: true, what: 'Биржа торгует при сбое сервера.', metric: 'Секунд простоя.', drives: 'Горячий-тёплый, Raft, снапшоты.', here: '99,99%.' },
        { id: 'fair', name: 'Честность', en: 'Fairness', key: true, what: 'Порядок и данные одинаковы для всех.', metric: 'Разница прихода данных.', drives: 'Sequencer, multicast, колокация.', here: 'Одновременно.' },
      ],
      conclusion: 'Итог: лимитные заявки, отмена, исполнения, рыночные данные. Главное задержка и её хвост. Дальше посчитаем заявки.',
    },

    estimate: {
      intro: 'Как в книге: 100 символов, миллиард заявок в день, торги с 9:30 до 16:00, то есть 6,5 часа. Пик в 5 раз выше среднего. Около 30% заявок исполняются (допущение), остальные отменяются или ждут. Событие в event store около 64 байт.',
      scnNote: 'Пик это открытие торгов и новости: книга берёт ×5. DDoS это мусорные запросы на вход: в углублении от них защищает периметр.',
      inputs: [
        { id: 'ordersB', label: 'Заявок в день', unit: 'млрд', min: 0.1, max: 10, step: 0.1, value: 1 },
        { id: 'hours', label: 'Часов торгов', unit: 'ч', min: 1, max: 24, step: 0.5, value: 6.5 },
        { id: 'symbols', label: 'Символов', unit: '', min: 10, max: 10000, step: 10, value: 100 },
        { id: 'fillPct', label: 'Заявок с исполнением', unit: '%', min: 5, max: 100, step: 5, value: 30 },
      ],
      rows: (d) => [
        { short: 'Заявки', label: 'Заявок в секунду', uses: ['ordersB', 'hours'], from: [], formula: 'заявки ÷ (6,5 ч × 3600 с)', v: d.qps,
          calc: (d, i, f) => `${f(i.ordersB * 1e9)} ÷ ${f(i.hours * 3600)} = ${f(d.qps)}/с`,
          why: 'Книга: около 43 тысяч в секунду.', to: 'все остальные строки' },
        { short: 'Пик', label: 'Заявок в пик', uses: ['peak'], from: [0], peak: true, flows: ['order'], formula: 'заявки × 5', v: d.peakQps,
          calc: (d, i, f) => `${f(d.qps)} × ${d.k} = ${f(d.peakQps)}/с`,
          why: 'Книга: 215 тысяч в секунду. Один matching engine в памяти держит больше.', to: 'карта: «Заявка»' },
        { short: 'Символ', label: 'Заявок на символ в пик', uses: ['symbols'], from: [1], formula: 'пик ÷ символы', v: d.perSym,
          calc: (d, i, f) => `${f(d.peakQps)} ÷ ${i.symbols} = ${f(d.perSym)}/с`,
          why: 'Символы независимы: matching engine делятся по символам. Самый торгуемый берёт больше средней доли.', to: 'Matching engine' },
        { short: 'Сделки', label: 'Исполнений в пик', uses: ['fillPct'], from: [1], flows: ['fill', 'md'], formula: 'пик × доля исполнений', v: d.fills,
          calc: (d, i, f) => `${f(d.peakQps)} × ${i.fillPct}% = ${f(d.fills)}/с`,
          why: 'Каждое исполнение идёт брокеру, в рыночные данные и в отчёты.', to: 'Sequencer, publisher, reporter' },
        { short: 'События', label: 'Event store за день, ГБ', uses: [], from: [0, 3], formula: '(заявки + исполнения) × 64 Б', v: d.storeGB,
          calc: (d, i, f) => `${f(d.eventsDay)} × 64 Б = ${f(d.storeGB)} ГБ`,
          why: 'Помещается на локальный SSD и в память: event store на mmap реален.', to: 'Sequencer, event store' },
      ],
      conclusion: (d) => `${big(d.qps)} заявок в секунду, в пик ${big(d.peakQps)}, ${big(d.storeGB)} ГБ событий в день. По объёму это немного: трудность в том, чтобы пройти путь заявки за десятки микросекунд.`,
    },

    api: {
      intro: 'API брокеров из книги: заявка, исполнения, стакан и свечи. В реальности брокеры говорят по FIX, а не по REST, но смысл тот же. Стакан живёт в памяти matching engine, а история заявок и сделок в БД отчётов, вне критического пути.',
      journeyTitle: 'Путь заявки',
      conventions: [
        { k: 'Протокол', v: 'REST в книге, в жизни FIX' },
        { k: 'Тип заявки', v: 'Только лимитная: цена и количество' },
        { k: 'Порядок', v: 'Sequencer ставит номер каждой заявке и исполнению' },
        { k: 'Стакан', v: 'В памяти: уровни цены и двусвязные списки' },
        { k: 'История', v: 'Event store на mmap, отчёты в БД отдельно' },
        { k: 'Задержка', v: 'Микросекунды, важен p99' },
      ],
      journey: [
        { ep: 'order', text: 'Брокер ставит заявку' },
        { ep: 'exec', text: 'Узнаёт об исполнении' },
        { ep: 'book', text: 'Смотрит стакан' },
      ],
      endpoints: [
        { id: 'order', method: 'POST', path: '/v1/order', title: 'Заявка', who: 'брокер', flow: 'order', key: true,
          about: 'Лимитная заявка. Gateway проверяет и нормализует, order manager проверяет риски и средства, sequencer ставит номер, matching engine сводит.',
          body: { symbol: 'AAPL', side: 'buy', price: '191.25', orderType: 'limit', quantity: 100 },
          ok: { status: '200 OK', body: { id: 'o-4711', creationTime: 1700000000123, filledQuantity: 0, remainingQuantity: 100, status: 'new', symbol: 'AAPL', side: 'buy', price: '191.25' } },
          errors: [['403', 'RISK_LIMIT', 'Превышен дневной лимит по символу'], ['402', 'INSUFFICIENT_FUNDS', 'Не хватает средств']],
          sql: '-- в памяти matching engine:\nlevel = bids[191.25] ?: newLevel()\nlevel.append(order)            // O(1), конец очереди\nindex[order.id] = node          // для отмены за O(1)',
          reads: ['стакан'], writes: ['event store', 'стакан'] },
        { id: 'exec', method: 'GET', path: '/v1/execution', title: 'Исполнения', who: 'брокер', flow: 'fill', key: true,
          about: 'Сделки по символу и заявке за период. В реальном времени исполнения приходят брокеру потоком через gateway.',
          params: [['symbol', 'query', 'string', true, 'AAPL'], ['orderId', 'query', 'string', false, 'o-4711'], ['startTime', 'query', 'long', true, 'Начало, мс'], ['endTime', 'query', 'long', true, 'Конец, мс']],
          example: 'GET /v1/execution?symbol=AAPL&orderId=o-4711&startTime=…&endTime=…',
          ok: { status: '200 OK', body: { executions: [{ id: 'e-91', orderId: 'o-4711', price: '191.25', quantity: 100, side: 'buy' }] } },
          errors: [['404', 'NOT_FOUND', 'Нет такой заявки']],
          sql: "SELECT * FROM execution WHERE symbol = 'AAPL' AND order_id = 'o-4711' AND ts BETWEEN ? AND ?",
          reads: ['execution'], writes: [] },
        { id: 'book', method: 'GET', path: '/marketdata/orderBook/L2', title: 'Стакан L2', who: 'брокер', flow: 'md', key: false,
          about: 'Агрегированный стакан: объём на каждом уровне цены до заданной глубины. Отдаёт data service, а не matching engine.',
          params: [['symbol', 'query', 'string', true, 'AAPL'], ['depth', 'query', 'int', false, 'Сколько уровней']],
          example: 'GET /marketdata/orderBook/L2?symbol=AAPL&depth=5',
          ok: { status: '200 OK', body: { bids: [['191.25', 2300], ['191.24', 900]], asks: [['191.26', 1500], ['191.27', 4100]] } },
          errors: [['404', 'NOT_FOUND', 'Нет такого символа']],
          sql: '-- data service: снимок стакана из рыночных данных', reads: ['стакан L2'], writes: [] },
      ],
      dbs: [
        { id: 'mem', name: 'Стакан', owner: 'Память matching engine', why: 'Микросекунды: на пути заявки нет БД.' },
        { id: 'ev', name: 'События', owner: 'Event store на mmap', why: 'Все заявки и исполнения по порядку.' },
        { id: 'rep', name: 'Отчёты', owner: 'БД отчётов', why: 'История, свечи, выгрузки регулятору.' },
      ],
      tables: [
        { name: 'order', db: 'rep', why: 'История заявок.', rows: '≈ 1 млрд в день',
          cols: [{ n: 'order_id', t: 'string', k: 'PK', d: 'o-4711' }, { n: 'symbol', t: 'string', d: 'AAPL' }, { n: 'side', t: 'enum', d: 'buy, sell' }, { n: 'price', t: 'decimal', d: '191.25' }, { n: 'quantity', t: 'long', d: '100' }, { n: 'status', t: 'enum', d: 'new, partially_filled, filled, canceled' }, { n: 'seq', t: 'long', d: 'Номер от sequencer' }] },
        { name: 'execution', db: 'rep', why: 'Сделки.', rows: '≈ 300 млн в день',
          cols: [{ n: 'exec_id', t: 'string', k: 'PK', d: 'e-91' }, { n: 'order_id', t: 'string', d: 'Заявка', ref: { t: 'order', c: 'order_id' } }, { n: 'price', t: 'decimal', d: 'Цена сделки' }, { n: 'quantity', t: 'long', d: 'Объём' }, { n: 'seq', t: 'long', d: 'Номер от sequencer' }] },
        { name: 'order book (в памяти)', db: 'mem', why: 'Уровни цены с очередями заявок.', rows: '≈ 100 стаканов',
          cols: [{ n: 'price', t: 'decimal', k: 'PK', d: 'Уровень' }, { n: 'orders', t: 'dlist', d: 'Двусвязный список по времени' }, { n: 'volume', t: 'long', d: 'Сумма объёма уровня' }],
          extra: ['index: order_id → узел списка'] },
        { name: 'candlestick', db: 'rep', why: 'Свечи для графиков.', rows: '≈ символы × интервалы',
          cols: [{ n: 'symbol', t: 'string', k: 'PK', d: 'AAPL' }, { n: 'open_ts', t: 'long', k: 'PK', d: 'Начало интервала' }, { n: 'open', t: 'decimal', d: '' }, { n: 'high', t: 'decimal', d: '' }, { n: 'low', t: 'decimal', d: '' }, { n: 'close', t: 'decimal', d: '' }, { n: 'volume', t: 'long', d: '' }] },
      ],
      more: {
        intro: 'Для интервью хватает таблиц выше. Ниже то, что добавляют, когда растут требования.',
        tables: [
          { name: 'product', when: 'Справочник символов: шаг цены, лот, часы торгов.', cols: 'symbol, description, tick_size, lot_size' },
          { name: 'snapshot', when: 'Восстановление стакана со снапшота, а не с начала дня.', cols: 'symbol, seq, book_blob' },
        ],
        endpoints: [
          { ep: 'GET /marketdata/candles?symbol&resolution&startTime&endTime', when: 'Свечи для графиков, из data service.' },
          { ep: 'DELETE /v1/order/{id}', when: 'Отмена заявки: удаление из списка уровня за O(1).' },
        ],
      },
      quiz: [
        { q: 'Где живёт стакан?', a: 'В памяти matching engine: уровни цены, двусвязные списки, map order_id → узел.' },
        { q: 'Зачем sequencer?', a: 'Единый порядок заявок и исполнений: детерминизм, переигрывание, честность.' },
        { q: 'Почему БД не на пути заявки?', a: 'Диск и сеть это миллисекунды. История пишется в event store и отчёты отдельно.' },
        { q: 'Как отменить заявку за O(1)?', a: 'Найти узел по order_id в map и вынуть его из двусвязного списка.' },
      ],
    },

    board: { w: 1240, h: 820 },
    scenario: [
      { id: 'peak', label: 'Пик', unit: '×', stops: [1, 5, 10, 20], value: 5, hint: 'Во сколько раз пик выше среднего. Книга: ×5' },
      { id: 'ddos', label: 'DDoS', unit: 'млн/с', stops: [0, 1, 10], value: 0, hint: 'Мусорных запросов в секунду на публичный вход. Защиту разбирает углубление' },
    ],
    groups: ['Вход', 'Торговля', 'Данные'],
    expGroups: ['Торговля', 'Вход'],

    blocks: {
      broker: { name: 'Брокер (клиенты)', icon: '💼', cat: 'edge', group: 'Вход', pos: [20, 380], cap: 0, tag: 'Robinhood, Interactive Brokers',
        learn: { what: 'Брокеры принимают заявки своих клиентов и шлют их на биржу. Получают исполнения и рыночные данные. Часто стоят в ЦОД биржи (колокация).', plus: [], minus: [] } },
      shield: { name: 'Периметр: rate limit, safelist', icon: '🛡️', cat: 'edge', group: 'Вход', via: true, pos: [250, 180], cap: 2000000, lat: 0.002, cost: 200, cx: 1, maxRep: 20,
        links: [['broker', 'self'], ['self', GW]], drop: [['broker', 'gateway'], ['broker', 'kbGw']], tag: 'Мусор отсекается до gateway',
        fit: { use: 'Публичный вход под DDoS.', avoid: 'Внутри ЦОД между своими сервисами.', limits: 'Ещё микросекунды на входе.' },
        learn: { more: HA_MORE, what: 'Книга, сетевая безопасность: публичные сервисы отделены от торговых, rate limiting, safelist и blocklist IP, кэш публичных данных. Мусорные запросы не доходят до gateway.', plus: ['DDoS не мешает торговле'], minus: [] } },
      gateway: { name: 'Client gateway', icon: '🚪', cat: 'svc', group: 'Вход', pos: [250, 380], cap: 100000, lat: 0.02, cost: 120, cx: 0.5, maxRep: 50,
        links: [['broker', 'self'], ['self', 'orderMgr'], ['orderMgr', 'self'], ['self', 'broker']], tag: 'Проверка, нормализация, rate limit',
        learn: { what: 'Принимает заявки брокеров: аутентификация, проверка полей, ограничение частоты, нормализация. Отдаёт брокеру исполнения. Должен быть лёгким: каждая микросекунда здесь на критическом пути.', plus: [], minus: [] } },
      orderMgr: { name: 'Order manager', icon: '📋', cat: 'svc', group: 'Торговля', pos: [480, 380], cap: 500000, lat: 0.01, cost: 100, cx: 0.5, maxRep: 20,
        links: [[GW, 'self'], ['self', SEQ], ['self', RISK], ['self', 'wallet'], [SEQ, 'self']], tag: 'Состояние заявок',
        learn: { more: PERF_MORE, what: 'Принимает заявку, зовёт risk manager и wallet, отправляет в sequencer. Получает исполнения и обновляет состояние заявок. Книга встраивает его в компоненты на одном сервере через event sourcing.', plus: [], minus: [] } },
      risk: { name: 'Risk manager', icon: '⚠️', cat: 'svc', group: 'Торговля', pos: [480, 180], cap: 1000000, lat: 0.02, cost: 80, cx: 0.5, maxRep: 20,
        links: [['orderMgr', 'self']], tag: 'Лимиты по символу',
        learn: { what: 'Проверяет лимиты: например, не больше миллиона акций Apple на пользователя в день. Простые правила в памяти.', plus: [], minus: [] } },
      wallet: { name: 'Wallet: средства', icon: '👛', cat: 'svc', group: 'Торговля', pos: [480, 590], cap: 1000000, lat: 0.01, cost: 80, cx: 0.5, maxRep: 20,
        links: [['orderMgr', 'self']], tag: 'Хватает ли денег',
        learn: { what: 'Проверяет и резервирует средства под заявку. Резерв снимается при отмене или исполнении.', plus: [], minus: [] } },
      sequencer: { name: 'Sequencer', icon: '🔢', cat: 'async', group: 'Торговля', pos: [720, 380], cap: 3000000, lat: 0.005, cost: 150, cx: 1, maxRep: 1, repLabel: 'шт.',
        links: [['orderMgr', 'self'], ['self', ME], [ME, 'self'], ['self', 'orderMgr'], ['self', 'reporter']], tag: 'Номер каждой заявке и исполнению',
        learn: { more: ME_MORE, what: 'Ставит порядковый номер каждой входящей заявке и каждому исходящему исполнению. Это и есть event store: из него выводится всё состояние, его переигрывают при сбое. Один на группу символов: порядок должен быть единым.', plus: ['Детерминизм', 'Переигрывание'], minus: ['Один на группу символов'] } },
      matching: { name: 'Matching engine', icon: '⚖️', cat: 'svc', group: 'Торговля', pos: [960, 380], cap: 300000, lat: 0.01, cost: 200, cx: 1, maxRep: 100, repLabel: 'движ.',
        links: [['sequencer', 'self'], ['kafkaSeq', 'self'], ['self', SEQ], ['self', 'mdPub']], tag: 'Стакан и сделки',
        learn: { more: ME_MORE, what: 'Держит стакан каждого символа в памяти и сводит заявки по цене и времени. Детерминирован: те же события дают те же сделки. Движки делятся по символам.', plus: ['O(1) на заявку'], minus: ['Самый торгуемый символ в одном движке'] } },
      mdPub: { name: 'Market data publisher', icon: '📡', cat: 'svc', group: 'Данные', pos: [960, 160], cap: 1000000, lat: 0.01, cost: 100, cx: 0.5, maxRep: 20,
        links: [[ME, 'self'], ['self', 'dataSvc']], tag: 'Стакан L1/L2, свечи',
        learn: { more: HA_MORE, what: 'Из исполнений и изменений стакана строит рыночные данные: лучшие цены, стакан L2, свечи. Кольцевые буферы вместо очередей.', plus: [], minus: [] } },
      dataSvc: { name: 'Data service', icon: '📈', cat: 'svc', group: 'Данные', pos: [720, 30], cap: 500000, lat: 0.02, cost: 100, cx: 0.5, maxRep: 50,
        links: [['mdPub', 'self'], ['self', 'broker']], tag: 'Рассылка брокерам',
        learn: { more: HA_MORE, what: 'Рассылает рыночные данные подписчикам и отвечает на запросы стакана и свечей. Публичный сервис, отделённый от торгового пути.', plus: [], minus: [] } },
      reporter: { name: 'Reporter', icon: '🧾', cat: 'svc', group: 'Данные', pos: [960, 600], cap: 1000000, lat: 0.05, cost: 60, cx: 0.5, maxRep: 20,
        links: [[SEQ, 'self'], ['self', 'reportDB']], tag: 'Вне критического пути',
        learn: { what: 'Читает заявки и исполнения из event store и пишет в БД отчётов: история, налоги, регулятор. Не на критическом пути.', plus: [], minus: [] } },
      reportDB: { name: 'История и отчёты', icon: '🗄️', cat: 'db', group: 'Данные', pos: [720, 680], cap: 100000, lat: 5, cost: 300, cx: 1, db: true, maxRep: 50, repLabel: 'узл.',
        links: [['reporter', 'self']], tag: 'order, execution, candlestick',
        learn: { what: 'Заявки, сделки и свечи для отчётов и API истории. Миллисекунды записи здесь никому не мешают.', plus: [], minus: [] } },

      // ---------- эксперименты ----------
      kafkaSeq: { name: 'Kafka как секвенсор', logo: 'kafka', icon: '📨', cat: 'async', extra: true, group: 'Торговля', pos: [720, 560], cap: 200000, lat: 2, cost: 150, cx: 1, maxRep: 1, repLabel: 'парт.',
        links: [['orderMgr', 'self'], ['self', ME], [ME, 'self'], ['self', 'orderMgr'], ['self', 'reporter']], drop: [['orderMgr', 'sequencer'], ['sequencer', 'matching'], ['matching', 'sequencer'], ['sequencer', 'orderMgr'], ['sequencer', 'reporter'], ['sequencer', 'auction'], ['auction', 'sequencer']], tag: 'Одна партиция ради порядка',
        fit: { use: 'Обычная очередь событий, где миллисекунды не важны.', avoid: 'Критический путь биржи.', limits: 'Общий порядок значит одна партиция: её предел и диск с сетью на пути.' },
        learn: { more: PERF_MORE, what: 'Эксперимент: взять Kafka вместо своего sequencer. Порядок по всем заявкам требует одной партиции, а это предел пропускной способности, плюс сеть и диск: миллисекунды вместо микросекунд.', plus: ['Готовый продукт'], minus: ['Миллисекунды', 'Одна партиция'] } },
      kbGw: { name: 'Gateway с kernel bypass', icon: '🏎️', cat: 'svc', extra: true, group: 'Вход', pos: [20, 600], cap: 500000, lat: 0.005, cost: 300, cx: 1, maxRep: 50,
        links: [['shield', 'self'], ['broker', 'self'], ['self', 'orderMgr'], ['orderMgr', 'self'], ['self', 'broker']], drop: [['broker', 'gateway'], ['shield', 'gateway'], ['gateway', 'orderMgr'], ['orderMgr', 'gateway'], ['gateway', 'broker']], tag: 'DPDK: мимо ядра ОС',
        fit: { use: 'Каждая микросекунда на входе на счету.', avoid: 'Если команда не готова к низкоуровневому сетевому коду.', limits: 'Свой сетевой стек, особые сетевые карты.' },
        learn: { more: PERF_MORE, what: 'Расширение. Сетевая карта кладёт пакеты прямо в память процесса (DPDK, Solarflare), без ядра и копирований. Gateway отвечает за единицы микросекунд.', plus: ['5 мкс вместо 20'], minus: ['Дорого и сложно'] } },
      fpga: { name: 'Risk-check на FPGA', icon: '🔌', cat: 'svc', extra: true, group: 'Торговля', pos: [250, 30], cap: 5000000, lat: 0.001, cost: 400, cx: 1, maxRep: 4,
        links: [['orderMgr', 'self']], drop: [['orderMgr', 'risk']], tag: 'Проверка за наносекунды',
        fit: { use: 'Простые правила рисков на пути заявки.', avoid: 'Сложные правила, которые часто меняются.', limits: 'Логика в железе: менять долго.' },
        learn: { more: PERF_MORE, what: 'Расширение. Лимиты проверяются на плате FPGA рядом с сетевой картой: около микросекунды и меньше.', plus: ['1 мкс'], minus: ['Правила в железе'] } },
      auction: { name: 'Частые аукционы (batch)', icon: '⏲️', cat: 'svc', extra: true, group: 'Торговля', pos: [960, 760], cap: 1000000, lat: 50, cost: 200, cx: 1, maxRep: 100, repLabel: 'движ.',
        links: [[SEQ, 'self'], ['self', SEQ], ['self', 'mdPub']], drop: [['sequencer', 'matching'], ['kafkaSeq', 'matching'], ['matching', 'sequencer'], ['matching', 'kafkaSeq'], ['matching', 'mdPub']], tag: 'Аукцион раз в 100 мс',
        fit: { use: 'Убрать гонку за микросекунды и преимущество колокации.', avoid: 'Если рынок ждёт непрерывной торговли.', limits: 'Заявка ждёт до 100 мс, в среднем 50.' },
        learn: { more: PERF_MORE, what: 'Расширение. Вместо непрерывного матчинга заявки копятся 100 мс и исполняются одним аукционом по единой цене. Опередить другого на микросекунду бессмысленно: честность без колокаций и multicast.', plus: ['Гонка задержек не нужна'], minus: ['+50 мс в среднем'] } },
    },

    flows: [
      { id: 'order', label: 'Заявка', color: 'var(--f1)', write: true, rate: (d) => d.peakQps, chain: ['broker', GW, 'orderMgr', SEQ, ME] },
      { id: 'fill', side: true, label: 'Исполнение', color: 'var(--f2)', write: true, rate: (d) => d.fills, chain: [ME, SEQ, 'orderMgr', GW, 'broker'] },
      { id: 'risk', side: true, label: 'Проверка рисков', color: 'var(--f3)', rate: (d) => d.peakQps, chain: ['orderMgr', RISK] },
      { id: 'funds', side: true, label: 'Проверка средств', color: 'var(--f4)', write: true, rate: (d) => d.peakQps, chain: ['orderMgr', 'wallet'] },
      { id: 'md', side: true, label: 'Рыночные данные', color: 'var(--f5)', rate: (d) => d.fills, chain: [ME, 'mdPub', 'dataSvc', 'broker'] },
      { id: 'report', side: true, label: 'Отчёты', color: 'var(--f6)', write: true, rate: (d) => d.peakQps + d.fills, chain: [SEQ, 'reporter', 'reportDB'] },
    ],

    derive: (i, deep) => {
      const p = (deep && deep.params) || {};
      const k = p.peak || 5, ddos = p.ddos || 0, qps = (i.ordersB * 1e9) / (i.hours * 3600), peakQps = qps * k, fills = (peakQps * i.fillPct) / 100;
      const eventsDay = i.ordersB * 1e9 * (1 + i.fillPct / 100);
      return { k, ddos, qps, peakQps, perSym: peakQps / i.symbols, fills, eventsDay, storeGB: (eventsDay * 64) / 1e9 };
    },

    reference: {
      base: {
        nodes: ['broker', 'gateway', 'orderMgr', 'risk', 'wallet', 'sequencer', 'matching', 'mdPub', 'dataSvc', 'reporter', 'reportDB'],
        edges: [['broker', 'gateway'], ['gateway', 'orderMgr'], ['orderMgr', 'risk'], ['orderMgr', 'wallet'], ['orderMgr', 'sequencer'], ['sequencer', 'matching'], ['matching', 'sequencer'], ['sequencer', 'orderMgr'], ['orderMgr', 'gateway'], ['gateway', 'broker'], ['matching', 'mdPub'], ['mdPub', 'dataSvc'], ['dataSvc', 'broker'], ['sequencer', 'reporter'], ['reporter', 'reportDB']],
        adapt: [],
      },
      deep: {
        nodes: ['broker', 'shield', 'gateway', 'orderMgr', 'risk', 'wallet', 'sequencer', 'matching', 'mdPub', 'dataSvc', 'reporter', 'reportDB'],
        edges: [['broker', 'shield'], ['shield', 'gateway'], ['gateway', 'orderMgr'], ['orderMgr', 'risk'], ['orderMgr', 'wallet'], ['orderMgr', 'sequencer'], ['sequencer', 'matching'], ['matching', 'sequencer'], ['sequencer', 'orderMgr'], ['orderMgr', 'gateway'], ['gateway', 'broker'], ['matching', 'mdPub'], ['mdPub', 'dataSvc'], ['dataSvc', 'broker'], ['sequencer', 'reporter'], ['reporter', 'reportDB']],
        adapt: [],
      },
    },

    problems: [
      { id: 'path', icon: '⚡', title: 'Критический путь', key: 'path',
        problem: `Gateway, order manager, risk, wallet, sequencer и matching это отдельные сервисы, между ними сеть по ${us(NET)} на переход, а sequencer пишет на диск. Как уложиться в микросекунды?`,
        options: [
          { v: 'net', label: 'Сервисы по сети', note: 'Каждый переход и каждый вызов risk и wallet это сеть. Набегают миллисекунды.' },
          { v: 'mmap', label: 'Один сервер, mmap', note: 'Компоненты критического пути на одной машине, общаются через event store в разделяемой памяти (mmap). Ни сети, ни диска на пути. Так в книге.' },
        ],
        best: ['mmap'], say: 'Задержка это сумма шагов, поэтому убираю шаги и сокращаю каждый. Gateway дальше, а order manager, риски, sequencer и matching ставлю на один сервер: общаются через event store на mmap, без сети и диска. Критический путь получается в десятки микросекунд.' },
      { id: 'loop', icon: '🔄', title: 'Хвост p99', key: 'loop',
        problem: 'Медиана хорошая, а p99 в разы хуже: потоки ждут блокировок, ОС переключает контекст. Что делать?',
        options: [
          { v: 'threads', label: 'Пул потоков', note: `Обычные потоки и блокировки. В хвосте p99 около ${us(JITTER)} сверху: блокировки, переключения контекста, паузы.` },
          { v: 'pinned', label: 'Application loop', note: 'Один поток крутится в цикле и опрашивает задачи, поток прибит к ядру CPU. Нет блокировок и переключений. Так в книге.' },
        ],
        best: ['pinned'], say: 'Каждый компонент это application loop: один поток в цикле опрашивает задачи, прибит к своему ядру. Нет блокировок и переключений контекста, поэтому p99 близок к медиане. Важен именно хвост: его видят трейдеры.' },
      { id: 'book', icon: '📗', title: 'Стакан заявок', key: 'book',
        problem: `Трейдеры ставят и отменяют заявки тысячами в секунду на одном символе, а самый торгуемый символ берёт около ${Math.round(HOTSYM * 100)}% всех заявок. Как хранить стакан?`,
        options: [
          { v: 'list', label: 'Список заявок', note: 'Массив заявок на уровне цены: отмена ищет заявку перебором. Движок держит в десятки раз меньше заявок.' },
          { v: 'dll', label: 'Уровни + двусвязный список', note: 'Уровни цены, на каждом двусвязный список по времени, и map order_id → узел. Добавить, отменить, исполнить за O(1). Так в книге.' },
        ],
        best: ['dll'], say: 'Стакан это уровни цены, на каждом двусвязный список заявок по времени, плюс map order_id → узел. Добавление в конец, отмена через map и исполнение с головы, всё за O(1). Matching детерминирован: те же события дают те же сделки.' },
      { id: 'ha', icon: '🛟', title: 'Сервер matching engine умер', key: 'ha',
        problem: 'Сервер с matching engine потерян целиком. Сколько биржа стоит?',
        options: [
          { v: 'cold', label: 'Поднять и переиграть', note: `Новый сервер переигрывает события дня с начала: около ${Math.round(REPLAY_S / 60)} минут простоя.` },
          { v: 'hotwarm', label: 'Горячий-тёплый', note: `Тёплый движок рядом читает те же события и подхватывает за доли секунды. Но если умер весь сервер, умерли оба: поднимаем со снапшота, около ${SNAP_S} с.` },
          { v: 'raft', label: 'Горячий-тёплый + Raft', note: 'Event store реплицируется на кластер из 5 серверов через Raft, тёплые движки на других серверах. Новый лидер за секунды, события не теряются. Так в книге.' },
        ],
        best: ['raft'], say: 'Matching детерминирован, поэтому держу тёплый движок, который читает тот же поток событий и строит тот же стакан. Чтобы пережить смерть сервера целиком, event store реплицируется Raft на кластер из пяти серверов: новый лидер за секунды, RPO почти ноль. Снапшоты ускоряют восстановление.' },
      { id: 'md', icon: '📡', title: 'Рыночные данные', key: 'md',
        problem: `${BROKERS} брокеров подписаны на рыночные данные. Кто получает обновление первым?`,
        options: [
          { v: 'tcp', label: 'TCP каждому', note: `Отправляем по очереди: последний получает на ${us((BROKERS * SEND_US) / 1000)} позже первого и торгует позже. Нечестно.` },
          { v: 'multicast', label: 'Multicast', note: 'Надёжный UDP multicast: все получают пакет одновременно. Плюс колокация с одинаковыми кабелями. Так в книге.' },
        ],
        best: ['multicast'], say: 'Рыночные данные рассылаю надёжным UDP multicast: все подписчики получают пакет одновременно. Брокеры стоят в ЦОД биржи с кабелями одной длины. Publisher строит стакан и свечи на кольцевых буферах.' },
    ],

    metrics: [
      { id: 'jitter', label: 'Хвост p99', bad: true, sub: 'мкс сверх медианы' },
      { id: 'down', label: 'Простой при смерти сервера', bad: true, sub: 'секунд' },
      { id: 'unfair', label: 'Нечестные данные', bad: true, sub: 'мкс между первым и последним брокером' },
    ],

    model(ctx) {
      const { d, deep, nodes, flows, stage } = ctx, c = deep.choices, M = ctx.metrics;
      const all = Object.values(nodes), of = (t) => all.filter((n) => [].concat(t).includes(n.type)), F = (id) => flows.find((f) => f.id === id);
      const badge = (n, icon, title) => n && n.badges.push({ icon, title });
      const addLoad = (n, fid, x) => { if (!n || !x) return; n.load += x; n.flows[fid] = (n.flows[fid] || 0) + x; if (F(fid).write) n.wload += x; };
      const scale = (n, fid, m) => n && addLoad(n, fid, (n.flows[fid] || 0) * (m - 1));
      const via = (f, t) => f.ok && f.path.some((x) => [].concat(t).includes(nodes[x.id].type));
      const on = (f, t) => { const x = f.ok && f.path.find((y) => [].concat(t).includes(nodes[y.id].type)); return x ? nodes[x.id] : null; };
      M.jitter = M.down = M.unfair = 0;
      const o = F('order'), gw = on(o, GW), me = on(o, ME), seq = on(o, SEQ);

      // ---------- DDoS: мусор бьёт в первый публичный блок ----------
      if (d.ddos > 0 && o.ok) {
        const junk = d.ddos * 1e6, sh = via(o, 'shield') && of('shield')[0];
        if (sh) { addLoad(sh, 'order', junk); addLoad(gw, 'order', junk * 0.001); badge(sh, '🛡️', 'Мусор отсечён'); }
        else { addLoad(gw, 'order', junk); ctx.warn('warn', `${big(junk)} мусорных запросов в секунду идут прямо в gateway вместе с заявками.`); }
      }
      // ---------- риски и средства тоже на критическом пути ----------
      [['risk', RISK], ['funds', ['wallet']]].forEach(([id, t]) => { const n = on(F(id), t); if (n) o.extraLat += n.def.lat; });
      // самый торгуемый символ живёт в одном движке: движков полезно не больше 1 / его доля
      if (me && me.type === 'matching') { me.maxRep = Math.min(me.maxRep, Math.floor(1 / HOTSYM)); me.limitWhy = `самый торгуемый символ берёт ${Math.round(HOTSYM * 100)}% заявок, а его стакан в одном движке`; me.needWhy = 'быстрее стакан: O(1) на заявку'; }
      if (seq && seq.type === 'kafkaSeq') ctx.warn('warn', 'Kafka как sequencer: единый порядок требует одной партиции, а на пути заявки диск и сеть, это миллисекунды.');
      if (me && me.type === 'auction') ctx.warn('info', 'Частые аукционы: заявка ждёт следующего аукциона, в среднем 50 мс, зато опережать других на микросекунды бессмысленно.');
      if (stage !== 'deep') { if (o.ok) o.extraLat += 3 * NET + 4 * NET; return; } // в дизайне сервисы общаются по сети

      // ---------- критический путь ----------
      if (c.path === 'net') { o.extraLat += 3 * NET + 4 * NET; ctx.warn('warn', `Сервисы по сети: 3 перехода до matching и два вызова туда-обратно к risk и wallet, это ${us(7 * NET)} сверху.`); }
      else badge(of('sequencer')[0], '⚡', 'Один сервер, mmap');

      // ---------- хвост p99 ----------
      if (c.loop === 'threads') { M.jitter = JITTER * 1000; ctx.warn('warn', `Пул потоков и блокировки: p99 на ${us(JITTER)} хуже медианы.`); }
      else badge(me, '🔄', 'Application loop, поток на ядре');

      // ---------- стакан ----------
      if (me && me.type === 'matching') {
        if (c.book === 'list') { me.capMult *= 0.02; o.extraLat += 0.05; ctx.warn('warn', 'Отмена ищет заявку перебором уровня: движок держит в 50 раз меньше заявок.'); }
        else badge(me, '📗', 'Стакан за O(1)');
      }

      // ---------- отказ сервера ----------
      if (c.ha === 'cold') { M.down = REPLAY_S; ctx.warn('warn', `Без резерва новый сервер переигрывает день событий: около ${Math.round(REPLAY_S / 60)} минут биржа стоит.`); }
      else if (c.ha === 'hotwarm') { M.down = SNAP_S; ctx.warn('warn', `Горячий и тёплый на одном сервере: смерть сервера убивает обоих, подъём со снапшота около ${SNAP_S} с.`); }
      else badge(seq, '🛟', 'Raft: 5 серверов');

      // ---------- рыночные данные ----------
      if (me && me.type === 'auction') badge(me, '⏲️', 'Аукцион: гонка не нужна');
      else if (c.md === 'tcp') { M.unfair = BROKERS * SEND_US; ctx.warn('warn', `TCP по очереди: последний из ${BROKERS} брокеров получает данные на ${M.unfair} мкс позже первого.`); }
      else badge(of('mdPub')[0], '📡', 'Multicast');
    },

    overload: 'больше копий или резать мусор на входе',
    linkWhy(a, b) {
      const B = this.blocks;
      if (a === 'broker' && ['orderMgr', 'sequencer', 'matching', 'kafkaSeq', 'auction'].includes(b)) return 'Брокер ходит только через gateway: проверка и rate limit на входе.';
      if (a === 'broker' && B[b].db) return 'История доступна через API, но не напрямую из БД.';
      if (B[a].db) return 'БД отвечает на запросы, но сама никого не вызывает.';
      return '';
    },

    rules(ctx) {
      const { metrics: M, stage, d, flows } = ctx;
      if (M.down > 0) ctx.warn('bad', `Смерть сервера останавливает торги на ${num(M.down)} с.`);
      if (stage === 'base' && flows.every((f) => f.ok || f.optional)) ctx.warn('info', `Как показала оценка: в пик ${big(d.peakQps)} заявок в секунду, это немного. Сервисы по сети дают миллисекунды: в углублении убираем сеть с критического пути.`);
    },

    goals: {
      base: [
        { text: 'Заявки, исполнения, риски, данные и отчёты доходят до цели', check: (r) => r.m.routed },
        { text: 'Заявка доходит до matching быстрее 5 мс', check: (r) => r.m.routed && r.flows.find((f) => f.id === 'order').lat <= 5 },
        { text: 'Нагрузка выдерживается', check: (r) => r.m.served >= 1 && r.m.maxU <= 0.9 },
      ],
      deep: [
        { text: 'Критический путь быстрее 200 мкс', check: (r) => r.m.routed && r.flows.find((f) => f.id === 'order').lat <= 0.2 },
        { text: 'p99 без хвоста', check: (r) => r.m.routed && r.m.jitter === 0 },
        { text: 'Смерть сервера не останавливает торги', check: (r) => r.m.routed && r.m.down === 0 },
        { text: 'Рыночные данные всем одновременно', check: (r) => r.m.routed && r.m.unfair === 0 },
        { text: 'Пик ×5 и DDoS 10 млн/с выдерживаются', check: (r) => r.d.k >= 5 && r.d.ddos >= 10 && r.m.served >= 1 && r.m.maxU <= 0.9 },
      ],
    },

    summary: {
      db: 'reportDB', core: CORE,
      estCard: (d, f) => `${f(d.qps)} заявок/с, пик ${f(d.peakQps)}`,
      badRow: { label: 'Секунд простоя и мкс хвоста', ids: ['down', 'jitter'] },
      script: (x) => {
        const t = x.fmt, d = x.d, o = x.r.flows.find((f) => f.id === 'order');
        return [
          { step: 'Требования', min: 3, text: 'Биржа: лимитные заявки на покупку и продажу, отмена, исполнения в реальном времени, стакан и свечи, проверка рисков и средств. NFR: 99,99%, задержка в миллисекундах со стабильным p99, честность, защита от DDoS.' },
          { step: 'Оценка', min: 2, text: `1 млрд заявок за 6,5 часа это ${t(d.qps)} в секунду, в пик ${t(d.peakQps)}. Это немного: трудность в задержке, а не в объёме.` },
          { step: 'Дизайн', min: 5, text: 'Торговый поток: брокер → client gateway → order manager (risk, wallet) → sequencer → matching engine, исполнения обратно тем же путём. Рыночные данные: matching → publisher → data service. Отчёты: reporter читает event store и пишет в БД, вне критического пути.' },
          { step: 'Matching', min: 3, text: `${x.choice('book').say} Sequencer ставит номер каждой заявке и исполнению: единый порядок, переигрывание, детерминизм.` },
          { step: 'Задержка', min: 4, text: `${x.choice('path').say} ${x.choice('loop').say}${o && o.ok ? ` У меня критический путь около ${us(o.lat)}.` : ''}` },
          { step: 'Отказоустойчивость', min: 3, text: x.choice('ha').say },
          { step: 'Данные и безопасность', min: 3, text: `${x.choice('md').say} ${x.has('shield') ? 'Публичный вход за периметром: rate limit, safelist и blocklist, публичные данные отделены от торговли.' : 'Против DDoS нужен периметр: rate limit, safelist и blocklist.'}` },
          { step: 'Что изменится, если…', min: 2, text: 'Тысячи символов: шардирую символы по серверам, у каждой группы свой sequencer. Нужны наносекунды: kernel bypass и FPGA для рисков. Не хотим гонки задержек: частые аукционы раз в 100 мс.' },
        ];
      },
      says: {
        path: { net: 'Сервисы по сети: миллисекунды.', mmap: 'Один сервер, event store на mmap.' },
        loop: { threads: 'Пул потоков: хвост p99.', pinned: 'Application loop, поток прибит к ядру.' },
        book: { list: 'Список заявок: отмена перебором.', dll: 'Уровни цены и двусвязные списки, O(1).' },
        ha: { cold: 'Переигрываем день: минуты простоя.', hotwarm: 'Горячий-тёплый на одном сервере.', raft: 'Горячий-тёплый и Raft на 5 серверах.' },
        md: { tcp: 'TCP по очереди: нечестно.', multicast: 'UDP multicast и колокация.' },
      },
      tradeoffs: [
        { pick: 'Один сервер и mmap', alt: 'Микросервисы по сети', why: 'Десятки микросекунд. Цена: вертикальный предел одной машины, шардирование по символам.' },
        { pick: 'Application loop', alt: 'Пул потоков', why: 'Стабильный p99. Цена: одно ядро на компонент, свой стиль кода.' },
        { pick: 'Свой sequencer', alt: 'Kafka', why: 'Микросекунды и единый порядок. Цена: свой код хранения и репликации.' },
        { pick: 'Стакан на двусвязных списках', alt: 'Список заявок', why: 'O(1) на заявку и отмену. Цена: память на индекс.' },
        { pick: 'Горячий-тёплый + Raft', alt: 'Переиграть после сбоя', why: 'Секунды простоя. Цена: пять серверов и задержка репликации.' },
        { pick: 'Multicast', alt: 'TCP каждому', why: 'Честность. Цена: свой надёжный протокол поверх UDP, только в своём ЦОД.' },
      ],
      pitfalls: [
        'Говорить о шардировании под миллионы TPS вместо задержки.',
        'Ставить Kafka и БД на критический путь.',
        'Смотреть только на медиану и забыть p99.',
        'Забыть про sequencer и единый порядок.',
        'Стакан без индекса order_id: отмена перебором.',
        'Не объяснить, как пережить смерть сервера.',
        'Рассылать рыночные данные по очереди.',
      ],
      questions: [
        { q: 'Сколько заявок в секунду?', a: '1 млрд ÷ (6,5 × 3600) ≈ 43 тысячи, в пик ×5 около 215 тысяч.' },
        { q: 'Из чего состоит критический путь?', a: 'Gateway → order manager → risk и wallet → sequencer → matching engine.' },
        { q: 'Зачем sequencer?', a: 'Номер каждой заявке и исполнению: единый порядок, детерминизм, переигрывание.' },
        { q: 'Как устроен стакан?', a: 'Уровни цены, на каждом двусвязный список по времени, map order_id → узел. O(1).' },
        { q: 'Как добиться микросекунд?', a: 'Компоненты на одном сервере, общение через mmap, без сети и диска на пути.' },
        { q: 'Почему важен p99?', a: 'Хвост видят трейдеры. Application loop на прибитом ядре убирает блокировки и переключения.' },
        { q: 'Как пережить сбой matching engine?', a: 'Тёплый движок читает те же события; event store реплицирован Raft на 5 серверов.' },
        { q: 'Как раздать рыночные данные честно?', a: 'Надёжный UDP multicast и колокация.' },
        { q: 'Как защититься от DDoS?', a: 'Отделить публичные сервисы, кэш данных, rate limiting, safelist и blocklist IP.' },
      ],
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
