"""Общая логика REST и MCP: создание набора, ссылки на просмотр и встраивание."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from urllib.parse import urlencode

from .contract import CONTRACT_VERSION, RULES, DatasetIn
from .process import ContractError, countries_to_values, grid_to_array, points_to_grid, regions_to_values
from .store import Store

PUBLIC_URL = os.environ.get("GEOVIS_PUBLIC_URL", "http://localhost:8105").rstrip("/")
DATA_DIR = Path(os.environ.get("GEOVIS_DATA_DIR", "/data"))
STATIC_DATA = Path(os.environ.get("GEOVIS_STATIC_DATA", "/static-data"))
MAX_DATASETS_PER_KEY = int(os.environ.get("GEOVIS_MAX_DATASETS_PER_KEY", "500"))

store = Store(DATA_DIR)
store.ensure_admin(os.environ.get("GEOVIS_ADMIN_KEY"))


# k8s (тома local-path — общего тома с web нет): каталог берём по HTTP у web.
# GEOVIS_WEB_URL=http://geovis-web → данные в {WEB_URL}/data; GEOVIS_STATIC_URL — то же, но адрес каталога данных напрямую
STATIC_URL = (os.environ.get("GEOVIS_STATIC_URL")
              or (os.environ["GEOVIS_WEB_URL"].rstrip("/") + "/data" if os.environ.get("GEOVIS_WEB_URL") else "")).rstrip("/")
_static_cache: dict[str, tuple[float, object]] = {}


def static_json(name: str, fresh: bool = False):
    """Файл встроенных данных (catalog.json, iso_codes.json): с общего тома, иначе по HTTP у web, кеш 10 мин.
    fresh=True — мимо кеша (после обновления web кеш мог запомнить каталог старого пода)."""
    p = STATIC_DATA / name
    if p.exists():
        return json.loads(p.read_text())
    if not STATIC_URL:
        return None
    hit = _static_cache.get(name)
    if hit and not fresh and time.time() - hit[0] < 600:
        return hit[1]
    import urllib.request
    try:
        with urllib.request.urlopen(f"{STATIC_URL}/{name}", timeout=15) as r:
            data = json.load(r)
    except Exception:
        return hit[1] if hit else None   # web недоступен — последнее известное
    _static_cache[name] = (time.time(), data)
    return data


def iso_map() -> dict[str, str]:
    return static_json("iso_codes.json") or {}


class QuotaError(Exception):
    pass


def view_urls(ds_id: str, title: str, view: dict | None = None) -> dict:
    q = {"ds": ds_id}
    for k, v in (view or {}).items():
        if v is None or k == "camera":
            continue
        q[k] = v
    cam = (view or {}).get("camera")
    if cam:
        q["cam"] = ",".join(str(cam.get(k, 0)) for k in ("longitude", "latitude", "zoom", "pitch", "bearing"))
    view_url = f"{PUBLIC_URL}/?{urlencode(q)}"
    embed_url = f"{PUBLIC_URL}/?{urlencode({**q, 'embed': 1})}"
    safe = title.replace('"', "&quot;").replace("<", "&lt;")
    html = (f'<iframe src="{embed_url}" title="{safe}" width="100%" height="560" '
            'style="border:0" loading="lazy" allowfullscreen></iframe>')
    snap_q = {k: v for k, v in q.items() if k != "ds"}
    snapshot_url = f"{PUBLIC_URL}/api/v1/datasets/{ds_id}/snapshot.png" + (f"?{urlencode(snap_q)}" if snap_q else "")
    return {"view_url": view_url, "embed_url": embed_url, "embed_html": html, "snapshot_url": snapshot_url}


def create_dataset(ds: DatasetIn, key: dict) -> dict:
    if store.count(key["id"]) >= MAX_DATASETS_PER_KEY:
        raise QuotaError(f"лимит наборов на ключ: {MAX_DATASETS_PER_KEY}")
    files: dict[str, bytes] = {}
    stats: dict = {"kind": ds.kind}
    cv: dict = {}
    if ds.kind == "points":
        arr, gmeta, labels = points_to_grid(ds)
        files["grid.bin"] = arr.tobytes()
        files["grid.json"] = json.dumps(gmeta).encode()
        files["labels.json"] = json.dumps(labels, ensure_ascii=False).encode()
        stats.update(points=len(ds.points), cells=gmeta["cells"], labels=len(labels),
                     min=gmeta["min_value"], max=gmeta["max_density"], total=gmeta["total_population"])
    elif ds.kind == "grid":
        arr, gmeta = grid_to_array(ds)
        files["grid.bin"] = arr.tobytes()
        files["grid.json"] = json.dumps(gmeta).encode()
        stats.update(cells=gmeta["cells"], min=gmeta["min_value"], max=gmeta["max_density"])
    elif ds.kind == "regions":
        cv = regions_to_values(ds, set(static_json("admin1_codes.json") or []))
        files["regions.json"] = json.dumps(cv).encode()
        stats.update(regions=cv["count"], min=cv["min_value"], max=cv["max_value"])
    else:
        cv = countries_to_values(ds, iso_map())
        files["countries.json"] = json.dumps(cv).encode()
        stats.update(countries=cv["count"], min=cv["min_value"], max=cv["max_value"])

    ds_id = store.new_id()
    view = ds.view.model_dump(exclude_none=True) if ds.view else {}
    created = time.time()
    expires = created + ds.ttl_days * 86400 if ds.ttl_days else None
    if ds.kind in ("countries", "regions") and "years" in cv:
        stats.update(years=[cv["years"][0], cv["years"][-1]])
    meta = {
        "id": ds_id, "contract": CONTRACT_VERSION, "title": ds.title, "description": ds.description,
        "unit": ds.unit, "source": ds.source, "kind": ds.kind, "aggregation": ds.aggregation,
        "view": view, "created": created, "expires": expires, "stats": stats,
    }
    store.save(ds_id, key["id"], meta, files, expires)
    return {"id": ds_id, "title": ds.title, "kind": ds.kind, **view_urls(ds_id, ds.title, view), "stats": stats,
            "expires": expires}


def contract_doc() -> dict:
    return {
        "version": CONTRACT_VERSION,
        "rules": RULES,
        "schema": DatasetIn.model_json_schema(),
        "examples": EXAMPLES,
    }


EXAMPLES = {
    "points": {
        "title": "Магазины сети", "unit": "₽ выручки", "kind": "points", "aggregation": "sum", "res": 0.25,
        "points": [{"lat": 55.75, "lon": 37.62, "value": 1200000, "label": "Москва, Тверская"},
                   {"lat": 59.93, "lon": 30.33, "value": 800000, "label": "СПб, Невский"}],
        "view": {"mode": "columns", "theme": "light", "projection": "map",
                 "camera": {"longitude": 40, "latitude": 55, "zoom": 4, "pitch": 50, "bearing": 0}},
    },
    "countries": {
        "title": "Экспорт по странам", "unit": "$ млн", "kind": "countries",
        "countries": [{"iso3": "CHN", "value": 120000}, {"iso3": "DEU", "value": 45000}, {"iso3": "RUS", "value": 30000}],
        "view": {"theme": "dark", "projection": "globe"},
    },
    "regions": {
        "title": "Продажи по регионам", "unit": "₽ млн", "kind": "regions",
        "regions": [{"code": "RU-MOW", "value": 1200, "year": 2024}, {"code": "RU-SPE", "value": 640, "year": 2024},
                    {"code": "KZ-ALA", "value": 210, "year": 2024}],
        "view": {"theme": "light", "projection": "map"},
    },
    "grid": {
        "title": "Тестовая сетка", "unit": "°C", "kind": "grid",
        "grid": {"west": 30, "north": 60, "res": 1, "width": 2, "height": 2, "values": [1.5, 2.0, None, 3.25]},
    },
}


__all__ = ["store", "create_dataset", "contract_doc", "view_urls", "ContractError", "QuotaError", "PUBLIC_URL"]


def purge(key: dict, older_than_days: float | None, all_: bool) -> list[str]:
    """Массовое удаление своих наборов (администратор — всех): старше N дней или все."""
    if older_than_days is None and not all_:
        raise ValueError("нужен older_than_days=N или all=true")
    older = time.time() - older_than_days * 86400 if older_than_days is not None else None
    ids = store.ids_for_purge(None if key["is_admin"] else key["id"], older)
    for i in ids:
        store.delete(i)
    return ids


async def prefetch_static(retries: int = 60, pause: float = 5.0) -> None:
    """При старте: подтянуть каталог и коды стран у web, повторяя с паузой, пока web не поднимется (API не падает)."""
    import asyncio
    import logging
    if not STATIC_URL or (STATIC_DATA / "catalog.json").exists():
        return
    for attempt in range(retries):
        got = [await asyncio.to_thread(static_json, n) for n in ("catalog.json", "iso_codes.json")]
        if all(got):
            logging.getLogger("geovis").warning("каталог встроенных данных получен с %s", STATIC_URL)
            return
        await asyncio.sleep(pause)
    logging.getLogger("geovis").error("каталог с %s не получен за %d попыток — повторю при первом запросе", STATIC_URL, retries)
