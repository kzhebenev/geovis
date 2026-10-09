# Data and pipeline

**[Русская версия](../ru/DATA.md)**

Before using the datasets, read [DATA_SOURCES.md](../../DATA_SOURCES.md): it lists the licenses and required attributions.

## Build

```bash
cd pipeline
uv sync
uv run python prepare.py                       # everything under a free license
uv run python prepare.py --include-restricted  # plus WorldClim and IEA-EDGAR CO₂ — only if you are permitted to use them
uv run python prepare.py --datasets pop2025 relief   # recompute only these datasets, take the rest from the previous catalog
uv run python prepare.py --catalog-only        # don't compute grids: build the catalog from files on disk
uv run pytest -q                               # check the "ground truth about the world" on the built data
```

| Flag | |
|---|---|
| `--raw DIR` | where to download the sources (default `../data/raw`) |
| `--out DIR` | where to write the output (default `../web/public/data`) |
| `--datasets ID …` | recompute only these gridded datasets |
| `--catalog-only` | only the catalog, per-country values and labels from already computed files |
| `--include-restricted` | include datasets under a restrictive license |
| `--keep-raw` | don't delete large sources after the build (by default files ≥ 100 MB are deleted) |

The build needs 20–30 GB of disk while it runs (shipping lanes take about 13 GB, the WorldPop projection 4 GB). The
finished site data takes about 1 GB. Downloads from rosstat.gov.ru use the Russian Ministry of Digital Development
(Mintsifry) certificate (`pipeline/certs/`); TLS verification is not disabled.

## Output

```
web/public/data/
  catalog.json                  site menu: datasets, levels, focuses, licenses
  <dataset>/g_0p25.json + .bin  global 0.25° grid (float32, row by row from the north), also 1 / 0.5 / 0.1 / 0.05°
  <dataset>/RUS_0p1.json + .bin focus-country grids with a mask
  <dataset>/countries.json      dataset value by country: [mean, total]
  countries/wb_gdp.json         indicators by country (series by year)
  regiondata/rosstat_vrp.json   indicators by region
  countries.json, cities.json   labels (Natural Earth)
  outlines.geojson, outlines_lo.geojson, admin1.geojson   borders
```

## Adding a gridded dataset

One entry in `DATASETS` (`pipeline/geovis_pipeline/catalog.py`) and its license in `_LIC_OF`:

```python
"mydata": {
    "group": "climate", "title": {"ru": "…", "en": "…"},
    "unit": {"ru": "мм/год", "en": "mm/yr"}, "value_label": {"ru": "Осадки", "en": "Precipitation"},
    "url": "https://…/file.tif",    # .zip is unpacked; "extract": [...] — take only the needed files from the archive
    "file": "mydata/file.tif",
    "source": "Publisher, version (license)",
    "agg": "mean",                   # sum — a quantity per area (population, emissions), mean — an average (temperature)
    "band": 1,                       # raster band
    "view": {"palette": "viridis", "scale": "sqrt"},
},
```

Then: `uv run python prepare.py --datasets mydata`, add a "ground truth" test to `pipeline/tests/` (a positive and a
negative case) and check the labels — `node web/e2e/labels-audit.mjs <url>`.

## Adding a focus country

An entry in `REGIONS`: ISO3 (the Natural Earth ADM0_A3 code), a name, an optional camera angle and a city label
threshold. The default camera angle is computed from the country's geometry.

## Your own data — no pipeline needed

The pipeline is only needed for the built-in datasets. Your own data is uploaded via the API (contract v1,
[API.md](API.md)) or with the "Your data (CSV, Excel)" button on the site.
