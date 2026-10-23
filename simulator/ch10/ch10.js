/* Глава 10. Real-time Gaming Leaderboard: данные для лаборатории (simulator/lab). */
(function (g) {
  // Числа в тексте: разряды пробелами, дробь через запятую.
  const num = (v) => Math.round(v).toLocaleString('ru-RU'), dec = (v) => String(+v.toFixed(1)).replace('.', ',');
  const big = (v) => (v >= 1e9 ? dec(v / 1e9) + ' млрд' : v >= 1e6 ? dec(v / 1e6) + ' млн' : v >= 1e4 ? num(v / 1e3) + ' тыс.' : v >= 10 ? num(v) : dec(v));
  const NODE_GB = 64; // допущение: память одного узла Redis
  const SCAN = 1e7; // допущение: строк в секунду, которые MySQL перебирает при подсчёте ранга
  const CHEAT = 0.001; // допущение: доля игроков, которые подделают очки, если клиент шлёт их сам
  const TIE = 0.2; // допущение: доля ответов топа, где у соседей равные очки
  const SNAP_S = 300; // допущение: снапшот RDB раз в 5 минут
  const SVC = ['lbSvc', 'lambdaSvc'], STORE = ['redis', 'sqlRank', 'dynamo'];

  const ZSET_MORE = [
    { title: '🧮 Sorted set в Redis', items: [
      ['Устройство', 'Хэш-таблица member → score и skip list, отсортированный по score. Вставка, изменение и ранг за O(log n).'],
      ['ZINCRBY', 'Игрок выиграл: ZINCRBY leaderboard_feb_2021 1 mary1934. Нет игрока, Redis создаст его с нулём.'],
      ['ZREVRANGE', 'Топ-10: ZREVRANGE leaderboard_feb_2021 0 9 WITHSCORES. Соседи игрока: тот же запрос с его рангом ±4.'],
      ['ZREVRANK', 'Место игрока: ZREVRANK leaderboard_feb_2021 mary1934. O(log n), а не пересчёт таблицы.'],
      ['Месяц', 'Каждый месяц новый ключ leaderboard_<месяц>: турнир начинается с нуля, старый ключ уходит в архив.'],
    ] },
    { title: '🐢 Почему не SQL', items: [
      ['Ранг', 'Чтобы узнать место, БД считает всех, у кого очков больше: на миллионах строк это секунды.'],
      ['Кэш', 'Очки меняются каждую секунду, кэшировать ранг бесполезно.'],
      ['Где SQL уместна', 'Мало игроков, или рейтинг считается раз в день пакетом.'],
    ] },
  ];
  const SCALE_MORE = [
    { title: '🧩 Шардирование рейтинга', items: [
      ['Один sorted set', 'Весь рейтинг это один ключ Redis. Ключ живёт на одном узле, шарды Redis Cluster его не делят.'],
      ['Фиксированные диапазоны', 'Шард на диапазон очков: 1–100, 101–200 и так далее. Топ-10 берём из верхнего шарда, ранг это место в своём шарде плюс число игроков в шардах выше. Нужен кэш user_id → очки, чтобы знать шард. Выбор книги.'],
      ['Хэш (Redis Cluster)', 'Игрок попадает в шард по CRC16(user_id) % 16 384 слотов. Топ-10 собирается со всех шардов (scatter-gather), а точный ранг игрока так не узнать.'],
      ['Память', 'Книга: 500 млн DAU это 65 ГБ. Под снапшот (fork) при частой записи держат вдвое больше памяти.'],
    ] },
    { title: '☁️ Другие варианты', items: [
      ['DynamoDB', 'Глобальный индекс: ключ партиции game#месяц#p{N} (write sharding), сортировка по score. Топ-10 со всех партиций, ранг только процентилем.'],
      ['Lambda', 'API Gateway вызывает функции AWS Lambda: серверов нет, масштабируется само. Цена: холодный старт и привязка к облаку.'],
    ] },
  ];
  const DATA_MORE = [
    { title: '🗄️ MySQL рядом с Redis', items: [
      ['users', 'Имя и аватар для топ-10: в sorted set хранится только user_id.'],
      ['points', 'Каждая победа: user_id, очки, время. История игр и страховка: из неё заново собирают рейтинг, если Redis потерян.'],
      ['Восстановление', 'Идём по points за месяц и делаем ZINCRBY для каждой строки. Пока идёт сбор, отвечает реплика Redis.'],
    ] },
  ];

  const CORE = ['Игрок (клиент)', 'Game service', 'Leaderboard service', 'Redis: sorted set', 'MySQL: игроки и победы', 'Kafka: события очков', 'Аналитика и пуши'];

  g.LAB = {
    id: 'ch10', n: 10, title: 'Real-time Gaming Leaderboard', subtitle: 'Рейтинг игроков, который обновляется сразу',
    intro: 'Мобильная игра ведёт рейтинг месяца: за каждую победу игрок получает очко, таблица показывает первую десятку и его собственное место. 5 млн игроков в день, 25 млн в месяц. Запросов немного, но ранг среди миллионов надо узнавать за миллисекунды и сразу после победы. Глава про выбор структуры данных: sorted set в Redis вместо ORDER BY в SQL, а потом про то, как её шардировать.',
    kpiFlows: [{ id: 'score', label: 'Начисление' }, { id: 'rank', label: 'Мой ранг' }], mainFlow: 'rank',
    cx: [10, 18],
    bgNote: 'Начисление очков это не тормозит.',

    steps: [
      { id: 'req', title: 'Требования', sub: 'что строим и что нет', kind: 'req', tag: '~5 мин', guide: 'Отметь функции и ограничения. Главное: топ-10 и место игрока в реальном времени, очки начисляет сервер.' },
      { id: 'est', title: 'Оценка нагрузки', sub: '5 млн игроков в день', kind: 'est', tag: '~5 мин', guide: 'Покрути слайдеры. Вывод: 2500 очков в секунду в пик и 650 МБ данных, это один Redis.' },
      { id: 'api', title: 'API и данные', sub: 'очки, топ-10, место', kind: 'api', tag: '~5 мин', guide: 'Три запроса книги и команды sorted set. Рейтинг в Redis, игроки и история побед в MySQL.' },
      { id: 'hld', title: 'Дизайн', sub: 'схема на карте', kind: 'map', stage: 'base', tag: '~10 мин', guide: 'Игрок → Game service → Leaderboard service → Redis. Топ-10 и ранг клиент берёт у Leaderboard service. История побед в MySQL.' },
      { id: 'deep', title: 'Углубление', sub: 'проблемы и решения', kind: 'map', stage: 'deep', tag: '~15 мин', guide: 'Кто начисляет очки, очередь для других потребителей, рост ×100 и шардирование, равные очки, восстановление после сбоя.' },
      { id: 'sum', title: 'Итог', sub: 'рассказ для интервью', kind: 'sum', tag: '~5 мин', guide: 'Перескажи решение по шагам и ответь на вопросы для повторения.' },
    ],

    requirements: {
      intro: 'Сначала договариваемся, что строим. Отметь то, что входит в задачу, и нажми «Проверить». Книга строит рейтинг месяца для мобильной игры: очко за победу, топ-10 и место игрока.',
      groups: [
        { kind: 'fr', title: 'Функциональные (FR)', q: 'Что система делает', desc: 'Функции из книги: очко за победу, топ-10, место игрока, рейтинг месяца.', items: [
          { text: 'Показать первую десятку игроков', in: true, why: 'Главный экран рейтинга.', to: 'ZREVRANGE 0 9', shapes: [
            ['latency', 1, 'Таблица открывается вместе с игрой.'],
          ] },
          { text: 'Показать место конкретного игрока', in: true, why: 'Игрок хочет знать, где он, даже если он 1 000 000-й.', to: 'ZREVRANK', shapes: [
            ['latency', 2, 'Ранг среди миллионов за миллисекунды: ORDER BY так не умеет.'],
            ['freshness', 1, 'Место меняется после каждой победы.'],
          ] },
          { text: 'Очко за каждую победу', in: true, why: 'Простая система очков из книги.', to: 'ZINCRBY', shapes: [
            ['freshness', 2, 'Рейтинг обновляется сразу после победы.'],
          ] },
          { text: 'Рейтинг месяца, с нуля каждый месяц', in: true, why: 'Новый турнир каждый месяц.', to: 'ключ leaderboard_<месяц>' },
          { text: 'При равных очках одинаковое место', in: true, why: 'Книга: одинаковые очки дают одинаковый ранг, порядок по времени как бонус.', to: 'хэш user_id → время победы' },
          { text: 'Четыре игрока выше и ниже меня', in: false, why: 'Книга оставляет это бонусом: тот же ZREVRANGE со сдвигом от моего ранга.' },
          { text: 'Рейтинг среди друзей', in: false, why: 'Отдельная задача: свой маленький рейтинг на каждого игрока.' },
          { text: 'Сама игра и подбор соперников', in: false, why: 'Рейтинг получает только результат матча.' },
        ] },
        { kind: 'nfr', title: 'Нефункциональные (NFR)', q: 'Насколько хорошо система это делает', desc: 'Книга: обновление в реальном времени, масштабируемость, доступность и надёжность.', items: [
          { text: 'Очки видны в рейтинге сразу после победы', in: true, nfr: 'freshness', why: 'Игрок выиграл и хочет увидеть новое место.', to: 'запись прямо в sorted set' },
          { text: 'Топ-10 и место игрока за миллисекунды', in: true, nfr: 'latency', why: 'Таблица открывается вместе с игрой.', to: 'Redis, O(log n)' },
          { text: 'Рост до сотен миллионов игроков', in: true, nfr: 'scale', why: 'Игра может выстрелить: книга разбирает 500 млн DAU.', to: 'шарды по диапазонам очков' },
          { text: 'Сбой не теряет очки', in: true, nfr: 'durability', why: 'За очками стоят призы турнира.', to: 'реплика Redis и история в MySQL' },
          { text: 'Строгая транзакционность между Redis и MySQL', in: false, nfr: 'durability', why: 'Хватает того, что MySQL источник истины, а рейтинг из неё можно собрать заново.' },
        ] },
      ],
      start: {
        title: 'Почему всё начинается здесь',
        text: 'Нагрузка в этой главе скромная: тысячи запросов в секунду. Сложность в другом: место игрока среди 25 млн нужно знать мгновенно и после каждой победы. На интервью проверяют, увидишь ли ты, что SQL тут не справится, назовёшь ли sorted set и его команды, и как будешь его шардировать, когда игроков станет в 100 раз больше.',
        chain: [
          { t: 'FR: что делаем', d: 'Очко за победу, топ-10, место игрока, рейтинг месяца.' },
          { t: 'NFR: насколько хорошо', d: 'Сразу после победы, миллисекунды, рост, без потерь.' },
          { t: 'Оценка: сколько', d: '500 очков в секунду, пик 2500, 650 МБ данных.' },
          { t: 'Технологии: что следует', d: 'Redis sorted set, MySQL для истории, шарды по диапазонам очков.' },
        ],
        skipTitle: 'Чего не берём',
        skip: [
          { t: 'ORDER BY в SQL на каждый запрос', d: 'Ранг пересчитывает миллионы строк, а кэш бесполезен: очки меняются каждую секунду.' },
          { t: 'Очки прямо от клиента', d: 'Подделать запрос легко: очки начисляет сервер.' },
          { t: 'Шарды с первого дня', d: '650 МБ и 2500 записей в секунду держит один Redis.' },
        ],
        revisit: 'Решение верно, пока верны требования. Новое FR может поменять NFR, и тогда пересматривается архитектура. Примеры ниже.',
      },
      future: [
        { fr: 'Игроков в 100 раз больше', breaks: ['scale'],
          now: 'Один sorted set в одном Redis.',
          why: '65 ГБ и 250 тысяч запросов в секунду не влезают в один узел, а один ключ нельзя разнести по шардам.',
          fix: 'Шарды по диапазонам очков: топ из верхнего, ранг суммой по шардам выше.' },
        { fr: 'Рейтинг среди друзей', breaks: ['latency'],
          now: 'Один общий рейтинг месяца.',
          why: 'У каждого игрока свой список, общий sorted set не подходит.',
          fix: 'Маленький sorted set на игрока или выборка очков друзей и сортировка на лету.' },
        { fr: 'Очки нужны аналитике и пушам', breaks: ['freshness'],
          now: 'Game service зовёт Leaderboard service напрямую.',
          why: 'Каждый новый потребитель удлиняет и ломает начисление.',
          fix: 'Kafka между Game service и потребителями: каждый читает сам.' },
        { fr: 'Игры с очками не за победу, а с дробными баллами', breaks: ['freshness'],
          now: 'Целое очко за победу.',
          why: 'Диапазоны шардов по очкам надо пересчитать, иначе один шард перегрет.',
          fix: 'Подбирать границы диапазонов по распределению очков и двигать их между месяцами.' },
      ],
      nfr: [
        { id: 'freshness', name: 'Свежесть', en: 'Real-time', key: true, what: 'Победа видна в рейтинге сразу.', metric: 'Задержка от победы до нового места.', drives: 'Запись прямо в sorted set, без пакетного пересчёта.', here: 'Миллисекунды.' },
        { id: 'latency', name: 'Задержка', en: 'Latency', key: true, what: 'Топ-10 и место игрока.', metric: 'p50 ответа.', drives: 'Redis sorted set: ранг за O(log n).', here: 'Десятки мс вместе с сетью.' },
        { id: 'scale', name: 'Масштабируемость', en: 'Scalability', key: true, what: 'Рост игроков без переделки.', metric: 'Память и запросы на узел.', drives: 'Шарды по диапазонам очков.', here: 'До 500 млн DAU в разборе книги.' },
        { id: 'durability', name: 'Надёжность', en: 'Reliability', key: false, what: 'Очки не теряются при сбое.', metric: 'Потерянных очков на сбой.', drives: 'Реплика Redis, история побед в MySQL.', here: 'Redis можно собрать заново из MySQL.' },
      ],
      conclusion: 'Итог: очко за победу, топ-10 и место игрока, всё сразу. Дальше посчитаем запросы и память.',
    },

    estimate: {
      intro: 'Как в книге: 5 млн активных игроков в день и 25 млн за месяц, каждый играет 10 игр в день. В сутках округлённо 100 тысяч секунд. Таблицу игрок открывает раз в день, при входе в игру. Запись в sorted set весит 26 байт: 24 на user_id и 2 на очки.',
      scnNote: 'Пик умножает поток игр и открытий: в книге он в 5 раз выше среднего. Рост это масштаб из углубления книги: ×100, 500 млн игроков в день.',
      inputs: [
        { id: 'dau', label: 'Активных игроков в день', unit: 'млн', min: 1, max: 100, step: 1, value: 5 },
        { id: 'mau', label: 'Активных игроков в месяц', unit: 'млн', min: 1, max: 500, step: 1, value: 25 },
        { id: 'games', label: 'Игр на игрока в день', unit: '', min: 1, max: 50, step: 1, value: 10 },
        { id: 'opens', label: 'Открытий таблицы на игрока в день', unit: '', min: 1, max: 10, step: 1, value: 1 },
        { id: 'entryB', label: 'Запись в sorted set', unit: 'Б', min: 16, max: 128, step: 2, value: 26 },
      ],
      rows: (d) => [
        { short: 'Игроки', label: 'Игроков в секунду', uses: ['dau', 'growth'], from: [], formula: 'DAU ÷ 100 000 с', v: d.ups,
          calc: (d, i, f) => `${f(i.dau * 1e6 * d.growth)} ÷ 10⁵ = ${f(d.ups)}/с`,
          why: 'Цифра книги: 50 игроков в секунду в среднем.', to: 'все остальные строки' },
        { short: 'Очки', label: 'Очков в секунду', uses: ['games'], from: [0], flows: ['score'], formula: 'игроки/с × игры', v: d.score,
          calc: (d, i, f) => `${f(d.ups)} × ${i.games} = ${f(d.score)}/с`,
          why: 'Книга: 500 обновлений в секунду. Каждое это ZINCRBY в sorted set и строка в истории.', to: 'карта: «Начисление очков»' },
        { short: 'Пик', label: 'Очков в пик', uses: ['peak'], from: [1], peak: true, flows: ['score', 'hist'], formula: 'очки × пик', v: d.peakScore,
          calc: (d, i, f) => `${f(d.score)} × ${d.k} = ${f(d.peakScore)}/с`,
          why: 'Книга: пик в 5 раз выше, 2500 в секунду. Один Redis держит около 100 тысяч операций.', to: 'Redis, MySQL' },
        { short: 'Топ-10', label: 'Открытий топ-10 в секунду', uses: ['opens'], from: [0], flows: ['top', 'rank'], formula: 'игроки/с × открытия', v: d.top,
          calc: (d, i, f) => `${f(d.ups)} × ${i.opens} = ${f(d.top)}/с, в пик ${f(d.peakTop)}`,
          why: 'Книга: около 50 в секунду. Чтений в 10 раз меньше, чем записей.', to: 'карта: «Топ-10», «Мой ранг»' },
        { short: 'Память', label: 'Весь рейтинг, МБ', uses: ['mau', 'entryB'], from: [], formula: 'MAU × 26 Б', v: d.memMB,
          calc: (d, i, f) => `${f(d.members)} × ${i.entryB} Б = ${f(d.memMB)} МБ`,
          why: 'Книга: 650 МБ даже если все 25 млн сыграли хоть раз. Помещается в память одного Redis даже с запасом под skip list.', to: 'Redis: один узел или шарды' },
      ],
      conclusion: (d) => `${big(d.score)} очков в секунду, в пик ${big(d.peakScore)}, а топ-10 открывают ${big(d.top)} раз в секунду. Весь рейтинг ${d.memMB >= 1000 ? dec(d.memMB / 1000) + ' ГБ' : big(d.memMB) + ' МБ'}: ${d.memMB * 2 <= NODE_GB * 1000 ? 'помещается в один Redis' : 'в один Redis не влезет, нужны шарды'}.`,
    },

    api: {
      intro: 'Три запроса из книги. Очки шлёт не клиент, а Game service: он знает, кто на самом деле выиграл. Топ-10 и место клиент спрашивает у Leaderboard service. Сам рейтинг это один sorted set в Redis на месяц, а игроки и история побед в MySQL.',
      journeyTitle: 'Путь победы',
      conventions: [
        { k: 'Ключ', v: 'leaderboard_<месяц>, например leaderboard_feb_2021' },
        { k: 'Член', v: 'user_id, 24 байта' },
        { k: 'Score', v: 'Очки за месяц, 16-битное число' },
        { k: 'Кто пишет', v: 'Только Game service, внутренний API' },
        { k: 'Сложность', v: 'ZINCRBY, ZREVRANK, ZREVRANGE за O(log n)' },
        { k: 'Истина', v: 'MySQL points: из неё собирают рейтинг заново' },
      ],
      journey: [
        { ep: 'score', text: 'Игрок выиграл матч' },
        { ep: 'top', text: 'Открыл таблицу: первая десятка' },
        { ep: 'rank', text: 'Нашёл своё место' },
      ],
      endpoints: [
        { id: 'score', method: 'POST', path: '/v1/scores', title: 'Начислить очко', who: 'Game service', flow: 'score', key: true,
          about: 'Внутренний API: зовёт только Game service после проверки матча. Клиент сюда не ходит, иначе очки можно подделать.',
          body: { user_id: 'mary1934', points: 1 },
          ok: { status: '200 OK', body: { result: 'Successfully updated' } },
          errors: [['400', 'BAD_REQUEST', 'Нет user_id или очков']],
          sql: "ZINCRBY leaderboard_feb_2021 1 'mary1934'\nINSERT INTO points (user_id, score, ts) VALUES ('mary1934', 1, NOW())",
          reads: [], writes: ['leaderboard_<месяц>', 'points'] },
        { id: 'top', method: 'GET', path: '/v1/scores', title: 'Топ-10', who: 'клиент', flow: 'top', key: true,
          about: 'Первая десятка месяца. Sorted set отдаёт user_id и очки, имена и аватары добирает MySQL одним запросом.',
          example: 'GET /v1/scores',
          ok: { status: '200 OK', body: { data: [{ user_id: 'user_id1', user_name: 'alice', rank: 1, score: 976 }, { user_id: 'user_id2', user_name: 'bob', rank: 2, score: 965 }], total: 10 } },
          errors: [['503', 'UNAVAILABLE', 'Redis недоступен: отвечает реплика']],
          sql: "ZREVRANGE leaderboard_feb_2021 0 9 WITHSCORES\nSELECT user_id, name, avatar FROM users WHERE user_id IN (…10…)",
          reads: ['leaderboard_<месяц>', 'users'], writes: [] },
        { id: 'rank', method: 'GET', path: '/v1/scores/{user_id}', title: 'Место игрока', who: 'клиент', flow: 'rank', key: true,
          about: 'Очки и место игрока. ZREVRANK считает место за O(log n), а не пересчётом таблицы.',
          params: [['user_id', 'path', 'string', true, 'mary1934']],
          example: 'GET /v1/scores/mary1934',
          ok: { status: '200 OK', body: { user_info: { user_id: 'mary1934', score: 112, rank: 6 } } },
          errors: [['404', 'NOT_FOUND', 'Игрок в этом месяце ещё не выигрывал']],
          sql: "ZREVRANK leaderboard_feb_2021 'mary1934'\nZSCORE leaderboard_feb_2021 'mary1934'",
          reads: ['leaderboard_<месяц>'], writes: [] },
      ],
      dbs: [
        { id: 'redis', name: 'Рейтинг', owner: 'Redis sorted set', why: 'Ранг за O(log n), всё в памяти.' },
        { id: 'mysql', name: 'Игроки и победы', owner: 'MySQL', why: 'Профили и история: источник истины.' },
      ],
      tables: [
        { name: 'leaderboard_<месяц>', db: 'redis', why: 'Sorted set: user_id и очки, отсортированные skip list.', rows: '≈ 25 млн членов',
          cols: [{ n: 'member', t: 'string', k: 'PK', d: 'user_id, 24 байта' }, { n: 'score', t: 'int16', d: 'Очки за месяц, 2 байта' }],
          extra: ['Каждый месяц новый ключ'] },
        { name: 'users', db: 'mysql', why: 'Имя и аватар для топ-10.', rows: '≈ 25 млн',
          cols: [{ n: 'user_id', t: 'string', k: 'PK', d: 'mary1934' }, { n: 'name', t: 'string', d: 'Отображаемое имя' }, { n: 'avatar', t: 'string', d: 'Ссылка на картинку' }] },
        { name: 'points', db: 'mysql', why: 'Каждая победа. История игрока и запас для восстановления рейтинга.', rows: '≈ 50 млн в день',
          cols: [{ n: 'user_id', t: 'string', k: 'PK', d: 'Кто', ref: { t: 'users', c: 'user_id' } }, { n: 'ts', t: 'TIMESTAMP', k: 'PK', d: 'Когда выиграл' }, { n: 'score', t: 'int', d: 'Очков за матч' }] },
      ],
      more: {
        intro: 'Для интервью хватает таблиц выше. Ниже то, что добавляют, когда растут требования.',
        tables: [
          { name: 'last_win (Redis hash)', when: 'Порядок при равных очках: кто раньше набрал, тот выше.', cols: 'user_id → время последней победы' },
          { name: 'user_score (кэш)', when: 'Шарды по диапазонам очков: в каком шарде сейчас игрок.', cols: 'user_id → очки' },
        ],
        endpoints: [
          { ep: 'GET /v1/scores/{user_id}/around', when: 'Бонус книги: четыре игрока выше и ниже. ZREVRANGE от ранга −4 до +4.' },
        ],
      },
      quiz: [
        { q: 'Почему очки шлёт Game service, а не клиент?', a: 'Запрос клиента легко подделать. Сервер знает, кто на самом деле выиграл.' },
        { q: 'Что такое sorted set?', a: 'Хэш member → score и skip list по score. Вставка и ранг за O(log n).' },
        { q: 'Какой командой узнать место игрока?', a: 'ZREVRANK leaderboard_<месяц> user_id.' },
        { q: 'Зачем MySQL, если всё в Redis?', a: 'Профили для топ-10 и история побед, из которой можно собрать рейтинг заново.' },
      ],
    },

    board: { w: 1240, h: 760 },
    scenario: [
      { id: 'peak', label: 'Пик', unit: '×', stops: [1, 2, 5, 10], value: 5, hint: 'Во сколько раз пик выше среднего. Книга: в 5 раз' },
      { id: 'growth', label: 'Рост', unit: '×', stops: [1, 10, 100], value: 1, hint: 'Во сколько раз больше игроков. Книга в углублении: ×100, 500 млн в день' },
    ],
    groups: ['Вход', 'Сервисы', 'Хранение'],
    expGroups: ['Хранение', 'Сервисы'],

    blocks: {
      client: { name: 'Игрок (клиент)', icon: '🎮', cat: 'edge', group: 'Вход', pos: [20, 330], cap: 0, tag: 'Мобильная игра',
        learn: { what: 'Игра на телефоне. Играет матч с Game service, а таблицу и своё место спрашивает у Leaderboard service.', plus: [], minus: [] } },
      gameSvc: { name: 'Game service', icon: '🕹️', cat: 'svc', group: 'Сервисы', pos: [250, 150], cap: 2000, lat: 10, cost: 80, cx: 0.5, maxRep: 500,
        links: [['client', 'self'], ['self', SVC]], tag: 'Проверяет матч и начисляет очко',
        learn: { what: 'Ведёт матч и знает, кто выиграл. После победы зовёт Leaderboard service. Поэтому подделать очки с клиента нельзя.', plus: ['Очки от сервера, а не от клиента'], minus: [] } },
      lbSvc: { name: 'Leaderboard service', icon: '🏆', cat: 'svc', group: 'Сервисы', pos: [480, 330], cap: 5000, lat: 5, cost: 80, cx: 0.5, maxRep: 300,
        links: [['client', 'self'], ['gameSvc', 'self'], ['self', 'redis'], ['self', 'mysql']], tag: 'Очки, топ-10, место',
        learn: { more: ZSET_MORE, what: 'Принимает очки от Game service и отвечает клиенту: топ-10 и место игрока. Без состояния, копии добавляются свободно.', plus: [], minus: [] } },
      redis: { name: 'Redis: sorted set', logo: 'redis', icon: '⚡', cat: 'db', group: 'Хранение', pos: [720, 230], cap: 100000, lat: 1, cost: 200, cx: 1, db: true, tune: 'kv', repLabel: 'узл.', hotKey: 0.01,
        opts: { shards: [1, 3, 6, 12, 24, 48] }, hotFix: 'делить рейтинг на несколько sorted set по диапазонам очков',
        links: [[SVC, 'self']], tag: 'leaderboard_<месяц>',
        fit: { use: 'Рейтинг в реальном времени: ранг и топ за O(log n).', avoid: 'Как единственное хранилище очков: нужна история в MySQL.', limits: 'Один ключ живёт на одном узле, около 100 тыс. операций в секунду и память узла.' },
        learn: { more: ZSET_MORE.concat(SCALE_MORE), what: 'Весь рейтинг месяца в одном sorted set: user_id и очки. ZINCRBY за победу, ZREVRANGE для топ-10, ZREVRANK для места. Книга: 650 МБ и 2500 записей в секунду держит один узел, реплика для отказа.', plus: ['Ранг за O(log n)', 'Всё в памяти'], minus: ['Один ключ не разнести по шардам'] } },
      mysql: { name: 'MySQL: игроки и победы', icon: '🗄️', cat: 'db', group: 'Хранение', pos: [720, 480], cap: 10000, lat: 5, cost: 300, cx: 1, db: true, tune: 'sql', repLabel: 'узл.',
        opts: { shards: [1, 2, 4, 8, 16, 32, 64] }, shardKeys: [{ v: 'uid', label: 'user_id', note: 'История игрока читается из одного шарда.' }],
        links: [[SVC, 'self']], tag: 'users, points',
        fit: { use: 'Профили и история побед: источник истины.', avoid: 'Ранг и топ на лету: это работа sorted set.', limits: 'Запись истории растёт вместе с играми.' },
        learn: { more: DATA_MORE, what: 'Таблица users для имён в топ-10 и таблица points со всеми победами. Если Redis потерян, рейтинг собирают из points заново.', plus: ['Долговечно'], minus: [] } },
      kafka: { name: 'Kafka: события очков', logo: 'kafka', icon: '📨', cat: 'async', group: 'Сервисы', via: true, pos: [480, 40], cap: 50000, lat: 3, cost: 150, cx: 1, maxRep: 20, repLabel: 'брок.',
        links: [['gameSvc', 'self'], ['self', SVC], ['self', 'consumers']], drop: [['gameSvc', 'lbSvc'], ['gameSvc', 'lambdaSvc']], bring: ['consumers'], tag: 'Очки для нескольких потребителей',
        fit: { use: 'Очки нужны не только рейтингу: аналитике, пушам.', avoid: 'Если рейтинг единственный потребитель: лишний кластер.', limits: 'Начисление становится асинхронным, на миллисекунды позже.' },
        learn: { what: 'Книга: если очки нужны ещё аналитике и пуш-уведомлениям, Game service пишет событие в Kafka, а каждый потребитель читает сам.', plus: ['Новый потребитель не трогает Game service'], minus: ['Ещё один кластер'] } },
      consumers: { name: 'Аналитика и пуши', icon: '📊', cat: 'svc', group: 'Сервисы', pos: [720, 40], cap: 5000, lat: 10, cost: 60, cx: 0.5, maxRep: 200,
        links: [['kafka', 'self']], tag: 'Читают события очков',
        learn: { what: 'Аналитика игр и пуши «тебя обогнали». Читают события очков из Kafka в своём темпе.', plus: [], minus: [] } },

      // ---------- эксперименты ----------
      sqlRank: { name: 'MySQL как рейтинг (ORDER BY)', icon: '🐢', cat: 'db', extra: true, group: 'Хранение', pos: [960, 230], cap: 10000, lat: 5, cost: 300, cx: 0.5, db: true, tune: 'sql', repLabel: 'узл.',
        links: [[SVC, 'self']], drop: [['lbSvc', 'redis'], ['lambdaSvc', 'redis']], tag: 'Таблица leaderboard (user_id, score)',
        fit: { use: 'Мало игроков или рейтинг раз в день.', avoid: 'Ранг среди миллионов в реальном времени.', limits: 'Ранг пересчитывает всех, у кого очков больше.' },
        learn: { more: ZSET_MORE, what: 'Первое решение книги: таблица user_id и очков, ранг через ORDER BY score DESC. На миллионах строк каждый запрос места это перебор таблицы, а кэш бесполезен.', plus: ['Просто и знакомо'], minus: ['Ранг за секунды, а не миллисекунды'] } },
      dynamo: { name: 'DynamoDB (NoSQL)', icon: '🗃️', cat: 'db', extra: true, group: 'Хранение', pos: [960, 400], cap: 3000, lat: 5, cost: 60, cx: 1, db: true, maxRep: 400, repLabel: 'парт.',
        links: [[SVC, 'self']], drop: [['lbSvc', 'redis'], ['lambdaSvc', 'redis']], tag: 'Индекс по score, write sharding',
        fit: { use: 'Полностью управляемое хранилище в облаке.', avoid: 'Если нужен точный ранг каждого игрока.', limits: 'Топ собирается со всех партиций, ранг только процентилем.' },
        learn: { more: SCALE_MORE, what: 'Альтернатива из книги: глобальный вторичный индекс с ключом game#месяц#p{N} и сортировкой по score. Партиции спасают от горячего ключа, но топ-10 собирается со всех, а место игрока только приблизительно.', plus: ['Без серверов и шардов вручную'], minus: ['Ранг процентилем'] } },
      lambdaSvc: { name: 'API Gateway + Lambda', icon: 'λ', cat: 'svc', extra: true, group: 'Сервисы', pos: [480, 560], cap: 1000, lat: 20, cost: 12, cx: 0.5, maxRep: 3000,
        links: [['client', 'self'], ['gameSvc', 'self'], ['kafka', 'self'], ['self', STORE], ['self', 'mysql']], drop: [['client', 'lbSvc'], ['gameSvc', 'lbSvc'], ['kafka', 'lbSvc'], ['lbSvc', 'redis'], ['lbSvc', 'mysql']], tag: 'Serverless вместо своего сервиса',
        fit: { use: 'Неровная нагрузка, нет желания держать серверы.', avoid: 'Строгие миллисекунды: холодный старт.', limits: 'Привязка к AWS.' },
        learn: { more: SCALE_MORE, what: 'Вариант книги «в облаке»: API Gateway вызывает функции Lambda, те ходят в Redis и MySQL. Масштабируется само, платим за вызовы.', plus: ['Нет серверов', 'Масштаб сам'], minus: ['Холодный старт, +мс'] } },
    },

    flows: [
      { id: 'score', label: 'Начисление очков', color: 'var(--f1)', write: true, rate: (d) => d.peakScore, chain: ['client', 'gameSvc', SVC, STORE] },
      { id: 'top', label: 'Топ-10', color: 'var(--f2)', rate: (d) => d.peakTop, chain: ['client', SVC, STORE] },
      { id: 'rank', label: 'Мой ранг', color: 'var(--f3)', rate: (d) => d.peakTop, chain: ['client', SVC, STORE] },
      { id: 'hist', side: true, label: 'История побед', color: 'var(--f4)', write: true, rate: (d) => d.peakScore, chain: [SVC, 'mysql'] },
      { id: 'profile', side: true, label: 'Профили топ-10', color: 'var(--f6)', rate: (d) => d.peakTop, chain: [SVC, 'mysql'] },
      { id: 'events', side: true, optional: true, label: 'Аналитика и пуши', color: 'var(--f8)', write: true, rate: (d) => d.peakScore, chain: ['kafka', 'consumers'] },
    ],

    derive: (i, deep) => {
      const p = (deep && deep.params) || {};
      const growth = p.growth || 1, k = p.peak || 5;
      const ups = (i.dau * 1e6 * growth) / 1e5, score = ups * i.games, top = ups * i.opens, members = i.mau * 1e6 * growth, memMB = (members * i.entryB) / 1e6;
      return { k, growth, ups, score, peakScore: score * k, top, peakTop: top * k, members, memMB, memGB: memMB / 1000 };
    },

    reference: {
      base: {
        nodes: ['client', 'gameSvc', 'lbSvc', 'redis', 'mysql'],
        edges: [['client', 'gameSvc'], ['gameSvc', 'lbSvc'], ['client', 'lbSvc'], ['lbSvc', 'redis'], ['lbSvc', 'mysql']],
        cfg: { redis: { shards: 1, replicas: 1 }, mysql: { replicas: 1 } },
        adapt: [],
      },
      deep: {
        nodes: ['client', 'gameSvc', 'kafka', 'consumers', 'lbSvc', 'redis', 'mysql'],
        edges: [['client', 'gameSvc'], ['gameSvc', 'kafka'], ['kafka', 'lbSvc'], ['kafka', 'consumers'], ['client', 'lbSvc'], ['lbSvc', 'redis'], ['lbSvc', 'mysql']],
        cfg: { redis: { shards: 1, replicas: 1 }, mysql: { replicas: 1 } },
        adapt: [],
      },
    },

    problems: [
      { id: 'who', icon: '🛡️', title: 'Кто начисляет очки', key: 'who',
        problem: 'Игрок выиграл матч. Кто сообщает рейтингу об очке: сам клиент или сервер игры?',
        options: [
          { v: 'client', label: 'Клиент', note: 'Приложение само шлёт POST /v1/scores. Просто, но запрос легко подделать или перехватить (man-in-the-middle).' },
          { v: 'server', label: 'Game service', note: 'Сервер ведёт матч и знает победителя, он и начисляет очко. API рейтинга внутренний. Так в книге.' },
        ],
        best: ['server'], say: 'Очки начисляет только Game service: он ведёт матч и знает победителя. POST /v1/scores внутренний, клиент только читает топ-10 и своё место.' },
      { id: 'queue', icon: '📨', title: 'Очки нужны ещё аналитике и пушам', key: 'queue',
        problem: 'Кроме рейтинга события очков хотят аналитика и пуши «тебя обогнали». Как их раздать?',
        options: [
          { v: 'direct', label: 'Game service зовёт всех', note: 'После победы сервер по очереди вызывает рейтинг, аналитику и пуши. Каждый новый потребитель удлиняет начисление, а сбой любого его ломает.' },
          { v: 'kafka', label: 'Kafka', note: 'Game service пишет событие в Kafka, каждый потребитель читает сам. Нужен блок «Kafka: события очков» между Game service и Leaderboard service. Так в книге.' },
        ],
        best: ['kafka'], say: 'Если очки нужны не только рейтингу, ставлю Kafka между Game service и потребителями: рейтинг, аналитика и пуши читают каждый в своём темпе. Если потребитель один, обхожусь прямым вызовом.' },
      { id: 'shard', icon: '🧩', title: 'Игроков в 100 раз больше', key: 'shard',
        problem: 'Книга: 500 млн игроков в день это 65 ГБ рейтинга и 250 тысяч обновлений в секунду. Один Redis не справится. Как делить рейтинг?',
        options: [
          { v: 'one', label: 'Один sorted set', note: 'Весь рейтинг это один ключ. Redis Cluster делит ключи, а не один ключ: шарды простаивают, а узел упирается в память и запись.' },
          { v: 'hash', label: 'Хэш по user_id', note: 'Redis Cluster раскладывает игроков по шардам. Запись делится, но топ-10 собирается со всех шардов, а точный ранг игрока не узнать.' },
          { v: 'fixed', label: 'Диапазоны очков', note: 'Шард на диапазон очков. Топ-10 из верхнего шарда, ранг это место в шарде плюс игроки выше. Нужен кэш user_id → очки. Так в книге.' },
        ],
        best: ['fixed'], say: 'Делю рейтинг на фиксированные диапазоны очков, шард на диапазон. Топ-10 беру из верхнего шарда, место игрока это ранг в его шарде плюс число игроков в шардах выше. Чтобы знать шард, держу кэш user_id → очки. Хэш по user_id не беру: топ пришлось бы собирать со всех шардов, а ранг не узнать.' },
      { id: 'tie', icon: '⚖️', title: 'Равные очки', key: 'tie',
        problem: 'У нескольких игроков в топ-10 одинаковые очки. В каком порядке их показать?',
        options: [
          { v: 'member', label: 'Как отсортирует Redis', note: 'При равном score Redis упорядочивает по member, то есть по user_id. Для игрока порядок случайный.' },
          { v: 'time', label: 'Кто раньше набрал', note: 'Redis hash user_id → время последней победы. При равных очках выше тот, у кого время раньше. Так в книге.' },
        ],
        best: ['time'], say: 'Равные очки дают одинаковое место. Порядок внутри определяю временем: рядом держу hash user_id → время последней победы, кто набрал раньше, тот выше.' },
      { id: 'recover', icon: '💾', title: 'Redis упал', key: 'recover',
        problem: 'Узел Redis потерян вместе с памятью. Откуда взять рейтинг?',
        options: [
          { v: 'snapshot', label: 'Снапшот RDB', note: 'Redis раз в 5 минут сохраняет память на диск. Всё, что было после снапшота, пропадает.' },
          { v: 'rebuild', label: 'Реплика и история в MySQL', note: 'Отвечает реплика, а рейтинг собирается из таблицы points: ZINCRBY для каждой победы месяца. Так в книге.' },
        ],
        best: ['rebuild'], say: 'У Redis есть реплика, она подхватывает запросы. Если потеряны обе копии, рейтинг собираю заново из MySQL: прохожу таблицу points за месяц и делаю ZINCRBY для каждой победы.' },
      { id: 'scale', icon: '📈', title: 'Redis под рост', settings: 'redis',
        problem: 'Рост и пик задаются над картой. Сколько шардов и реплик у Redis?',
        hint: 'Шарды и реплики настраиваются в блоке «Redis: sorted set». Шарды помогают, только если рейтинг поделён на несколько sorted set (решение выше). Книга: при частой записи держи вдвое больше памяти под снапшот. Кнопка «Подобрать под нагрузку» найдёт размер.',
        say: 'Считаю память и запросы: при ×100 это 65 ГБ, а с запасом под снапшот 130 ГБ, и 250 тысяч записей в секунду. Значит, несколько шардов по диапазонам очков, у каждого реплика.' },
    ],

    metrics: [
      { id: 'cheat', label: 'Накрутка очков', bad: true, sub: 'игроков с подделкой за день' },
      { id: 'rankErr', label: 'Неточный ранг', bad: true, sub: 'запросов места в секунду' },
      { id: 'tie', label: 'Ничьи без порядка', bad: true, sub: 'ответов топа в секунду' },
      { id: 'lost', label: 'Потеряно очков', bad: true, sub: 'на сбой Redis' },
      { id: 'memOver', label: 'Не влезает в память', bad: true, sub: `ГБ сверх узла на ${NODE_GB} ГБ` },
    ],

    model(ctx) {
      const { d, deep, nodes, flows, stage } = ctx, c = deep.choices, M = ctx.metrics;
      const all = Object.values(nodes), of = (t) => all.filter((n) => n.type === t), F = (id) => flows.find((f) => f.id === id);
      const badge = (n, icon, title) => n && n.badges.push({ icon, title });
      const addLoad = (n, fid, x) => { if (!n || !x) return; n.load += x; n.flows[fid] = (n.flows[fid] || 0) + x; if (F(fid).write) n.wload += x; };
      const scale = (n, fid, m) => n && addLoad(n, fid, (n.flows[fid] || 0) * (m - 1));
      const via = (f, t) => f.ok && f.path.some((x) => nodes[x.id].type === t);
      M.cheat = M.rankErr = M.tie = M.lost = M.memOver = M.coupled = 0;
      const end = (f) => f.ok && nodes[f.path[f.path.length - 1].id], store = end(F('rank')) || end(F('top')) || end(F('score'));

      // ---------- хранилище рейтинга: ранг в SQL и NoSQL ----------
      if (store && store.type === 'sqlRank') {
        const scan = (d.members / SCAN) * 1000;
        F('rank').extraLat += scan; scale(store, 'rank', Math.max(2, d.members / 1e6));
        ctx.warn('warn', `MySQL считает место игрока перебором всех, у кого очков больше: до ${big(d.members)} строк, около ${scan >= 1000 ? dec(scan / 1000) + ' с' : num(scan) + ' мс'} на запрос. Кэш не поможет: очки меняются каждую секунду.`);
      }
      if (store && store.type === 'dynamo') {
        M.rankErr = d.peakTop; scale(store, 'top', 10); F('top').extraLat += 15;
        ctx.warn('info', 'DynamoDB: топ-10 собирается со всех партиций (scatter-gather), а место игрока только процентилем: «ты в топ-10%».');
      }
      if (stage !== 'deep') return;
      const redis = store && store.type === 'redis' ? store : null;

      // ---------- кто начисляет очки ----------
      if (c.who === 'client') { M.cheat = d.members * CHEAT; ctx.warn('warn', `Очки шлёт клиент: около ${big(M.cheat)} игроков подделают запрос и поднимутся в топ.`); }
      else badge(of('gameSvc')[0], '🛡️', 'Очки начисляет сервер');

      // ---------- другие потребители очков ----------
      if (c.queue === 'direct') { M.coupled = 1; F('score').extraLat += 30; ctx.warn('warn', 'Game service сам вызывает рейтинг, аналитику и пуши: начисление ждёт всех, а сбой пушей ломает рейтинг.'); }
      else if (!via(F('score'), 'kafka')) { M.coupled = 1; ctx.warn('warn', 'Kafka выбрана, но очки идут мимо неё. Поставь «Kafka: события очков» между Game service и Leaderboard service.'); }
      else badge(of('kafka')[0], '📨', 'Очки для всех потребителей');

      // ---------- шардирование ----------
      const s = redis ? redis.cfg.shards : 1, need = d.memGB * 2; // вдвое под снапшот при частой записи
      if (redis) {
        if (c.shard === 'one') {
          redis.hotKey = 1;
          if (s > 1) ctx.warn('warn', `Весь рейтинг это один ключ, он живёт в одном шарде из ${s}. Остальные шарды простаивают.`);
          M.memOver = Math.max(0, need - NODE_GB);
        } else {
          M.memOver = Math.max(0, need / s - NODE_GB);
          if (s > 1 && c.shard === 'hash') {
            scale(redis, 'top', s); F('top').extraLat += 2 + s; M.rankErr = d.peakTop;
            ctx.warn('warn', `Хэш по user_id: топ-10 собирается со всех ${s} шардов, а точное место игрока не узнать: игроки с большим счётом разбросаны по шардам.`);
          }
          if (s > 1 && c.shard === 'fixed') { scale(redis, 'score', 1.05); scale(redis, 'rank', 1.2); ctx.cx += 1; badge(redis, '🧩', 'Шарды по диапазонам очков'); }
        }
        if (M.memOver > 0) ctx.warn('warn', `Рейтинг ${dec(d.memGB)} ГБ, с запасом под снапшот ${dec(need)} ГБ. На узел ${dec(c.shard === 'one' ? need : need / s)} ГБ при памяти ${NODE_GB} ГБ.`);
      }

      // ---------- равные очки ----------
      if (c.tie === 'member') { M.tie = d.peakTop * TIE; ctx.warn('warn', 'При равных очках Redis сортирует по user_id: для игрока порядок случайный.'); }
      else { scale(redis, 'score', 2); ctx.cx += 0.5; badge(redis, '⚖️', 'Hash user_id → время победы'); }

      // ---------- восстановление ----------
      if (c.recover === 'snapshot') { M.lost = d.score * SNAP_S; ctx.warn('warn', `Снапшот раз в 5 минут: при потере узла пропадает около ${big(M.lost)} очков.`); }
      else {
        badge(of('mysql')[0], '💾', 'Рейтинг собирается из points');
        if (redis && !redis.cfg.replicas) ctx.warn('warn', 'У Redis нет реплики: пока рейтинг собирается из MySQL, топ-10 и место не отвечают.');
      }
    },

    overload: 'больше копий или снять нагрузку раньше',
    linkWhy(a, b) {
      const B = this.blocks;
      if (a === 'client' && B[b].db) return 'Клиент не ходит в хранилище напрямую: только через Leaderboard service.';
      if (a === 'client' && b === 'kafka') return 'События очков пишет Game service, а не клиент.';
      if (a === 'gameSvc' && B[b].db) return 'Game service отдаёт очко Leaderboard service, а тот пишет в рейтинг и историю.';
      if (B[a].db) return 'Хранилище отвечает на запросы, но само никого не вызывает.';
      return '';
    },

    rules(ctx) {
      const { metrics: M, stage, d, flows } = ctx;
      if (M.cheat > 0) ctx.warn('bad', `Около ${big(M.cheat)} игроков с поддельными очками.`);
      if (M.rankErr > 0) ctx.warn('bad', `${big(M.rankErr)} запросов места в секунду получают неточный ответ.`);
      if (M.lost > 0) ctx.warn('bad', `При сбое Redis теряется около ${big(M.lost)} очков.`);
      if (M.memOver > 0) ctx.warn('bad', `Рейтинг не влезает в память узла на ${dec(M.memOver)} ГБ.`);
      if (stage === 'base' && flows.every((f) => f.ok || f.optional)) ctx.warn('info', `Как показала оценка: в пик ${big(d.peakScore)} очков в секунду и ${d.memMB >= 1000 ? dec(d.memGB) + ' ГБ' : big(d.memMB) + ' МБ'} данных. ${d.memGB * 2 <= NODE_GB ? 'Это один Redis с репликой.' : 'В один Redis это не влезет: шардирование в углублении.'}`);
    },

    goals: {
      base: [
        { text: 'Очки, топ-10, место и история доходят до цели', check: (r) => r.m.routed },
        { text: 'Место игрока и топ-10 быстрее 50 мс', check: (r) => r.m.routed && ['top', 'rank'].every((id) => r.flows.find((f) => f.id === id).lat <= 50) },
        { text: 'Нагрузка выдерживается', check: (r) => r.m.served >= 1 && r.m.maxU <= 0.9 },
      ],
      deep: [
        { text: 'Очки начисляет сервер, равные очки упорядочены', check: (r) => r.m.routed && r.m.cheat === 0 && r.m.tie === 0 },
        { text: 'Точное место игрока быстрее 50 мс', check: (r) => r.m.routed && r.m.rankErr === 0 && ['top', 'rank'].every((id) => r.flows.find((f) => f.id === id).lat <= 50) },
        { text: 'Аналитика и пуши не тормозят начисление', check: (r) => r.m.routed && r.m.coupled === 0 && r.flows.find((f) => f.id === 'events').ok },
        { text: 'Сбой Redis не теряет очки', check: (r) => r.m.routed && r.m.lost === 0 },
        { text: 'Выдерживаем ×100 игроков', check: (r) => r.d.growth >= 100 && r.m.served >= 1 && r.m.maxU <= 0.9 && r.m.memOver === 0 },
      ],
    },

    summary: {
      db: 'redis', core: CORE,
      estCard: (d, f) => `${f(d.score)} очков/с, пик ${f(d.peakScore)}`,
      badRow: { label: 'Накрутки и потери очков', ids: ['cheat', 'lost'] },
      script: (x) => {
        const t = x.fmt, d = x.d, rc = x.cfgOf('redis');
        return [
          { step: 'Требования', min: 4, text: 'Рейтинг месяца для мобильной игры: очко за победу, топ-10 и место игрока, при равных очках одинаковое место. Без рейтинга друзей и самой игры. NFR: обновление сразу после победы, миллисекунды на ответ, рост, без потери очков.' },
          { step: 'Оценка', min: 3, text: `5 млн игроков в день это 50 в секунду, по 10 игр: ${t(d.score)} очков в секунду, в пик ×${d.k} ${t(d.peakScore)}. Топ-10 открывают ${t(d.top)} раз в секунду. 25 млн игроков по 26 байт это ${d.memMB >= 1000 ? dec(d.memGB) + ' ГБ' : t(d.memMB) + ' МБ'}.` },
          { step: 'Данные', min: 3, text: 'SQL с ORDER BY не беру: место игрока это перебор миллионов строк, а кэш бесполезен. Рейтинг месяца это sorted set в Redis: ZINCRBY за победу, ZREVRANGE для топ-10, ZREVRANK для места, всё за O(log n). Профили и историю побед держу в MySQL.' },
          { step: 'Дизайн', min: 4, text: `Игрок играет с Game service, тот после победы зовёт Leaderboard service${x.has('kafka') ? ' через Kafka' : ''}. Leaderboard service пишет в Redis и в таблицу points, а клиенту отдаёт топ-10 и место. ${x.choice('who').say}` },
          { step: 'Потребители', min: 2, text: x.choice('queue').say },
          { step: 'Масштаб', min: 5, text: `${x.choice('shard').say}${rc ? ` У меня ${rc.shards} шард${rc.shards === 1 ? '' : rc.shards < 5 ? 'а' : 'ов'} и ${rc.replicas} реплик${rc.replicas === 1 ? 'а' : 'и'} на шард.` : ''}` },
          { step: 'Равные очки', min: 2, text: x.choice('tie').say },
          { step: 'Надёжность', min: 2, text: x.choice('recover').say },
          { step: 'Что изменится, если…', min: 2, text: 'Не хочется держать серверы: API Gateway и Lambda. NoSQL вместо Redis: DynamoDB с write sharding, но место только процентилем. Рейтинг друзей: свой маленький sorted set на игрока.' },
        ];
      },
      says: {
        who: { client: 'Очки шлёт клиент: их легко подделать.', server: 'Очки начисляет Game service.' },
        queue: { direct: 'Game service зовёт всех потребителей сам.', kafka: 'Kafka раздаёт очки рейтингу, аналитике и пушам.' },
        shard: { one: 'Один sorted set: не делится по шардам.', hash: 'Хэш по user_id: топ со всех шардов, ранг неточный.', fixed: 'Шарды по диапазонам очков.' },
        tie: { member: 'Равные очки в порядке user_id.', time: 'Равные очки: выше тот, кто набрал раньше.' },
        recover: { snapshot: 'Снапшот: теряются последние минуты.', rebuild: 'Реплика и сборка рейтинга из MySQL.' },
      },
      tradeoffs: [
        { pick: 'Redis sorted set', alt: 'MySQL и ORDER BY', why: 'Ранг за O(log n). Цена: данные в памяти, нужна страховка в MySQL.' },
        { pick: 'Очки от Game service', alt: 'Очки от клиента', why: 'Нет накруток. Цена: внутренний API и лишний переход.' },
        { pick: 'Диапазоны очков', alt: 'Хэш по user_id', why: 'Топ из одного шарда и точный ранг. Цена: кэш user_id → очки и переезд игрока между шардами.' },
        { pick: 'Kafka', alt: 'Прямые вызовы', why: 'Потребители независимы. Цена: ещё кластер, начисление асинхронное.' },
        { pick: 'MySQL points', alt: 'Только Redis', why: 'Рейтинг можно собрать заново. Цена: вторая запись на каждую победу.' },
        { pick: 'Свои сервисы', alt: 'API Gateway и Lambda', why: 'Предсказуемая задержка. Цена: серверы держим сами.' },
      ],
      pitfalls: [
        'Считать ранг через ORDER BY на каждый запрос.',
        'Пустить клиента начислять себе очки.',
        'Сказать «шардируем Redis» и не заметить, что рейтинг это один ключ.',
        'Взять хэш-шарды и не объяснить, как найти топ-10 и место игрока.',
        'Забыть про равные очки.',
        'Хранить очки только в Redis без истории.',
        'Не посчитать память: 650 МБ это один узел, 65 ГБ уже нет.',
      ],
      questions: [
        { q: 'Сколько очков в секунду?', a: '5 млн ÷ 10⁵ с = 50 игроков в секунду, × 10 игр = 500, в пик ×5 это 2500.' },
        { q: 'Сколько памяти займёт рейтинг?', a: '25 млн × 26 байт = 650 МБ: один Redis. При ×100 это 65 ГБ.' },
        { q: 'Почему не SQL?', a: 'Место игрока это перебор всех, у кого очков больше, а кэш бесполезен: очки меняются постоянно.' },
        { q: 'Какие команды sorted set нужны?', a: 'ZINCRBY за победу, ZREVRANGE 0 9 для топ-10, ZREVRANK для места.' },
        { q: 'Почему очки не шлёт клиент?', a: 'Запрос легко подделать. Победителя знает Game service.' },
        { q: 'Когда нужна Kafka?', a: 'Когда очки читает не только рейтинг: аналитика, пуши.' },
        { q: 'Как шардировать рейтинг?', a: 'По диапазонам очков: топ из верхнего шарда, ранг это место в шарде плюс игроки выше.' },
        { q: 'Чем плох хэш по user_id?', a: 'Топ-10 надо собирать со всех шардов, а точный ранг игрока не узнать.' },
        { q: 'Как упорядочить равные очки?', a: 'Hash user_id → время последней победы: кто раньше, тот выше.' },
        { q: 'Как восстановить рейтинг после сбоя?', a: 'Реплика Redis, а если потеряно всё, ZINCRBY по каждой строке points из MySQL.' },
      ],
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
