(function (g) {
  (g.SIM_SCENARIOS = g.SIM_SCENARIOS || []).push({
    id: 'ch4', n: 4, title: 'Distributed Message Queue', subtitle: 'Очередь уровня Kafka',
    intro: 'Строим очередь сообщений с нуля. Начинаем с «очереди поверх обычной БД» и по шагам приходим к партициям, WAL, репликации и consumer groups. Каждый шаг решает конкретную проблему и создаёт новую.',
    flows: [{ id: 'produce', label: 'Запись (producer → broker)' }, { id: 'consume', label: 'Чтение (consumers)' }],
    inputs: [
      { id: 'rate', label: 'Поток сообщений', unit: 'тыс/с', min: 1, max: 3000, step: 1, value: 100 },
      { id: 'size', label: 'Размер сообщения', unit: 'КБ', min: 0.1, max: 50, step: 0.1, value: 1 },
      { id: 'groups', label: 'Consumer groups', unit: '', min: 1, max: 10, step: 1, value: 3 },
      { id: 'ret', label: 'Хранение', unit: 'дней', min: 1, max: 30, step: 1, value: 14 },
    ],
    baseQuality: 25, qualityLabel: 'Надёжность доставки', qualityHint: 'Не потеряем ли данные при падении брокера и как гарантируем доставку/порядок.',
    derive: (i) => { const inMsg = i.rate * 1000; return { inMsg, outMsg: inMsg * i.groups, tb: (inMsg * i.size * 1024 * 86400 * i.ret) / 1e12 }; },
    load: (d) => ({ broker: d.inMsg, disk: d.tb, cons: d.outMsg }),
    stages: [
      { id: 'broker', name: 'Очередь поверх MySQL', icon: '🧱', unit: 'msg/s', cap: 1500, lat: 15, avail: 0.995, cost: 400, flow: 'produce', note: 'Наивно: INSERT на запись и SELECT … FOR UPDATE на чтение' },
      { id: 'disk', name: 'Диски (хранение)', icon: '💾', unit: 'ТБ', cap: 8, lat: 0, avail: 0.9995, cost: 200, flow: 'produce', path: false, follow: 'broker', scalable: true, redundant: false },
      { id: 'cons', name: 'Consumers', icon: '📥', unit: 'msg/s', cap: 20000, lat: 12, avail: 0.995, cost: 250, flow: 'consume' },
    ],
    components: [
      { id: 'wal', group: 'storage', name: 'Лог на диске (WAL, append-only)', icon: '📜', at: 'broker', cx: 2, q: 10,
        apply: (s) => { const x = s.stages.broker; x.name = 'Брокеры (append-only лог)'; x.cap = 40000; x.lat = 3; x.note = 'Последовательная запись сегментов на диск'; x.effReplicas = 1; s.stages.cons.effReplicas = 1; },
        learn: { what: 'Сообщения только дописываются в конец файла-лога (сегментами), читаются последовательно по offset.',
          why: 'Последовательный доступ к диску на порядок быстрее случайного, ОС кэширует страницы. Поэтому лог на диске может быть быстрее «умной» БД.',
          must: ['Данные не удаляются сразу, а живут по retention.', 'Сегменты старше retention удаляют целиком, а не построчно.'], risks: ['Нет сложных запросов: читать можно только по offset.'] } },
      { id: 'partitions', name: 'Топики и партиции', icon: '🧩', at: 'broker', cx: 2, q: 5, requires: ['wal'],
        apply: (s) => { s.partitions = s.stages.broker.replicas * 4; s.stages.broker.effReplicas = s.stages.broker.replicas; },
        learn: { what: 'Топик делится на партиции, каждая лежит на своём брокере. Порядок гарантирован только внутри одной партиции.',
          why: 'Одна партиция = один лог = одна машина. Чтобы масштабировать запись и параллелить чтение, нужно много партиций.',
          must: ['Сообщения с одним ключом идут в одну партицию, так сохраняется порядок.', 'В одной consumer group партицию читает ровно один consumer, значит consumers ≤ партиций.', 'Партиции легко добавить, но уменьшить трудно, и ключи перераспределятся.'], risks: ['Порядок только внутри партиции; неравномерные ключи создают «горячие» партиции.'] } },
      { id: 'batch', name: 'Батчинг (producer, broker, consumer)', icon: '📦', at: 'broker', cx: 1, q: 0, requires: ['wal'],
        apply: (s) => { s.stages.broker.capMult *= 5; s.stages.broker.lat += 8; s.stages.cons.capMult *= 2; },
        learn: { what: 'Сообщения копятся в пачки и отправляются/пишутся/читаются вместе.', why: 'Накладные расходы на сетевой вызов и дисковую операцию размазываются на много сообщений.',
          must: ['Это ручка «пропускная способность против задержки»: чем больше пачка и linger, тем выше throughput и выше latency.'], risks: ['Задержка растёт, и при падении клиента теряется буфер.'] } },
      { id: 'zerocopy', name: 'Zero-copy чтение', icon: '🚀', at: 'cons', cx: 1, q: 0, requires: ['wal'],
        apply: (s) => { s.stages.cons.capMult *= 2.5; s.stages.cons.lat -= 3; },
        learn: { what: 'Данные из страницы кэша ОС идут прямо в сетевой сокет без копирования в память приложения.', why: 'Ещё больше пропускной способности чтения почти бесплатно.', must: ['Работает, если данные не нужно преобразовывать на лету.'], risks: [] } },
      { id: 'repl', name: 'Репликация (leader/follower, ISR)', icon: '🧬', at: 'broker', cx: 3, q: 40, requires: ['wal'],
        apply: (s) => { const x = s.stages.broker; x.capMult *= 0.65; x.lat += 6; x.avail = 0.99999; x.redundant = false; s.stages.disk.load *= 3; s.stages.disk.avail = 0.99999; },
        learn: { what: 'Каждая партиция имеет лидера и фолловеров на других брокерах (обычно 3 копии). ISR — набор реплик, успевающих за лидером.',
          why: 'Падение брокера не должно терять данные и останавливать топик.',
          must: ['Диски нужны ×3, а запись замедляется (ждём репликацию).', 'Если лидер упал, новым лидером становится реплика из ISR.', 'Настройка acks определяет, сколько реплик должны подтвердить запись.'], risks: ['Диск ×3, больше сетевого трафика, split-brain, если неверно настроить кворум.'] } },
      { id: 'acks', name: 'acks=all (подтверждают все ISR)', icon: '✅', at: 'broker', cx: 0.5, q: 15, requires: ['repl'],
        apply: (s) => { s.stages.broker.lat += 4; },
        learn: { what: 'Producer получает ack только когда запись есть у всех синхронных реплик.', why: 'Подтверждённое сообщение гарантированно переживёт падение лидера.',
          must: ['Это выбор между надёжностью и задержкой: acks=0 / 1 / all.'], risks: ['Задержка записи выше.'] } },
      { id: 'coord', name: 'Координатор consumer group (rebalance)', icon: '🧭', at: 'cons', cx: 2, q: 10, requires: ['partitions'],
        apply: (s) => { s.stages.cons.effReplicas = Math.min(s.stages.cons.replicas, Math.max(1, s.partitions || 1)); },
        learn: { what: 'Координатор следит за consumers (heartbeat) и распределяет партиции между ними. Offset хранится в системе.', why: 'Consumers приходят и уходят, партиции нужно перераспределять без дублей и пропусков.',
          must: ['Rebalance временно приостанавливает чтение.', 'Offset commit определяет семантику: at-least-once, at-most-once, exactly-once.'], risks: ['Частые rebalance — головная боль.'] } },
      { id: 'tiered', name: 'Tiered storage (старые сегменты в S3)', icon: '🧊', at: 'disk', cx: 2, cost: 800,
        apply: (s) => { s.stages.disk.load *= 0.3; },
        learn: { what: 'Горячие данные на дисках брокеров, старые сегменты переезжают в объектное хранилище.', why: 'Длинный retention не заставляет покупать диски под каждый байт.', must: ['Чтение старых данных медленнее.'], risks: ['Ещё одна система хранения.'] } },
    ],
    rules: (s, d, st, m, warn) => {
      if (!st.active.wal) warn('info', 'Очередь на MySQL упирается в блокировки и случайные записи. Сравни с append-only логом.');
      if (st.active.wal && !st.active.partitions) warn('warn', 'Без партиций брокеры не масштабируются: пишет только один, и читает только один consumer.');
      if (st.active.partitions && !st.active.coord && s.stages.cons.replicas > 1) warn('warn', 'Несколько consumers без координатора: нет распределения партиций, будут дубликаты или простой.');
      if (st.active.partitions && st.active.coord && s.stages.cons.replicas > (s.partitions || 1)) warn('warn', `Consumers (${s.stages.cons.replicas}) больше партиций (${s.partitions}): лишние простаивают.`);
      if (st.active.wal && !st.active.coord && s.stages.cons.util > 1) warn('warn', 'Consumers упёрлись в один экземпляр: чтобы читать параллельно, нужны партиции и координатор группы (он раздаёт партиции).');
      if (st.active.repl && s.stages.broker.replicas < 3) warn('warn', 'Репликация ×3 требует минимум 3 брокера для отказоустойчивости.');
      if (st.active.batch) warn('info', 'Батчинг даёт throughput, но добавляет задержку и риск потерять буфер при падении клиента.');
    },
    goals: [
      { text: 'Выдерживаем 100% нагрузки', check: (m) => m.served >= 1 && m.maxU <= 0.9 },
      { text: 'Задержка записи до 25 мс', check: (m) => m.lat.produce <= 25 },
      { text: 'Надёжность ≥ 75', check: (m) => m.quality >= 75 },
      { text: 'Сложность не выше 14 из 20', check: (m) => m.cx <= 14 },
    ],
    tryThis: ['Сначала включи лог на диске и посмотри, кто станет узким местом.', 'Добавь партиции и увеличь число consumers: что ограничивает?', 'Включи репликацию: как изменились диски, задержка и надёжность?', 'Добавь батчинг и сравни throughput с latency.'],
  });
})(typeof window !== 'undefined' ? window : globalThis);
