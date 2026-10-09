# Данные и пайплайн

**[English version](../en/DATA.md)**

Перед использованием наборов прочитайте [DATA_SOURCES.ru.md](../../DATA_SOURCES.ru.md): там лицензии и обязательные ссылки.

## Сборка

```bash
cd pipeline
uv sync
uv run python prepare.py                       # всё со свободной лицензией
uv run python prepare.py --include-restricted  # плюс WorldClim и IEA-EDGAR CO₂ — только если вам это разрешено
uv run python prepare.py --datasets pop2025 relief   # пересчитать только эти наборы, остальные взять из прошлого каталога
uv run python prepare.py --catalog-only        # не считать сетки: собрать каталог по файлам на диске
uv run pytest -q                               # проверка «правды о мире» на собранных данных
```

| Флаг | |
|---|---|
| `--raw DIR` | куда скачивать исходники (по умолчанию `../data/raw`) |
| `--out DIR` | куда писать результат (по умолчанию `../web/public/data`) |
| `--datasets ID …` | пересчитать только эти сеточные наборы |
| `--catalog-only` | только каталог, значения по странам и подписи по уже посчитанным файлам |
| `--include-restricted` | включить наборы с ограничительной лицензией |
| `--keep-raw` | не удалять крупные исходники после сборки (по умолчанию файлы ≥ 100 МБ удаляются) |

На время сборки нужно 20–30 ГБ диска (морские пути — около 13 ГБ, прогноз WorldPop — 4 ГБ). Готовые данные сайта
занимают около 1 ГБ. Для скачивания с rosstat.gov.ru используется сертификат Минцифры (`pipeline/certs/`);
проверка TLS не отключается.

## Что получается

```
web/public/data/
  catalog.json                  меню сайта: наборы, уровни, фокусы, лицензии
  <набор>/g_0p25.json + .bin    глобальная сетка 0,25° (float32, построчно с севера), также 1 / 0.5 / 0.1 / 0.05°
  <набор>/RUS_0p1.json + .bin   сетки стран-фокусов с маской
  <набор>/countries.json        значение набора по странам: [среднее, итог]
  countries/wb_gdp.json         показатели по странам (ряды по годам)
  regiondata/rosstat_vrp.json   показатели по регионам
  countries.json, cities.json   подписи (Natural Earth)
  outlines.geojson, outlines_lo.geojson, admin1.geojson   границы
```

## Как добавить сеточный набор

Одна запись в `DATASETS` (`pipeline/geovis_pipeline/catalog.py`) и лицензия в `_LIC_OF`:

```python
"mydata": {
    "group": "climate", "title": {"ru": "…", "en": "…"},
    "unit": {"ru": "мм/год", "en": "mm/yr"}, "value_label": {"ru": "Осадки", "en": "Precipitation"},
    "url": "https://…/file.tif",    # .zip распаковывается; "extract": [...] — взять из архива только нужные файлы
    "file": "mydata/file.tif",
    "source": "Издатель, версия (лицензия)",
    "agg": "mean",                   # sum — величина на площадь (население, выбросы), mean — среднее (температура)
    "band": 1,                       # полоса растра
    "view": {"palette": "viridis", "scale": "sqrt"},
},
```

Затем: `uv run python prepare.py --datasets mydata`, добавить тест «правды» в `pipeline/tests/` (позитивный
и негативный кейс) и проверить подписи — `node web/e2e/labels-audit.mjs <url>`.

## Как добавить страну-фокус

Запись в `REGIONS`: ISO3 (код ADM0_A3 Natural Earth), название, необязательный ракурс и порог подписей городов.
Ракурс по умолчанию рассчитывается по геометрии страны.

## Свои данные — без пайплайна

Пайплайн нужен только для встроенных наборов. Свои данные загружаются через API (контракт v1,
[API.md](API.md)) или кнопкой «Свои данные» на сайте.
