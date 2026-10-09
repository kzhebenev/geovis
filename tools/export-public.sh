#!/bin/bash
# export-public.sh — чистый публичный снимок репозитория для GitHub (одна история-коммит, без ops/).
#   tools/export-public.sh <каталог-назначения>
# Берёт ЗАКОММИЧЕННОЕ дерево HEAD (не рабочие файлы), исключает внутреннее (ops/), создаёт новый git-репозиторий
# с одним коммитом и проверяет: секретов нет (gitleaks), внутренних адресов/имён нет, обязательные файлы на месте.
# Ничего никуда не отправляет — push делается вручную после просмотра.
set -euo pipefail
cd "$(dirname "$0")/.."
DST=${1:?укажите каталог назначения}
[ -e "$DST" ] && { echo "$DST уже существует — укажите новый каталог"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "есть незакоммиченные изменения — снимок берётся из HEAD, закоммитьте их"; exit 1; }

EXCLUDE=(ops)                                   # внутренняя эксплуатация — не публикуется
mkdir -p "$DST"
git archive --format=tar HEAD -- . $(printf ":(exclude)%s " "${EXCLUDE[@]}") | tar -x -C "$DST"

fail=0
ok()  { echo "OK   $*"; }
bad() { echo "FAIL $*"; fail=1; }

for f in LICENSE README.md README.ru.md DATA_SOURCES.md DATA_SOURCES.ru.md .env.example; do
  [ -s "$DST/$f" ] && ok "есть $f" || bad "нет $f"
done
grep -q "Copyright (c) 2026 Konstantin Zhebenev" "$DST/LICENSE" && ok "LICENSE: MIT © Konstantin Zhebenev" || bad "LICENSE"
[ ! -e "$DST/ops" ] && ok "ops/ исключён" || bad "ops/ попал в снимок"

# внутренняя инфраструктура: адреса, домены, пути, имена сервисов (lock-файлы npm не проверяем — там только registry.npmjs.org)
PAT='192\.168\.|153\.76\.|176\.98\.|devkz|sreda|i4b|kz-infra|kz-apps|/aps/|workbench|APS Vault|vault\.devkz|geovis_admin_api_key|тенант'
if hits=$(grep -rnIE "$PAT" "$DST" --exclude=package-lock.json --exclude=export-public.sh); then
  bad "внутренние упоминания:"; echo "$hits" | head -20
else ok "внутренних адресов и имён нет"; fi

# новый репозиторий с одним коммитом
NAME=${GIT_AUTHOR_NAME:-Konstantin Zhebenev}
EMAIL=${GIT_AUTHOR_EMAIL:-$(git config user.email)}
VER=$(cat VERSION)
( cd "$DST" && git init -q -b main && git add -A \
  && git -c user.name="$NAME" -c user.email="$EMAIL" commit -q -m "GeoVis $VER" ) && ok "репозиторий: 1 коммит, автор $NAME <$EMAIL>"

# секреты — gitleaks (по всему снимку и его истории)
if command -v docker >/dev/null || command -v gitleaks >/dev/null; then
  if command -v gitleaks >/dev/null; then out=$(gitleaks git "$DST" --no-banner --redact 2>&1) && r=0 || r=$?
  else out=$(sudo docker run --rm -v "$(realpath "$DST")":/repo:ro zricethezav/gitleaks:latest git /repo --no-banner --redact 2>&1) && r=0 || r=$?; fi
  if [ $r = 0 ]; then ok "gitleaks: секретов нет"
  else
    # единственное допустимое срабатывание — фиктивный ключ локального теста (в ops/, сюда не попадает)
    bad "gitleaks нашёл:"; echo "$out" | grep -E "RuleID|File|Line" | head -20
  fi
else bad "нет ни gitleaks, ни docker — секреты не проверены"; fi

du -sh "$DST" | awk '{print "размер снимка: " $1}'
(cd "$DST" && git ls-files | wc -l | awk '{print "файлов: " $1}')
[ $fail = 0 ] && echo "ГОТОВО: $DST — проверьте и сделайте push вручную" || { echo "ЕСТЬ ПРОБЛЕМЫ — не публиковать"; exit 1; }
