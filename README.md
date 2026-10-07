# System Design: конспекты и визуализации

Личные конспекты по книге **System Design Interview, Vol. 2** (Alex Xu, Sahn Lam). Цель: через месяц или перед собеседованием быстро вспомнить, **из каких шагов складывалось решение, какую проблему закрывал каждый шаг и чем за него пришлось заплатить**.

## Как читать главу
Каждая глава строится по одному шаблону ([TEMPLATE.md](TEMPLATE.md)). Главный раздел — «Путь решения»: на каждом шаге **проблема → решение → что улучшилось → компромисс → альтернативы**. Диаграммы только иллюстрируют этот рассказ.

## Как повторять
1. Закрыть конспект, нарисовать архитектуру по памяти.
2. Рассказать вслух «карту решения» (раздел 🧭).
3. Ответить на вопросы из раздела 7.
4. Повторения: через 1 день, неделю, месяц.

## Главы
| # | Глава | О чём | Статус |
|---|-------|-------|--------|
| 1 | [Proximity Service](chapters/01-proximity-service/README.md) | сервис поиска ближайших мест (рестораны, отели) по координатам | ⬜ |
| 2 | [Nearby Friends](chapters/02-nearby-friends/README.md) | показ друзей поблизости в реальном времени | ⬜ |
| 3 | [Google Maps](chapters/03-google-maps/README.md) | карты, навигация, расчёт маршрута и ETA | ⬜ |
| 4 | [Distributed Message Queue](chapters/04-distributed-message-queue/README.md) | распределённая очередь сообщений уровня Kafka | ⬜ |
| 5 | [Metrics Monitoring and Alerting System](chapters/05-metrics-monitoring/README.md) | сбор метрик, дашборды и алерты | ⬜ |
| 6 | [Ad Click Event Aggregation](chapters/06-ad-click-aggregation/README.md) | агрегация кликов по рекламе в потоке событий | ⬜ |
| 7 | [Hotel Reservation System](chapters/07-hotel-reservation/README.md) | система бронирования отелей | 🟨 |
| 8 | [Distributed Email Service](chapters/08-email-service/README.md) | распределённый почтовый сервис | ⬜ |
| 9 | [S3-like Object Storage](chapters/09-object-storage/README.md) | объектное хранилище в стиле S3 | ⬜ |
| 10 | [Real-time Gaming Leaderboard](chapters/10-gaming-leaderboard/README.md) | рейтинг игроков в реальном времени | ⬜ |
| 11 | [Payment System](chapters/11-payment-system/README.md) | платёжная система | ⬜ |
| 12 | [Digital Wallet](chapters/12-digital-wallet/README.md) | цифровой кошелёк, переводы между счетами | ⬜ |
| 13 | [Stock Exchange](chapters/13-stock-exchange/README.md) | биржа, матчинг заявок | ⬜ |

⬜ не начата · 🟨 конспект · 🟩 повторена

## Сквозные паттерны
Общие приёмы, которые повторяются из главы в главу, лежат в [cheatsheets/](cheatsheets/README.md).
