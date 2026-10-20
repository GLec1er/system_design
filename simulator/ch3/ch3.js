/* Глава 3. Google Maps: данные для лаборатории (simulator/lab). */
(function (g) {
  // Числа в тексте: разряды пробелами, дробь через запятую.
  const num = (v) => Math.round(v).toLocaleString('ru-RU'), dec = (v) => String(+v.toFixed(1)).replace('.', ',');
  const big = (v) => (v >= 1e9 ? dec(v / 1e9) + ' млрд' : v >= 1e6 ? dec(v / 1e6) + ' млн' : v >= 1e4 ? num(v / 1e3) + ' тыс.' : v >= 10 ? num(v) : dec(v));
  const DAY = 1e5; // сутки ≈ 10⁵ секунд, как считает книга
  const BATCH = 15; // книга: клиент копит точки 15 секунд и шлёт пачкой
  const WS_CONN = 100000; // допущение: соединений на WebSocket-сервер

  const MAP_MORE = [
    { title: '🌍 Основы карт', items: [
      ['Проекция', 'Шар раскладывают на плоскость. Google Maps берёт Web Mercator: углы верные, а площади у полюсов раздуты.'],
      ['Геокодирование', 'Адрес в координаты и обратно. Улица хранит диапазоны номеров домов, координаты дома получают интерполяцией.'],
      ['Тайлы', 'Карта режется на квадраты 256 × 256 для каждого уровня зума. На уровне 0 весь мир в одном тайле, на уровне 21 около 4,4 трлн тайлов.'],
      ['Geohash тайла', 'Тайл однозначно задаётся geohash и зумом: из него строится адрес на CDN.'],
    ] },
    { title: '🛣️ Графы дорог', items: [
      ['Граф', 'Перекрёстки это вершины, дороги это рёбра. Весь мир одним графом не помещается в память, и A* по нему идёт вечность.'],
      ['Routing tiles', 'Граф режут по тайлам geohash: каждый тайл хранит свой кусок графа и ссылки на соседей. Поиск подгружает тайлы по мере хода.'],
      ['Иерархия', 'Три уровня: мелкие тайлы с местными дорогами, средние с магистралями между районами, крупные только с трассами. Дальний маршрут почти весь идёт по крупным тайлам.'],
    ] },
  ];
  const LOC_MORE = [
    { title: '📍 Поток точек', items: [
      ['Пачки', 'GPS раз в секунду, но клиент копит 15 секунд и шлёт пачкой: 3 млн запросов в секунду превращаются в 200 тыс.'],
      ['Cassandra', 'user_location: (user_id, timestamp, lat, lng, режим). Много записи, ключ user_id, растёт узлами.'],
      ['Kafka', 'Тот же поток уходит в Kafka: из него читают обновление пробок, пересборка routing tiles, ML и аналитика.'],
    ] },
  ];
  const ETA_MORE = [
    { title: '⏱️ Время в пути', items: [
      ['По знакам', 'Длина дороги ÷ разрешённая скорость: ошибка в десятки процентов в городе.'],
      ['ML', 'Текущие пробки из потока точек плюс история за прошлые недели в тот же час. Модель предсказывает, какими будут пробки через 10–20 минут.'],
      ['Ранжирование', 'Ranker отсекает маршруты по предпочтениям (без платных дорог, без трасс) и сортирует по ETA.'],
    ] },
  ];
  const ADAPT_MORE = [
    { title: '🔁 Перестроить маршрут на ходу', items: [
      ['Кого затронет', 'Пробка в тайле r. Нужно найти водителей, чей маршрут проходит через r. Перебор всех маршрутов всех водителей дорогой.'],
      ['Иерархия', 'Для водителя храним текущий тайл и тайлы всех уровней над ним, пока крупный не накроет пункт назначения. Пробку проверяем против последнего, крупного тайла: быстро.'],
      ['Доставка', 'Пуш-уведомление ограничено 4 КБ и не работает в вебе. Книга выбирает WebSocket: соединение уже есть, сервер шлёт новый маршрут сам.'],
    ] },
  ];
  const OBS_MORE = [
    { title: '🔭 Что смотреть', items: [
      ['Маршруты', 'p99 расчёта, доля маршрутов, где реальное время отличается от ETA больше чем на 10%.'],
      ['Поток точек', 'Отставание потребителей Kafka: устаревшие пробки дают плохие ETA.'],
      ['CDN', 'Доля попаданий и трафик по регионам.'],
    ] },
  ];

  const CORE = ['Клиент (приложение)', 'Балансировщик нагрузки', 'Location service', 'История точек (Cassandra)', 'Kafka: поток точек', 'Обновление пробок', 'Traffic DB', 'Навигация (route planner)', 'Геокодирование', 'Geocoding DB (Redis)', 'Shortest path service', 'Routing tiles (S3)', 'ETA service', 'Map tile service', 'CDN', 'Тайлы карты (S3)'];

  g.LAB = {
    id: 'ch3', n: 3, title: 'Google Maps', subtitle: 'Карта, маршрут и время в пути',
    intro: 'Упрощённый Google Maps на миллиард пользователей в день: показать карту, построить маршрут с временем в пути и перестроить его, если впереди пробка. Тут три разные системы: поток точек от телефонов (миллион запросов в секунду в пик), сотня петабайт тайлов на CDN и поиск пути по графу дорог всего мира.',
    kpiFlows: [{ id: 'nav', label: 'Маршрут' }, { id: 'tileGet', label: 'Тайл карты' }], mainFlow: 'nav',
    cx: [22, 32],
    bgNote: 'Карта и маршруты это не тормозит: фоновая пересборка догонит.',

    steps: [
      { id: 'req', title: 'Требования', sub: 'что строим и что нет', kind: 'req', tag: '~5 мин', guide: 'Отметь функции и ограничения. Три функции: точки пользователя, маршрут с ETA, отрисовка карты. Плюс точность, плавность и экономия трафика и батареи.' },
      { id: 'est', title: 'Оценка нагрузки', sub: '100 ПБ тайлов, 1 млн точек/с', kind: 'est', tag: '~5 мин', guide: 'Покрути слайдеры. Вывод: тайлы огромны, но статичны и идут с CDN; точки шлём пачками.' },
      { id: 'api', title: 'API и данные', sub: 'точки, маршрут, тайлы', kind: 'api', tag: '~5 мин', guide: 'POST /locations пачкой, GET /nav, адреса тайлов. Хранилища: Cassandra, Redis, S3 и CDN.' },
      { id: 'hld', title: 'Дизайн', sub: 'схема на карте', kind: 'map', stage: 'base', tag: '~10 мин', guide: 'Три сервиса: Location service пишет точки в Cassandra и Kafka, навигация строит маршрут по routing tiles, карта идёт с CDN.' },
      { id: 'deep', title: 'Углубление', sub: 'проблемы и решения', kind: 'map', stage: 'deep', tag: '~15 мин', guide: 'Пачки точек, готовые тайлы, векторные тайлы, адреса тайлов, иерархия графа, ETA по пробкам, перестроение маршрута и доставка по WebSocket.' },
      { id: 'sum', title: 'Итог', sub: 'рассказ для интервью', kind: 'sum', tag: '~5 мин', guide: 'Перескажи решение по шагам и ответь на вопросы для повторения.' },
    ],

    requirements: {
      intro: 'Сначала договариваемся, что строим. Отметь то, что входит в задачу, и нажми «Проверить». Книга берёт три функции и сознательно отказывается от остального: остановок по пути, транспорта, отзывов о местах.',
      groups: [
        { kind: 'fr', title: 'Функциональные (FR)', q: 'Что система делает', desc: 'Три функции из книги. Из них получаются три сервиса: точки, навигация и карта.', items: [
          { text: 'Обновлять положение пользователя', in: true, why: 'Точки нужны для пробок, ETA, пересборки графа дорог и аналитики.', to: 'POST /v1/locations, Location service', shapes: [
            ['throughput', 2, 'Миллиард пользователей шлёт GPS: миллионы точек в секунду, если слать по одной.'],
            ['battery', 2, 'Слать каждую точку отдельно разряжает батарею и тратит трафик.'],
          ] },
          { text: 'Построить маршрут с временем в пути (ETA)', in: true, why: 'Главная функция навигации. Время в пути учитывает пробки.', to: 'GET /v1/nav, навигация, routing tiles', shapes: [
            ['accuracy', 2, 'Нельзя вести человека не туда, а ETA должен быть близок к реальности.'],
            ['latency', 1, 'Маршрут за секунду-другую, даже через всю страну.'],
          ] },
          { text: 'Показать карту', in: true, why: 'Тайлы для текущего места и зума.', to: 'CDN, Map tile service', shapes: [
            ['smooth', 2, 'Карта плавно двигается и зумится, без пустых квадратов.'],
            ['battery', 1, 'Тайлы весят сотни КБ: формат и кэш решают, сколько трафика уйдёт.'],
          ] },
          { text: 'Перестроить маршрут, если впереди пробка', in: true, why: 'Книга разбирает это в углублении как adaptive ETA and rerouting.', to: 'Adaptive ETA, WebSocket', shapes: [
            ['accuracy', 1, 'ETA меняется по ходу поездки.'],
          ] },
          { text: 'Маршрут с остановками по пути', in: false, why: 'Книга прямо выносит за рамки.' },
          { text: 'Общественный транспорт и расписания', in: false, why: 'Отдельная задача с расписаниями. Книга оставляет только машину и пешком.' },
          { text: 'Отзывы и фото мест', in: false, why: 'Это бизнес-данные, а не карта. Поиск мест был в главе 1.' },
        ] },
        { kind: 'nfr', title: 'Нефункциональные (NFR)', q: 'Насколько хорошо система это делает', desc: 'Книга называет точность, плавную навигацию, экономию данных и батареи и общую доступность и масштабируемость.', items: [
          { text: 'Точность: не вести не туда, честный ETA', in: true, nfr: 'accuracy', why: 'Ошибка навигации заметна сразу и подрывает доверие.', to: 'routing tiles, ETA по пробкам' },
          { text: 'Плавная отрисовка карты', in: true, nfr: 'smooth', why: 'Карта на клиенте должна двигаться без рывков.', to: 'готовые тайлы на CDN, векторные тайлы' },
          { text: 'Экономия трафика и батареи', in: true, nfr: 'battery', why: 'Навигация работает часами на телефоне.', to: 'пачки точек, векторные тайлы' },
          { text: 'Доступность и масштабируемость', in: true, nfr: 'availability', why: 'Миллиард пользователей в день.', to: 'stateless-сервисы, CDN, Kafka' },
          { text: 'Строгая согласованность точек и пробок', in: false, nfr: 'accuracy', why: 'Пробки допустимо узнавать с задержкой в секунды.' },
        ] },
      ],
      start: {
        title: 'Почему всё начинается здесь',
        text: 'Глава про три непохожие системы под одной крышей. Точки это поток записи, его гасят пачками и Kafka. Карта это гигантский, но статичный набор файлов: его заранее готовят и раздают с CDN. Маршрут это алгоритм на графе, который не помещается в память: его режут на тайлы и строят иерархию. На интервью проверяют, увидишь ли ты эти три разные природы нагрузки.',
        chain: [
          { t: 'FR: что делаем', d: 'Точки пользователя, маршрут с ETA, карта, перестроение маршрута.' },
          { t: 'NFR: насколько хорошо', d: 'Точность, плавность, трафик и батарея, масштаб.' },
          { t: 'Оценка: сколько', d: '100 ПБ тайлов, 200 тыс. пачек точек в секунду (1 млн в пик), 62,5 ГБ/с с CDN.' },
          { t: 'Технологии: что следует', d: 'Cassandra и Kafka для точек, S3 и CDN для тайлов, routing tiles и ML для маршрутов.' },
        ],
        skipTitle: 'Чего не берём: каждая часть проще, чем кажется',
        skip: [
          { t: 'Рисовать тайлы на лету', d: 'Карта меняется редко: готовые тайлы кэшируются CDN.' },
          { t: 'Весь граф мира в памяти', d: 'Не помещается. Режем на routing tiles.' },
          { t: 'Каждую точку отдельным запросом', d: 'Пачка раз в 15 секунд.' },
          { t: 'Строгая согласованность', d: 'Пробка видна через секунды, этого хватает.' },
        ],
        revisit: 'Решение верно, пока верны требования. Новое FR может поменять NFR, и тогда пересматривается архитектура. Примеры ниже.',
      },
      future: [
        { fr: 'Маршрут с остановками по пути', breaks: ['latency'],
          now: 'Маршрут из точки A в точку B.',
          why: 'Порядок остановок это задача коммивояжёра: перебор растёт быстро.',
          fix: 'Эвристика порядка, потом A* между соседними остановками.' },
        { fr: 'Общественный транспорт', breaks: ['accuracy'],
          now: 'Граф дорог для машины и пешехода.',
          why: 'Рёбра зависят от расписания: граф меняется во времени.',
          fix: 'Отдельный граф с расписаниями (GTFS) и пересадками.' },
        { fr: 'Офлайн-карты', breaks: ['battery', 'smooth'],
          now: 'Тайлы с CDN по мере движения.',
          why: 'Без сети нет ни тайлов, ни маршрутов.',
          fix: 'Скачивать векторные тайлы и routing tiles региона заранее, строить маршрут на телефоне.' },
        { fr: 'Пробки в реальном времени на всей карте', breaks: ['throughput'],
          now: 'Пробки нужны только ETA.',
          why: 'Слой пробок меняется каждую минуту: тайлы нельзя кэшировать надолго.',
          fix: 'Отдельный слой поверх тайлов с коротким TTL на CDN.' },
      ],
      nfr: [
        { id: 'accuracy', name: 'Точность', en: 'Accuracy', key: true, what: 'Правильный маршрут и честное время в пути.', metric: 'Ошибка ETA в процентах.', drives: 'Routing tiles, ETA на ML с пробками.', here: 'Ошибиться маршрутом хуже, чем ответить медленнее.' },
        { id: 'smooth', name: 'Плавность', en: 'Smooth navigation', key: true, what: 'Карта двигается и зумится без рывков.', metric: 'Время до показа тайла.', drives: 'Готовые тайлы на CDN, векторный формат.', here: 'Тайл должен прийти из ближайшей точки CDN.' },
        { id: 'battery', name: 'Трафик и батарея', en: 'Data and battery', key: true, what: 'Сколько телефон отдаёт и скачивает.', metric: 'МБ в час навигации, запросов в минуту.', drives: 'Пачки точек, векторные тайлы.', here: 'Навигация работает часами.' },
        { id: 'availability', name: 'Доступность', en: 'Availability', key: true, what: 'Сервис отвечает всегда.', metric: 'Доля успешных запросов.', drives: 'Stateless-сервисы, CDN, реплики.', here: 'Миллиард пользователей в день.' },
        { id: 'throughput', name: 'Пропускная способность', en: 'Throughput', key: false, what: 'Сколько точек и тайлов в секунду.', metric: 'Запросов/с и ГБ/с.', drives: 'Пачки, Kafka, CDN.', here: '1 млн пачек точек в пик, 62,5 ГБ/с тайлов.' },
        { id: 'latency', name: 'Задержка', en: 'Latency', key: false, what: 'Сколько ждать маршрут.', metric: 'p99 GET /nav.', drives: 'Иерархия routing tiles, кэш тайлов в памяти.', here: 'Секунда-другая допустимы.' },
      ],
      conclusion: 'Итог: три функции и упор на точность, плавность и экономию. Дальше посчитаем объёмы: они тут самые большие в книге.',
    },

    estimate: {
      intro: 'Как в книге: 1 млрд пользователей в день, навигацией пользуются 35 минут в неделю, GPS раз в секунду, тайл около 100 КБ. Сутки книга округляет до 10⁵ секунд, мы тоже. Число маршрутов книга не считает, это допущение.',
      scnNote: 'Умножает обычный день: пик (книга берёт ×5) и рост. По этим числам считаются карта, узкие места и эталон во всей главе.',
      inputs: [
        { id: 'dau', label: 'Пользователей в день (DAU)', unit: 'млн', min: 100, max: 3000, step: 100, value: 1000 },
        { id: 'navMin', label: 'Минут навигации в неделю на человека', unit: 'мин', min: 5, max: 120, step: 5, value: 35 },
        { id: 'tileKB', label: 'Растровый тайл', unit: 'КБ', min: 20, max: 300, step: 10, value: 100 },
        { id: 'mbMin', label: 'Тайлов за минуту езды', unit: 'МБ', min: 0.25, max: 5, step: 0.25, value: 1.25 },
        { id: 'routes', label: 'Маршрутов на пользователя в день (допущение)', unit: '', min: 0.1, max: 5, step: 0.1, value: 1 },
      ],
      rows: (d) => [
        { short: 'Тайлы', label: 'Тайлов всех уровней, ПБ', uses: ['tileKB'], from: [], formula: '4,4 трлн × размер, −90% пустоты, × 2 на все уровни', v: d.tilePB,
          calc: (d, i, f) => `4,4 трлн × ${i.tileKB} КБ = ${f(d.rawPB)} ПБ; океаны и пустыни сжимаются: ≈ ${f(d.rawPB / 9)} ПБ; все уровни ≈ ${f(d.tilePB)} ПБ`,
          why: 'Книга: 440 ПБ на уровне 21, 90% Земли это океаны и пустыни, около 50 ПБ, со всеми уровнями около 100 ПБ. Огромно, но меняется редко: готовим заранее и храним в S3.', to: 'карта: «Тайлы карты (S3)»' },
        { short: 'Навигация', label: 'Минут навигации в день', uses: ['dau', 'navMin', 'growth'], from: [], formula: 'DAU × минуты в неделю ÷ 7', v: d.navDay,
          calc: (d, i, f) => `${f(d.U)} × ${i.navMin} ÷ 7 = ${f(d.navDay)} мин`,
          why: 'Книга: 35 млрд минут в неделю, 5 млрд в день. Из этого считаются и точки, и тайлы.', to: 'точки и тайлы' },
        { short: 'GPS', label: 'Точек GPS в секунду', uses: [], from: [1], formula: 'минуты × 60 ÷ 10⁵', v: d.gps,
          calc: (d, i, f) => `${f(d.navDay)} × 60 ÷ 10⁵ = ${f(d.gps)}/с`,
          why: 'Книга: 3 млн точек в секунду, если слать каждую.', to: 'Location service' },
        { short: 'Пачки', label: 'Пачек точек в секунду', uses: ['peak'], from: [2], peak: true, flows: ['loc', 'locStream'], formula: 'точки ÷ 15 с пачки', v: d.loc,
          calc: (d, i, f) => `${f(d.gps)} ÷ 15 = ${f(d.loc)}/с${d.k > 1 ? `, в пик × ${d.k} = ${f(d.loc * d.k)}/с` : ''}`,
          why: 'Книга: клиент копит 15 с, 200 тыс. запросов в секунду, в пик ×5 это 1 млн. Пачка экономит батарею.', to: 'карта: «Точки пачкой»' },
        { short: 'CDN', label: 'Трафик тайлов, МБ/с', uses: ['mbMin', 'peak'], from: [1], peak: true, formula: 'минуты × МБ в минуту ÷ 10⁵', v: d.mbs,
          calc: (d, i, f) => `${f(d.navDay)} × ${dec(i.mbMin)} МБ ÷ 10⁵ = ${f(d.mbs)} МБ/с; на 200 точек присутствия CDN ≈ ${f(d.mbs / 200)} МБ/с`,
          why: 'Книга: 6,25 ПБ в день, 62 500 МБ/с. На 200 точек CDN это около 300 МБ/с на каждую.', to: 'карта: «CDN»' },
        { short: 'Тайлы/с', label: 'Тайлов в секунду', uses: ['tileKB'], from: [4], peak: true, flows: ['tileGet'], formula: 'МБ/с ÷ размер тайла', v: d.tiles,
          calc: (d, i, f) => `${f(d.mbs)} МБ/с ÷ ${i.tileKB} КБ = ${f(d.tiles)}/с`,
          why: 'Каждый тайл это запрос к CDN. Map tile service отдаёт адреса 9 тайлов за раз.', to: 'карта: «Тайл карты»' },
        { short: 'Маршруты', label: 'Маршрутов в секунду (допущение)', uses: ['dau', 'routes', 'peak'], from: [], peak: true, flows: ['nav'], formula: 'DAU × маршруты ÷ 10⁵', v: d.nav,
          calc: (d, i, f) => `${f(d.U)} × ${dec(i.routes)} ÷ 10⁵ = ${f(d.nav)}/с`,
          why: 'Каждый маршрут это геокодирование, A* по routing tiles и ETA для нескольких вариантов. Самый тяжёлый запрос по CPU.', to: 'карта: «Маршрут»' },
        { short: 'В пути', label: 'Навигируют одновременно', uses: [], from: [1], peak: true, formula: 'минуты ÷ 1440', v: d.navConc,
          calc: (d, i, f) => `${f(d.navDay)} ÷ 1440 = ${f(d.navConc)}`,
          why: 'Столько водителей надо проверить, когда впереди пробка, и столько WebSocket-соединений для нового маршрута.', to: 'перестроение маршрута' },
      ],
      conclusion: (d) => `Тайлов около ${big(d.tilePB)} ПБ, но они статичны: S3 и CDN отдают ${big(d.mbs * d.k)} МБ/с. Точек ${big(d.gps * d.k)} в секунду, пачками ${big(d.loc * d.k)}. Маршрутов ${big(d.nav * d.k)} в секунду, но каждый тяжёлый. Три нагрузки разной природы, и у каждой своё решение.`,
    },

    api: {
      intro: 'Три группы ручек, как в книге: точки пачкой, маршрут и тайлы. Данные в четырёх местах: история точек в Cassandra, геокодирование в Redis, routing tiles и тайлы карты в S3 (тайлы за CDN). Пробки лежат в Traffic DB и читаются ETA.',
      conventions: [
        { k: 'Координаты', v: 'latitude и longitude, WGS84. Проекция карты Web Mercator' },
        { k: 'Пачки', v: 'Клиент копит точки 15 с и шлёт массивом: экономит батарею и запросы' },
        { k: 'Тайлы', v: 'Адрес тайла задают geohash и зум. Готовые файлы, раздаются с CDN' },
        { k: 'Маршрут', v: 'Ответ содержит polyline: закодированная ломаная пути' },
        { k: 'Push', v: 'Новый маршрут и ETA приходят по WebSocket, пока идёт навигация' },
        { k: 'Версия', v: 'Префикс /v1/' },
      ],
      journey: [
        { ep: 'tiles', text: 'Открыл карту: адреса 9 тайлов вокруг' },
        { ep: 'cdn', text: 'Скачал тайлы с CDN' },
        { ep: 'nav', text: 'Построил маршрут до работы' },
        { ep: 'loc', text: 'Пока едет, раз в 15 с отправляет пачку точек' },
        { ep: 'reroute', text: 'Впереди пробка: сервер прислал новый маршрут' },
      ],
      endpoints: [
        { id: 'loc', method: 'POST', path: '/v1/locations', title: 'Пачка точек', who: 'клиент', flow: 'loc', key: true,
          about: 'Клиент копит точки 15 секунд и шлёт пачкой. Location service пишет их в Cassandra и публикует в Kafka для пробок, пересборки routing tiles и аналитики.',
          headers: ['Authorization: Bearer <токен>'],
          body: { locs: [{ lat: 37.7749, lng: -122.4194, ts: 1760950000 }, { lat: 37.7751, lng: -122.4189, ts: 1760950001 }] },
          bodyFields: [['locs', 'array', true, 'Точки за 15 секунд: широта, долгота, время']],
          ok: { status: '200 OK', body: {} },
          errors: [['400', 'BAD_BATCH', 'Пустая пачка или точки не по порядку'], ['429', 'TOO_MANY', 'Клиент шлёт чаще, чем раз в 15 с']],
          sql: "INSERT INTO user_location (user_id, timestamp, lat, lng, user_mode, navigation_mode) VALUES (101, 1760950000, 37.7749, -122.4194, 'active', 'driving');\n-- и то же событие в Kafka: topic user-location, key user_id",
          reads: [], writes: ['user_location'] },
        { id: 'nav', method: 'GET', path: '/v1/nav', title: 'Маршрут', who: 'клиент', flow: 'nav', key: true,
          about: 'Навигация геокодирует адреса, shortest path service ищет k лучших путей A* по routing tiles без учёта пробок, ETA service считает время по пробкам, ranker фильтрует (без платных дорог) и сортирует.',
          params: [['origin', 'query', 'string', true, 'Адрес или координаты'], ['destination', 'query', 'string', true, 'Адрес или координаты'], ['mode', 'query', 'string', false, 'driving или walking'], ['avoid', 'query', 'string', false, 'tolls, highways']],
          example: 'GET /v1/nav?origin=1355+market+street,SF&destination=Disneyland',
          ok: { status: '200 OK', body: { distance: { text: '0.2 mi', value: 259 }, duration: { text: '1 min', value: 83 }, end_location: { lat: 37.4038943, lng: -121.9410454 }, start_location: { lat: 37.4027165, lng: -121.9435809 }, polyline: { points: 'y_fbFdhbgV…' }, travel_mode: 'DRIVING' } },
          fields: [['duration', 'ETA с учётом пробок, секунды'], ['polyline', 'Путь для отрисовки на клиенте']],
          errors: [['404', 'NO_ROUTE', 'Пути нет, например через океан'], ['400', 'GEOCODE_FAILED', 'Адрес не найден']],
          sql: "GET geocode:\"1355 market street, SF\"            -- Redis\nGET s3://routing-tiles/L2/9q8yy.bin           -- тайлы графа, кэш в памяти shortest path\nSELECT speed FROM traffic WHERE segment_id IN (…)  -- ETA",
          reads: ['geocoding', 'routing_tiles', 'traffic'], writes: [] },
        { id: 'tiles', method: 'GET', path: '/v1/tiles', title: 'Адреса тайлов', who: 'клиент', flow: 'tileUrl',
          about: 'Map tile service по координатам и зуму считает geohash тайла и возвращает адреса этого тайла и 8 соседних на CDN. Схему адресов можно менять, не обновляя приложения.',
          params: [['lat', 'query', 'decimal', true, 'Центр экрана'], ['lng', 'query', 'decimal', true, 'Центр экрана'], ['zoom', 'query', 'int', true, '0…21']],
          ok: { status: '200 OK', body: { tiles: ['https://cdn.map-provider.com/tiles/9q9hvu.png', 'https://cdn.map-provider.com/tiles/9q9hvv.png', '…'] } },
          errors: [['400', 'BAD_ZOOM', 'Зум вне 0…21']],
          reads: [], writes: [] },
        { id: 'cdn', method: 'GET', path: 'cdn/tiles/{geohash}.png', title: 'Тайл с CDN', who: 'клиент', flow: 'tileGet', key: true,
          about: 'Готовый тайл с ближайшей точки CDN. Промах идёт в S3. Векторный тайл весит меньше и рисуется на клиенте через WebGL.',
          example: 'GET https://cdn.map-provider.com/tiles/9q9hvu.png',
          ok: { status: '200 OK', headers: ['Cache-Control: max-age=604800'], body: { bytes: '≈ 100 КБ (растр) или меньше (вектор)' } },
          errors: [['404', 'NO_TILE', 'Тайла нет, например над океаном на большом зуме']],
          reads: ['map_tiles'], writes: [] },
        { id: 'reroute', method: 'WS', path: 'route_update', title: 'Новый маршрут на ходу', who: 'сервер', flow: 'reroute',
          about: 'Adaptive ETA and rerouting находит водителей, чей маршрут идёт через тайл с пробкой, пересчитывает путь и шлёт по WebSocket.',
          ok: { status: 'сообщение клиенту', body: { type: 'route_update', reason: 'traffic', duration: { value: 1260 }, polyline: { points: 'a~l~Fjk~uOw…' } } },
          errors: [['—', 'NO_CHANGE', 'Новый путь не быстрее: ничего не шлём']],
          reads: ['traffic', 'routing_tiles'], writes: [] },
      ],
      dbs: [
        { id: 'locDB', name: 'История точек', owner: 'Cassandra', why: 'Поток точек.' },
        { id: 'geoDB', name: 'Геокодирование', owner: 'Redis', why: 'Адрес → координаты.' },
        { id: 'routeTiles', name: 'Routing tiles', owner: 'S3', why: 'Граф дорог по тайлам.' },
        { id: 'trafficDB', name: 'Пробки', owner: 'Traffic DB', why: 'Скорость по участкам.' },
        { id: 'tileStore', name: 'Тайлы карты', owner: 'S3 за CDN', why: 'Готовые картинки.' },
      ],
      tables: [
        { name: 'user_location', db: 'locDB', why: 'Пишется сотни тысяч раз в секунду. Ключ партиции user_id, сортировка по времени.', rows: '≈ 300 млрд точек в день',
          cols: [{ n: 'user_id', t: 'BIGINT', k: 'PK', d: 'Ключ партиции' }, { n: 'timestamp', t: 'TIMESTAMP', k: 'PK', d: 'Ключ сортировки' }, { n: 'lat', t: 'DOUBLE', d: 'Широта' }, { n: 'lng', t: 'DOUBLE', d: 'Долгота' }, { n: 'user_mode', t: 'TEXT', d: 'active, inactive' }, { n: 'navigation_mode', t: 'TEXT', d: 'driving, walking' }] },
        { name: 'geocoding', db: 'geoDB', why: 'Места и адреса → координаты. Много чтения, редкие обновления: Redis.', rows: 'ключ на адрес',
          cols: [{ n: 'key', t: 'адрес или место', k: 'PK', d: '1355 market street, SF' }, { n: 'value', t: 'lat, lng', d: '37.776, -122.416' }] },
        { name: 'routing_tiles', db: 'routeTiles', why: 'Граф дорог по тайлам geohash трёх уровней. Shortest path service кэширует их в памяти.', rows: 'файл на тайл',
          cols: [{ n: 'key', t: 'L{уровень}/{geohash}', k: 'PK', d: 'L2/9q8yy' }, { n: 'nodes', t: 'двоичный список', d: 'Перекрёстки' }, { n: 'edges', t: 'двоичный список', d: 'Дороги и ссылки на соседние тайлы' }] },
        { name: 'traffic', db: 'trafficDB', why: 'Текущая скорость по участкам, считается из потока точек.', rows: 'строка на участок',
          cols: [{ n: 'segment_id', t: 'BIGINT', k: 'PK', d: 'Участок дороги' }, { n: 'speed', t: 'FLOAT', d: 'Средняя скорость сейчас' }, { n: 'updated_at', t: 'TIMESTAMP', d: 'Когда пересчитана' }] },
        { name: 'map_tiles', db: 'tileStore', why: 'Готовые тайлы 21 уровня зума, около 100 ПБ. За CDN.', rows: '≈ 4,4 трлн на уровне 21',
          cols: [{ n: 'key', t: '{zoom}/{geohash}.png', k: 'PK', d: '21/9q9hvu.png' }, { n: 'body', t: 'PNG или вектор', d: '≈ 100 КБ растр' }] },
      ],
      more: {
        intro: 'Для интервью хватает таблиц выше. Ниже то, что добавляют, когда растут требования.',
        tables: [
          { name: 'active_navigation', when: 'Перестроение маршрута: водитель и тайлы его маршрута всех уровней.', cols: 'user_id, current_tile, parent_tiles[]' },
          { name: 'historical_traffic', when: 'ETA по истории: скорость участка в этот час недели.', cols: 'segment_id, weekday, hour, speed' },
        ],
        endpoints: [
          { ep: 'GET /v1/geocode?address=…', when: 'Отдельное геокодирование для поиска.' },
          { ep: 'GET /v1/eta?route_id=…', when: 'Пересчёт ETA без нового маршрута.' },
        ],
      },
      quiz: [
        { q: 'Почему точки пачкой?', a: 'GPS раз в секунду дал бы 3 млн запросов в секунду и съел батарею. Пачка раз в 15 с даёт 200 тыс.' },
        { q: 'Почему тайлы готовые, а не на лету?', a: 'Карта меняется редко: готовые тайлы кэширует CDN. Рисовать на лету значит гонять CPU на каждый запрос.' },
        { q: 'Зачем Map tile service, если адрес можно посчитать на клиенте?', a: 'Схему адресов можно менять, не выпуская новое приложение. Цена: лишний запрос.' },
        { q: 'Зачем routing tiles?', a: 'Граф мира не помещается в память. По тайлам поиск подгружает только нужные куски.' },
      ],
    },

    board: { w: 1460, h: 940 },
    scenario: [
      { id: 'peak', label: 'Пик', unit: '×', stops: [1, 2, 3, 5, 10], value: 1, hint: 'Часы пик и праздники. Книга берёт ×5. Умножает точки, тайлы и маршруты' },
      { id: 'growth', label: 'Рост', unit: '×', stops: [1, 2, 3], value: 1, hint: 'Во сколько раз больше пользователей' },
    ],
    groups: ['Вход', 'Точки', 'Навигация', 'Карта'],
    expGroups: ['Наблюдаемость'],

    blocks: {
      client: { name: 'Клиент (приложение)', icon: '📱', cat: 'edge', group: 'Вход', pos: [20, 390], cap: 0, tag: 'Телефон или браузер',
        learn: { what: 'Рисует карту из тайлов, шлёт точки пачкой и показывает маршрут. Во время навигации держит WebSocket для нового маршрута.', plus: [], minus: [] } },
      lb: { name: 'Балансировщик нагрузки', icon: '⚖️', cat: 'edge', via: true, group: 'Вход', tune: 'lb', pos: [235, 390], cap: 100000, lat: 1, cost: 80, cx: 0.5, maxRep: 100,
        links: [['client', 'self'], ['self', 'locSvc'], ['self', 'navSvc'], ['self', 'tileSvc']], drop: [['client', 'locSvc'], ['client', 'navSvc'], ['client', 'tileSvc']], tag: 'Точки, маршруты, адреса тайлов',
        fit: { use: 'Единый адрес для трёх сервисов.', avoid: 'Тайлы: они идут мимо, с CDN.', limits: 'Тайлов в разы больше остальных запросов.' },
        learn: { what: 'Разводит запросы по трём сервисам. Сами тайлы через него не идут: их отдаёт CDN.', plus: ['Единый адрес'], minus: ['+1 мс'] } },
      locSvc: { name: 'Location service', icon: '📍', cat: 'svc', group: 'Точки', pos: [470, 60], cap: 5000, lat: 5, cost: 100, cx: 1, maxRep: 2000, links: [[['lb', 'client'], 'self']], tag: 'Пишет пачки точек',
        learn: { more: LOC_MORE, what: 'Принимает пачки точек, пишет в Cassandra и публикует в Kafka. Без состояния. В модели около 5 тыс. запросов в секунду на копию.', plus: ['Без состояния'], minus: ['Поток записи огромен без пачек'] } },
      locDB: { name: 'История точек (Cassandra)', logo: 'cassandra', icon: '🗃️', cat: 'db', group: 'Точки', pos: [720, 200], cap: 20000, lat: 3, cost: 150, cx: 1, db: true, maxRep: 500, repLabel: 'узл.',
        links: [['locSvc', 'self']], tag: 'user_location, ключ user_id',
        fit: { use: 'Поток записи точек.', avoid: 'Чтение для навигации: для этого пробки в Traffic DB.', limits: 'В модели 20 тыс. записей в секунду на узел.' },
        learn: { more: LOC_MORE, what: 'Таблица user_location книги. Cassandra хорошо пишет и растёт узлами.', plus: ['Линейная запись'], minus: ['Только простые запросы по ключу'] } },
      kafka: { name: 'Kafka: поток точек', logo: 'kafka', icon: '📨', cat: 'async', group: 'Точки', tune: 'kafka', pos: [720, 40], cap: 10000, lat: 2, cost: 400, cx: 1, brokerCap: 100000,
        opts: { brokers: [3, 6, 12, 24, 48], partitions: [6, 12, 24, 48, 96, 192] },
        links: [['locSvc', 'self'], ['self', 'trafficSvc'], ['self', 'tileProc']], tag: 'Топик user-location',
        fit: { use: 'Раздать поток точек нескольким потребителям: пробки, routing tiles, ML, аналитика.', avoid: 'Ответ клиенту: он не ждёт потребителей.', limits: 'Потребителей в группе не больше, чем партиций.' },
        learn: { more: LOC_MORE, what: 'Книга публикует точки в Kafka: каждый потребитель читает поток в своём темпе. Партиция около 10 тыс. событий в секунду в модели.', plus: ['Много потребителей одного потока', 'Буфер при всплесках'], minus: ['Ещё один кластер'] } },
      trafficSvc: { name: 'Обновление пробок', icon: '🚦', cat: 'svc', group: 'Точки', pos: [960, 60], cap: 10000, lat: 5, cost: 100, cx: 1.5, maxRep: 2000, links: [['kafka', 'self']], tag: 'Traffic update service',
        learn: { more: ETA_MORE, what: 'Читает поток точек из Kafka, сопоставляет точки с дорогами и пересчитывает скорость на участках. Пишет в Traffic DB.', plus: ['Пробки из реальных точек'], minus: ['Отстаёт, если потребителей мало'] } },
      trafficDB: { name: 'Traffic DB', icon: '🚥', cat: 'db', group: 'Точки', pos: [1225, 180], cap: 20000, lat: 2, cost: 150, cx: 1, db: true, maxRep: 300, repLabel: 'узл.',
        links: [['trafficSvc', 'self'], ['eta', 'self']], tag: 'Скорость по участкам',
        learn: { more: ETA_MORE, what: 'Текущая скорость на каждом участке дороги. Пишет обновление пробок, читает ETA service.', plus: ['Свежие пробки для ETA'], minus: [] } },
      tileProc: { name: 'Пересборка routing tiles', icon: '🛠️', cat: 'async', group: 'Навигация', pos: [960, 780], cap: 50000, lat: 0, cost: 150, cx: 1.5, maxRep: 50, links: [['kafka', 'self'], ['self', 'routeTiles']], tag: 'Routing tile processing',
        learn: { more: MAP_MORE, what: 'Фоновый процесс книги: из данных о дорогах и потока точек (новые дороги, закрытия) пересобирает routing tiles в S3.', plus: ['Граф дорог свежий'], minus: ['Фоновая работа, не на пути запроса'] } },
      navSvc: { name: 'Навигация (route planner)', icon: '🧭', cat: 'svc', group: 'Навигация', pos: [470, 390], cap: 2000, lat: 10, cost: 100, cx: 1, maxRep: 2000, links: [[['lb', 'client'], 'self']], tag: 'Собирает маршрут',
        learn: { more: ETA_MORE, what: 'Принимает GET /nav: геокодирует адреса, просит k лучших путей у shortest path, время у ETA, фильтрует и сортирует (ranker). Без состояния.', plus: ['Оркестрирует остальные'], minus: [] } },
      geocode: { name: 'Геокодирование', icon: '🏷️', cat: 'svc', group: 'Навигация', pos: [720, 320], cap: 5000, lat: 3, cost: 80, cx: 0.5, maxRep: 1000, links: [['navSvc', 'self']], tag: 'Адрес → координаты',
        learn: { more: MAP_MORE, what: 'Переводит адрес или название места в координаты: читает Geocoding DB.', plus: ['Простой и быстрый'], minus: [] } },
      geoDB: { name: 'Geocoding DB (Redis)', logo: 'redis', icon: '⚡', cat: 'cache', group: 'Навигация', pos: [960, 290], cap: 100000, lat: 1, cost: 200, cx: 1, db: true, tune: 'kv', repLabel: 'узл.', hotKey: 0.005,
        opts: { shards: [1, 3, 6, 12, 24, 48] }, links: [['geocode', 'self']], tag: 'Адрес → lat, lng',
        fit: { use: 'Много чтения, редкие обновления.', avoid: 'Пробки и точки.', limits: 'Около 100 тыс. чтений на копию.' },
        learn: { more: MAP_MORE, what: 'Книга держит геокодирование в Redis: читается часто, обновляется редко.', plus: ['Чтение за 1 мс'], minus: [] } },
      spSvc: { name: 'Shortest path service', icon: '🛣️', cat: 'svc', group: 'Навигация', pos: [720, 480], cap: 200, lat: 50, cost: 150, cx: 2, maxRep: 3000, links: [['navSvc', 'self']], tag: 'A* по routing tiles',
        overload: 'больше копий или иерархия routing tiles: дальний маршрут по крупным тайлам',
        learn: { more: MAP_MORE, what: 'Ищет k лучших путей A* по routing tiles без учёта пробок. Тайлы читает из S3 и кэширует в памяти. В модели около 200 маршрутов в секунду на копию.', plus: ['Результат зависит только от графа: хорошо кэшируется'], minus: ['Самая тяжёлая часть по CPU'] } },
      routeTiles: { name: 'Routing tiles (S3)', icon: '🧱', cat: 'db', group: 'Навигация', pos: [960, 600], cap: 50000, lat: 20, cost: 200, cx: 0.5, db: true, maxRep: 100, repLabel: 'узл.',
        links: [['spSvc', 'self']], tag: 'Граф дорог по тайлам',
        learn: { more: MAP_MORE, what: 'Граф дорог, нарезанный по тайлам geohash трёх уровней, файлы в S3. Shortest path кэширует их у себя.', plus: ['Не надо держать весь граф'], minus: ['Промах кэша это поход в S3'] } },
      eta: { name: 'ETA service', icon: '⏱️', cat: 'svc', group: 'Навигация', pos: [1225, 420], cap: 1000, lat: 15, cost: 120, cx: 1.5, maxRep: 2000, links: [['navSvc', 'self']], tag: 'Время по пробкам, ML',
        learn: { more: ETA_MORE, what: 'Для каждого из k путей считает время в пути по текущим пробкам и истории (ML). Читает Traffic DB.', plus: ['Честное время в пути'], minus: ['Модель надо обучать и обновлять'] } },
      tileSvc: { name: 'Map tile service', icon: '🗺️', cat: 'svc', group: 'Карта', pos: [470, 640], cap: 5000, lat: 2, cost: 80, cx: 0.5, maxRep: 2000, links: [[['lb', 'client'], 'self']], tag: 'Адреса 9 тайлов',
        learn: { more: MAP_MORE, what: 'По координатам и зуму отдаёт адреса тайла и 8 соседних на CDN. Сам тайлы не рисует и не отдаёт.', plus: ['Схему адресов можно менять без релиза приложения'], minus: ['Лишний запрос'] } },
      cdn: { name: 'CDN', icon: '🌐', cat: 'edge', group: 'Карта', pos: [235, 760], cap: 500000, lat: 5, cost: 300, cx: 0.5, maxRep: 1000, links: [['client', 'self'], ['self', 'tileStore']], tag: 'Готовые тайлы рядом с пользователем',
        fit: { use: 'Статичные тайлы: одни и те же для всех.', avoid: 'Персональные данные.', limits: 'Около 200 точек присутствия в мире.' },
        learn: { more: MAP_MORE, what: 'Раздаёт готовые тайлы с ближайшей точки. В модели 98% попаданий, промахи идут в S3.', plus: ['Тайл за миллисекунды', 'Снимает трафик с серверов'], minus: ['Обновление тайла ждёт TTL'] } },
      tileStore: { name: 'Тайлы карты (S3)', icon: '🖼️', cat: 'db', group: 'Карта', pos: [470, 820], cap: 50000, lat: 30, cost: 300, cx: 0.5, db: true, maxRep: 200, repLabel: 'узл.',
        links: [['cdn', 'self']], tag: '≈ 100 ПБ, источник для CDN',
        learn: { more: MAP_MORE, what: 'Все тайлы всех зумов, заранее нарисованные. CDN берёт отсюда при промахе.', plus: ['Дёшево на ПБ'], minus: ['Медленно без CDN'] } },
      adaptSvc: { name: 'Adaptive ETA и перестроение', icon: '🔁', cat: 'svc', group: 'Навигация', pos: [960, 170], cap: 20000, lat: 10, cost: 120, cx: 2, maxRep: 1000, links: [['trafficSvc', 'self'], ['self', 'wsGw']], tag: 'Кого задела пробка',
        overload: 'хранить для водителя тайлы маршрута по уровням, а не перебирать все маршруты',
        learn: { more: ADAPT_MORE, what: 'Получает изменения пробок, находит водителей, чей маршрут идёт через этот тайл, пересчитывает путь и ETA и отправляет через WebSocket.', plus: ['ETA меняется по ходу поездки'], minus: ['Надо хранить маршруты всех, кто сейчас в пути'] } },
      wsGw: { name: 'WebSocket-серверы', icon: '🔌', cat: 'svc', group: 'Вход', pos: [235, 170], cap: 50000, lat: 2, cost: 100, cx: 1.5, maxRep: 2000, links: [['adaptSvc', 'self']], tag: 'Соединение на время навигации',
        learn: { more: ADAPT_MORE, what: 'Держат соединение с каждым, кто ведёт навигацию, и пересылают ему новый маршрут.', plus: ['Сервер шлёт сам, без опроса'], minus: ['Stateful'] } },

      // ---------- эксперименты ----------
      metrics: { name: 'Метрики и алерты', icon: '📈', brand: '#E6522C', cat: 'async', extra: true, group: 'Наблюдаемость', pos: [20, 640], cap: 100000, lat: 0, cost: 150, cx: 1, maxRep: 4, links: [['navSvc', 'self']], tag: 'Prometheus, Grafana',
        fit: { use: 'p99 маршрутов, ошибка ETA, отставание Kafka.', avoid: 'Метки с координатами.', limits: 'Сбор раз в 15–30 с.' },
        learn: { more: OBS_MORE, what: 'Prometheus собирает метрики, Grafana рисует, Alertmanager будит дежурного.', plus: ['Видно, где растёт ошибка ETA'], minus: ['Говорит «что», но не «почему»'] } },
    },

    flows: [
      { id: 'loc', label: 'Точки пачкой', color: 'var(--f1)', write: true, rate: (d) => d.loc * d.k, chain: ['client', 'locSvc', 'locDB'] },
      { id: 'locStream', side: true, label: 'Поток точек в пробки', color: 'var(--f3)', write: true, rate: (d) => d.loc * d.k, chain: ['locSvc', 'kafka', 'trafficSvc', 'trafficDB'] },
      { id: 'nav', label: 'Маршрут', color: 'var(--f2)', rate: (d) => d.nav * d.k, chain: ['client', 'navSvc', 'spSvc'] },
      { id: 'geocodeF', side: true, label: 'Геокодирование', color: 'var(--f6)', rate: (d) => d.nav * d.k * 2, chain: ['navSvc', 'geocode', 'geoDB'] },
      { id: 'tileLoad', side: true, label: 'Подгрузка routing tiles', color: 'var(--f5)', rate: (d) => d.nav * d.k * 0.5, chain: ['spSvc', 'routeTiles'] },
      { id: 'etaF', side: true, label: 'ETA по пробкам', color: 'var(--f7)', rate: (d) => d.nav * d.k * 3, chain: ['navSvc', 'eta', 'trafficDB'] },
      { id: 'tileUrl', label: 'Адреса тайлов', color: 'var(--f4)', rate: (d) => (d.tiles * d.k) / 9, chain: ['client', 'tileSvc'] },
      { id: 'tileGet', label: 'Тайл карты', color: 'var(--f8)', rate: (d) => d.tiles * d.k, chain: ['client', 'cdn'] },
      { id: 'tileMiss', side: true, label: 'Промах CDN', color: 'var(--f8)', rate: (d) => d.tiles * d.k * 0.02, chain: ['cdn', 'tileStore'] },
      { id: 'tileBuild', side: true, label: 'Пересборка routing tiles', color: 'var(--f5)', optional: true, write: true, rate: (d) => d.loc * d.k * 0.01, chain: ['kafka', 'tileProc', 'routeTiles'] },
      { id: 'reroute', side: true, label: 'Новый маршрут на ходу', color: 'var(--f6)', optional: true, rate: (d) => (d.navConc * d.k * 0.01) / 60, chain: ['trafficSvc', 'adaptSvc', 'wsGw'] },
      { id: 'metricsScrape', side: true, label: 'Сбор метрик', color: 'var(--f8)', optional: true, rate: () => 500, chain: ['navSvc', 'metrics'] },
    ],

    derive: (i, deep) => {
      const p = (deep && deep.params) || {};
      const growth = p.growth || 1, peak = p.peak || 1;
      const U = i.dau * 1e6 * growth, navDay = (U * i.navMin) / 7, gps = (navDay * 60) / DAY;
      const mbs = (navDay * i.mbMin) / DAY;
      const rawPB = (4.4e12 * i.tileKB * 1e3) / 1e15;
      return {
        k: peak, peak, growth, U, navDay, gps, loc: gps / BATCH, mbs, tiles: (mbs * 1e3) / i.tileKB, mbMin: i.mbMin,
        rawPB, tilePB: Math.round((rawPB / 9) * 2), nav: (U * i.routes) / DAY, navConc: navDay / 1440,
      };
    },

    reference: {
      base: {
        nodes: ['client', 'lb', 'locSvc', 'locDB', 'kafka', 'trafficSvc', 'trafficDB', 'tileProc', 'navSvc', 'geocode', 'geoDB', 'spSvc', 'routeTiles', 'eta', 'tileSvc', 'cdn', 'tileStore'],
        edges: [['client', 'lb'], ['lb', 'locSvc'], ['lb', 'navSvc'], ['lb', 'tileSvc'], ['client', 'cdn'], ['cdn', 'tileStore'], ['locSvc', 'locDB'], ['locSvc', 'kafka'], ['kafka', 'trafficSvc'], ['kafka', 'tileProc'], ['tileProc', 'routeTiles'], ['trafficSvc', 'trafficDB'],
          ['navSvc', 'geocode'], ['geocode', 'geoDB'], ['navSvc', 'spSvc'], ['spSvc', 'routeTiles'], ['navSvc', 'eta'], ['eta', 'trafficDB']],
        cfg: { kafka: { brokers: 12, partitions: 48 }, geoDB: { shards: 3, replicas: 1 } },
        adapt: [],
      },
      deep: {
        nodes: ['client', 'lb', 'locSvc', 'locDB', 'kafka', 'trafficSvc', 'trafficDB', 'tileProc', 'navSvc', 'geocode', 'geoDB', 'spSvc', 'routeTiles', 'eta', 'tileSvc', 'cdn', 'tileStore', 'adaptSvc', 'wsGw'],
        edges: [['client', 'lb'], ['lb', 'locSvc'], ['lb', 'navSvc'], ['lb', 'tileSvc'], ['client', 'cdn'], ['cdn', 'tileStore'], ['locSvc', 'locDB'], ['locSvc', 'kafka'], ['kafka', 'trafficSvc'], ['kafka', 'tileProc'], ['tileProc', 'routeTiles'], ['trafficSvc', 'trafficDB'],
          ['navSvc', 'geocode'], ['geocode', 'geoDB'], ['navSvc', 'spSvc'], ['spSvc', 'routeTiles'], ['navSvc', 'eta'], ['eta', 'trafficDB'], ['trafficSvc', 'adaptSvc'], ['adaptSvc', 'wsGw']],
        cfg: { kafka: { brokers: 12, partitions: 48 }, geoDB: { shards: 3, replicas: 1 } },
        adapt: [],
      },
    },

    problems: [
      { id: 'batch', icon: '📦', title: 'Как слать точки', key: 'batch',
        problem: 'GPS даёт точку раз в секунду. Миллиард пользователей в день: если слать каждую, это 3 млн запросов в секунду и разряженная батарея.',
        options: [
          { v: 'each', label: 'Каждую точку сразу', note: 'Точки свежее на 15 секунд, но запросов в 15 раз больше, и радио телефона не засыпает.' },
          { v: 'batch', label: 'Пачкой раз в 15 с', note: 'Клиент копит точки и шлёт массивом: 200 тыс. запросов в секунду, в пик 1 млн. Так в книге.' },
        ],
        best: ['batch'], say: 'Клиент копит точки 15 секунд и шлёт пачкой: 3 млн запросов в секунду превращаются в 200 тыс., а телефон экономит батарею. Location service пишет их в Cassandra и Kafka.' },
      { id: 'render', icon: '🖼️', title: 'Тайлы готовые или на лету', key: 'render',
        problem: 'Карту можно рисовать на сервере на каждый запрос или нарисовать заранее все тайлы всех зумов.',
        options: [
          { v: 'dynamic', label: 'Рисовать на лету', note: 'Свежая карта, но каждый тайл это работа CPU, и одинаковые тайлы рисуются тысячи раз. CDN почти не помогает.' },
          { v: 'pre', label: 'Готовые тайлы на CDN', note: 'Нарисованы заранее, лежат в S3, раздаются CDN. Карта меняется редко. Так в книге.' },
        ],
        best: ['pre'], say: 'Тайлы рисую заранее для всех 21 уровней зума, храню в S3 и раздаю через CDN: карта меняется редко, а одинаковые тайлы запрашивают миллионы людей.' },
      { id: 'fmt', icon: '📐', title: 'Формат тайлов', key: 'fmt',
        problem: 'Растровый тайл 256 × 256 весит около 100 КБ. За час навигации это около 75 МБ. Можно ли дешевле?',
        options: [
          { v: 'raster', label: 'Растровые картинки', note: 'Просто рисовать на клиенте, но тяжело по трафику, а при зуме картинка мылится.' },
          { v: 'vector', label: 'Векторные тайлы (WebGL)', note: 'Пути и полигоны вместо пикселей: сжимаются лучше, зум плавный, клиент рисует сам. Книга советует как улучшение.' },
        ],
        best: ['vector'], say: 'Вместо растра отдаю векторные тайлы: они весят примерно вдвое меньше, зум плавный, а рисует клиент через WebGL.' },
      { id: 'tileUrl', icon: '🔗', title: 'Откуда клиент знает адрес тайла', key: 'tileUrl',
        problem: 'Тайл задаётся geohash и зумом. Клиент может посчитать адрес сам или спросить сервис.',
        options: [
          { v: 'client', label: 'Считает клиент', note: 'Нет лишнего запроса, но схема адресов зашита в приложение: поменять её можно только новым релизом, а старые версии живут годами.' },
          { v: 'service', label: 'Map tile service', note: 'Сервис отдаёт адреса 9 тайлов: схему можно менять без релиза. Книга выбирает этот вариант за гибкость.' },
        ],
        best: ['service', 'client'], say: 'Адреса тайлов отдаёт Map tile service: 9 адресов за запрос, а схему адресов можно менять, не выпуская новое приложение.' },
      { id: 'graph', icon: '🛣️', title: 'Как искать путь', key: 'graph',
        problem: 'Граф дорог мира это сотни миллионов вершин. A* по нему целиком не помещается в память и идёт слишком долго.',
        options: [
          { v: 'whole', label: 'Весь граф в памяти', note: 'Не помещается на одну машину, а поиск дальнего маршрута обходит миллионы вершин.' },
          { v: 'flat', label: 'Routing tiles одного уровня', note: 'Граф нарезан по тайлам и подгружается по мере поиска. Ближний маршрут быстрый, но дальний тянет тысячи мелких тайлов.' },
          { v: 'hier', label: 'Иерархия routing tiles', note: 'Три уровня: местные дороги, магистрали, трассы. Дальний маршрут почти весь по крупным тайлам. Так в книге.' },
        ],
        best: ['hier'], say: 'Граф дорог режу на routing tiles по geohash трёх уровней: местные дороги, магистрали, трассы. A* подгружает тайлы по мере хода, а дальний маршрут почти весь идёт по крупным тайлам.' },
      { id: 'etaM', icon: '⏱️', title: 'Как считать время в пути', key: 'etaM',
        problem: 'Путь найден по графу. Сколько ехать? Город в пробке и ночью это два разных ответа.',
        options: [
          { v: 'static', label: 'По длине и скорости знаков', note: 'Просто, но в городе ошибка около 25%.' },
          { v: 'ml', label: 'ML по пробкам и истории', note: 'Текущие пробки из потока точек плюс история за этот час недели. Ошибка около 5%. Так в книге.' },
        ],
        best: ['ml'], say: 'ETA считает отдельный сервис на ML: текущие пробки из потока точек и история скоростей. Shortest path ищет k путей без пробок, ETA их оценивает, ranker фильтрует и сортирует.' },
      { id: 'reroute', icon: '🔁', title: 'Кого перестроить при пробке', key: 'reroute',
        problem: 'В тайле r пробка. Миллионы людей в пути: как найти тех, чей маршрут идёт через r? Работает с блоком «Adaptive ETA и перестроение».',
        options: [
          { v: 'none', label: 'Не перестраивать', note: 'ETA устаревает в пути, водитель едет в пробку.' },
          { v: 'scan', label: 'Перебрать маршруты всех', note: 'Для каждого водителя хранить список тайлов маршрута и проверять r в каждом. Дорого: миллионы списков на каждую пробку.' },
          { v: 'hier', label: 'Тайлы по уровням', note: 'Для водителя храним текущий тайл и тайлы над ним до того, что накрывает цель. Пробку проверяем по крупному тайлу. Так в книге.' },
        ],
        best: ['hier'], say: 'Для каждого водителя храню текущий routing tile и тайлы уровней выше, пока крупный не накроет цель. Пробка в тайле быстро сравнивается с последним тайлом в списке, и затронутые водители получают новый маршрут.' },
      { id: 'push', icon: '📲', title: 'Как доставить новый маршрут', key: 'push',
        problem: 'Новый маршрут найден. Как отправить его водителю?',
        options: [
          { v: 'poll', label: 'Клиент спрашивает раз в 30 с', note: 'Миллионы лишних запросов в навигацию и опоздание до 30 с.' },
          { v: 'mobile', label: 'Мобильный пуш', note: 'Payload до 4 КБ, в вебе не работает: веб-пользователи новый маршрут не получат.' },
          { v: 'ws', label: 'WebSocket', note: 'Двусторонний канал на время навигации, легче long polling и SSE для этой задачи. Так в книге.' },
        ],
        best: ['ws'], say: 'Новый маршрут доставляю по WebSocket: соединение живёт, пока идёт навигация. Пуш ограничен 4 КБ и не работает в вебе, опрос даёт лишние запросы.' },
      { id: 'scale', icon: '📈', title: 'Поток точек под нагрузкой', settings: 'kafka',
        problem: 'Пик задаётся над картой. Kafka принимает каждую пачку, а обновление пробок читает её группой потребителей. Что масштабировать?',
        hint: 'Брокеры и партиции настраиваются в блоке «Kafka: поток точек». Потребителей пробок не больше, чем партиций. Кнопка «Подобрать под нагрузку» найдёт размер.',
        say: 'Поток точек партиционирую по user_id: точки одного человека идут по порядку, а партиций столько, чтобы потребители пробок успевали в пик.' },
    ],

    metrics: [
      { id: 'mbHour', label: 'Трафик карты, МБ за час' },
      { id: 'etaErr', label: 'Ошибка ETA, %' },
      { id: 'missedJam', label: 'Водителей без нового маршрута', bad: true },
    ],

    model(ctx) {
      const { d, deep, nodes, flows, stage } = ctx, c = deep.choices, M = ctx.metrics;
      const all = Object.values(nodes), of = (t) => all.filter((n) => n.type === t), F = (id) => flows.find((f) => f.id === id);
      const badge = (n, icon, title) => n && n.badges.push({ icon, title });
      const addLoad = (n, fid, x) => { if (!n || !x) return; n.load += x; n.flows[fid] = (n.flows[fid] || 0) + x; if (F(fid).write) n.wload += x; };
      const scale = (n, fid, m) => n && addLoad(n, fid, (n.flows[fid] || 0) * (m - 1));
      M.missedJam = 0;
      const deepOn = stage === 'deep';
      const batch = deepOn ? c.batch : 'batch', render = deepOn ? c.render : 'pre', fmt = deepOn ? c.fmt : 'raster', url = deepOn ? c.tileUrl : 'service';
      const graph = deepOn ? c.graph : 'hier', etaM = deepOn ? c.etaM : 'ml', rr = deepOn ? c.reroute : 'none', push = deepOn ? c.push : 'ws';
      const loc = of('locSvc')[0], kf = of('kafka')[0], ts = of('tileSvc')[0], cdn = of('cdn')[0], sp = of('spSvc')[0], nav = of('navSvc')[0];

      // ---------- точки ----------
      if (batch === 'each') {
        ['loc', 'locStream'].forEach((f) => all.forEach((n) => scale(n, f, BATCH)));
        ctx.warn('warn', `Каждая точка отдельным запросом: ${big(d.gps * d.k)} в секунду вместо ${big(d.loc * d.k)}. Телефон не засыпает, батарея садится.`);
      } else badge(loc, '📦', 'Пачка раз в 15 с');

      // ---------- тайлы ----------
      const vec = fmt === 'vector' ? 0.5 : 1;
      M.mbHour = d.mbMin * 60 * vec;
      if (vec < 1) { ['tileGet', 'tileMiss'].forEach((f) => all.forEach((n) => scale(n, f, vec))); badge(cdn, '📐', 'Векторные тайлы'); }
      if (render === 'dynamic') {
        // CDN почти не попадает: тайл рисуется на каждый запрос в Map tile service.
        scale(of('tileStore')[0], 'tileMiss', 25);
        if (ts) { addLoad(ts, 'tileGet', d.tiles * d.k * vec * 0.5); ts.capMult *= 0.02; }
        F('tileGet').extraLat += 150;
        ctx.warn('warn', 'Тайлы рисуются на лету: каждый запрос гоняет CPU, одинаковые тайлы рисуются заново тысячи раз, CDN почти не помогает.');
      } else badge(of('tileStore')[0], '🧊', 'Готовые тайлы всех зумов');
      if (url === 'client' && ts) {
        addLoad(ts, 'tileUrl', -(ts.flows.tileUrl || 0));
        ctx.warn('info', 'Адрес тайла считает клиент: нет лишнего запроса, но поменять схему адресов можно только релизом приложения.');
      }

      // ---------- маршрут ----------
      const navF = F('nav');
      if (graph === 'whole' && sp) { sp.capMult *= 0.01; navF.extraLat += 5000; ctx.warn('warn', 'Весь граф мира в памяти: не помещается на одну машину, а A* для дальнего маршрута обходит миллионы вершин.'); }
      if (graph === 'flat' && sp) { sp.capMult *= 0.25; scale(of('routeTiles')[0], 'tileLoad', 20); navF.extraLat += 1500; ctx.warn('warn', 'Routing tiles одного уровня: дальний маршрут подгружает тысячи мелких тайлов, поиск идёт секунды.'); }
      if (graph === 'hier') badge(sp, '🧱', 'Routing tiles трёх уровней');

      M.etaErr = etaM === 'ml' ? 5 : 25;
      if (etaM === 'static') { const e = of('eta')[0]; if (e) e.capMult *= 3; ctx.warn('warn', 'ETA по длине и знакам: в городе ошибка около 25%, пробки не учтены.'); }
      else badge(of('eta')[0], '🤖', 'ML: пробки и история');

      if (!deepOn) return;

      // ---------- перестроение ----------
      const R = F('reroute'), ad = of('adaptSvc')[0], ws = of('wsGw')[0];
      if (ws) { ws.minRep = Math.ceil((d.navConc * d.k) / WS_CONN); ws.minRepWhy = `В пути ${big(d.navConc * d.k)} водителей, по ${big(WS_CONN)} соединений на сервер.`; }
      if (!R.ok || rr === 'none') M.missedJam = d.navConc * d.k * 0.01 * 24 * 60;
      else {
        if (rr === 'scan' && ad) { scale(ad, 'reroute', 2000); ctx.warn('warn', `Перебор маршрутов всех ${big(d.navConc * d.k)} водителей на каждую пробку: сервис перестроения сравнивает миллионы списков тайлов.`); }
        if (rr === 'hier') badge(ad, '🧱', 'Тайлы маршрута по уровням');
        if (push === 'mobile') { M.missedJam = d.navConc * d.k * 0.01 * 24 * 60 * 0.15; ctx.warn('warn', 'Мобильный пуш: до 4 КБ и не работает в вебе. Около 15% водителей в браузере новый маршрут не получат.'); }
        if (push === 'poll' && nav) { addLoad(nav, 'nav', (d.navConc * d.k) / 30); R.extraLat += 15000; ctx.warn('warn', `Опрос раз в 30 с: ${big((d.navConc * d.k) / 30)} лишних запросов в секунду в навигацию, новый маршрут опаздывает в среднем на 15 с.`); }
        if (push === 'ws') badge(ws, '🔌', 'WebSocket на время навигации');
      }
      if (!R.ok) ctx.warn('warn', 'Маршрут не перестраивается: добавь «Adaptive ETA и перестроение» и «WebSocket-серверы» со стрелками от обновления пробок.');
    },

    overload: 'добавить копий или снять нагрузку: пачки точек, CDN, иерархия тайлов',
    linkWhy(a, b) {
      const B = this.blocks;
      if (a === 'client' && B[b].db) return 'Клиент не ходит в хранилища: тайлы через CDN, остальное через сервисы.';
      if (B[a].db) return 'Хранилище отвечает на запросы, но само никого не вызывает.';
      if (a === 'client' && b === 'kafka') return 'Клиент шлёт точки в Location service, а тот публикует в Kafka.';
      return '';
    },

    rules(ctx) {
      const { graph, nodes, metrics: M, stage, d, flows } = ctx, F = (id) => flows.find((f) => f.id === id);
      graph.edges.forEach((e) => {
        const a = nodes[e.from], b = nodes[e.to];
        if (a && b && a.type === 'client' && b.def.db) ctx.warn('bad', `Клиент ходит в «${b.def.name}» напрямую.`);
      });
      // Маршрут ждёт геокодирование, подгрузку тайлов и ETA.
      const nv = F('nav');
      if (nv.ok) ['geocodeF', 'tileLoad', 'etaF'].forEach((id) => { const f = F(id); if (f.ok) nv.lat += f.lat; });
      const tg = F('tileGet'), tm = F('tileMiss');
      if (tg.ok && tm.ok) tg.lat += tm.lat * 0.02;
      if (M.missedJam > 0 && stage === 'deep') ctx.warn('bad', `Около ${big(M.missedJam)} водителей в день не узнают о пробке впереди.`);
      if (stage === 'deep' && flows.every((f) => f.ok || f.optional) && !F('metricsScrape').ok) ctx.warn('info', 'Нет метрик: ошибку ETA и отставание Kafka увидишь по жалобам. Добавь «Метрики и алерты».');
      if (stage === 'base' && flows.every((f) => f.ok || f.optional)) ctx.warn('info', `Как показала оценка: тайлов ${big(d.tiles * d.k)} в секунду идут с CDN, пачек точек ${big(d.loc * d.k)}, маршрутов ${big(d.nav * d.k)}. Самое тяжёлое по CPU это маршруты.`);
    },

    goals: {
      base: [
        { text: 'Точки, маршруты и тайлы доходят до данных', check: (r) => r.m.routed },
        { text: 'Тайлы идут с CDN, промахи из S3', check: (r) => ['tileGet', 'tileMiss'].every((id) => r.flows.find((f) => f.id === id).ok) },
        { text: 'Точки идут в Kafka и из неё в пробки для ETA', check: (r) => ['locStream', 'etaF'].every((id) => r.flows.find((f) => f.id === id).ok) },
        { text: 'Нагрузка выдерживается', check: (r) => r.m.served >= 1 && r.m.maxU <= 0.9 },
      ],
      deep: [
        { text: 'Маршрут быстрее 1 с, ETA ошибается меньше 10%', check: (r) => r.m.routed && r.flows.find((f) => f.id === 'nav').lat <= 1000 && r.m.etaErr <= 10 },
        { text: 'Карта меньше 50 МБ за час навигации', check: (r) => r.m.routed && r.m.mbHour <= 50 },
        { text: 'Тайл с CDN быстрее 50 мс', check: (r) => r.m.routed && r.flows.find((f) => f.id === 'tileGet').lat <= 50 },
        { text: 'Каждый водитель узнаёт о пробке быстрее 5 с', check: (r) => r.m.routed && r.flows.find((f) => f.id === 'reroute').ok && r.m.missedJam === 0 && r.flows.find((f) => f.id === 'reroute').lat <= 5000 },
        { text: 'Выдерживаем пик ×5', check: (r) => r.d.peak >= 5 && r.m.served >= 1 && r.m.maxU <= 0.9 },
      ],
    },

    summary: {
      db: 'locDB', core: CORE,
      estCard: (d, f) => `${f(d.loc * d.k)} пачек/с, ${f(d.mbs * d.k)} МБ/с тайлов`,
      badRow: { label: 'Водители без нового маршрута за день', ids: ['missedJam'] },
      script: (x) => {
        const t = x.fmt, d = x.d, kf = x.r.nodes.kafka;
        return [
          { step: 'Требования', min: 4, text: 'Функции: обновлять точку пользователя, маршрут с ETA, карта, перестроение при пробке. NFR: точность, плавная карта, экономия трафика и батареи, масштаб. Без остановок, транспорта и отзывов.' },
          { step: 'Оценка', min: 4, text: `Тайлы: 4,4 трлн на зуме 21 по 100 КБ, это 440 ПБ, без океанов и со всеми уровнями около ${t(d.tilePB)} ПБ. ${t(d.navDay)} минут навигации в день: ${t(d.gps)} точек в секунду, пачками ${t(d.loc * d.k)}. CDN отдаёт ${t(d.mbs * d.k)} МБ/с.` },
          { step: 'API', min: 3, text: 'POST /v1/locations с пачкой точек. GET /v1/nav с origin и destination: расстояние, время, polyline. GET /v1/tiles: адреса 9 тайлов на CDN. Новый маршрут по WebSocket.' },
          { step: 'Дизайн', min: 5, text: `Location service пишет точки в Cassandra и Kafka${kf ? ` (${kf.cfg.partitions} партиций)` : ''}. Из Kafka читают обновление пробок и пересборка routing tiles. Навигация: геокодирование, shortest path по routing tiles, ETA по пробкам, ranker. Карта: готовые тайлы в S3 за CDN, адреса отдаёт Map tile service.` },
          { step: 'Точки и тайлы', min: 4, text: `${x.choice('batch').say} ${x.choice('render').say} ${x.choice('fmt').say}` },
          { step: 'Адреса тайлов', min: 2, text: x.choice('tileUrl').say },
          { step: 'Маршрут и ETA', min: 5, text: `${x.choice('graph').say} ${x.choice('etaM').say}` },
          { step: 'Перестроение', min: 4, text: `${x.choice('reroute').say} ${x.choice('push').say}` },
          { step: 'Что изменится, если…', min: 2, text: 'Остановки по пути: задача коммивояжёра поверх A*. Офлайн: скачивать векторные тайлы и routing tiles региона. Транспорт: граф с расписаниями.' },
        ];
      },
      says: {
        batch: { each: 'Каждая точка отдельно: в 15 раз больше запросов и разряженная батарея.', batch: 'Пачка раз в 15 с: 200 тыс. запросов в секунду вместо 3 млн.' },
        render: { dynamic: 'Тайлы на лету тратят CPU на одно и то же.', pre: 'Готовые тайлы в S3 за CDN.' },
        fmt: { raster: 'Растровые тайлы тяжелее и мылятся при зуме.', vector: 'Векторные тайлы вдвое легче, рисуются на клиенте.' },
        tileUrl: { client: 'Адрес считает клиент: без лишнего запроса, но схема зашита в приложение.', service: 'Адреса отдаёт Map tile service: схему можно менять без релиза.' },
        graph: { whole: 'Весь граф в памяти не помещается и ищется медленно.', flat: 'Плоские routing tiles медленны для дальних маршрутов.', hier: 'Иерархия routing tiles: дальний маршрут по крупным тайлам.' },
        etaM: { static: 'ETA по знакам ошибается на четверть.', ml: 'ETA на ML по пробкам и истории.' },
        reroute: { none: 'Без перестроения водитель едет в пробку.', scan: 'Перебор всех маршрутов дорог.', hier: 'Тайлы маршрута по уровням: затронутые находятся быстро.' },
        push: { poll: 'Опрос даёт лишние запросы и опоздание.', mobile: 'Пуш ограничен 4 КБ и не работает в вебе.', ws: 'WebSocket на время навигации.' },
      },
      tradeoffs: [
        { pick: 'Пачка точек раз в 15 с', alt: 'Каждая точка', why: 'В 15 раз меньше запросов и батареи, цена: пробки узнаём на 15 с позже.' },
        { pick: 'Готовые тайлы на CDN', alt: 'Рисовать на лету', why: 'Карта меняется редко, одинаковые тайлы нужны миллионам.' },
        { pick: 'Векторные тайлы', alt: 'Растр', why: 'Меньше трафика и плавный зум, цена: рисует клиент.' },
        { pick: 'Map tile service', alt: 'Адрес на клиенте', why: 'Гибкость схемы адресов ценой лишнего запроса.' },
        { pick: 'Иерархия routing tiles', alt: 'Весь граф', why: 'Граф по кускам помещается в память, дальний маршрут по крупным тайлам.' },
        { pick: 'Kafka для точек', alt: 'Прямые вызовы потребителей', why: 'Много потребителей одного потока, каждый в своём темпе.' },
        { pick: 'Cassandra для точек', alt: 'Реляционная БД', why: 'Поток записи и рост узлами.' },
        { pick: 'WebSocket для нового маршрута', alt: 'Пуш или опрос', why: 'Без лимита 4 КБ, работает в вебе, без лишних запросов.' },
      ],
      pitfalls: [
        'Слать каждую точку отдельным запросом.',
        'Рисовать тайлы на сервере на каждый запрос.',
        'Пытаться держать весь граф мира в одной памяти.',
        'Считать ETA только по длине дорог.',
        'Забыть, что маршрут надо перестраивать в пути.',
        'Не посчитать объём тайлов и трафик CDN.',
        'Смешать поток точек и ответы маршрутов в одном сервисе.',
      ],
      questions: [
        { q: 'Сколько весят тайлы?', a: '4,4 трлн тайлов на зуме 21 по 100 КБ: 440 ПБ. Океаны и пустыни сжимаются, со всеми уровнями около 100 ПБ.' },
        { q: 'Сколько точек в секунду?', a: '5 млрд минут навигации в день, GPS раз в секунду: 3 млн. Пачками раз в 15 с: 200 тыс., в пик около 1 млн.' },
        { q: 'Что такое geohash тайла?', a: 'Тайл однозначно задан geohash и зумом: из них строится адрес на CDN.' },
        { q: 'Зачем Kafka в потоке точек?', a: 'Поток читают обновление пробок, пересборка routing tiles, ML и аналитика. Каждый в своём темпе.' },
        { q: 'Что такое routing tiles?', a: 'Граф дорог, нарезанный по тайлам geohash. Поиск подгружает только нужные куски.' },
        { q: 'Зачем три уровня тайлов?', a: 'Местные дороги, магистрали, трассы. Дальний маршрут идёт по крупным тайлам и не тянет тысячи мелких.' },
        { q: 'Из чего состоит навигация?', a: 'Геокодирование, shortest path (k путей без пробок), ETA (ML по пробкам), ranker (фильтры и сортировка), сервисы обновления.' },
        { q: 'Как найти водителей, которых задела пробка?', a: 'Для каждого храним текущий тайл и тайлы уровней выше до цели. Пробку сравниваем с крупным тайлом.' },
        { q: 'Почему WebSocket для нового маршрута?', a: 'Пуш ограничен 4 КБ и не работает в вебе, опрос даёт лишние запросы. WebSocket двусторонний и лёгкий.' },
        { q: 'Растровые или векторные тайлы?', a: 'Векторные: меньше трафика, плавный зум, рисует клиент через WebGL.' },
      ],
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
