"""Скачивание исходников набора по URL из каталога (если файла ещё нет)."""
from __future__ import annotations

import shutil
import urllib.request
import zipfile
from pathlib import Path


def ensure_source(raw: Path, ds: dict, log=print, cafile: str | None = None) -> Path:
    """Возвращает путь к файлу набора; при отсутствии скачивает (и распаковывает zip)."""
    target = raw / ds["file"]
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    url = ds["url"]
    is_zip = url.split("?")[0].endswith(".zip")
    shared = "extract" in ds        # общий большой архив нескольких наборов — кешируем, не удаляем
    # имя временного файла — из URL: параллельные загрузки в один каталог не затирают друг друга
    base = url.split("?")[0].rstrip("/").rsplit("/", 1)[-1] or "download"
    tmp = target.parent / (base if shared else (f"_{base}" if is_zip else target.name + ".part"))
    if shared and tmp.exists():
        log(f"  архив уже есть: {tmp.name}")
    else:
        _fetch(url, tmp, cafile, log)
    if is_zip:
        _unzip(tmp, target, ds.get("extract"), keep=shared)
    else:
        tmp.rename(target)
    return target


def _fetch(url: str, tmp: Path, cafile: str | None, log) -> None:
    log(f"  скачиваю {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "geovis-pipeline/1.0"})
    import ssl
    ctx = ssl.create_default_context(cafile=cafile) if cafile else None
    part = tmp.with_name(tmp.name + ".part")
    with urllib.request.urlopen(req, timeout=120, context=ctx) as r, open(part, "wb") as f:
        shutil.copyfileobj(r, f, length=1 << 20)
    part.rename(tmp)


def _unzip(tmp: Path, target: Path, wanted: list[str] | None, keep: bool) -> None:
    """Распаковать архив рядом с target: целиком или только файлы, в имени которых есть подстроки wanted."""
    with zipfile.ZipFile(tmp) as z:
        for m in z.namelist():
            if not m.endswith("/") and (wanted is None or any(w in m for w in wanted)):
                z.extract(m, target.parent)
    if not keep:
        tmp.unlink()
    if not target.exists():
        # файл лежал в подкаталоге архива — поднимаем к ожидаемому месту
        found = [p for p in target.parent.rglob(target.name) if p != target]
        if not found:
            raise FileNotFoundError(f"в архиве {tmp.name} нет {target.name}")
        found[0].rename(target)


def source_paths(raw: Path, ds: dict) -> list[Path]:
    """Файлы на диске, которые скачал/распаковал набор: сам файл, его спутники (.ovr, .aux.xml, .tfw) и общий архив."""
    parts = [{**ds, **m} for m in ds["ensemble"]] if "ensemble" in ds else [ds]
    out: list[Path] = []
    for p in parts:
        target = raw / p["file"]
        out += [f for f in target.parent.glob(target.name + "*")] + list(target.parent.glob(target.stem + ".tfw"))
        if "extract" in p:
            out.append(target.parent / p["url"].split("?")[0].rstrip("/").rsplit("/", 1)[-1])
    return sorted(set(out))


def cleanup_sources(raw: Path, built: dict[str, dict], min_bytes: int = 100 << 20, log=print) -> int:
    """Удалить крупные исходники собранных наборов (заново скачаются по каталогу). Мелкие оставляем. → байт освобождено."""
    freed = 0
    for ds in built.values():
        for f in source_paths(raw, ds):
            if f.is_file() and f.stat().st_size >= min_bytes:
                freed += f.stat().st_size
                f.unlink()
                log(f"  удалён исходник {f.relative_to(raw)}")
    return freed
