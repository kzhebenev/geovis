"""Преобразование входного набора (контракт v1) в файлы, которые читает сайт.

Формат сетки совпадает со встроенными наборами: Float32, строки с севера, NaN — пусто,
плюс метаданные (res/width/height/west/north/min_value/max_density).
"""
from __future__ import annotations

import math

import numpy as np

from .contract import MAX_LABELS, DatasetIn


class ContractError(ValueError):
    """Нарушение правил контракта, которое не ловится схемой (напр. неизвестный ISO3)."""


def _grid_meta(arr: np.ndarray, res: float, west: float, north: float, total: float | None) -> dict:
    fin = arr[np.isfinite(arr)]
    return {
        "file": "grid.bin", "res": res, "width": int(arr.shape[1]), "height": int(arr.shape[0]),
        "west": west, "north": north, "dtype": "float32", "nodata": "NaN",
        "total_population": total,
        "min_value": float(fin.min()) if fin.size else 0.0,
        "max_density": float(fin.max()) if fin.size else 0.0,
        "cells": int(fin.size),
    }


def points_to_grid(ds: DatasetIn) -> tuple[np.ndarray, dict, list[dict]]:
    res = ds.res
    lon = np.array([p.lon for p in ds.points])
    lat = np.array([p.lat for p in ds.points])
    val = np.array([p.value for p in ds.points], dtype=np.float64)
    west = math.floor(lon.min() / res) * res - res
    east = math.ceil(lon.max() / res) * res + res
    north = min(90.0, math.ceil(lat.max() / res) * res + res)
    south = max(-90.0, math.floor(lat.min() / res) * res - res)
    w = max(1, round((east - west) / res))
    h = max(1, round((north - south) / res))
    col = np.clip(((lon - west) / res).astype(int), 0, w - 1)
    row = np.clip(((north - lat) / res).astype(int), 0, h - 1)
    s = np.zeros((h, w))
    n = np.zeros((h, w))
    np.add.at(s, (row, col), val)
    np.add.at(n, (row, col), 1)
    if ds.aggregation == "sum":
        out = np.where(n > 0, s, np.nan)
        total = float(val.sum())
    elif ds.aggregation == "count":
        out = np.where(n > 0, n, np.nan)
        total = float(len(val))
    else:
        out = np.where(n > 0, s / np.maximum(n, 1), np.nan)
        total = None
    arr = out.astype(np.float32)

    labeled = [p for p in ds.points if p.label]
    labeled.sort(key=lambda p: -abs(p.value))
    labels = [{"lon": p.lon, "lat": p.lat, "label": p.label, "value": p.value} for p in labeled[:MAX_LABELS]]
    return arr, _grid_meta(arr, res, west, north, total), labels


def grid_to_array(ds: DatasetIn) -> tuple[np.ndarray, dict]:
    g = ds.grid
    arr = np.array([np.nan if v is None else v for v in g.values], dtype=np.float32).reshape(g.height, g.width)
    fin = arr[np.isfinite(arr)]
    return arr, _grid_meta(arr, g.res, g.west, g.north, float(fin.sum()) if fin.size else None)


def countries_to_values(ds: DatasetIn, iso_map: dict[str, str]) -> dict:
    """Значения по странам (ключ — ADM0_A3 границ). С годами — временной ряд: series {год: [...]},
    values — последний год каждой страны, min/max — по всем годам (общая шкала)."""
    unknown = sorted({c.iso3.upper() for c in ds.countries if c.iso3.upper() not in iso_map})
    if unknown:
        raise ContractError(f"неизвестные коды стран (ISO 3166-1 alpha-3): {', '.join(unknown)}")
    return _series([(iso_map[c.iso3.upper()], c.value, c.year) for c in ds.countries], "iso3")


def regions_to_values(ds: DatasetIn, codes: set[str]) -> dict:
    """Значения по регионам стран (ключ — ISO 3166-2, как в границах admin-1)."""
    unknown = sorted({c.code.upper() for c in ds.regions if c.code.upper() not in codes})
    if unknown:
        raise ContractError(f"неизвестные коды регионов (ISO 3166-2): {', '.join(unknown[:30])}"
                            f"{' …' if len(unknown) > 30 else ''}; список — /data/admin1_codes.json")
    return _series([(c.code.upper(), c.value, c.year) for c in ds.regions], "code")


def _series(items: list[tuple[str, float, int | None]], key: str) -> dict:
    def pack(rows) -> list[dict]:
        agg: dict[str, float] = {}
        for k, v, _ in rows:
            agg[k] = agg.get(k, 0.0) + v
        return sorted(({key: k, "value": v} for k, v in agg.items()), key=lambda x: -x["value"])

    if items[0][2] is None:
        values = pack(items)
        return {"values": values, "max_value": values[0]["value"], "min_value": values[-1]["value"], "count": len(values)}
    years = sorted({y for _, _, y in items})
    series = {str(y): pack([it for it in items if it[2] == y]) for y in years}
    latest: dict[str, dict] = {}
    for y in years:
        for v in series[str(y)]:
            latest[v[key]] = {**v, "year": y}
    values = sorted(latest.values(), key=lambda x: -x["value"])
    allv = [v["value"] for vs in series.values() for v in vs]
    return {"values": values, "years": years, "series": series, "max_value": max(allv), "min_value": min(allv),
            "count": len(values)}
