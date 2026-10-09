"""Значение набора по странам — для подписей стран на сеточной карте.

Считается по готовой сетке 0.25° (сырые исходники не нужны): среднее по площади суши страны
в единицах набора (чел/км², т CO₂/км² в год, °C…), для наборов-сумм ещё и итог (население, т CO₂ в год).
"""
from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import numpy as np
from rasterio.features import rasterize
from rasterio.transform import from_origin

KM_PER_DEG = 111.32


def country_index(shp: Path, meta: dict) -> tuple[np.ndarray, list[str]]:
    """Сетка номеров стран (0 — нет страны) под геометрию сетки meta + список кодов ADM0_A3 по номеру−1.
    Мелкие страны, не накрывшие ни одного центра ячейки, добираются по касанию (all_touched)."""
    df = gpd.read_file(shp)
    codes = [str(c) for c in df["ADM0_A3"]]
    shape = (meta["height"], meta["width"])
    tr = from_origin(meta["west"], meta["north"], meta["res"], meta["res"])
    shapes = [(g, i + 1) for i, g in enumerate(df.geometry) if g is not None and not g.is_empty]
    idx = rasterize(shapes, out_shape=shape, transform=tr, fill=0, dtype="int32")
    have = set(np.unique(idx))
    small = [(g, v) for g, v in shapes if v not in have]
    if small:
        touched = rasterize(small, out_shape=shape, transform=tr, fill=0, dtype="int32", all_touched=True)
        idx = np.where((idx == 0) & (touched > 0), touched, idx)
    return idx, codes


def country_values(arr: np.ndarray, meta: dict, idx: np.ndarray, codes: list[str], agg: str,
                   weight: np.ndarray | None = None) -> dict[str, list]:
    """{ADM0_A3: [среднее, итог или None]} — только страны, где есть данные.
    Среднее — по площади; с weight (плотность населения той же сетки) — по населению («на душу»).
    Итог (Σ значение × площадь) — только для наборов-сумм."""
    lat = meta["north"] - (np.arange(meta["height"]) + 0.5) * meta["res"]
    area = (meta["res"] * KM_PER_DEG) ** 2 * np.cos(np.radians(lat))[:, None] * np.ones((1, meta["width"]))
    w_all = area if weight is None else area * np.nan_to_num(weight, nan=0.0)
    ok = np.isfinite(arr) & (idx > 0)
    ids = idx[ok]
    a, w, v = area[ok], w_all[ok], arr[ok].astype(np.float64)
    n = len(codes) + 1
    s_w = np.bincount(ids, weights=w, minlength=n)
    s_vw = np.bincount(ids, weights=v * w, minlength=n)
    s_va = np.bincount(ids, weights=v * a, minlength=n)
    out: dict[str, list] = {}
    for i in np.nonzero(s_w > 0)[0]:
        out[codes[i - 1]] = [round(float(s_vw[i] / s_w[i]), 4), round(float(s_va[i])) if agg == "sum" else None]
    return out


def _load(data: Path, ds_id: str) -> tuple[dict, np.ndarray] | None:
    mp = data / ds_id / "g_0p25.json"
    if not mp.exists():
        return None
    meta = json.loads(mp.read_text())
    return meta, np.fromfile(data / ds_id / meta["file"], dtype=np.float32).reshape(meta["height"], meta["width"])


def write_country_stats(data: Path, ds_id: str, agg: str, shp: Path, cache: dict, weight_ds: str | None = None) -> int:
    """<data>/<ds>/countries.json по сетке g_0p25 набора. cache — переиспользуемый индекс стран на одну геометрию сетки."""
    got = _load(data, ds_id)
    if got is None:
        return 0
    meta, arr = got
    key = (meta["west"], meta["north"], meta["res"], meta["width"], meta["height"])
    if key not in cache:
        cache[key] = country_index(shp, meta)
    idx, codes = cache[key]
    weight = None
    if weight_ds:
        wg = _load(data, weight_ds)
        if wg is None or any(wg[0][k] != meta[k] for k in ("west", "north", "res", "width", "height")):
            raise ValueError(f"{ds_id}: сетка веса {weight_ds} не совпадает или нет")
        weight = wg[1]
    vals = country_values(arr, meta, idx, codes, agg, weight)
    (data / ds_id / "countries.json").write_text(json.dumps({"agg": agg, "values": vals}, ensure_ascii=False, separators=(",", ":")))
    return len(vals)
