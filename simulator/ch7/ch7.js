/* Глава 7. Hotel Reservation System: данные для лаборатории (simulator/lab). */
(function (g) {
  const SQL_FIT = { use: 'Брони, инвентарь, деньги: всё, где нужны ACID-транзакции, ограничения и JOIN.', avoid: 'Сотни тысяч записей в секунду без естественного ключа шардирования.', limits: 'Запись упирается в один primary; шардирование делается вручную и ломает JOIN и транзакции между шардами.' };
  // Чем адаптировать эталон под нагрузку выше книжной, по порядку (дальше движок подбирает размеры БД).
  const ADAPT = [
    { add: 'cache', id: 'cache', from: 'hotel', pos: [685, 170], why: 'кэш отелей снимает чтения с Hotel DB' },
    { add: 'cache', id: 'cacheR', from: 'reservation', pos: [685, 290], why: 'кэш доступности снимает чтения с Reservation DB' },
    { add: 'cdn', from: 'client', why: 'CDN отдаёт просмотры до Gateway' },
    { add: 'limiter', from: 'gateway', why: 'rate limiter срезает ботов и парсеры' },
  ];
  g.LAB = {
    id: 'ch7', n: 7, title: 'Hotel Reservation System', subtitle: 'Бронирование отелей',
    intro: 'Система бронирования вроде Booking или Marriott. Нагрузка маленькая, поэтому сложность не в объёме, а в корректности: нельзя продать один номер дважды, когда люди жмут кнопку одновременно и по два раза.',

    steps: [
      // sub: подпись в степпере, tag и guide: строка в боковой панели «Как пройти главу»
      { id: 'req', title: 'Требования', sub: 'что строим и что нет', kind: 'req', tag: '~5 мин', guide: 'Отметь функции и ограничения, нажми «Проверить». Лишнее тоже важно заметить.' },
      { id: 'est', title: 'Оценка нагрузки', sub: '3 TPS и воронка', kind: 'est', tag: '~5 мин', guide: 'Покрути слайдеры. Вывод: запись маленькая, хватит одной SQL-БД.' },
      { id: 'api', title: 'API и данные', sub: 'эндпоинты и таблицы', kind: 'api', tag: '~5 мин', guide: 'reservationId в теле POST и инвентарь по типу номера и дате.' },
      { id: 'hld', title: 'Дизайн', sub: 'схема на карте', kind: 'map', stage: 'base', tag: '~10 мин', guide: 'Собери блоки и стрелки так, чтобы все четыре потока дошли до данных.' },
      { id: 'deep', title: 'Углубление', sub: 'проблемы и решения', kind: 'map', stage: 'deep', tag: '~15 мин', guide: 'Двойной клик, гонка за номер, распродажа, бронь и оплата в разных БД.' },
      { id: 'sum', title: 'Итог', sub: 'рассказ для интервью', kind: 'sum', tag: '~5 мин', guide: 'Перескажи решение по шагам и ответь на вопросы для повторения.' },
    ],

    requirements: {
      intro: 'Сначала договариваемся, что строим. Отметь то, что входит в задачу, и нажми «Проверить». Лишнее тоже важно заметить: на интервью за него не дают баллов, а время уходит.',
      groups: [
        { title: 'Функциональные', items: [
          { text: 'Показать страницу отеля и типы номеров', in: true, why: 'Основной сценарий просмотра. Данные почти статичные, их легко кэшировать.' },
          { text: 'Показать доступность и цену на выбранные даты', in: true, why: 'Цена меняется по дням (в книге за это отвечает Rate Service), доступность зависит от инвентаря.' },
          { text: 'Забронировать номер', in: true, why: 'Главный сценарий и главная сложность главы.' },
          { text: 'Отменить бронь', in: true, why: 'Нужна, и это одна из причин, почему отели допускают овербукинг.' },
          { text: 'Админка отеля: добавить и изменить номера', in: true, why: 'Отель сам управляет инвентарём и ценами.' },
          { text: 'Овербукинг до 10%', in: true, why: 'Отели продают чуть больше номеров, чем есть, потому что часть броней отменяется. Это бизнес-правило, а не ошибка.' },
          { text: 'Рекомендации отелей на ML', in: false, why: 'Вне рамок главы. На интервью стоит сказать, что это отдельная система.' },
          { text: 'Отзывы и рейтинги', in: false, why: 'Вне рамок: отдельный сервис, не влияет на ядро бронирования.' },
          { text: 'Чат с отелем', in: false, why: 'Вне рамок главы.' },
        ] },
        { title: 'Нефункциональные', items: [
          { text: 'Нет двойного бронирования: корректность важнее скорости', in: true, why: 'Главное требование. Из него вырастают ACID-БД, блокировки и идемпотентность.' },
          { text: 'Высокая конкурентность в пиковые даты', in: true, why: 'В праздники и распродажи много людей одновременно бронируют одни и те же номера.' },
          { text: 'Умеренная задержка: бронь может занять пару секунд', in: true, why: 'Пользователь готов подождать при бронировании, но не при просмотре.' },
          { text: 'Задержка брони меньше 10 мс', in: false, why: 'Не нужно. Это бы толкнуло нас к сложным решениям без пользы.' },
          { text: 'Миллионы записей в секунду', in: false, why: 'Оценка покажет около 3 броней в секунду. Сложность не в объёме.' },
        ] },
      ],
      conclusion: 'Итог: обычный по объёму сервис, где цена ошибки высокая. Дальше проверим это цифрами.',
    },

    estimate: {
      intro: 'Прикидываем порядок величин. Цель не точность, а вывод: какой тип хранилища и нужно ли масштабироваться.',
      inputs: [
        { id: 'rooms', label: 'Номеров во всех отелях', unit: '', min: 100000, max: 10000000, step: 100000, value: 1000000 },
        { id: 'occ', label: 'Заполняемость', unit: '%', min: 10, max: 100, step: 5, value: 70 },
        { id: 'stay', label: 'Средний срок брони', unit: 'ночи', min: 1, max: 14, step: 1, value: 3 },
        { id: 'conv', label: 'Доходит до следующего шага воронки', unit: '%', min: 2, max: 50, step: 1, value: 10 },
      ],
      rows: (d) => [
        // peak: величина в секунду, в пике умножается на ×распродажи
        { label: 'Броней в день', formula: 'номера × заполняемость ÷ срок × рост', v: d.B },
        { label: 'Броней в секунду (запись)', formula: 'брони в день ÷ 86 400', v: d.tps, peak: true },
        { label: 'Страница бронирования, QPS', formula: 'TPS ÷ конверсия', v: d.page, peak: true },
        { label: 'Просмотр отелей, QPS', formula: 'страница брони ÷ конверсия', v: d.view, peak: true },
        { label: 'Посетителей в день (DAU)', formula: 'просмотры × 86 400 ÷ 10 страниц на человека', v: (d.view * 86400) / 10 },
        { label: 'Строк в room_type_inventory', formula: 'отели × 20 типов × 730 дней', v: d.invRows },
      ],
      conclusion: (d) => { const w = d.tps * d.k, t = w < 10 ? w.toFixed(1) : Math.round(w);
        return w < 300 ? `В пике сценария запись около ${t} в секунду: это мало. Одна реляционная БД справится, шардировать ради нагрузки не нужно. Значит, вся сложность будет в конкурентности, а не в масштабе.`
          : w < 1000 ? `В пике сценария запись около ${t} в секунду. Один primary ещё справляется, но запас тает: пора думать о шардировании.`
          : `В пике сценария запись около ${t} в секунду: один primary (в модели около 1500 rps) не вытянет. Нужны шарды, а чтения стоит снять кэшем.`; },
    },

    api: {
      intro: 'Минимальный набор эндпоинтов и главная идея модели данных: храним не конкретные номера, а инвентарь по типу номера и дате.',
      endpoints: [
        ['GET', '/v1/hotels/{id}', 'Страница отеля'],
        ['GET', '/v1/hotels/{id}/rooms?checkIn&checkOut', 'Типы номеров, доступность и цена на даты'],
        ['POST', '/v1/reservations', 'Создать бронь. В теле hotelId, roomTypeId, даты и reservationId'],
        ['GET', '/v1/reservations/{id}', 'Посмотреть бронь'],
        ['DELETE', '/v1/reservations/{id}', 'Отменить бронь'],
        ['POST/PUT', '/v1/hotels, /v1/rooms', 'Админка отеля'],
      ],
      tables: [
        { name: 'room_type_inventory', fields: 'hotel_id, room_type_id, date, total_inventory, total_reserved', why: 'Одна строка на тип номера и дату. Проверка «есть ли место» это сравнение total_reserved и total_inventory.' },
        { name: 'reservation', fields: 'reservation_id (PK), hotel_id, room_type_id, start_date, end_date, status, guest_id', why: 'Статусы: pending → paid → canceled / refunded / rejected.' },
        { name: 'hotel, room_type, rate', fields: 'описание отеля, типы номеров, цены по датам', why: 'Почти статичные данные: читаются часто, меняются редко.' },
      ],
      quiz: [
        { q: 'Почему реляционная БД, а не NoSQL?', a: 'Нужны ACID-транзакции (деньги и «один номер, одна бронь»), данные хорошо структурированы, а нагрузка небольшая и в основном на чтение.' },
        { q: 'Бронируем конкретный номер или тип номера?', a: 'Тип номера. Конкретный номер выдают при заселении. Поэтому инвентарь хранится по типу и дате.' },
        { q: 'Зачем reservationId в теле POST, если его может создать сервер?', a: 'Это ключ идемпотентности: клиент получает id заранее, и повтор запроса не создаст вторую бронь.' },
        { q: 'Влезет ли room_type_inventory в одну БД?', a: '5000 отелей × 20 типов × 2 года ≈ 73 млн строк. Это немного для одной реляционной БД.' },
      ],
    },

    board: { w: 1320, h: 820 },
    // Сценарий нагрузки общий для оценки, карты и эталона. stops: значения ползунка.
    scenario: [
      { id: 'flash', label: 'Пик распродажи', unit: '×', stops: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], value: 1, hint: 'Во сколько раз трафик в пик выше обычного дня' },
      { id: 'growth', label: 'Рост бизнеса', unit: '×', stops: [1, 2, 5, 10, 20], value: 1, hint: 'Во сколько раз больше номеров и броней, чем сейчас' },
    ],
    // Порядок тематических групп в палитре (block.group).
    groups: ['Вход', 'Сервисы', 'SQL', 'Кэширование', 'Очереди и брокеры', 'NoSQL', 'Вход и защита', 'Поиск', 'Координация'],
    expGroups: ['Очереди и брокеры', 'NoSQL', 'Кэширование', 'Вход и защита', 'Поиск', 'Координация', 'Сервисы'],

    // cat задаёт цвет блока на карте; extra: блок не нужен по книге, но его можно попробовать.
    // learn.plus / learn.minus: что даёт и чем платим. links: стрелки, которые проводятся при добавлении.
    blocks: {
      client: { name: 'Клиент', icon: '👤', cat: 'edge', group: 'Вход', pos: [20, 330], cap: 0, tag: 'Браузер или приложение',
        learn: { what: 'Браузер или приложение. Отсюда начинаются все пользовательские потоки.', plus: [], minus: [] } },
      gateway: { name: 'API Gateway', icon: '🚪', cat: 'edge', group: 'Вход', pos: [235, 330], cap: 5000, lat: 5, cost: 150, cx: 0.5, maxRep: 200, links: [['client', 'self']], tag: 'Единая точка входа',
        learn: { what: 'Маршрутизация, авторизация, rate limiting в одном месте.', plus: ['Клиент не знает о внутренних сервисах', 'Сервисы можно менять за спиной'], minus: ['Ещё один хоп: +5 мс'] } },
      hotel: { name: 'Hotel Service', icon: '🏨', cat: 'svc', group: 'Сервисы', pos: [455, 60], cap: 1000, lat: 20, cost: 120, cx: 1, maxRep: 200, links: [['gateway', 'self']], tag: 'Отели, номера, цены',
        learn: { what: 'Отдаёт отели, типы номеров и цены.', plus: ['Данные почти статичные: легко кэшировать', 'Stateless: масштабируется добавлением копий'], minus: [] } },
      reservation: { name: 'Reservation Service', icon: '📝', cat: 'svc', group: 'Сервисы', pos: [455, 400], cap: 500, lat: 30, cost: 150, cx: 1.5, maxRep: 200, links: [['gateway', 'self']], tag: 'Брони и инвентарь',
        learn: { what: 'Проверяет доступность, создаёт и отменяет брони, обновляет инвентарь.', plus: ['Единственное место, которое меняет инвентарь'], minus: ['Здесь живут все проблемы конкурентности'] } },
      payment: { name: 'Payment Service', icon: '💳', cat: 'svc', group: 'Сервисы', pos: [455, 600], cap: 300, lat: 150, cost: 150, cx: 1, maxRep: 200, links: [['reservation', 'self']], tag: 'Списание денег',
        learn: { what: 'Списание денег через платёжного провайдера.', plus: ['Платёжная логика изолирована'], minus: ['Своя БД: бронь и оплату не обернуть одной транзакцией', 'Внешний провайдер медленный: ~150 мс'] } },
      hotelDB: { name: 'Hotel DB', icon: '🗄️', cat: 'db', group: 'SQL', fit: SQL_FIT, pos: [915, 60], cap: 3000, lat: 10, cost: 300, cx: 1, db: true, tune: 'sql', repLabel: 'шард.', links: [['hotel', 'self']], tag: 'SQL: отели и цены',
        learn: { what: 'Реляционная БД с отелями, номерами и ценами.', plus: ['Чтения масштабируются репликами'], minus: ['Каждая реплика стоит как ещё одна БД: для горячих чтений дешевле кэш'] } },
      resDB: { name: 'Reservation DB', icon: '🗃️', cat: 'db', group: 'SQL', fit: SQL_FIT, pos: [915, 400], cap: 1500, lat: 15, cost: 400, cx: 1, db: true, tune: 'sql', repLabel: 'шард.', links: [['reservation', 'self']], tag: 'SQL: инвентарь и брони',
        shardKeys: [
          { v: 'hotel', label: 'hotel_id', note: 'Все данные отеля в одном шарде, поэтому бронь остаётся локальной транзакцией. Так в книге.' },
          { v: 'date', label: 'дата', skew: 0.5, note: 'Бронь на несколько ночей попадает в разные шарды: нужна распределённая транзакция. А в распродажу все бронируют одни даты, и горячий шард берёт половину нагрузки. Ловушка.' },
        ],
        learn: { what: 'Реляционная БД с room_type_inventory и reservation. Источник истины.', plus: ['ACID: инвентарь и бронь меняются вместе', 'Блокировки и CHECK прямо в БД'], minus: ['Запись упирается в один primary, пока нет шардов'] } },
      payDB: { name: 'Payment DB', icon: '🧾', cat: 'db', group: 'SQL', fit: SQL_FIT, pos: [915, 660], cap: 10000, lat: 15, cost: 300, cx: 1, db: true, tune: 'sql', repLabel: 'шард.', links: [['payment', 'self']], tag: 'SQL: платежи',
        learn: { what: 'БД платежей у Payment Service.', plus: ['У каждого сервиса своя БД'], minus: ['Нужна распределённая согласованность с бронью'] } },
      cache: { name: 'Кэш (Redis)', icon: '⚡', cat: 'cache', group: 'Кэширование',
        fit: { use: 'Кэш с TTL и структурами данных: доступность по датам, счётчики, сессии. Заодно блокировки и pub/sub.', avoid: 'Источник истины для броней и денег: асинхронная репликация может потерять последние записи.', limits: 'Около 100 тыс. операций/с на инстанс (одно ядро), объём ограничен памятью, при отставании показывает устаревшие данные.' }, pos: [685, 170], cap: 50000, lat: 1, cost: 200, cx: 1.5, maxRep: 6, cache: true, multi: true, at: 'db', absorb: { view: 0.95, search: 0.9 },
        links: [[['hotel', 'reservation'], 'self']], tag: 'Чтения из памяти',
        learn: { what: 'Сервис сначала смотрит в кэш и идёт в БД только при промахе (cache-aside). Можно поставить два: для отелей и для инвентаря.', plus: ['Снимает с БД 90–95% чтений', 'Чтение за 1 мс'], minus: ['Может отставать от БД: показывает «есть места», которых уже нет', 'Для брони не используется: проверка всегда в БД'] } },

      cdn: { name: 'CDN', icon: '🌍', cat: 'edge', extra: true, group: 'Вход и защита',
        fit: { use: 'Статика и страницы, одинаковые для всех: фото, описания отелей.', avoid: 'Персональные и быстро меняющиеся ответы: доступность, цены на даты, бронь.', limits: 'Инвалидация занимает секунды и минуты, платишь за трафик.' }, pos: [20, 130], cap: 500000, lat: 2, cost: 250, cx: 0.5, maxRep: 20, overload: 'кэшировать в браузере и приложении (HTTP-кэш), чтобы часть просмотров вообще не уходила в сеть', absorb: { view: 0.6 }, links: [['client', 'self']], tag: 'Страницы и фото ближе к пользователю',
        learn: { what: 'Сеть серверов по миру, отдаёт статику и закэшированные страницы отелей.', plus: ['Забирает ~60% просмотров ещё до Gateway', 'Быстрее для пользователя'], minus: ['Не помогает брони и доступности: они динамические', 'Нужна инвалидация при смене цен и фото'] } },
      limiter: { name: 'Rate limiter', icon: '🚦', cat: 'edge', extra: true, group: 'Вход и защита',
        fit: { use: 'Защита от ботов, парсеров цен и всплесков от одного клиента.', avoid: 'Как способ выдержать честную нагрузку: живым пользователям он просто откажет.', limits: 'Срезает только трафик сверх лимита на клиента, общий поток почти не меняет.' }, pos: [235, 140], cap: 200000, lat: 1, cost: 100, cx: 1, maxRep: 20, overload: 'ограничивать прямо на CDN или балансировщике, до отдельного сервиса', absorb: { view: 0.15, search: 0.15 }, links: [['gateway', 'self']], tag: 'Отсекает ботов и парсеры',
        learn: { what: 'Ограничивает частоту запросов на пользователя или IP.', plus: ['В распродажу режет ~15% трафика от ботов и парсеров цен'], minus: ['Может задеть живых пользователей', 'Брони он не ускоряет'] } },
      kafka: { name: 'Kafka', icon: '🧵', cat: 'async', extra: true, group: 'Очереди и брокеры', brokerCap: 20000,
        fit: { use: 'Журнал событий: несколько подписчиков читают один поток, CDC, аналитика, Saga, сотни тысяч событий в секунду.', avoid: 'Нужны маршрутизация отдельных задач, приоритеты, отложенная доставка, или поток маленький: кластер дороже пользы.', limits: 'Порядок только внутри партиции, потребителей в группе не больше партиций, число партиций трудно уменьшить.' }, pos: [1070, 260], cap: 5000, lat: 5, cost: 500, cx: 2.5, tune: 'kafka', repLabel: 'партиц.', links: [['reservation', 'self'], ['self', 'notification']], bring: ['notification'], drop: [['reservation', 'notification']], tag: 'Очередь событий',
        learn: { what: 'Журнал событий: «бронь создана», «оплата прошла», изменения в БД (CDC).', plus: ['Письма и аналитика не тормозят бронь: Reservation → Kafka → Notification', 'CDC: Reservation DB → Kafka → кэш инвентаря, и кэш почти не отстаёт', 'Удобная основа для Saga'], minus: ['Ещё один кластер: +сложность и цена', 'Сама по себе ничего не ускоряет, если к ней не подключить потребителей'] } },
      notification: { name: 'Notification Service', icon: '📨', cat: 'svc', extra: true, group: 'Сервисы', pos: [1070, 600],
        fit: { use: 'Письма и пуши после брони.', avoid: 'Синхронный вызов из брони: бронь ждёт почту и падает вместе с ней.', limits: 'Медленный внешний провайдер (~120 мс), поэтому потребителей нужно много.' }, cap: 50, lat: 120, cost: 30, cx: 1, maxRep: 50,
        overload: 'добавь партиций в Kafka (потребителей в группе не больше, чем партиций) или читай из RabbitMQ, где потребители конкурируют за очередь', links: [[['kafka', 'rabbit', 'reservation'], 'self']], tag: 'Письмо с подтверждением',
        learn: { what: 'Отправляет письма и пуши о брони.', plus: ['Пользователь получает подтверждение'], minus: ['Если звать его синхронно из Reservation Service, бронь ждёт почту (+120 мс) и падает вместе с ней. Лучше через Kafka.'] } },
      lock: { name: 'Redis-блокировка', icon: '🔐', cat: 'cache', extra: true, group: 'Координация',
        fit: { use: 'Короткая взаимная блокировка между сервисами, когда в БД защиты нет.', avoid: 'Когда есть блокировки или CHECK в самой БД: они надёжнее.', limits: 'Lock с TTL истекает посреди долгой операции, падение Redis снимает все блокировки.' }, pos: [685, 530], cap: 50000, lat: 2, cost: 150, cx: 2, maxRep: 3, links: [['reservation', 'self']], tag: 'Распределённый lock',
        learn: { what: 'Перед бронью сервис берёт lock на «отель + тип + даты» в Redis.', plus: ['Сильно снижает гонки, даже если в БД нет защиты'], minus: ['Lock с TTL может истечь посреди операции, а Redis может упасть: перепродажи не исчезают полностью', 'Ещё одна точка отказа. Блокировка в самой БД надёжнее'] } },
      search: { name: 'Elasticsearch', icon: '🔎', cat: 'db', extra: true, group: 'Поиск',
        fit: { use: 'Полнотекстовый поиск и фасетные фильтры по каталогу.', avoid: 'Как основная БД: нет транзакций, данные отстают на секунды.', limits: 'Нужна синхронизация с источником, тяжёлый в эксплуатации кластер.' }, pos: [685, 20], cap: 5000, lat: 30, cost: 600, cx: 3, maxRep: 10, links: [['hotel', 'self']], tag: 'Полнотекстовый поиск',
        learn: { what: 'Поисковый движок: «отели в Париже у моря с бассейном».', plus: ['Мощный поиск и фильтры'], minus: ['Поиска нет в требованиях главы: платишь сложностью и ценой без пользы', 'Данные нужно синхронизировать с Hotel DB'] } },
      nosql: { name: 'Cassandra', icon: '🪐', cat: 'db', extra: true, group: 'NoSQL',
        fit: { use: 'Огромный поток записи по известному ключу: события, ленты, метрики, IoT.', avoid: 'Транзакции на несколько строк и ограничения: брони, деньги.', limits: 'Нет JOIN и ACID на несколько строк, лёгкие транзакции (LWT) медленные, схема строится под запросы.' }, pos: [1070, 60], cap: 20000, lat: 8, cost: 500, cx: 2, maxRep: 30, db: true, repLabel: 'узл.', acid: 'none', links: [['reservation', 'self']], drop: [['reservation', 'resDB'], ['reservation', 'mongo'], ['reservation', 'dynamo']], tag: 'Wide-column NoSQL',
        learn: { what: 'Распределённая wide-column БД (как у Netflix и Discord). При добавлении брони сразу пойдут в неё.', plus: ['Запись масштабируется добавлением узлов', 'Нет единого primary'], minus: ['Нет ACID-транзакций на несколько строк: блокировки и CHECK не работают, двойные брони вернутся', 'Именно поэтому в книге выбрана реляционная БД'] } },
      mongo: { name: 'MongoDB', icon: '🍃', cat: 'db', extra: true, group: 'NoSQL',
        fit: { use: 'Документы с гибкой схемой: каталоги, профили, контент.', avoid: 'Много связей и JOIN, строгая финансовая отчётность.', limits: 'Транзакции на несколько документов медленнее SQL, ключ шардирования дорого менять.' }, pos: [1070, 60], cap: 8000, lat: 10, cost: 450, cx: 2, maxRep: 30, db: true, repLabel: 'шард.', acid: 'txn', links: [['reservation', 'self']], drop: [['reservation', 'resDB'], ['reservation', 'nosql'], ['reservation', 'dynamo']], tag: 'Документная NoSQL',
        learn: { what: 'Документная БД: бронь хранится JSON-документом. Шардируется встроенно. При добавлении брони сразу пойдут в неё.', plus: ['Гибкая схема и встроенное шардирование', 'С версии 4.0 есть транзакции на несколько документов: блокировки из карточек работают'], minus: ['Транзакции медленнее и капризнее, чем в SQL: +15 мс к брони', 'Для строгих связей и денег SQL всё равно проще'] } },
      dynamo: { name: 'DynamoDB', icon: '⚡️', cat: 'db', extra: true, group: 'NoSQL',
        fit: { use: 'Ключ-значение с заранее известными запросами и скачущей нагрузкой, без своей команды DBA.', avoid: 'Произвольные запросы и аналитика, нельзя привязываться к AWS.', limits: 'Элемент до 400 КБ, горячий ключ упирается в ~1000 записей/с на раздел, транзакция до 100 элементов.' }, pos: [1070, 60], cap: 40000, lat: 5, cost: 500, cx: 1.5, maxRep: 50, db: true, repLabel: 'разд.', acid: 'cond', links: [['reservation', 'self']], drop: [['reservation', 'resDB'], ['reservation', 'nosql'], ['reservation', 'mongo']], tag: 'Key-value, управляемая AWS',
        learn: { what: 'Управляемая key-value БД от AWS: масштабируется сама, платишь за запросы. При добавлении брони сразу пойдут в неё.', plus: ['Условная запись (ConditionExpression: total_reserved < лимит) сама не даёт продать лишнее', 'Масштаб и отказоустойчивость без своей команды DBA'], minus: ['Нет SQL-запросов и JOIN: запросы надо продумать заранее под ключи', 'Привязка к AWS, дорого на больших объёмах'] } },
      rabbit: { name: 'RabbitMQ', icon: '🐇', cat: 'async', extra: true, group: 'Очереди и брокеры', pos: [1070, 240], cap: 8000, lat: 3, cost: 250, cx: 2, tune: 'rabbit', repLabel: 'очеред.',
        links: [['reservation', 'self'], ['self', 'notification']], bring: ['notification'], drop: [['reservation', 'notification']], tag: 'Брокер: exchange → очереди',
        learn: { what: 'Брокер сообщений. Reservation Service публикует в exchange, тот по ключу маршрутизации раскладывает сообщения по очередям, потребители забирают их и подтверждают (ack). После ack сообщение удаляется.', plus: ['Письмо уходит асинхронно и не тормозит бронь', 'Потребители конкурируют за очередь: их можно добавлять сколько угодно', 'Гибкая маршрутизация: direct, topic, fanout'], minus: ['Нет журнала: после ack сообщение удалено, перечитать историю или сделать CDC в кэш нельзя', 'Порядок теряется, когда очередь читают несколько потребителей'] },
        fit: { use: 'Задачи и команды: письма, фоновые задания, RPC, маршрутизация по ключам, приоритеты и отложенная доставка.', avoid: 'Нужен журнал событий: перечитать историю, несколько независимых подписчиков, CDC, аналитика.', limits: 'Одна очередь живёт на одном узле и ядре (~10–20 тыс. сообщений/с), quorum примерно вдвое медленнее, длинная очередь давит на память брокера.' } },
      memcached: { name: 'Memcached', icon: '🧊', cat: 'cache', extra: true, group: 'Кэширование', pos: [685, 170], cap: 80000, lat: 1, cost: 150, cx: 1, maxRep: 6, cache: true, multi: true, at: 'db', absorb: { view: 0.9, search: 0.85 },
        links: [[['hotel', 'reservation'], 'self']], tag: 'Простой кэш ключ → значение',
        learn: { what: 'Кэш в памяти: строки по ключу, многопоточный. Ставится вместо Redis перед БД.', plus: ['Многопоточный: одна машина держит больше запросов, чем Redis', 'Проще и дешевле'], minus: ['Нет репликации и записи на диск: после рестарта кэш пустой, и вся нагрузка разом падает на БД', 'Нет структур данных, блокировок и pub/sub'] },
        fit: { use: 'Горячие чтения простых объектов (страница отеля, цены) на больших QPS.', avoid: 'Нужны структуры (списки, счётчики), блокировки, pub/sub или кэш должен пережить рестарт.', limits: 'Значение до 1 МБ, нет репликации и персистентности, вытеснение LRU.' } },
      pgcache: { name: 'PostgreSQL как кэш', icon: '🐘', cat: 'cache', extra: true, group: 'Кэширование', pos: [685, 170], cap: 6000, lat: 4, cost: 200, cx: 0.5, maxRep: 4, cache: true, multi: true, at: 'db', absorb: { view: 0.85, search: 0.7 },
        links: [[['hotel', 'reservation'], 'self']], tag: 'UNLOGGED-таблица или materialized view',
        learn: { what: 'Готовые ответы лежат в отдельной таблице PostgreSQL: UNLOGGED-таблица «ключ → JSON» или materialized view, которую обновляют по расписанию. Новой технологии нет.', plus: ['Та же БД, что команда уже умеет: бэкапы, мониторинг, SQL', 'Можно кэшировать результат JOIN и фильтровать его SQL-запросом'], minus: ['В несколько раз медленнее Redis: диск, WAL, соединения', 'Частые перезаписи раздувают таблицу, нужен VACUUM', 'Соединений сотни, а не десятки тысяч'] },
        fit: { use: 'PostgreSQL уже есть, нагрузка умеренная (тысячи rps), кэшу нужны SQL-запросы или он должен пережить рестарт, а ещё одну систему заводить не хочется.', avoid: 'Десятки тысяч чтений в секунду, нужна задержка меньше миллисекунды, одни и те же ключи перезаписываются постоянно.', limits: 'Около 5–10 тыс. простых чтений/с на инстанс, UNLOGGED-таблица очищается после сбоя, materialized view отстаёт до следующего REFRESH.' } },
    },

    flows: [
      { id: 'view', label: 'Просмотр отеля', color: 'var(--f1)', rate: (d) => d.view * d.k, chain: ['client', 'gateway', 'hotel', 'hotelDB'] },
      { id: 'search', label: 'Доступность на даты', color: 'var(--f2)', rate: (d) => d.page * d.k, chain: ['client', 'gateway', 'reservation', ['resDB', 'nosql', 'mongo', 'dynamo']] },
      { id: 'book', label: 'Бронирование', color: 'var(--f3)', write: true, rate: (d) => d.tps * d.k, chain: ['client', 'gateway', 'reservation', ['resDB', 'nosql', 'mongo', 'dynamo']] },
      { id: 'pay', label: 'Оплата', color: 'var(--f4)', write: true, rate: (d) => d.tps * d.k, chain: ['client', 'gateway', 'reservation', 'payment', ['payDB', 'resDB']] },
      { id: 'events', label: 'События брони', color: 'var(--f5)', optional: true, rate: (d) => d.tps * d.k, chain: ['reservation', ['kafka', 'rabbit'], 'notification'] },
      { id: 'notifySync', label: 'Письмо синхронно', color: 'var(--f5)', optional: true, rate: (d) => d.tps * d.k, chain: ['reservation', 'notification'] },
      { id: 'lock', label: 'Захват блокировки', color: 'var(--f3)', optional: true, rate: (d) => d.tps * d.k, chain: ['reservation', 'lock'] },
      { id: 'cdc', label: 'CDC в кэш', color: 'var(--f6)', optional: true, rate: (d) => d.tps * d.k * 2, chain: ['resDB', 'kafka', 'cache'] },
    ],

    derive: (i, deep) => {
      const p = (deep && deep.params) || {};
      const growth = p.growth || 1, flash = p.flash || 1;
      const B = (i.rooms * (i.occ / 100)) / i.stay * growth;
      const tps = B / 86400, page = tps / (i.conv / 100), view = page / (i.conv / 100);
      return { B, tps, page, view, k: flash, flash, growth, invRows: (i.rooms * growth / 200) * 20 * 730 };
    },

    reference: {
      base: {
        nodes: ['client', 'gateway', 'hotel', 'reservation', 'payment', 'hotelDB', 'resDB', 'payDB'],
        edges: [['client', 'gateway'], ['gateway', 'hotel'], ['gateway', 'reservation'], ['hotel', 'hotelDB'], ['reservation', 'resDB'], ['reservation', 'payment'], ['payment', 'payDB']],
        adapt: ADAPT,
      },
      deep: {
        nodes: ['client', 'gateway', 'hotel', 'reservation', 'payment', 'hotelDB', 'resDB', 'payDB', 'cache', ['cache', 'cacheR', [685, 290]]],
        edges: [['client', 'gateway'], ['gateway', 'hotel'], ['gateway', 'reservation'], ['hotel', 'cache'], ['hotel', 'hotelDB'], ['reservation', 'cacheR'], ['reservation', 'resDB'], ['reservation', 'payment'], ['payment', 'payDB']],
        cfg: { resDB: { shards: 4, shardKey: 'hotel' }, hotelDB: { replicas: 3 } },
        adapt: ADAPT,
      },
    },

    problems: [
      { id: 'dup', icon: '🖱️', title: 'Двойной клик «Забронировать»', key: 'idem',
        problem: 'Пользователь нажал кнопку дважды или клиент повторил запрос после таймаута. Без защиты получаются две брони и два списания.',
        params: [{ id: 'dup', label: 'Повторных запросов', unit: '%', min: 0, max: 10, step: 0.5, value: 3 }],
        options: [
          { v: 'none', label: 'Ничего не делать', note: 'Каждый повтор становится новой бронью.' },
          { v: 'button', label: 'Блокировать кнопку на клиенте', note: 'Помогает от двойного клика, но не от ретрая после таймаута сети. Это UX, а не гарантия.' },
          { v: 'key', label: 'reservation_id как уникальный ключ', note: 'id создаётся при открытии страницы брони и становится первичным ключом. Повторный INSERT падает по unique constraint, клиент может ретраить без риска.' },
        ],
        say: 'ID брони создаём заранее и делаем его уникальным ключом, поэтому повтор запроса не создаст дубль.' },
      { id: 'race', icon: '🏁', title: 'Двое бронируют последний номер', key: 'lock',
        problem: 'Оба прочитали «99 из 100 занято», оба решили, что место есть, оба записали. Итог: 101.',
        params: [{ id: 'conflict', label: 'Броней, которые конкурируют за один номер', unit: '%', min: 0, max: 30, step: 1, value: 2 }],
        options: [
          { v: 'none', label: 'Без защиты', note: 'Гонка «прочитал, проверил, записал» иногда продаёт номер сверх лимита.' },
          { v: 'pess', label: 'Пессимистичная блокировка', note: 'SELECT … FOR UPDATE: второй ждёт, пока первый закончит. Надёжно, но ожидание растёт с конкурентностью и бывают deadlock’и. Хороша при частых конфликтах.' },
          { v: 'opt', label: 'Оптимистичная блокировка', note: 'В строке есть version. UPDATE … WHERE version = X, при конфликте повтор. Быстро, пока конфликтов мало (наш обычный случай), но при частых конфликтах растут повторы.' },
          { v: 'constraint', label: 'Ограничение в БД', note: 'CHECK (total_reserved <= total_inventory * 1.1): БД сама не даст нарушить правило. Просто, но логика живёт в БД, а конфликт это ошибка для пользователя.' },
        ],
        say: 'Конфликтов мало, поэтому оптимистичная блокировка или constraint в БД подходят лучше, чем дорогие блокировки.' },
      { id: 'scale', icon: '📈', title: 'Распродажа и рост', settings: 'resDB',
        problem: 'В распродажу трафик вырастает в десятки раз, а бизнес растёт. Одна БД становится узким местом и единой точкой отказа.',
        hint: 'Пик распродажи и рост бизнеса задаются в сценарии над картой (те же, что на шаге оценки). Чтения снимает кэш (по одному на Hotel и Reservation Service) или реплики, запись масштабируют шарды. Шарды, реплики и ключ шардирования настраиваются в самом блоке Reservation DB.',
        say: 'Кэш для скорости чтения, а решающая проверка всегда в БД. Шардируем по отелю, чтобы бронь не стала распределённой транзакцией.' },
      { id: 'tx', icon: '🔗', title: 'Бронь и оплата в разных БД', key: 'txn',
        problem: 'Оплата прошла, а запись брони упала (или наоборот). Одной ACID-транзакции на две БД нет.',
        options: [
          { v: 'none', label: 'Надеяться на лучшее', note: 'Часть операций остаётся наполовину выполненной.' },
          { v: '2pc', label: '2PC', note: 'Строгая согласованность, но протокол блокирующий: медленно, а координатор становится слабым местом.' },
          { v: 'tcc', label: 'TC/C (Try-Confirm/Cancel)', note: 'Сначала резервируем (Try), потом подтверждаем или отменяем. Каждый шаг отдельная локальная транзакция.' },
          { v: 'saga', label: 'Saga', note: 'Цепочка локальных транзакций, при ошибке запускаются компенсации (например, возврат денег). Согласованность «в итоге».' },
        ],
        say: 'Саги или TC/C, потому что 2PC слишком тяжёлый. Все шаги идемпотентны.' },
    ],

    metrics: [
      { id: 'dup', label: 'Дубли броней', bad: true },
      { id: 'oversell', label: 'Перепродажи сверх 10%', bad: true },
      { id: 'incons', label: 'Рассинхрон брони и оплаты', bad: true },
      { id: 'retries', label: 'Повторы и отказы' },
      { id: 'stale', label: 'Ложные «есть места»' },
    ],

    model(ctx) {
      const { d, deep, nodes, flows, stage } = ctx, c = deep.choices, p = deep.params, B = d.B;
      const all = Object.values(nodes), of = (t) => all.filter((n) => n.type === t);
      const badge = (t, icon, title) => of(t).forEach((n) => n.badges.push({ icon, title }));
      const book = flows.find((f) => f.id === 'book'), pay = flows.find((f) => f.id === 'pay');
      const M = ctx.metrics;
      M.dup = M.oversell = M.incons = M.retries = M.stale = 0;
      const ok = (id) => flows.find((f) => f.id === id).ok;
      const linked = (a, b) => ctx.graph.edges.some((e) => nodes[e.from] && nodes[e.to] && nodes[e.from].type === a && nodes[e.to].type === b);
      const bookDb = book.ok && nodes[book.path[book.path.length - 1].id];
      const store = (bookDb && bookDb.def.acid) || 'sql', acid = store !== 'none', dbT = bookDb ? bookDb.type : 'resDB';
      const rdb = of('resDB')[0], rc = rdb && rdb.cfg, ev = flows.find((f) => f.id === 'events'), broker = ev.ok && nodes[ev.path[1].id];

      // Необязательные блоки: работают на обоих шагах
      if (ok('notifySync')) {
        book.extraLat += 120;
        ctx.warn('warn', 'Письмо отправляется синхронно: бронь ждёт почтовый сервис (+120 мс) и падает вместе с ним. Отправляй через Kafka.');
      }
      if (broker && broker.type === 'kafka') ctx.warn('info', 'Бронь публикует событие в Kafka: письмо уходит асинхронно и не тормозит бронь.');
      if (broker && broker.type === 'rabbit') {
        ctx.warn('info', 'Бронь публикует сообщение в RabbitMQ: exchange → очередь → Notification Service, письмо не тормозит бронь. Но после ack сообщение удаляется: перечитать историю или сделать CDC в кэш не выйдет, для этого нужна Kafka.');
        if (broker.cfg.qtype === 'classic') ctx.warn('warn', 'Classic-очередь RabbitMQ не реплицируется: падение узла потеряет письма. Quorum надёжнее, но медленнее.');
      }
      if (of('kafka').length && !(broker && broker.type === 'kafka') && !ok('cdc')) ctx.warn('info', 'У Kafka нет потребителей: подключи Kafka → Notification Service или Kafka → кэш инвентаря (CDC).');
      if (of('rabbit').length && !(broker && broker.type === 'rabbit')) ctx.warn('info', 'У RabbitMQ нет потребителей: подключи RabbitMQ → Notification Service.');
      if (!acid) ctx.warn(stage === 'deep' ? 'bad' : 'warn', 'Брони пишутся в Cassandra: запись масштабируется легко, но нет ACID-транзакций. Блокировки и CHECK не работают, двойные брони вернутся.');
      if (store === 'txn') { book.extraLat += 15; ctx.cx += 1; ctx.warn('info', 'Брони в MongoDB: транзакции на несколько документов есть, блокировки работают, но бронь медленнее (+15 мс), чем в SQL.'); }
      if (store === 'cond') ctx.warn('info', 'Брони в DynamoDB: условная запись «total_reserved < лимит» сама защищает от перепродаж, но запросы придётся строить вокруг ключей.');

      // Настройки Reservation DB: репликация, шардирование, партиционирование
      if (rc && rc.replicas > 0) {
        if (rc.sync === 'sync') { book.extraLat += 10; pay.extraLat += 10; }
        else ctx.warn('info', 'Асинхронные реплики Reservation DB могут отставать и показать «есть места», которых уже нет. Бронь всё равно проверяется на primary.');
      }
      if (rc && rc.shards > 1 && rc.shardKey === 'date') {
        ctx.cx += 2; book.extraLat += 40;
        ctx.warn('warn', 'Шардирование по дате: бронь на несколько ночей попадает в разные шарды, и простая транзакция стала распределённой.');
      }
      if (rc && rc.partition === 'date') ctx.warn('info', 'room_type_inventory разбита на партиции по дате: запросы читают только нужные дни, прошедшие даты легко архивировать.');

      // Надёжность Kafka (сколько потребителей можно, считает движок)
      if (broker && broker.type === 'kafka') {
        const kc = broker.cfg;
        if (kc.rf === 1) ctx.warn('warn', 'Kafka с RF=1: если брокер упадёт, события пропадут и письма не уйдут.');
        else if (kc.acks === '1') ctx.warn('info', 'acks=1: подтверждает только лидер. Если он упадёт до репликации, событие потеряется.');
      }
      if (linked('reservation', 'lock')) book.extraLat += 3;
      if (stage !== 'deep') {
        if (flows.find((f) => f.id === 'search').cached && !ok('cdc')) ctx.warn('info', 'Кэш инвентаря обновляется по TTL и может отставать. С Kafka и CDC (Reservation DB → Kafka → кэш) он почти не отстаёт.');
        return;
      }

      // 1. Повторные запросы
      M.dup = c.idem === 'key' ? 0 : (B * p.dup) / 100 * (c.idem === 'button' ? 0.3 : 1);
      if (c.idem === 'button') { ctx.cx += 0.3; badge('client', '🖱️', 'Кнопка блокируется после клика'); }
      if (c.idem === 'key') { ctx.cx += 1; badge('reservation', '🔑', 'Идемпотентность: reservation_id'); }

      // 2. Гонка за последний номер
      const k = p.conflict / 100;
      if (c.lock === 'none' || !acid) M.oversell = B * k * 0.5;
      if (store === 'cond') { M.oversell = 0; M.retries = B * k; badge(dbT, '✅', 'Условная запись'); }
      else if (!acid) { /* Cassandra: блокировки БД недоступны */ } else if (c.lock === 'pess') {
        ctx.cx += 1.5; book.extraLat += 20 + 300 * k; badge(dbT, '🔒', 'SELECT … FOR UPDATE');
        if (k > 0.1) ctx.warn('warn', 'Много конкурентных броней: транзакции ждут друг друга, растёт риск deadlock’ов. Держи транзакции короткими.');
      }
      if (store !== 'cond' && acid && c.lock === 'opt') {
        ctx.cx += 1.5; M.retries = (B * k) / (1 - k); book.extraLat += (150 * k) / (1 - k); badge(dbT, '🔢', 'Оптимистичная блокировка (version)');
        of(dbT).forEach((n) => { n.load += (book.rate * k) / (1 - k); n.wload += (book.rate * k) / (1 - k); });
        if (k > 0.15) ctx.warn('warn', `Конфликтов ${p.conflict}%: оптимистичная блокировка тонет в повторах. При частых конфликтах лучше пессимистичная.`);
      }
      if (store !== 'cond' && acid && c.lock === 'constraint') { ctx.cx += 1; M.retries = B * k; badge(dbT, '✅', 'CHECK constraint'); }

      if (linked('reservation', 'lock')) {
        if (M.oversell > 0) { M.oversell *= 0.1; ctx.warn('info', 'Redis-блокировка убрала почти все гонки, но не все: lock с TTL может истечь посреди операции, а Redis может упасть.'); }
        else ctx.warn('info', 'Redis-блокировка поверх защиты в БД ничего не добавляет: только задержка и ещё одна точка отказа.');
      }
      if (flows.find((f) => f.id === 'search').cached) M.stale = B * (ok('cdc') ? 0.001 : 0.03);
      if (rc && rc.replicas > 0 && rc.sync === 'async') M.stale += B * 0.005;

      // 4. Бронь и оплата
      const last = pay.ok && nodes[pay.path[pay.path.length - 1].id];
      if (last && last.type === 'payDB') {
        if (c.txn === 'none') M.incons = B * 0.002;
        if (c.txn === '2pc') { ctx.cx += 4; book.extraLat += 80; pay.extraLat += 80; ctx.warn('info', '2PC держит блокировки до решения координатора. Если он упал, участники ждут.'); }
        if (c.txn === 'tcc') { ctx.cx += 3; book.extraLat += 25; pay.extraLat += 25; }
        if (c.txn === 'saga') { ctx.cx += of('kafka').length ? 2 : 3; pay.extraLat += 10; }
        if (c.txn !== 'none') badge('payment', c.txn === 'saga' ? '↩️' : '🤝', this.problems[3].options.find((o) => o.v === c.txn).label);
      } else if (last && last.type === 'resDB') {
        ctx.warn('info', 'Payment Service пишет в Reservation DB: одна общая БД даёт ACID-транзакцию на бронь и оплату. Прагматично, но сервисы связаны через схему.');
      }
    },

    // Почему стрелку провести нельзя (для частых ошибок; остальное объясняет общий текст).
    linkWhy(a, b) {
      const B = this.blocks;
      if (a === 'client' && B[b].db) return 'Клиент не ходит в базу напрямую: данные отдают только сервисы, иначе нет ни проверки прав, ни масштабирования.';
      if (a === 'client') return 'Все запросы клиента идут через API Gateway: там авторизация, лимиты и маршрутизация.';
      if (B[a].db) return 'База отвечает на запросы, но сама никого не вызывает.';
      if (a === 'hotel' && b === 'resDB') return 'У каждого сервиса своя база: Hotel Service спрашивает брони у Reservation Service.';
      return '';
    },

    rules(ctx) {
      const { graph, nodes, metrics: M, stage, d, flows } = ctx;
      graph.edges.forEach((e) => {
        const a = nodes[e.from], b = nodes[e.to];
        if (!a || !b) return;
        if (a.type === 'client' && b.def.db) ctx.warn('bad', `Клиент ходит в «${b.def.name}» напрямую. Доступ к данным только через сервисы.`);
        if (a.type === 'client' && b.type !== 'gateway' && !b.def.db && !b.def.absorb) ctx.warn('warn', `Клиент ходит в «${b.def.name}» в обход API Gateway.`);
        if (a.type === 'hotel' && b.type === 'resDB') ctx.warn('info', 'Hotel Service лезет в Reservation DB. У каждого сервиса своя БД, иначе сервисы связаны через схему.');
      });
      if (flows.find((f) => f.id === 'search').cached) ctx.warn('info', 'Кэш инвентаря только для показа доступности: он может отставать. Бронь всё равно проверяется в БД. Синхронизировать кэш удобно через CDC.');
      if (M.dup > 0) ctx.warn('bad', `Около ${Math.round(M.dup)} дублей броней в день: повтор запроса создаёт новую бронь.`);
      if (M.oversell > 0) ctx.warn('bad', `Около ${Math.round(M.oversell)} перепродаж в день: гонка «прочитал, проверил, записал».`);
      if (M.stale > 1) ctx.warn('warn', `Около ${Math.round(M.stale)} раз в день кэш или реплика показывают свободный номер, которого уже нет: бронь получит отказ.`);
      if (M.incons > 0) ctx.warn('bad', `Около ${Math.round(M.incons)} операций в день, где оплата и бронь разошлись.`);
      if (stage === 'base' && flows.every((f) => f.ok || f.optional) && Object.values(nodes).every((n) => n.rep === 1)) {
        ctx.warn('info', `Как и показала оценка: всего ${d.tps.toFixed(1)} броней в секунду, и каждый блок справляется в одном экземпляре. Сложность впереди, в конкурентности.`);
      }
    },

    goals: {
      base: [
        { text: 'Все четыре потока доходят до данных', check: (r) => r.m.routed },
        { text: 'Клиент ходит только через API Gateway', check: (r) => !r.graph.edges.some((e) => r.nodes[e.from] && r.nodes[e.from].type === 'client' && r.nodes[e.to] && r.nodes[e.to].type !== 'gateway' && !r.nodes[e.to].def.absorb) },
        { text: 'Нагрузка выдерживается', check: (r) => r.m.served >= 1 && r.m.maxU <= 0.9 },
        { text: 'У Payment Service своя БД', check: (r) => { const f = r.flows.find((x) => x.id === 'pay'); return f.ok && r.nodes[f.path[f.path.length - 1].id].type === 'payDB'; } },
      ],
      deep: [
        { text: 'Ни одного дубля брони', check: (r) => r.m.routed && r.m.dup === 0 },
        { text: 'Ни одной перепродажи', check: (r) => r.m.routed && r.m.oversell === 0 },
        { text: 'Оплата и бронь согласованы', check: (r) => r.m.routed && r.m.incons === 0 },
        { text: 'Выдерживаем распродажу ×50 при росте ×10', check: (r) => r.d.flash >= 50 && r.d.growth >= 10 && r.m.served >= 1 && r.m.maxU <= 0.9 },
        { text: 'Бронь быстрее 400 мс', check: (r) => r.m.routed && r.flows.find((f) => f.id === 'book').lat <= 400 },
      ],
    },

    summary: {
      script: [
        'Уточняю требования: просмотр, бронь, отмена, админка, овербукинг 10%. Главное нефункциональное: нет двойных броней.',
        'Оцениваю нагрузку: около 3 броней в секунду и воронка 300 / 30 / 3 QPS. Вывод: одна реляционная БД, сложность в конкурентности.',
        'API и данные: reservationId в теле POST, инвентарь по типу номера и дате в room_type_inventory.',
        'Высокоуровневый дизайн: Gateway, Hotel, Reservation и Payment сервисы, у каждого своя БД.',
        'Двойной клик закрываю идемпотентностью, гонку за номер оптимистичной блокировкой или constraint.',
        'Рост: кэш инвентаря только для показа, проверка в БД, шардирование по hotel_id.',
        'Бронь и оплата в разных БД: Saga или TC/C вместо 2PC.',
      ],
      questions: [
        { q: 'Почему здесь не нужно шардировать ради нагрузки?', a: 'Запись около 3 TPS, чтение умеренное. Шардирование нужно для отказоустойчивости и роста.' },
        { q: 'Как защититься от двойного клика?', a: 'reservation_id создаётся заранее и является уникальным ключом, повторный INSERT упадёт.' },
        { q: 'Оптимистичная или пессимистичная блокировка?', a: 'Пессимистичная блокирует строку заранее и подходит при частых конфликтах. Оптимистичная проверяет версию при записи и подходит при редких, как у нас.' },
        { q: 'Почему проверку доступности при брони нельзя делать по кэшу?', a: 'Кэш может отставать, и это приведёт к перепродаже. Решающая проверка в БД.' },
        { q: 'Почему шардируем по hotel_id, а не по дате?', a: 'Бронь привязана к одному отелю, поэтому транзакция остаётся в одном шарде.' },
        { q: 'Зачем Saga или TC/C вместо 2PC?', a: '2PC медленный и зависит от координатора. Saga и TC/C легче, но требуют идемпотентности и компенсаций.' },
      ],
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
