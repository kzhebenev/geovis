"""MCP по-настоящему: JSON-RPC через streamable HTTP, как подключается агент."""
import json

H = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


def rpc(client, method, params, key, i=1):
    r = client.post("/mcp", headers={**H, **key}, json={"jsonrpc": "2.0", "id": i, "method": method, "params": params})
    return r


def call(client, key, tool, args):
    r = rpc(client, "tools/call", {"name": tool, "arguments": args}, key)
    assert r.status_code == 200, r.text
    return r.json()["result"]


def payload(result):
    if result.get("structuredContent") is not None:
        sc = result["structuredContent"]
        return sc.get("result", sc)
    return json.loads(result["content"][0]["text"])


def test_mcp_requires_key(client):
    r = client.post("/mcp", headers=H, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
    assert r.status_code == 401


def test_mcp_tools_list(client, user_key):
    r = rpc(client, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                   "clientInfo": {"name": "t", "version": "1"}}, user_key)
    assert r.status_code == 200, r.text
    names = {t["name"] for t in rpc(client, "tools/list", {}, user_key).json()["result"]["tools"]}
    assert {"geovis_contract", "geovis_create_dataset", "geovis_list_datasets", "geovis_get_dataset",
            "geovis_delete_dataset", "geovis_builtin_catalog", "geovis_builtin_view_url"} <= names


def test_mcp_create_list_delete(client, user_key):
    res = call(client, user_key, "geovis_create_dataset", {"dataset": {
        "title": "Из MCP", "kind": "countries", "countries": [{"iso3": "DEU", "value": 5}]}})
    assert not res.get("isError"), res
    out = payload(res)
    assert out["view_url"].startswith("https://geovis.test/?ds=")
    ids = [d["id"] for d in payload(call(client, user_key, "geovis_list_datasets", {}))]
    assert out["id"] in ids
    assert not call(client, user_key, "geovis_delete_dataset", {"dataset_id": out["id"]}).get("isError")
    assert client.get(f"/api/v1/datasets/{out['id']}").status_code == 404


def test_mcp_invalid_dataset_is_error(client, user_key):
    res = call(client, user_key, "geovis_create_dataset", {"dataset": {"title": "x", "kind": "points",
                                                                      "points": [{"lat": 200, "lon": 0}]}})
    assert res.get("isError") is True
    assert "контракт" in res["content"][0]["text"]


def test_mcp_contract_and_builtin(client, user_key):
    c = payload(call(client, user_key, "geovis_contract", {}))
    assert c["version"] == "1.0"
    cat = payload(call(client, user_key, "geovis_builtin_catalog", {}))
    assert cat["datasets"][0]["id"] == "pop2025" and "RUS" in cat["focus"]
    u = payload(call(client, user_key, "geovis_builtin_view_url", {"dataset": "pop2025", "focus": "KAZ", "embed": True}))
    assert "dataset=pop2025" in u["url"] and "focus=KAZ" in u["url"] and "embed=1" in u["url"]
    assert u["snapshot_url"] == "https://geovis.test/api/v1/snapshot.png?dataset=pop2025&focus=KAZ"


def test_mcp_builtin_country_dataset_goes_to_countries_param(client, user_key):
    """Дефект от пользователя API: wb_gdp попадал в ?dataset= — сайт открывался без данных."""
    u = payload(call(client, user_key, "geovis_builtin_view_url", {"dataset": "wb_gdp"}))
    assert "countries=wb_gdp" in u["url"] and "dataset=" not in u["url"]
    assert u["snapshot_url"].endswith("/api/v1/snapshot.png?countries=wb_gdp")
    u = payload(call(client, user_key, "geovis_builtin_view_url", {"dataset": "wb_gdp", "year": 2015}))
    assert "year=2015" in u["url"] and u["snapshot_url"].endswith("countries=wb_gdp&year=2015")


def test_mcp_builtin_unknown_is_error(client, user_key):
    r = call(client, user_key, "geovis_builtin_view_url", {"dataset": "nope"})
    assert r.get("isError") and "неизвестный набор" in r["content"][0]["text"]
    r = call(client, user_key, "geovis_builtin_view_url", {"dataset": "pop2025", "focus": "ZZZ"})
    assert r.get("isError") and "focus" in r["content"][0]["text"]


def test_mcp_purge(client, user_key):
    for _ in range(2):
        call(client, user_key, "geovis_create_dataset", {"dataset": {"title": "p", "kind": "countries",
                                                                    "countries": [{"iso3": "RUS", "value": 1}], "ttl_days": 3}})
    out = payload(call(client, user_key, "geovis_purge_datasets", {"all": True}))
    assert out["deleted"] >= 2
    assert call(client, user_key, "geovis_purge_datasets", {}).get("isError")   # без условия — ошибка



def test_mcp_builtin_region_dataset(client, user_key):
    u = payload(call(client, user_key, "geovis_builtin_view_url", {"dataset": "rosstat_vrp", "year": 2020}))
    assert "regions=rosstat_vrp" in u["url"] and "year=2020" in u["url"] and "dataset=" not in u["url"]
    assert u["snapshot_url"].endswith("snapshot.png?regions=rosstat_vrp&year=2020")
    cat = payload(call(client, user_key, "geovis_builtin_catalog", {}))
    assert cat["region_datasets"][0]["id"] == "rosstat_vrp"


def test_mcp_builtin_stale_catalog_cache(client, user_key, tmp_path, monkeypatch):
    """После обновления web кеш API мог запомнить каталог старого пода (без region_datasets) —
    неизвестный набор перечитывает каталог мимо кеша, а не отвечает «неизвестный набор» 10 минут."""
    import http.server, threading, time
    from app import service
    (tmp_path / "catalog.json").write_text(json.dumps({"datasets": [{"id": "pop2025"}], "regions": [],
        "region_datasets": [{"id": "rosstat_vrp"}]}))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0),
        lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(tmp_path), **k))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(service, "STATIC_DATA", tmp_path / "нет-тома")
    monkeypatch.setattr(service, "STATIC_URL", f"http://127.0.0.1:{srv.server_address[1]}")
    service._static_cache["catalog.json"] = (time.time(), {"datasets": [{"id": "pop2025"}], "regions": []})  # старый, свежий по времени
    try:
        u = payload(call(client, user_key, "geovis_builtin_view_url", {"dataset": "rosstat_vrp", "focus": "RUS"}))
        assert "regions=rosstat_vrp" in u["url"]
        assert call(client, user_key, "geovis_builtin_view_url", {"dataset": "nope"}).get("isError")   # негатив: неизвестный — ошибка
    finally:
        srv.shutdown(); srv.server_close(); service._static_cache.clear()
