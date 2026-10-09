# GeoVis API и MCP — встраивание гео-визуализации в проекты

**[English version](../en/API.md)**

База: `https://geovis.example.org` (ваш адрес, см. [SELF_HOSTING.md](SELF_HOSTING.md)) · Swagger: `https://geovis.example.org/api/docs` · MCP: `https://geovis.example.org/mcp`

Передаёте свои данные (точки, значения по странам или готовую сетку) → получаете 3D-визуализацию
на глобусе/карте (столбики, поверхность, 3D-картограмма), ссылку на просмотр и код `<iframe>`.

## Доступ

- **Запись** (создать/удалить набор, список своих) — API-ключ в заголовке `X-API-Key`.
  Ключ проекту выдаёт администратор: `POST /api/v1/keys {"name": "<проект>"}` с ключом администратора
  (`GEOVIS_ADMIN_KEY` из `.env` сервера). Ключ показывается один раз — храните его в секретах проекта.
- **Просмотр** — по id набора, без ключа (id непредсказуемый; ссылку можно отдавать клиенту).

## Контракт данных v1

`GET /api/v1/contract` — правила, JSON Schema и примеры (машиночитаемо). Кратко:

| Поле | Тип | |
|---|---|---|
| `title` | строка 1–120 | заголовок на экране |
| `kind` | `points` \| `countries` \| `regions` \| `grid` | вид данных; передаётся **ровно одно** соответствующее поле |
| `unit` | строка ≤ 40 | единицы, напр. «₽», «шт.», «$ млн» |
| `description`, `source` | строки | описание, источник (показывается внизу) |
| `points` | `[{lat, lon, value?, label?}]` ≤ 200 000 | WGS84; `value` по умолчанию 1 |
| `aggregation` | `sum` \| `mean` \| `count` | как сводить точки в ячейку сетки |
| `res` | 1, 0.5, 0.25, 0.1, 0.05 | шаг сетки для точек, градусы (0.25° ≈ 28 км) |
| `countries` | `[{iso3, value, year?}]` | ISO 3166-1 alpha-3 (как World Bank); неизвестный код → 422 |
| `regions` | `[{code, value, year?}]` | регионы стран ЕАЭС (RUS, KAZ, BLR, KGZ, ARM, UZB, TJK) по ISO 3166-2: `RU-MOW`, `RU-TA`, `KZ-ALA`…; список кодов — `GET /data/admin1_codes.json`, названия — `/data/admin1_labels.json` |
| `grid` | `{west, north, res, width, height, values[]}` | `values` построчно с севера на юг, `null` — пусто |
| `view` | `{mode, theme, projection, palette, scale, smooth, camera}` | вид по умолчанию (необязательно) |
| `countries[].year` | целое 1800–2100 | временной ряд: год у **всех** элементов; на сайте — ползунок лет, шкала цвета общая на все годы |
| `ttl_days` | 1–365 | срок жизни набора; по истечении набор недоступен и удаляется (разовые визуализации из чата) |

Правила: координаты WGS84; значения — конечные числа (NaN/Infinity запрещены); неизвестные поля — ошибка 422;
до 300 подписей точек (`label`) показываются над самыми крупными значениями.

## Примеры

```bash
KEY=...   # ключ проекта
# Точки (магазины с выручкой) → 3D-столбики по ячейкам 0.25°
curl -s -X POST https://geovis.example.org/api/v1/datasets -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "title": "Выручка магазинов", "unit": "₽", "kind": "points", "aggregation": "sum", "res": 0.25,
  "points": [{"lat": 55.75, "lon": 37.62, "value": 1200000, "label": "Москва, Тверская"},
             {"lat": 59.93, "lon": 30.33, "value": 800000, "label": "СПб, Невский"}],
  "view": {"mode": "columns", "theme": "light", "projection": "map",
           "camera": {"longitude": 40, "latitude": 55, "zoom": 4, "pitch": 50, "bearing": 0}}
}'
# → 201 {"id": "...", "view_url": "https://geovis.example.org/?ds=...", "embed_url": "...&embed=1",
#        "embed_html": "<iframe ...>", "stats": {"points": 2, "cells": 2, "total": 2000000, ...}}

# Значения по странам → 3D-картограмма
curl -s -X POST https://geovis.example.org/api/v1/datasets -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "title": "Экспорт", "unit": "$ млн", "kind": "countries",
  "countries": [{"iso3": "CHN", "value": 120000}, {"iso3": "DEU", "value": 45000}]
}'

curl -s https://geovis.example.org/api/v1/datasets -H "X-API-Key: $KEY"          # мои наборы
curl -s https://geovis.example.org/api/v1/datasets/<id>                          # метаданные (публично)
curl -s -X DELETE https://geovis.example.org/api/v1/datasets/<id> -H "X-API-Key: $KEY"
```

Ответ создания также содержит `snapshot_url` (PNG) и `expires` (unix-время окончания срока или null).

```bash
# Временной ряд по странам: ВВП ЕАЭС 2015–2024, живёт 7 дней
curl -s -X POST https://geovis.example.org/api/v1/datasets -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "title": "ВВП ЕАЭС", "unit": "$", "kind": "countries", "ttl_days": 7,
  "countries": [{"iso3": "RUS", "year": 2015, "value": 1.36e12}, {"iso3": "RUS", "year": 2024, "value": 2.19e12},
                {"iso3": "KAZ", "year": 2015, "value": 1.84e11}, {"iso3": "KAZ", "year": 2024, "value": 2.88e11}],
  "view": {"projection": "map", "camera": {"longitude": 70, "latitude": 50, "zoom": 2.6, "pitch": 40, "bearing": 0}}
}'
# Массовое удаление своих наборов
curl -s -X DELETE "https://geovis.example.org/api/v1/datasets?older_than_days=7" -H "X-API-Key: $KEY"   # старше недели
curl -s -X DELETE "https://geovis.example.org/api/v1/datasets?all=true" -H "X-API-Key: $KEY"            # все свои
```

## PNG-снимки (для Telegram, MAX, .docx — там iframe не работает)

| Запрос | |
|---|---|
| `GET /api/v1/datasets/{id}/snapshot.png` | свой набор (без ключа, по id); можно добавить параметры вида |
| `GET /api/v1/snapshot.png?dataset=pop2025&focus=KAZ` | встроенный сеточный набор |
| `GET /api/v1/snapshot.png?countries=wb_gdp&year=2015` | встроенный набор по странам за год |

Параметры (строго, неизвестный или некорректный → 422): `dataset`, `countries`, `regions`, `compare`, `syear`, `focus`, `mode`, `theme`, `projection`,
`palette`, `scale`, `smooth`, `height`, `res`, `year`, `cam`, `lang`, `labels`, `legend`, размер `w` (320–1920, по умолчанию 1200)
и `h` (240–1080, по умолчанию 675). Первый рендер — 5–15 с (браузер без видеокарты), повторный — из кеша мгновенно
(встроенные — 24 ч, свои наборы — 30 дней). Готовую ссылку отдаёт `snapshot_url` в ответах API и MCP.

Ошибки: 401 — нет/неверный ключ; 403 — чужой набор / не администратор; 404 — нет набора;
422 — нарушение контракта (в `detail` — что именно); 429 — лимит наборов на ключ.

## Превью ссылок в мессенджерах

Любая ссылка на карту (`/?…`) отдаёт в HTML `og:image` = `GET /api/v1/preview.png?<те же параметры>` (1200×630):
Telegram, MAX и др. показывают картинку именно этой карты. `preview.png` принимает параметры «мягко» (лишние
отбрасывает, `ds=` понимает, без набора — население мира).

## Свои данные без API

На сайте — кнопка «Свои данные (CSV, Excel)»: таблица файлом, перетаскиванием или вставкой из Excel; страны и регионы
можно писать названиями (RU/EN) или кодами. «Показать на карте» — без ключа (данные остаются в браузере);
с API-ключом — «Сохранить и получить ссылку» (набор на 365 дней).

## Встраивание

`embed_html` из ответа — готовый `<iframe>`. Параметры ссылки (можно комбинировать):

| Параметр | Значения |
|---|---|
| `ds` | id своего набора |
| `dataset` | встроенный набор: `pop1975…pop2100`, `gdp2024`, `gdppc2024`, `built2020`, `lights2016`, `relief`, `ships`; при сборке с `--include-restricted` — также `temp`, `precip`, `temp2050`, `temp2090`, `precip2050`, `co2_2025` (см. [DATA_SOURCES](../../DATA_SOURCES.ru.md)) |
| `countries` | встроенный набор по странам: `wb_gdp`, `wb_gdppc` |
| `regions` | встроенный набор по регионам РФ (Росстат): `rosstat_vrp`, `rosstat_vrp_pc`, `rosstat_pop` |
| `compare` | разница: текущий набор минус этот (те же единицы), напр. `dataset=pop2025&compare=pop1975`, `dataset=temp2090&compare=temp` |
| `syear` | плавный год серии (1975…2100): смесь соседних эпох |
| `focus` | `world` или страна-макет: `RUS`, `KAZ`, `BLR`, `KGZ`, `ARM`, `UZB`, `TJK` (светлая поверхность, свой ракурс) |
| `year` | год для наборов по странам (временной ряд) |
| `mode` / `theme` / `projection` | `columns`\|`surface` / `dark`\|`light` / `globe`\|`map` |
| `palette` / `scale` / `smooth` / `height` | `relief`,`inferno`,`viridis`,`neon`,`ice` / `log`,`sqrt`,`linear` / 0–6 / множитель |
| `cam` | `lon,lat,zoom,pitch,bearing` |
| `lang` | `ru` \| `en` |
| `embed=1` | без панели настроек (для iframe); `labels=0` — без подписей |
| `scenario` / `play=1` | сценарий полёта камеры: `earth-tour`, `russia-moscow`, `megacities-growth`; `play=1` — запустить сразу |

## Видео сценария (MP4)

`POST /api/v1/videos` `{"scenario": {...}, "fps": 24|25|30, "quality": "720p"|"1080p"|"720p_v"|"1080p_v"}` → `202 {id, state}`
(`_v` — вертикальное 9:16 для Shorts/Reels/TikTok);
`GET /api/v1/videos/{id}` → `{state: queued|rendering|done|error, frame, frames, eta_s, queue_position}`;
`GET /api/v1/videos/{id}.mp4` — файл (H.264). Подробно и формат сценария — [SCENARIOS.md](SCENARIOS.md).

## Сценарии полёта камеры

Сценарий — JSON со списком ключевых кадров; в панели сайта: выбор, ▶/⏸/⏹, шкала времени,
«+ Кадр» (текущий ракурс и сцена → кадр через 5 с), экспорт/импорт JSON.

```json
{ "title": {"ru": "Мой облёт", "en": "My flight"},
  "keyframes": [
    {"t": 0, "camera": {"longitude": 37.6, "latitude": 50, "zoom": 3, "pitch": 50, "bearing": 0},
     "settings": {"dataset": "pop1975", "focus": "world", "mode": "columns", "theme": "dark"},
     "caption": {"ru": "1975", "en": "1975"}},
    {"t": 8, "camera": {"longitude": 37.6, "latitude": 55.7, "zoom": 5, "pitch": 65, "bearing": 40},
     "easing": "inOutCubic", "settings": {"dataset": "pop2025"}, "caption": {"ru": "2025"}},
    {"t": 12, "camera": {"longitude": 37.6, "latitude": 55.7, "zoom": 5, "pitch": 65, "bearing": 120}, "caption": null}
  ] }
```

`t` — секунда, когда камера приходит в ракурс; `easing`: `linear`, `inOutCubic` (по умолчанию), `inOutSine`, `outCubic`;
дальние перелёты (> 25°) идут «по дуге» (камера поднимается и снижается), `arc: false` — отключить.
`settings` применяются в момент кадра (набор/год, фокус, вид, тема, палитра…), `caption` — титр (`null` — убрать).
Время детерминировано: `window.__geovis.seek(t)` всегда даёт один и тот же кадр — основа покадровой записи видео.

## MCP (для агентов)

Streamable HTTP, заголовок `X-API-Key`. Подключение в Claude Code:

```bash
claude mcp add --transport http geovis https://geovis.example.org/mcp --header "X-API-Key: $KEY"
```

Инструменты: `geovis_contract`, `geovis_create_dataset`, `geovis_list_datasets`, `geovis_get_dataset`,
`geovis_delete_dataset`, `geovis_purge_datasets`, `geovis_builtin_catalog`, `geovis_builtin_view_url`
(сам определяет, сеточный набор или по странам; принимает `focus`, `year`; возвращает `url`, `embed_html`, `snapshot_url`).
Ошибки контракта возвращаются агенту текстом (что не так и в каком поле).
