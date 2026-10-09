"""Подписи городов и стран из Natural Earth (RU/EN)."""
from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import numpy as np

# Equal Earth — равновеликая проекция, площади стран в км² считаются в ней
EQUAL_AREA = "EPSG:8857"


def _clean(v) -> str | None:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    s = str(v).strip()
    return s or None


# Короткие названия для подписей (в Natural Earth — официальные полные)
SHORT_NAMES = {
    "CHN": ("Китай", "China"), "COD": ("ДР Конго", "DR Congo"), "DOM": ("Доминикана", "Dominican Rep."),
    "ARE": ("ОАЭ", "UAE"), "CAF": ("ЦАР", "CAR"), "USA": ("США", "USA"),
}


def build_countries(shp: Path) -> list[dict]:
    df = gpd.read_file(shp)
    area = df.to_crs(EQUAL_AREA).geometry.area / 1e6
    out = []
    for (_, r), a in zip(df.iterrows(), area):
        pop = float(r["POP_EST"]) if r["POP_EST"] and r["POP_EST"] > 0 else 0.0
        iso = _clean(r["ADM0_A3"])
        short = SHORT_NAMES.get(iso)
        out.append({
            "iso3": iso,
            "en": short[1] if short else (_clean(r["NAME_EN"]) or _clean(r["NAME"])),
            "ru": short[0] if short else (_clean(r["NAME_RU"]) or _clean(r["NAME_EN"])),
            "lon": round(float(r["LABEL_X"]), 4),
            "lat": round(float(r["LABEL_Y"]), 4),
            "pop": int(pop),
            "pop_year": int(r["POP_YEAR"]) if r["POP_YEAR"] else None,
            "area_km2": round(float(a)),
            "density": round(pop / a, 1) if a > 0 else 0.0,
            "min_label": float(r["MIN_LABEL"]),
        })
    out.sort(key=lambda c: -c["pop"])
    return out


# Исправления устаревших записей Natural Earth (имя RU, EN, население агломерации).
# Астана: переименована обратно в 2022; население 2024 ≈ 1,35 млн (Бюро нац. статистики РК).
CITY_FIXES = {
    ("KAZ", "Almaty"): {"ru": "Алматы"},
    ("KAZ", "Nur-Sultan"): {"ru": "Астана", "en": "Astana", "pop": 1_350_000},
}


def build_cities(shp: Path, countries: list[dict]) -> list[dict]:
    df = gpd.read_file(shp)
    cru = {c["iso3"]: c["ru"] for c in countries}
    out = []
    for _, r in df.iterrows():
        pop = int(r["POP_MAX"]) if r["POP_MAX"] and r["POP_MAX"] > 0 else 0
        if pop <= 0:
            continue
        en = _clean(r["NAME_EN"]) or _clean(r["NAME"])
        iso3 = _clean(r["ADM0_A3"])
        out.append({
            "en": en,
            "ru": _clean(r["NAME_RU"]) or en,
            "lon": round(float(r.geometry.x), 4),
            "lat": round(float(r.geometry.y), 4),
            "pop": pop,
            "iso3": iso3,
            "country_en": _clean(r["ADM0NAME"]),
            "country_ru": cru.get(iso3) or _clean(r["ADM0NAME"]),
            "capital": int(r["ADM0CAP"] or 0) == 1,
            "rank": int(r["SCALERANK"]),
        })
        out[-1].update(CITY_FIXES.get((iso3, en), {}))
    out.sort(key=lambda c: -c["pop"])
    return out


def write_json(obj, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def write_outlines(shp: Path, path: Path, tolerance: float = 0.02) -> int:
    """Упрощённые границы стран (GeoJSON) — подложка сцены без внешних тайлов."""
    df = gpd.read_file(shp)[["ADM0_A3", "geometry"]]
    df["geometry"] = df.geometry.simplify(tolerance, preserve_topology=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=3)
    return len(df)
