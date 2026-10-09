#!/bin/bash
# smoke_test.sh — проверка GeoVis: внутренний адрес, публичный адрес, данные по существу, контейнер.
set -uo pipefail
PUB=${PUB:-http://localhost:8105}   # публичный адрес (PUB=https://… ./smoke_test.sh)
INT=${INT:-http://127.0.0.1:8105}   # адрес на хосте сервиса
fail=0
ok()  { echo "OK   $*"; }
bad() { echo "FAIL $*"; fail=1; }

for base in "$INT" "$PUB"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$base/") || code=000
  [ "$code" = 200 ] && ok "$base/ → 200" || bad "$base/ → $code"
done

# главная должна быть text/html (иначе браузер скачает её как файл)
ct=$(curl -s -m 10 -o /dev/null -w '%{content_type}' "$PUB/")
case "$ct" in text/html*) ok "главная: $ct" ;; *) bad "главная: content-type $ct" ;; esac
ct=$(curl -s -m 10 -o /dev/null -w '%{content_type}' "$PUB/data/countries.json")
case "$ct" in application/json*) ok "countries.json: $ct" ;; *) bad "countries.json: content-type $ct" ;; esac

# данные по существу: население мира ≈ 8,2 млрд, Москва в подписях
tot=$(curl -s -m 10 "$PUB/data/pop2025/g_0p25.json" | python3 -c 'import sys,json; print(int(json.load(sys.stdin)["total_population"]))' 2>/dev/null || echo 0)
[ "$tot" -gt 7900000000 ] && [ "$tot" -lt 8400000000 ] && ok "население мира в данных: $tot" || bad "население мира: $tot"
size=$(curl -s -m 30 -o /dev/null -w '%{size_download}' "$PUB/data/pop2025/g_0p25.bin")
[ "$size" = 4147200 ] && ok "сетка 0.25°: $size байт" || bad "сетка 0.25°: $size байт (ожидалось 4147200)"
# каталог: оба набора и регион России
cat=$(curl -s -m 10 "$PUB/data/catalog.json" | python3 -c '
import sys, json
c = json.load(sys.stdin)
ids = {d["id"] for d in c["datasets"]}
need = {f"pop{y}" for y in range(1975, 2031, 5)} | {"built2020", "lights2016", "relief", "temp", "precip", "gdp2024", "gdppc2024"}
miss = sorted(need - ids)
cd = sorted(x["id"] for x in c.get("country_datasets", []))
print("ok" if not miss and cd == ["wb_gdp", "wb_gdppc"] and c["regions"][0]["iso3"] == "RUS" else f"нет: {miss} {cd}")
' 2>/dev/null)
[ "$cat" = ok ] && ok "каталог: все 19 наборов, 2 по странам, регион RUS" || bad "каталог: «$cat»"
rus=$(curl -s -m 10 "$PUB/data/pop2025/RUS_0p1.json" | python3 -c 'import sys,json; print(int(json.load(sys.stdin)["total_population"]))' 2>/dev/null || echo 0)
[ "$rus" -gt 138000000 ] && [ "$rus" -lt 150000000 ] && ok "население России в данных: $rus" || bad "население России: $rus"
curl -s -m 10 "$PUB/data/cities.json" | grep -q '"ru":"Москва"' && ok "cities.json: Москва есть" || bad "cities.json: нет Москвы"

# негатив: несуществующие данные → 404, а не index.html
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$PUB/data/nope.bin")
[ "$code" = 404 ] && ok "несуществующие данные → 404" || bad "несуществующие данные → $code"

# сжатие сетки работает (иначе 25 МБ по сети)
enc=$(curl -s -m 30 -H 'Accept-Encoding: gzip' -o /dev/null -D - "$PUB/data/pop2025/g_0p1.bin" | grep -i '^content-encoding' | tr -d '\r')
[ -n "$enc" ] && ok "gzip для сеток: $enc" || bad "gzip для сеток не включён"

# --- API и MCP ---
h=$(curl -s -m 10 "$PUB/api/v1/health" | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])' 2>/dev/null)
[ "$h" = ok ] && ok "API health: ok" || bad "API health: «$h»"
v=$(curl -s -m 10 "$PUB/api/v1/contract" | python3 -c 'import sys,json; print(json.load(sys.stdin)["version"])' 2>/dev/null)
[ "$v" = 1.0 ] && ok "контракт v$v" || bad "контракт: «$v»"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST -H 'Content-Type: application/json' -d '{}' "$PUB/api/v1/datasets")
[ "$code" = 401 ] && ok "запись без ключа → 401" || bad "запись без ключа → $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$PUB/mcp")
[ "$code" = 401 ] && ok "MCP без ключа → 401" || bad "MCP без ключа → $code"
KEY=$(sed -n 's/^GEOVIS_ADMIN_KEY=//p' "$(dirname "$0")/.env" 2>/dev/null)
if [ -n "$KEY" ]; then
  out=$(curl -s -m 20 -X POST -H "X-API-Key: $KEY" -H 'Content-Type: application/json' "$PUB/api/v1/datasets" \
    -d '{"title":"smoke","kind":"points","res":1,"points":[{"lat":55.75,"lon":37.62,"value":5,"label":"М"},{"lat":55.7,"lon":37.5,"value":7}]}')
  id=$(echo "$out" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])' 2>/dev/null)
  tot=$(echo "$out" | python3 -c 'import sys,json; print(json.load(sys.stdin)["stats"]["total"])' 2>/dev/null)
  [ -n "$id" ] && [ "$tot" = 12.0 ] && ok "API: набор $id создан, сумма $tot" || bad "API создание: $out"
  n=$(curl -s -m 10 "$PUB/api/v1/datasets/$id/files/grid.bin" | wc -c)
  [ "$n" -gt 0 ] && ok "API: сетка набора отдаётся ($n байт)" || bad "API: сетка набора пуста"
  mcp=$(curl -s -m 20 -X POST -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"geovis_get_dataset","arguments":{"dataset_id":"'"$id"'"}}}' "$PUB/mcp")
  echo "$mcp" | python3 -c 'import sys,json; r=json.load(sys.stdin)["result"]; t=json.loads(r["content"][0]["text"]); sys.exit(0 if not r["isError"] and t["title"]=="smoke" else 1)' \
    && ok "MCP: geovis_get_dataset видит набор" || bad "MCP: $mcp"
  curl -s -o /dev/null -m 10 -X DELETE -H "X-API-Key: $KEY" "$PUB/api/v1/datasets/$id"
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$PUB/api/v1/datasets/$id")
  [ "$code" = 404 ] && ok "API: после удаления → 404" || bad "API: после удаления → $code"
else
  echo "SKIP API с ключом: нет .env рядом со smoke_test.sh"
fi

# --- PNG-снимок (рендерер): настоящая картинка нужного размера, кривой параметр → 422 ---
tmp=$(mktemp)
code=$(curl -s -m 180 -o "$tmp" -w '%{http_code}' "$PUB/api/v1/snapshot.png?dataset=pop2025&focus=KAZ&w=640&h=360")
dims=$(python3 - "$tmp" <<'EOF' 2>/dev/null
import struct, sys
d = open(sys.argv[1], "rb").read()
if d[:8] != b"\x89PNG\r\n\x1a\n":
    print("не PNG")
else:
    w, h = struct.unpack(">II", d[16:24])
    print("%dx%d %d" % (w, h, len(d)))
EOF
)
rm -f "$tmp"
case "$code $dims" in "200 640x360 "*) sz=${dims#* }; [ "$sz" -gt 20000 ] && ok "снимок PNG 640x360, $sz байт" || bad "снимок слишком мал: $sz байт" ;; *) bad "снимок: HTTP $code, $dims" ;; esac
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$PUB/api/v1/snapshot.png?dataset=pop2025&mode=evil")
[ "$code" = 422 ] && ok "снимок с кривым параметром → 422" || bad "снимок с кривым параметром → $code"

if command -v docker >/dev/null; then
  for c in geovis geovis-api geovis-renderer; do
    st=$(sudo docker inspect -f '{{.State.Health.Status}}' $c 2>/dev/null || echo none)
    [ "$st" = healthy ] && ok "контейнер $c: $st" || bad "контейнер $c: $st"
  done
fi

[ $fail = 0 ] && echo "SMOKE OK" || { echo "SMOKE FAIL"; exit 1; }
