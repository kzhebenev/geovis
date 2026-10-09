"""Unit-тесты агрегации на синтетическом растре с заранее известным ответом."""
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from geovis_pipeline.grid import EARTH_RADIUS_KM, Grid, aggregate, cell_area_km2


def test_sum_of_cell_areas_is_sphere_area():
    g = Grid(res=1.0, population=np.zeros((180, 360)))
    total = g.area_km2().sum() * 360
    assert total == pytest.approx(4 * np.pi * EARTH_RADIUS_KM**2, rel=1e-9)


def test_cell_area_shrinks_towards_pole():
    eq = cell_area_km2(np.array([1.0]), np.array([0.0]), 1.0)[0]
    polar = cell_area_km2(np.array([89.0]), np.array([88.0]), 1.0)[0]
    assert eq == pytest.approx(12364, rel=1e-3)  # ~111.2 × 111.2 км
    assert polar < eq / 30


def _write_tif(path, data, west, north, px, nodata=None):
    with rasterio.open(path, "w", driver="GTiff", width=data.shape[1], height=data.shape[0],
                       count=1, dtype="float64", crs="EPSG:4326",
                       transform=from_origin(west, north, px, px), nodata=nodata) as dst:
        dst.write(data, 1)


def test_aggregate_preserves_total_and_places_mass(tmp_path):
    # глобальный растр 0.5°, одна «точка» 1000 чел. в Москве, одна 50 — в Сиднее
    a = np.zeros((360, 720))
    a[int((90 - 55.75) / 0.5), int((37.6 + 180) / 0.5)] = 1000
    a[int((90 + 33.87) / 0.5), int((151.2 + 180) / 0.5)] = 50
    p = tmp_path / "t.tif"
    _write_tif(p, a, -180, 90, 0.5)
    g = aggregate(p, 2.0, strip_rows=7)  # полосы не кратны блоку — проверка стыков
    assert g.population.shape == (90, 180)
    assert g.population.sum() == pytest.approx(1050)
    assert g.population[g.cell_of(37.6, 55.75)] == pytest.approx(1000)
    assert g.population[g.cell_of(151.2, -33.87)] == pytest.approx(50)
    # негатив: в пустом месте (Тихий океан) — ноль
    assert g.population[g.cell_of(-140, 0)] == 0


def test_aggregate_ignores_nodata_and_negative(tmp_path):
    a = np.full((360, 720), -200.0)
    a[10, 10] = 7
    a[20, 20] = np.nan
    p = tmp_path / "t.tif"
    _write_tif(p, a, -180, 90, 0.5, nodata=-200.0)
    assert aggregate(p, 1.0).population.sum() == pytest.approx(7)


def test_aggregate_wraps_antimeridian(tmp_path):
    # как у GHSL: растр начинается левее -180° на 1 пиксель и на 2 пикселя шире
    a = np.zeros((360, 722))
    a[100, 0] = 5    # долгота ≈ -180.25 → должна попасть на восточный край
    a[100, 721] = 3  # долгота ≈ 180.25 → на западный край
    p = tmp_path / "t.tif"
    _write_tif(p, a, -180.5, 90, 0.5)
    g = aggregate(p, 1.0)
    assert g.population.sum() == pytest.approx(8)
    assert g.population[50, 359] == pytest.approx(5)
    assert g.population[50, 0] == pytest.approx(3)


def test_aggregate_rejects_non_multiple_step(tmp_path):
    p = tmp_path / "t.tif"
    _write_tif(p, np.zeros((360, 720)), -180, 90, 0.5)
    with pytest.raises(ValueError):
        aggregate(p, 0.75)


def test_unwrap_antimeridian_moves_far_east_parts():
    from shapely.geometry import MultiPolygon, box
    from geovis_pipeline.region import unwrap_antimeridian
    big = box(30, 50, 170, 70)        # основная часть на востоке
    chukotka = box(-180, 64, -169, 68)
    g = unwrap_antimeridian(MultiPolygon([big, chukotka]))
    assert g.bounds == (30, 50, 191, 70)
    # негатив: страна в западном полушарии не трогается
    usa = MultiPolygon([box(-125, 25, -66, 49), box(172, 51, 180, 53)])
    assert unwrap_antimeridian(usa).bounds == usa.bounds


def _write_multi(path, bands, west, north, px, nodata=None):
    with rasterio.open(path, "w", driver="GTiff", width=bands[0].shape[1], height=bands[0].shape[0],
                       count=len(bands), dtype="float64", crs="EPSG:4326",
                       transform=from_origin(west, north, px, px), nodata=nodata) as dst:
        for i, b in enumerate(bands, 1):
            dst.write(b, i)


def test_aggregate_dataset_mean_non_integer_ratio(tmp_path):
    from geovis_pipeline.grid import aggregate_dataset
    a = np.full((180, 360), 10.0)  # 1° растр, всё = 10
    a[:90] = 30.0                  # северное полушарие = 30
    p = tmp_path / "m.tif"
    _write_tif(p, a, -180, 90, 1.0)
    g = aggregate_dataset(p, 2.5, {"agg": "mean"})   # 2.5 / 1 — некратно
    d = g.density()
    assert d.shape == (72, 144)
    assert d[g.cell_of(0, 45)] == pytest.approx(30)
    assert d[g.cell_of(0, -45)] == pytest.approx(10)
    assert g.population is None


def test_aggregate_dataset_sum_non_integer_preserves_total(tmp_path):
    from geovis_pipeline.grid import aggregate_dataset
    a = np.full((180, 360), 2.0)   # 2 единицы в каждом 1°-пикселе → всего 129 600
    p = tmp_path / "s.tif"
    _write_tif(p, a, -180, 90, 1.0)
    g = aggregate_dataset(p, 2.5, {"agg": "sum"})
    assert g.population.sum() == pytest.approx(2.0 * 180 * 360, rel=1e-6)


def test_aggregate_dataset_band_factor_clip(tmp_path):
    from geovis_pipeline.grid import aggregate_dataset
    b1 = np.full((180, 360), 5.0)
    b2 = np.full((180, 360), 50.0)
    b2[100:, :] = -20.0            # «океан» ниже нуля
    p = tmp_path / "b.tif"
    _write_multi(p, [b1, b2], -180, 90, 1.0)
    g = aggregate_dataset(p, 1.0, {"agg": "mean", "band": 2, "factor": 2.0, "clip_min": 0})
    d = g.density()
    assert d[g.cell_of(0, 45)] == pytest.approx(100)   # полоса 2 × factor
    assert np.isnan(d[g.cell_of(0, -60)])               # ниже clip_min → пусто (негатив)


def test_aggregate_dataset_nodata_is_nan_for_mean(tmp_path):
    from geovis_pipeline.grid import aggregate_dataset
    a = np.full((180, 360), -9999.0)
    a[:, :180] = 7.0
    p = tmp_path / "n.tif"
    _write_tif(p, a, -180, 90, 1.0, nodata=-9999.0)
    d = aggregate_dataset(p, 2.0, {"agg": "mean"}).density()
    assert d[45, 10] == pytest.approx(7)
    assert np.isnan(d[45, 170])


def test_shared_zip_cached_and_partial_extract(tmp_path, monkeypatch):
    import zipfile
    from geovis_pipeline import download
    src = tmp_path / "src.zip"
    with zipfile.ZipFile(src, "w") as z:
        z.writestr("sub/dir/pop_2040_x.tif", b"A40")
        z.writestr("sub/dir/pop_2060_x.tif", b"A60")
        z.writestr("sub/dir/readme.txt", b"r")
    fetched = []
    def fake_fetch(url, tmp, cafile, log):
        fetched.append(url); tmp.write_bytes(src.read_bytes())
    monkeypatch.setattr(download, "_fetch", fake_fetch)
    raw = tmp_path / "raw"
    for y in (2040, 2060):
        p = download.ensure_source(raw, {"url": "http://x/big.zip", "file": f"fp/pop_{y}_x.tif", "extract": [f"_{y}_"]},
                                   log=lambda *_: None)
        assert p.read_bytes() == f"A{str(y)[2:]}".encode()
    assert fetched == ["http://x/big.zip"]                      # общий архив скачан один раз
    assert (raw / "fp" / "big.zip").exists()                     # и сохранён для следующих наборов
    assert not (raw / "fp" / "sub" / "dir" / "readme.txt").exists()   # лишнее не распаковано


def test_parallel_zip_downloads_dont_clash(tmp_path, monkeypatch):
    """Дефект 08.10: параллельные загрузки архивов в один каталог писали в общий _download.zip."""
    import threading, time, zipfile
    from geovis_pipeline import download
    def fake_fetch(url, tmp, cafile, log):
        name = url.rsplit("/", 1)[-1].replace(".zip", "")
        part = tmp.with_name(tmp.name + ".part")
        with zipfile.ZipFile(part, "w") as z:
            z.writestr(f"deep/{name}.tif", name.encode())
        time.sleep(0.05)
        part.rename(tmp)
    monkeypatch.setattr(download, "_fetch", fake_fetch)
    raw = tmp_path / "raw"
    res = {}
    def run(n):
        p = download.ensure_source(raw, {"url": f"http://x/m{n}.zip", "file": f"wc/m{n}.tif"}, log=lambda *_: None)
        res[n] = p.read_bytes()
    ts = [threading.Thread(target=run, args=(n,)) for n in range(4)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert res == {n: f"m{n}".encode() for n in range(4)}


def test_cleanup_sources_removes_only_big_files_of_built(tmp_path):
    from geovis_pipeline.download import cleanup_sources
    d = tmp_path / "ships"; d.mkdir()
    (d / "big.tif").write_bytes(b"x" * 2000); (d / "big.tif.ovr").write_bytes(b"x" * 2000)
    (d / "big.tfw").write_bytes(b"x" * 10)                         # мелкий спутник остаётся
    (d / "arch.zip").write_bytes(b"x" * 3000)                      # общий архив набора — удаляется
    (d / "other.tif").write_bytes(b"x" * 5000)                     # чужой (не собран) — не трогаем
    built = {"ships": {"file": "ships/big.tif", "url": "https://x/arch.zip", "extract": ["big"]}}
    freed = cleanup_sources(tmp_path, built, min_bytes=1000, log=lambda *_: None)
    assert freed == 7000
    assert sorted(p.name for p in d.iterdir()) == ["big.tfw", "other.tif"]


def test_country_values_area_weighted():
    import numpy as np
    from geovis_pipeline.country_stats import country_values
    meta = {"north": 60.0, "res": 30.0, "height": 2, "width": 2}       # строки: широты 45° и 15°
    idx = np.array([[1, 1], [1, 2]])
    arr = np.array([[10.0, np.nan], [20.0, 5.0]], dtype=np.float32)
    out = country_values(arr, meta, idx, ["AAA", "BBB"], "sum")
    a45, a15 = np.cos(np.radians(45)), np.cos(np.radians(15))
    assert out["AAA"][0] == pytest.approx((10 * a45 + 20 * a15) / (a45 + a15), rel=1e-3)   # NaN не тянет к нулю
    assert out["BBB"][0] == pytest.approx(5.0) and out["AAA"][1] > 0
    assert country_values(arr, meta, idx, ["AAA", "BBB"], "mean")["AAA"][1] is None


def test_entry_from_disk_ignores_country_stats(tmp_path):
    import json
    from prepare import entry_from_disk
    d = tmp_path / "x"; d.mkdir()
    (d / "g_0p25.json").write_text(json.dumps({"res": 0.25, "max_density": 1.0}))
    (d / "countries.json").write_text(json.dumps({"agg": "sum", "values": {}}))   # без res — не уровень
    e = entry_from_disk("x", {"title": {}}, tmp_path)
    assert [lv["name"] for lv in e["levels"]] == ["g_0p25"]
