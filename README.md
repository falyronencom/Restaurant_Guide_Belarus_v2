# Restaurant Guide Belarus v2.0

Современная мобильная платформа для поиска и выбора заведений общепита в Беларуси.

## О проекте

Restaurant Guide Belarus — это кроссплатформенное мобильное приложение (iOS/Android) и веб-панель администрирования, созданные для решения проблемы отсутствия единой современной платформы поиска ресторанов, кафе и баров в Беларуси, адаптированной под местную специфику.

**Целевой рынок**: 7 крупных городов Беларуси (Минск, Гродно, Брест, Гомель, Витебск, Могилев, Бобруйск)

**Ключевые возможности**:
- Геолокационный поиск с умным ранжированием заведений
- Детальная информация о меню, ценах, часах работы
- Система отзывов и рейтингов с защитой от злоупотреблений
- Избранное для быстрого доступа к любимым местам
- Инструменты продвижения для партнеров (владельцев заведений)
- Модерируемая экосистема для поддержания качества контента

## Архитектура проекта

Проект использует методологию распределенного интеллекта v7.0 "Ствол и листья" для организации разработки с участием AI-ассистентов. Эта методология обеспечивает эффективную координацию между человеческим видением и возможностями AI через структурированные протоколы и внешнюю память на базе GitHub.

**Ключевые принципы методологии**:
- Трёхуровневая архитектура: Coordination (Trunk) → Specialization (Leaves) → Integration (IDE Agents)
- GitHub как источник истины для кода и структурированных знаний
- Project Knowledge для межсессионной памяти и контекстной преемственности
- Инкрементальная разработка с явными чекпоинтами и фазированным выполнением

### Технологический стек

**Mobile (iOS/Android)**:
- Flutter 3.x
- Provider/Riverpod для state management
- Dio для HTTP запросов
- Cached Network Image для оптимизации изображений

**Web Admin Panel**:
- Flutter Web (shared codebase с mobile)
- Responsive design для desktop/tablet
- PWA для возможности установки

**Backend**:
- Node.js 18+ с Express framework
- PostgreSQL 15+ с PostGIS для геопространственных запросов
- Redis 7+ для кэширования и rate limiting
- JWT для авторизации с refresh token rotation
- Layered architecture: routes → controllers → services → models

**Infrastructure**:
- Cloudinary для хранения и оптимизации изображений
- SendGrid для email уведомлений
- Google Maps API / OpenStreetMap для карт
- Docker для контейнеризации
- GitHub Actions для CI/CD
- Хостинг в регионе (Литва/Польша для низкой латентности)

## Структура репозитория

```
restaurant-guide-belarus/
├── docs/                  # Документация проекта
│   ├── 00_methodology/   # Методология разработки v7.0
│   ├── 01_specifications/# Функциональные спецификации
│   └── 02_architecture/  # Архитектурные решения, API, схема БД
├── backend/              # Backend API (Node.js/Express)
│   ├── src/
│   │   ├── models/      # Модели данных
│   │   ├── controllers/ # Обработчики запросов
│   │   ├── services/    # Бизнес-логика
│   │   ├── middleware/  # Аутентификация и авторизация
│   │   ├── routes/      # Определение API endpoints
│   │   ├── config/      # Конфигурация БД и Redis
│   │   └── utils/       # Вспомогательные функции
│   ├── migrations/      # Миграции базы данных
│   └── tests/           # Тесты backend
├── mobile/              # Flutter мобильное приложение
│   ├── lib/
│   │   ├── models/      # Модели данных
│   │   ├── screens/     # Экраны UI
│   │   ├── widgets/     # Переиспользуемые компоненты
│   │   └── services/    # API клиент и бизнес-логика
│   └── test/            # Тесты mobile
└── admin-web/           # Flutter Web админ-панель
    └── lib/             # Переиспользует код из mobile
```

## Начало работы

### Предварительные требования

- Flutter SDK 3.x
- Node.js 18+
- PostgreSQL 15+ с расширением PostGIS
- Redis 7+
- Git

### Локальная разработка

**Backend**:
```bash
cd backend
npm install
npm run dev
```

**Mobile App**:
```bash
cd mobile
flutter pub get
flutter run
```

**Admin Web**:
```bash
cd admin-web
flutter pub get
flutter run -d chrome
```

## Ключевые документы

Рекомендуем начать изучение проекта в следующем порядке:

1. **[Методология разработки v7.0](docs/00_methodology/distributed_intelligence_v7.0.md)** — операционная методология распределённого интеллекта для координации Trunk и Leaf сессий
2. **[Функциональная спецификация v3](docs/01_specifications/functional_spec_v3.md)** — полное описание функциональности и бизнес-требований
3. **[Схема базы данных v2.0](docs/02_architecture/database_schema_v2.0.sql)** — структура данных и отношения
4. **[API Спецификация v2.0](docs/02_architecture/api_specification_v2.0.yaml)** — OpenAPI описание всех endpoints
5. **[API Architecture Review](docs/01_specifications/api_architecture_review_v1.1.md)** — архитектурный обзор критических решений

## Текущий статус проекта

**Фаза**: Активная разработка (Active Development Phase)

### Реализованные компоненты ✅

**Backend Infrastructure**:
- Express сервер с production-ready middleware stack
- PostgreSQL connection pooling с автоматическим мониторингом производительности
- Redis интеграция для кэширования и rate limiting
- Graceful shutdown handlers и error handling
- Layered architecture с чёткой separation of concerns

**Authentication System** (Leaf Session 1):
- JWT-based авторизация с access и refresh tokens
- Strict refresh token rotation для повышения безопасности
- Multi-method registration: email, phone (SMS), OAuth (Google, Yandex)
- Role-based access control (user, partner, admin)
- Belarus-specific телефонная валидация
- Two-tier rate limiting (10 requests/15 min для sensitive endpoints)

**Search & Discovery** (Leaf Session 2):
- Геопространственные запросы через PostGIS
- Radius-based search для list view
- Bounds-based search для map view
- Intelligent ranking: distance + rating + review count + boost_score
- Фильтрация: категории, кухни, price range, ratings, amenities
- Pagination с оптимизацией производительности
- Proper indexing для быстрых результатов при больших датасетах

**Reviews System** (Leaf Session 3):
- CRUD операции для отзывов с rich responses
- Rate limiting: 10 reviews per day per user
- Duplicate prevention: one review per user per establishment
- Aggregate statistics caching для производительности
- Partner response functionality для взаимодействия с клиентами
- Soft deletion для восстановления и audit trail
- Comprehensive validation и error handling

**Favorites System** (Leaf Session 4):
- Add/remove establishments to/from favorites
- Get user favorites с pagination
- Check single/batch favorite status для UI state
- Statistics endpoint для aggregate metrics
- Idempotent operations для better UX
- Rich establishment details в responses для минимизации API calls

**Database Schema**:
- Complete schema с всеми таблицами и relationships
- PostGIS spatial indexes для географических запросов
- Proper constraints и foreign keys
- Migration scripts для version control
- Optimized indexes для performance

### В разработке ⏳

**Quality Assurance**:
- Интеграционное тестирование критических путей
- Smoke testing для основного функционала
- Load testing с реалистичными данными

**Establishments Management** (следующий приоритет):
- Partner registration flow
- Establishment CRUD операции
- Media management с Cloudinary интеграцией
- Moderation workflow

### Запланировано 📋

**Partner Features**:
- Analytics dashboard
- Subscription management
- Promotion system
- Review response management

**Admin Panel**:
- Content moderation interface
- User management
- Analytics and reporting
- System monitoring

**Mobile Application**:
- Flutter app initialization
- UI implementation
- API integration
- Offline support

## Roadmap по фазам

### ✅ Фаза 1: Архитектурный фундамент (Завершена)
- Методология распределённого интеллекта v7.0
- Функциональная спецификация v3.0
- API спецификация v2.0
- Схема базы данных v2.0
- Структура репозитория

### ✅ Фаза 2: Backend Core (Завершена)
- Backend infrastructure setup
- Authentication system
- Search & discovery
- Reviews system
- Favorites system

### ⏳ Фаза 3: Quality Assurance (В процессе)
- Integration testing
- Performance optimization
- Security hardening
- Documentation finalization

### 📋 Фаза 4: Establishments Management
- Partner registration flow
- Establishment CRUD
- Media management
- Moderation workflow

### 📋 Фаза 5: Mobile MVP Frontend
- Flutter project setup
- Core UI screens
- API integration
- Maps integration

### 📋 Фаза 6: Partner Features
- Analytics dashboard
- Subscription system
- Promotion management
- Review responses

### 📋 Фаза 7: Admin Panel
- Web admin interface
- Content moderation
- User management
- System analytics

### 📋 Фаза 8: Testing & Polish
- Comprehensive testing
- Performance optimization
- UX refinement
- Bug fixes

### 📋 Фаза 9: Launch Preparation
- Production deployment
- Monitoring setup
- Marketing materials
- Beta testing

Детальная дорожная карта доступна в [функциональной спецификации](docs/01_specifications/functional_spec_v3.md) и [Implementation Summary](backend/IMPLEMENTATION_SUMMARY.md).

## Ключевые метрики успеха

**Технические**:
- Время загрузки главного экрана < 2 секунд
- Crash-free rate > 99%
- API response time < 500ms для 95-го перцентиля
- Размер приложения < 50MB

**Пользовательские**:
- 250-500 заведений к моменту публичного запуска
- 1000+ активных пользователей к концу 2-го месяца
- Retention Day 7 > 20%

**Бизнес**:
- 10+ платных подписок к концу 3-го месяца
- Конверсия из триала в платную подписку > 30%

## Методология разработки

Проект использует методологию распределённого интеллекта v7.0, которая позволяет эффективно координировать работу между человеком и AI-ассистентами. Ключевые аспекты:

**Три уровня выполнения**:
- **Level 1 (Coordination)**: Strategic и Operational Trunk для архитектурных решений и ежедневной координации
- **Level 2 (Specialization)**: Leaf sessions для фокусированного выполнения в специфических доменах
- **Level 3 (Integration)**: IDE агенты (Cursor AI) для работы в development environment

**External Memory Architecture**:
- GitHub как canonical repository для кода и знаний
- Project Knowledge для межсессионной памяти
- Документированные session reports для traceability

**Operational Protocols**:
- Context-aware directive sizing (10-30 страниц в зависимости от сложности)
- Explicit phased execution с checkpoints
- Defensive context management для предотвращения overflow

Подробная методология описана в [документации](docs/00_methodology/distributed_intelligence_v7.0.md).

## Contributing

Проект находится в стадии активной разработки. Методология работы с AI-ассистентами описана в документации по методологии. При внесении изменений:

1. Следуйте установленным архитектурным паттернам
2. Добавляйте comprehensive inline comments
3. Обновляйте соответствующую документацию
4. Создавайте descriptive commit messages с references на originating sessions

## License

Proprietary - все права защищены.

## Контакты

**Основатель проекта**: Всеволод  
**Архитектурный координатор**: Claude (Anthropic AI)  
**Методология**: Distributed Intelligence v7.0

---

*Последнее обновление: Октябрь 2025*  
*Статус документа: Production-Ready*  
*Next Review: После завершения Фазы 3 (Quality Assurance)*
