# syntax=docker/dockerfile:1
#
# Админ-панель (Flutter Web) как третий сервис Railway — SDL CAT-C-2.11,
# решение Координатора 2026-09-08.
#
# Railway сам находит Dockerfile в Root Directory сервиса (`admin-web`) и
# собирает по нему; Railpack при этом не участвует. Две стадии: первая
# собирает бандл тем же Flutter, что и гейт CI (3.35.2 — версия закреплена,
# иначе обновление канала меняло бы прод без единого коммита), вторая отдаёт
# статику Caddy на порту из переменной PORT, которую задаёт Railway.
#
# Бандл ходит в прод-API (lib/config/environment.dart) — сервису не нужна ни
# одна переменная; зато адрес этого сервиса обязан быть в CORS_ORIGIN
# бэкенда (docs/deployment/railway_admin_web.md).

FROM ghcr.io/cirruslabs/flutter:3.35.2 AS build

WORKDIR /app

# Сначала зависимости: слой pub-кэша переживает правки исходников.
COPY pubspec.yaml pubspec.lock ./
RUN flutter pub get

COPY . .

# ENV=production — без Dio LogInterceptor (OSB-M P1: пароль и токены в
# консоль). --pwa-strategy=none — без service worker: у админского
# инструмента после редеплоя не должно быть «старой» сборки в кэше браузера.
RUN flutter build web --release --dart-define=ENV=production --pwa-strategy=none

# Минор закреплён по той же причине, что и Flutter выше: `2-alpine` плавал бы
# на следующий минор без единого коммита. Патчи внутри 2.11 приходят сами.
FROM caddy:2.11-alpine

COPY --from=build /app/build/web /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
