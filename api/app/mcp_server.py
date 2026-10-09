"""MCP-сервер GeoVis (streamable HTTP, путь /mcp).

Агент (Claude и др.) подключается к <GEOVIS_PUBLIC_URL>/mcp с заголовком X-API-Key
и может: прочитать контракт, загрузить свой набор, получить ссылку/iframe, перечислить
и удалить свои наборы, построить ссылку на встроенные наборы (население, ВВП, рельеф…).
"""
from __future__ import annotations

import json
from urllib.parse import urlencode

from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import ValidationError
from starlette.responses import JSONResponse

from .contract import DatasetIn
from .service import PUBLIC_URL, ContractError, static_json, QuotaError, contract_doc, create_dataset, purge, store, view_urls

mcp = MCPServer(
    name="geovis",
    title="GeoVis — 3D гео-визуализация",
    instructions=(
        "GeoVis строит 3D-визуализации данных на глобусе/карте (столбики, поверхность, картограмма стран). "
        "Сначала вызови geovis_contract, чтобы увидеть формат. Свои данные — geovis_create_dataset "
        "(kind: points | countries | grid); в ответе ссылка view_url и код iframe embed_html. "
        "Встроенные наборы (население 1975–2030, ВВП, рельеф, климат, ночные огни) — geovis_builtin_catalog "
        "и geovis_builtin_view_url."
    ),
)


def _key(ctx: Context) -> dict:
    req = ctx.request_context.request
    raw = req.headers.get("x-api-key") if req is not None else None
    row = store.resolve_key(raw)
    if row is None:
        raise ToolError("нужен действующий API-ключ в заголовке X-API-Key")
    return dict(row)


@mcp.tool()
def geovis_contract() -> dict:
    """Контракт данных GeoVis: правила, JSON Schema входного набора и примеры (points / countries / grid)."""
    return contract_doc()


@mcp.tool()
def geovis_create_dataset(dataset: dict, ctx: Context) -> dict:
    """Загрузить набор по контракту (см. geovis_contract). Возвращает id, view_url, embed_url, embed_html, stats.

    dataset — объект: {title, kind: "points"|"countries"|"regions"|"grid", points|countries|regions|grid, unit?, aggregation?, res?, view?, ttl_days?}
    regions — регионы стран ЕАЭС по ISO 3166-2 (RU-MOW, KZ-ALA…), можно с year для временного ряда.
    """
    key = _key(ctx)
    try:
        ds = DatasetIn.model_validate(dataset)
    except ValidationError as e:
        raise ToolError("набор не соответствует контракту: " + "; ".join(
            f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()[:10]))
    try:
        return create_dataset(ds, key)
    except (ContractError, QuotaError) as e:
        raise ToolError(str(e))


@mcp.tool()
def geovis_list_datasets(ctx: Context) -> list[dict]:
    """Наборы, загруженные этим API-ключом (id, title, kind, created, bytes)."""
    key = _key(ctx)
    return store.list(None if key["is_admin"] else key["id"])


@mcp.tool()
def geovis_get_dataset(dataset_id: str) -> dict:
    """Метаданные и ссылки набора по id."""
    meta = store.meta(dataset_id)
    if not meta:
        raise ToolError("набор не найден")
    return {**meta, **view_urls(dataset_id, meta["title"], meta.get("view"))}


@mcp.tool()
def geovis_delete_dataset(dataset_id: str, ctx: Context) -> str:
    """Удалить свой набор по id."""
    key = _key(ctx)
    owner = store.owner(dataset_id)
    if owner is None:
        raise ToolError("набор не найден")
    if owner != key["id"] and not key["is_admin"]:
        raise ToolError("набор принадлежит другому ключу")
    store.delete(dataset_id)
    return f"удалён {dataset_id}"


@mcp.tool()
def geovis_purge_datasets(ctx: Context, older_than_days: float | None = None, all: bool = False) -> dict:
    """Массово удалить свои наборы: созданные раньше older_than_days дней, или all=true — все.

    Для разовых визуализаций из чата удобнее сразу задавать ttl_days при создании.
    """
    key = _key(ctx)
    try:
        ids = purge(key, older_than_days, all)
    except ValueError as e:
        raise ToolError(str(e))
    return {"deleted": len(ids), "ids": ids}


@mcp.tool()
def geovis_builtin_catalog() -> dict:
    """Встроенные наборы: id, группа, год, название, единицы, источник; страны-фокусы; наборы по странам."""
    cat = static_json("catalog.json", fresh=True)
    if not cat:
        raise ToolError("каталог встроенных наборов недоступен")
    return {
        "datasets": [{k: d.get(k) for k in ("id", "group", "year", "title", "unit", "source")} for d in cat["datasets"]],
        "country_datasets": [{k: d.get(k) for k in ("id", "title", "unit", "source", "years")} for d in cat.get("country_datasets", [])],
        "region_datasets": [{k: d.get(k) for k in ("id", "country", "title", "unit", "source", "years")}
                            for d in cat.get("region_datasets", [])],
        "focus": ["world"] + [r["iso3"] for r in cat["regions"]],
    }


def _builtin_ids(fresh: bool = False) -> tuple[set[str], set[str], set[str], set[str]]:
    """(сеточные наборы, наборы по странам, фокусы, наборы по регионам) из каталога встроенных данных."""
    cat = static_json("catalog.json", fresh=fresh)
    if not cat:
        raise ToolError("каталог встроенных наборов недоступен")
    return ({d["id"] for d in cat["datasets"]}, {d["id"] for d in cat.get("country_datasets", [])},
            {"world"} | {r["iso3"] for r in cat["regions"]}, {d["id"] for d in cat.get("region_datasets", [])})


@mcp.tool()
def geovis_builtin_view_url(dataset: str, focus: str = "world", mode: str | None = None,
                            theme: str | None = None, projection: str | None = None, embed: bool = False,
                            year: int | None = None) -> dict:
    """Ссылка, iframe и PNG-снимок встроенного набора (id из geovis_builtin_catalog).

    dataset: сеточный (pop2025, gdp2024, relief, …), по странам (wb_gdp, wb_gdppc) или по регионам РФ
    (rosstat_vrp, rosstat_vrp_pc, rosstat_pop) — тип определяется по каталогу.
    focus: world | RUS | KAZ | BLR | KGZ | ARM | UZB | TJK — только для сеточных; наборы по регионам сами
    открываются ракурсом своей страны, по странам — картой мира (focus для них не нужен и не попадает в ссылку).
    year: год для наборов по странам (временной ряд World Bank 2000–2025); по умолчанию — последний.
    snapshot_url — статичная картинка PNG для мессенджеров и документов (iframe там не работает).
    """
    grids, countries, foci, regions = _builtin_ids()
    if dataset not in grids | countries | regions or focus not in foci:   # кеш мог устареть после обновления
        grids, countries, foci, regions = _builtin_ids(fresh=True)
    if dataset in regions:
        q: dict[str, str | int] = {"regions": dataset}
        if year is not None:
            q["year"] = year
    elif dataset in countries:
        q = {"countries": dataset}
        if year is not None:
            if not 1800 <= year <= 2100:
                raise ToolError("year: 1800…2100")
            q["year"] = year
    elif dataset in grids:
        q = {"dataset": dataset}
        if focus not in foci:
            raise ToolError(f"focus: одно из {sorted(foci)}")
        if focus != "world":
            q["focus"] = focus
    else:
        raise ToolError(f"неизвестный набор «{dataset}»: сеточные {sorted(grids)}, по странам {sorted(countries)}, "
                        f"по регионам {sorted(regions)}")
    for k, v in (("mode", mode), ("theme", theme), ("projection", projection)):
        if v:
            q[k] = v
    url = f"{PUBLIC_URL}/?{urlencode({**q, **({'embed': 1} if embed else {})})}"
    return {"url": url, "embed_html": f'<iframe src="{url}" width="100%" height="560" style="border:0"></iframe>',
            "snapshot_url": f"{PUBLIC_URL}/api/v1/snapshot.png?{urlencode(q)}"}


_inner = mcp.streamable_http_app(
    streamable_http_path="/mcp", stateless_http=True, json_response=True,
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


async def mcp_http_app(scope, receive, send):
    """Пропускает к MCP только запросы с API-ключом (401 — без вызова инструментов)."""
    if scope["type"] == "http" and scope["path"].startswith("/mcp"):
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        if store.resolve_key(headers.get("x-api-key")) is None:
            await JSONResponse({"detail": "нужен действующий API-ключ в заголовке X-API-Key"}, status_code=401)(
                scope, receive, send)
            return
    await _inner(scope, receive, send)
