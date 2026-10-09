"""Контракт приёма пользовательских наборов данных GeoVis (v1).

Три вида данных (kind):
  points    — точки {lat, lon, value, label?}; агрегируются в сетку шага res
              (aggregation: sum — сумма в ячейке, mean — среднее, count — число точек);
              подписи (label) показываются над точками, до MAX_LABELS самых крупных.
  countries — значения по странам {iso3, value}; 3D-картограмма (высота/цвет страны).
              ISO 3166-1 alpha-3 (как у World Bank); неизвестные коды — ошибка 422.
  grid      — готовая регулярная сетка WGS84: west, north, res, width, height,
              values — построчно с севера на юг, слева направо; null — пусто.
"""
from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CONTRACT_VERSION = "1.0"
MAX_POINTS = 200_000
MAX_GRID_CELLS = 3600 * 1800
MAX_LABELS = 300
ALLOWED_RES = (1.0, 0.5, 0.25, 0.1, 0.05)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _finite(v: float) -> float:
    if not math.isfinite(v):
        raise ValueError("значение должно быть конечным числом")
    return v


class PointItem(Strict):
    lat: float = Field(ge=-90, le=90, description="широта WGS84")
    lon: float = Field(ge=-180, le=180, description="долгота WGS84")
    value: float = Field(1.0, description="значение (по умолчанию 1 — «одна точка»)")
    label: str | None = Field(None, max_length=80, description="подпись над точкой")

    _v = field_validator("value")(lambda cls, v: _finite(v))


class CountryItem(Strict):
    iso3: str = Field(pattern=r"^[A-Za-z]{3}$", description="ISO 3166-1 alpha-3")
    value: float
    year: int | None = Field(None, ge=1800, le=2100, description="год — для временного ряда (у всех элементов или ни у кого)")

    _v = field_validator("value")(lambda cls, v: _finite(v))


class RegionItem(Strict):
    code: str = Field(pattern=r"^[A-Za-z]{2}-[A-Za-z0-9]{1,4}$", description="ISO 3166-2, напр. RU-MOW, KZ-ALA")
    value: float
    year: int | None = Field(None, ge=1800, le=2100, description="год — для временного ряда (у всех элементов или ни у кого)")

    _v = field_validator("value")(lambda cls, v: _finite(v))


class GridSpec(Strict):
    west: float = Field(ge=-180, le=360)
    north: float = Field(ge=-90, le=90)
    res: float = Field(gt=0.001, le=10, description="шаг, градусы")
    width: int = Field(ge=1, le=7200)
    height: int = Field(ge=1, le=3600)
    values: list[float | None]

    @model_validator(mode="after")
    def _check(self):
        if self.width * self.height > MAX_GRID_CELLS:
            raise ValueError(f"сетка больше {MAX_GRID_CELLS} ячеек")
        if len(self.values) != self.width * self.height:
            raise ValueError(f"values: ожидалось width*height = {self.width * self.height}, получено {len(self.values)}")
        if self.north - self.height * self.res < -90 - 1e-9:
            raise ValueError("сетка выходит за южный полюс")
        for v in self.values:
            if v is not None and not math.isfinite(v):
                raise ValueError("values: только конечные числа или null")
        return self


class Camera(Strict):
    longitude: float = Field(ge=-360, le=360)
    latitude: float = Field(ge=-85, le=85)
    zoom: float = Field(ge=0, le=12)
    pitch: float = Field(0, ge=0, le=85)
    bearing: float = Field(0, ge=-360, le=360)


class ViewHints(Strict):
    mode: Literal["columns", "surface"] | None = None
    theme: Literal["dark", "light"] | None = None
    projection: Literal["globe", "map"] | None = None
    palette: Literal["relief", "inferno", "viridis", "neon", "ice"] | None = None
    scale: Literal["log", "sqrt", "linear"] | None = None
    smooth: float | None = Field(None, ge=0, le=6)
    camera: Camera | None = None


class DatasetIn(Strict):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)
    unit: str | None = Field(None, max_length=40, description="единицы значения, напр. «₽», «шт.»")
    source: str | None = Field(None, max_length=200)
    kind: Literal["points", "countries", "regions", "grid"]
    points: list[PointItem] | None = Field(None, max_length=MAX_POINTS)
    countries: list[CountryItem] | None = Field(None, max_length=400 * 60)
    regions: list[RegionItem] | None = Field(None, max_length=2000 * 60)
    grid: GridSpec | None = None
    aggregation: Literal["sum", "mean", "count"] = "sum"
    res: float = Field(0.25, description=f"шаг агрегации точек, градусы: {ALLOWED_RES}")
    view: ViewHints | None = None
    ttl_days: int | None = Field(None, ge=1, le=365, description="срок жизни набора, дней (разовые визуализации из чата)")

    @model_validator(mode="after")
    def _payload_matches_kind(self):
        present = {k for k in ("points", "countries", "regions", "grid") if getattr(self, k) is not None}
        if present != {self.kind}:
            raise ValueError(f"kind={self.kind}: нужно передать ровно поле «{self.kind}» (передано: {sorted(present) or 'ничего'})")
        if self.kind == "points" and not self.points:
            raise ValueError("points: пустой список")
        if self.kind == "countries" and not self.countries:
            raise ValueError("countries: пустой список")
        if self.kind == "regions" and not self.regions:
            raise ValueError("regions: пустой список")
        if self.kind in ("countries", "regions"):
            items = self.countries if self.kind == "countries" else self.regions
            key = (lambda c: c.iso3.upper()) if self.kind == "countries" else (lambda c: c.code.upper())
            with_year = sum(c.year is not None for c in items)
            if 0 < with_year < len(items):
                raise ValueError(f"{self.kind}: year — у всех элементов (временной ряд) или ни у одного")
            if len({(key(c), c.year) for c in items}) < len(items):
                raise ValueError(f"{self.kind}: повтор {'(iso3, year)' if self.kind == 'countries' else '(code, year)'}")
        if self.res not in ALLOWED_RES:
            raise ValueError(f"res: допустимо {ALLOWED_RES}")
        return self


class DatasetOut(BaseModel):
    id: str
    title: str
    kind: str
    view_url: str
    embed_url: str
    embed_html: str
    snapshot_url: str
    stats: dict
    expires: float | None = None


RULES = [
    "Координаты — WGS84 (EPSG:4326), широта −90…90, долгота −180…180.",
    "Значения — конечные числа; NaN/Infinity запрещены (для пустых ячеек сетки — null).",
    f"points: до {MAX_POINTS} точек; агрегация в сетку шага res ∈ {ALLOWED_RES}; "
    "aggregation: sum (сумма в ячейке), mean (среднее), count (число точек).",
    f"Подписи точек (label): показываются до {MAX_LABELS} самых значимых.",
    "countries: ISO 3166-1 alpha-3 (как World Bank); неизвестный код — ошибка 422 со списком.",
    "countries с полем year (у всех элементов) — временной ряд: переключатель лет, общая шкала цвета на все годы.",
    "regions: регионы стран ЕАЭС (RUS, KAZ, BLR, KGZ, ARM, UZB, TJK) по коду ISO 3166-2 ({code, value, year?}); "
    "список кодов — GET /data/admin1_codes.json; неизвестный код — 422.",
    "ttl_days (1–365) — набор удаляется автоматически по истечении срока; DELETE /api/v1/datasets?older_than_days=N|all=true — массово.",
    f"grid: до {MAX_GRID_CELLS} ячеек; values построчно с севера на юг, null — пусто.",
    "Передаётся ровно одно поле данных, соответствующее kind.",
    "Создание/удаление — по API-ключу (заголовок X-API-Key); просмотр — по id набора, без ключа.",
    "PNG-снимок: snapshot_url из ответа (GET, без ключа) — для Telegram/MAX/.docx, где iframe не работает.",
]
