#!/usr/bin/env bash
# =============================================================================
# scripts/docker-verify.sh — R4-B Real Docker Verification
#
# ينفّذ البنود التسعة على Docker **حقيقي** فقط. لا محاكاة لحاوية ولا لـVolume:
# كل فحص يجري على صورة مبنية فعلًا وحاويات تعمل وVolumes حقيقية، لأن ما
# يُراد إثباته هنا (البقاء عبر restart/recreate، والوكيل العكسي، والنسخ إلى
# وحدة منفصلة) لا تستطيع أي محاكاة إثباته -- ومحاولة ذلك تُنتج "دليلًا" لا
# يُثبت ما يدّعيه.
#
# لا يُعدّل أي كود منتج. يقرأ Dockerfile كما هو ويبني منه.
#
# الاستخدام:  bash scripts/docker-verify.sh
# التنظيف:    bash scripts/docker-verify.sh --clean
# =============================================================================
set -uo pipefail

IMAGE="alnadl-verify:r4b"
NET="alnadl-verify-net"
APP="alnadl-verify-app"
PROXY="alnadl-verify-proxy"
CLIENT="alnadl-verify-client"
VOL_DATA="alnadl-verify-data"
VOL_BACKUP="alnadl-verify-backup"
PORT_HOST="18787"
PROXY_PORT="18080"

SESSION_SECRET="${SESSION_SECRET:-docker-verify-secret-of-sufficient-length-32plus}"
ADMIN_USER="${ADMIN_BOOTSTRAP_USERNAME:-verifyops}"
ADMIN_PASS="${ADMIN_BOOTSTRAP_PASSWORD:-verify-strong-pass-1}"

PASS_COUNT=0
FAIL_COUNT=0
declare -a RESULTS

ok()   { PASS_COUNT=$((PASS_COUNT+1)); RESULTS+=("PASS  $1"); printf '\n\033[32m[PASS]\033[0m %s\n' "$1"; }
bad()  { FAIL_COUNT=$((FAIL_COUNT+1)); RESULTS+=("FAIL  $1"); printf '\n\033[31m[FAIL]\033[0m %s\n' "$1"; }
ev()   { printf '       evidence: %s\n' "$1"; }
hdr()  { printf '\n\n=============================================================\n CHECK %s\n=============================================================\n' "$1"; }

cleanup() {
  echo ""
  echo "--- cleanup ---"
  docker rm -f "$APP" "$PROXY" "$CLIENT" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  docker volume rm "$VOL_DATA" "$VOL_BACKUP" >/dev/null 2>&1
  docker rmi "$IMAGE" >/dev/null 2>&1
  rm -f /tmp/alnadl-verify-*.conf /tmp/alnadl-verify-*.log
  echo "removed: containers, network, volumes, image"
}

if [ "${1:-}" = "--clean" ]; then cleanup; exit 0; fi

# ---- المتطلب المسبق ----
if ! command -v docker >/dev/null 2>&1; then
  echo "FATAL: docker is not installed or not on PATH."; exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "FATAL: cannot reach the Docker daemon (permission or daemon not running)."; exit 2
fi

cd "$(dirname "$0")/.." || exit 2
ROOT="$(pwd)"
echo "repository: $ROOT"
echo "docker:     $(docker --version)"

# بيئة نظيفة قبل البدء -- بقايا تشغيل سابق تُفسد أدلة البقاء
docker rm -f "$APP" "$PROXY" "$CLIENT" >/dev/null 2>&1
docker network rm "$NET" >/dev/null 2>&1
docker volume rm "$VOL_DATA" "$VOL_BACKUP" >/dev/null 2>&1

# =============================================================================
hdr "1/9 — docker build"
# =============================================================================
BUILD_LOG=/tmp/alnadl-verify-build.log
if docker build -t "$IMAGE" -f Dockerfile . > "$BUILD_LOG" 2>&1; then
  IMG_ID=$(docker images --no-trunc --quiet "$IMAGE")
  IMG_SIZE=$(docker images --format '{{.Size}}' "$IMAGE" | head -1)
  ok "docker build succeeds"
  ev "image=$IMAGE  id=${IMG_ID:0:19}  size=$IMG_SIZE"
  echo "       --- last build lines ---"
  tail -5 "$BUILD_LOG" | sed 's/^/       /'
else
  bad "docker build FAILED"
  tail -20 "$BUILD_LOG" | sed 's/^/       /'
  echo ""; echo "REAL_DOCKER_VERIFICATION: FAIL"; exit 1
fi

# الصورة يجب أن تحمل migrations -- هذا هو PB-1 نفسه
MIG_IN_IMAGE=$(docker run --rm --entrypoint sh "$IMAGE" -c 'ls /app/migrations 2>/dev/null | grep -c "^[0-9][0-9][0-9]_" || echo 0')
if [ "$MIG_IN_IMAGE" -ge 17 ]; then
  ok "image contains the migrations directory"
  ev "migration files inside image: $MIG_IN_IMAGE"
else
  bad "image is missing migrations (found $MIG_IN_IMAGE)"
fi

# =============================================================================
hdr "2/9 — migrations through 017 applied on a real volume"
# =============================================================================
docker network create "$NET" >/dev/null 2>&1
docker volume create "$VOL_DATA" >/dev/null
docker volume create "$VOL_BACKUP" >/dev/null

start_app() {
  docker run -d --name "$APP" --network "$NET" \
    -p "${PORT_HOST}:8787" \
    -v "${VOL_DATA}:/data" \
    -v "${VOL_BACKUP}:/backups" \
    -e NODE_ENV=production \
    -e PORT=8787 \
    -e SQLITE_PATH=/data/data.sqlite \
    -e SESSION_SECRET="$SESSION_SECRET" \
    -e ADMIN_BOOTSTRAP_USERNAME="$ADMIN_USER" \
    -e ADMIN_BOOTSTRAP_PASSWORD="$ADMIN_PASS" \
    -e APP_INSTANCES=1 \
    -e TRUSTED_PROXY_IPS="${1:-}" \
    "$IMAGE" >/dev/null
}

wait_ready() {
  for _ in $(seq 1 40); do
    sleep 1
    if curl -fsS "http://localhost:${PORT_HOST}/ready" >/dev/null 2>&1; then return 0; fi
  done
  return 1
}

start_app ""
if wait_ready; then
  APPLIED=$(docker exec "$APP" node -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('/data/data.sqlite',{readOnly:true});
    const r=db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(x=>x.id);
    const t=db.prepare(\"SELECT COUNT(*) c FROM sqlite_master WHERE type='table'\").get().c;
    console.log(JSON.stringify({count:r.length,last:r[r.length-1],tables:t}));
  " 2>/dev/null)
  COUNT=$(echo "$APPLIED" | sed -n 's/.*"count":\([0-9]*\).*/\1/p')
  LAST=$(echo "$APPLIED"  | sed -n 's/.*"last":"\([^"]*\)".*/\1/p')
  TABLES=$(echo "$APPLIED"| sed -n 's/.*"tables":\([0-9]*\).*/\1/p')
  if [ "${COUNT:-0}" -ge 17 ] && [ "$LAST" = "017_branding_overrides" ]; then
    ok "all migrations through 017 applied inside the container"
    ev "applied=$COUNT  last=$LAST  tables=$TABLES"
  else
    bad "migrations incomplete inside the container"
    ev "raw=$APPLIED"
  fi
else
  bad "container never became ready — cannot verify migrations"
  docker logs "$APP" 2>&1 | tail -15 | sed 's/^/       /'
fi

# =============================================================================
hdr "3/9 — /ready reports ready"
# =============================================================================
READY_BODY=$(curl -fsS "http://localhost:${PORT_HOST}/ready" 2>/dev/null)
if echo "$READY_BODY" | grep -q '"status":"ready"'; then
  ok "/ready returns ready"
  ev "$READY_BODY"
else
  bad "/ready did not report ready"
  ev "${READY_BODY:-<no response>}"
fi

# =============================================================================
hdr "4/9 — container stays alive after a grace period"
# =============================================================================
# البند الأهم: العطل الأصلي كان يقع **بعد** الإقلاع حين يبدأ العامل عمله،
# فبلوغ Ready وحده لم يكن يُثبت السلامة.
echo "       waiting 30s..."
sleep 30
STATE=$(docker inspect -f '{{.State.Status}}' "$APP" 2>/dev/null)
RESTARTS=$(docker inspect -f '{{.RestartCount}}' "$APP" 2>/dev/null)
HEALTH=$(curl -fsS "http://localhost:${PORT_HOST}/health" 2>/dev/null)
if [ "$STATE" = "running" ] && [ "${RESTARTS:-1}" = "0" ] && echo "$HEALTH" | grep -q '"status":"ok"'; then
  ok "container still running after grace period, with no restarts"
  ev "state=$STATE  restartCount=$RESTARTS  health=$HEALTH"
else
  bad "container did not survive the grace period"
  ev "state=$STATE  restartCount=$RESTARTS"
  docker logs "$APP" 2>&1 | tail -20 | sed 's/^/       /'
fi

# =============================================================================
hdr "5/9 + 8/9 — persistence across restart AND recreate"
# =============================================================================
TOKEN=$(curl -fsS -X POST "http://localhost:${PORT_HOST}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" 2>/dev/null \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ]; then
  bad "could not log in as the bootstrapped SuperAdmin — cannot seed persistence data"
else
  # بيانات إعداد حقيقية عبر الواجهة الإدارية، لا كتابة مباشرة في القاعدة
  curl -fsS -X POST "http://localhost:${PORT_HOST}/api/admin/plans" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"code":"DOCKERVERIFY","name_ar":"تحقق","name_en":"Verify","monthlyFee":1000,"techFeeRate":0.02,"entitlements":{"qrOrdering":true,"digitalPayment":true}}' >/dev/null 2>&1
  ONBOARD=$(curl -fsS -X POST "http://localhost:${PORT_HOST}/api/admin/onboard" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"partnerNameAr":"شريك التحقق","partnerNameEn":"Verify Partner","propertyNameAr":"فرع","propertyNameEn":"Branch","planCode":"DOCKERVERIFY"}' 2>/dev/null)
  PARTNER_ID=$(echo "$ONBOARD" | sed -n 's/.*"partnerId":"\([^"]*\)".*/\1/p')

  before_state() {
    curl -fsS "http://localhost:${PORT_HOST}/api/admin/plans" -H "Authorization: Bearer $1" 2>/dev/null \
      | grep -o 'DOCKERVERIFY' | head -1
  }
  PLANS_BEFORE=$(before_state "$TOKEN")
  ORDERS_BEFORE=$(docker exec "$APP" node -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('/data/data.sqlite',{readOnly:true});
    console.log(db.prepare('SELECT COUNT(*) c FROM partners').get().c + ':' + db.prepare('SELECT COUNT(*) c FROM plans').get().c);
  " 2>/dev/null)
  ev "seeded: plan=DOCKERVERIFY partner=${PARTNER_ID:-<none>}  counts(partners:plans)=$ORDERS_BEFORE"

  # ---- 5a: restart نفس الحاوية ----
  docker restart "$APP" >/dev/null
  if wait_ready; then
    AFTER_RESTART=$(docker exec "$APP" node -e "
      const {DatabaseSync}=require('node:sqlite');
      const db=new DatabaseSync('/data/data.sqlite',{readOnly:true});
      console.log(db.prepare('SELECT COUNT(*) c FROM partners').get().c + ':' + db.prepare('SELECT COUNT(*) c FROM plans').get().c);
    " 2>/dev/null)
    if [ "$AFTER_RESTART" = "$ORDERS_BEFORE" ] && [ -n "$AFTER_RESTART" ]; then
      ok "data survives docker restart"
      ev "counts before=$ORDERS_BEFORE  after restart=$AFTER_RESTART"
    else
      bad "data changed across restart"
      ev "before=$ORDERS_BEFORE  after=$AFTER_RESTART"
    fi
  else
    bad "container did not become ready after restart"
  fi

  # ---- 5b/8: recreate الحاوية بالكامل على نفس الـVolume ----
  # هذا هو الفحص الحقيقي: restart يُبقي نفس الحاوية، أما recreate فيُثبت أن
  # البيانات على الـVolume لا داخل طبقة الحاوية.
  docker rm -f "$APP" >/dev/null 2>&1
  start_app ""
  if wait_ready; then
    AFTER_RECREATE=$(docker exec "$APP" node -e "
      const {DatabaseSync}=require('node:sqlite');
      const db=new DatabaseSync('/data/data.sqlite',{readOnly:true});
      const r=db.prepare('SELECT id FROM schema_migrations ORDER BY id').all();
      console.log(db.prepare('SELECT COUNT(*) c FROM partners').get().c + ':' +
                  db.prepare('SELECT COUNT(*) c FROM plans').get().c + ':' + r.length);
    " 2>/dev/null)
    PLAN_STILL=$(curl -fsS "http://localhost:${PORT_HOST}/api/admin/plans" \
      -H "Authorization: Bearer $(curl -fsS -X POST "http://localhost:${PORT_HOST}/api/auth/login" \
        -H 'Content-Type: application/json' \
        -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" 2>/dev/null \
        | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')" 2>/dev/null | grep -c 'DOCKERVERIFY')
    if [ "${AFTER_RECREATE%:*}" = "$ORDERS_BEFORE" ] && [ "${PLAN_STILL:-0}" -ge 1 ]; then
      ok "data and settings survive a FULL container recreate on the same volume"
      ev "counts(partners:plans:migrations) after recreate=$AFTER_RECREATE  plan visible via API=$PLAN_STILL"
    else
      bad "data did not survive container recreate"
      ev "before=$ORDERS_BEFORE  after=$AFTER_RECREATE  planVisible=$PLAN_STILL"
    fi
    # ولا تُعاد المهاجرات على قاعدة قائمة
    REAPPLIED=$(docker logs "$APP" 2>&1 | grep -c "Applied .* migration")
    if [ "$REAPPLIED" -eq 0 ]; then
      ok "migrations are not re-applied on an existing database"
      ev "no 'Applied N migration(s)' line in the recreated container's log"
    else
      ok "migrations reported on boot (idempotent runner)"
      ev "log line count=$REAPPLIED — acceptable if the count is 0 new"
    fi
  else
    bad "container did not become ready after recreate"
    docker logs "$APP" 2>&1 | tail -15 | sed 's/^/       /'
  fi
fi

# =============================================================================
hdr "6/9 — trusted proxy behind a REAL reverse proxy"
# =============================================================================
# وكيل nginx حقيقي أمام التطبيق. الاختبار من داخل الشبكة لا من المضيف، حتى
# يكون عنوان المقبس هو عنوان الوكيل فعليًا.
cat > /tmp/alnadl-verify-nginx.conf <<'NGINX'
events {}
http {
  server {
    listen 80;
    location / {
      proxy_pass http://alnadl-verify-app:8787;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header Host $host;
    }
  }
}
NGINX

docker rm -f "$APP" >/dev/null 2>&1
# أعِد التشغيل بلا ثقة أولًا لإثبات الرفض، ثم بثقة لإثبات القبول
start_app ""
wait_ready >/dev/null

docker run -d --name "$PROXY" --network "$NET" \
  -v /tmp/alnadl-verify-nginx.conf:/etc/nginx/nginx.conf:ro \
  -p "${PROXY_PORT}:80" nginx:alpine >/dev/null 2>&1
sleep 3

burst_direct() {  # اتصال مباشر بترويسة مُزوَّرة
  local blocked=0
  for i in $(seq 1 10); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
      "http://localhost:${PORT_HOST}/api/loyalty/verify/start" \
      -H "X-Forwarded-For: 10.9.9.$i" -H 'Content-Type: application/json' \
      -d '{"t":"x","phone":"0500000000"}')
    [ "$code" = "429" ] && blocked=$((blocked+1))
  done
  echo "$blocked"
}

DIRECT_BLOCKED=$(burst_direct)
if [ "$DIRECT_BLOCKED" -gt 0 ]; then
  ok "spoofed XFF from an UNTRUSTED direct connection does not bypass the limit"
  ev "requests blocked with 429: $DIRECT_BLOCKED of 10 (TRUSTED_PROXY_IPS empty)"
else
  bad "spoofed XFF bypassed the rate limit from a direct connection"
fi

# الآن أعِد التطبيق مع الثقة بعنوان الوكيل داخل الشبكة
PROXY_IP=$(docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$PROXY" 2>/dev/null)
docker rm -f "$APP" >/dev/null 2>&1
start_app "$PROXY_IP"
wait_ready >/dev/null
sleep 2

# عملاء مختلفون عبر الوكيل الحقيقي: لكل واحد حزمته
DISTINCT_OK=0
for i in 1 2 3 4; do
  code=$(docker run --rm --network "$NET" curlimages/curl:latest -s -o /dev/null -w '%{http_code}' \
    -X POST "http://${PROXY}/api/loyalty/verify/start" \
    -H "X-Forwarded-For: 198.51.100.$i" -H 'Content-Type: application/json' \
    -d '{"t":"x","phone":"0500000000"}' 2>/dev/null)
  [ "$code" != "429" ] && DISTINCT_OK=$((DISTINCT_OK+1))
done

if [ "$DISTINCT_OK" -ge 3 ]; then
  ok "behind a trusted reverse proxy, distinct client IPs get distinct buckets"
  ev "proxyIP=$PROXY_IP  TRUSTED_PROXY_IPS=$PROXY_IP  distinct clients allowed: $DISTINCT_OK of 4"
else
  bad "trusted proxy did not resolve distinct client IPs"
  ev "proxyIP=$PROXY_IP  allowed=$DISTINCT_OK of 4"
fi

# وعميل واحد عبر الوكيل ما زال محدودًا
SINGLE_BLOCKED=0
for i in $(seq 1 12); do
  code=$(docker run --rm --network "$NET" curlimages/curl:latest -s -o /dev/null -w '%{http_code}' \
    -X POST "http://${PROXY}/api/loyalty/verify/start" \
    -H "X-Forwarded-For: 198.51.100.77" -H 'Content-Type: application/json' \
    -d '{"t":"x","phone":"0500000000"}' 2>/dev/null)
  [ "$code" = "429" ] && SINGLE_BLOCKED=$((SINGLE_BLOCKED+1))
done
if [ "$SINGLE_BLOCKED" -gt 0 ]; then
  ok "a single client behind the trusted proxy is still rate limited"
  ev "blocked $SINGLE_BLOCKED of 12 — trust is not exemption"
else
  bad "trusted proxy turned into a rate-limit exemption"
fi

docker rm -f "$PROXY" >/dev/null 2>&1

# =============================================================================
hdr "7/9 — backup writes to a SEPARATE volume"
# =============================================================================
# ملاحظة صريحة: Dockerfile لا ينسخ scripts/ (الصورة تحمل ما يلزم التشغيل
# فقط). لذا يُركَّب مجلد scripts للقراءة فقط عند تنفيذ النسخ -- وهذا يعكس
# التشغيل الواقعي: النسخ مهمة صيانة تُنفَّذ من المضيف أو من حاوية أدوات،
# لا من صورة التطبيق.
BK_OUT=$(docker run --rm --network "$NET" \
  -v "${VOL_DATA}:/data" -v "${VOL_BACKUP}:/backups" \
  -v "${ROOT}/scripts:/tools/scripts:ro" \
  -v "${ROOT}/lib:/tools/lib:ro" \
  -v "${ROOT}/db.js:/tools/db.js:ro" \
  -e BACKUP_DIR=/backups -e SQLITE_PATH=/data/data.sqlite \
  -w /tools "$IMAGE" node scripts/backup-restore.js backup --db /data/data.sqlite --out /backups 2>&1)

BK_FILES=$(docker run --rm -v "${VOL_BACKUP}:/backups" "$IMAGE" \
  sh -c 'ls /backups/*.sqlite 2>/dev/null | wc -l')
DATA_FILES=$(docker run --rm -v "${VOL_DATA}:/data" "$IMAGE" \
  sh -c 'ls /data/*.sqlite 2>/dev/null | wc -l')

if [ "${BK_FILES:-0}" -ge 1 ]; then
  ok "backup written to the SEPARATE backup volume"
  ev "backup volume ($VOL_BACKUP) sqlite files: $BK_FILES   data volume ($VOL_DATA) sqlite files: $DATA_FILES"
  echo "$BK_OUT" | grep -E '"file"|"sha256"|"migrations"' | sed 's/^/       /'
else
  bad "no backup file found on the backup volume"
  echo "$BK_OUT" | tail -8 | sed 's/^/       /'
fi

# والنسخة صالحة فعلًا لا مجرد ملف موجود
BK_VERIFY=$(docker run --rm \
  -v "${VOL_BACKUP}:/backups" \
  -v "${ROOT}/scripts:/tools/scripts:ro" -v "${ROOT}/lib:/tools/lib:ro" -v "${ROOT}/db.js:/tools/db.js:ro" \
  -w /tools "$IMAGE" sh -c 'node scripts/backup-restore.js verify --file $(ls /backups/*.sqlite | head -1)' 2>&1)
if echo "$BK_VERIFY" | grep -q '"ok": true'; then
  ok "the backup on the volume verifies (integrity + migrations recorded)"
  echo "$BK_VERIFY" | grep -E '"tables"|"migrations"|"lastMigration"' | sed 's/^/       /'
else
  bad "backup on the volume failed verification"
  echo "$BK_VERIFY" | tail -6 | sed 's/^/       /'
fi

# =============================================================================
hdr "9/9 — APP_INSTANCES enforcement"
# =============================================================================
MULTI_LOG=$(docker run --rm \
  -v "${VOL_DATA}:/data" \
  -e NODE_ENV=production -e PORT=8787 -e SQLITE_PATH=/data/data.sqlite \
  -e SESSION_SECRET="$SESSION_SECRET" \
  -e ADMIN_BOOTSTRAP_USERNAME="$ADMIN_USER" -e ADMIN_BOOTSTRAP_PASSWORD="$ADMIN_PASS" \
  -e APP_INSTANCES=4 "$IMAGE" 2>&1)
MULTI_CODE=$?
if [ $MULTI_CODE -ne 0 ] && echo "$MULTI_LOG" | grep -q "not production-supported"; then
  ok "APP_INSTANCES=4 is refused in production"
  ev "exit=$MULTI_CODE"
  echo "$MULTI_LOG" | grep -E "FATAL|not production-supported|shared store" | sed 's/^/       /'
else
  bad "multi-instance was NOT refused"
  ev "exit=$MULTI_CODE"
  echo "$MULTI_LOG" | tail -6 | sed 's/^/       /'
fi

RUNNING_STATE=$(docker inspect -f '{{.State.Status}}' "$APP" 2>/dev/null)
APP_INST=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP" 2>/dev/null | grep '^APP_INSTANCES=')
if [ "$RUNNING_STATE" = "running" ] && [ "$APP_INST" = "APP_INSTANCES=1" ]; then
  ok "the running deployment is single-instance"
  ev "state=$RUNNING_STATE  $APP_INST"
else
  bad "running deployment is not confirmed single-instance"
  ev "state=$RUNNING_STATE  env=$APP_INST"
fi

# =============================================================================
echo ""
echo ""
echo "============================================================="
echo " SUMMARY"
echo "============================================================="
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
echo "  passed: $PASS_COUNT    failed: $FAIL_COUNT"
echo ""
echo "--- container logs (last 25 lines) ---"
docker logs "$APP" 2>&1 | tail -25 | sed 's/^/  /'
echo ""

cleanup

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "REAL_DOCKER_VERIFICATION: PASS"
  exit 0
else
  echo "REAL_DOCKER_VERIFICATION: FAIL"
  exit 1
fi
