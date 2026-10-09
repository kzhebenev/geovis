# GeoVis architecture

**[Русская версия](../ru/ARCHITECTURE.md)**

```
 original sources (GHSL, WorldPop, NASA, NOAA, World Bank, Rosstat, …)
        │  pipeline/prepare.py  (Python, uv, rasterio, geopandas)
        ▼
 web/public/data/  — float32 grids (.bin + .json), catalog.json, borders, labels, values by country
        │  vite build
        ▼
 ┌───────────── docker compose ─────────────────────────────────────────────┐
 │  geovis (nginx)      site static files + /data, proxies /api/ and /mcp → api │
 │  api (FastAPI + MCP) user datasets (contract v1), keys, snapshots, video    │
 │  renderer (Node)     headless Chromium + ffmpeg: PNG snapshots and MP4      │
 └────────────────────────────────────────────────────────────────────────────┘
```

## pipeline/ — data preparation

- `geovis_pipeline/catalog.py` — the registry of everything available on the site:
  - `DATASETS` — gridded datasets: source URL, `sum`/`mean` aggregation, band, units, view hints, license;
  - `COUNTRY_DATASETS` — World Bank indicators by country;
  - `REGION_DATASETS` — Rosstat statistics by Russian region (federal subject);
  - `REGIONS` — focus countries;
  - `LICENSES` — source licenses.
- `download.py` downloads a source and unpacks it if needed. Large shared archives are cached.
- `grid.py` aggregates a raster into 1° / 0.5° / 0.25° / 0.1° / 0.05° grids:
  - for sum datasets (population, CO₂) — an exact block-wise sum, the total is preserved;
  - for "mean" datasets (temperature, terrain) — an area-weighted mean.
- Focus countries get their own grids with a country mask. For Chukotka, longitudes are unwrapped across 180°.
- `country_stats.py` computes the value of each dataset per country: an area-weighted mean, population-weighted for
  "per capita" indicators; a total for sums. These values feed the country labels.
- `admin1.py` builds region borders (Natural Earth admin-1), fixes code and name errors, and parses Rosstat tables.
  An unmatched region is an error, not a silent skip.
- `labels.py` prepares country and city labels and simplified borders for the base layer.

More details — [DATA.md](DATA.md).

## web/ — website (React 19, Vite, deck.gl 9, Tailwind 4)

- `App.tsx` — the scene:
  - `ColumnLayer` for columns;
  - a custom surface mesh (`surface.ts`) → `SimpleMeshLayer` with walls;
  - `GeoJsonLayer` for 3D choropleths of countries and regions;
  - globe (`_GlobeView`) or map (`MapView`).
- `scale.ts` — scales (log/sqrt/linear), palettes, a diverging scale for dataset differences.
- `smooth.ts` — surface smoothing. `grid.ts` — sampling a value at a point.
- `Labels.tsx` + `placement.ts` — HTML labels with greedy non-overlapping placement.
- `scenario.ts` — scenarios: `cameraAt`, `settingsAt` (smooth keys `seriesYear`, `height`), `captionAt`.
  Pure functions: the same `t` always gives the same frame; frame-by-frame video recording is built on this.
- `Panel.tsx` + `ui.tsx` — the settings panel: segmented controls, dropdowns, toggles, dialogs.
- `urlstate.ts` — all view parameters live in the URL, so any scene can be shared as a link or an iframe.
- `csv.ts` — parsing CSV and pasted Excel cells, recognizing countries and regions by name and code.
- `window.__geovis` — a hook for automated tests and rendering: `seek(t)`, `setSettings`, `ready`, `grid`, `visibleLabels()`.

## api/ — FastAPI + MCP

- `contract.py` — data contract v1 (Pydantic): `points` / `countries` / `regions` / `grid`, time series, `ttl_days`.
- `process.py` converts data into a grid or into values by country/region, and assembles series by year.
- `service.py` — dataset storage (`api-data/`), keys (SQLite), limits, reading the built-in catalog.
- `snapshot.py` — PNG snapshots via the renderer, with a strict parameter whitelist. `preview.png` is for `og:image`.
- `mcp_server.py` — MCP tools (streamable HTTP, stateless, `X-API-Key`).

## renderer/ — snapshots and video

Node + puppeteer-core + Chromium from Debian (SwiftShader software rendering) + ffmpeg.

- `/render` opens the site with `render=1`: no animations, simplified borders.
- It waits for `__geovis.ready` and takes a PNG. The cache takes the site fingerprint into account (ETag of the page and the catalog).
- `/video` steps through the scenario frame by frame via `seek(t)` and assembles an H.264 MP4. Jobs go through a queue.

## nginx

`nginx.conf.template` (envsubst):

- static files with caching;
- `/data` — grids with correct MIME types;
- proxying `/api/` and `/mcp` to `GEOVIS_API_UPSTREAM`;
- injecting `og:image` into the HTML based on link parameters; only safe characters are allowed.

## Tests

- `pipeline/tests` — "ground truth about the world":
  - world population ≈ 8 billion;
  - Russia's peak is Moscow;
  - the sum of regional GRP = Russia's GRP;
  - GDP per capita by country ≈ World Bank data;
  - negative cases.
- `web/src/*.test.ts` (vitest) — scales, grids, scenarios, CSV, labels.
- `api/tests` — API and MCP via real JSON-RPC.
- `web/e2e/*.mjs` — scene, interface, scenarios, API and a label audit across all datasets in headless Chrome:
  they check the visible result and the absence of JS errors.
