# Развёртывание

**[English version](../en/SELF_HOSTING.md)**

## Требования

- Linux-сервер, Docker с Compose v2. Минимум 4 vCPU и 8 ГБ памяти: рендер снимков и видео идёт без видеокарты.
- Для сборки: Python 3.11+ с [uv](https://docs.astral.sh/uv/), Node.js 22, 20–30 ГБ диска на время сборки данных.

## Шаги

```bash
# 1. данные (см. DATA.md; наборы с ограничительной лицензией — только с разрешения)
cd pipeline && uv sync && uv run python prepare.py && cd ..

# 2. сайт
cd web && npm ci && npm run build && cd ..
cp VERSION api/app/VERSION            # версия для /api/v1/health

# 3. настройки
cp .env.example .env
#   GEOVIS_ADMIN_KEY   — ключ администратора API: openssl rand -hex 24
#   GEOVIS_PUBLIC_URL  — публичный адрес сайта (для ссылок, iframe, превью, MCP)
#   GEOVIS_BIND / GEOVIS_PORT — где слушает nginx (по умолчанию 127.0.0.1:8105)

# 4. запуск и проверка
docker compose up -d --build
./smoke_test.sh                        # PUB=https://ваш-адрес ./smoke_test.sh — проверить и публичный адрес
```

Состав compose:
- `geovis` — nginx: статика и `/data`, прокси `/api/` и `/mcp`;
- `api` — FastAPI + MCP, том `./api-data`;
- `renderer` — Chromium + ffmpeg, том `./render-cache`.

У всех сервисов заданы лимиты CPU и памяти, healthcheck и `restart: unless-stopped`.

## Публикация наружу

nginx слушает только `GEOVIS_BIND:GEOVIS_PORT`. Наружу публикуйте через reverse proxy с TLS. Пример для Caddy:

```
geovis.example.org {
    reverse_proxy 127.0.0.1:8105
}
```

nginx внутри передаёт `X-Forwarded-*`, API строит ссылки от `GEOVIS_PUBLIC_URL`.

## Ключи API

```bash
# выдать ключ проекту (ключ показывается один раз)
curl -s -X POST "$GEOVIS_PUBLIC_URL/api/v1/keys" -H "X-API-Key: $GEOVIS_ADMIN_KEY" \
     -H 'Content-Type: application/json' -d '{"name": "my-project"}'
```

Просмотр наборов по ссылке ключа не требует. Запись, удаление и MCP — только с ключом. Лимит наборов на ключ —
`GEOVIS_MAX_DATASETS_PER_KEY` (по умолчанию 500).

## Переменные окружения

| Сервис | Переменная | По умолчанию | |
|---|---|---|---|
| api | `GEOVIS_ADMIN_KEY` | — | ключ администратора (обязателен для выдачи ключей) |
| api | `GEOVIS_PUBLIC_URL` | `http://localhost:8105` | адрес в ссылках, iframe, превью |
| api | `GEOVIS_DATA_DIR` | `/data` | хранилище своих наборов и ключей |
| api | `GEOVIS_STATIC_DATA` | `/static-data` | встроенные данные с общего тома (иначе — по HTTP) |
| api | `GEOVIS_WEB_URL` / `GEOVIS_STATIC_URL` | — | откуда брать встроенный каталог, если общего тома нет (k8s) |
| api | `GEOVIS_RENDERER_URL` | `http://renderer:8200` | сервис снимков и видео |
| api | `GEOVIS_MAX_DATASETS_PER_KEY` | `500` | лимит наборов на ключ |
| geovis | `GEOVIS_API_UPSTREAM` | `http://api:8000` | адрес API для прокси nginx |
| renderer | `GEOVIS_TARGET` | `http://geovis` | откуда открывать сайт |
| renderer | `MAX_PARALLEL`, `MAX_QUEUE` | `2`, `3` | параллельные рендеры, очередь видео |
| renderer | `TTL_BUILTIN_H`, `TTL_DATASET_H`, `VIDEO_TTL_D` | 24 ч, 720 ч, 7 дн | сроки кеша снимков и хранения видео |

## Kubernetes

Образы собираются из тех же Dockerfile: корень (`geovis`), `api/`, `renderer/`. Без общего тома api берёт
встроенный каталог по HTTP у web: задайте `GEOVIS_WEB_URL=http://<сервис web>`. nginx — `GEOVIS_API_UPSTREAM`.

## Обновление и резервные копии

- Обновление: `git pull`, при необходимости пересобрать данные и сайт, затем `docker compose up -d --build` и
  `./smoke_test.sh`.
- Резервные копии: `./api-data` (наборы пользователей и SQLite с ключами) и `.env`. Встроенные данные
  пересобираются пайплайном, кеш снимков восстанавливать не нужно.
