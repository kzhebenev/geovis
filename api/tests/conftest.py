import json
import os
import tempfile
from pathlib import Path

import pytest

_tmp = Path(tempfile.mkdtemp())
(_tmp / "static").mkdir()
(_tmp / "static" / "iso_codes.json").write_text(json.dumps({"RUS": "RUS", "CHN": "CHN", "DEU": "DEU", "KAZ": "KAZ", "SSD": "SDS", "XKX": "KOS"}))
(_tmp / "static" / "admin1_codes.json").write_text(json.dumps(["RU-MOW", "RU-SPE", "RU-MOS", "KZ-ALA"]))
(_tmp / "static" / "catalog.json").write_text(json.dumps({
    "datasets": [{"id": "pop2025", "group": "pop", "year": 2025, "title": {"ru": "Население 2025"}, "unit": {}, "source": "GHSL"}],
    "country_datasets": [{"id": "wb_gdp", "title": {"ru": "ВВП стран"}, "unit": {}, "source": "WB"}],
    "region_datasets": [{"id": "rosstat_vrp", "country": "RUS", "title": {"ru": "ВРП"}, "unit": {}, "source": "Росстат"}],
    "regions": [{"iso3": "RUS"}, {"iso3": "KAZ"}]}))
os.environ.update(GEOVIS_DATA_DIR=str(_tmp / "data"), GEOVIS_STATIC_DATA=str(_tmp / "static"),
                  GEOVIS_ADMIN_KEY="admin-test-key", GEOVIS_PUBLIC_URL="https://geovis.test")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

ADMIN = {"X-API-Key": "admin-test-key"}


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def user_key(client):
    r = client.post("/api/v1/keys", json={"name": "test-project"}, headers=ADMIN)
    assert r.status_code == 201
    return {"X-API-Key": r.json()["api_key"]}
