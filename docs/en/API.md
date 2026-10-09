# GeoVis API and MCP — embedding geo-visualization into your projects

**[Русская версия](../ru/API.md)**

Base: `https://geovis.example.org` (your address, see [SELF_HOSTING.md](SELF_HOSTING.md)) · Swagger: `https://geovis.example.org/api/docs` · MCP: `https://geovis.example.org/mcp`

You send your data (points, values by country or a ready-made grid) → you get a 3D visualization on a globe/map
(columns, surface, 3D choropleth), a viewing link and `<iframe>` code.

## Access

- **Write** (create/delete a dataset, list your own) — an API key in the `X-API-Key` header.
  An administrator issues a key to a project: `POST /api/v1/keys {"name": "<project>"}` with the administrator key
  (`GEOVIS_ADMIN_KEY` from the server's `.env`). The key is shown once — store it in your project's secrets.
- **View** — by dataset id, no key needed (the id is unguessable; the link can be given to a client).

## Data contract v1

`GET /api/v1/contract` — rules, JSON Schema and examples (machine-readable). In short:

| Field | Type | |
|---|---|---|
| `title` | string 1–120 | on-screen title |
| `kind` | `points` \| `countries` \| `regions` \| `grid` | data kind; pass **exactly one** matching field |
| `unit` | string ≤ 40 | units, e.g. "₽", "pcs", "$ M" |
| `description`, `source` | strings | description, source (shown at the bottom) |
| `points` | `[{lat, lon, value?, label?}]` ≤ 200 000 | WGS84; `value` defaults to 1 |
| `aggregation` | `sum` \| `mean` \| `count` | how points are combined into a grid cell |
| `res` | 1, 0.5, 0.25, 0.1, 0.05 | grid step for points, degrees (0.25° ≈ 28 km) |
| `countries` | `[{iso3, value, year?}]` | ISO 3166-1 alpha-3 (as in the World Bank); unknown code → 422 |
| `regions` | `[{code, value, year?}]` | regions of the EAEU countries (RUS, KAZ, BLR, KGZ, ARM, UZB, TJK) per ISO 3166-2: `RU-MOW`, `RU-TA`, `KZ-ALA`…; code list — `GET /data/admin1_codes.json`, names — `/data/admin1_labels.json` |
| `grid` | `{west, north, res, width, height, values[]}` | `values` row by row from north to south, `null` — empty |
| `view` | `{mode, theme, projection, palette, scale, smooth, camera}` | default view (optional) |
| `countries[].year` | integer 1800–2100 | time series: a year on **every** element; the site shows a year slider, the color scale is shared across all years |
| `ttl_days` | 1–365 | dataset lifetime; after it expires the dataset becomes unavailable and is deleted (one-off visualizations from a chat) |

Rules: WGS84 coordinates; values are finite numbers (NaN/Infinity are not allowed); unknown fields are a 422 error;
up to 300 point labels (`label`) are shown above the largest values.

## Examples

```bash
KEY=...   # project key
# Points (stores with revenue) → 3D columns in 0.25° cells
curl -s -X POST https://geovis.example.org/api/v1/datasets -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "title": "Выручка магазинов", "unit": "₽", "kind": "points", "aggregation": "sum", "res": 0.25,
  "points": [{"lat": 55.75, "lon": 37.62, "value": 1200000, "label": "Москва, Тверская"},
             {"lat": 59.93, "lon": 30.33, "value": 800000, "label": "СПб, Невский"}],
  "view": {"mode": "columns", "theme": "light", "projection": "map",
           "camera": {"longitude": 40, "latitude": 55, "zoom": 4, "pitch": 50, "bearing": 0}}
}'
# → 201 {"id": "...", "view_url": "https://geovis.example.org/?ds=...", "embed_url": "...&embed=1",
#        "embed_html": "<iframe ...>", "stats": {"points": 2, "cells": 2, "total": 2000000, ...}}

# Values by country → 3D choropleth
curl -s -X POST https://geovis.example.org/api/v1/datasets -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "title": "Экспорт", "unit": "$ млн", "kind": "countries",
  "countries": [{"iso3": "CHN", "value": 120000}, {"iso3": "DEU", "value": 45000}]
}'

curl -s https://geovis.example.org/api/v1/datasets -H "X-API-Key: $KEY"          # my datasets
curl -s https://geovis.example.org/api/v1/datasets/<id>                          # metadata (public)
curl -s -X DELETE https://geovis.example.org/api/v1/datasets/<id> -H "X-API-Key: $KEY"
```

The create response also contains `snapshot_url` (PNG) and `expires` (unix time of expiry, or null).

```bash
# Time series by country: EAEU GDP 2015–2024, lives for 7 days
curl -s -X POST https://geovis.example.org/api/v1/datasets -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "title": "ВВП ЕАЭС", "unit": "$", "kind": "countries", "ttl_days": 7,
  "countries": [{"iso3": "RUS", "year": 2015, "value": 1.36e12}, {"iso3": "RUS", "year": 2024, "value": 2.19e12},
                {"iso3": "KAZ", "year": 2015, "value": 1.84e11}, {"iso3": "KAZ", "year": 2024, "value": 2.88e11}],
  "view": {"projection": "map", "camera": {"longitude": 70, "latitude": 50, "zoom": 2.6, "pitch": 40, "bearing": 0}}
}'
# Bulk deletion of your own datasets
curl -s -X DELETE "https://geovis.example.org/api/v1/datasets?older_than_days=7" -H "X-API-Key: $KEY"   # older than a week
curl -s -X DELETE "https://geovis.example.org/api/v1/datasets?all=true" -H "X-API-Key: $KEY"            # all of your own
```

## PNG snapshots (for Telegram, MAX, .docx — where iframes don't work)

| Request | |
|---|---|
| `GET /api/v1/datasets/{id}/snapshot.png` | your own dataset (no key, by id); view parameters can be added |
| `GET /api/v1/snapshot.png?dataset=pop2025&focus=KAZ` | a built-in gridded dataset |
| `GET /api/v1/snapshot.png?countries=wb_gdp&year=2015` | a built-in by-country dataset for a given year |

Parameters (strict: unknown or invalid → 422): `dataset`, `countries`, `regions`, `compare`, `syear`, `focus`, `mode`, `theme`, `projection`,
`palette`, `scale`, `smooth`, `height`, `res`, `year`, `cam`, `lang`, `labels`, `legend`, size `w` (320–1920, default 1200)
and `h` (240–1080, default 675). The first render takes 5–15 s (a browser without a GPU), repeated ones come instantly
from the cache (built-in — 24 h, your own datasets — 30 days). The ready-made link is returned as `snapshot_url` in API
and MCP responses.

Errors: 401 — missing/invalid key; 403 — someone else's dataset / not an administrator; 404 — no such dataset;
422 — contract violation (`detail` says exactly what); 429 — dataset limit per key reached.

## Link previews in messengers

Any map link (`/?…`) serves an `og:image` in its HTML = `GET /api/v1/preview.png?<the same parameters>` (1200×630):
Telegram, MAX and others show a picture of exactly that map. `preview.png` accepts parameters "leniently" (it drops
extra ones, understands `ds=`, and without a dataset shows world population).

## Your own data without the API

On the site there is a "Your data (CSV, Excel)" button: a table as a file, by drag and drop, or pasted from Excel;
countries and regions can be written as names (RU/EN) or codes. "Show on map" works without a key (the data stays in
the browser); with an API key — "Save & get link" (a dataset for 365 days).

## Embedding

`embed_html` from the response is a ready-made `<iframe>`. Link parameters (can be combined):

| Parameter | Values |
|---|---|
| `ds` | id of your own dataset |
| `dataset` | built-in dataset: `pop1975…pop2100`, `gdp2024`, `gdppc2024`, `built2020`, `lights2016`, `relief`, `ships`; when built with `--include-restricted` — also `temp`, `precip`, `temp2050`, `temp2090`, `precip2050`, `co2_2025` (see [DATA_SOURCES](../../DATA_SOURCES.md)) |
| `countries` | built-in by-country dataset: `wb_gdp`, `wb_gdppc` |
| `regions` | built-in dataset by Russian region (Rosstat): `rosstat_vrp`, `rosstat_vrp_pc`, `rosstat_pop` |
| `compare` | difference: the current dataset minus this one (same units), e.g. `dataset=pop2025&compare=pop1975`, `dataset=temp2090&compare=temp` |
| `syear` | smooth year of a series (1975…2100): a blend of neighboring epochs |
| `focus` | `world` or a layout country: `RUS`, `KAZ`, `BLR`, `KGZ`, `ARM`, `UZB`, `TJK` (light surface, its own camera angle) |
| `year` | year for by-country datasets (time series) |
| `mode` / `theme` / `projection` | `columns`\|`surface` / `dark`\|`light` / `globe`\|`map` |
| `palette` / `scale` / `smooth` / `height` | `relief`,`inferno`,`viridis`,`neon`,`ice` / `log`,`sqrt`,`linear` / 0–6 / multiplier |
| `cam` | `lon,lat,zoom,pitch,bearing` |
| `lang` | `ru` \| `en` |
| `embed=1` | without the settings panel (for iframes); `labels=0` — without labels |
| `scenario` / `play=1` | camera flight scenario: `earth-tour`, `russia-moscow`, `megacities-growth`; `play=1` — start immediately |

## Scenario video (MP4)

`POST /api/v1/videos` `{"scenario": {...}, "fps": 24|25|30, "quality": "720p"|"1080p"|"720p_v"|"1080p_v"}` → `202 {id, state}`
(`_v` — vertical 9:16 for Shorts/Reels/TikTok);
`GET /api/v1/videos/{id}` → `{state: queued|rendering|done|error, frame, frames, eta_s, queue_position}`;
`GET /api/v1/videos/{id}.mp4` — the file (H.264). Details and the scenario format — [SCENARIOS.md](SCENARIOS.md).

## Camera flight scenarios

A scenario is JSON with a list of keyframes; in the site panel: selection, ▶/⏸/⏹, a timeline,
"+ Keyframe" (current view and scene → a keyframe 5 s later), JSON export/import.

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

`t` is the second at which the camera arrives at the view; `easing`: `linear`, `inOutCubic` (default), `inOutSine`, `outCubic`;
long flights (> 25°) follow an arc (the camera rises and descends), `arc: false` disables it.
`settings` are applied at the keyframe (dataset/year, focus, view, theme, palette…), `caption` is a caption (`null` removes it).
Time is deterministic: `window.__geovis.seek(t)` always produces the same frame — the basis of frame-by-frame video recording.

## MCP (for agents)

Streamable HTTP, `X-API-Key` header. Connecting in Claude Code:

```bash
claude mcp add --transport http geovis https://geovis.example.org/mcp --header "X-API-Key: $KEY"
```

Tools: `geovis_contract`, `geovis_create_dataset`, `geovis_list_datasets`, `geovis_get_dataset`,
`geovis_delete_dataset`, `geovis_purge_datasets`, `geovis_builtin_catalog`, `geovis_builtin_view_url`
(figures out on its own whether a dataset is gridded or by country; accepts `focus`, `year`; returns `url`, `embed_html`, `snapshot_url`).
Contract errors are returned to the agent as text (what is wrong and in which field).
