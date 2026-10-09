"""Подготовка данных GeoVis по реестру catalog.py → web/public/data.

    uv run python prepare.py                      # всё (скачает недостающие исходники)
    uv run python prepare.py --datasets relief temp   # выборочно (catalog.json пересобирается целиком)

Структура выхода:
    catalog.json                      — что есть: наборы (группы, годы, уровни), страны, регионы
    <dataset>/g_<res>.{bin,json}      — глобальная сетка (Float32, NaN — пусто)
    <dataset>/<ISO3>_<res>.{bin,json} — регион: NaN вне страны
    countries/<id>.json               — наборы по странам (ADM0_A3 → значение)
    regions/<ISO3>.geojson            — граница региона (развёрнутые долготы)
    cities.json, countries.json, outlines.geojson
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import geopandas as gpd
import rasterio

from geovis_pipeline.catalog import (COUNTRY_DATASETS, DATASETS, GLOBAL_LEVELS, GOV_CA, REGION_DATASETS, REGION_LEVELS,
                                     REGIONS, level_name)
from geovis_pipeline import admin1
from geovis_pipeline.countries import build_country_series, fetch_world_bank_series, ne_code_map
from geovis_pipeline.download import cleanup_sources, ensure_source
from geovis_pipeline.country_stats import write_country_stats
from geovis_pipeline.grid import aggregate_dataset, write_grid
from geovis_pipeline.labels import build_cities, build_countries, write_json, write_outlines
from geovis_pipeline.region import auto_view, extent_km, region_grid, write_region, write_region_outline

NE_COUNTRIES = "ne/countries/ne_10m_admin_0_countries.shp"
NE_PLACES = "ne/places/ne_10m_populated_places.shp"
META_KEYS = ("group", "group_title", "year", "title", "unit", "source", "agg", "view", "total_label", "value_label", "license")


def source_px(path: Path) -> float:
    with rasterio.open(path) as src:
        return abs(src.transform.a)


def aggregate_any(srcs: list[Path], res: float, ds: dict):
    """Один источник — как есть; ансамбль (несколько моделей) — среднее по ячейкам без учёта пустых."""
    import numpy as np
    from geovis_pipeline.grid import Grid
    if len(srcs) == 1:
        return aggregate_dataset(srcs[0], res, ds)
    stack = np.stack([aggregate_dataset(p, res, ds).density().astype(np.float64) for p in srcs])
    with np.errstate(invalid="ignore"):
        mean = np.nanmean(stack, axis=0)
    return Grid(res=res, values=mean)


def build_dataset(ds_id: str, ds: dict, raw: Path, out: Path, region_geoms: dict) -> dict:
    srcs = [ensure_source(raw, {**ds, **m}) for m in ds["ensemble"]] if "ensemble" in ds else [ensure_source(raw, ds)]
    tif = srcs[0]
    px = source_px(tif)
    glevels = [r for r in GLOBAL_LEVELS if r >= px * 0.99]
    rlevels = [r for r in REGION_LEVELS if r >= px * 0.99][-2:] if ds.get("regions") else []
    entry = {"id": ds_id, **{k: ds[k] for k in META_KEYS if k in ds}, "levels": [], "regions": {}}
    for res in sorted(set(glevels) | set(rlevels), reverse=True):
        t = time.time()
        grid = aggregate_any(srcs, res, ds)
        if res in glevels:
            name = f"g_{level_name(res)}"
            m = write_grid(grid, out / ds_id, name)
            entry["levels"].append({"res": res, "name": name, "min_value": m["min_value"],
                                    "max_density": m["max_density"]})
        for iso in (REGIONS if res in rlevels else {}):
            dens, _, rm = region_grid(grid, region_geoms[iso])
            name = f"{iso}_{level_name(res)}"
            write_region(dens, rm, out / ds_id, name)
            entry["regions"].setdefault(iso, []).append({"res": res, "name": name, "min_value": rm["min_value"],
                                                         "max_density": rm["max_density"]})
        print(f"  {ds_id} {res}°: {time.time() - t:.0f} c", flush=True)
    entry["levels"].sort(key=lambda l: -l["res"])
    for v in entry["regions"].values():
        v.sort(key=lambda l: -l["res"])
    return entry


def entry_from_disk(ds_id: str, ds: dict, out: Path) -> dict | None:
    """Запись каталога по уже посчитанным файлам (без пересчёта сеток)."""
    d = out / ds_id
    if not d.exists():
        return None
    entry = {"id": ds_id, **{k: ds[k] for k in META_KEYS if k in ds}, "levels": [], "regions": {}}
    for f in sorted(d.glob("*.json")):
        if f.name == "countries.json":      # значения по странам, не уровень сетки
            continue
        m = json.loads(f.read_text())
        lv = {"res": m["res"], "name": f.stem, "min_value": m.get("min_value", 0.0), "max_density": m["max_density"]}
        if f.stem.startswith("g_"):
            entry["levels"].append(lv)
        else:
            iso = f.stem.split("_")[0]
            if iso in REGIONS:
                entry["regions"].setdefault(iso, []).append(lv)
    entry["levels"].sort(key=lambda l: -l["res"])
    for v in entry["regions"].values():
        v.sort(key=lambda l: -l["res"])
    return entry


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", type=Path, default=Path("../data/raw"))
    ap.add_argument("--out", type=Path, default=Path("../web/public/data"))
    ap.add_argument("--datasets", nargs="*", default=None, help="пересчитать только эти (остальные — из прошлого каталога)")
    ap.add_argument("--catalog-only", action="store_true", help="не считать сетки: собрать каталог из файлов на диске")
    ap.add_argument("--include-restricted", action="store_true",
                    help="собирать и наборы с ограничительной лицензией (некоммерческие / без производных: WorldClim, "
                         "IEA-EDGAR CO2) — только если вы соблюдаете их условия, см. DATA_SOURCES.md")
    ap.add_argument("--keep-raw", action="store_true",
                    help="не удалять крупные исходники после сборки (по умолчанию удаляются файлы ≥ 100 МБ, чтобы не занимать диск)")
    args = ap.parse_args()

    shp = args.raw / NE_COUNTRIES
    countries_gdf = gpd.read_file(shp)
    region_geoms = {iso: countries_gdf.loc[countries_gdf["ADM0_A3"] == iso].geometry.union_all() for iso in REGIONS}

    old = {}
    if args.datasets is not None and (args.out / "catalog.json").exists():
        old = {d["id"]: d for d in json.loads((args.out / "catalog.json").read_text())["datasets"]}

    catalog = {"datasets": [], "country_datasets": [], "regions": []}
    built: dict[str, dict] = {}
    for ds_id, ds in DATASETS.items():
        if ds["license"]["restricted"] and not args.include_restricted:
            print(f"{ds_id}: пропущен — лицензия {ds['license']['name']} (нужен --include-restricted)", flush=True)
            continue
        if args.catalog_only:
            e = entry_from_disk(ds_id, ds, args.out)
            if e:
                catalog["datasets"].append(e)
            continue
        if args.datasets is not None and ds_id not in args.datasets:
            if ds_id in old:
                catalog["datasets"].append(old[ds_id])
            continue
        print(f"{ds_id}:", flush=True)
        try:
            catalog["datasets"].append(build_dataset(ds_id, ds, args.raw, args.out, region_geoms))
            built[ds_id] = ds
        except Exception as e:  # один битый источник не должен ронять остальные
            print(f"  {ds_id}: ОШИБКА {e}", flush=True)

    codes = ne_code_map(shp)
    write_json(codes, args.out / "iso_codes.json")  # ISO3 (WB) → ADM0_A3 (границы) — для API
    for cid, cd in COUNTRY_DATASETS.items():
        data = build_country_series(fetch_world_bank_series(cd["indicator"]), codes)
        write_json({"id": cid, **data}, args.out / "countries" / f"{cid}.json")
        catalog["country_datasets"].append({"id": cid, **{k: cd[k] for k in ("group", "title", "unit", "source", "license")},
                                            "file": f"countries/{cid}.json", "count": data["count"],
                                            "years": [data["years"][0], data["years"][-1]],
                                            "max_value": data["max_value"]})
        print(f"{cid}: {data['count']} стран, {data['years'][0]}–{data['years'][-1]}", flush=True)

    # регионы стран (admin-1): границы + официальная статистика; несопоставленный регион — ошибка, не тишина
    regs = admin1.build_admin1(args.raw / "ne/admin1/ne_10m_admin_1_states_provinces.shp", args.out / "admin1.geojson")
    write_json(regs, args.out / "admin1_labels.json")
    write_json(sorted(r["code"] for r in regs), args.out / "admin1_codes.json")
    valid = {r["code"] for r in regs}
    catalog["region_datasets"] = []
    for rid, rd in REGION_DATASETS.items():
        src = ensure_source(args.raw, rd, cafile=str(Path(__file__).parent / GOV_CA))
        if rd.get("kind") == "population":
            rows, unmatched = admin1.read_rosstat_population(src)
        else:
            rows, unmatched = admin1.read_rosstat_series(src, rd["sheets"], rd.get("factor", 1.0))
        if unmatched:
            raise SystemExit(f"{rid}: регионы без кода ISO 3166-2 — дополните admin1.ROSSTAT_CODES: {unmatched}")
        data = admin1.build_series(rows, valid)
        write_json({"id": rid, **data}, args.out / "regiondata" / f"{rid}.json")
        catalog["region_datasets"].append({"id": rid, **{k: rd[k] for k in ("group", "country", "title", "unit", "source", "license")},
                                           "file": f"regiondata/{rid}.json", "count": data["count"],
                                           "years": [data["years"][0], data["years"][-1]], "max_value": data["max_value"]})
        print(f"{rid}: {data['count']} регионов, {data['years'][0]}–{data['years'][-1]}", flush=True)

    for iso, reg in REGIONS.items():
        write_region_outline(region_geoms[iso], args.out / "regions" / f"{iso}.geojson")
        view, globe = auto_view(region_geoms[iso])
        catalog["regions"].append({"iso3": iso, "title": reg["title"], "view": reg.get("view", view),
                                   "globe_view": reg.get("globe_view", globe), "outline": f"regions/{iso}.geojson",
                                   "extent_km": round(extent_km(region_geoms[iso])),
                                   "city_min_pop": reg.get("city_min_pop", 500_000)})

    countries = build_countries(shp)
    cities = build_cities(args.raw / NE_PLACES, countries)
    write_json(countries, args.out / "countries.json")
    write_json(cities, args.out / "cities.json")
    write_outlines(shp, args.out / "outlines.geojson")
    # упрощённые границы для записи видео и снимков: кадр в программном рендере вдвое быстрее
    write_outlines(shp, args.out / "outlines_lo.geojson", tolerance=0.1)
    # значение каждого сеточного набора по странам — для подписей стран (не плотность населения на карте CO₂)
    stats_cache: dict = {}
    for e in catalog["datasets"]:
        dd = DATASETS[e["id"]]
        if dd.get("country_stats") is False:
            (args.out / e["id"] / "countries.json").unlink(missing_ok=True)
            continue
        n = write_country_stats(args.out, e["id"], dd.get("agg", "mean"), shp, stats_cache, dd.get("country_weight"))
        if n:
            e["country_stats"] = True
    print(f"значения по странам: {sum(1 for e in catalog['datasets'] if e.get('country_stats'))} наборов", flush=True)
    catalog["labels"] = {"countries": len(countries), "cities": len(cities),
                         "source": "Natural Earth 10m (public domain)", "license": {"id": "PD", "name": "Public domain",
                         "url": "https://www.naturalearthdata.com/about/terms-of-use/", "restricted": False}}
    (args.out / "catalog.json").write_text(json.dumps(catalog, indent=1, ensure_ascii=False))
    print(f"каталог: {[d['id'] for d in catalog['datasets']]} + {[c['id'] for c in catalog['country_datasets']]}")
    if not args.keep_raw and built:   # сетки и каталог записаны — крупные исходники больше не нужны
        print(f"освобождено {cleanup_sources(args.raw, built) / 2**30:.1f} ГБ исходников", flush=True)


if __name__ == "__main__":
    main()
