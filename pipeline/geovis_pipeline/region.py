"""Сетки регионов-фокусов: вырезка страны из глобальной сетки по её границе.

Ячейки вне страны = NaN (клиент строит по маске поверхность и стенки «плиты»).
Страны, пересекающие антимеридиан (Россия — Чукотка), разворачиваются
в непрерывный диапазон долгот > 180°.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.affinity import translate
from shapely.geometry import MultiPolygon, mapping

from .grid import Grid


def unwrap_antimeridian(geom):
    """Части западнее -150°, если страна в основном в восточном полушарии, сдвигает на +360°."""
    parts = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    if not parts:
        return geom
    east = sum(p.area for p in parts if p.centroid.x > 0)
    west = sum(p.area for p in parts if p.centroid.x <= 0)
    if east <= west:
        return geom
    fixed = [translate(p, xoff=360) if p.bounds[2] < -150 else p for p in parts]
    return MultiPolygon(fixed) if len(fixed) > 1 else fixed[0]


def region_grid(grid: Grid, geom, pad_deg: float = 0.5) -> tuple[np.ndarray, np.ndarray, dict]:
    """Возвращает (плотность с NaN вне страны, население с 0 вне страны, метаданные)."""
    res = grid.res
    g = unwrap_antimeridian(geom)
    minx, miny, maxx, maxy = g.bounds
    west = math.floor((minx - pad_deg) / res) * res
    east = math.ceil((maxx + pad_deg) / res) * res
    south = max(-90.0, math.floor((miny - pad_deg) / res) * res)
    north = min(90.0, math.ceil((maxy + pad_deg) / res) * res)
    w = round((east - west) / res)
    h = round((north - south) / res)

    col0 = round((west + 180.0) / res)
    row0 = round((90.0 - north) / res)
    cols = (col0 + np.arange(w)) % grid.width
    rows = row0 + np.arange(h)

    pop = grid.population[np.ix_(rows, cols)] if grid.population is not None else None
    dens = grid.density()[np.ix_(rows, cols)]
    mask = rasterize([(g, 1)], out_shape=(h, w), transform=from_origin(west, north, res, res),
                     fill=0, all_touched=False, dtype="uint8").astype(bool)

    dens = np.where(mask, dens, np.nan).astype(np.float32)
    pop = np.where(mask, pop, 0.0) if pop is not None else None
    fin = dens[np.isfinite(dens)]
    meta = {
        "res": res, "width": w, "height": h, "west": west, "north": north,
        "dtype": "float32", "nodata": "NaN",
        "total_population": float(pop.sum()) if pop is not None else None,
        "min_value": float(fin.min()) if fin.size else 0.0,
        "max_density": float(fin.max()) if fin.size else 0.0,
        "cells": int(mask.sum()),
    }
    return dens, pop, meta


def write_region(dens: np.ndarray, meta: dict, out_dir: Path, name: str) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    dens.tofile(out_dir / f"{name}.bin")
    meta = {**meta, "file": f"{name}.bin"}
    (out_dir / f"{name}.json").write_text(json.dumps(meta, indent=1))
    return meta


def write_region_outline(geom, path: Path) -> None:
    """Граница региона в развёрнутых долготах (для обводки и подписей)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fc = {"type": "FeatureCollection",
          "features": [{"type": "Feature", "properties": {},
                        "geometry": mapping(unwrap_antimeridian(geom).simplify(0.02))}]}
    path.write_text(json.dumps(fc, separators=(",", ":")))


def auto_view(geom) -> tuple[dict, dict]:
    """Ракурс камеры по границам страны: карта (с наклоном, вид с юга) и глобус (сверху).

    Масштаб deck.gl: ширина мира = 512·2^zoom px; страна должна занять ~60% кадра шириной ~1400 px.
    """
    g = unwrap_antimeridian(geom)
    minx, miny, maxx, maxy = g.bounds
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    w = max(maxx - minx, (maxy - miny) / max(math.cos(math.radians(cy)), 0.2), 1.0)
    zoom = max(1.5, min(7.0, math.log2(590 / w)))
    view = {"longitude": round(cx, 2), "latitude": round(cy - (maxy - miny) * 0.25, 2),
            "zoom": round(zoom - 0.35, 2), "pitch": 55, "bearing": 0}
    globe = {"longitude": round(cx, 2), "latitude": round(cy, 2), "zoom": round(max(1.5, zoom - 0.6), 2),
             "pitch": 25, "bearing": 0}
    return view, globe


def extent_km(geom) -> float:
    """Размер страны (большая сторона охвата), км — для масштаба высоты пиков."""
    g = unwrap_antimeridian(geom)
    minx, miny, maxx, maxy = g.bounds
    cy = (miny + maxy) / 2
    return max((maxx - minx) * 111.32 * math.cos(math.radians(cy)), (maxy - miny) * 110.57)
