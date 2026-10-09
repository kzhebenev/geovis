# Deployment

**[Русская версия](../ru/SELF_HOSTING.md)**

## Requirements

- A Linux server, Docker with Compose v2. At least 4 vCPU and 8 GB of RAM: snapshots and video are rendered without a GPU.
- For the build: Python 3.11+ with [uv](https://docs.astral.sh/uv/), Node.js 22, 20–30 GB of disk while the data is being built.

## Steps

```bash
# 1. data (see DATA.md; restrictively licensed datasets — only with permission)
cd pipeline && uv sync && uv run python prepare.py && cd ..

# 2. website
cd web && npm ci && npm run build && cd ..
cp VERSION api/app/VERSION            # version for /api/v1/health

# 3. configuration
cp .env.example .env
#   GEOVIS_ADMIN_KEY   — API administrator key: openssl rand -hex 24
#   GEOVIS_PUBLIC_URL  — public address of the site (for links, iframes, previews, MCP)
#   GEOVIS_BIND / GEOVIS_PORT — where nginx listens (default 127.0.0.1:8105)

# 4. start and check
docker compose up -d --build
./smoke_test.sh                        # PUB=https://your-address ./smoke_test.sh — also check the public address
```

Compose services:
- `geovis` — nginx: static files and `/data`, proxies `/api/` and `/mcp`;
- `api` — FastAPI + MCP, volume `./api-data`;
- `renderer` — Chromium + ffmpeg, volume `./render-cache`.

All services have CPU and memory limits, a healthcheck and `restart: unless-stopped`.

## Exposing it publicly

nginx listens only on `GEOVIS_BIND:GEOVIS_PORT`. Expose it through a reverse proxy with TLS. Example for Caddy:

```
geovis.example.org {
    reverse_proxy 127.0.0.1:8105
}
```

The internal nginx passes `X-Forwarded-*`; the API builds links from `GEOVIS_PUBLIC_URL`.

## API keys

```bash
# issue a key to a project (the key is shown once)
curl -s -X POST "$GEOVIS_PUBLIC_URL/api/v1/keys" -H "X-API-Key: $GEOVIS_ADMIN_KEY" \
     -H 'Content-Type: application/json' -d '{"name": "my-project"}'
```

Viewing datasets by link requires no key. Writing, deleting and MCP require a key. The dataset limit per key is
`GEOVIS_MAX_DATASETS_PER_KEY` (default 500).

## Environment variables

| Service | Variable | Default | |
|---|---|---|---|
| api | `GEOVIS_ADMIN_KEY` | — | administrator key (required to issue keys) |
| api | `GEOVIS_PUBLIC_URL` | `http://localhost:8105` | address used in links, iframes, previews |
| api | `GEOVIS_DATA_DIR` | `/data` | storage for user datasets and keys |
| api | `GEOVIS_STATIC_DATA` | `/static-data` | built-in data from a shared volume (otherwise over HTTP) |
| api | `GEOVIS_WEB_URL` / `GEOVIS_STATIC_URL` | — | where to get the built-in catalog when there is no shared volume (k8s) |
| api | `GEOVIS_RENDERER_URL` | `http://renderer:8200` | snapshot and video service |
| api | `GEOVIS_MAX_DATASETS_PER_KEY` | `500` | dataset limit per key |
| geovis | `GEOVIS_API_UPSTREAM` | `http://api:8000` | API address for the nginx proxy |
| renderer | `GEOVIS_TARGET` | `http://geovis` | where to open the site from |
| renderer | `MAX_PARALLEL`, `MAX_QUEUE` | `2`, `3` | parallel renders, video queue |
| renderer | `TTL_BUILTIN_H`, `TTL_DATASET_H`, `VIDEO_TTL_D` | 24 h, 720 h, 7 days | snapshot cache lifetimes and video retention |

## Kubernetes

Images are built from the same Dockerfiles: the root (`geovis`), `api/`, `renderer/`. Without a shared volume, api
fetches the built-in catalog over HTTP from web: set `GEOVIS_WEB_URL=http://<web service>`. For nginx — `GEOVIS_API_UPSTREAM`.

## Updates and backups

- Updating: `git pull`, rebuild the data and the site if needed, then `docker compose up -d --build` and
  `./smoke_test.sh`.
- Backups: `./api-data` (user datasets and the SQLite database with keys) and `.env`. Built-in data is rebuilt by the
  pipeline; the snapshot cache does not need to be restored.
