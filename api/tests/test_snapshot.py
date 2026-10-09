"""PNG-снимки: проверка параметров и маршрутизации к рендереру (рендерер подменён заглушкой)."""
import pytest

from app import snapshot

PNG = b"\x89PNG\r\n\x1a\nFAKE"
calls = []


@pytest.fixture(autouse=True)
def fake_renderer(monkeypatch):
    calls.clear()

    async def fake(params, w, h):
        calls.append((params, w, h))
        return 200, PNG, {"X-Cache": "miss"}
    monkeypatch.setattr(snapshot, "render", fake)


def test_builtin_snapshot(client):
    r = client.get("/api/v1/snapshot.png?dataset=pop2025&focus=KAZ&mode=surface&cam=67,44,3.5,55,0&w=800&h=450")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == PNG
    assert calls[-1] == ({"dataset": "pop2025", "focus": "KAZ", "mode": "surface", "cam": "67,44,3.5,55,0"}, 800, 450)


def test_builtin_snapshot_requires_dataset_and_valid_params(client):
    assert client.get("/api/v1/snapshot.png?focus=RUS").status_code == 422
    assert client.get("/api/v1/snapshot.png?countries=wb_gdp&year=2015").status_code == 200
    assert calls[-1][0] == {"countries": "wb_gdp", "year": "2015"}
    calls.clear()
    for bad in ("mode=evil", "w=99999", "cam=0,99,3", "focus=../../x", "smooth=50", "hack=1", "res=0.3", "year=abc", "year=3000"):
        r = client.get(f"/api/v1/snapshot.png?dataset=pop2025&{bad}")
        assert r.status_code == 422, bad
    assert not calls   # до рендерера не дошло ни одного кривого запроса


def test_dataset_snapshot(client, user_key):
    ds = client.post("/api/v1/datasets", headers=user_key, json={
        "title": "снимок", "kind": "countries", "countries": [{"iso3": "RUS", "value": 1}]}).json()
    assert ds["snapshot_url"] == f"https://geovis.test/api/v1/datasets/{ds['id']}/snapshot.png"
    r = client.get(f"/api/v1/datasets/{ds['id']}/snapshot.png?legend=0")
    assert r.status_code == 200 and calls[-1][0] == {"ds": ds["id"], "legend": "0"}
    # свой набор нельзя подменить встроенным через параметры
    assert client.get(f"/api/v1/datasets/{ds['id']}/snapshot.png?dataset=pop2025").status_code == 422
    client.delete(f"/api/v1/datasets/{ds['id']}", headers=user_key)
    assert client.get(f"/api/v1/datasets/{ds['id']}/snapshot.png").status_code == 404   # удалён — и снимка нет


def test_renderer_errors_are_reported(client, monkeypatch):
    async def broken(params, w, h):
        return 500, b'{"detail": "timeout"}', {}
    monkeypatch.setattr(snapshot, "render", broken)
    r = client.get("/api/v1/snapshot.png?dataset=pop2025")
    assert r.status_code == 502 and "timeout" in r.json()["detail"]


def test_video_validation(client, monkeypatch):
    sent = []

    class FakeResp:
        status_code = 202
        def json(self): return {"id": "abc123", "state": "queued", "frame": 0, "frames": 0}

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def post(self, url, json): sent.append(json); return FakeResp()
    import app.main as m
    monkeypatch.setattr(m.httpx, "AsyncClient", FakeClient)
    sc = {"keyframes": [{"t": 0, "camera": {"longitude": 37, "latitude": 55, "zoom": 3}},
                        {"t": 5, "camera": {"longitude": 40, "latitude": 55, "zoom": 4, "pitch": 50}, "caption": {"ru": "x"}}]}
    r = client.post("/api/v1/videos", json={"scenario": sc, "fps": 24, "quality": "1080p"})
    assert r.status_code == 202 and r.json()["id"] == "abc123"
    assert sent[-1]["w"] == 1920 and sent[-1]["fps"] == 24 and len(sent[-1]["scenario"]["keyframes"]) == 2
    for q, wh in (("720p_v", (720, 1280)), ("1080p_v", (1080, 1920))):   # вертикальные 9:16
        client.post("/api/v1/videos", json={"scenario": sc, "quality": q})
        assert (sent[-1]["w"], sent[-1]["h"]) == wh
    bad = [
        {"scenario": {"keyframes": []}},                                                   # нет кадров
        {"scenario": sc, "fps": 60},                                                       # fps вне списка
        {"scenario": sc, "quality": "4k"},                                                 # качество
        {"scenario": {"keyframes": [{"t": 500, "camera": sc["keyframes"][0]["camera"]}]}},  # > 180 с
        {"scenario": {"keyframes": [{"t": 5, "camera": sc["keyframes"][0]["camera"]},
                                    {"t": 1, "camera": sc["keyframes"][0]["camera"]}]}},   # время назад
        {"scenario": {"keyframes": [{"t": 0, "camera": {"longitude": 0, "latitude": 99, "zoom": 3}}]}},  # широта
    ]
    n = len(sent)
    for b in bad:
        assert client.post("/api/v1/videos", json=b).status_code == 422, b
    assert len(sent) == n   # ни один кривой сценарий не ушёл в рендерер
    assert client.get("/api/v1/videos/..%2Fetc").status_code == 404


def test_video_file_route_not_shadowed(client, monkeypatch):
    """Дефект: /videos/{id} перехватывал /videos/{id}.mp4 → 404 при скачивании готового ролика."""
    import app.main as m
    hits = []

    class Resp:
        status_code = 200
        headers = {"content-length": "4"}
        async def aiter_bytes(self, n): yield b"MP4!"
        async def aclose(self): pass
        async def aread(self): return b""

    class C:
        def __init__(self, *a, **k): pass
        def build_request(self, method, url): hits.append(url); return url
        async def send(self, req, stream=False): return Resp()
        async def aclose(self): pass
    monkeypatch.setattr(m.httpx, "AsyncClient", C)
    r = client.get("/api/v1/videos/abc123.mp4")
    assert r.status_code == 200 and r.content == b"MP4!" and r.headers["content-type"] == "video/mp4"
    assert hits == ["http://renderer:8200/video/abc123.mp4"]


def test_preview_lenient(client, user_key):
    # лишние и кривые параметры отбрасываются, без набора — население мира, размер Open Graph
    r = client.get("/api/v1/preview.png?embed=1&scenario=x&play=1&mode=evil&focus=KAZ&dataset=pop2025")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert calls[-1] == ({"focus": "KAZ", "dataset": "pop2025"}, 1200, 630)
    client.get("/api/v1/preview.png")
    assert calls[-1][0] == {"dataset": "pop2025"}
    ds = client.post("/api/v1/datasets", headers=user_key, json={"title": "p", "kind": "countries",
                                                                 "countries": [{"iso3": "RUS", "value": 1}]}).json()["id"]
    client.get(f"/api/v1/preview.png?ds={ds}&embed=1")
    assert calls[-1][0] == {"ds": ds}
    client.get("/api/v1/preview.png?ds=NoSuch123")             # несуществующий ds — превью по умолчанию, не ошибка
    assert calls[-1][0] == {"dataset": "pop2025"}



def test_snapshot_compare_and_smooth_year(client):
    r = client.get("/api/v1/snapshot.png?dataset=pop2025&compare=pop1975&syear=2010.5")
    assert r.status_code == 200 and calls[-1][0] == {"dataset": "pop2025", "compare": "pop1975", "syear": "2010.5"}
    for bad in ("compare=../x", "syear=abc", "syear=3000"):
        assert client.get(f"/api/v1/snapshot.png?dataset=pop2025&{bad}").status_code == 422, bad
