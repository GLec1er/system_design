# System Design: конспекты и визуализации

Личные конспекты по книге **System Design Interview, Vol. 2** (Alex Xu, Sahn Lam). Цель: через месяц или перед собеседованием быстро вспомнить, **из каких шагов складывалось решение, какую проблему закрывал каждый шаг и чем за него пришлось заплатить**.

## Как читать главу
Каждая глава строится по одному шаблону ([TEMPLATE.md](TEMPLATE.md)). Главный раздел — «Путь решения»: на каждом шаге **проблема → решение → что улучшилось → компромисс → альтернативы**. Диаграммы только иллюстрируют этот рассказ.

## 🎮 Симулятор
В [simulator/](simulator/index.html) лежат интерактивные главы по шагам, как на интервью: требования, оценка, API, схема на карте с потоками, углубление и итог. Открой `simulator/index.html` в браузере или включи GitHub Pages. Главы: [1. Proximity Service](simulator/ch1/index.html), [2. Nearby Friends](simulator/ch2/index.html), [3. Google Maps](simulator/ch3/index.html), [4. Message Queue](simulator/ch4/index.html), [5. Metrics Monitoring](simulator/ch5/index.html), [6. Ad Click Aggregation](simulator/ch6/index.html), [7. Hotel Reservation](simulator/ch7/index.html), [8. Distributed Email](simulator/ch8/index.html), [9. S3-like Object Storage](simulator/ch9/index.html), [10. Gaming Leaderboard](simulator/ch10/index.html), [11. Payment System](simulator/ch11/index.html), [12. Digital Wallet](simulator/ch12/index.html), [13. Stock Exchange](simulator/ch13/index.html). Отдельной группой идут конвейеры данных: [14. Batch Data Lake](simulator/ch14/index.html), [15. Streaming Pipeline](simulator/ch15/index.html), [16. CDC и Lakehouse](simulator/ch16/index.html). И системы вокруг моделей ИИ: [17. LLM Inference Service](simulator/ch17/index.html), [18. Recommendation Feed](simulator/ch18/index.html), [19. RAG Assistant](simulator/ch19/index.html). Классические задачи интервью: [20. Key-Value Store](simulator/ch20/index.html), [21. Collaborative Editor](simulator/ch21/index.html), [22. Messenger](simulator/ch22/index.html), [23. Ride Matching](simulator/ch23/index.html). Подробности в [simulator/README.md](simulator/README.md).

## Как повторять
1. Закрыть конспект, нарисовать архитектуру по памяти.
2. Рассказать вслух «карту решения» (раздел 🧭).
3. Ответить на вопросы из раздела 7.
4. Повторения: через 1 день, неделю, месяц.

## Главы
| # | Глава | О чём | Статус |
|---|-------|-------|--------|
| 1 | [Proximity Service](chapters/01-proximity-service/README.md) | сервис поиска ближайших мест (рестораны, отели) по координатам | 🟨 |
| 2 | [Nearby Friends](chapters/02-nearby-friends/README.md) | показ друзей поблизости в реальном времени | 🟨 |
| 3 | [Google Maps](chapters/03-google-maps/README.md) | карты, навигация, расчёт маршрута и ETA | 🟨 |
| 4 | [Distributed Message Queue](chapters/04-distributed-message-queue/README.md) | распределённая очередь сообщений уровня Kafka | 🟨 |
| 5 | [Metrics Monitoring and Alerting System](chapters/05-metrics-monitoring/README.md) | сбор метрик, дашборды и алерты | 🟨 |
| 6 | [Ad Click Event Aggregation](chapters/06-ad-click-aggregation/README.md) | агрегация кликов по рекламе в потоке событий | 🟨 |
| 7 | [Hotel Reservation System](chapters/07-hotel-reservation/README.md) | система бронирования отелей | 🟨 |
| 8 | [Distributed Email Service](chapters/08-email-service/README.md) | распределённый почтовый сервис | 🟨 |
| 9 | [S3-like Object Storage](chapters/09-object-storage/README.md) | объектное хранилище в стиле S3 | 🟨 |
| 10 | [Real-time Gaming Leaderboard](chapters/10-gaming-leaderboard/README.md) | рейтинг игроков в реальном времени | 🟨 |
| 11 | [Payment System](chapters/11-payment-system/README.md) | платёжная система | 🟨 |
| 12 | [Digital Wallet](chapters/12-digital-wallet/README.md) | цифровой кошелёк, переводы между счетами | 🟨 |
| 13 | [Stock Exchange](chapters/13-stock-exchange/README.md) | биржа, матчинг заявок | 🟨 |

⬜ не начата · 🟨 конспект · 🟩 повторена

### Data Engineering: конвейеры данных
Собственные разборы, не из книги: как строят платформы данных на Kafka, Spark, Hadoop, Hive и Airflow. Числа в них это допущения.

| # | Глава | О чём | Статус |
|---|-------|-------|--------|
| 14 | [Batch Data Lake](chapters/14-batch-data-lake/README.md) | ночной ETL: источники → HDFS → Spark → Hive, оркестрация Airflow | 🟨 |
| 15 | [Streaming Pipeline](chapters/15-streaming-pipeline/README.md) | аналитика в реальном времени: Kafka → Spark Streaming или Flink → OLAP | 🟨 |
| 16 | [CDC и Lakehouse](chapters/16-cdc-lakehouse/README.md) | таблицы боевой базы в озере: Debezium → Kafka → Iceberg или Hudi | 🟨 |

### AI-системы
Собственные разборы, не из книги: системы вокруг моделей ИИ, которые спрашивают на интервью в компаниях с большими языковыми моделями. Числа в них это допущения.

| # | Глава | О чём | Статус |
|---|-------|-------|--------|
| 17 | [LLM Inference Service](chapters/17-llm-inference/README.md) | сервис ответов языковой модели: батчинг на GPU, стриминг, лимиты в токенах, кэш префиксов | 🟨 |
| 18 | [Recommendation Feed](chapters/18-recommendation-feed/README.md) | персональная лента: отбор кандидатов, ранжирование, feature store, обучение на показах | 🟨 |
| 19 | [RAG Assistant](chapters/19-rag-assistant/README.md) | ответы по документам: нарезка, гибридный поиск, права в индексе, свежесть | 🟨 |

### Классика интервью
Собственные разборы задач, которые часто спрашивают, но которых нет во втором томе. Числа в них это допущения.

| # | Глава | О чём | Статус |
|---|-------|-------|--------|
| 20 | [Key-Value Store](chapters/20-key-value-store/README.md) | хранилище в духе Dynamo: кольцо, кворум, векторные часы, сверка копий | 🟨 |
| 21 | [Collaborative Editor](chapters/21-collaborative-editor/README.md) | совместная правка: OT или CRDT, сервер на документ, журнал и снимки | 🟨 |
| 22 | [Messenger](chapters/22-messenger/README.md) | мессенджер: соединения, порядок, доставка, группы, сквозное шифрование | 🟨 |
| 23 | [Ride Matching](chapters/23-ride-matching/README.md) | такси: гео-индекс H3, подбор по времени подачи, блокировка, динамическая цена | 🟨 |

## Шпаргалки
Знания, которые нужны во всех главах сразу, лежат в [cheatsheets/](cheatsheets/README.md):

- [Сквозные паттерны](cheatsheets/README.md#сквозные-паттерны): «вижу проблему, называю приём» и цена каждого приёма.
- [Оценки на салфетке](cheatsheets/estimation.md): числа, которые надо помнить.
- [Теория](cheatsheets/theory.md): изоляция транзакций, согласованность, CAP, кворумы, B-дерево против LSM.
- [Кирпичи из первого тома](cheatsheets/building-blocks.md): rate limiter, consistent hashing, фильтр Блума, генерация ID.
- [Устойчивость и наблюдаемость](cheatsheets/resilience.md): что делать, чтобы сбой одной части не уронил всё.
- [Несколько регионов](cheatsheets/multi-region.md): то, чего в книге почти нет, а на интервью спрашивают.
- [ИИ-системы](cheatsheets/ai-systems.md): токены и батчинг, кэш префиксов, воронка рекомендаций, векторный поиск, feature store.
- [Сравнение глав](cheatsheets/comparison.md): все главы в одной таблице: какое хранилище, какая шина и почему.
