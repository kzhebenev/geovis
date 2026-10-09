"""Агрегация растра населения GHSL в глобальные сетки плотности.

Выход: плотная сетка Float32 (чел/км²), строки с севера на юг, столбцы с запада
на восток, охват -180..180 / -90..90. Клиент читает её как Float32Array.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.windows import Window

EARTH_RADIUS_KM = 6371.0088


def cell_area_km2(lat_north: np.ndarray, lat_south: np.ndarray, dlon_deg: float) -> np.ndarray:
    """Площадь сферической трапеции между широтами шириной dlon_deg (км²)."""
    phi1 = np.radians(lat_south)
    phi2 = np.radians(lat_north)
    return EARTH_RADIUS_KM**2 * np.radians(dlon_deg) * (np.sin(phi2) - np.sin(phi1))


@dataclass
class Grid:
    res: float                              # шаг сетки, градусы
    population: np.ndarray | None = None    # (h, w) количество в ячейке (agg=sum): люди, $, м²
    values: np.ndarray | None = None        # (h, w) готовые значения (agg=mean), NaN — пусто

    @property
    def _shape(self) -> tuple[int, int]:
        a = self.population if self.population is not None else self.values
        return a.shape

    @property
    def height(self) -> int:
        return self._shape[0]

    @property
    def width(self) -> int:
        return self._shape[1]

    def lat_edges(self) -> np.ndarray:
        return 90.0 - np.arange(self.height + 1) * self.res

    def area_km2(self) -> np.ndarray:
        """Площадь ячеек одной строки (одинакова по долготе) — вектор длиной height."""
        e = self.lat_edges()
        return cell_area_km2(e[:-1], e[1:], self.res)

    def density(self) -> np.ndarray:
        """Значение на ячейку: плотность (sum → на км²) или среднее (mean)."""
        if self.values is not None:
            return self.values.astype(np.float32)
        return (self.population / self.area_km2()[:, None]).astype(np.float32)

    def cell_of(self, lon: float, lat: float) -> tuple[int, int]:
        row = int((90.0 - lat) // self.res)
        col = int((lon + 180.0) // self.res)
        return min(row, self.height - 1), min(col, self.width - 1)


def aggregate(src_path: Path, res: float, strip_rows: int = 1200, band: int = 1) -> Grid:
    """Суммирует население исходного растра в ячейки шага res (кратного пикселю).

    Читает полосами, чтобы не держать в памяти весь глобальный растр (~3.7 ГБ).
    """
    with rasterio.open(src_path) as src:
        px = src.transform.a
        if abs(px + src.transform.e) > 1e-12:
            raise ValueError("ожидаются квадратные пиксели")
        factor = round(res / px)
        if abs(factor * px - res) > 1e-5 * res:
            raise ValueError(f"шаг {res}° не кратен пикселю {px}°")

        out = np.zeros((round(180 / res), round(360 / res)), dtype=np.float64)
        # смещение исходного растра относительно глобальной сетки, в пикселях
        col0 = round((src.transform.c + 180.0) / px)
        row0 = round((90.0 - src.transform.f) / px)
        nodata = src.nodata

        for r in range(0, src.height, strip_rows):
            h = min(strip_rows, src.height - r)
            a = src.read(band, window=Window(0, r, src.width, h)).astype(np.float64)
            if nodata is not None:
                a[a == nodata] = 0.0
            a[~np.isfinite(a) | (a < 0)] = 0.0
            rows = (row0 + r + np.arange(h)) // factor
            # GHSL на 1–2 пикселя выходит за ±180° — заворачиваем через антимеридиан
            cols = ((col0 + np.arange(src.width)) // factor) % out.shape[1]
            # сумма по столбцам внутри блока, затем по строкам
            col_sums = np.add.reduceat(a, np.r_[0, np.flatnonzero(np.diff(cols)) + 1], axis=1)
            ucols = cols[np.r_[0, np.flatnonzero(np.diff(cols)) + 1]]
            np.add.at(out, (rows[:, None], ucols[None, :]), col_sums)

    return Grid(res=res, population=out)


def write_grid(grid: Grid, out_dir: Path, name: str) -> dict:
    """Пишет <name>.bin (Float32 плотность) и возвращает метаданные."""
    out_dir.mkdir(parents=True, exist_ok=True)
    dens = grid.density()
    dens.tofile(out_dir / f"{name}.bin")
    fin = dens[np.isfinite(dens)]
    pos = fin[fin > 0]
    meta = {
        "file": f"{name}.bin",
        "res": grid.res,
        "width": grid.width,
        "height": grid.height,
        "west": -180.0,
        "north": 90.0,
        "dtype": "float32",
        "nodata": "NaN",
        # для agg=sum — сумма исходной величины (люди, $, м²); для mean — нет
        "total_population": float(grid.population.sum()) if grid.population is not None else None,
        "min_value": float(fin.min()) if fin.size else 0.0,
        "max_density": float(fin.max()) if fin.size else 0.0,
        "p99_density": float(np.percentile(pos, 99)) if pos.size else 0.0,
    }
    (out_dir / f"{name}.json").write_text(json.dumps(meta, indent=1))
    return meta


def aggregate_dataset(src_path: Path, res: float, ds: dict) -> Grid:
    """Любой растр набора → глобальная сетка шага res по правилам каталога (agg/band/factor/clip_min).

    sum + кратный шаг → точное суммирование блоками (aggregate);
    иначе → WarpedVRT на глобальную сетку с усреднением (Resampling.average),
    для sum среднее по ячейке × число исходных пикселей в ней.
    """
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.vrt import WarpedVRT

    band = ds.get("band") or 1
    factor = ds.get("factor", 1.0)
    with rasterio.open(src_path) as src:
        px = abs(src.transform.a)
        ratio = res / px
        exact = abs(ratio - round(ratio)) < 1e-4 and round(ratio) >= 1
        if ds["agg"] == "sum" and exact:
            g = aggregate(src_path, res, band=band)
        else:
            w, h = round(360 / res), round(180 / res)
            vrt_opts = dict(crs="EPSG:4326", transform=from_origin(-180, 90, res, res), width=w, height=h,
                            resampling=Resampling.average, dtype="float64", nodata=np.nan)
            if src.crs is None:
                vrt_opts["src_crs"] = CRS.from_epsg(4326)
            with WarpedVRT(src, **vrt_opts) as vrt:
                a = vrt.read(band).astype(np.float64)
            if ds["agg"] == "sum":
                a = np.where(np.isfinite(a) & (a > 0), a, 0.0) * ratio * ratio
                g = Grid(res=res, population=a)
            else:
                g = Grid(res=res, values=a)
    if factor != 1.0 or "clip_min" in ds:
        v = g.density().astype(np.float64) * factor
        if "clip_min" in ds:
            v[v < ds["clip_min"]] = np.nan
        g = Grid(res=res, population=g.population, values=v)
    return g
