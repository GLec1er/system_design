/* Глава 5. Metrics Monitoring and Alerting: данные для лаборатории (simulator/lab). */
(function (g) {
  // Числа в тексте: разряды пробелами, дробь через запятую.
  const num = (v) => Math.round(v).toLocaleString('ru-RU'), dec = (v) => String(+v.toFixed(1)).replace('.', ',');
  const big = (v) => (v >= 1e9 ? dec(v / 1e9) + ' млрд' : v >= 1e6 ? dec(v / 1e6) + ' млн' : v >= 1e4 ? num(v / 1e3) + ' тыс.' : v >= 10 ? num(v) : dec(v));
  const RAW_B = 16, GORILLA_B = 1.4; // байт на точку: время и значение как есть или delta-of-delta и XOR (Gorilla)
  const RF = 3; // копий в TSDB
  const NODE_TB = 4; // допущение: диски одного узла TSDB
  const SEC = { d7: 604800, d30: 2592000, y1: 31536000 };

  const DATA_MORE = [
    { title: '📈 Временной ряд', items: [
      ['Ряд', 'Имя метрики, набор меток и последовательность пар (время, значение). Пример: CPU.load host=webserver01,region=us-west 1613707265 50.'],
      ['Метки', 'host, region, pool. Ряд это уникальное сочетание имени и меток. Метка с user_id или request_id взрывает число рядов.'],
      ['Нагрузка', 'Запись постоянная и тяжёлая, чтение всплесками: дашборды и алерты, а в инцидент все открывают графики разом.'],
    ] },
    { title: '🗜️ Как уместить год', items: [
      ['Delta-of-delta', 'Время 1610087371, 1610087381, 1610087391 пишется как 1610087371, 10, 0: почти нули, кодируются битами.'],
      ['XOR значений', 'Соседние значения похожи: храним XOR с предыдущим. Gorilla сжимает точку с 16 байт до 1,37.'],
      ['Downsampling', 'Сырые 7 дней, по минуте 30 дней, по часу год. Старым графикам не нужна посекундная точность.'],
      ['Холодное хранение', 'Данные, которые почти не смотрят, уходят в дешёвое хранилище.'],
    ] },
  ];
  const COLLECT_MORE = [
    { title: '📡 Pull или push', items: [
      ['Pull', 'Сборщик сам ходит на /metrics каждого сервера. Список серверов берёт из service discovery (etcd, ZooKeeper). Сборщиков много: кто какой сервер опрашивает, делит кольцо consistent hashing. Так Prometheus.'],
      ['Push', 'Агент на сервере сам шлёт метрики сборщикам за балансировщиком, кластер сборщиков растёт автоматически. Так CloudWatch и Graphite.'],
      ['Плюсы pull', 'Легко отладить: /metrics можно открыть руками. Сервер не ответил, значит упал. Метрики точно от того, кого опрашиваем.'],
      ['Плюсы push', 'Короткие задачи успевают отправить метрики. Работает через файрволы и сложные сети. Можно по UDP, это быстрее.'],
    ] },
    { title: '🧮 Где агрегировать', items: [
      ['В агенте', 'Простые счётчики за минуту прямо на сервере: меньше точек, но теряется детальность.'],
      ['В конвейере', 'Поток (Flink) агрегирует до записи в TSDB: точек в разы меньше, но опоздавшие события и сырые данные теряются.'],
      ['При запросе', 'Храним сырые точки, считаем при чтении: гибко, но тяжёлые графики медленные.'],
    ] },
  ];
  const ALERT_MORE = [
    { title: '🚨 Как устроены алерты', items: [
      ['Правила', 'YAML-файлы с условием, порогом и каналом. Грузятся в кэш правил.'],
      ['Alert manager', 'По расписанию запрашивает Query service, сравнивает с порогом, создаёт событие алерта.'],
      ['Фильтр и дедупликация', 'Десять алертов от одного упавшего сервера за минуту сливаются в одно уведомление. Состояние алерта (pending, firing, resolved) хранится в Cassandra.'],
      ['Доставка', 'Событие уходит в Kafka, потребители шлют в почту, SMS, PagerDuty и вебхуки. Неудачная отправка повторяется: уведомление дойдёт хотя бы раз.'],
    ] },
  ];
  const OBS_MORE = [
    { title: '👀 Кто следит за следящим', items: [
      ['Мета-мониторинг', 'Мониторинг тоже падает. Второй, маленький и независимый, проверяет, что первый жив и алерты доходят.'],
      ['Купить или построить', 'Книга честно советует: есть готовые системы промышленного масштаба. Свою строят, когда своё масштаб или стоимость.'],
    ] },
  ];

  const CORE = ['Серверы с метриками', 'Сборщики метрик', 'Service discovery (etcd)', 'Kafka: поток метрик', 'Time-series DB', 'Query service', 'Кэш запросов', 'Grafana', 'Alert manager', 'Правила алертов', 'Состояние алертов (Cassandra)', 'Kafka: очередь алертов', 'Отправка уведомлений'];

  g.LAB = {
    id: 'ch5', n: 5, title: 'Metrics Monitoring', subtitle: 'Метрики, графики и алерты',
    intro: 'Внутренняя система мониторинга большой компании: собрать метрики с сотни тысяч серверов, хранить их год, рисовать графики и будить дежурного, когда что-то сломалось. 10 млн рядов пишутся без остановки, а читают их всплесками: в инцидент все открывают дашборды одновременно, и именно тогда система обязана работать.',
    kpiFlows: [{ id: 'ingest', label: 'Запись точек' }, { id: 'dash', label: 'Дашборд' }], mainFlow: 'dash',
    cx: [16, 26],
    bgNote: 'Сбор метрик и алерты это не тормозит.',

    steps: [
      { id: 'req', title: 'Требования', sub: 'что строим и что нет', kind: 'req', tag: '~5 мин', guide: 'Отметь функции и ограничения. Только метрики: логи и трейсинг книга выносит за рамки.' },
      { id: 'est', title: 'Оценка нагрузки', sub: '10 млн рядов, год хранения', kind: 'est', tag: '~5 мин', guide: 'Покрути слайдеры. Вывод: запись огромна и постоянна, а хранение решает сжатие и downsampling.' },
      { id: 'api', title: 'API и данные', sub: 'временные ряды, запросы, правила', kind: 'api', tag: '~5 мин', guide: 'Формат точки, /metrics для pull, запрос к Query service, правило алерта и его состояние.' },
      { id: 'hld', title: 'Дизайн', sub: 'схема на карте', kind: 'map', stage: 'base', tag: '~10 мин', guide: 'Пять частей: сбор, передача, хранение в TSDB, алерты и визуализация.' },
      { id: 'deep', title: 'Углубление', sub: 'проблемы и решения', kind: 'map', stage: 'deep', tag: '~15 мин', guide: 'Pull или push, Kafka перед TSDB, где агрегировать, сжатие, downsampling, кэш запросов, дедупликация и доставка алертов.' },
      { id: 'sum', title: 'Итог', sub: 'рассказ для интервью', kind: 'sum', tag: '~5 мин', guide: 'Перескажи решение по шагам и ответь на вопросы для повторения.' },
    ],

    requirements: {
      intro: 'Сначала договариваемся, что строим. Отметь то, что входит в задачу, и нажми «Проверить». Книга строит мониторинг инфраструктуры для своей компании: системные метрики, а не бизнес-аналитику, логи или трейсинг.',
      groups: [
        { kind: 'fr', title: 'Функциональные (FR)', q: 'Что система делает', desc: 'Функции из книги: сбор, хранение, графики и алерты.', items: [
          { text: 'Собирать метрики серверов: CPU, память, диск, запросы', in: true, why: '1000 пулов по 100 машин по 100 метрик: около 10 млн рядов.', to: 'сборщики, Kafka, TSDB', shapes: [
            ['throughput', 2, 'Миллион точек в секунду без остановки.'],
            ['reliability', 1, 'Нельзя терять точки, на которых держатся алерты.'],
          ] },
          { text: 'Хранить год с убывающей детальностью', in: true, why: 'Сырые 7 дней, по минуте 30 дней, по часу год.', to: 'TSDB, сжатие, downsampling', shapes: [
            ['scalability', 2, 'Сырые точки за год это петабайт: без сжатия и downsampling не обойтись.'],
          ] },
          { text: 'Графики и дашборды', in: true, why: 'Инженеры смотрят на систему глазами.', to: 'Grafana, Query service, кэш', shapes: [
            ['latency', 2, 'В инцидент дашборд должен открыться сразу, хотя его открывают все.'],
          ] },
          { text: 'Алерты в почту, SMS, PagerDuty и вебхуки', in: true, why: 'Дежурный узнаёт о проблеме раньше пользователей.', to: 'Alert manager, Kafka, отправка', shapes: [
            ['reliability', 2, 'Критичный алерт нельзя потерять.'],
            ['latency', 1, 'Алерт через секунды, а не минуты.'],
          ] },
          { text: 'Собирать и искать логи', in: false, why: 'Книга выносит за рамки: это ELK, другая система.' },
          { text: 'Распределённый трейсинг', in: false, why: 'Тоже за рамками: Jaeger, Zipkin.' },
          { text: 'Бизнес-аналитика по пользователям', in: false, why: 'Метки с user_id взорвали бы число рядов. Это хранилище данных, не мониторинг.' },
        ] },
        { kind: 'nfr', title: 'Нефункциональные (NFR)', q: 'Насколько хорошо система это делает', desc: 'Книга: масштабируемость, малая задержка дашбордов и алертов, надёжность (не пропустить важный алерт), гибкость конвейера.', items: [
          { text: 'Масштабируется вместе с числом серверов и метрик', in: true, nfr: 'scalability', why: 'Компания растёт, рядов становится больше.', to: 'Kafka, кластер TSDB' },
          { text: 'Малая задержка запросов для дашбордов и алертов', in: true, nfr: 'latency', why: 'Иначе алерт опоздает, а график не откроется в инцидент.', to: 'кэш, свежие данные в памяти' },
          { text: 'Надёжность: не пропустить важный алерт', in: true, nfr: 'reliability', why: 'Пропущенный алерт хуже десяти лишних.', to: 'Kafka, дедупликация, повторы' },
          { text: 'Гибкость: легко подключить новую технологию в конвейер', in: true, nfr: 'flexibility', why: 'Поменять TSDB или добавить потребителя без переделки сбора.', to: 'Kafka между сбором и хранением' },
          { text: 'Строгая согласованность каждой точки', in: false, nfr: 'reliability', why: 'Опоздавшая на секунду точка допустима.' },
        ] },
      ],
      start: {
        title: 'Почему всё начинается здесь',
        text: 'Мониторинг это система, которая обязана работать, когда всё остальное горит. Запись постоянная и огромная, чтение всплесками, данные почти всегда только свежие: 85% запросов смотрят последние сутки. На интервью проверяют, знаешь ли ты, почему обычная БД не подходит, что выбрать между pull и push, как ужать год хранения и как не утопить дежурного в алертах.',
        chain: [
          { t: 'FR: что делаем', d: 'Сбор, хранение год, графики, алерты.' },
          { t: 'NFR: насколько хорошо', d: 'Масштаб, задержка, надёжность алертов, гибкость.' },
          { t: 'Оценка: сколько', d: '10 млн рядов, миллион точек в секунду, терабайты после сжатия.' },
          { t: 'Технологии: что следует', d: 'Pull или push, Kafka, TSDB, кэш запросов, Alert manager, Grafana.' },
        ],
        skipTitle: 'Чего не берём: только метрики',
        skip: [
          { t: 'Обычная SQL-БД', d: 'Запросы по времени и меткам на миллиардах строк ей тяжелы, а запись не прекращается.' },
          { t: 'Логи и трейсы', d: 'Отдельные системы.' },
          { t: 'Метки с user_id', d: 'Число рядов взорвётся.' },
          { t: 'Свой Grafana', d: 'Визуализацию книга советует купить.' },
        ],
        revisit: 'Решение верно, пока верны требования. Новое FR может поменять NFR, и тогда пересматривается архитектура. Примеры ниже.',
      },
      future: [
        { fr: 'Метрики по каждому пользователю', breaks: ['scalability'],
          now: 'Метки host, pool, region.',
          why: 'Метка user_id даёт сотни миллионов рядов: TSDB захлебнётся индексом.',
          fix: 'Такие данные в хранилище событий (ClickHouse), в TSDB только агрегаты.' },
        { fr: 'Хранить сырые точки годами', breaks: ['scalability'],
          now: 'Сырые 7 дней, потом downsampling.',
          why: 'Объём растёт в сотни раз.',
          fix: 'Холодное хранение в объектном хранилище и отдельный движок для редких запросов.' },
        { fr: 'Алерты за секунды', breaks: ['latency'],
          now: 'Правила проверяются раз в минуту.',
          why: 'Запрос к TSDB раз в секунду на каждое правило слишком дорог.',
          fix: 'Потоковые правила прямо в конвейере (Flink) по свежим точкам.' },
        { fr: 'Мониторинг нескольких облаков и дата-центров', breaks: ['reliability'],
          now: 'Один кластер.',
          why: 'Сеть между площадками рвётся, а мониторинг должен её пережить.',
          fix: 'Сбор и TSDB в каждой площадке, общий слой запросов поверх.' },
      ],
      nfr: [
        { id: 'scalability', name: 'Масштабируемость', en: 'Scalability', key: true, what: 'Растём вместе с числом серверов.', metric: 'Рядов и точек в секунду без переделки.', drives: 'Kafka, кластер TSDB, сжатие.', here: '10 млн рядов и больше.' },
        { id: 'latency', name: 'Задержка', en: 'Low latency', key: true, what: 'Сколько ждать дашборд и алерт.', metric: 'p99 запроса к Query service.', drives: 'Кэш запросов, свежие данные в памяти, агрегация до записи.', here: 'Особенно в инцидент.' },
        { id: 'reliability', name: 'Надёжность', en: 'Reliability', key: true, what: 'Важный алерт не пропадает.', metric: 'Потерянные точки и уведомления.', drives: 'Kafka, повторы, дедупликация.', here: 'Мониторинг должен пережить сбой того, что он мониторит.' },
        { id: 'flexibility', name: 'Гибкость', en: 'Flexibility', key: true, what: 'Легко менять части конвейера.', metric: 'Сколько менять, чтобы добавить потребителя.', drives: 'Kafka между сбором и хранением.', here: 'Сбор не знает, кто читает.' },
        { id: 'throughput', name: 'Пропускная способность', en: 'Throughput', key: false, what: 'Точек в секунду.', metric: 'Запись в TSDB.', drives: 'Партиции Kafka, узлы TSDB.', here: 'Миллион в секунду.' },
      ],
      conclusion: 'Итог: сбор, год хранения, графики и алерты, и всё должно работать в инцидент. Дальше посчитаем ряды, точки и байты.',
    },

    estimate: {
      intro: 'Как в книге: 1000 пулов серверов по 100 машин, у каждой 100 метрик, всего около 10 млн рядов. Хранение: сырые 7 дней, по минуте 30 дней, по часу год. Интервал сбора, число дашбордов и правил книга не задаёт, это допущения.',
      scnNote: 'Инцидент умножает чтение: все открывают дашборды. Интервал задаёт, как часто собираем точки. По этим числам считаются карта, узкие места и эталон во всей главе.',
      inputs: [
        { id: 'pools', label: 'Пулов серверов', unit: '', min: 100, max: 10000, step: 100, value: 1000 },
        { id: 'machines', label: 'Машин в пуле', unit: '', min: 10, max: 1000, step: 10, value: 100 },
        { id: 'perHost', label: 'Метрик на машину', unit: '', min: 10, max: 1000, step: 10, value: 100 },
        { id: 'dashQ', label: 'Запросов дашбордов в секунду (допущение)', unit: '', min: 100, max: 10000, step: 100, value: 700 },
        { id: 'rules', label: 'Правил алертов (допущение)', unit: 'тыс', min: 1, max: 500, step: 1, value: 50 },
      ],
      rows: (d) => [
        { short: 'Ряды', label: 'Временных рядов', uses: ['pools', 'machines', 'perHost', 'growth'], from: [], formula: 'пулы × машины × метрики', v: d.series,
          calc: (d, i, f) => `${i.pools} × ${i.machines} × ${i.perHost} = ${f(d.series)}`,
          why: 'Цифра книги: 10 млн рядов. Ряд это имя метрики плюс набор меток.', to: 'индекс TSDB' },
        { short: 'Точки', label: 'Точек в секунду', uses: ['interval'], from: [0], flows: ['ingest'], formula: 'ряды ÷ интервал', v: d.pts,
          calc: (d, i, f) => `${f(d.series)} ÷ ${d.interval} с = ${f(d.pts)}/с`,
          why: 'Запись постоянная, днём и ночью. Книга: один узел InfluxDB (8 ядер, 32 ГБ) держит больше 250 тыс. записей в секунду.', to: 'карта: «Запись точек»' },
        { short: 'Сырые', label: 'Сырые 7 дней, ТБ', uses: [], from: [1], formula: 'точки × 7 дней × 16 Б', v: d.raw7,
          calc: (d, i, f) => `${f(d.pts)} × 604 800 × 16 Б = ${dec(d.raw7)} ТБ, сжатые ≈ ${dec((d.raw7 * GORILLA_B) / RAW_B)} ТБ`,
          why: 'Точка это время и значение по 8 байт. Delta-of-delta и XOR (Gorilla) ужимают её до 1,4 байта.', to: 'диски TSDB' },
        { short: 'Минутные', label: 'По минуте 30 дней, ТБ', uses: [], from: [0], formula: 'ряды × 43 200 × 16 Б', v: d.min30,
          calc: (d, i, f) => `${f(d.series)} × 43 200 × 16 Б = ${dec(d.min30)} ТБ`,
          why: 'Месяц графиков с минутной точностью.', to: 'downsampling' },
        { short: 'Часовые', label: 'По часу год, ТБ', uses: [], from: [0], formula: 'ряды × 8760 × 16 Б', v: d.hour1y,
          calc: (d, i, f) => `${f(d.series)} × 8760 × 16 Б = ${dec(d.hour1y)} ТБ`,
          why: 'Годовые тренды. Без downsampling сырые точки за год весили бы ' + `${big(d.rawYear)} ТБ.`, to: 'downsampling' },
        { short: 'Чтение', label: 'Запросов в секунду', uses: ['dashQ', 'rules', 'incident'], from: [], peak: true, flows: ['dash', 'alertEval'], formula: 'дашборды + правила ÷ 60 с', v: d.dash + d.evals,
          calc: (d, i, f) => `${f(d.dash)} + ${f(d.evals)} = ${f(d.dash + d.evals)}/с${d.k > 1 ? `, в инцидент дашбордов × ${d.k}` : ''}`,
          why: 'Чтение всплесками: в инцидент все открывают графики. 85% запросов смотрят последние 26 часов.', to: 'карта: «Дашборд»' },
      ],
      conclusion: (d) => `${big(d.series)} рядов дают ${big(d.pts)} точек в секунду без остановки. Сырые точки за год весили бы ${big(d.rawYear)} ТБ, а со сжатием и downsampling около ${dec(d.bookTB)} ТБ с копиями. Чтение небольшое, но всплесками: в инцидент дашбордов в ${d.k > 1 ? d.k : 'разы'} больше.`,
    },

    api: {
      intro: 'Мониторинг почти не про REST. Точки идут по протоколу сбора (pull через /metrics или push от агента), чтение через язык запросов TSDB, алерты описываются правилами в YAML. Данные: временные ряды в TSDB, правила в кэше, состояние алертов в Cassandra.',
      journeyTitle: 'Путь точки и алерта',
      conventions: [
        { k: 'Точка', v: 'Имя, метки, время, значение: CPU.load host=web01,region=us-west 1613707265 50' },
        { k: 'Метки', v: 'Низкая кардинальность: host, pool, region. Не user_id и не request_id' },
        { k: 'Сбор', v: 'Pull: сборщик читает /metrics. Push: агент шлёт пачки' },
        { k: 'Запросы', v: 'Язык TSDB (PromQL, Flux), а не SQL: по времени и меткам' },
        { k: 'Правила', v: 'YAML в git, грузятся в кэш Alert manager' },
        { k: 'Доставка', v: 'Хотя бы раз: повтор, пока канал не подтвердил' },
      ],
      journey: [
        { ep: 'scrape', text: 'Сборщик забрал метрики сервера' },
        { ep: 'write', text: 'Точки ушли в Kafka и TSDB' },
        { ep: 'query', text: 'Дежурный открыл дашборд' },
        { ep: 'rule', text: 'Alert manager проверил правило' },
        { ep: 'notify', text: 'Алерт ушёл в PagerDuty' },
      ],
      endpoints: [
        { id: 'scrape', method: 'GET', path: '/metrics', title: 'Метрики сервера (pull)', who: 'сборщик', flow: 'ingest', key: true,
          about: 'Каждый сервер отдаёт текущие значения своих метрик текстом. Сборщик опрашивает его раз в интервал. При push агент шлёт то же самое сам.',
          example: 'GET http://web01:9100/metrics',
          ok: { status: '200 OK', body: { text: 'cpu_load{host="web01",region="us-west"} 0.5\nhttp_requests_total{code="200"} 10234' } },
          errors: [['—', 'TIMEOUT', 'Сервер не ответил: для pull это сигнал, что он упал']],
          reads: [], writes: [] },
        { id: 'write', method: 'POST', path: '/write', title: 'Запись точек в TSDB', who: 'потребитель Kafka', flow: 'ingest',
          about: 'Потребители читают точки из Kafka (партиция по имени метрики) и пишут в TSDB пачками.',
          body: { lines: ['CPU.load host=web01,region=us-west 1613707265 50', 'CPU.load host=web02,region=us-west 1613707265 62'] },
          ok: { status: '204 No Content', body: {} },
          errors: [['503', 'TSDB_UNAVAILABLE', 'TSDB недоступна: точки ждут в Kafka и дозапишутся']],
          sql: "-- InfluxDB line protocol\nCPU.load,host=web01,region=us-west value=50 1613707265",
          reads: [], writes: ['series'] },
        { id: 'query', method: 'GET', path: '/api/v1/query_range', title: 'Запрос графика', who: 'Grafana', flow: 'dash', key: true,
          about: 'Query service принимает запрос на языке TSDB, смотрит в кэш результатов, при промахе идёт в TSDB. Свежие данные чаще всего в памяти.',
          params: [['query', 'query', 'string', true, 'avg by (region) (rate(cpu_load[5m]))'], ['start', 'query', 'timestamp', true, 'Начало'], ['end', 'query', 'timestamp', true, 'Конец'], ['step', 'query', 'duration', false, 'Шаг точек на графике']],
          example: 'GET /api/v1/query_range?query=avg(cpu_load)&start=…&end=…&step=60s',
          ok: { status: '200 OK', body: { series: [{ labels: { region: 'us-west' }, values: [[1613707260, '48.2'], [1613707320, '51.0']] }] } },
          errors: [['422', 'TOO_MANY_SERIES', 'Запрос задевает слишком много рядов'], ['504', 'TIMEOUT', 'Слишком тяжёлый график']],
          sql: "avg by (region) (rate(cpu_load[5m]))   -- PromQL, не SQL",
          reads: ['series'], writes: [] },
        { id: 'rule', method: 'INT', path: 'alert rule', title: 'Проверка правила', who: 'Alert manager', flow: 'alertEval', key: true,
          about: 'Alert manager берёт правила из кэша и по расписанию спрашивает Query service. Порог превышен дольше for: создаётся событие, состояние пишется в Cassandra.',
          body: { name: 'instance_down', expr: 'up == 0', for: '5m', labels: { severity: 'page' }, annotations: { summary: 'Instance {{ $labels.instance }} down' } },
          ok: { status: 'событие', body: { alert: 'instance_down', state: 'firing', instance: 'web01' } },
          errors: [['—', 'NO_DATA', 'Ряд пропал: это тоже повод для алерта']],
          sql: "UPSERT alert_state (alert_id, state, updated_at) VALUES ('instance_down/web01', 'firing', now())",
          reads: ['alert_rules', 'series'], writes: ['alert_state'] },
        { id: 'notify', method: 'POST', path: 'PagerDuty / email / webhook', title: 'Уведомление', who: 'потребитель алертов', flow: 'notify',
          about: 'После фильтра, слияния и дедупликации событие уходит в Kafka. Потребители шлют в каналы и повторяют, пока канал не подтвердит.',
          body: { routing_key: 'team-payments', event_action: 'trigger', payload: { summary: 'Instance web01 down', severity: 'critical' } },
          ok: { status: '202 Accepted', body: { status: 'success' } },
          errors: [['5xx', 'CHANNEL_DOWN', 'Повтор с задержкой, событие остаётся в Kafka']],
          reads: [], writes: [] },
      ],
      dbs: [
        { id: 'tsdb', name: 'TSDB', owner: 'InfluxDB или Prometheus', why: 'Временные ряды.' },
        { id: 'rules', name: 'Правила', owner: 'YAML в кэше', why: 'Что и когда проверять.' },
        { id: 'alertStore', name: 'Состояние алертов', owner: 'Cassandra', why: 'pending, firing, resolved.' },
      ],
      tables: [
        { name: 'series', db: 'tsdb', why: 'Ряд: имя, метки и точки. Индекс по меткам, точки блоками по времени, сжатые delta-of-delta и XOR.', rows: '≈ 10 млн рядов',
          cols: [{ n: 'metric', t: 'string', k: 'PK', d: 'CPU.load' }, { n: 'labels', t: 'map', k: 'PK', d: 'host=web01, region=us-west' }, { n: 'timestamp', t: 'INT64', k: 'PK', d: 'Время точки' }, { n: 'value', t: 'FLOAT64', d: 'Значение' }],
          extra: ['Сырые 7 дней, по минуте 30 дней, по часу год', '85% запросов к последним 26 часам: их держат в памяти'] },
        { name: 'alert_rules', db: 'rules', why: 'Правила из YAML. Меняются редко, читаются каждую минуту.', rows: 'строка на правило',
          cols: [{ n: 'name', t: 'string', k: 'PK', d: 'instance_down' }, { n: 'expr', t: 'string', d: 'up == 0' }, { n: 'for', t: 'duration', d: 'Сколько держаться до firing' }, { n: 'severity', t: 'string', d: 'page, ticket' }, { n: 'channel', t: 'string', d: 'Куда слать' }] },
        { name: 'alert_state', db: 'alertStore', why: 'Состояние каждого алерта: чтобы не слать одно и то же и знать, что он уже разрешился.', rows: 'строка на алерт и объект',
          cols: [{ n: 'alert_id', t: 'string', k: 'PK', d: 'instance_down/web01', ref: { t: 'alert_rules', c: 'name', soft: true } }, { n: 'state', t: 'enum', d: 'inactive, pending, firing, resolved' }, { n: 'updated_at', t: 'TIMESTAMP', d: 'Когда менялось' }, { n: 'notified_at', t: 'TIMESTAMP', d: 'Когда отправили' }] },
      ],
      more: {
        intro: 'Для интервью хватает таблиц выше. Ниже то, что добавляют, когда растут требования.',
        tables: [
          { name: 'silences', when: 'Заглушить алерты на время работ.', cols: 'matcher, starts_at, ends_at, author' },
          { name: 'cold_blocks', when: 'Холодное хранение старых блоков в S3.', cols: 'series_range, from, to, s3_key' },
        ],
        endpoints: [
          { ep: 'POST /api/v1/silences', when: 'Плановые работы.' },
          { ep: 'Push gateway', when: 'Короткие задачи при pull: успевают отдать метрики до выхода.' },
        ],
      },
      quiz: [
        { q: 'Почему не обычная SQL-БД?', a: 'Запросы по времени и меткам на миллиардах точек, постоянная запись и сжатие лучше даются специализированной TSDB.' },
        { q: 'Что такое кардинальность меток?', a: 'Сколько разных значений у метки. user_id в метке даёт сотни миллионов рядов.' },
        { q: 'Где хранится состояние алерта?', a: 'В Cassandra: pending, firing, resolved. Так не шлём одно и то же повторно.' },
        { q: 'Зачем YAML для правил?', a: 'Правила в git: ревью, история, откат.' },
      ],
    },

    board: { w: 1460, h: 940 },
    scenario: [
      { id: 'incident', label: 'Инцидент', unit: '×', stops: [1, 2, 5, 10, 20], value: 1, hint: 'Во сколько раз больше запросов к дашбордам: всё горит, все смотрят графики' },
      { id: 'interval', label: 'Интервал сбора', unit: 'с', stops: [1, 5, 10, 30, 60], value: 10, hint: 'Как часто собираем точку. Чаще значит точнее, но больше записи и хранения' },
      { id: 'growth', label: 'Рост', unit: '×', stops: [1, 2, 3, 5], value: 1, hint: 'Во сколько раз больше серверов' },
    ],
    groups: ['Сбор', 'Хранение', 'Чтение', 'Алерты'],
    expGroups: ['Хранение'],

    blocks: {
      targets: { name: 'Серверы с метриками', icon: '🖥️', cat: 'edge', group: 'Сбор', pos: [20, 300], cap: 0, tag: '100 тыс. машин, /metrics или агент',
        learn: { more: COLLECT_MORE, what: 'Источники: серверы, базы, очереди. Каждый отдаёт метрики на /metrics (pull) или через агента (push).', plus: [], minus: [] } },
      collector: { name: 'Сборщики метрик', icon: '📡', cat: 'svc', group: 'Сбор', pos: [235, 300], cap: 100000, lat: 5, cost: 100, cx: 1, maxRep: 500, links: [['targets', 'self']], tag: 'Pull по кольцу или push за LB',
        overload: 'больше сборщиков: при pull делят серверы кольцом consistent hashing, при push растут автоматически',
        learn: { more: COLLECT_MORE, what: 'Забирают или принимают точки и отправляют дальше. В модели около 100 тыс. точек в секунду на сборщик.', plus: ['Без состояния, кроме своей доли серверов'], minus: [] } },
      sd: { name: 'Service discovery (etcd)', icon: '🧭', cat: 'svc', group: 'Сбор', pos: [235, 80], cap: 20000, lat: 2, cost: 100, cx: 1, maxRep: 5, links: [['collector', 'self']], tag: 'Список серверов и кольцо сборщиков',
        learn: { more: COLLECT_MORE, what: 'Для pull: какие серверы есть сейчас и какой сборщик их опрашивает (кольцо consistent hashing). Новые серверы появляются в мониторинге сами.', plus: ['Ничего не настраивать руками'], minus: ['Ещё один кластер'] } },
      kafka: { name: 'Kafka: поток метрик', logo: 'kafka', icon: '📨', cat: 'async', group: 'Хранение', via: true, tune: 'kafka', pos: [470, 300], cap: 20000, lat: 3, cost: 400, cx: 1, brokerCap: 300000,
        opts: { brokers: [3, 6, 12, 24], partitions: [12, 24, 48, 96, 192] },
        links: [['collector', 'self'], ['self', 'tsdb']], drop: [['collector', 'tsdb']], tag: 'Партиция по имени метрики',
        fit: { use: 'Развязать сбор и хранение: TSDB упала, точки ждут.', avoid: 'Если хранилище само держит запись и в памяти (Gorilla у Facebook).', limits: 'Ещё один кластер в эксплуатации.' },
        learn: { more: COLLECT_MORE, what: 'Книга ставит Kafka между сборщиками и TSDB: сбор не зависит от хранения, точки не теряются при отказе TSDB, можно подключить второго потребителя (Flink, аналитику). Партиция по имени метрики.', plus: ['Не теряем точки при сбое TSDB', 'Новые потребители без изменения сбора'], minus: ['Ещё одна система'] } },
      tsdb: { name: 'Time-series DB', icon: '📊', cat: 'db', group: 'Хранение', pos: [720, 300], cap: 250000, lat: 10, cost: 300, cx: 1.5, db: true, maxRep: 500, repLabel: 'узл.',
        links: [['collector', 'self'], ['query', 'self']], tag: 'InfluxDB, Prometheus',
        overload: 'больше узлов TSDB или меньше точек: агрегация до записи, интервал сбора',
        fit: { use: 'Временные ряды: запись по времени, запросы по меткам и интервалам.', avoid: 'Метки с высокой кардинальностью.', limits: 'Книга: узел InfluxDB держит больше 250 тыс. записей в секунду.' },
        learn: { more: DATA_MORE, what: 'Специализированная БД для рядов: сжатие delta-of-delta и XOR, downsampling, индекс по меткам. Книга называет InfluxDB, Prometheus, OpenTSDB, Timestream.', plus: ['Сжатие в 10 раз', 'Запросы по времени и меткам'], minus: ['Плохо с кардинальностью'] } },
      query: { name: 'Query service', icon: '🔍', cat: 'svc', group: 'Чтение', pos: [720, 600], cap: 500, lat: 20, cost: 100, cx: 1, maxRep: 500, links: [['grafana', 'self'], ['alertMgr', 'self']], tag: 'Запросы дашбордов и алертов',
        learn: { more: DATA_MORE, what: 'Принимает запросы на языке TSDB от Grafana и Alert manager, кэширует результаты. В модели около 500 тяжёлых запросов в секунду на копию.', plus: ['Отделяет клиентов от TSDB'], minus: [] } },
      qcache: { name: 'Кэш запросов (Redis)', logo: 'redis', icon: '⚡', cat: 'cache', group: 'Чтение', pos: [960, 640], cap: 100000, lat: 1, cost: 200, cx: 1, tune: 'kv', repLabel: 'узл.', cache: true, at: 'db', absorb: { dash: 0.7, alertEval: 0.3 }, hotKey: 0.05,
        opts: { shards: [1, 3, 6, 12] }, links: [['query', 'self']], tag: 'Результаты частых запросов',
        fit: { use: 'Одинаковые графики у многих инженеров, особенно в инцидент.', avoid: 'Свежие алерты: им нужна последняя точка.', limits: 'TTL порядка интервала сбора.' },
        learn: { more: DATA_MORE, what: 'Книга: кэш результатов запросов. В инцидент сотни человек открывают один дашборд, и TSDB считает его один раз. В модели снимает 70% дашбордов и 30% проверок правил.', plus: ['Дашборды в инцидент не валят TSDB'], minus: ['Данные старее на TTL'] } },
      engineer: { name: 'Инженеры', icon: '🧑‍💻', cat: 'edge', group: 'Чтение', pos: [235, 640], cap: 0, tag: 'Дашборды в браузере',
        learn: { what: 'Смотрят дашборды. В инцидент открывают одни и те же графики всем составом.', plus: [], minus: [] } },
      grafana: { name: 'Grafana', icon: '📉', brand: '#F46800', cat: 'svc', group: 'Чтение', pos: [470, 640], cap: 2000, lat: 10, cost: 80, cx: 0.5, maxRep: 100, links: [['engineer', 'self']], tag: 'Визуализация, купить',
        learn: { what: 'Визуализация: книга советует не строить свою, а взять Grafana.', plus: ['Готовая'], minus: [] } },
      alertMgr: { name: 'Alert manager', icon: '🚨', cat: 'svc', group: 'Алерты', pos: [960, 330], cap: 5000, lat: 5, cost: 100, cx: 2, maxRep: 50, links: [['self', 'query'], ['self', 'rules'], ['self', 'alertStore']], tag: 'Правила, фильтр, дедупликация',
        learn: { more: ALERT_MORE, what: 'Берёт правила из кэша, по расписанию спрашивает Query service, фильтрует, сливает и дедуплицирует события, хранит состояние и отправляет в очередь алертов.', plus: ['Одно уведомление на одну проблему'], minus: ['Сам должен быть надёжнее всего остального'] } },
      rules: { name: 'Правила алертов', icon: '📋', cat: 'cache', group: 'Алерты', pos: [1225, 200], cap: 100000, lat: 1, cost: 50, cx: 0.5, db: true, maxRep: 5, repLabel: 'узл.', links: [['alertMgr', 'self']], tag: 'YAML в кэше',
        learn: { more: ALERT_MORE, what: 'Правила лежат в YAML-файлах в git и загружаются в кэш.', plus: ['Ревью и история правил'], minus: [] } },
      alertStore: { name: 'Состояние алертов (Cassandra)', logo: 'cassandra', icon: '🗃️', cat: 'db', group: 'Алерты', pos: [1225, 470], cap: 20000, lat: 3, cost: 150, cx: 1, db: true, maxRep: 20, repLabel: 'узл.', links: [['alertMgr', 'self']], tag: 'pending, firing, resolved',
        learn: { more: ALERT_MORE, what: 'Книга хранит состояние алертов в Cassandra: что уже отправлено, что разрешилось. Без этого одно и то же уходит снова.', plus: ['Дедупликация между проверками'], minus: [] } },
      alertQ: { name: 'Kafka: очередь алертов', logo: 'kafka', icon: '📨', cat: 'async', group: 'Алерты', via: true, pos: [960, 80], cap: 50000, lat: 3, cost: 150, cx: 1, maxRep: 10, repLabel: 'брок.',
        links: [['alertMgr', 'self'], ['self', 'notifier']], drop: [['alertMgr', 'notifier']], tag: 'Доставка хотя бы раз',
        learn: { more: ALERT_MORE, what: 'Событие алерта уходит в Kafka, а потребители отправляют его в каналы и повторяют при ошибке. PagerDuty лежит: алерт ждёт, а не пропадает.', plus: ['Повторы без потери'], minus: [] } },
      notifier: { name: 'Отправка уведомлений', icon: '📟', cat: 'svc', group: 'Алерты', pos: [1225, 40], cap: 2000, lat: 50, cost: 80, cx: 1, maxRep: 50, links: [['alertMgr', 'self']], tag: 'Email, SMS, PagerDuty, вебхуки',
        learn: { more: ALERT_MORE, what: 'Потребители алертов: шлют в почту, SMS, PagerDuty и вебхуки.', plus: ['Много каналов'], minus: ['Каналы бывают недоступны'] } },

      // ---------- эксперименты ----------
      gorilla: { name: 'Gorilla: свежие данные в памяти', icon: '🦍', cat: 'cache', extra: true, group: 'Хранение', pos: [960, 500], cap: 500000, lat: 1, cost: 400, cx: 2, maxRep: 50, cache: true, at: 'db', absorb: { dash: 0.85, alertEval: 0.85 }, links: [['query', 'self']], tag: '26 часов в RAM',
        fit: { use: '85% запросов к последним 26 часам: держим их в памяти.', avoid: 'Долгие диапазоны: они всё равно идут в TSDB.', limits: 'Память кластера ограничивает окно.' },
        learn: { what: 'Facebook Gorilla: последние 26 часов в памяти со сжатием до 1,37 байта на точку. Книга упоминает, что 85% запросов смотрят именно это окно.', plus: ['Алерты и дашборды из памяти'], minus: ['Ещё один слой, память дорогая'] } },
    },

    flows: [
      { id: 'ingest', label: 'Запись точек', color: 'var(--f1)', write: true, rate: (d) => d.pts, chain: ['targets', 'collector', 'tsdb'] },
      { id: 'dash', label: 'Дашборд', color: 'var(--f2)', rate: (d) => d.dash * d.k, chain: ['engineer', 'grafana', 'query', 'tsdb'] },
      { id: 'alertEval', label: 'Проверка правил', color: 'var(--f4)', rate: (d) => d.evals, chain: ['alertMgr', 'query', 'tsdb'] },
      { id: 'ruleLoad', side: true, label: 'Чтение правил', color: 'var(--f6)', rate: (d) => d.evals, chain: ['alertMgr', 'rules'] },
      { id: 'alertState', side: true, label: 'Состояние алертов', color: 'var(--f3)', write: true, rate: (d) => d.evals * 0.01, chain: ['alertMgr', 'alertStore'] },
      { id: 'notify', side: true, label: 'Уведомления', color: 'var(--f5)', rate: (d) => d.alerts, chain: ['alertMgr', 'notifier'] },
      { id: 'discover', side: true, label: 'Список серверов', color: 'var(--f8)', optional: true, rate: () => 100, chain: ['collector', 'sd'] },
    ],

    derive: (i, deep) => {
      const p = (deep && deep.params) || {};
      const growth = p.growth || 1, inc = p.incident || 1, interval = p.interval || 10;
      const series = i.pools * i.machines * i.perHost * growth, pts = series / interval, TB = (x) => x / 1e12;
      const raw7 = TB(pts * SEC.d7 * RAW_B), min30 = TB(series * 43200 * RAW_B), hour1y = TB(series * 8760 * RAW_B);
      return {
        k: inc, inc, growth, interval, series, pts, raw7, min30, hour1y, rawYear: TB(pts * SEC.y1 * RAW_B),
        bookTB: ((raw7 + min30 + hour1y) * GORILLA_B / RAW_B) * RF, dash: i.dashQ, evals: (i.rules * 1000) / 60, alerts: 5 * inc,
        hosts: i.pools * i.machines * growth,
      };
    },

    reference: {
      base: {
        nodes: ['targets', 'collector', 'sd', 'tsdb', 'query', 'engineer', 'grafana', 'alertMgr', 'rules', 'alertStore', 'notifier'],
        edges: [['targets', 'collector'], ['collector', 'sd'], ['collector', 'tsdb'], ['engineer', 'grafana'], ['grafana', 'query'], ['query', 'tsdb'], ['alertMgr', 'query'], ['alertMgr', 'rules'], ['alertMgr', 'alertStore'], ['alertMgr', 'notifier']],
        adapt: [],
      },
      deep: {
        nodes: ['targets', 'collector', 'sd', 'kafka', 'tsdb', 'query', 'qcache', 'engineer', 'grafana', 'alertMgr', 'rules', 'alertStore', 'alertQ', 'notifier'],
        edges: [['targets', 'collector'], ['collector', 'sd'], ['collector', 'kafka'], ['kafka', 'tsdb'], ['engineer', 'grafana'], ['grafana', 'query'], ['query', 'qcache'], ['query', 'tsdb'], ['alertMgr', 'query'], ['alertMgr', 'rules'], ['alertMgr', 'alertStore'], ['alertMgr', 'alertQ'], ['alertQ', 'notifier']],
        cfg: { kafka: { brokers: 6, partitions: 96 }, qcache: { shards: 1, replicas: 1 } },
        adapt: [{ add: 'qcache', from: 'query', why: 'одинаковые графики в инцидент считаются один раз' }],
      },
    },

    problems: [
      { id: 'collect', icon: '📡', title: 'Pull или push', key: 'collect',
        problem: 'Серверов 100 тысяч, они появляются и исчезают каждый день. Сборщик ходит к ним сам или они шлют сами? Pull работает с блоком «Service discovery».',
        options: [
          { v: 'pull', label: 'Pull через /metrics', note: 'Сборщики опрашивают серверы по списку из service discovery и делят их кольцом. Легко отладить, упавший сервер виден сразу. Короткие задачи нужен push gateway.' },
          { v: 'push', label: 'Push от агента', note: 'Агент на сервере шлёт пачки сборщикам за балансировщиком. Работает через файрволы, удобно коротким задачам. Сложнее отличить упавший сервер от молчащего.' },
        ],
        best: ['pull', 'push'], say: 'Беру pull, как Prometheus: сборщики забирают /metrics по списку из etcd и делят серверы кольцом consistent hashing, чтобы не опрашивать дважды. Короткие задачи шлют через push gateway. Push тоже честный выбор: агент, балансировщик и автомасштаб сборщиков.' },
      { id: 'agg', icon: '🧮', title: 'Где агрегировать', key: 'agg',
        problem: 'Дашборду нужны средние по региону, а не 10 млн рядов по отдельности. Где считать агрегаты?',
        options: [
          { v: 'query', label: 'При запросе', note: 'Храним всё сырое и считаем при чтении. Гибко, но тяжёлый график в инцидент считается секундами.' },
          { v: 'agent', label: 'В агенте', note: 'Счётчики за минуту прямо на сервере: точек меньше, но детальность и гибкость теряются.' },
          { v: 'pipeline', label: 'В конвейере (Flink)', note: 'Поток агрегирует до записи: в TSDB в разы меньше точек, графики быстрые. Опоздавшие точки и сырые данные теряются.' },
        ],
        best: ['pipeline', 'agent'], say: 'Частые агрегаты считаю в конвейере потоковой обработкой до записи: в TSDB меньше точек, дашборды быстрые. Простые счётчики можно агрегировать прямо в агенте. При запросе считаю только редкие графики.' },
      { id: 'encode', icon: '🗜️', title: 'Как хранить точку', key: 'encode',
        problem: 'Точка это время и значение по 8 байт. Миллион точек в секунду за неделю это почти 10 ТБ.',
        options: [
          { v: 'raw', label: 'Как есть, 16 байт', note: 'Просто, но дорого: дисков в 10 раз больше.' },
          { v: 'gorilla', label: 'Delta-of-delta и XOR', note: 'Время пишется разностью разностей (почти нули), значения XOR с предыдущим. Около 1,4 байта на точку. Так в TSDB из книги.' },
        ],
        best: ['gorilla'], say: 'Точки сжимаю: время как delta-of-delta, значения XOR с предыдущим. Около 1,4 байта вместо 16.' },
      { id: 'retain', icon: '📅', title: 'Как хранить год', key: 'retain',
        problem: 'Нужен год истории, но сырые точки за год это сотни терабайт. Графикам за прошлый месяц не нужна каждая секунда.',
        options: [
          { v: 'none', label: 'Сырые точки весь год', note: 'Полная детальность, но объём в десятки раз больше.' },
          { v: 'downsample', label: 'Downsampling', note: 'Сырые 7 дней, по минуте 30 дней, по часу год. Так в книге.' },
          { v: 'cold', label: 'Downsampling и холодное хранение', note: 'То же, плюс данные старше месяца уходят в дешёвое объектное хранилище. Редкие запросы к ним медленнее.' },
        ],
        best: ['downsample', 'cold'], say: 'Храню с убывающей детальностью: сырые 7 дней, по минуте 30 дней, по часу год. 85% запросов смотрят последние сутки, а старое можно унести в холодное хранилище.' },
      { id: 'dedupe', icon: '🔕', title: 'Сто алертов на одну проблему', key: 'dedupe',
        problem: 'Упала стойка: 40 серверов, на каждом 5 правил, проверка раз в минуту. Сколько уведомлений получит дежурный?',
        options: [
          { v: 'none', label: 'Каждое срабатывание', note: 'Сотни сообщений в минуту: дежурный выключает телефон и пропускает важное.' },
          { v: 'dedupe', label: 'Фильтр, слияние, дедупликация', note: 'Alert manager сливает события одного источника и не шлёт повтор, пока состояние не изменилось. Так в книге.' },
        ],
        best: ['dedupe'], say: 'Alert manager фильтрует, сливает и дедуплицирует события: десять алертов от одной стойки становятся одним уведомлением. Состояние алерта в Cassandra, повтор уходит только при смене состояния.' },
      { id: 'scale', icon: '📈', title: 'Kafka под потоком точек', settings: 'kafka',
        problem: 'Интервал и рост задаются над картой. Kafka принимает каждую точку. Сколько брокеров и партиций?',
        hint: 'Брокеры и партиции настраиваются в блоке «Kafka: поток метрик». Партиция по имени метрики: потребитель агрегирует метрику целиком. Кнопка «Подобрать под нагрузку» найдёт размер.',
        say: 'Партиционирую поток по имени метрики, а внутри при нужде по меткам: потребитель видит метрику целиком и может её агрегировать. Партиций столько, чтобы потребители TSDB успевали.' },
    ],

    metrics: [
      { id: 'storeTB', label: 'Хранение, ТБ', sub: 'год с копиями' },
      { id: 'lostPts', label: 'Потеря точек', bad: true, sub: 'за 10 мин отказа' },
      { id: 'missed', label: 'Без мониторинга', bad: true, sub: 'за месяц' },
      { id: 'storm', label: 'Лишние уведомления', bad: true, sub: 'на один инцидент' },
      { id: 'lostAlerts', label: 'Потеря алертов', bad: true, sub: 'за 10 мин отказа' },
    ],

    model(ctx) {
      const { d, deep, nodes, flows, stage } = ctx, c = deep.choices, M = ctx.metrics;
      const all = Object.values(nodes), of = (t) => all.filter((n) => n.type === t), F = (id) => flows.find((f) => f.id === id);
      const badge = (n, icon, title) => n && n.badges.push({ icon, title });
      const addLoad = (n, fid, x) => { if (!n || !x) return; n.load += x; n.flows[fid] = (n.flows[fid] || 0) + x; if (F(fid).write) n.wload += x; };
      const scale = (n, fid, m) => n && addLoad(n, fid, (n.flows[fid] || 0) * (m - 1));
      M.lostPts = M.missed = M.storm = M.lostAlerts = 0;
      const deepOn = stage === 'deep';
      const collect = deepOn ? c.collect : 'pull', agg = deepOn ? c.agg : 'query', enc = deepOn ? c.encode : 'gorilla', ret = deepOn ? c.retain : 'downsample', dd = deepOn ? c.dedupe : 'dedupe';
      const tsdb = of('tsdb')[0], ing = F('ingest'), dash = F('dash');

      // Чтение дашборда задевает сотни рядов: для TSDB это тяжелее записи одной точки.
      scale(tsdb, 'dash', 50); scale(tsdb, 'alertEval', 20);

      // ---------- агрегация ----------
      if (agg === 'pipeline') { scale(tsdb, 'ingest', 0.2); ctx.cx += 1.5; badge(tsdb, '🧮', 'Агрегаты из конвейера'); }
      if (agg === 'agent') { all.forEach((n) => scale(n, 'ingest', 0.5)); badge(of('collector')[0], '🧮', 'Агрегация в агенте'); }
      if (agg === 'query') { scale(tsdb, 'dash', 4); dash.extraLat += 300; if (deepOn) ctx.warn('warn', 'Агрегаты при запросе: тяжёлый дашборд по региону складывает тысячи рядов на каждом открытии. В инцидент графики грузятся секундами.'); }

      // ---------- хранение ----------
      const B = enc === 'gorilla' ? GORILLA_B : RAW_B;
      const hot = ret === 'none' ? (d.rawYear * B) / RAW_B : ret === 'cold' ? ((d.raw7 + d.min30) * B) / RAW_B : ((d.raw7 + d.min30 + d.hour1y) * B) / RAW_B;
      M.storeTB = hot * RF * (agg === 'pipeline' ? 0.5 : 1);
      if (tsdb) { tsdb.minRep = Math.ceil(M.storeTB / NODE_TB); tsdb.minRepWhy = `Данные ${dec(M.storeTB)} ТБ с копиями, по ${NODE_TB} ТБ на узел.`; }
      if (enc === 'raw' && deepOn) ctx.warn('warn', 'Точки без сжатия: 16 байт вместо 1,4. Дисков в 10 раз больше.');
      if (ret === 'none' && deepOn) ctx.warn('warn', `Сырые точки весь год: ${big(M.storeTB)} ТБ с копиями. Графикам за прошлый месяц не нужна каждая секунда.`);
      if (ret === 'cold') { ctx.cost += 200; badge(tsdb, '🧊', 'Старое в холодном хранилище'); }
      if (enc === 'gorilla') badge(tsdb, '🗜️', 'Delta-of-delta, XOR');

      if (!deepOn) return;

      // ---------- сбор ----------
      const sdOk = F('discover').ok;
      if (collect === 'pull') {
        if (!sdOk) { M.missed = d.hosts * 0.02 * 30; ctx.warn('warn', 'Pull без service discovery: список серверов ведут руками, новые машины неделями без мониторинга. Добавь «Service discovery» со стрелкой от сборщиков.'); }
        else badge(of('collector')[0], '💍', 'Pull, кольцо сборщиков');
      } else {
        const col = of('collector')[0]; if (col) col.capMult *= 1.2;
        badge(col, '📤', 'Push от агентов');
        ctx.warn('info', 'Push: агент шлёт сам, через файрволы и для коротких задач. Но молчащий сервер и упавший неотличимы без отдельной проверки, а принять можно и чужие точки: нужна аутентификация агентов.');
      }

      // ---------- Kafka перед TSDB ----------
      const viaKafka = ing.ok && ing.path.some((x) => nodes[x.id].type === 'kafka');
      if (!viaKafka) { M.lostPts = d.pts * 600; ctx.warn('warn', `Сборщики пишут прямо в TSDB: если она недоступна 10 минут, ${big(M.lostPts)} точек пропадут, а алерты ослепнут. Поставь Kafka между ними.`); }
      else badge(of('kafka')[0], '📨', 'Буфер, если TSDB лежит');

      // ---------- алерты ----------
      if (dd === 'none') { M.storm = 40 * 5 * 30; ctx.warn('warn', 'Без дедупликации падение стойки даёт сотни уведомлений в минуту. Дежурный перестаёт их читать.'); }
      else badge(of('alertMgr')[0], '🔕', 'Фильтр, слияние, дедупликация');
      const nt = F('notify'), viaQ = nt.ok && nt.path.some((x) => nodes[x.id].type === 'alertQ');
      if (nt.ok && !viaQ) { M.lostAlerts = d.alerts * 600; ctx.warn('warn', 'Alert manager шлёт в каналы сам: пока PagerDuty не отвечает, алерты пропадают. Очередь алертов с повторами доставит хотя бы раз.'); }
    },

    overload: 'добавить копий или снять нагрузку: кэш запросов, агрегация до записи, реже сбор',
    linkWhy(a, b) {
      const B = this.blocks;
      if (a === 'targets' && b === 'tsdb') return 'Серверы не пишут в TSDB сами: между ними сборщики.';
      if (a === 'engineer' && b !== 'grafana') return 'Инженеры смотрят графики через Grafana.';
      if (B[a].db) return 'Хранилище отвечает на запросы, но само никого не вызывает.';
      return '';
    },

    rules(ctx) {
      const { metrics: M, stage, d, flows } = ctx, F = (id) => flows.find((f) => f.id === id);
      if (M.lostPts > 0) ctx.warn('bad', `При отказе TSDB теряется около ${big(M.lostPts)} точек.`);
      if (M.storm > 0) ctx.warn('bad', `Около ${num(M.storm)} лишних уведомлений на один инцидент.`);
      if (M.lostAlerts > 0) ctx.warn('bad', `Около ${num(M.lostAlerts)} алертов пропадает, пока канал недоступен.`);
      if (stage === 'base' && flows.every((f) => f.ok || f.optional)) ctx.warn('info', `Как показала оценка: ${big(d.pts)} точек в секунду пишутся всегда, а читают всплесками. Хранение около ${dec(M.storeTB)} ТБ с копиями.`);
    },

    goals: {
      base: [
        { text: 'Точки, дашборды и алерты доходят до цели', check: (r) => r.m.routed },
        { text: 'Сборщики знают серверы из service discovery', check: (r) => r.flows.find((f) => f.id === 'discover').ok },
        { text: 'Grafana и Alert manager читают через Query service', check: (r) => ['dash', 'alertEval'].every((id) => r.flows.find((f) => f.id === id).path.some((x) => r.nodes[x.id].type === 'query')) },
        { text: 'Нагрузка выдерживается', check: (r) => r.m.served >= 1 && r.m.maxU <= 0.9 },
      ],
      deep: [
        { text: 'Ни одна точка не теряется, все серверы под мониторингом', check: (r) => r.m.routed && r.m.lostPts === 0 && r.m.missed === 0 },
        { text: 'Дашборд быстрее 500 мс', check: (r) => r.m.routed && r.flows.find((f) => f.id === 'dash').lat <= 500 },
        { text: 'TSDB хранит год меньше чем в 20 ТБ с копиями', check: (r) => r.m.routed && r.m.storeTB <= 20 },
        { text: 'Одна проблема, одно уведомление, и оно доходит', check: (r) => r.m.routed && r.m.storm === 0 && r.m.lostAlerts === 0 },
        { text: 'Выдерживаем инцидент ×10', check: (r) => r.d.inc >= 10 && r.m.served >= 1 && r.m.maxU <= 0.9 },
      ],
    },

    summary: {
      db: 'tsdb', core: CORE,
      estCard: (d, f) => `${f(d.series)} рядов, ${f(d.pts)} точек/с`,
      badRow: { label: 'Потери точек и алертов', ids: ['lostPts', 'lostAlerts'] },
      script: (x) => {
        const t = x.fmt, d = x.d, ts = x.r.nodes.tsdb;
        return [
          { step: 'Требования', min: 4, text: 'Собирать системные метрики сотни тысяч серверов, хранить год (сырые 7 дней, по минуте 30 дней, по часу год), графики, алерты в почту, SMS, PagerDuty и вебхуки. Без логов и трейсинга. NFR: масштаб, малая задержка, не пропустить важный алерт, гибкость.' },
          { step: 'Оценка', min: 3, text: `1000 пулов × 100 машин × 100 метрик: ${t(d.series)} рядов. Раз в ${d.interval} с это ${t(d.pts)} точек в секунду без остановки. Сырые за год ${t(d.rawYear)} ТБ, со сжатием и downsampling около ${dec(d.bookTB)} ТБ с копиями.` },
          { step: 'Данные', min: 3, text: 'Ряд: имя, метки, пары (время, значение). Запись постоянная, чтение всплесками, 85% запросов к последним суткам. Обычная SQL-БД не подходит: нужна TSDB.' },
          { step: 'Дизайн', min: 5, text: `Пять частей: сбор, передача, хранение, алерты, визуализация. Сборщики → Kafka → TSDB${ts ? ` (${ts.rep} узлов)` : ''}. Query service с кэшем для Grafana и Alert manager. Alert manager: правила из кэша, состояние в Cassandra, события в Kafka, потребители шлют в каналы.` },
          { step: 'Сбор', min: 4, text: x.choice('collect').say },
          { step: 'Агрегация', min: 3, text: x.choice('agg').say },
          { step: 'Хранение', min: 4, text: `${x.choice('encode').say} ${x.choice('retain').say}` },
          { step: 'Алерты', min: 3, text: x.choice('dedupe').say },
          { step: 'Что изменится, если…', min: 2, text: 'Метрики по пользователям: хранилище событий, в TSDB только агрегаты. Алерты за секунды: потоковые правила в конвейере. Визуализацию и часть алертов разумно купить.' },
        ];
      },
      says: {
        collect: { pull: 'Pull через /metrics, список из etcd, сборщики делят серверы кольцом.', push: 'Push от агентов за балансировщиком, сборщики масштабируются автоматически.' },
        agg: { query: 'Агрегаты при запросе: гибко, но тяжёлые графики медленные.', agent: 'Простые агрегаты в агенте: меньше точек, меньше детальности.', pipeline: 'Агрегаты в конвейере до записи: в TSDB меньше точек.' },
        encode: { raw: 'Без сжатия точка 16 байт.', gorilla: 'Delta-of-delta и XOR: около 1,4 байта на точку.' },
        retain: { none: 'Сырые точки весь год занимают в десятки раз больше.', downsample: 'Downsampling: сырые неделю, по минуте месяц, по часу год.', cold: 'Downsampling и холодное хранилище для старого.' },
        dedupe: { none: 'Без дедупликации дежурный тонет в уведомлениях.', dedupe: 'Фильтр, слияние и дедупликация: одно уведомление на проблему.' },
      },
      tradeoffs: [
        { pick: 'Pull', alt: 'Push', why: 'Легко отладить и увидеть упавший сервер. Push лучше для коротких задач и сложных сетей.' },
        { pick: 'Kafka перед TSDB', alt: 'Прямая запись', why: 'Точки не теряются при отказе TSDB, можно добавить потребителей. Цена: ещё один кластер.' },
        { pick: 'TSDB', alt: 'SQL-БД', why: 'Сжатие, downsampling, запросы по времени и меткам.' },
        { pick: 'Агрегация в конвейере', alt: 'При запросе', why: 'Быстрые графики ценой детальности и опоздавших точек.' },
        { pick: 'Downsampling', alt: 'Сырые весь год', why: 'В десятки раз меньше дисков, старым графикам точность не нужна.' },
        { pick: 'Кэш запросов', alt: 'Каждый запрос в TSDB', why: 'В инцидент одинаковые графики считаются один раз.' },
        { pick: 'Дедупликация алертов', alt: 'Каждое срабатывание', why: 'Дежурный читает уведомления, а не выключает телефон.' },
        { pick: 'Купить Grafana и каналы', alt: 'Построить', why: 'Готовые решения промышленного масштаба.' },
      ],
      pitfalls: [
        'Взять обычную SQL-БД для временных рядов.',
        'Положить user_id в метки.',
        'Хранить сырые точки весь год.',
        'Писать из сборщиков прямо в TSDB без буфера.',
        'Не объяснить разницу pull и push.',
        'Слать каждое срабатывание правила отдельным уведомлением.',
        'Забыть, что в инцидент чтение взрывается.',
        'Строить свою визуализацию.',
      ],
      questions: [
        { q: 'Сколько рядов и точек?', a: '1000 × 100 × 100 = 10 млн рядов. Раз в 10 с это миллион точек в секунду.' },
        { q: 'Почему TSDB?', a: 'Постоянная запись, запросы по времени и меткам, сжатие и downsampling. Книга: узел InfluxDB держит больше 250 тыс. записей в секунду.' },
        { q: 'Pull или push?', a: 'Pull: легко отладить, видно упавший сервер, нужен service discovery. Push: короткие задачи и сложные сети, агент и автомасштаб сборщиков.' },
        { q: 'Как сборщики делят серверы при pull?', a: 'Кольцо consistent hashing: каждый сервер опрашивает ровно один сборщик.' },
        { q: 'Зачем Kafka?', a: 'Развязывает сбор и хранение, держит точки, пока TSDB недоступна, даёт подключить новых потребителей.' },
        { q: 'Где агрегировать?', a: 'В агенте просто, в конвейере быстро для чтения, при запросе гибко. Это компромисс точности и скорости.' },
        { q: 'Как ужать год?', a: 'Delta-of-delta и XOR (около 1,4 байта на точку), downsampling, холодное хранение.' },
        { q: 'Как не утопить дежурного?', a: 'Фильтр, слияние и дедупликация в Alert manager, состояние алертов в Cassandra.' },
        { q: 'Как не потерять алерт?', a: 'События в Kafka, потребители шлют и повторяют до подтверждения.' },
        { q: 'Строить или покупать?', a: 'Визуализацию и каналы разумно купить. Свою систему строят под свой масштаб.' },
      ],
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
