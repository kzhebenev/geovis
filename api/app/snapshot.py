"""PNG-снимки сцены (для мессенджеров и документов, где iframe не работает).

Параметры — те же, что у ссылки на сайт, но строго по белому списку: рендерер внутри сети
открывает страницу только с проверенными значениями.
"""
from __future__ import annotations

import os
import re
from urllib.parse import urlencode

import httpx

RENDERER_URL = os.environ.get("GEOVIS_RENDERER_URL", "http://renderer:8200").rstrip("/")
_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
ENUMS = {
    "mode": {"columns", "surface"}, "theme": {"dark", "light"}, "projection": {"globe", "map"},
    "palette": {"relief", "inferno", "viridis", "neon", "ice"}, "scale": {"log", "sqrt", "linear"},
    "lang": {"ru", "en"}, "labels": {"0", "1"}, "legend": {"0", "1"},
}
RANGES = {"smooth": (0, 6), "height": (0.1, 10)}
RES = {"1", "0.5", "0.25", "0.1", "0.05"}


class SnapshotParamError(ValueError):
    pass


def _int(k: str, v: str, lo: int, hi: int) -> int:
    try:
        x = int(v)
    except ValueError:
        raise SnapshotParamError(f"{k}: целое {lo}…{hi}")
    if not lo <= x <= hi:
        raise SnapshotParamError(f"{k}: целое {lo}…{hi}")
    return x


def clean_params(params: dict[str, str], allow_dataset: bool = True) -> tuple[dict[str, str], int, int]:
    """Проверяет параметры снимка; возвращает (параметры сцены, w, h). Ошибка — SnapshotParamError."""
    out: dict[str, str] = {}
    w, h = 1200, 675
    for k, v in params.items():
        if k == "w":
            w = _int(k, v, 320, 1920)
        elif k == "h":
            h = _int(k, v, 240, 1080)
        elif k == "focus" or (allow_dataset and k in ("dataset", "countries", "regions")):
            if not _ID.match(v):
                raise SnapshotParamError(f"{k}: допустимы латиница, цифры, _ и -")
            out[k] = v
        elif k in ENUMS:
            if v not in ENUMS[k]:
                raise SnapshotParamError(f"{k}: одно из {sorted(ENUMS[k])}")
            out[k] = v
        elif k in RANGES:
            lo, hi = RANGES[k]
            try:
                x = float(v)
            except ValueError:
                raise SnapshotParamError(f"{k}: число {lo}…{hi}")
            if not lo <= x <= hi:
                raise SnapshotParamError(f"{k}: число {lo}…{hi}")
            out[k] = v
        elif k == "compare":
            if not _ID.match(v):
                raise SnapshotParamError("compare: id набора")
            out[k] = v
        elif k == "syear":
            try:
                x = float(v)
            except ValueError:
                raise SnapshotParamError("syear: год 1800…2100")
            if not 1800 <= x <= 2100:
                raise SnapshotParamError("syear: год 1800…2100")
            out[k] = v
        elif k == "year":
            out[k] = str(_int(k, v, 1800, 2100))
        elif k == "res":
            if v not in RES:
                raise SnapshotParamError(f"res: одно из {sorted(RES)}")
            out[k] = v
        elif k == "cam":
            parts = v.split(",")
            try:
                nums = [float(x) for x in parts]
            except ValueError:
                raise SnapshotParamError("cam: lon,lat,zoom[,pitch,bearing]")
            if not 3 <= len(nums) <= 5 or abs(nums[1]) > 85 or not 0 <= nums[2] <= 12 \
                    or (len(nums) > 3 and not 0 <= nums[3] <= 85):
                raise SnapshotParamError("cam: lon,lat,zoom[,pitch,bearing]; |lat|≤85, zoom 0…12, pitch 0…85")
            out[k] = v
        else:
            raise SnapshotParamError(f"неизвестный параметр «{k}»")
    return out, w, h


def snapshot_query(params: dict[str, str]) -> str:
    return urlencode(params)


async def render(params: dict[str, str], w: int, h: int) -> tuple[int, bytes, dict]:
    """Запрос к рендереру. Возвращает (статус, тело, заголовки для ответа)."""
    async with httpx.AsyncClient(timeout=180) as c:
        r = await c.get(f"{RENDERER_URL}/render", params={**params, "w": w, "h": h})
    hdr = {k: r.headers[k] for k in ("X-Cache", "X-Render-Ms") if k in r.headers}
    return r.status_code, r.content, hdr


def lenient_params(params: dict[str, str]) -> dict[str, str]:
    """Для превью: оставить только допустимые параметры с корректными значениями (остальное — отбросить)."""
    out: dict[str, str] = {}
    ds = params.get("ds")
    if ds and _ID.match(ds):
        out["ds"] = ds
    for k, v in params.items():
        if k in ("w", "h", "ds"):
            continue
        try:
            ok, _, _ = clean_params({k: v})
            out.update(ok)
        except SnapshotParamError:
            pass
    return out
