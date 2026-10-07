/* Глава 7. Hotel Reservation System: данные для лаборатории (simulator/lab). */
(function (g) {
  g.LAB = {
    id: 'ch7', n: 7, title: 'Hotel Reservation System', subtitle: 'Бронирование отелей',
    intro: 'Система бронирования вроде Booking или Marriott. Нагрузка маленькая, поэтому сложность не в объёме, а в корректности: нельзя продать один номер дважды, когда люди жмут кнопку одновременно и по два раза.',

    steps: [
      { id: 'req', title: 'Требования', kind: 'req' },
      { id: 'est', title: 'Оценка нагрузки', kind: 'est' },
      { id: 'api', title: 'API и данные', kind: 'api' },
      { id: 'hld', title: 'Высокоуровневый дизайн', kind: 'map', stage: 'base' },
      { id: 'deep', title: 'Углубление', kind: 'map', stage: 'deep' },
      { id: 'sum', title: 'Итог', kind: 'sum' },
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
        { label: 'Броней в день', formula: 'номера × заполняемость ÷ срок', v: d.B },
        { label: 'Броней в секунду (запись)', formula: 'брони в день ÷ 86 400', v: d.tps },
        { label: 'Страница бронирования, QPS', formula: 'TPS ÷ конверсия', v: d.page },
        { label: 'Просмотр отелей, QPS', formula: 'страница брони ÷ конверсия', v: d.view },
        { label: 'Строк в room_type_inventory', formula: 'отели × 20 типов × 730 дней', v: d.invRows },
      ],
      conclusion: (d) => d.tps < 300
        ? `Запись около ${d.tps < 10 ? d.tps.toFixed(1) : Math.round(d.tps)} в секунду: это мало. Одна реляционная БД справится, шардировать ради нагрузки не нужно. Значит, вся сложность будет в конкурентности, а не в масштабе.`
        : `Запись уже около ${Math.round(d.tps)} в секунду. Одна БД ещё может справиться, но пора думать о шардировании.`,
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

    board: { w: 1060, h: 610 },

    blocks: {
      client: { name: 'Клиент', icon: '👤', pos: [20, 250], cap: 0, learn: { what: 'Браузер или приложение. Источник всех потоков.', why: 'С него начинается каждый запрос.' } },
      gateway: { name: 'API Gateway', icon: '🚪', pos: [220, 250], cap: 5000, lat: 5, cost: 150, cx: 0.5, maxRep: 200,
        learn: { what: 'Единая точка входа: маршрутизация, авторизация, rate limiting.', why: 'Клиент не знает о внутренних сервисах, а мы можем менять их за спиной.' } },
      hotel: { name: 'Hotel Service', icon: '🏨', pos: [430, 80], cap: 1000, lat: 20, cost: 120, cx: 1, maxRep: 200,
        learn: { what: 'Отдаёт отели, типы номеров и цены.', why: 'Данные почти статичные, поэтому сервис хорошо кэшируется и легко масштабируется.' } },
      reservation: { name: 'Reservation Service', icon: '📝', pos: [430, 350], cap: 500, lat: 30, cost: 150, cx: 1.5, maxRep: 200,
        learn: { what: 'Проверяет доступность, создаёт и отменяет брони, обновляет инвентарь.', why: 'Единственное место, которое меняет инвентарь, а значит, отвечает за отсутствие перепродаж.' } },
      payment: { name: 'Payment Service', icon: '💳', pos: [650, 450], cap: 300, lat: 150, cost: 150, cx: 1, maxRep: 200,
        learn: { what: 'Списание денег через платёжного провайдера.', why: 'Отдельный сервис со своей БД. Отсюда проблема согласованности брони и оплаты.' } },
      hotelDB: { name: 'Hotel DB', icon: '🗄️', pos: [860, 80], cap: 3000, lat: 10, cost: 300, cx: 1, maxRep: 5, db: true, repLabel: 'реплик',
        overload: 'Реплик чтения уже 5. Нужен кэш перед БД.',
        learn: { what: 'Реляционная БД с отелями, номерами и ценами.', why: 'Чтений много, записей мало: масштабируется репликами чтения и кэшем.' } },
      resDB: { name: 'Reservation DB', icon: '🗃️', pos: [860, 330], cap: 1500, lat: 15, cost: 400, cx: 1, maxRep: 1, db: true, repLabel: 'шард.',
        overload: 'Один primary больше не вытянет: кэш инвентаря для чтений или шардирование для записи.',
        learn: { what: 'Реляционная БД с room_type_inventory и reservation. Источник истины.', why: 'ACID-транзакции гарантируют, что инвентарь и бронь меняются вместе.' } },
      payDB: { name: 'Payment DB', icon: '🧾', pos: [860, 470], cap: 10000, lat: 15, cost: 300, cx: 1, maxRep: 4, db: true, repLabel: 'шард.',
        learn: { what: 'БД платежей у Payment Service.', why: 'Своя БД у каждого сервиса. Но тогда бронь и оплату уже не обернуть одной транзакцией.' } },
      cache: { name: 'Кэш (Redis)', icon: '⚡', pos: [650, 10], cap: 50000, lat: 1, cost: 200, cx: 1.5, maxRep: 6, cache: true,
        learn: { what: 'Хранилище в памяти. Сервис сначала смотрит в кэш и идёт в БД только при промахе (cache-aside).', why: 'Снимает с БД почти все чтения. Для брони кэш не используется: решающая проверка всегда в БД.' } },
    },

    flows: [
      { id: 'view', label: 'Просмотр отеля', color: 'var(--f1)', rate: (d) => d.view * d.k, chain: ['client', 'gateway', 'hotel', 'hotelDB'], cacheHit: 0.95 },
      { id: 'search', label: 'Доступность на даты', color: 'var(--f2)', rate: (d) => d.page * d.k, chain: ['client', 'gateway', 'reservation', 'resDB'], cacheHit: 0.9 },
      { id: 'book', label: 'Бронирование', color: 'var(--f3)', rate: (d) => d.tps * d.k, chain: ['client', 'gateway', 'reservation', 'resDB'] },
      { id: 'pay', label: 'Оплата', color: 'var(--f4)', rate: (d) => d.tps * d.k, chain: ['client', 'gateway', 'reservation', 'payment', ['payDB', 'resDB']] },
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
      },
      deep: {
        nodes: ['client', 'gateway', 'hotel', 'reservation', 'payment', 'hotelDB', 'resDB', 'payDB', 'cache', ['cache', 'cacheR', [650, 230]]],
        edges: [['client', 'gateway'], ['gateway', 'hotel'], ['gateway', 'reservation'], ['hotel', 'cache'], ['hotel', 'hotelDB'], ['reservation', 'cacheR'], ['reservation', 'resDB'], ['reservation', 'payment'], ['payment', 'payDB']],
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
      { id: 'scale', icon: '📈', title: 'Распродажа и рост', key: 'shard',
        problem: 'В распродажу трафик вырастает в десятки раз, а бизнес растёт. Одна БД становится узким местом и единой точкой отказа.',
        params: [
          { id: 'flash', label: 'Пик распродажи', unit: '×', min: 1, max: 100, step: 1, value: 1 },
          { id: 'growth', label: 'Рост бизнеса', unit: '×', min: 1, max: 20, step: 1, value: 1 },
        ],
        hint: 'Чтения снимает кэш: добавь блок «Кэш (Redis)» и стрелку к нему от сервиса. Запись масштабирует шардирование.',
        options: [
          { v: 'none', label: 'Одна Reservation DB', note: 'Пока запись маленькая, этого хватает.' },
          { v: 'hotel', label: 'Шардировать по hotel_id', note: 'Все данные отеля в одном шарде, поэтому бронь остаётся локальной транзакцией.' },
          { v: 'date', label: 'Шардировать по дате', note: 'Бронь на несколько ночей попадает в разные шарды: нужна распределённая транзакция. Ловушка.' },
        ],
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
    ],

    model(ctx) {
      const { d, deep, nodes, flows, stage } = ctx, c = deep.choices, p = deep.params, B = d.B;
      const all = Object.values(nodes), of = (t) => all.filter((n) => n.type === t);
      const badge = (t, icon, title) => of(t).forEach((n) => n.badges.push({ icon, title }));
      const book = flows.find((f) => f.id === 'book'), pay = flows.find((f) => f.id === 'pay');
      const M = ctx.metrics;
      M.dup = M.oversell = M.incons = M.retries = 0;
      if (stage !== 'deep') return;

      // 1. Повторные запросы
      M.dup = c.idem === 'key' ? 0 : (B * p.dup) / 100 * (c.idem === 'button' ? 0.3 : 1);
      if (c.idem === 'button') { ctx.cx += 0.3; badge('client', '🖱️', 'Кнопка блокируется после клика'); }
      if (c.idem === 'key') { ctx.cx += 1; badge('reservation', '🔑', 'Идемпотентность: reservation_id'); }

      // 2. Гонка за последний номер
      const k = p.conflict / 100;
      if (c.lock === 'none') M.oversell = B * k * 0.5;
      if (c.lock === 'pess') {
        ctx.cx += 1.5; book.extraLat += 20 + 300 * k; badge('resDB', '🔒', 'SELECT … FOR UPDATE');
        if (k > 0.1) ctx.warn('warn', 'Много конкурентных броней: транзакции ждут друг друга, растёт риск deadlock’ов. Держи транзакции короткими.');
      }
      if (c.lock === 'opt') {
        ctx.cx += 1.5; M.retries = (B * k) / (1 - k); book.extraLat += (150 * k) / (1 - k); badge('resDB', '🔢', 'Оптимистичная блокировка (version)');
        of('resDB').forEach((n) => (n.load += (book.rate * k) / (1 - k)));
        if (k > 0.15) ctx.warn('warn', `Конфликтов ${p.conflict}%: оптимистичная блокировка тонет в повторах. При частых конфликтах лучше пессимистичная.`);
      }
      if (c.lock === 'constraint') { ctx.cx += 1; M.retries = B * k; badge('resDB', '✅', 'CHECK constraint'); }

      // 3. Масштаб
      if (c.shard !== 'none') of('resDB').forEach((n) => (n.maxRep = 16));
      if (c.shard === 'hotel') ctx.cx += 2;
      if (c.shard === 'date') {
        ctx.cx += 3; book.extraLat += 40;
        ctx.warn('warn', 'Шардирование по дате: бронь на несколько ночей попадает в разные шарды, и простая транзакция стала распределённой.');
      }

      // 4. Бронь и оплата
      const last = pay.ok && nodes[pay.path[pay.path.length - 1].id];
      if (last && last.type === 'payDB') {
        if (c.txn === 'none') M.incons = B * 0.002;
        if (c.txn === '2pc') { ctx.cx += 4; book.extraLat += 80; pay.extraLat += 80; ctx.warn('info', '2PC держит блокировки до решения координатора. Если он упал, участники ждут.'); }
        if (c.txn === 'tcc') { ctx.cx += 3; book.extraLat += 25; pay.extraLat += 25; }
        if (c.txn === 'saga') { ctx.cx += 3; pay.extraLat += 10; }
        if (c.txn !== 'none') badge('payment', c.txn === 'saga' ? '↩️' : '🤝', this.problems[3].options.find((o) => o.v === c.txn).label);
      } else if (last && last.type === 'resDB') {
        ctx.warn('info', 'Payment Service пишет в Reservation DB: одна общая БД даёт ACID-транзакцию на бронь и оплату. Прагматично, но сервисы связаны через схему.');
      }
    },

    rules(ctx) {
      const { graph, nodes, metrics: M, stage, d, flows, m } = ctx;
      graph.edges.forEach((e) => {
        const a = nodes[e.from], b = nodes[e.to];
        if (!a || !b) return;
        if (a.type === 'client' && b.def.db) ctx.warn('bad', `Клиент ходит в «${b.def.name}» напрямую. Доступ к данным только через сервисы.`);
        if (a.type === 'client' && b.type !== 'gateway' && !b.def.db) ctx.warn('warn', `Клиент ходит в «${b.def.name}» в обход API Gateway.`);
        if (a.type === 'hotel' && b.type === 'resDB') ctx.warn('info', 'Hotel Service лезет в Reservation DB. У каждого сервиса своя БД, иначе сервисы связаны через схему.');
      });
      if (flows.find((f) => f.id === 'search').cached) ctx.warn('info', 'Кэш инвентаря только для показа доступности: он может отставать. Бронь всё равно проверяется в БД. Синхронизировать кэш удобно через CDC.');
      if (M.dup > 0) ctx.warn('bad', `Около ${Math.round(M.dup)} дублей броней в день: повтор запроса создаёт новую бронь.`);
      if (M.oversell > 0) ctx.warn('bad', `Около ${Math.round(M.oversell)} перепродаж в день: гонка «прочитал, проверил, записал».`);
      if (M.incons > 0) ctx.warn('bad', `Около ${Math.round(M.incons)} операций в день, где оплата и бронь разошлись.`);
      if (stage === 'base' && flows.every((f) => f.ok) && Object.values(nodes).every((n) => n.rep === 1)) {
        ctx.warn('info', `Как и показала оценка: всего ${d.tps.toFixed(1)} броней в секунду, и каждый блок справляется в одном экземпляре. Сложность впереди, в конкурентности.`);
      }
    },

    goals: {
      base: [
        { text: 'Все четыре потока доходят до данных', check: (r) => r.m.routed },
        { text: 'Клиент ходит только через API Gateway', check: (r) => !r.graph.edges.some((e) => r.nodes[e.from] && r.nodes[e.from].type === 'client' && r.nodes[e.to] && r.nodes[e.to].type !== 'gateway') },
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
