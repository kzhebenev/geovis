"""GeoVis API: приём пользовательских наборов для гео-визуализации + MCP-сервер.

REST:  /api/v1/...   (Swagger — /api/docs)
MCP:   /mcp          (streamable HTTP, заголовок X-API-Key)
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from .contract import DatasetIn, DatasetOut
from .mcp_server import mcp, mcp_http_app
from .service import ContractError, QuotaError, contract_doc, create_dataset, prefetch_static, purge, store, view_urls
from . import snapshot

import os as _os
from pathlib import Path as _Path

# версия проекта: файл VERSION кладёт deploy.sh рядом с кодом; в тестах — переменная или «dev»
_vf = _Path(__file__).with_name("VERSION")
VERSION = _vf.read_text().strip() if _vf.exists() else _os.environ.get("GEOVIS_VERSION", "dev")


log = logging.getLogger("geovis")


async def _purge_loop():
    """Раз в час удаляет наборы с истёкшим ttl_days (и один раз — сразу при старте)."""
    while True:
        try:
            n = store.purge_expired()
            if n:
                log.warning("удалено просроченных наборов: %d", n)
        except Exception as e:  # чистка не должна ронять API
            log.error("чистка просроченных: %s", e)
        await asyncio.sleep(3600)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_purge_loop())
    prefetch = asyncio.create_task(prefetch_static())   # не блокирует старт и health
    async with mcp.session_manager.run():
        yield
    task.cancel()
    prefetch.cancel()


app = FastAPI(
    title="GeoVis API", version=VERSION, lifespan=lifespan,
    docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None,
    description="Передайте свои данные (точки, страны, сетка) — получите 3D-визуализацию на глобусе/карте, "
                "ссылку и код для встраивания. Контракт: GET /api/v1/contract. MCP: /mcp.",
)


def require_key(x_api_key: str | None = Header(None, alias="X-API-Key")) -> dict:
    row = store.resolve_key(x_api_key)
    if row is None:
        raise HTTPException(401, "нужен действующий API-ключ в заголовке X-API-Key")
    return dict(row)


def require_admin(key: dict = Depends(require_key)) -> dict:
    if not key["is_admin"]:
        raise HTTPException(403, "нужен ключ администратора")
    return key


@app.get("/api/v1/health")
def health():
    """Живость API: быстро, без обращения к рендереру и web (для liveness/readiness)."""
    return {"status": "ok", "version": VERSION}


@app.get("/api/v1/contract")
def contract():
    """Контракт данных: правила, JSON Schema и примеры для каждого вида данных."""
    return contract_doc()


@app.post("/api/v1/datasets", response_model=DatasetOut, status_code=201)
def post_dataset(ds: DatasetIn, key: dict = Depends(require_key)):
    """Создать набор. Возвращает id, ссылку на просмотр и код iframe для встраивания."""
    try:
        return create_dataset(ds, key)
    except ContractError as e:
        raise HTTPException(422, str(e))
    except QuotaError as e:
        raise HTTPException(429, str(e))


@app.get("/api/v1/datasets")
def list_datasets(key: dict = Depends(require_key)):
    """Наборы этого ключа (администратор видит все)."""
    return store.list(None if key["is_admin"] else key["id"])


@app.get("/api/v1/datasets/{ds_id}")
def get_dataset(ds_id: str):
    """Метаданные набора (публично по id — для просмотра и встраивания)."""
    meta = store.meta(ds_id)
    if not meta:
        raise HTTPException(404, "набор не найден")
    return {**meta, **view_urls(ds_id, meta["title"], meta.get("view"))}


@app.get("/api/v1/datasets/{ds_id}/files/{name}")
def get_file(ds_id: str, name: str):
    p = store.file(ds_id, name)
    if p is None:
        raise HTTPException(404, "файл не найден")
    media = "application/octet-stream" if name.endswith(".bin") else "application/json"
    return FileResponse(p, media_type=media, headers={"Cache-Control": "public, max-age=3600"})


@app.delete("/api/v1/datasets")
def purge_datasets(older_than_days: float | None = None, all: bool = False, key: dict = Depends(require_key)):
    """Массовое удаление наборов этого ключа: созданных раньше older_than_days дней или all=true — все."""
    if older_than_days is not None and older_than_days < 0:
        raise HTTPException(422, "older_than_days ≥ 0")
    try:
        ids = purge(key, older_than_days, all)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"deleted": len(ids), "ids": ids}


@app.delete("/api/v1/datasets/{ds_id}", status_code=204)
def delete_dataset(ds_id: str, key: dict = Depends(require_key)):
    owner = store.owner(ds_id)
    if owner is None:
        raise HTTPException(404, "набор не найден")
    if owner != key["id"] and not key["is_admin"]:
        raise HTTPException(403, "набор принадлежит другому ключу")
    store.delete(ds_id)


async def _snapshot(params: dict[str, str], w: int, h: int, max_age: int) -> Response:
    status, body, hdr = await snapshot.render(params, w, h)
    if status != 200:
        try:
            detail = json.loads(body).get("detail", "")
        except Exception:
            detail = body[:200].decode(errors="replace")
        raise HTTPException(status if status in (404, 422) else 502, f"снимок не построен: {detail}")
    return Response(body, media_type="image/png", headers={**hdr, "Cache-Control": f"public, max-age={max_age}"})


@app.get("/api/v1/datasets/{ds_id}/snapshot.png", response_class=Response)
async def dataset_snapshot(ds_id: str, request: Request):
    """PNG-снимок своего набора (публично по id). Параметры вида — как у ссылки (mode, theme, cam, lang, legend…), w/h — размер."""
    if not store.meta(ds_id):
        raise HTTPException(404, "набор не найден")
    try:
        params, w, h = snapshot.clean_params(dict(request.query_params), allow_dataset=False)
    except snapshot.SnapshotParamError as e:
        raise HTTPException(422, str(e))
    return await _snapshot({"ds": ds_id, **params}, w, h, 86400)


@app.get("/api/v1/snapshot.png", response_class=Response)
async def builtin_snapshot(request: Request):
    """PNG-снимок встроенного набора: dataset=pop2025|gdp2024|… или countries=wb_gdp, focus=world|RUS|KAZ|…, вид, cam, w/h."""
    try:
        params, w, h = snapshot.clean_params(dict(request.query_params))
    except snapshot.SnapshotParamError as e:
        raise HTTPException(422, str(e))
    if not {"dataset", "countries", "regions"} & set(params):
        raise HTTPException(422, "нужен dataset=<сеточный набор>, countries=<по странам> или regions=<по регионам>")
    return await _snapshot(params, w, h, 3600)


# ---------- видео сценария (MP4, покадровый рендер в renderer) ----------
from typing import Literal  # noqa: E402

from fastapi.responses import StreamingResponse  # noqa: E402
import httpx  # noqa: E402


class CameraIn(BaseModel):
    longitude: float = Field(ge=-360, le=360)
    latitude: float = Field(ge=-85, le=85)
    zoom: float = Field(ge=0, le=12)
    pitch: float = Field(0, ge=0, le=85)
    bearing: float = Field(0, ge=-720, le=720)


class KeyframeIn(BaseModel):
    t: float = Field(ge=0, le=180)
    camera: CameraIn
    easing: Literal["linear", "inOutCubic", "inOutSine", "outCubic"] | None = None
    arc: bool | None = None
    settings: dict | None = None
    caption: dict | None = None


class ScenarioIn(BaseModel):
    id: str | None = Field(None, max_length=64)
    title: dict | None = None
    keyframes: list[KeyframeIn] = Field(min_length=1, max_length=300)


class VideoIn(BaseModel):
    scenario: ScenarioIn
    fps: Literal[24, 25, 30] = 30
    quality: Literal["720p", "1080p", "720p_v", "1080p_v"] = "720p"   # _v — вертикальное 9:16


@app.post("/api/v1/videos", status_code=202)
async def create_video(body: VideoIn):
    """Записать сценарий в MP4 (до 180 с, 720p/1080p или вертикально 9:16 — 720p_v/1080p_v, 24/25/30 к/с). Возвращает id задачи; прогресс — GET /api/v1/videos/{id}."""
    ts = [k.t for k in body.scenario.keyframes]
    if ts != sorted(ts):
        raise HTTPException(422, "keyframes: время должно возрастать")
    w, h = {"720p": (1280, 720), "1080p": (1920, 1080), "720p_v": (720, 1280), "1080p_v": (1080, 1920)}[body.quality]
    spec = {"scenario": body.scenario.model_dump(exclude_none=True), "fps": body.fps, "w": w, "h": h}
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{snapshot.RENDERER_URL}/video", json=spec)
    if r.status_code not in (200, 202):
        raise HTTPException(r.status_code if r.status_code in (400, 429) else 502, r.json().get("detail", "рендерер недоступен"))
    return r.json()


@app.get("/api/v1/videos/{job_id}.mp4", response_class=StreamingResponse)
async def video_file(job_id: str):
    if not job_id.isalnum():
        raise HTTPException(404, "видео не найдено")
    c = httpx.AsyncClient(timeout=None)
    req = c.build_request("GET", f"{snapshot.RENDERER_URL}/video/{job_id}.mp4")
    r = await c.send(req, stream=True)
    if r.status_code != 200:
        detail = (await r.aread()).decode(errors="replace")[:300]
        await r.aclose(); await c.aclose()
        raise HTTPException(r.status_code, detail)

    async def body():
        try:
            async for chunk in r.aiter_bytes(1 << 16):
                yield chunk
        finally:
            await r.aclose(); await c.aclose()
    return StreamingResponse(body(), media_type="video/mp4", headers={
        "Content-Length": r.headers.get("content-length", ""), "Content-Disposition": f'attachment; filename="geovis-{job_id}.mp4"'})


@app.get("/api/v1/videos/{job_id}")
async def video_status(job_id: str):
    """Статус задачи видео: queued | rendering | done | error, кадр/кадров, оценка оставшегося времени."""
    if not job_id.isalnum():
        raise HTTPException(404, "видео не найдено")
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{snapshot.RENDERER_URL}/video/{job_id}")
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.json().get("detail", ""))
    return r.json()


@app.get("/api/v1/preview.png", response_class=Response)
async def preview(request: Request):
    """Картинка для превью ссылки (og:image): параметры как у ссылки на сайт, лишние и кривые — молча отбрасываются,
    без набора — население мира. Размер 1200×630 (Open Graph)."""
    params = snapshot.lenient_params(dict(request.query_params))
    ds = params.pop("ds", None)
    if ds and store.meta(ds):
        return await _snapshot({"ds": ds, **params}, 1200, 630, 86400)
    if not {"dataset", "countries", "regions"} & set(params):
        params["dataset"] = "pop2025"
    return await _snapshot(params, 1200, 630, 3600)


class KeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=80, description="кому выдан (проект/клиент)")


@app.post("/api/v1/keys", status_code=201)
def create_key(body: KeyIn, _: dict = Depends(require_admin)):
    """Выдать API-ключ проекту (только администратор). Ключ показывается один раз."""
    kid, raw = store.create_key(body.name)
    return {"id": kid, "name": body.name, "api_key": raw}


@app.exception_handler(json.JSONDecodeError)
async def bad_json(_: Request, e: json.JSONDecodeError):
    return JSONResponse({"detail": f"некорректный JSON: {e}"}, status_code=400)


app.mount("/", mcp_http_app)
