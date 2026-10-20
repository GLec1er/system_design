/* Глава 6. Ad Click Event Aggregation: данные для лаборатории (simulator/lab). */
(function (g) {
  // Числа в тексте: разряды пробелами, дробь через запятую.
  const num = (v) => Math.round(v).toLocaleString('ru-RU'), dec = (v) => String(+v.toFixed(1)).replace('.', ',');
  const big = (v) => (v >= 1e9 ? dec(v / 1e9) + ' млрд' : v >= 1e6 ? dec(v / 1e6) + ' млн' : v >= 1e4 ? num(v / 1e3) + ' тыс.' : v >= 10 ? num(v) : dec(v));
  const ACTIVE = 0.1; // допущение: доля объявлений, которые кликают в данную минуту
  const LATE = 0.01; // допущение: доля кликов, пришедших позже своей минуты
  const HOT = 0.08; // допущение: доля пика у самого горячего объявления
  const AGG_CAP = 5000; // событий в секунду на узел агрегации
  const STATE_S = 60; // секунд состояния в памяти узла между сохранениями offset

  const PIPE_MORE = [
    { title: '🧮 Агрегация как DAG', items: [
      ['Map', 'Читает клики из Kafka, чистит и раскладывает по узлам Aggregate: ad_id % N. Так все клики одного объявления считает один узел.'],
      ['Aggregate', 'Считает клики объявления в памяти за минуту. Узел это и есть MapReduce, только потоковый.'],
      ['Reduce', 'Сливает результаты узлов Aggregate. Для топ-100 каждый узел даёт свои 100 лучших, Reduce выбирает из них общие.'],
      ['Зачем второй Kafka', 'Агрегаты уходят в Kafka, а оттуда пишет DB writer. Запись результата и сдвиг offset можно сделать атомарными: это и даёт exactly-once.'],
    ] },
    { title: '⚖️ Lambda или Kappa', items: [
      ['Lambda', 'Два конвейера: потоковый для свежих цифр и пакетный (batch) для точных. Логику пишут и поддерживают дважды.'],
      ['Kappa', 'Один потоковый конвейер для всего. Пересчёт истории это тот же поток, пущенный по сырым данным. Книга выбирает Kappa.'],
      ['Пересчёт', 'Нашли ошибку в агрегации: recalculation service читает сырые клики из хранилища и гонит их через отдельный экземпляр агрегации. Живой поток не трогаем.'],
    ] },
  ];
  const TIME_MORE = [
    { title: '⏱️ Время и окна', items: [
      ['Event time', 'Время самого клика. Точно, но клик может прийти позже: сеть, буфер в клиенте.'],
      ['Processing time', 'Время, когда клик дошёл до агрегатора. Просто, но опоздавший клик попадёт не в ту минуту.'],
      ['Watermark', 'Окно закрывается не ровно в конце минуты, а через запас (например, 15 с). Больше запас значит точнее, но позже результат.'],
      ['Tumbling', 'Фиксированные окна без пересечений: минута за минутой. Для счётчика кликов.'],
      ['Sliding', 'Окно последних M минут, скользит каждую минуту. Для топ-100 за последние M минут.'],
    ] },
    { title: '1️⃣ Ровно один раз', items: [
      ['At-most-once', 'Offset сдвинули до обработки: упал узел, клики пропали.'],
      ['At-least-once', 'Offset сдвинули после записи: упал между записью и сдвигом, клики посчитаны дважды.'],
      ['Exactly-once', 'Запись агрегата и offset в одной транзакции (Kafka transactions или распределённая транзакция). Для денег обязательно.'],
      ['Дубли от клиента', 'Один клик прислали дважды. Дедупликация по id события; фрод и ботов книга оставляет отдельной системе.'],
    ] },
  ];
  const DATA_MORE = [
    { title: '🗄️ Сырые и агрегаты', items: [
      ['Сырые клики', 'ad_id, время, user_id, ip, страна. Для сверки и пересчёта. Пишутся много, читаются редко: Cassandra или колоночные файлы (Parquet) в S3.'],
      ['Агрегаты', 'ad_id, минута, фильтр, count. Маленькие, читаются часто: их и отдаёт Query service.'],
      ['Фильтры', 'Star schema: заранее заданные фильтры (страна, ip, user_id) получают filter_id, агрегаты считаются сразу по ним.'],
      ['Сверка', 'В конце дня batch пересчитывает сырые клики по event time и сравнивает с агрегатами. Расхождения ищут и чинят.'],
    ] },
  ];

  const CORE = ['Log watcher', 'Kafka: сырые клики', 'Агрегация (Map, Aggregate, Reduce)', 'Kafka: агрегаты', 'Запись агрегатов', 'БД агрегатов', 'Запись сырых', 'Сырые клики (Cassandra)', 'Query service', 'Сверка', 'Пересчёт'];

  g.LAB = {
    id: 'ch6', n: 6, title: 'Ad Click Aggregation', subtitle: 'Клики по рекламе, точно и почти сразу',
    intro: 'Рекламная платформа считает клики по объявлениям: по этим цифрам рекламодатели платят, а аукцион решает, кому показать рекламу. Миллиард кликов в день, пик 50 тысяч в секунду. Скорость важна, но главное в этой главе точность: клик нельзя потерять, посчитать дважды или отнести не к той минуте.',
    kpiFlows: [{ id: 'clicks', label: 'Приём кликов' }, { id: 'report', label: 'Отчёт' }], mainFlow: 'report',
    cx: [14, 24],
    bgNote: 'Приём кликов это не тормозит.',

    steps: [
      { id: 'req', title: 'Требования', sub: 'что строим и что нет', kind: 'req', tag: '~5 мин', guide: 'Отметь функции и ограничения. Главное NFR: точность, потому что от счёта зависят деньги.' },
      { id: 'est', title: 'Оценка нагрузки', sub: '1 млрд кликов в день', kind: 'est', tag: '~5 мин', guide: 'Покрути слайдеры. Вывод: запись большая и ровная, отчёты маленькие, а агрегаты в разы меньше сырых.' },
      { id: 'api', title: 'API и данные', sub: 'счётчик, топ-100, сырые и агрегаты', kind: 'api', tag: '~5 мин', guide: 'Два запроса из книги, событие клика и запись агрегата. Храним и сырые клики, и агрегаты.' },
      { id: 'hld', title: 'Дизайн', sub: 'схема на карте', kind: 'map', stage: 'base', tag: '~10 мин', guide: 'Log watcher → Kafka → агрегация → второй Kafka → запись в БД агрегатов. Сырые клики отдельно в Cassandra.' },
      { id: 'deep', title: 'Углубление', sub: 'проблемы и решения', kind: 'map', stage: 'deep', tag: '~15 мин', guide: 'Event time и watermark, окна, exactly-once, горячее объявление, снапшоты, Kappa и пересчёт, сверка.' },
      { id: 'sum', title: 'Итог', sub: 'рассказ для интервью', kind: 'sum', tag: '~5 мин', guide: 'Перескажи решение по шагам и ответь на вопросы для повторения.' },
    ],

    requirements: {
      intro: 'Сначала договариваемся, что строим. Отметь то, что входит в задачу, и нажми «Проверить». Книга строит подсчёт кликов: сколько раз кликнули объявление за последние M минут и какие объявления самые популярные.',
      groups: [
        { kind: 'fr', title: 'Функциональные (FR)', q: 'Что система делает', desc: 'Функции из книги: счётчик по объявлению, топ-100, фильтры.', items: [
          { text: 'Число кликов объявления за последние M минут', in: true, why: 'Основной запрос рекламодателя и биллинга.', to: 'агрегация по минутам, БД агрегатов', shapes: [
            ['correctness', 2, 'По этим цифрам платят: ошибка в счёте это ошибка в деньгах.'],
            ['latency', 1, 'Цифры нужны через минуты, а не через сутки.'],
          ] },
          { text: 'Топ-100 объявлений по кликам каждую минуту', in: true, why: 'Аукцион и отчёты: что сейчас работает.', to: 'sliding window, Reduce', shapes: [
            ['latency', 1, 'Топ обновляется каждую минуту.'],
          ] },
          { text: 'Фильтры по ip, user_id, стране', in: true, why: 'Рекламодатель смотрит клики по своему рынку.', to: 'star schema, filter_id' },
          { text: 'Миллиард кликов в день, как у Facebook и Google', in: true, why: 'Масштаб книги.', to: 'Kafka, кластер агрегации', shapes: [
            ['throughput', 2, 'Пик 50 тысяч кликов в секунду.'],
          ] },
          { text: 'Показ рекламы и аукцион (RTB)', in: false, why: 'Аукцион потребляет наши цифры, но сам за рамками.' },
          { text: 'Поиск ботов и фрода', in: false, why: 'Книга отдаёт это отдельной системе: у нас только дедупликация.' },
          { text: 'Выставление счетов', in: false, why: 'Биллинг читает агрегаты, но строится отдельно.' },
        ] },
        { kind: 'nfr', title: 'Нефункциональные (NFR)', q: 'Насколько хорошо система это делает', desc: 'Книга: точность агрегатов, правильная обработка опоздавших и задвоенных событий, устойчивость к сбоям, задержка от клика до отчёта не больше нескольких минут.', items: [
          { text: 'Точность: каждый клик посчитан ровно один раз', in: true, nfr: 'correctness', why: 'От счёта зависят деньги рекламодателя.', to: 'exactly-once, сверка' },
          { text: 'Правильно учитывать опоздавшие и задвоенные клики', in: true, nfr: 'correctness', why: 'Клик может прийти позже или дважды.', to: 'event time, watermark, дедупликация' },
          { text: 'Устойчивость к частичным сбоям', in: true, nfr: 'robustness', why: 'Упавший узел агрегации не должен терять клики и надолго останавливать счёт.', to: 'снапшоты, Kafka' },
          { text: 'Задержка от клика до отчёта несколько минут', in: true, nfr: 'latency', why: 'Аукцион и рекламодатели смотрят свежие цифры.', to: 'потоковая агрегация' },
          { text: 'Ответ на каждый клик за миллисекунды', in: false, nfr: 'latency', why: 'Клик пишется в лог асинхронно, пользователь ничего не ждёт.' },
        ] },
      ],
      start: {
        title: 'Почему всё начинается здесь',
        text: 'Это задача про корректность потоковой обработки. Масштаб скромнее, чем кажется (50 тысяч в секунду), зато каждый клик это деньги. На интервью проверяют, знаешь ли ты event time и watermark, окна, exactly-once, что делать с горячим объявлением, как восстановиться после сбоя и как проверить, что всё посчитано верно.',
        chain: [
          { t: 'FR: что делаем', d: 'Счётчик за M минут, топ-100, фильтры.' },
          { t: 'NFR: насколько хорошо', d: 'Точность, опоздавшие и дубли, устойчивость, минуты до отчёта.' },
          { t: 'Оценка: сколько', d: '10 тысяч кликов в секунду, пик 50 тысяч, 100 ГБ в день.' },
          { t: 'Технологии: что следует', d: 'Kafka, потоковая агрегация, второй Kafka для exactly-once, Cassandra, сверка.' },
        ],
        skipTitle: 'Чего не берём',
        skip: [
          { t: 'COUNT по сырым на каждый запрос', d: 'Миллиарды строк на каждый отчёт: слишком медленно.' },
          { t: 'Синхронная запись клика в БД', d: 'Пик убьёт БД, а пользователю ответ не нужен.' },
          { t: 'Фрод и биллинг', d: 'Отдельные системы.' },
        ],
        revisit: 'Решение верно, пока верны требования. Новое FR может поменять NFR, и тогда пересматривается архитектура. Примеры ниже.',
      },
      future: [
        { fr: 'Произвольные фильтры и срезы', breaks: ['latency'],
          now: 'Заранее заданные фильтры, star schema.',
          why: 'Агрегатов на каждое сочетание не напасёшься.',
          fix: 'OLAP-база (ClickHouse, Druid) или Hive с Elasticsearch: считают срезы на лету.' },
        { fr: 'Счёт за секунды для аукциона', breaks: ['latency'],
          now: 'Минутные окна и watermark.',
          why: 'Watermark и минутное окно сами по себе дают задержку.',
          fix: 'Секундные окна с приблизительным счётом, точный счёт догоняет позже.' },
        { fr: 'Клики из нескольких регионов', breaks: ['robustness'],
          now: 'Один кластер Kafka и агрегации.',
          why: 'Сеть между регионами рвётся, задержка растёт.',
          fix: 'Агрегация в каждом регионе, глобальное слияние сверху. Топики делят по географии.' },
        { fr: 'Рост на 30% в год', breaks: ['throughput'],
          now: 'Партиции Kafka по ad_id.',
          why: 'Добавление партиций меняет раскладку ad_id и требует перебалансировки.',
          fix: 'Заранее завести партиций с запасом, перебалансировку делать ночью.' },
      ],
      nfr: [
        { id: 'correctness', name: 'Точность', en: 'Correctness', key: true, what: 'Каждый клик посчитан ровно один раз и в свою минуту.', metric: 'Расхождение со сверкой.', drives: 'Exactly-once, event time, watermark, сверка.', here: 'Главное NFR главы: это деньги.' },
        { id: 'robustness', name: 'Устойчивость', en: 'Fault tolerance', key: true, what: 'Сбой узла не теряет клики и быстро чинится.', metric: 'Минуты до восстановления.', drives: 'Kafka, снапшоты состояния.', here: 'Узлы агрегации держат состояние в памяти.' },
        { id: 'latency', name: 'Задержка', en: 'Latency', key: true, what: 'От клика до отчёта.', metric: 'Минуты.', drives: 'Потоковая агрегация, окна.', here: 'Несколько минут.' },
        { id: 'throughput', name: 'Пропускная способность', en: 'Throughput', key: false, what: 'Кликов в секунду.', metric: 'Пик приёма.', drives: 'Партиции Kafka, узлы агрегации.', here: '50 тысяч в секунду в пик.' },
      ],
      conclusion: 'Итог: счётчик, топ-100 и фильтры, и всё это точно. Дальше посчитаем клики и байты.',
    },

    estimate: {
      intro: 'Как в книге: миллиард активных пользователей в день, каждый кликает одно объявление. В сутках округлённо 100 тысяч секунд. Клик весит 0,1 КБ, объявлений 2 млн. Долю активных объявлений и число отчётов книга не задаёт, это допущения.',
      scnNote: 'Пик умножает поток кликов: в книге он в 5 раз выше среднего. Рост это 30% в год. По этим числам считаются карта, узкие места и эталон во всей главе.',
      inputs: [
        { id: 'users', label: 'Активных пользователей в день', unit: 'млн', min: 100, max: 3000, step: 100, value: 1000 },
        { id: 'perUser', label: 'Кликов на пользователя в день', unit: '', min: 1, max: 10, step: 1, value: 1 },
        { id: 'eventB', label: 'Размер клика', unit: 'Б', min: 50, max: 500, step: 10, value: 100 },
        { id: 'ads', label: 'Объявлений', unit: 'млн', min: 1, max: 20, step: 1, value: 2 },
        { id: 'reports', label: 'Запросов отчётов в секунду (допущение)', unit: '', min: 50, max: 2000, step: 50, value: 200 },
      ],
      rows: (d) => [
        { short: 'Клики', label: 'Кликов в секунду', uses: ['users', 'perUser', 'growth'], from: [], formula: 'пользователи × клики ÷ 100 000 с', v: d.clicks,
          calc: (d, i, f) => `${f(i.users * 1e6)} × ${i.perUser} ÷ 10⁵ = ${f(d.clicks)}/с`,
          why: 'Цифра книги: 10 тысяч кликов в секунду в среднем.', to: 'партиции Kafka' },
        { short: 'Пик', label: 'Кликов в пик', uses: ['peak'], from: [0], peak: true, flows: ['clicks'], formula: 'клики × пик', v: d.peakClicks,
          calc: (d, i, f) => `${f(d.clicks)} × ${d.k} = ${f(d.peakClicks)}/с`,
          why: 'Книга: пик в 5 раз выше среднего, 50 тысяч в секунду. Под него считаем Kafka и узлы агрегации.', to: 'карта: «Приём кликов»' },
        { short: 'Сырые', label: 'Сырых кликов в день, ГБ', uses: ['eventB'], from: [0], formula: 'клики в день × 0,1 КБ', v: d.gbDay,
          calc: (d, i, f) => `${f(d.day)} × ${i.eventB} Б = ${f(d.gbDay)} ГБ, в месяц ${dec(d.tbMonth)} ТБ`,
          why: 'Книга: 100 ГБ в день, 3 ТБ в месяц. Хранить их нужно для сверки и пересчёта.', to: 'Cassandra сырых' },
        { short: 'Агрегаты', label: 'Строк агрегатов в секунду', uses: ['ads'], from: [], flows: ['aggOut'], formula: 'объявления × 10% ÷ 60 с', v: d.aggRows,
          calc: (d, i, f) => `${f(i.ads * 1e6)} × ${ACTIVE * 100}% ÷ 60 = ${f(d.aggRows)}/с`,
          why: 'Строка на объявление и минуту, а не на клик: агрегаты в разы меньше. 10% активных объявлений в минуту это допущение.', to: 'карта: «Запись агрегатов»' },
        { short: 'Отчёты', label: 'Запросов отчётов в секунду', uses: ['reports'], from: [], flows: ['report'], formula: 'допущение', v: d.reports,
          calc: (d, i, f) => `${f(d.reports)}/с`,
          why: 'Читают маленькую таблицу агрегатов, а не миллиард сырых строк.', to: 'карта: «Отчёт»' },
      ],
      conclusion: (d) => `${big(d.clicks)} кликов в секунду, в пик ${big(d.peakClicks)}. В день ${big(d.gbDay)} ГБ сырых, в месяц ${dec(d.tbMonth)} ТБ. Строк агрегатов в секунду около ${big(d.aggRows)}: отчёты читают их, а не сырые клики.`,
    },

    api: {
      intro: 'Пользователь кликает, а сервер рекламы просто пишет строку в лог: ответа никто не ждёт. Дальше клики идут потоком, а наружу смотрят два запроса книги: счётчик по объявлению и топ объявлений. Храним и сырые клики, и агрегаты.',
      journeyTitle: 'Путь клика',
      conventions: [
        { k: 'Клик', v: 'ad_id, click_timestamp, user_id, ip, country' },
        { k: 'Приём', v: 'Строка в логе, log watcher шлёт в Kafka' },
        { k: 'Ключ', v: 'Партиция Kafka по ad_id: клики объявления в одном месте' },
        { k: 'Время', v: 'Event time: минута клика, а не обработки' },
        { k: 'Запись', v: 'Агрегат и offset атомарно: exactly-once' },
        { k: 'Чтение', v: 'Только агрегаты, сырые для сверки и пересчёта' },
      ],
      journey: [
        { ep: 'click', text: 'Пользователь кликнул объявление' },
        { ep: 'aggregate', text: 'Агрегатор посчитал минуту' },
        { ep: 'commit', text: 'Агрегат записан ровно один раз' },
        { ep: 'count', text: 'Рекламодатель смотрит счётчик' },
        { ep: 'popular', text: 'Аукцион берёт топ-100' },
      ],
      endpoints: [
        { id: 'click', method: 'INT', path: 'click log → Kafka', title: 'Событие клика', who: 'log watcher', flow: 'clicks', key: true,
          about: 'Сервер рекламы пишет клик в лог. Log watcher на машине отправляет строки в Kafka, партиция по ad_id. Пользователь ответа не ждёт.',
          body: { ad_id: 'ad001', click_timestamp: '2021-01-01 00:00:01', user_id: 'user1', ip: '207.148.22.22', country: 'USA' },
          ok: { status: 'записано', body: { topic: 'ad_click_events', partition: 17, offset: 908211 } },
          errors: [['—', 'BROKER_DOWN', 'Watcher повторяет: строка лежит в логе, клик не потерян']],
          sql: "INSERT INTO raw_clicks (ad_id, click_ts, user_id, ip, country) VALUES ('ad001', '2021-01-01 00:00:01', 'user1', '207.148.22.22', 'USA')",
          reads: [], writes: ['raw_clicks'] },
        { id: 'aggregate', method: 'SUB', path: 'ad_click_events', title: 'Агрегация минуты', who: 'агрегатор', flow: 'clicks',
          about: 'Map раскладывает клики по ad_id, Aggregate считает в памяти по event time, Reduce сливает топ-100. Окно закрывается после watermark.',
          body: { window: '00:00–00:01', watermark: '15s', group_by: ['ad_id', 'filter_id'] },
          ok: { status: 'окно закрыто', body: { ad_id: 'ad001', click_minute: '202101010000', count: 5 } },
          errors: [['—', 'LATE_EVENT', 'Клик пришёл после watermark: его добирает сверка']],
          reads: [], writes: [] },
        { id: 'commit', method: 'INT', path: 'aggregates → Kafka → DB writer', title: 'Запись агрегата', who: 'DB writer', flow: 'aggOut', key: true,
          about: 'Агрегаты уходят во второй Kafka. Запись в БД и сдвиг offset происходят в одной транзакции: упадём посередине, и не будет ни потери, ни дубля.',
          body: { ad_id: 'ad001', click_minute: '202101010000', filter_id: '0012', count: 5, offset: 908211 },
          ok: { status: 'commit', body: { committed: true } },
          errors: [['—', 'TX_ABORTED', 'Транзакция откатилась вместе с offset: окно пересчитают ещё раз']],
          sql: "UPSERT ad_click_agg (ad_id, click_minute, filter_id, count) VALUES ('ad001', '202101010000', '0012', 5)",
          reads: [], writes: ['ad_click_agg', 'most_clicked'] },
        { id: 'count', method: 'GET', path: '/v1/ads/{ad_id}/aggregated_count', title: 'Счётчик по объявлению', who: 'рекламодатель', flow: 'report', key: true,
          about: 'Число кликов объявления за интервал с фильтром. Книга: from и to по минутам, filter_id из star schema.',
          params: [['ad_id', 'path', 'string', true, 'ad001'], ['from', 'query', 'long', false, 'Начало, по умолчанию сейчас минус 1 минута'], ['to', 'query', 'long', false, 'Конец, по умолчанию сейчас'], ['filter', 'query', 'long', false, 'id фильтра: страна, ip, user_id']],
          example: 'GET /v1/ads/ad001/aggregated_count?from=202101010000&to=202101010005&filter=0012',
          ok: { status: '200 OK', body: { ad_id: 'ad001', count: 1271 } },
          errors: [['404', 'NOT_FOUND', 'Нет такого объявления'], ['400', 'BAD_RANGE', 'from позже to']],
          sql: "SELECT SUM(count) FROM ad_click_agg\nWHERE ad_id = 'ad001' AND filter_id = '0012'\n  AND click_minute BETWEEN '202101010000' AND '202101010005'",
          reads: ['ad_click_agg'], writes: [] },
        { id: 'popular', method: 'GET', path: '/v1/ads/popular_ads', title: 'Топ объявлений', who: 'аукцион, рекламодатель', flow: 'report',
          about: 'Топ N объявлений за последние M минут. Готовый список лежит в БД: Reduce считает его каждую минуту по скользящему окну.',
          params: [['count', 'query', 'integer', false, 'Сколько объявлений, 100'], ['window', 'query', 'integer', false, 'Окно в минутах'], ['filter', 'query', 'long', false, 'id фильтра']],
          example: 'GET /v1/ads/popular_ads?count=100&window=1',
          ok: { status: '200 OK', body: { ad_ids: ['ad007', 'ad001', 'ad042'] } },
          errors: [['400', 'BAD_WINDOW', 'Такого окна не считаем']],
          sql: "SELECT most_clicked_ads FROM most_clicked\nWHERE window_size = 1 ORDER BY update_time_minute DESC LIMIT 1",
          reads: ['most_clicked'], writes: [] },
      ],
      dbs: [
        { id: 'rawDB', name: 'Сырые клики', owner: 'Cassandra', why: 'Много записи, сверка и пересчёт.' },
        { id: 'aggDB', name: 'Агрегаты', owner: 'Cassandra', why: 'Маленькие строки, быстрые отчёты.' },
      ],
      tables: [
        { name: 'raw_clicks', db: 'rawDB', why: 'Каждый клик как есть. Пишется постоянно, читается сверкой и пересчётом.', rows: '≈ 1 млрд в день',
          cols: [{ n: 'ad_id', t: 'string', k: 'PK', d: 'Ключ партиции' }, { n: 'click_ts', t: 'TIMESTAMP', k: 'PK', d: 'Event time' }, { n: 'user_id', t: 'string', d: 'Кто' }, { n: 'ip', t: 'string', d: 'Откуда' }, { n: 'country', t: 'string', d: 'Страна' }],
          extra: ['Старое можно уносить в колоночные файлы в S3'] },
        { name: 'ad_click_agg', db: 'aggDB', why: 'Клики объявления за минуту по фильтру. Отсюда читает счётчик.', rows: 'строка на объявление, минуту и фильтр',
          cols: [{ n: 'ad_id', t: 'string', k: 'PK', d: 'Объявление' }, { n: 'click_minute', t: 'string', k: 'PK', d: '202101010000' }, { n: 'filter_id', t: 'string', k: 'PK', d: '0012', ref: { t: 'filters', c: 'filter_id' } }, { n: 'count', t: 'long', d: 'Кликов' }] },
        { name: 'filters', db: 'aggDB', why: 'Star schema: заранее заданные фильтры, по ним агрегаты считаются сразу.', rows: 'строка на фильтр',
          cols: [{ n: 'filter_id', t: 'string', k: 'PK', d: '0012' }, { n: 'region', t: 'string', d: 'US' }, { n: 'ip', t: 'string', d: '*' }, { n: 'user_id', t: 'string', d: '*' }] },
        { name: 'most_clicked', db: 'aggDB', why: 'Готовый топ за окно: запрос его просто читает.', rows: 'строка на окно и минуту',
          cols: [{ n: 'window_size', t: 'integer', k: 'PK', d: 'M минут' }, { n: 'update_time_minute', t: 'timestamp', k: 'PK', d: 'Когда посчитан' }, { n: 'most_clicked_ads', t: 'array', d: 'ad_id в порядке кликов' }] },
      ],
      more: {
        intro: 'Для интервью хватает таблиц выше. Ниже то, что добавляют, когда растут требования.',
        tables: [
          { name: 'snapshots', when: 'Состояние узлов агрегации для быстрого восстановления.', cols: 'node_id, offset, state_blob, taken_at' },
          { name: 'reconciliation', when: 'Итоги ночной сверки.', cols: 'day, ad_id, stream_count, batch_count, diff' },
        ],
        endpoints: [
          { ep: 'POST /v1/recalculate', when: 'Пересчитать интервал после исправления ошибки.' },
        ],
      },
      quiz: [
        { q: 'Зачем хранить сырые клики, если есть агрегаты?', a: 'Для сверки и пересчёта: нашли ошибку в агрегации, пересчитали из сырых.' },
        { q: 'Почему отчёты не считают COUNT по сырым?', a: 'Миллиарды строк на каждый запрос. Агрегаты в разы меньше и уже посчитаны.' },
        { q: 'Что такое star schema здесь?', a: 'Заранее заданные фильтры получают id, агрегаты считаются по ним сразу.' },
        { q: 'Почему партиция по ad_id?', a: 'Все клики объявления попадают в одну партицию и на один узел Aggregate.' },
      ],
    },

    board: { w: 1460, h: 940 },
    scenario: [
      { id: 'peak', label: 'Пик', unit: '×', stops: [1, 2, 5, 10], value: 5, hint: 'Во сколько раз пик выше среднего. Книга: в 5 раз' },
      { id: 'growth', label: 'Рост', unit: '×', stops: [1, 1.3, 2, 3], value: 1, hint: 'Книга: клики растут на 30% в год' },
    ],
    groups: ['Приём', 'Агрегация', 'Хранение', 'Отчёты'],
    expGroups: ['Хранение'],

    blocks: {
      watcher: { name: 'Log watcher', icon: '🖱️', cat: 'edge', group: 'Приём', pos: [20, 300], cap: 0, tag: 'Логи кликов с серверов рекламы',
        learn: { more: PIPE_MORE, what: 'Сервер рекламы пишет клик в лог, а агент на машине отправляет строки в Kafka. Пользователь ничего не ждёт.', plus: [], minus: [] } },
      clickQ: { name: 'Kafka: сырые клики', logo: 'kafka', icon: '📨', cat: 'async', group: 'Приём', tune: 'kafka', pos: [235, 300], cap: 3000, lat: 3, cost: 300, cx: 1, brokerCap: 60000,
        opts: { brokers: [3, 6, 9, 12], partitions: [16, 32, 64, 128] },
        links: [['watcher', 'self'], ['self', 'aggr'], ['self', 'rawWriter']], tag: 'Партиция по ad_id',
        fit: { use: 'Сгладить пик, перечитать клики после сбоя, отдать их двум потребителям.', avoid: 'Если кликов мало и точность не нужна.', limits: 'Новые партиции меняют раскладку ad_id.' },
        learn: { more: PIPE_MORE, what: 'Принимает клики и хранит их несколько дней. Агрегатор и запись сырых читают его независимо. Партиция по ad_id: клики объявления в одном месте.', plus: ['Пик не доходит до БД', 'Можно перечитать'], minus: ['Число партиций лучше задать с запасом сразу'] } },
      aggr: { name: 'Агрегация (Map, Aggregate, Reduce)', icon: '🧮', cat: 'svc', group: 'Агрегация', pos: [470, 300], cap: AGG_CAP, lat: 20, cost: 120, cx: 2, maxRep: 300, links: [['clickQ', 'self']], tag: 'DAG, счёт по минутам в памяти',
        overload: 'больше узлов агрегации: их не больше, чем партиций Kafka',
        learn: { more: PIPE_MORE, what: 'Потоковый MapReduce: Map раскладывает клики по ad_id, Aggregate считает минуту в памяти, Reduce сливает топ-100. В модели около 5000 кликов в секунду на узел.', plus: ['Считаем заранее, а не на запросе'], minus: ['Состояние в памяти: сбой надо уметь пережить'] } },
      aggQ: { name: 'Kafka: агрегаты', logo: 'kafka', icon: '📨', cat: 'async', group: 'Агрегация', via: true, pos: [720, 300], cap: 50000, lat: 3, cost: 150, cx: 1, maxRep: 10, repLabel: 'брок.',
        links: [['aggr', 'self'], ['self', 'aggWriter']], drop: [['aggr', 'aggWriter']], tag: 'Для exactly-once',
        learn: { more: PIPE_MORE, what: 'Книга ставит второй Kafka между агрегацией и записью. Так запись агрегата и offset становятся одной транзакцией, и сбой не даёт ни потери, ни дубля.', plus: ['Exactly-once от клика до БД', 'Агрегаты можно отдать и другим потребителям'], minus: ['Ещё один кластер'] } },
      aggWriter: { name: 'Запись агрегатов', icon: '✍️', cat: 'svc', group: 'Агрегация', pos: [960, 300], cap: 5000, lat: 5, cost: 60, cx: 0.5, maxRep: 50, links: [['aggr', 'self']], tag: 'DB writer',
        learn: { more: PIPE_MORE, what: 'Читает агрегаты из Kafka и пишет в БД вместе со сдвигом offset.', plus: [], minus: [] } },
      aggDB: { name: 'БД агрегатов', logo: 'cassandra', icon: '🗃️', cat: 'db', group: 'Хранение', pos: [1225, 300], cap: 10000, lat: 5, cost: 150, cx: 1, db: true, maxRep: 50, repLabel: 'узл.',
        links: [['aggWriter', 'self'], ['querySvc', 'self']], tag: 'Cassandra: ad_id, минута, count',
        fit: { use: 'Маленькие строки, запись постоянная, чтение по ключу и интервалу.', avoid: 'Произвольные срезы: для них OLAP.', limits: 'Только заранее заданные фильтры.' },
        learn: { more: DATA_MORE, what: 'Агрегаты по объявлению, минуте и фильтру и готовый топ-100. Книга берёт Cassandra: запись тяжёлая, а чтение простое.', plus: ['Отчёты читают немного строк'], minus: [] } },
      rawWriter: { name: 'Запись сырых', icon: '✍️', cat: 'svc', group: 'Хранение', pos: [470, 560], cap: 10000, lat: 5, cost: 60, cx: 0.5, maxRep: 300, links: [['clickQ', 'self']], tag: 'DB writer для сырых',
        learn: { more: DATA_MORE, what: 'Второй потребитель Kafka: пишет каждый клик в хранилище сырых. Агрегацию не задерживает.', plus: [], minus: [] } },
      rawDB: { name: 'Сырые клики (Cassandra)', logo: 'cassandra', icon: '🗄️', cat: 'db', group: 'Хранение', pos: [720, 560], cap: 10000, lat: 5, cost: 150, cx: 1, db: true, maxRep: 100, repLabel: 'узл.',
        links: [['rawWriter', 'self'], ['reconcile', 'self'], ['recalc', 'self']], tag: '100 ГБ в день',
        overload: 'больше узлов Cassandra',
        fit: { use: 'Много записи, редкое чтение большими кусками.', avoid: 'Отчёты: им нужны агрегаты.', limits: 'Старое дешевле держать в Parquet в S3.' },
        learn: { more: DATA_MORE, what: 'Все клики как есть: для сверки и пересчёта. Книга советует Cassandra, а старое можно уносить в колоночные файлы в S3.', plus: ['Страховка от ошибок агрегации'], minus: ['Хранить дорого'] } },
      advertiser: { name: 'Рекламодатели и аукцион', icon: '📢', cat: 'edge', group: 'Отчёты', pos: [960, 60], cap: 0, tag: 'Счётчик и топ-100',
        learn: { what: 'Рекламодатели смотрят отчёты, аукцион берёт топ-100.', plus: [], minus: [] } },
      querySvc: { name: 'Query service', icon: '🔍', cat: 'svc', group: 'Отчёты', pos: [1225, 60], cap: 1000, lat: 10, cost: 80, cx: 0.5, maxRep: 50, links: [['advertiser', 'self']], tag: 'aggregated_count, popular_ads',
        learn: { more: DATA_MORE, what: 'Отдаёт счётчик и топ из БД агрегатов.', plus: [], minus: [] } },
      reconcile: { name: 'Сверка (batch)', icon: '🧾', cat: 'svc', group: 'Хранение', pos: [960, 560], cap: 5000, lat: 1000, cost: 100, cx: 1, maxRep: 10, tag: 'В конце дня',
        learn: { more: DATA_MORE, what: 'В конце дня пересчитывает сырые клики по event time и сравнивает с агрегатами. Находит то, что не поймал поток: совсем поздние клики, ошибки.', plus: ['Доказывает, что счёт верен'], minus: ['Результат только через сутки'] } },
      recalc: { name: 'Пересчёт (recalculation)', icon: '🔁', cat: 'svc', group: 'Агрегация', pos: [470, 780], cap: 5000, lat: 1000, cost: 100, cx: 1, maxRep: 20, tag: 'Kappa: тот же код по сырым',
        learn: { more: PIPE_MORE, what: 'Нашли ошибку в агрегации: сервис читает сырые клики и гонит их через отдельный экземпляр агрегации, живой поток не трогаем. Это Kappa: один код и для потока, и для истории.', plus: ['Исправить прошлое без второго конвейера'], minus: ['Читает много сырых данных'] } },

      // ---------- эксперименты ----------
      olap: { name: 'OLAP: ClickHouse или Druid', icon: '🧊', cat: 'db', extra: true, group: 'Хранение', pos: [1225, 560], cap: 20000, lat: 15, cost: 300, cx: 1.5, db: true, maxRep: 50, repLabel: 'узл.',
        links: [['aggWriter', 'self'], ['querySvc', 'self']], drop: [['aggWriter', 'aggDB'], ['querySvc', 'aggDB']], tag: 'Срезы на лету',
        fit: { use: 'Произвольные фильтры и срезы, топ считается самой базой.', avoid: 'Если фильтров немного и они известны заранее.', limits: 'Тяжелее в эксплуатации, чем Cassandra.' },
        learn: { what: 'Альтернатива из книги: OLAP-база (ClickHouse, Druid) или Hive с Elasticsearch. Сама считает срезы и топы, star schema не нужна.', plus: ['Любые фильтры', 'Топ на лету без готовой таблицы'], minus: ['Дороже'] } },
    },

    flows: [
      { id: 'clicks', label: 'Приём кликов', color: 'var(--f1)', write: true, rate: (d) => d.peakClicks, chain: ['watcher', 'clickQ', 'aggr'] },
      { id: 'raw', side: true, label: 'Сырые клики', color: 'var(--f3)', write: true, rate: (d) => d.peakClicks, chain: ['clickQ', 'rawWriter', 'rawDB'] },
      { id: 'aggOut', side: true, label: 'Запись агрегатов', color: 'var(--f4)', write: true, rate: (d) => d.aggRows, chain: ['aggr', 'aggWriter', ['aggDB', 'olap']] },
      { id: 'report', label: 'Отчёт', color: 'var(--f2)', rate: (d) => d.reports, chain: ['advertiser', 'querySvc', ['aggDB', 'olap']] },
      { id: 'recon', optional: true, label: 'Сверка', color: 'var(--f6)', rate: () => 1000, chain: ['reconcile', 'rawDB'] },
      { id: 'recalc', optional: true, label: 'Пересчёт', color: 'var(--f8)', rate: () => 1000, chain: ['recalc', 'rawDB'] },
    ],

    derive: (i, deep) => {
      const p = (deep && deep.params) || {};
      const growth = p.growth || 1, k = p.peak || 5;
      const clicks = (i.users * 1e6 * i.perUser * growth) / 1e5, day = clicks * 1e5, gbDay = (day * i.eventB) / 1e9;
      return { k, growth, clicks, day, peakClicks: clicks * k, gbDay, tbMonth: (gbDay * 30) / 1000, aggRows: (i.ads * 1e6 * ACTIVE * growth) / 60, reports: i.reports };
    },

    reference: {
      base: {
        nodes: ['watcher', 'clickQ', 'aggr', 'aggQ', 'aggWriter', 'aggDB', 'rawWriter', 'rawDB', 'advertiser', 'querySvc'],
        edges: [['watcher', 'clickQ'], ['clickQ', 'aggr'], ['clickQ', 'rawWriter'], ['rawWriter', 'rawDB'], ['aggr', 'aggQ'], ['aggQ', 'aggWriter'], ['aggWriter', 'aggDB'], ['advertiser', 'querySvc'], ['querySvc', 'aggDB']],
        cfg: { clickQ: { brokers: 3, partitions: 32 } },
        adapt: [],
      },
      deep: {
        nodes: ['watcher', 'clickQ', 'aggr', 'aggQ', 'aggWriter', 'aggDB', 'rawWriter', 'rawDB', 'advertiser', 'querySvc', 'reconcile', 'recalc'],
        edges: [['watcher', 'clickQ'], ['clickQ', 'aggr'], ['clickQ', 'rawWriter'], ['rawWriter', 'rawDB'], ['aggr', 'aggQ'], ['aggQ', 'aggWriter'], ['aggWriter', 'aggDB'], ['advertiser', 'querySvc'], ['querySvc', 'aggDB'], ['reconcile', 'rawDB'], ['recalc', 'rawDB']],
        cfg: { clickQ: { brokers: 3, partitions: 32 } },
        adapt: [],
      },
    },

    problems: [
      { id: 'time', icon: '⏱️', title: 'Какое время считать', key: 'time',
        problem: 'Клик в 00:00:59 дошёл до агрегатора в 00:01:03. В какую минуту его записать и когда закрывать окно? Около 1% кликов приходят с опозданием (допущение).',
        options: [
          { v: 'proc', label: 'Processing time', note: 'Время прихода в агрегатор. Просто, но опоздавший клик уходит в чужую минуту.' },
          { v: 'event', label: 'Event time без запаса', note: 'Минута клика, окно закрывается ровно в конце минуты. Всё, что опоздало, отбрасывается.' },
          { v: 'watermark', label: 'Event time и watermark', note: 'Окно ждёт ещё 15 с. Почти все опоздавшие попадают в свою минуту, результат на 15 с позже. Так в книге.' },
        ],
        best: ['watermark'], say: 'Считаю по event time, времени самого клика, и закрываю окно с watermark около 15 секунд. Больше запас значит точнее, но позже. Совсем поздние клики добирает сверка в конце дня.' },
      { id: 'window', icon: '🪟', title: 'Как считать топ-100', key: 'window',
        problem: 'Аукциону каждую минуту нужен топ-100 за последние M минут. Считать его при запросе или держать готовым?',
        options: [
          { v: 'query', label: 'При запросе', note: 'ORDER BY count по всем объявлениям за M минут на каждый запрос. Просто, но тяжело и медленно.' },
          { v: 'sliding', label: 'Скользящее окно в Reduce', note: 'Каждый узел Aggregate держит свой топ в куче, Reduce сливает их раз в минуту и пишет готовый список. Так в книге.' },
        ],
        best: ['sliding'], say: 'Счётчик считаю в tumbling-окнах по минуте, а топ-100 в скользящем окне: каждый узел держит свой топ в куче, Reduce сливает их и пишет готовый список. Запрос просто читает строку.' },
      { id: 'once', icon: '1️⃣', title: 'Ровно один раз', key: 'once',
        problem: 'Узел агрегации упал посреди минуты. После рестарта он перечитает Kafka с последнего offset. Что будет с кликами, которые он успел посчитать?',
        options: [
          { v: 'atMost', label: 'Offset до обработки', note: 'At-most-once: offset сдвинули сразу, посчитанное в памяти пропало вместе с узлом.' },
          { v: 'atLeast', label: 'Offset после записи', note: 'At-least-once: упали между записью и сдвигом, и минута посчитается дважды.' },
          { v: 'exactly', label: 'Атомарно с offset', note: 'Exactly-once: агрегат и offset пишутся одной транзакцией через второй Kafka. Медленнее и сложнее, но для денег обязательно. Так в книге.' },
        ],
        best: ['exactly'], say: 'Для денег нужен exactly-once: агрегаты идут во второй Kafka, и запись в БД вместе со сдвигом offset делаю одной транзакцией. Дубли от клиента отсекаю по id события.' },
      { id: 'hot', icon: '🔥', title: 'Горячее объявление', key: 'hot',
        problem: 'Партиция по ad_id: все клики объявления считает один узел. Объявление в рекламе на Super Bowl собрало 8% всех кликов (допущение). Один узел справится?',
        options: [
          { v: 'none', label: 'Как все', note: 'Один узел на объявление. В пик он отстаёт, а остальные простаивают.' },
          { v: 'more', label: 'Больше узлов горячему', note: 'Менеджер ресурсов выдаёт горячему объявлению дополнительные узлы, клики делятся между ними и сливаются. Так в книге.' },
          { v: 'split', label: 'Локальная и глобальная агрегация', note: 'Каждый узел Map считает свою часть, а потом части складываются. Так делают Flink и Spark.' },
        ],
        best: ['more', 'split'], say: 'Горячее объявление считаю на нескольких узлах: менеджер ресурсов выдаёт ему дополнительные, клики делятся между ними, а результаты сливаются. Это тот же приём, что локальная и глобальная агрегация.' },
      { id: 'recover', icon: '💾', title: 'Восстановление после сбоя', key: 'recover',
        problem: 'Состояние узла (счётчики минут и топ) в памяти. Упал узел: откуда взять состояние?',
        options: [
          { v: 'replay', label: 'Перечитать Kafka', note: 'Читаем партиции с начала окна. Долго: пока догоняем, отчёты отстают.' },
          { v: 'snapshot', label: 'Снапшоты', note: 'Узел периодически сохраняет состояние и offset. Новый узел берёт снапшот и дочитывает Kafka только после него. Так в книге.' },
        ],
        best: ['snapshot'], say: 'Узлы агрегации периодически сохраняют снапшот: offset и состояние, включая топ. После сбоя новый узел поднимает снапшот и дочитывает Kafka только после него: восстановление за минуты.' },
      { id: 'arch', icon: '🏗️', title: 'Lambda или Kappa', key: 'arch',
        problem: 'В агрегации нашли ошибку, цифры за неделю неверны. Как пересчитать прошлое?',
        options: [
          { v: 'lambda', label: 'Lambda', note: 'Рядом с потоком работает пакетный конвейер, он пересчитывает историю. Но логику пишут дважды, и две версии расходятся.' },
          { v: 'kappa', label: 'Kappa и пересчёт', note: 'Один потоковый код. Recalculation service гонит сырые клики через отдельный экземпляр агрегации. Нужен блок «Пересчёт». Так в книге.' },
        ],
        best: ['kappa'], say: 'Беру Kappa: один потоковый код. Для исправления прошлого recalculation service читает сырые клики и гонит их через отдельный экземпляр агрегации, живой поток не трогаем.' },
      { id: 'scale', icon: '📈', title: 'Kafka под пик', settings: 'clickQ',
        problem: 'Пик и рост задаются над картой. Узлов агрегации не больше, чем партиций. Сколько брокеров и партиций?',
        hint: 'Брокеры и партиции настраиваются в блоке «Kafka: сырые клики». Книга советует заранее завести партиций с запасом: новые меняют раскладку ad_id. Кнопка «Подобрать под нагрузку» найдёт размер.',
        say: 'Партиционирую по ad_id и сразу завожу партиций с запасом: добавление партиций перекладывает объявления и требует перебалансировки, её делаю ночью. Узлов агрегации столько же, сколько партиций.' },
    ],

    metrics: [
      { id: 'wrong', label: 'Не в той минуте', bad: true, sub: 'кликов за день' },
      { id: 'lost', label: 'Потеряно кликов', bad: true, sub: 'на сбой узла' },
      { id: 'dup', label: 'Задвоено кликов', bad: true, sub: 'на сбой узла' },
      { id: 'hotLag', label: 'Отставание горячего', bad: true, sub: 'кликов в секунду' },
      { id: 'recoverMin', label: 'Восстановление', sub: 'минут после сбоя' },
    ],

    model(ctx) {
      const { d, deep, nodes, flows, stage } = ctx, c = deep.choices, M = ctx.metrics;
      const all = Object.values(nodes), of = (t) => all.filter((n) => n.type === t), F = (id) => flows.find((f) => f.id === id);
      const badge = (n, icon, title) => n && n.badges.push({ icon, title });
      const addLoad = (n, fid, x) => { if (!n || !x) return; n.load += x; n.flows[fid] = (n.flows[fid] || 0) + x; if (F(fid).write) n.wload += x; };
      const scale = (n, fid, m) => n && addLoad(n, fid, (n.flows[fid] || 0) * (m - 1));
      M.wrong = M.lost = M.dup = M.hotLag = M.noFix = 0; M.recoverMin = 2;
      if (stage !== 'deep') return;
      const aggr = of('aggr')[0], rep = F('report'), store = rep.ok && nodes[rep.path[rep.path.length - 1].id];
      const via = (f, t) => f.ok && f.path.some((x) => nodes[x.id].type === t);

      // ---------- время и окна ----------
      const late = d.day * LATE;
      if (c.time === 'proc') { M.wrong = late; ctx.warn('warn', `Processing time: около ${big(late)} опоздавших кликов в день уходят в чужую минуту. Рекламодатель платит не за ту минуту.`); }
      else if (c.time === 'event') { M.wrong = late; ctx.warn('warn', `Окно закрывается ровно в конце минуты: около ${big(late)} опоздавших кликов в день отбрасываются.`); }
      else {
        badge(aggr, '⏱️', 'Event time, watermark 15 с');
        if (F('recon').ok) badge(of('reconcile')[0], '🧾', 'Добирает совсем поздние');
        else { M.wrong = late * 0.02; ctx.warn('warn', `Watermark ловит почти всех, но около ${big(M.wrong)} совсем поздних кликов в день остаются вне счёта. Их находит сверка: добавь «Сверка» со стрелкой к сырым кликам.`); }
      }
      if (c.window === 'query') {
        scale(store, 'report', store && store.type === 'olap' ? 3 : 20); rep.extraLat += store && store.type === 'olap' ? 80 : 600;
        ctx.warn('warn', 'Топ-100 при запросе: каждый запрос сортирует все объявления за M минут.' + (store && store.type === 'olap' ? ' OLAP-база делает это быстро.' : ' БД агрегатов для этого не создана.'));
      } else badge(aggr, '🪟', 'Топ в скользящем окне');

      // ---------- ровно один раз ----------
      const perCrash = (d.peakClicks / Math.ceil(d.peakClicks / (AGG_CAP * 0.7))) * STATE_S; // клики узла за время между сохранениями
      const exactly = c.once === 'exactly' && via(F('aggOut'), 'aggQ');
      if (c.once === 'exactly' && !exactly) ctx.warn('warn', 'Exactly-once без второго Kafka не получится: запись в БД и offset не связаны транзакцией. Поставь «Kafka: агрегаты» между агрегацией и записью.');
      if (c.once === 'atMost') { M.lost = perCrash; ctx.warn('warn', `At-most-once: при сбое узла около ${big(perCrash)} уже посчитанных кликов пропадают.`); }
      else if (!exactly) { M.dup = perCrash; ctx.warn('warn', `At-least-once: при сбое узла около ${big(perCrash)} кликов посчитаются дважды.`); }
      else { ctx.cx += 1.5; badge(of('aggQ')[0], '1️⃣', 'Exactly-once: агрегат и offset вместе'); }

      // ---------- горячее объявление ----------
      const hot = d.peakClicks * HOT;
      if (c.hot === 'none') { M.hotLag = Math.max(0, hot - AGG_CAP); if (M.hotLag) ctx.warn('warn', `Горячее объявление: ${big(hot)} кликов в секунду на одном узле при мощности ${big(AGG_CAP)}. Его счётчик отстаёт всё больше.`); }
      else { ctx.cx += c.hot === 'split' ? 1 : 0.5; badge(aggr, '🔥', c.hot === 'split' ? 'Локальная и глобальная агрегация' : 'Горячему больше узлов'); }

      // ---------- сбои и пересчёт ----------
      if (c.recover === 'replay') { M.recoverMin = 60; ctx.warn('warn', 'Без снапшотов новый узел перечитывает Kafka с начала окна: около часа отчёты отстают.'); }
      else badge(aggr, '💾', 'Снапшоты состояния');
      if (c.arch === 'lambda') { ctx.cost += 400; ctx.cx += 3; ctx.warn('info', 'Lambda: пакетный конвейер пересчитает историю, но логика агрегации написана дважды. Две версии расходятся, и сверка находит их разницу, а не ошибки.'); }
      else if (!F('recalc').ok) { M.noFix = 1; ctx.warn('warn', 'Kappa без пересчёта: найдёшь ошибку в агрегации, а исправить прошлые цифры нечем. Добавь «Пересчёт» со стрелкой к сырым кликам.'); }
      else badge(of('recalc')[0], '🔁', 'Kappa: тот же код по сырым');
    },

    overload: 'больше копий или снять нагрузку раньше',
    linkWhy(a, b) {
      const B = this.blocks;
      if (a === 'watcher' && b !== 'clickQ') return 'Клики сначала в Kafka: она сглаживает пик и даёт перечитать данные.';
      if (a === 'advertiser' && b !== 'querySvc') return 'Рекламодатели читают через Query service.';
      if (a === 'querySvc' && b === 'rawDB') return 'Отчёты читают агрегаты, а не миллиард сырых строк.';
      if (B[a].db) return 'Хранилище отвечает на запросы, но само никого не вызывает.';
      return '';
    },

    rules(ctx) {
      const { metrics: M, stage, d, flows } = ctx;
      if (M.lost > 0) ctx.warn('bad', `При сбое узла теряется около ${big(M.lost)} кликов.`);
      if (M.dup > 0) ctx.warn('bad', `При сбое узла около ${big(M.dup)} кликов считаются дважды.`);
      if (M.wrong > 0) ctx.warn('bad', `Около ${big(M.wrong)} кликов в день посчитаны не в своей минуте.`);
      if (M.hotLag > 0) ctx.warn('bad', `Счётчик горячего объявления отстаёт на ${big(M.hotLag)} кликов каждую секунду.`);
      if (stage === 'base' && flows.every((f) => f.ok || f.optional)) ctx.warn('info', `Как показала оценка: в пик ${big(d.peakClicks)} кликов в секунду, а строк агрегатов в секунду всего ${big(d.aggRows)}. Отчёты читают агрегаты.`);
    },

    goals: {
      base: [
        { text: 'Клики, агрегаты и отчёты доходят до цели', check: (r) => r.m.routed },
        { text: 'Агрегаты идут через второй Kafka', check: (r) => r.flows.find((f) => f.id === 'aggOut').path.some((x) => r.nodes[x.id].type === 'aggQ') },
        { text: 'Нагрузка выдерживается', check: (r) => r.m.served >= 1 && r.m.maxU <= 0.9 },
      ],
      deep: [
        { text: 'Каждый клик посчитан ровно один раз и в свою минуту', check: (r) => r.m.routed && r.m.wrong === 0 && r.m.lost === 0 && r.m.dup === 0 },
        { text: 'Счётчик и топ-100 быстрее 200 мс', check: (r) => r.m.routed && r.flows.find((f) => f.id === 'report').lat <= 200 },
        { text: 'Горячее объявление не отстаёт', check: (r) => r.m.routed && r.m.hotLag === 0 },
        { text: 'Сбой чинится за минуты, прошлое можно пересчитать', check: (r) => r.m.routed && r.m.recoverMin <= 5 && r.m.noFix === 0 },
        { text: 'Выдерживаем пик ×10', check: (r) => r.d.k >= 10 && r.m.served >= 1 && r.m.maxU <= 0.9 },
      ],
    },

    summary: {
      db: 'aggDB', core: CORE,
      estCard: (d, f) => `${f(d.clicks)} кликов/с, пик ${f(d.peakClicks)}`,
      badRow: { label: 'Потери и дубли кликов', ids: ['lost', 'dup'] },
      script: (x) => {
        const t = x.fmt, d = x.d, ag = x.r.nodes.aggr;
        return [
          { step: 'Требования', min: 4, text: 'Счётчик кликов объявления за последние M минут, топ-100 каждую минуту, фильтры по стране, ip и user_id. Без аукциона, фрода и биллинга. NFR: точность (это деньги), опоздавшие и задвоенные клики, устойчивость к сбоям, несколько минут до отчёта.' },
          { step: 'Оценка', min: 3, text: `Миллиард кликов в день: ${t(d.clicks)} в секунду, в пик ×${d.k} это ${t(d.peakClicks)}. Сырых ${t(d.gbDay)} ГБ в день, ${dec(d.tbMonth)} ТБ в месяц. Объявлений 2 млн.` },
          { step: 'Данные', min: 3, text: 'Храню и сырые клики (для сверки и пересчёта), и агрегаты по объявлению, минуте и фильтру (для отчётов). Фильтры заранее в star schema. Запись тяжёлая, поэтому Cassandra.' },
          { step: 'Дизайн', min: 5, text: `Log watcher → Kafka (партиция по ad_id) → агрегация Map, Aggregate, Reduce${ag ? ` (${ag.rep} узлов)` : ''} → второй Kafka → запись в БД агрегатов. Второй потребитель первой Kafka пишет сырые клики. Query service отдаёт счётчик и топ.` },
          { step: 'Время', min: 3, text: x.choice('time').say },
          { step: 'Окна', min: 2, text: x.choice('window').say },
          { step: 'Exactly-once', min: 3, text: x.choice('once').say },
          { step: 'Масштаб', min: 3, text: `${x.choice('hot').say} Kafka партиционирую по ad_id и сразу завожу партиций с запасом: новые перекладывают объявления, перебалансировку делаю ночью.` },
          { step: 'Надёжность', min: 3, text: `${x.choice('recover').say} ${x.choice('arch').say} Сверка в конце дня сравнивает поток с пересчётом сырых.` },
          { step: 'Что изменится, если…', min: 2, text: 'Произвольные срезы: OLAP (ClickHouse, Druid) или Hive с Elasticsearch. Несколько регионов: агрегация в каждом и глобальное слияние. Рост: партиций с запасом и перебалансировка ночью.' },
        ];
      },
      says: {
        time: { proc: 'Processing time: опоздавшие клики уходят в чужую минуту.', event: 'Event time без запаса: опоздавшие отбрасываются.', watermark: 'Event time и watermark: почти все опоздавшие в своей минуте.' },
        window: { query: 'Топ-100 при запросе: тяжело и медленно.', sliding: 'Топ-100 в скользящем окне, готовый список в БД.' },
        once: { atMost: 'At-most-once: сбой теряет клики.', atLeast: 'At-least-once: сбой задваивает клики.', exactly: 'Exactly-once: агрегат и offset одной транзакцией.' },
        hot: { none: 'Горячее объявление на одном узле отстаёт.', more: 'Горячему объявлению дополнительные узлы.', split: 'Локальная и глобальная агрегация для горячих.' },
        recover: { replay: 'Без снапшотов восстановление около часа.', snapshot: 'Снапшоты: восстановление за минуты.' },
        arch: { lambda: 'Lambda: два конвейера, логика дважды.', kappa: 'Kappa и recalculation service.' },
      },
      tradeoffs: [
        { pick: 'Поток', alt: 'Batch раз в час', why: 'Цифры через минуты. Цена: окна, опоздавшие, состояние в памяти.' },
        { pick: 'Event time', alt: 'Processing time', why: 'Клик в своей минуте. Цена: watermark и задержка результата.' },
        { pick: 'Exactly-once', alt: 'At-least-once', why: 'Нет дублей в деньгах. Цена: транзакции, второй Kafka, медленнее.' },
        { pick: 'Kappa', alt: 'Lambda', why: 'Одна кодовая база. Цена: пересчёт гонит большие объёмы через поток.' },
        { pick: 'Снапшоты', alt: 'Перечитать Kafka', why: 'Минуты вместо часа. Цена: место и паузы на сохранение.' },
        { pick: 'Star schema', alt: 'OLAP', why: 'Быстрые простые запросы. Цена: только заранее заданные фильтры.' },
        { pick: 'Сырые и агрегаты', alt: 'Только агрегаты', why: 'Можно сверить и пересчитать. Цена: 3 ТБ в месяц.' },
      ],
      pitfalls: [
        'Считать COUNT по сырым на каждый запрос.',
        'Агрегировать по processing time.',
        'Закрывать окно без watermark.',
        'Сказать «exactly-once» и не объяснить, как связаны offset и запись.',
        'Забыть про горячее объявление.',
        'Хранить только агрегаты: нечем сверить и пересчитать.',
        'Добавлять партиции Kafka днём без плана перебалансировки.',
      ],
      questions: [
        { q: 'Сколько кликов в секунду?', a: '1 млрд в день ÷ 10⁵ с = 10 тысяч, пик ×5 это 50 тысяч.' },
        { q: 'Зачем хранить сырые клики?', a: 'Для сверки и пересчёта, если в агрегации найдут ошибку.' },
        { q: 'Event time или processing time?', a: 'Event time: клик в своей минуте. Processing time проще, но неточен.' },
        { q: 'Что такое watermark?', a: 'Запас перед закрытием окна для опоздавших. Больше запас значит точнее и позже.' },
        { q: 'Tumbling или sliding?', a: 'Tumbling для счётчика по минутам, sliding для топ-100 за последние M минут.' },
        { q: 'Как получить exactly-once?', a: 'Агрегаты во второй Kafka, запись в БД и offset одной транзакцией.' },
        { q: 'Что делать с горячим объявлением?', a: 'Дать ему больше узлов агрегации или считать локально и сливать глобально.' },
        { q: 'Как восстановиться после сбоя?', a: 'Снапшот состояния и offset, затем дочитать Kafka после него.' },
        { q: 'Lambda или Kappa?', a: 'Kappa: один код, пересчёт прошлого тем же кодом по сырым.' },
        { q: 'Как убедиться, что счёт верен?', a: 'Сверка в конце дня: пересчёт сырых по event time и сравнение с агрегатами.' },
      ],
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
