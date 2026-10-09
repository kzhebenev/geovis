"""Реестр наборов данных и регионов-фокусов GeoVis.

Новый набор = запись в DATASETS. Поля:
  group/year     — наборы одной группы показываются одной карточкой с выбором года
  url, file      — откуда скачать и какой файл (внутри zip — member) читать
  band           — номер полосы многолетнего растра (1-based); None — первая
  agg            — "sum": величина на пиксель (люди, $, м²) → плотность на км²;
                   "mean": интенсивная величина (высота, °C, яркость) → среднее по ячейке
  factor         — множитель к итоговому значению (перевод единиц)
  clip_min       — значения ниже считаются пустыми (NaN), напр. океан для рельефа
  regions        — строить ли сетки регионов-фокусов
  view           — подсказки сайту: палитра, шкала
Сайт строит меню выбора из catalog.json, который пишет prepare.py.
"""

GHSL = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL"
GDP_ZENODO = "https://zenodo.org/api/records/18429133/files"


def _pop(year: int) -> dict:
    name = f"GHS_POP_E{year}_GLOBE_R2023A_4326_30ss_V1_0"
    return {
        "group": "pop", "year": year,
        "value_label": {"ru": "Плотность", "en": "Density"},
        "title": {"ru": f"Население {year}", "en": f"Population {year}"},
        "group_title": {"ru": "Население", "en": "Population"},
        "unit": {"ru": "чел/км²", "en": "people/km²"},
        "url": f"{GHSL}/GHS_POP_GLOBE_R2023A/GHS_POP_E{year}_GLOBE_R2023A_4326_30ss/V1-0/{name}.zip",
        "file": f"ghs_{year}/{name}.tif",
        "source": f"GHSL GHS-POP E{year} R2023A (JRC, CC BY 4.0)",
        "agg": "sum", "regions": True,
        "total_label": {"ru": "Население", "en": "Population"},
        "view": {"palette": "inferno", "scale": "log"},
    }


WORLDPOP_FP = "https://data.worldpop.org/repo/prj/FuturePop/SSPs_1km_v0_2/FuturePop_SSP2_1km_v0_2.zip"
WC_FUT = "https://geodata.ucdavis.edu/climate/worldclim/2_1/fut/10m"
# ансамбль моделей CMIP6 с разной чувствительностью климата: среднее честнее мнения одной модели
CMIP6_MODELS = ["BCC-CSM2-MR", "IPSL-CM6A-LR", "MIROC6", "MRI-ESM2-0"]


def _pop_forecast(year: int) -> dict:
    return {
        "group": "pop", "year": year,
        "value_label": {"ru": "Плотность", "en": "Density"},
        "title": {"ru": f"Население {year} (прогноз SSP2)", "en": f"Population {year} (SSP2 projection)"},
        "group_title": {"ru": "Население", "en": "Population"},
        "unit": {"ru": "чел/км²", "en": "people/km²"},
        "url": WORLDPOP_FP, "extract": [f"_{year}_"],
        "file": f"futurepop/FuturePop_SSP2_{year}_1km_v0_2.tif",
        "source": "WorldPop FuturePop SSP2 v0.2 (2025, CC BY 4.0)",
        "agg": "sum", "regions": True,
        "total_label": {"ru": "Население", "en": "Population"},
        "view": {"palette": "inferno", "scale": "log"},
    }


def _climate_future(var: str, ssp: str, period: str) -> dict:
    band = 1 if var == "temp" else 12
    names = {"temp": ("Температура", "Temperature", "°C", "viridis", "linear"),
             "precip": ("Осадки", "Precipitation", "мм/год", "ice", "sqrt")}[var]
    ssp_h = {"ssp245": "SSP2-4.5", "ssp585": "SSP5-8.5"}[ssp]
    return {
        "group": "climate", "year": int(period[-4:]),
        "title": {"ru": f"{names[0]} {period} ({ssp_h}, ансамбль)", "en": f"{names[1]} {period} ({ssp_h}, ensemble)"},
        "group_title": {"ru": "Климат", "en": "Climate"},
        "value_label": {"ru": names[0], "en": names[1]},
        "unit": {"ru": names[2], "en": names[2].replace("мм/год", "mm/year")},
        "ensemble": [{"url": f"{WC_FUT}/wc2.1_10m_bioc_{m}_{ssp}_{period}.zip",
                      "file": f"worldclim_fut/wc2.1_10m_bioc_{m}_{ssp}_{period}.tif"} for m in CMIP6_MODELS],
        "band": band,
        "source": f"WorldClim 2.1 CMIP6 {ssp_h} {period}, среднее {len(CMIP6_MODELS)} моделей (некоммерческое использование)",
        "agg": "mean", "regions": True,
        "view": {"palette": names[3], "scale": names[4]},
    }


DATASETS = {
    **{f"pop{y}": _pop(y) for y in range(1975, 2031, 5)},
    **{f"pop{y}": _pop_forecast(y) for y in (2040, 2060, 2080, 2100)},
    "built2020": {
        "group": "built", "year": 2020,
        "value_label": {"ru": "Застройка", "en": "Built-up"},
        "title": {"ru": "Застройка 2020", "en": "Built-up 2020"},
        "group_title": {"ru": "Застройка", "en": "Built-up"},
        "unit": {"ru": "% площади", "en": "% of area"},
        "url": f"{GHSL}/GHS_BUILT_S_GLOBE_R2023A/GHS_BUILT_S_E2020_GLOBE_R2023A_4326_30ss/V1-0/"
               "GHS_BUILT_S_E2020_GLOBE_R2023A_4326_30ss_V1_0.zip",
        "file": "ghs_built_2020/GHS_BUILT_S_E2020_GLOBE_R2023A_4326_30ss_V1_0.tif",
        "source": "GHSL GHS-BUILT-S E2020 R2023A (JRC, CC BY 4.0)",
        # сумма м² застройки / км² ячейки → м²/км²; ×1e-4 → % площади
        "agg": "sum", "factor": 1e-4, "regions": True,
        "view": {"palette": "ice", "scale": "sqrt"},
    },
    "lights2016": {
        "group": "lights", "year": 2016,
        "value_label": {"ru": "Яркость огней", "en": "Brightness"},
        "title": {"ru": "Ночные огни 2016", "en": "Night lights 2016"},
        "group_title": {"ru": "Ночные огни", "en": "Night lights"},
        "unit": {"ru": "яркость 0–255", "en": "brightness 0–255"},
        "url": "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144897/"
               "BlackMarble_2016_3km_gray_geo.tif",
        "file": "blackmarble/BlackMarble_2016_3km_gray_geo.tif",
        "source": "NASA Earth Observatory, Black Marble 2016",
        "agg": "mean", "clip_min": 1, "regions": True,
        "view": {"palette": "neon", "scale": "linear"},
    },
    "relief": {
        "group": "relief", "year": 2022,
        "value_label": {"ru": "Высота", "en": "Elevation"},
        "title": {"ru": "Рельеф суши", "en": "Land relief"},
        "group_title": {"ru": "Рельеф", "en": "Relief"},
        "unit": {"ru": "м над уровнем моря", "en": "m above sea level"},
        "url": "https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/"
               "ETOPO_2022_v1_60s_N90W180_surface.nc",
        "file": "etopo/ETOPO_2022_v1_60s_N90W180_surface.nc",
        "source": "NOAA NCEI ETOPO 2022 60″ (public domain)",
        "agg": "mean", "clip_min": 0, "regions": True,
        "view": {"palette": "relief", "scale": "linear"},
    },
    "temp": {
        "group": "climate", "year": 2000,
        "title": {"ru": "Температура (средняя за год)", "en": "Mean annual temperature"},
        "value_label": {"ru": "Температура", "en": "Temperature"},
        "group_title": {"ru": "Климат", "en": "Climate"},
        "unit": {"ru": "°C", "en": "°C"},
        "url": "https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_bio.zip",
        "file": "worldclim/wc2.1_10m_bio_1.tif",
        "source": "WorldClim 2.1, 1970–2000 (некоммерческое использование)",
        "agg": "mean", "regions": True,
        "view": {"palette": "viridis", "scale": "linear"},
    },
    "precip": {
        "group": "climate", "year": 2000,
        "title": {"ru": "Осадки за год", "en": "Annual precipitation"},
        "value_label": {"ru": "Осадки", "en": "Precipitation"},
        "group_title": {"ru": "Климат", "en": "Climate"},
        "unit": {"ru": "мм/год", "en": "mm/year"},
        "url": "https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_bio.zip",
        "file": "worldclim/wc2.1_10m_bio_12.tif",
        "source": "WorldClim 2.1, 1970–2000 (некоммерческое использование)",
        "agg": "mean", "regions": True,
        "view": {"palette": "ice", "scale": "sqrt"},
    },
    "temp2050": _climate_future("temp", "ssp245", "2041-2060"),
    "temp2090": _climate_future("temp", "ssp585", "2081-2100"),
    "precip2050": _climate_future("precip", "ssp245", "2041-2060"),
    "ships": {
        "country_stats": False,   # набор про море: среднее по суше страны — несколько портовых ячеек, смысла нет
        "group": "ships", "year": 2021,
        "title": {"ru": "Морские пути (плотность судов)", "en": "Shipping lanes (ship density)"},
        "group_title": {"ru": "Морские пути", "en": "Shipping"},
        "value_label": {"ru": "Плотность судов", "en": "Ship density"},
        "unit": {"ru": "сигналов AIS/км²", "en": "AIS positions/km²"},
        "url": "https://datacatalogfiles.worldbank.org/ddh-published/0037580/DR0045406/shipdensity_global.zip",
        "file": "ships/shipdensity_global.tif",
        "source": "World Bank / IMF Global Shipping Traffic Density 2015–2021 (CC BY 4.0)",
        "agg": "sum", "regions": False,
        "view": {"palette": "ice", "scale": "log"},
    },
    "co2_2025": {
        "group": "co2", "year": 2025,
        "title": {"ru": "Выбросы CO₂ 2025", "en": "CO₂ emissions 2025"},
        "group_title": {"ru": "Выбросы CO₂", "en": "CO₂ emissions"},
        "value_label": {"ru": "Выбросы CO₂", "en": "CO₂ emissions"},
        "unit": {"ru": "т CO₂/км² в год", "en": "t CO₂/km²·yr"},
        "url": "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/EDGAR/datasets/EDGAR_2026_GHG/CO2/TOTALS/emi_nc/"
               "EDGAR_2026_GHG_CO2_2025_TOTALS_emi_nc.zip",
        "file": "edgar/EDGAR_2026_GHG_CO2_2025_TOTALS_emi.nc",
        "source": "EDGAR 2026 GHG (JRC/IEA), CO₂ все сектора, 0.1° (CC BY-NC-ND 4.0)",
        "agg": "sum", "regions": True,
        "total_label": {"ru": "Выбросы мира, т CO₂", "en": "World emissions, t CO₂"},
        "view": {"palette": "inferno", "scale": "log"},
    },
    # Индекс развития (Kummu 2018, Dryad) и PM2.5 (GlobalHighPM2.5, Zenodo) — отложены 08.10.2026:
    # Dryad отдаёт файлы только с авторизацией (401), Zenodo ограничил наш адрес (403 «unusual traffic»).
    "gdp2024": {
        "group": "gdp", "year": 2024,
        "title": {"ru": "ВВП на км² (2024, ППС)", "en": "GDP per km² (2024, PPP)"},
        "value_label": {"ru": "ВВП на км²", "en": "GDP per km²"},
        "group_title": {"ru": "ВВП", "en": "GDP"},
        "unit": {"ru": "$ ППС/км²", "en": "PPP $/km²"},
        "url": f"{GDP_ZENODO}/rast_gdpTot_1990_2024_5arcmin.tif/content",
        "file": "gdp/rast_gdpTot_1990_2024_5arcmin.tif",
        "band": 35,  # полосы 1990…2024
        "source": "Kummu, Kosonen, Masoumzadeh Sayyar 2025, Sci Data 12:178 (CC BY 4.0)",
        "agg": "sum", "regions": True,
        "total_label": {"ru": "ВВП мира (ППС)", "en": "World GDP (PPP)"},
        "view": {"palette": "viridis", "scale": "log"},
    },
    "gdppc2024": {
        "country_weight": "pop2025",   # «на душу»: среднее по стране взвешивается населением, а не площадью
        "group": "gdp", "year": 2024,
        "title": {"ru": "ВВП на душу (2024, ППС)", "en": "GDP per capita (2024, PPP)"},
        "value_label": {"ru": "ВВП на душу", "en": "GDP per capita"},
        "group_title": {"ru": "ВВП", "en": "GDP"},
        "unit": {"ru": "$ ППС/чел", "en": "PPP $/person"},
        "url": f"{GDP_ZENODO}/rast_adm2_gdp_perCapita_1990_2024.tif/content",
        "file": "gdp/rast_adm2_gdp_perCapita_1990_2024.tif",
        "band": 35,
        "source": "Kummu, Kosonen, Masoumzadeh Sayyar 2025, Sci Data 12:178 (CC BY 4.0)",
        "agg": "mean", "regions": True,
        "view": {"palette": "viridis", "scale": "sqrt"},
    },
}

# Наборы «по странам» (3D-картограмма): значение на страну, ISO3
COUNTRY_DATASETS = {
    "wb_gdp": {
        "group": "gdp",
        "title": {"ru": "ВВП стран (World Bank)", "en": "GDP by country (World Bank)"},
        "unit": {"ru": "$ (текущие)", "en": "current US$"},
        "indicator": "NY.GDP.MKTP.CD",
        "source": "World Bank WDI NY.GDP.MKTP.CD (CC BY 4.0)",
    },
    "wb_gdppc": {
        "group": "gdp",
        "title": {"ru": "ВВП на душу (World Bank)", "en": "GDP per capita (World Bank)"},
        "unit": {"ru": "$ на человека", "en": "US$ per person"},
        "indicator": "NY.GDP.PCAP.CD",
        "source": "World Bank WDI NY.GDP.PCAP.CD (CC BY 4.0)",
    },
}

# Наборы по регионам стран (admin-1, ключ — ISO 3166-2): официальная статистика
ROSSTAT = "https://rosstat.gov.ru/storage/mediabank"
REGION_DATASETS = {
    "rosstat_vrp": {
        "group": "gdp", "country": "RUS",
        "title": {"ru": "ВРП регионов России (Росстат)", "en": "Russia GRP by region (Rosstat)"},
        "unit": {"ru": "₽", "en": "RUB"},
        "url": f"{ROSSTAT}/VRP_s1998.xlsx", "file": "rosstat/VRP_s1998.xlsx", "sheets": ["1", "2"], "factor": 1e6,
        "source": "Росстат, ВРП по субъектам РФ 1998–2024 (в основных ценах), rosstat.gov.ru",
    },
    "rosstat_vrp_pc": {
        "group": "gdp", "country": "RUS",
        "title": {"ru": "ВРП на душу, регионы России (Росстат)", "en": "Russia GRP per capita by region (Rosstat)"},
        "unit": {"ru": "₽ на человека", "en": "RUB per person"},
        "url": f"{ROSSTAT}/VRP_s1998.xlsx", "file": "rosstat/VRP_s1998.xlsx", "sheets": ["3", "4"], "factor": 1.0,
        "source": "Росстат, ВРП на душу населения по субъектам РФ 1998–2024, rosstat.gov.ru",
    },
    "rosstat_pop": {
        "group": "pop", "country": "RUS",
        "title": {"ru": "Население регионов России (Росстат)", "en": "Russia population by region (Rosstat)"},
        "unit": {"ru": "чел.", "en": "people"},
        "url": f"{ROSSTAT}/PrPopul2025_Site.xlsx", "file": "rosstat/PrPopul2025_Site.xlsx", "kind": "population",
        "source": "Росстат, предварительная оценка численности на 1 января 2025, rosstat.gov.ru",
    },
}
# Сертификаты Минцифры (Russian Trusted Root/Sub CA, включая Sub CA 2024): у госсайтов РФ цепочка от НУЦ
GOV_CA = "certs/russian_trusted_ca.pem"

# Глобальные уровни детализации, градусы (берутся не мельче разрешения источника)
GLOBAL_LEVELS = [1.0, 0.5, 0.25, 0.1]
# Кандидаты для регионов: берутся два самых подробных, доступных по разрешению источника
REGION_LEVELS = [0.25, 0.1, 0.05]

# Регионы-фокусы: страна вырезается по границе Natural Earth (ADM0_A3)
REGIONS = {
    "RUS": {
        "title": {"ru": "Россия", "en": "Russia"},
        "levels": [0.1, 0.05],
        # камера по умолчанию для карты (вид с юго-запада, как на макетах)
        "view": {"longitude": 64, "latitude": 50, "zoom": 3.0, "pitch": 62, "bearing": 30},
        # на глобусе — сверху над центром страны (иначе она лежит ребром у горизонта)
        "globe_view": {"longitude": 92, "latitude": 56, "zoom": 2.5, "pitch": 30, "bearing": 0},
    },
    # ЕАЭС и Центральная Азия: ракурс камеры считается по границам страны (region.auto_view)
    "KAZ": {"title": {"ru": "Казахстан", "en": "Kazakhstan"}, "levels": [0.1, 0.05]},
    "BLR": {"title": {"ru": "Беларусь", "en": "Belarus"}, "levels": [0.1, 0.05], "city_min_pop": 100_000},
    "KGZ": {"title": {"ru": "Киргизия", "en": "Kyrgyzstan"}, "levels": [0.1, 0.05], "city_min_pop": 50_000},
    "ARM": {"title": {"ru": "Армения", "en": "Armenia"}, "levels": [0.1, 0.05], "city_min_pop": 30_000},
    "UZB": {"title": {"ru": "Узбекистан", "en": "Uzbekistan"}, "levels": [0.1, 0.05], "city_min_pop": 100_000},
    "TJK": {"title": {"ru": "Таджикистан", "en": "Tajikistan"}, "levels": [0.1, 0.05], "city_min_pop": 50_000},
}


# ── Лицензии источников (проверены по первоисточникам 09.10.2026, см. DATA_SOURCES.md) ──────────────────────
# restricted=True — лицензия НЕ разрешает коммерческое использование и/или распространение производных данных:
# pipeline собирает такие наборы только с флагом --include-restricted (пользователь сам отвечает за соблюдение).
CC_BY = "https://creativecommons.org/licenses/by/4.0/"
LICENSES = {
    "ghsl_pop": {"id": "CC-BY-4.0", "name": "CC BY 4.0 (© European Union)", "url": CC_BY, "restricted": False,
                 "cite": "Schiavina M., Freire S., Carioli A., MacManus K. (2023): GHS-POP R2023A — GHS population grid "
                         "multitemporal (1975-2030). European Commission, JRC. doi:10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE"},
    "ghsl_built": {"id": "CC-BY-4.0", "name": "CC BY 4.0 (© European Union)", "url": CC_BY, "restricted": False,
                   "cite": "GHS-BUILT-S R2023A — GHS built-up surface grid (1975-2030). European Commission, JRC. "
                           "doi:10.2905/9F06F36F-4B11-47EC-ABB0-4F8B7B1D72EA"},
    "worldpop": {"id": "CC-BY-4.0", "name": "CC BY 4.0", "url": CC_BY, "restricted": False,
                 "cite": "Bondarenko M. et al. (2025): Global 1km-grid population projections for 2025-2100 consistent "
                         "with the SSP 3.2 national population projections, v0.2. WorldPop. doi:10.5258/SOTON/WP00849"},
    "nasa": {"id": "NASA-media", "name": "NASA media guidelines (not copyrighted, credit NASA)", "restricted": False,
             "url": "https://www.nasa.gov/nasa-brand-center/images-and-media/",
             "cite": "NASA Earth Observatory / Joshua Stevens; Suomi NPP VIIRS data courtesy Miguel Román, NASA GSFC"},
    "noaa": {"id": "US-PD", "name": "Public domain (U.S. Government work)", "restricted": False,
             "url": "https://www.ncei.noaa.gov/products/etopo-global-relief-model",
             "cite": "NOAA NCEI (2022): ETOPO 2022 Global Relief Model. doi:10.25921/fd45-gt74"},
    "worldclim": {"id": "WorldClim-NC", "name": "WorldClim: academic & non-commercial use only, no redistribution",
                  "url": "https://www.worldclim.org/about.html", "restricted": True,
                  "cite": "Fick S.E., Hijmans R.J. (2017): WorldClim 2: new 1-km spatial resolution climate surfaces "
                          "for global land areas. Int. J. Climatology 37(12):4302-4315"},
    "edgar_co2": {"id": "CC-BY-NC-ND-4.0", "name": "CC BY-NC-ND 4.0 (IEA-EDGAR CO₂)",
                  "url": "https://creativecommons.org/licenses/by-nc-nd/4.0/", "restricted": True,
                  "cite": "EDGAR Community GHG Database (IEA-EDGAR CO2), version EDGAR_2026_GHG (2026). "
                          "European Commission, JRC; IEA"},
    "wb_ships": {"id": "CC-BY-4.0", "name": "CC BY 4.0", "url": CC_BY, "restricted": False,
                 "cite": "The World Bank: Global Shipping Traffic Density (2015-2021); IMF World Seaborne Trade Monitoring "
                         "System (Cerdeiro, Komaromi, Liu, Saeed 2020)"},
    "kummu": {"id": "CC-BY-4.0", "name": "CC BY 4.0", "url": CC_BY, "restricted": False,
              "cite": "Kummu M., Kosonen M., Masoumzadeh Sayyar S. (2025): Downscaled gridded global dataset for GDP "
                      "per capita PPP over 1990-2022. Scientific Data 12:178. doi:10.1038/s41597-025-04487-x"},
    "wb_wdi": {"id": "CC-BY-4.0", "name": "CC BY 4.0 (World Bank terms of use)", "restricted": False,
               "url": "https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets",
               "cite": "The World Bank: World Development Indicators"},
    "rosstat": {"id": "RU-official-statistics", "name": "Официальная статистика Росстата (открытая публикация, со ссылкой)",
                "url": "https://rosstat.gov.ru/", "restricted": False,
                "cite": "Федеральная служба государственной статистики (Росстат), rosstat.gov.ru"},
}
_LIC_OF = {**{f"pop{y}": "ghsl_pop" for y in range(1975, 2031, 5)}, **{f"pop{y}": "worldpop" for y in (2040, 2060, 2080, 2100)},
           "built2020": "ghsl_built", "lights2016": "nasa", "relief": "noaa",
           **{k: "worldclim" for k in ("temp", "precip", "temp2050", "temp2090", "precip2050")},
           "ships": "wb_ships", "co2_2025": "edgar_co2", "gdp2024": "kummu", "gdppc2024": "kummu"}
for _k, _d in DATASETS.items():
    _d["license"] = LICENSES[_LIC_OF[_k]]
for _d in COUNTRY_DATASETS.values():
    _d["license"] = LICENSES["wb_wdi"]
for _d in REGION_DATASETS.values():
    _d["license"] = LICENSES["rosstat"]


def level_name(res: float) -> str:
    return str(res).replace(".", "p")
