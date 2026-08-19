#!/usr/bin/env bash
# =============================================================================
# scripts/docker-verify.sh — R4-B Real Docker Verification (v2)
#
# ينفّذ البنود التسعة على Docker **حقيقي** فقط. لا محاكاة لحاوية ولا لـVolume:
# ما يُراد إثباته هنا -- البقاء عبر restart/recreate، والوكيل العكسي الحقيقي،
# والنسخ إلى وحدة منفصلة -- لا تستطيع أي محاكاة إثباته، ومحاولة ذلك تُنتج
# "دليلًا" لا يُثبت ما يدّعيه.
#
# لا يُعدّل أي كود منتج. يقرأ Dockerfile كما هو ويبني منه.
#
# تصحيحات v2 (مراجعة قبل التسليم):
#   * البقاء يُختبَر بـ**طلب حقيقي** عبر الرحلة (إنشاء + دفع + انتقالات حتى
#     التسليم) ويُتحقَّق من order_id وحالته وروابطه وحركاته المالية -- لا
#     بعدّ جداول أو خطط، لأن ذلك لا يُثبت "لا تُفقد الطلبات"
#   * اختبار العميلين يستخدم **حاويتين دائمتين بعنوانين مثبتين** -- الحاويات
#     المتعاقبة قد تُعيد استخدام نفس العنوان، فلا يُثبت الفصل شيئًا
#   * وسوم الصور مثبَّتة لا :latest
#   * التنظيف عبر trap فيسري على النجاح والفشل والمقاطعة كما يصف README
#
# الاستخدام:  bash scripts/docker-verify.sh
# التنظيف:    bash scripts/docker-verify.sh --clean
# =============================================================================
set -uo pipefail

IMAGE="alnadl-verify:r4b"
NET="alnadl-verify-net"
APP="alnadl-verify-app"
PROXY="alnadl-verify-proxy"
CLIENT_A="alnadl-verify-client-a"
CLIENT_B="alnadl-verify-client-b"
VOL_DATA="alnadl-verify-data"
VOL_BACKUP="alnadl-verify-backup"
PORT_HOST="18787"

# إصدارات مثبَّتة -- :latest يجعل نتيجة التحقق تتغيّر بلا تغيير في الشيفرة
CURL_IMAGE="curlimages/curl:8.6.0"
NGINX_IMAGE="nginx:1.27-alpine"

# شبكة بعناوين ثابتة، فلا يُعاد استخدام عنوان بين العملاء
SUBNET="172.28.77.0/24"
IP_APP="172.28.77.10"
IP_PROXY="172.28.77.20"
IP_CLIENT_A="172.28.77.31"
IP_CLIENT_B="172.28.77.32"

SESSION_SECRET="${SESSION_SECRET:-docker-verify-secret-of-sufficient-length-32plus}"
ADMIN_USER="${ADMIN_BOOTSTRAP_USERNAME:-verifyops}"
ADMIN_PASS="${ADMIN_BOOTSTRAP_PASSWORD:-verify-strong-pass-1}"

PASS_COUNT=0
FAIL_COUNT=0
declare -a RESULTS

ok()  { PASS_COUNT=$((PASS_COUNT+1)); RESULTS+=("PASS  $1"); printf '\n\033[32m[PASS]\033[0m %s\n' "$1"; }
bad() { FAIL_COUNT=$((FAIL_COUNT+1)); RESULTS+=("FAIL  $1"); printf '\n\033[31m[FAIL]\033[0m %s\n' "$1"; }
ev()  { printf '       evidence: %s\n' "$1"; }
hdr() { printf '\n\n=============================================================\n CHECK %s\n=============================================================\n' "$1"; }

CLEANED=0
cleanup() {
  [ "$CLEANED" = "1" ] && return 0
  CLEANED=1
  echo ""
  echo "--- cleanup ---"
  docker rm -f "$APP" "$PROXY" "$CLIENT_A" "$CLIENT_B" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  docker volume rm "$VOL_DATA" "$VOL_BACKUP" >/dev/null 2>&1
  docker rmi "$IMAGE" >/dev/null 2>&1
  rm -f /tmp/alnadl-verify-*.conf /tmp/alnadl-verify-*.log
  echo "removed: containers, network, volumes, image, temp files"
}

if [ "${1:-}" = "--clean" ]; then
  if ! command -v docker >/dev/null 2>&1; then echo "docker not available"; exit 2; fi
  cleanup; exit 0
fi

# التنظيف مضمون على الخروج الطبيعي والفشل والمقاطعة معًا
trap cleanup EXIT INT TERM

if ! command -v docker >/dev/null 2>&1; then
  CLEANED=1; echo "FATAL: docker is not installed or not on PATH."; exit 2
fi
if ! docker info >/dev/null 2>&1; then
  CLEANED=1; echo "FATAL: cannot reach the Docker daemon (permission or daemon not running)."; exit 2
fi

cd "$(dirname "$0")/.." || { CLEANED=1; exit 2; }
ROOT="$(pwd)"
echo "repository: $ROOT"
echo "docker:     $(docker --version)"
echo "pinned:     $CURL_IMAGE  |  $NGINX_IMAGE"

docker rm -f "$APP" "$PROXY" "$CLIENT_A" "$CLIENT_B" >/dev/null 2>&1
docker network rm "$NET" >/dev/null 2>&1
docker volume rm "$VOL_DATA" "$VOL_BACKUP" >/dev/null 2>&1

# =============================================================================
hdr "1/9 - docker build"
# =============================================================================
BUILD_LOG=/tmp/alnadl-verify-build.log
if docker build --pull -t "$IMAGE" -f Dockerfile . > "$BUILD_LOG" 2>&1; then
  IMG_ID=$(docker images --no-trunc --quiet "$IMAGE")
  IMG_SIZE=$(docker images --format '{{.Size}}' "$IMAGE" | head -1)
  ok "docker build succeeds"
  ev "image=$IMAGE  id=${IMG_ID:0:19}  size=$IMG_SIZE"
  tail -5 "$BUILD_LOG" | sed 's/^/       /'
else
  bad "docker build FAILED"
  tail -20 "$BUILD_LOG" | sed 's/^/       /'
  echo ""; echo "REAL_DOCKER_VERIFICATION: FAIL"; exit 1
fi

MIG_IN_IMAGE=$(docker run --rm --entrypoint sh "$IMAGE" -c 'ls /app/migrations 2>/dev/null | grep -c "^[0-9][0-9][0-9]_" || echo 0')
if [ "${MIG_IN_IMAGE:-0}" -ge 17 ]; then
  ok "image contains the migrations directory"
  ev "migration files inside image: $MIG_IN_IMAGE"
else
  bad "image is missing migrations (found ${MIG_IN_IMAGE:-0})"
fi

# =============================================================================
hdr "2/9 - migrations through 017 applied on a real volume"
# =============================================================================
docker network create --subnet "$SUBNET" "$NET" >/dev/null 2>&1
docker volume create "$VOL_DATA" >/dev/null
docker volume create "$VOL_BACKUP" >/dev/null

start_app() {
  docker run -d --name "$APP" --network "$NET" --ip "$IP_APP" \
    -p "${PORT_HOST}:8787" \
    -v "${VOL_DATA}:/data" -v "${VOL_BACKUP}:/backups" \
    -e NODE_ENV=production -e PORT=8787 -e SQLITE_PATH=/data/data.sqlite \
    -e SESSION_SECRET="$SESSION_SECRET" \
    -e ADMIN_BOOTSTRAP_USERNAME="$ADMIN_USER" \
    -e ADMIN_BOOTSTRAP_PASSWORD="$ADMIN_PASS" \
    -e APP_INSTANCES=1 -e TRUSTED_PROXY_IPS="${1:-}" \
    "$IMAGE" >/dev/null
}

wait_ready() {
  for _ in $(seq 1 40); do
    sleep 1
    curl -fsS "http://localhost:${PORT_HOST}/ready" >/dev/null 2>&1 && return 0
  done
  return 1
}

db_query() { docker exec "$APP" node -e "
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync('/data/data.sqlite',{readOnly:true});
  $1
" 2>/dev/null; }

start_app ""
if wait_ready; then
  APPLIED=$(db_query "
    const r=db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(x=>x.id);
    const t=db.prepare(\"SELECT COUNT(*) c FROM sqlite_master WHERE type='table'\").get().c;
    console.log(JSON.stringify({count:r.length,last:r[r.length-1],tables:t}));")
  COUNT=$(echo "$APPLIED" | sed -n 's/.*"count":\([0-9]*\).*/\1/p')
  LAST=$(echo "$APPLIED"  | sed -n 's/.*"last":"\([^"]*\)".*/\1/p')
  TABLES=$(echo "$APPLIED"| sed -n 's/.*"tables":\([0-9]*\).*/\1/p')
  if [ "${COUNT:-0}" -ge 17 ] && [ "$LAST" = "017_branding_overrides" ]; then
    ok "all migrations through 017 applied inside the container"
    ev "applied=$COUNT  last=$LAST  tables=$TABLES"
  else
    bad "migrations incomplete inside the container"; ev "raw=$APPLIED"
  fi
else
  bad "container never became ready - cannot verify migrations"
  docker logs "$APP" 2>&1 | tail -15 | sed 's/^/       /'
fi

# =============================================================================
hdr "3/9 - /ready reports ready"
# =============================================================================
READY_BODY=$(curl -fsS "http://localhost:${PORT_HOST}/ready" 2>/dev/null)
if echo "$READY_BODY" | grep -q '"status":"ready"'; then
  ok "/ready returns ready"; ev "$READY_BODY"
else
  bad "/ready did not report ready"; ev "${READY_BODY:-<no response>}"
fi

# =============================================================================
hdr "4/9 - container stays alive after a grace period"
# =============================================================================
# العطل الأصلي كان يقع بعد الإقلاع حين يبدأ العامل عمله، فبلوغ Ready وحده
# لم يكن يُثبت السلامة.
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
hdr "5/9 + 8/9 - persistence of a REAL ORDER across restart and recreate"
# =============================================================================
api() { # method path [body] [token]
  local m="$1" p="$2" b="${3:-}" t="${4:-}"
  if [ -n "$b" ]; then
    curl -fsS -X "$m" "http://localhost:${PORT_HOST}${p}" \
      ${t:+-H "Authorization: Bearer $t"} -H 'Content-Type: application/json' -d "$b" 2>/dev/null
  else
    curl -fsS -X "$m" "http://localhost:${PORT_HOST}${p}" \
      ${t:+-H "Authorization: Bearer $t"} 2>/dev/null
  fi
}
jget() { sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" <<< "$1" | head -1; }

TOKEN=$(jget "$(api POST /api/auth/login "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}")" token)

if [ -z "$TOKEN" ]; then
  bad "could not log in as the bootstrapped SuperAdmin - cannot seed persistence data"
else
  # ---- مستأجر كامل عبر الواجهة الإدارية، لا كتابة مباشرة في القاعدة ----
  api POST /api/admin/plans '{"code":"DOCKERVERIFY","name_ar":"tahaqq","name_en":"Verify","monthlyFee":1000,"techFeeRate":0.02,"entitlements":{"qrOrdering":true,"digitalPayment":true}}' "$TOKEN" >/dev/null
  ONBOARD=$(api POST /api/admin/onboard '{"partnerNameAr":"sharik","partnerNameEn":"Verify Partner","propertyNameAr":"far3","propertyNameEn":"Branch","planCode":"DOCKERVERIFY"}' "$TOKEN")
  PARTNER_ID=$(jget "$ONBOARD" partnerId)
  PROPERTY_ID=$(jget "$ONBOARD" propertyId)
  api POST "/api/admin/partners/${PARTNER_ID}/status" '{"status":"Active","reason":"docker verification run"}' "$TOKEN" >/dev/null

  ZONE_ID=$(jget "$(api POST /api/admin/zones "{\"propertyId\":\"${PROPERTY_ID}\",\"name_ar\":\"qa3a\",\"name_en\":\"Hall\",\"type\":\"Business\"}" "$TOKEN")" id)
  POINT=$(api POST /api/admin/points "{\"zoneId\":\"${ZONE_ID}\",\"label\":\"DV-1\",\"type\":\"Table\"}" "$TOKEN")
  POINT_ID=$(jget "$POINT" id)
  CAT_ID=$(jget "$(api POST /api/admin/categories "{\"propertyId\":\"${PROPERTY_ID}\",\"name_ar\":\"mashrub\",\"name_en\":\"Drinks\"}" "$TOKEN")" id)
  PROD_ID=$(jget "$(api POST /api/admin/products "{\"categoryId\":\"${CAT_ID}\",\"name_ar\":\"qahwa\",\"name_en\":\"Coffee\",\"basePrice\":25}" "$TOKEN")" id)

  # ---- طلب حقيقي عبر الرحلة: إنشاء -> دفع -> انتقالات حتى التسليم ----
  ORDER=$(api POST /api/orders "{\"pointId\":\"${POINT_ID}\",\"customerPhone\":\"0500111222\",\"items\":[{\"productId\":\"${PROD_ID}\",\"qty\":2}]}")
  ORDER_ID=$(jget "$ORDER" id)
  PAY_REF=$(jget "$ORDER" paymentRef)
  api POST "/api/orders/${ORDER_ID}/pay" '{"method":"card"}' >/dev/null
  for ST in Accepted Preparing Ready "Out for Delivery" Delivered; do
    api POST "/api/orders/${ORDER_ID}/transition" "{\"to\":\"${ST}\"}" "$TOKEN" >/dev/null
  done

  # لقطة مرجعية: الطلب وحالته وكل روابطه وحركاته المالية والإعدادات
  snapshot() { db_query "
    const o=db.prepare('SELECT id,status,partner_id,property_id,zone_id,point_id,total FROM orders WHERE id=?').get('${ORDER_ID}');
    const items=db.prepare('SELECT COUNT(*) c FROM order_items WHERE order_id=?').get('${ORDER_ID}').c;
    const pay=db.prepare(\"SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM payments WHERE order_id=? AND status='Captured'\").get('${ORDER_ID}');
    const led=db.prepare('SELECT COUNT(*) c FROM revenue_ledger WHERE order_id=?').get('${ORDER_ID}').c;
    const plans=db.prepare(\"SELECT COUNT(*) c FROM plans WHERE code='DOCKERVERIFY'\").get().c;
    const partner=db.prepare('SELECT status FROM partners WHERE id=?').get('${PARTNER_ID}');
    console.log(JSON.stringify({order:o,items,payments:pay.c,paid:pay.s,ledger:led,plans,partnerStatus:partner&&partner.status}));"; }

  BEFORE=$(snapshot)
  if [ -z "$ORDER_ID" ] || ! echo "$BEFORE" | grep -q '"status":"Delivered"'; then
    bad "could not create a real delivered order to test persistence with"
    ev "orderId=${ORDER_ID:-<none>}  snapshot=$BEFORE"
  else
    ev "seeded order=$ORDER_ID  paymentRef=${PAY_REF:0:12}...  partner=$PARTNER_ID"
    ev "before: $BEFORE"

    # ---- 5: docker restart ----
    docker restart "$APP" >/dev/null
    if wait_ready; then
      AFTER_RESTART=$(snapshot)
      if [ "$AFTER_RESTART" = "$BEFORE" ]; then
        ok "the real order, its payment, ledger and partner settings survive docker restart"
        ev "identical snapshot: order id, status, partner/property/zone/point linkage, total, captured payment, ledger rows, plan, partner status"
        ev "after restart: $AFTER_RESTART"
      else
        bad "state changed across restart"
        ev "before=$BEFORE"; ev "after =$AFTER_RESTART"
      fi
    else
      bad "container did not become ready after restart"
    fi

    # ---- 8: recreate كامل على نفس الـVolume ----
    # restart يُبقي نفس الحاوية؛ recreate وحده يُثبت أن البيانات على الـVolume
    # لا داخل الطبقة القابلة للكتابة في الحاوية.
    docker rm -f "$APP" >/dev/null 2>&1
    start_app ""
    if wait_ready; then
      AFTER_RECREATE=$(snapshot)
      NEW_TOKEN=$(jget "$(api POST /api/auth/login "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}")" token)
      API_STATUS=$(jget "$(api GET "/api/orders/${ORDER_ID}")" status)
      PLAN_VISIBLE=$(api GET /api/admin/plans "" "$NEW_TOKEN" | grep -c 'DOCKERVERIFY')

      if [ "$AFTER_RECREATE" = "$BEFORE" ] && [ "$API_STATUS" = "Delivered" ] && [ "${PLAN_VISIBLE:-0}" -ge 1 ]; then
        ok "the same order_id, status and linkages survive a FULL container recreate"
        ev "order=$ORDER_ID still Delivered when read back through the API after recreate"
        ev "plan DOCKERVERIFY still visible via admin API: $PLAN_VISIBLE"
        ev "after recreate: $AFTER_RECREATE"
      else
        bad "state did not survive container recreate"
        ev "before=$BEFORE"
        ev "after =$AFTER_RECREATE"
        ev "apiStatus=${API_STATUS:-<none>}  planVisible=${PLAN_VISIBLE:-0}"
      fi

      REAPPLIED=$(docker logs "$APP" 2>&1 | grep -c "Applied .* migration")
      if [ "${REAPPLIED:-0}" -eq 0 ]; then
        ok "migrations are not re-applied on an existing database"
        ev "no 'Applied N migration(s)' line in the recreated container's log"
      else
        bad "migrations re-ran on an existing database"
        docker logs "$APP" 2>&1 | grep "Applied .* migration" | sed 's/^/       /'
      fi
    else
      bad "container did not become ready after recreate"
      docker logs "$APP" 2>&1 | tail -15 | sed 's/^/       /'
    fi
  fi
fi

# =============================================================================
hdr "6/9 - trusted proxy behind a REAL reverse proxy (two fixed clients)"
# =============================================================================
cat > /tmp/alnadl-verify-nginx.conf <<NGINX
events {}
http {
  server {
    listen 80;
    location / {
      proxy_pass http://${IP_APP}:8787;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header Host \$host;
    }
  }
}
NGINX

# ---- 6a: مُزوَّر من اتصال مباشر غير موثوق ----
docker rm -f "$APP" >/dev/null 2>&1
start_app ""            # بلا أي وكيل موثوق
wait_ready >/dev/null

DIRECT_BLOCKED=0
for i in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "http://localhost:${PORT_HOST}/api/loyalty/verify/start" \
    -H "X-Forwarded-For: 10.9.9.$i" -H 'Content-Type: application/json' \
    -d '{"t":"x","phone":"0500000000"}')
  [ "$code" = "429" ] && DIRECT_BLOCKED=$((DIRECT_BLOCKED+1))
done
if [ "$DIRECT_BLOCKED" -gt 0 ]; then
  ok "spoofed XFF from an UNTRUSTED direct connection cannot change identity"
  ev "429 responses: $DIRECT_BLOCKED of 10 with rotating fake IPs and TRUSTED_PROXY_IPS empty"
else
  bad "spoofed XFF bypassed the limit from a direct connection"
fi

# ---- 6b: عميلان ثابتان خلف وكيل موثوق ----
# حاويتان دائمتان بعنوانين مثبتين: الحاويات المتعاقبة قد تُعيد استخدام نفس
# العنوان، فلا يُثبت "لكل عميل حزمته" شيئًا. العنوان المثبت يجعل هوية كل
# عميل ثابتة طوال الاختبار.
docker rm -f "$APP" >/dev/null 2>&1
start_app "$IP_PROXY"
wait_ready >/dev/null

docker run -d --name "$PROXY" --network "$NET" --ip "$IP_PROXY" \
  -v /tmp/alnadl-verify-nginx.conf:/etc/nginx/nginx.conf:ro \
  "$NGINX_IMAGE" >/dev/null 2>&1
docker run -d --name "$CLIENT_A" --network "$NET" --ip "$IP_CLIENT_A" \
  --entrypoint sh "$CURL_IMAGE" -c 'sleep 900' >/dev/null 2>&1
docker run -d --name "$CLIENT_B" --network "$NET" --ip "$IP_CLIENT_B" \
  --entrypoint sh "$CURL_IMAGE" -c 'sleep 900' >/dev/null 2>&1
sleep 4

hit_via_proxy() { # container
  docker exec "$1" curl -s -o /dev/null -w '%{http_code}' -X POST \
    "http://${IP_PROXY}/api/loyalty/verify/start" \
    -H 'Content-Type: application/json' -d '{"t":"x","phone":"0500000000"}' 2>/dev/null
}

# (i) العميل A يستنفد حده
A_BLOCKED=0; A_ALLOWED=0
for _ in $(seq 1 12); do
  c=$(hit_via_proxy "$CLIENT_A")
  if [ "$c" = "429" ]; then A_BLOCKED=$((A_BLOCKED+1)); else A_ALLOWED=$((A_ALLOWED+1)); fi
done

# (ii) العميل B عبر نفس الوكيل الموثوق -- حزمة مستقلة
B_FIRST=$(hit_via_proxy "$CLIENT_B")

# (iii) العميل A ما زال محجوبًا بعد نجاح B
A_STILL=$(hit_via_proxy "$CLIENT_A")

if [ "$A_BLOCKED" -gt 0 ] && [ "$B_FIRST" != "429" ] && [ "$A_STILL" = "429" ]; then
  ok "each client behind the trusted proxy genuinely gets its own bucket"
  ev "clientA(${IP_CLIENT_A}) fixed IP: allowed=$A_ALLOWED then blocked=$A_BLOCKED"
  ev "clientB(${IP_CLIENT_B}) fixed IP: first request=$B_FIRST while A was exhausted - independent bucket"
  ev "clientA re-checked after B succeeded: $A_STILL - B did not reset or share A's bucket"
else
  bad "per-client bucketing behind the trusted proxy is not proven"
  ev "A blocked=$A_BLOCKED allowed=$A_ALLOWED | B first=$B_FIRST | A after=$A_STILL"
  ev "proxyIP=$IP_PROXY  TRUSTED_PROXY_IPS=$IP_PROXY"
fi

# (iv) حشو XFF عبر الوكيل: nginx يُلحق العنوان الحقيقي أخيرًا والخادم يقرأ
#      آخر عنصر، فالحشو لا يُنتج هوية جديدة.
SPOOF_BLOCKED=0
for i in $(seq 1 8); do
  c=$(docker exec "$CLIENT_A" curl -s -o /dev/null -w '%{http_code}' -X POST \
    "http://${IP_PROXY}/api/loyalty/verify/start" \
    -H "X-Forwarded-For: 8.8.8.$i" -H 'Content-Type: application/json' \
    -d '{"t":"x","phone":"0500000000"}' 2>/dev/null)
  [ "$c" = "429" ] && SPOOF_BLOCKED=$((SPOOF_BLOCKED+1))
done
if [ "$SPOOF_BLOCKED" -gt 0 ]; then
  ok "multi-hop XFF stuffing through the trusted proxy yields no new identity"
  ev "clientA stuffed rotating fake hops: still blocked $SPOOF_BLOCKED of 8"
else
  bad "XFF stuffing through the trusted proxy created new identities"
fi

docker rm -f "$PROXY" "$CLIENT_A" "$CLIENT_B" >/dev/null 2>&1

# =============================================================================
hdr "7/9 - backup writes to a SEPARATE volume"
# =============================================================================
# Dockerfile لا ينسخ scripts/ عمدًا (سطح إنتاج ضيق)، فتُركَّب أدوات الصيانة
# للقراءة فقط -- وهو ما يعكس التشغيل الواقعي: النسخ مهمة صيانة من المضيف
# أو حاوية أدوات ضد نفس الـVolume، لا من صورة التطبيق.
BK_OUT=$(docker run --rm --network "$NET" \
  -v "${VOL_DATA}:/data" -v "${VOL_BACKUP}:/backups" \
  -v "${ROOT}/scripts:/tools/scripts:ro" -v "${ROOT}/lib:/tools/lib:ro" -v "${ROOT}/db.js:/tools/db.js:ro" \
  -e BACKUP_DIR=/backups -e SQLITE_PATH=/data/data.sqlite \
  -w /tools "$IMAGE" node scripts/backup-restore.js backup --db /data/data.sqlite --out /backups 2>&1)

BK_FILES=$(docker run --rm -v "${VOL_BACKUP}:/backups" --entrypoint sh "$IMAGE" -c 'ls /backups/*.sqlite 2>/dev/null | wc -l')
DATA_FILES=$(docker run --rm -v "${VOL_DATA}:/data" --entrypoint sh "$IMAGE" -c 'ls /data/*.sqlite 2>/dev/null | wc -l')

if [ "${BK_FILES:-0}" -ge 1 ]; then
  ok "backup written to the SEPARATE backup volume"
  ev "backup volume ($VOL_BACKUP): $BK_FILES sqlite file(s)   data volume ($VOL_DATA): $DATA_FILES"
  echo "$BK_OUT" | grep -E '"file"|"sha256"|"migrations"|"tables"' | sed 's/^/       /'
else
  bad "no backup file found on the backup volume"
  echo "$BK_OUT" | tail -8 | sed 's/^/       /'
fi

BK_VERIFY=$(docker run --rm -v "${VOL_BACKUP}:/backups" \
  -v "${ROOT}/scripts:/tools/scripts:ro" -v "${ROOT}/lib:/tools/lib:ro" -v "${ROOT}/db.js:/tools/db.js:ro" \
  -w /tools --entrypoint sh "$IMAGE" -c 'node scripts/backup-restore.js verify --file $(ls /backups/*.sqlite | head -1)' 2>&1)
if echo "$BK_VERIFY" | grep -q '"ok": true'; then
  ok "the backup on the volume verifies (integrity + migrations recorded)"
  echo "$BK_VERIFY" | grep -E '"tables"|"migrations"|"lastMigration"' | sed 's/^/       /'
else
  bad "backup on the volume failed verification"
  echo "$BK_VERIFY" | tail -6 | sed 's/^/       /'
fi

# =============================================================================
hdr "9/9 - APP_INSTANCES enforcement"
# =============================================================================
MULTI_LOG=$(docker run --rm -v "${VOL_DATA}:/data" \
  -e NODE_ENV=production -e PORT=8787 -e SQLITE_PATH=/data/data.sqlite \
  -e SESSION_SECRET="$SESSION_SECRET" \
  -e ADMIN_BOOTSTRAP_USERNAME="$ADMIN_USER" -e ADMIN_BOOTSTRAP_PASSWORD="$ADMIN_PASS" \
  -e APP_INSTANCES=4 "$IMAGE" 2>&1)
MULTI_CODE=$?
if [ "$MULTI_CODE" -ne 0 ] && echo "$MULTI_LOG" | grep -q "not production-supported"; then
  ok "APP_INSTANCES=4 is refused in production"
  ev "container exit code=$MULTI_CODE"
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
  ev "state=${RUNNING_STATE:-<none>}  env=${APP_INST:-<none>}"
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

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "REAL_DOCKER_VERIFICATION: PASS"
  exit 0
else
  echo "REAL_DOCKER_VERIFICATION: FAIL"
  exit 1
fi
