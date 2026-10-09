"""Интеграционные проверки реального результата pipeline (web/public/data).

Проверяем правду о мире, а не «файл существует»: численность населения, где пусто,
где самые плотные места, корректность подписей RU/EN.
"""
import json
from pathlib import Path

import numpy as np
import pytest

DATA = Path(__file__).resolve().parents[2] / "web/public/data"

pytestmark = pytest.mark.skipif(not (DATA / "catalog.json").exists(),
                                reason="нет данных: запустите prepare.py")


def load(name, ds="pop2025"):
    meta = json.loads((DATA / ds / f"{name}.json").read_text())
    arr = np.fromfile(DATA / ds / meta["file"], dtype=np.float32).reshape(meta["height"], meta["width"])
    return meta, arr


def at(meta, arr, lon, lat):
    r = int((meta["north"] - lat) // meta["res"])
    c = int((lon - meta["west"]) // meta["res"])
    return float(arr[r, c])


LEVELS = ["g_1p0", "g_0p5", "g_0p25", "g_0p1"]

# Мегаполисы с самой высокой плотностью (lon, lat)
DENSE = {"Дакка": (90.41, 23.81), "Мумбаи": (72.88, 19.08), "Каир": (31.24, 30.04),
         "Карачи": (67.01, 24.86), "Манила": (120.98, 14.6), "Гонконг": (114.17, 22.32),
         "Калькутта": (88.36, 22.57), "Дели": (77.21, 28.61), "Лагос": (3.38, 6.52),
         "Киншаса": (15.31, -4.33), "Сеул": (126.98, 37.57), "Джакарта": (106.85, -6.2),
         "Шанхай": (121.47, 31.23), "Бангалор": (77.59, 12.97), "Гуанчжоу": (113.26, 23.13),
         "Хошимин": (106.66, 10.76)}


@pytest.mark.parametrize("name", LEVELS)
def test_world_population_is_realistic(name):
    meta, _ = load(name)
    assert 7.9e9 < meta["total_population"] < 8.4e9  # ООН 2025: ~8.2 млрд


@pytest.mark.parametrize("name", LEVELS)
def test_grid_shape_and_values(name):
    meta, arr = load(name)
    assert arr.shape == (round(180 / meta["res"]), round(360 / meta["res"]))
    assert np.isfinite(arr).all() and (arr >= 0).all()


def test_empty_places_are_empty():
    meta, arr = load("g_0p25")
    assert at(meta, arr, -140.0, 0.0) == 0        # Тихий океан
    assert at(meta, arr, -30.0, 30.0) == 0        # Атлантика
    assert at(meta, arr, 0.0, -85.0) == 0         # Антарктида
    assert at(meta, arr, 13.0, 23.0) < 1          # Сахара (Ливия)
    assert at(meta, arr, 135.0, -25.0) < 1        # центр Австралии


def test_known_places_are_dense():
    meta, arr = load("g_0p25")
    assert at(meta, arr, 90.41, 23.81) > 5000      # Дакка
    assert at(meta, arr, 37.62, 55.75) > 1000      # Москва
    # негатив: Москва плотнее Сибири, Дакка плотнее Монголии
    assert at(meta, arr, 100.0, 62.0) < 1
    assert at(meta, arr, 103.0, 46.0) < 10


def test_densest_cells_are_megacities():
    meta, arr = load("g_0p1")
    top = np.argsort(arr, axis=None)[::-1][:12]
    for idx in top:
        r, c = np.unravel_index(idx, arr.shape)
        lat = 90 - (r + 0.5) * meta["res"]
        lon = -180 + (c + 0.5) * meta["res"]
        dist = min(np.hypot(lon - x, lat - y) for x, y in DENSE.values())
        assert dist < 0.5, f"пик плотности ({lon:.2f},{lat:.2f}) не у известного мегаполиса"


def test_cities_labels():
    cities = json.loads((DATA / "cities.json").read_text())
    by_en = {c["en"]: c for c in cities}
    assert by_en["Moscow"]["ru"] == "Москва"
    assert by_en["Tokyo"]["ru"] == "Токио"
    assert by_en["Moscow"]["country_ru"] == "Россия"
    assert by_en["Moscow"]["capital"] is True
    assert cities[0]["pop"] >= cities[-1]["pop"]
    assert all(-180 <= c["lon"] <= 180 and -90 <= c["lat"] <= 90 for c in cities)
    assert "Atlantis" not in by_en  # негатив: несуществующего города нет


def test_countries_labels():
    countries = {c["iso3"]: c for c in json.loads((DATA / "countries.json").read_text())}
    ru = countries["RUS"]
    assert ru["ru"] == "Россия" and ru["en"] == "Russia"
    assert 16e6 < ru["area_km2"] < 18e6              # 17,1 млн км²
    assert 5 < ru["density"] < 12
    assert countries["BGD"]["density"] > 1000        # Бангладеш — одна из самых плотных
    assert countries["MNG"]["density"] < 5           # Монголия — одна из самых редких


def test_catalog_lists_datasets_and_regions():
    cat = json.loads((DATA / "catalog.json").read_text())
    by = {d["id"]: d for d in cat["datasets"]}
    assert {f"pop{y}" for y in range(1975, 2031, 5)} <= set(by)
    for d in cat["datasets"]:
        assert d["title"]["ru"] and d["title"]["en"] and d["unit"]["ru"] and d["group"]
        for lv in d["levels"] + [x for v in d["regions"].values() for x in v]:
            assert (DATA / d["id"] / f"{lv['name']}.bin").exists(), lv
    assert [lv["name"] for lv in by["pop2025"]["levels"]] == LEVELS
    assert [r["name"] for r in by["pop2025"]["regions"]["RUS"]] == ["RUS_0p1", "RUS_0p05"]
    # уровни не мельче разрешения источника: WorldClim 10′ (0.167°) — без 0.1°
    if "temp" in by:
        assert [lv["res"] for lv in by["temp"]["levels"]] == [1.0, 0.5, 0.25]
        assert [r["res"] for r in by["temp"]["regions"]["RUS"]] == [0.25]
    assert {c["id"] for c in cat["country_datasets"]} == {"wb_gdp", "wb_gdppc"}
    assert cat["regions"][0]["iso3"] == "RUS" and (DATA / cat["regions"][0]["outline"]).exists()


@pytest.mark.parametrize("name", LEVELS)
def test_world_1975_population(name):
    meta, _ = load(name, "pop1975")
    assert 3.9e9 < meta["total_population"] < 4.2e9  # ООН 1975: ~4.07 млрд


@pytest.mark.parametrize("ds,lo,hi", [("pop2025", 138e6, 150e6), ("pop1975", 128e6, 140e6)])
@pytest.mark.parametrize("name", ["RUS_0p1", "RUS_0p05"])
def test_russia_population(ds, lo, hi, name):
    meta, arr = load(name, ds)
    assert lo < meta["total_population"] < hi
    assert np.isnan(arr).any() and np.isfinite(arr).any()


def test_russia_mask():
    meta, arr = load("RUS_0p1")
    assert at(meta, arr, 37.62, 55.75) > 5000            # Москва
    assert np.isfinite(at(meta, arr, 20.5, 54.7))        # Калининград (эксклав)
    assert np.isfinite(at(meta, arr, 177.5, 64.7))       # Анадырь
    assert np.isfinite(at(meta, arr, 360 - 169.8, 66.1))  # Уэлен — за антимеридианом, долгота 190.2
    # негатив: соседние страны вырезаны
    assert np.isnan(at(meta, arr, 71.43, 51.13))         # Астана
    assert np.isnan(at(meta, arr, 27.56, 53.9))          # Минск
    assert np.isnan(at(meta, arr, 126.6, 45.7))          # Харбин


def test_russia_peak_is_moscow():
    meta, arr = load("RUS_0p05")
    r, c = np.unravel_index(np.nanargmax(arr), arr.shape)
    lat = meta["north"] - (r + 0.5) * meta["res"]
    lon = meta["west"] + (c + 0.5) * meta["res"]
    assert abs(lon - 37.62) < 0.5 and abs(lat - 55.75) < 0.4, f"пик ({lon:.2f},{lat:.2f}) не в Москве"


def test_moscow_grew_since_1975():
    m25, a25 = load("RUS_0p1", "pop2025")
    m75, a75 = load("RUS_0p1", "pop1975")
    assert at(m25, a25, 37.62, 55.75) > at(m75, a75, 37.62, 55.75)


def test_cities_have_iso3():
    cities = {c["en"]: c for c in json.loads((DATA / "cities.json").read_text())}
    assert cities["Moscow"]["iso3"] == "RUS" and cities["Paris"]["iso3"] == "FRA"


# --- новые наборы: проверки «правды о мире» (позитив + негатив) ---

def _has(ds):
    return (DATA / ds / "g_0p25.json").exists()


def _at25(ds, lon, lat):
    meta, arr = load("g_0p25", ds)
    return at(meta, arr, lon, lat)


@pytest.mark.skipif(not _has("pop2030"), reason="нет pop2030")
def test_population_epochs_grow():
    totals = [json.loads((DATA / f"pop{y}" / "g_1p0.json").read_text())["total_population"] for y in range(1975, 2031, 5)]
    assert all(b > a for a, b in zip(totals, totals[1:])), "население мира должно расти от эпохи к эпохе"
    assert 6.0e9 < totals[5] < 6.3e9    # 2000: ООН ~6.1 млрд
    assert 8.3e9 < totals[-1] < 8.8e9   # 2030: прогноз ~8.5 млрд


@pytest.mark.skipif(not _has("built2020"), reason="нет built2020")
def test_built_up():
    meta, _ = load("g_0p25", "built2020")
    assert 3e11 < meta["total_population"] < 3e12          # м² застройки в мире (0.3–3 млн км²)
    m01, a01 = load("g_0p1", "built2020")
    assert at(m01, a01, 90.45, 23.75) > 20                 # центр Дакки (ячейка 0.1°): >20% застроено
    assert not (_at25("built2020", 13.0, 23.0) > 0.1)      # Сахара — нет застройки (негатив)


@pytest.mark.skipif(not _has("lights2016"), reason="нет lights2016")
def test_night_lights():
    seoul, pyongyang = _at25("lights2016", 126.98, 37.57), _at25("lights2016", 125.75, 39.03)
    assert seoul > 100
    assert seoul > 3 * (pyongyang if np.isfinite(pyongyang) else 0)   # КНДР тёмная (негатив)
    assert not (_at25("lights2016", -140.0, 0.0) > 5)                 # океан тёмный


@pytest.mark.skipif(not _has("relief"), reason="нет relief")
def test_relief():
    meta, arr = load("g_0p1", "relief")
    assert at(meta, arr, 86.92, 27.99) > 5000            # район Эвереста
    assert 80 < at(meta, arr, 37.62, 55.75) < 300        # Москва
    assert np.isnan(at(meta, arr, -140.0, 0.0))          # океан — пусто (clip_min 0)


@pytest.mark.skipif(not _has("temp"), reason="нет temp")
def test_temperature():
    assert _at25("temp", -3.0, 16.77) > 27               # Томбукту — одно из самых жарких мест
    assert _at25("temp", 0.0, -80.0) < -30               # Антарктида
    assert 3 < _at25("temp", 37.62, 55.75) < 8           # Москва, 1970–2000
    meta, _ = load("g_0p25", "temp")
    assert meta["min_value"] < -40 and meta["total_population"] is None   # среднее, не сумма


@pytest.mark.skipif(not _has("precip"), reason="нет precip")
def test_precipitation():
    assert _at25("precip", 91.73, 25.27) > 2500          # Черрапунджи / Шиллонг
    assert _at25("precip", -69.5, -24.0) < 100           # Атакама (негатив)


@pytest.mark.skipif(not _has("gdp2024"), reason="нет gdp2024")
def test_gdp_grid():
    meta, _ = load("g_0p25", "gdp2024")
    assert 1.5e14 < meta["total_population"] < 2.5e14    # мировой ВВП ППС ~$190–200 трлн
    assert _at25("gdp2024", 37.62, 55.75) > 100 * max(_at25("gdp2024", 100.0, 62.0), 1)  # Москва ≫ тайга


@pytest.mark.skipif(not _has("gdppc2024"), reason="нет gdppc2024")
def test_gdp_per_capita():
    assert _at25("gdppc2024", 8.54, 47.37) > 60000       # Цюрих
    assert _at25("gdppc2024", 8.54, 47.37) > 10 * _at25("gdppc2024", 15.05, 12.13)   # Цюрих ≫ Нджамена
    assert _at25("gdppc2024", 18.0, 14.0) < 4000         # сельский Чад


def test_world_bank_countries():
    p = DATA / "countries" / "wb_gdp.json"
    if not p.exists():
        pytest.skip("нет wb_gdp")
    v = json.loads(p.read_text())["values"]
    codes = [x["iso3"] for x in v]
    assert codes[0] == "USA" and len(v) > 180
    assert "WLD" not in codes and "OED" not in codes     # агрегаты отброшены (негатив)
    pc = {x["iso3"]: x["value"] for x in json.loads((DATA / "countries" / "wb_gdppc.json").read_text())["values"]}
    assert pc["CHE"] > 10 * pc["IND"]
    # временной ряд 2000–2025: Россия 2015 ≈ $1,36 трлн, 2024 ≈ $2,19 трлн (WDI), шкала общая на все годы
    d = json.loads(p.read_text())
    assert d["years"][0] == 2000 and d["years"][-1] >= 2024
    ru = {y: next(v["value"] for v in d["series"][str(y)] if v["iso3"] == "RUS") for y in (2015, 2024)}
    assert 1.2e12 < ru[2015] < 1.5e12 and 2.0e12 < ru[2024] < 2.4e12
    assert d["max_value"] == max(v["value"] for vs in d["series"].values() for v in vs)


def test_eaeu_regions():
    cat = json.loads((DATA / "catalog.json").read_text())
    regs = {r["iso3"]: r for r in cat["regions"]}
    assert {"RUS", "KAZ", "BLR", "KGZ", "ARM", "UZB", "TJK"} <= set(regs)
    for iso, (lo, hi) in {"KAZ": (17e6, 23e6), "BLR": (8.5e6, 10.5e6), "ARM": (2.5e6, 3.3e6),
                          "KGZ": (6e6, 8e6), "UZB": (32e6, 39e6), "TJK": (9e6, 11.5e6)}.items():
        meta, arr = load(f"{iso}_0p05")
        assert lo < meta["total_population"] < hi, f"{iso}: {meta['total_population'] / 1e6:.1f} млн"
        assert regs[iso]["extent_km"] > 100 and 2 < regs[iso]["view"]["zoom"] < 8
    m, a = load("KAZ_0p1")
    assert np.isfinite(at(m, a, 76.9, 43.25))      # Алматы — внутри
    assert np.isnan(at(m, a, 69.24, 41.3))         # Ташкент — вне маски Казахстана (негатив)


def test_iso_codes_for_api():
    p = DATA / "iso_codes.json"
    if not p.exists():
        pytest.skip("нет iso_codes.json")
    m = json.loads(p.read_text())
    assert m["RUS"] == "RUS" and m["SSD"] == "SDS" and m["XKX"] == "KOS" and "XYZ" not in m


def test_country_short_names_for_labels():
    c = {x["iso3"]: x for x in json.loads((DATA / "countries.json").read_text())}
    assert c["CHN"]["ru"] == "Китай" and c["CHN"]["en"] == "China"
    assert c["ARE"]["ru"] == "ОАЭ" and c["DEU"]["ru"] == "Германия"


RAW = Path(__file__).resolve().parents[2] / "data/raw"


@pytest.mark.skipif(not (RAW / "ghs_built_2020").exists(), reason="нет сырого растра")
def test_aggregation_matches_raw_pixels():
    """Сверка агрегации с исходными пикселями GHSL: ячейка 0.1° = сумма её 144 пикселей / площадь."""
    import math
    import rasterio
    from rasterio.windows import from_bounds
    m, a = load("g_0p1", "built2020")
    with rasterio.open(RAW / "ghs_built_2020/GHS_BUILT_S_E2020_GLOBE_R2023A_4326_30ss_V1_0.tif") as s:
        w = from_bounds(90.4, 23.7, 90.5, 23.8, s.transform).round_offsets().round_lengths()
        raw = s.read(1, window=w).astype(float)
    area = 6371.0088 ** 2 * math.radians(0.1) * (math.sin(math.radians(23.8)) - math.sin(math.radians(23.7)))
    assert raw.size == 144
    assert at(m, a, 90.45, 23.75) == pytest.approx(raw.sum() / area / 1e6 * 100, rel=1e-4)


def test_city_fixes():
    by = {(c["iso3"], c["en"]): c for c in json.loads((DATA / "cities.json").read_text())}
    assert by[("KAZ", "Almaty")]["ru"] == "Алматы"
    astana = by[("KAZ", "Astana")]
    assert astana["ru"] == "Астана" and astana["pop"] > 1_000_000 and astana["capital"] is True
    assert ("KAZ", "Nur-Sultan") not in by   # старое имя не осталось


# --- регионы (admin-1) и Росстат ---

def _region(name):
    return json.loads((DATA / "regiondata" / f"{name}.json").read_text())


def test_admin1_boundaries_and_fixes():
    labels = {r["code"]: r for r in json.loads((DATA / "admin1_labels.json").read_text())}
    by_iso = {}
    for r in labels.values():
        by_iso[r["iso3"]] = by_iso.get(r["iso3"], 0) + 1
    assert by_iso["RUS"] == 85 and by_iso["KAZ"] >= 14 and by_iso["BLR"] == 7 and by_iso["ARM"] == 11
    # исправления Natural Earth: город Москва — RU-MOW (полигон маленький), область — RU-MOS; два разных Алтая
    assert labels["RU-MOW"]["ru"] == "Москва" and labels["RU-MOS"]["ru"] == "Московская область"
    assert labels["RU-ALT"]["ru"] == "Алтайский край" and labels["RU-AL"]["ru"] == "Республика Алтай"
    assert "RU-X01~" not in labels                                   # безымянный фрагмент выброшен
    assert labels["KZ-ALA"]["ru"] == "Алматы" and labels["KZ-AST"]["ru"] == "Астана"   # не «Алма-Ата»/«Нур-Султан»
    assert abs(labels["RU-MOW"]["lon"] - 37.6) < 0.6 and abs(labels["RU-MOW"]["lat"] - 55.75) < 0.5


def test_rosstat_vrp_matches_russia_total():
    d = _region("rosstat_vrp")
    assert d["count"] == 85 and d["years"][0] == 1998 and d["years"][-1] >= 2023
    s2023 = sum(v["value"] for v in d["series"]["2023"])
    assert 160e12 < s2023 < 166e12          # итог РФ 2023 у Росстата — 163,02 трлн ₽ (сверено: расхождение 0)
    top = d["series"]["2023"][0]
    assert top["code"] == "RU-MOW"           # Москва — крупнейший ВРП
    codes = {v["code"] for v in d["values"]}
    assert not any("федер" in c.lower() for c in codes) and len(codes) == 85   # без округов и итогов (негатив)


def test_rosstat_vrp_per_capita_and_population():
    pc = {v["code"]: v["value"] for v in _region("rosstat_vrp_pc")["series"]["2023"]}
    assert pc["RU-YAN"] > 8e6 and pc["RU-IN"] < 3e5 and pc["RU-YAN"] > 30 * pc["RU-IN"]
    pop = _region("rosstat_pop")
    assert pop["years"] == [2025] and sum(v["value"] for v in pop["values"]) == 146_028_325   # = итог РФ в файле
    p = {v["code"]: v["value"] for v in pop["values"]}
    assert 12.5e6 < p["RU-MOW"] < 13.5e6 and p["RU-CHU"] < 60_000


# --- пакет новых наборов (08.10.2026) ---

@pytest.mark.skipif(not _has("co2_2025"), reason="нет co2_2025")
def test_co2_emissions():
    meta, _ = load("g_0p25", "co2_2025")
    assert 35e9 < meta["total_population"] < 45e9          # мировые выбросы CO₂ ~38–40 Гт/год
    assert _at25("co2_2025", 121.47, 31.23) > 100 * max(_at25("co2_2025", 100.0, 62.0), 1e-3)  # Шанхай ≫ тайга


@pytest.mark.skipif(not (_has("temp2090") and _has("temp")), reason="нет климата будущего")
def test_future_warming():
    m0, a0 = load("g_0p25", "temp")
    m1, a1 = load("g_0p25", "temp2090")
    m2, a2 = load("g_0p25", "temp2050")
    both = np.isfinite(a0) & np.isfinite(a1)
    warm2090 = float(np.mean(a1[both] - a0[both]))
    warm2050 = float(np.nanmean(a2[both] - a0[both]))
    assert 3.0 < warm2090 < 8.0            # SSP5-8.5 к 2081–2100: суша теплеет на несколько градусов
    assert 0.8 < warm2050 < warm2090       # SSP2-4.5 к 2041–2060 — заметно меньше (негатив: не «всё одинаково»)
    assert at(m1, a1, 37.62, 55.75) - at(m0, a0, 37.62, 55.75) > 2.5    # Москва


@pytest.mark.skipif(not _has("ships"), reason="нет ships")
def test_shipping_lanes():
    meta, arr = load("g_0p25", "ships")
    malacca = at(meta, arr, 103.8, 1.2)      # Сингапурский пролив — один из самых загруженных
    pacific = at(meta, arr, -150.0, -40.0)   # пустой юг Тихого океана
    taiga = at(meta, arr, 100.0, 62.0)       # суша — не море (негатив)
    assert malacca > 100 * max(pacific if np.isfinite(pacific) else 0, 1)
    assert not (taiga > 0)


@pytest.mark.skipif(not all(_has(f"pop{y}") for y in (2040, 2060, 2080, 2100)), reason="нет прогноза FuturePop")
def test_population_forecast_ssp2():
    totals = {y: load("g_0p25", f"pop{y}")[0]["total_population"] for y in (2025, 2040, 2060, 2080, 2100)}
    assert 8.6e9 < totals[2040] < 9.6e9                 # SSP2: ~9 млрд к 2040
    assert all(8.3e9 < totals[y] < 10.6e9 for y in (2060, 2080, 2100))
    assert totals[2040] > totals[2025]                  # рост продолжается…
    assert max(totals[2060], totals[2080]) >= totals[2100]   # …пик до 2100 (а не бесконечный рост)
    # Лагос растёт, Токио убывает внутри одного источника (негатив: прогноз не «всё масштабировано одинаково»)
    assert _at25("pop2100", 3.38, 6.52) > 1.3 * _at25("pop2040", 3.38, 6.52)
    assert _at25("pop2100", 139.69, 35.69) < _at25("pop2040", 139.69, 35.69)


@pytest.mark.skipif(not (DATA / "co2_2025" / "countries.json").exists(), reason="нет значений по странам")
def test_country_stats_truth():
    v = lambda ds: json.loads((DATA / ds / "countries.json").read_text())["values"]
    co2, pop, temp = v("co2_2025"), v("pop2025"), v("temp")
    assert 10e9 < co2["CHN"][1] < 14e9 and 3.5e9 < co2["USA"][1] < 5.5e9      # EDGAR: Китай ~12 Гт, США ~4,7 Гт
    assert 1.2e9 < pop["CHN"][1] < 1.5e9 and 120e6 < pop["RUS"][1] < 150e6
    assert 7.0e9 < sum(x[1] for x in pop.values()) < 8.3e9                     # прибрежные ячейки частично мимо границ
    assert temp["RUS"][0] < 0 < 20 < temp["IDN"][0] and temp["RUS"][1] is None  # среднее, итога у «средних» наборов нет
    # негатив: подпись CO₂ ≠ плотность населения (сам баг)
    assert abs(co2["IDN"][0] - pop["IDN"][0]) > 50
    # ВВП на душу — взвешен населением (World Bank 2024, ППС: Россия ~47 тыс., Китай ~27, Индия ~11)
    pc = v("gdppc2024")
    assert 38e3 < pc["RUS"][0] < 55e3 and 22e3 < pc["CHN"][0] < 32e3 and 8e3 < pc["IND"][0] < 14e3
    # морские пути по стране не считаются (среднее по суше смысла не имеет)
    assert not (DATA / "ships" / "countries.json").exists()
    # население страны по году набора: 1975 и 2025 различаются (Нигерия выросла в разы)
    p75 = v("pop1975")
    assert pop["NGA"][1] > 2.5 * p75["NGA"][1]
