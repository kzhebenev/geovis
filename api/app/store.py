"""Хранилище GeoVis API: SQLite (ключи, реестр наборов) + файлы наборов на диске."""
from __future__ import annotations

import hashlib
import json
import secrets
import shutil
import sqlite3
import threading
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY, key_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL,
  created REAL NOT NULL, bytes INTEGER NOT NULL
);
"""


def key_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class Store:
    def __init__(self, root: Path):
        self.root = root
        self.files = root / "custom"
        self.files.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.db = sqlite3.connect(root / "geovis.db", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        cols = {r[1] for r in self.db.execute("PRAGMA table_info(datasets)")}
        if "expires" not in cols:  # миграция: срок жизни наборов
            self.db.execute("ALTER TABLE datasets ADD COLUMN expires REAL")
            self.db.commit()

    # --- ключи ---
    def ensure_admin(self, raw: str | None) -> None:
        if not raw:
            return
        with self._lock:
            self.db.execute("INSERT OR IGNORE INTO keys(id,name,hash,is_admin,created) VALUES(?,?,?,1,?)",
                            ("admin", "admin", key_hash(raw), time.time()))
            self.db.commit()

    def create_key(self, name: str) -> tuple[str, str]:
        raw = "gv_" + secrets.token_urlsafe(24)
        kid = secrets.token_hex(6)
        with self._lock:
            self.db.execute("INSERT INTO keys(id,name,hash,created) VALUES(?,?,?,?)", (kid, name, key_hash(raw), time.time()))
            self.db.commit()
        return kid, raw

    def resolve_key(self, raw: str | None) -> sqlite3.Row | None:
        if not raw:
            return None
        return self.db.execute("SELECT * FROM keys WHERE hash=? AND active=1", (key_hash(raw),)).fetchone()

    # --- наборы ---
    def new_id(self) -> str:
        return secrets.token_urlsafe(9).replace("-", "x").replace("_", "y")

    def save(self, ds_id: str, key_id: str, meta: dict, files: dict[str, bytes], expires: float | None = None) -> int:
        d = self.files / ds_id
        d.mkdir(parents=True)
        size = 0
        for name, data in files.items():
            (d / name).write_bytes(data)
            size += len(data)
        meta = {**meta, "files": sorted(files)}
        (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
        with self._lock:
            self.db.execute("INSERT INTO datasets(id,key_id,title,kind,created,bytes,expires) VALUES(?,?,?,?,?,?,?)",
                            (ds_id, key_id, meta["title"], meta["kind"], meta["created"], size, expires))
            self.db.commit()
        return size

    def meta(self, ds_id: str) -> dict | None:
        p = self.files / ds_id / "meta.json"
        if not ds_id.isalnum() or not p.exists():
            return None
        m = json.loads(p.read_text())
        if m.get("expires") and m["expires"] < time.time():   # просрочен — не отдаём, даже если ещё не вычищен
            return None
        return m

    def file(self, ds_id: str, name: str) -> Path | None:
        meta = self.meta(ds_id)
        if not meta or name not in meta["files"]:
            return None
        return self.files / ds_id / name

    def list(self, key_id: str | None) -> list[dict]:
        now = time.time()
        q = "SELECT id,title,kind,created,bytes,expires FROM datasets WHERE (expires IS NULL OR expires > ?)" \
            + ("" if key_id is None else " AND key_id=?")
        rows = self.db.execute(q + " ORDER BY created DESC", (now,) if key_id is None else (now, key_id)).fetchall()
        return [dict(r) for r in rows]

    def count(self, key_id: str) -> int:
        return self.db.execute("SELECT COUNT(*) FROM datasets WHERE key_id=?", (key_id,)).fetchone()[0]

    def owner(self, ds_id: str) -> str | None:
        r = self.db.execute("SELECT key_id FROM datasets WHERE id=?", (ds_id,)).fetchone()
        return r[0] if r else None

    def delete(self, ds_id: str) -> None:
        with self._lock:
            self.db.execute("DELETE FROM datasets WHERE id=?", (ds_id,))
            self.db.commit()
        shutil.rmtree(self.files / ds_id, ignore_errors=True)

    def ids_for_purge(self, key_id: str | None, older_than: float | None) -> list[str]:
        """Наборы ключа (или все — для администратора), созданные раньше older_than (None — все)."""
        q, args = "SELECT id FROM datasets WHERE 1=1", []
        if key_id is not None:
            q += " AND key_id=?"; args.append(key_id)
        if older_than is not None:
            q += " AND created < ?"; args.append(older_than)
        return [r[0] for r in self.db.execute(q, args)]

    def purge_expired(self) -> int:
        ids = [r[0] for r in self.db.execute("SELECT id FROM datasets WHERE expires IS NOT NULL AND expires < ?",
                                             (time.time(),))]
        for i in ids:
            self.delete(i)
        return len(ids)
