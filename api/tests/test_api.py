import numpy as np

from tests.conftest import ADMIN

PTS = {"title": "Магазины", "unit": "₽", "kind": "points", "aggregation": "sum", "res": 1.0,
       "points": [{"lat": 55.75, "lon": 37.62, "value": 100, "label": "Москва"},
                  {"lat": 55.70, "lon": 37.50, "value": 50},
                  {"lat": 59.93, "lon": 30.33, "value": 30, "label": "СПб"}]}


def test_health_and_contract(client):
    assert client.get("/api/v1/health").json()["status"] == "ok"
    c = client.get("/api/v1/contract").json()
    assert c["version"] == "1.0" and len(c["rules"]) >= 5
    assert set(c["examples"]) == {"points", "countries", "regions", "grid"}
    assert "points" in c["schema"]["properties"]


def test_write_requires_key(client):
    assert client.post("/api/v1/datasets", json=PTS).status_code == 401
    assert client.post("/api/v1/datasets", json=PTS, headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.get("/api/v1/datasets").status_code == 401


def test_only_admin_creates_keys(client, user_key):
    assert client.post("/api/v1/keys", json={"name": "x"}, headers=user_key).status_code == 403
    assert client.post("/api/v1/keys", json={"name": "x"}).status_code == 401


def test_points_aggregated_into_grid(client, user_key):
    r = client.post("/api/v1/datasets", json=PTS, headers=user_key)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["view_url"].startswith("https://geovis.test/?ds=") and "embed=1" in out["embed_url"]
    assert "<iframe" in out["embed_html"]
    assert out["stats"]["points"] == 3 and out["stats"]["total"] == 180 and out["stats"]["labels"] == 2
    ds = out["id"]
    g = client.get(f"/api/v1/datasets/{ds}/files/grid.json").json()
    arr = np.frombuffer(client.get(f"/api/v1/datasets/{ds}/files/grid.bin").content, dtype=np.float32)
    arr = arr.reshape(g["height"], g["width"])
    # Москва: 100 + 50 в одной ячейке 1°; СПб — 30; остальное пусто
    r_m, c_m = int((g["north"] - 55.75) // 1), int((37.62 - g["west"]) // 1)
    r_s, c_s = int((g["north"] - 59.93) // 1), int((30.33 - g["west"]) // 1)
    assert arr[r_m, c_m] == 150 and arr[r_s, c_s] == 30
    assert np.isnan(arr).sum() == arr.size - 2
    labels = client.get(f"/api/v1/datasets/{ds}/files/labels.json").json()
    assert [l["label"] for l in labels] == ["Москва", "СПб"]
    meta = client.get(f"/api/v1/datasets/{ds}").json()   # публично, без ключа
    assert meta["title"] == "Магазины" and meta["kind"] == "points"


def test_points_mean_and_count(client, user_key):
    for agg, expect in (("mean", 75), ("count", 2)):
        r = client.post("/api/v1/datasets", json={**PTS, "aggregation": agg}, headers=user_key).json()
        g = client.get(f"/api/v1/datasets/{r['id']}/files/grid.json").json()
        arr = np.frombuffer(client.get(f"/api/v1/datasets/{r['id']}/files/grid.bin").content, dtype=np.float32)
        assert np.nanmax(arr) == expect, agg


def test_invalid_points_rejected(client, user_key):
    bad = [
        {**PTS, "points": [{"lat": 95, "lon": 0, "value": 1}]},                 # широта за пределами
        {**PTS, "points": [{"lat": 0, "lon": 0, "value": "NaN"}]},              # не число
        {**PTS, "points": []},                                                  # пусто
        {**PTS, "res": 0.3},                                                    # недопустимый шаг
        {**PTS, "countries": [{"iso3": "RUS", "value": 1}]},                    # лишнее поле данных
        {**PTS, "hack": 1},                                                     # неизвестное поле
        {"title": "x", "kind": "points"},                                      # нет данных
    ]
    for b in bad:
        assert client.post("/api/v1/datasets", json=b, headers=user_key).status_code == 422, b


def test_countries(client, user_key):
    body = {"title": "Экспорт", "kind": "countries",
            "countries": [{"iso3": "rus", "value": 3}, {"iso3": "SSD", "value": 1}, {"iso3": "CHN", "value": 9}]}
    r = client.post("/api/v1/datasets", json=body, headers=user_key)
    assert r.status_code == 201
    v = client.get(f"/api/v1/datasets/{r.json()['id']}/files/countries.json").json()
    assert [x["iso3"] for x in v["values"]] == ["CHN", "RUS", "SDS"]   # SSD → код границ NE
    # негатив: несуществующая страна
    bad = client.post("/api/v1/datasets", json={**body, "countries": [{"iso3": "XYZ", "value": 1}]}, headers=user_key)
    assert bad.status_code == 422 and "XYZ" in bad.text


def test_grid(client, user_key):
    body = {"title": "Сетка", "kind": "grid",
            "grid": {"west": 30, "north": 60, "res": 1, "width": 2, "height": 2, "values": [1.5, 2, None, 3.25]}}
    r = client.post("/api/v1/datasets", json=body, headers=user_key)
    assert r.status_code == 201
    arr = np.frombuffer(client.get(f"/api/v1/datasets/{r.json()['id']}/files/grid.bin").content, dtype=np.float32)
    assert arr[0] == 1.5 and np.isnan(arr[2]) and arr[3] == 3.25
    wrong = {**body, "grid": {**body["grid"], "values": [1, 2, 3]}}   # длина ≠ width*height
    assert client.post("/api/v1/datasets", json=wrong, headers=user_key).status_code == 422


def test_view_hints_go_to_url(client, user_key):
    body = {**PTS, "view": {"mode": "surface", "theme": "light", "camera":
                            {"longitude": 40, "latitude": 55, "zoom": 4, "pitch": 50, "bearing": 10}}}
    out = client.post("/api/v1/datasets", json=body, headers=user_key).json()
    assert "mode=surface" in out["view_url"] and "theme=light" in out["view_url"] and "cam=40" in out["view_url"]


def test_list_and_delete_ownership(client, user_key):
    other = {"X-API-Key": client.post("/api/v1/keys", json={"name": "other"}, headers=ADMIN).json()["api_key"]}
    ds = client.post("/api/v1/datasets", json=PTS, headers=user_key).json()["id"]
    assert ds in [d["id"] for d in client.get("/api/v1/datasets", headers=user_key).json()]
    assert ds not in [d["id"] for d in client.get("/api/v1/datasets", headers=other).json()]
    assert client.delete(f"/api/v1/datasets/{ds}", headers=other).status_code == 403   # чужой
    assert client.delete(f"/api/v1/datasets/{ds}", headers=user_key).status_code == 204
    assert client.get(f"/api/v1/datasets/{ds}").status_code == 404
    assert client.delete(f"/api/v1/datasets/{ds}", headers=user_key).status_code == 404


def test_path_traversal_blocked(client):
    assert client.get("/api/v1/datasets/..%2F..%2Fgeovis.db").status_code == 404
    assert client.get("/api/v1/datasets/abc/files/..%2Fmeta.json").status_code == 404


def test_countries_time_series(client, user_key):
    body = {"title": "ВВП ЕАЭС", "unit": "$", "kind": "countries", "countries": [
        {"iso3": "RUS", "value": 1.3e12, "year": 2015}, {"iso3": "RUS", "value": 2.2e12, "year": 2024},
        {"iso3": "KAZ", "value": 0.18e12, "year": 2015}, {"iso3": "KAZ", "value": 0.29e12, "year": 2024},
        {"iso3": "DEU", "value": 3.4e12, "year": 2015}]}
    r = client.post("/api/v1/datasets", json=body, headers=user_key)
    assert r.status_code == 201, r.text
    assert r.json()["stats"]["years"] == [2015, 2024]
    v = client.get(f"/api/v1/datasets/{r.json()['id']}/files/countries.json").json()
    assert v["years"] == [2015, 2024] and set(v["series"]) == {"2015", "2024"}
    latest = {x["iso3"]: x for x in v["values"]}
    assert latest["RUS"]["value"] == 2.2e12 and latest["RUS"]["year"] == 2024
    assert latest["DEU"]["year"] == 2015                     # страна без 2024 — последний свой год
    assert v["max_value"] == 3.4e12 and v["min_value"] == 0.18e12   # общая шкала по всем годам
    # негатив: год не у всех, повтор пары
    mixed = {**body, "countries": [{"iso3": "RUS", "value": 1, "year": 2015}, {"iso3": "KAZ", "value": 1}]}
    assert client.post("/api/v1/datasets", json=mixed, headers=user_key).status_code == 422
    dup = {**body, "countries": [{"iso3": "RUS", "value": 1, "year": 2015}, {"iso3": "rus", "value": 2, "year": 2015}]}
    assert client.post("/api/v1/datasets", json=dup, headers=user_key).status_code == 422


def test_ttl_expiry(client, user_key):
    import time
    from app.service import store
    r = client.post("/api/v1/datasets", json={**PTS, "ttl_days": 1}, headers=user_key).json()
    assert r["expires"] and 86000 < r["expires"] - time.time() < 86500
    ds = r["id"]
    assert client.get(f"/api/v1/datasets/{ds}").status_code == 200
    # срок истёк: набор сразу недоступен, чистка удаляет файлы
    store.db.execute("UPDATE datasets SET expires=? WHERE id=?", (time.time() - 1, ds)); store.db.commit()
    mp = store.files / ds / "meta.json"; m = __import__("json").loads(mp.read_text()); m["expires"] = time.time() - 1
    mp.write_text(__import__("json").dumps(m))
    assert client.get(f"/api/v1/datasets/{ds}").status_code == 404
    assert ds not in [d["id"] for d in client.get("/api/v1/datasets", headers=user_key).json()]
    assert store.purge_expired() >= 1 and not (store.files / ds).exists()
    assert client.post("/api/v1/datasets", json={**PTS, "ttl_days": 0}, headers=user_key).status_code == 422
    assert client.post("/api/v1/datasets", json={**PTS, "ttl_days": 999}, headers=user_key).status_code == 422


def test_purge_own_only(client, user_key):
    other = {"X-API-Key": client.post("/api/v1/keys", json={"name": "purge-other"}, headers=ADMIN).json()["api_key"]}
    mine = [client.post("/api/v1/datasets", json=PTS, headers=user_key).json()["id"] for _ in range(2)]
    theirs = client.post("/api/v1/datasets", json=PTS, headers=other).json()["id"]
    assert client.delete("/api/v1/datasets", headers=user_key).status_code == 422          # без условия — нельзя
    assert client.delete("/api/v1/datasets?older_than_days=1", headers=user_key).json()["deleted"] == 0  # свежие
    r = client.delete("/api/v1/datasets?all=true", headers=user_key).json()
    assert set(mine) <= set(r["ids"]) and theirs not in r["ids"]
    assert client.get(f"/api/v1/datasets/{theirs}").status_code == 200                    # чужой цел
    assert client.delete("/api/v1/datasets?all=true").status_code == 401


def test_health_version():
    from app.main import VERSION
    from pathlib import Path
    vf = Path(__file__).resolve().parents[1] / "app" / "VERSION"
    assert VERSION == (vf.read_text().strip() if vf.exists() else "dev")


def test_static_json_over_http(tmp_path, monkeypatch):
    """k8s без общего тома: каталог и коды стран — по HTTP у web, с кешем и запасом на его недоступность."""
    import http.server, json, threading
    from app import service
    (tmp_path / "catalog.json").write_text(json.dumps({"datasets": [{"id": "x"}], "regions": []}))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0),
        lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(tmp_path), **k))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(service, "STATIC_DATA", tmp_path / "нет-такого-каталога")
    monkeypatch.setattr(service, "STATIC_URL", f"http://127.0.0.1:{srv.server_address[1]}")
    service._static_cache.clear()
    assert service.static_json("catalog.json")["datasets"][0]["id"] == "x"
    srv.shutdown(); srv.server_close()
    service._static_cache["catalog.json"] = (0, service._static_cache["catalog.json"][1])   # кеш устарел
    assert service.static_json("catalog.json")["datasets"][0]["id"] == "x"   # web лёг — последнее известное
    assert service.static_json("iso_codes.json") is None                        # и не было никогда — None, без падения
    service._static_cache.clear()


def test_health_is_fast_and_independent(client, monkeypatch):
    """liveness: health не ходит в рендерер и web — даже если они лежат."""
    from app import snapshot, service
    async def boom(*a, **k): raise AssertionError("health не должен звать рендерер")
    monkeypatch.setattr(snapshot, "render", boom)
    monkeypatch.setattr(service, "static_json", lambda n: (_ for _ in ()).throw(AssertionError("и web")))
    import time
    t0 = time.perf_counter()
    r = client.get("/api/v1/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert time.perf_counter() - t0 < 0.5


def test_prefetch_retries_until_web_up(monkeypatch, tmp_path):
    import asyncio
    from app import service
    calls = []
    def fake(name):
        calls.append(name)
        return {"ok": 1} if len(calls) > 4 else None     # web «поднимается» на 3-й попытке
    monkeypatch.setattr(service, "STATIC_URL", "http://geovis-web/data")
    monkeypatch.setattr(service, "STATIC_DATA", tmp_path)
    monkeypatch.setattr(service, "static_json", fake)
    asyncio.run(service.prefetch_static(retries=10, pause=0))
    assert len(calls) == 6    # 2 неудачные попытки × 2 файла + удачная × 2



def test_regions_dataset(client, user_key):
    body = {"title": "Продажи", "unit": "₽", "kind": "regions", "ttl_days": 1, "regions": [
        {"code": "RU-MOW", "value": 10, "year": 2023}, {"code": "ru-mow", "value": 12, "year": 2024},
        {"code": "KZ-ALA", "value": 3, "year": 2024}]}
    r = client.post("/api/v1/datasets", json=body, headers=user_key)
    assert r.status_code == 201, r.text
    assert r.json()["stats"]["regions"] == 2 and r.json()["stats"]["years"] == [2023, 2024]
    v = client.get(f"/api/v1/datasets/{r.json()['id']}/files/regions.json").json()
    assert v["values"][0] == {"code": "RU-MOW", "value": 12, "year": 2024}
    assert v["series"]["2023"] == [{"code": "RU-MOW", "value": 10}]
    # негатив: неизвестный код, кривой формат, повтор пары, лишнее поле данных
    bad = client.post("/api/v1/datasets", json={**body, "regions": [{"code": "RU-XXX", "value": 1}]}, headers=user_key)
    assert bad.status_code == 422 and "RU-XXX" in bad.text
    for b in ({**body, "regions": [{"code": "Москва", "value": 1}]},
              {**body, "regions": [{"code": "RU-MOW", "value": 1, "year": 2024}, {"code": "RU-MOW", "value": 2, "year": 2024}]},
              {**body, "countries": [{"iso3": "RUS", "value": 1}]}):
        assert client.post("/api/v1/datasets", json=b, headers=user_key).status_code == 422, b
