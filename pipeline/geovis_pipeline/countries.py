"""Наборы «по странам» из World Bank WDI → значения по кодам ADM0_A3 Natural Earth."""
from __future__ import annotations

import json
import urllib.request

import geopandas as gpd

WB_API = "https://api.worldbank.org/v2/country/all/indicator/{ind}?format=json&mrnev=1&per_page=500"
WB_SERIES = "https://api.worldbank.org/v2/country/all/indicator/{ind}?format=json&date={y0}:{y1}&per_page=20000"


def fetch_world_bank(indicator: str) -> list[dict]:
    """Последнее непустое значение индикатора по каждой «стране» WB (вкл. агрегаты)."""
    req = urllib.request.Request(WB_API.format(ind=indicator), headers={"User-Agent": "geovis-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        meta, rows = json.load(r)
    return [{"iso3": x["countryiso3code"], "value": x["value"], "year": int(x["date"])}
            for x in rows if x.get("value") is not None and x.get("countryiso3code")]


def ne_code_map(shp) -> dict[str, str]:
    """ISO3 (как у WB) → ADM0_A3 (как в границах Natural Earth)."""
    df = gpd.read_file(shp, columns=["ADM0_A3", "ISO_A3_EH", "ISO_A3"], ignore_geometry=True)
    m: dict[str, str] = {"XKX": "KOS"}  # Косово: у WB — XKX, в NE ISO-код не задан
    for _, r in df.iterrows():
        for k in (r["ISO_A3_EH"], r["ISO_A3"], r["ADM0_A3"]):
            if isinstance(k, str) and len(k) == 3 and k != "-99":
                m.setdefault(k, r["ADM0_A3"])
    return m


def build_country_values(rows: list[dict], codes: dict[str, str]) -> list[dict]:
    """Оставляет только страны, которые есть на карте (агрегаты WLD/OED/… отбрасываются)."""
    out = [{"iso3": codes[r["iso3"]], "value": float(r["value"]), "year": r["year"]}
           for r in rows if r["iso3"] in codes]
    out.sort(key=lambda x: -x["value"])
    return out


def fetch_world_bank_series(indicator: str, y0: int = 2000, y1: int = 2025) -> list[dict]:
    """Все годы y0…y1 по всем «странам» WB (вкл. агрегаты): [{iso3, value, year}]."""
    url = WB_SERIES.format(ind=indicator, y0=y0, y1=y1)
    req = urllib.request.Request(url, headers={"User-Agent": "geovis-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        meta, rows = json.load(r)
    if meta.get("pages", 1) > 1:
        raise RuntimeError(f"WB {indicator}: данных больше одной страницы ({meta.get('total')}) — увеличьте per_page")
    return [{"iso3": x["countryiso3code"], "value": x["value"], "year": int(x["date"])}
            for x in rows if x.get("value") is not None and x.get("countryiso3code")]


def build_country_series(rows: list[dict], codes: dict[str, str]) -> dict:
    """Временной ряд в формате сайта/API: values — последний год каждой страны, series {год: [...]},
    min/max — по всем годам (общая шкала)."""
    rows = [r for r in rows if r["iso3"] in codes]
    years = sorted({r["year"] for r in rows})
    series = {}
    for y in years:
        vs = [{"iso3": codes[r["iso3"]], "value": float(r["value"])} for r in rows if r["year"] == y]
        series[str(y)] = sorted(vs, key=lambda x: -x["value"])
    latest: dict[str, dict] = {}
    for y in years:
        for v in series[str(y)]:
            latest[v["iso3"]] = {**v, "year": y}
    values = sorted(latest.values(), key=lambda x: -x["value"])
    allv = [v["value"] for vs in series.values() for v in vs]
    return {"values": values, "years": years, "series": series,
            "max_value": max(allv), "min_value": min(allv), "count": len(values)}
