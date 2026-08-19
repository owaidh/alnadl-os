#!/usr/bin/env bash
# scripts/generate-lockfile.sh
#
# يُولّد package-lock.json في بيئة تملك وصولًا إلى npm.
#
# لماذا هذا سكربت منفصل ولماذا لم يُولَّد الملف مسبقًا: بيئة البناء التي
# طُوّر فيها هذا الإصدار تُرجع 403 من سجل npm، فلا يمكن حلّ شجرة التبعيات
# فيها. وكتابة lockfile يدويًا ليست خيارًا: قيمه الجوهرية هي **تجزئات
# السلامة (integrity hashes)** لكل حزمة، وهي لا تُعرف إلا بتنزيلها فعلًا.
# ملف مُختلق سيبدو صحيحًا ويفشل عند أول `npm ci` -- أو أسوأ: يمرّ بشجرة
# مختلفة عمّا اختُبر.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f package-lock.json ]; then
  echo "package-lock.json already exists. Refusing to overwrite."
  echo "Delete it deliberately first if you intend to regenerate."
  exit 1
fi

echo "generating package-lock.json (no install into node_modules)..."
npm install --package-lock-only

echo ""
echo "verifying the lockfile installs reproducibly..."
rm -rf .lockcheck && mkdir -p .lockcheck
cp package.json package-lock.json .lockcheck/
( cd .lockcheck && npm ci --omit=dev >/dev/null 2>&1 )
if [ -d .lockcheck/node_modules/qrcode ]; then
  VER=$(node -p "require('./.lockcheck/node_modules/qrcode/package.json').version")
  echo "  qrcode installed from lockfile: $VER"
  [ "$VER" = "1.5.3" ] || { echo "  ERROR: expected 1.5.3"; exit 1; }
else
  echo "  ERROR: qrcode was not installed by npm ci"
  exit 1
fi
rm -rf .lockcheck

echo ""
echo "package-lock.json is ready. Commit it — the production image requires it:"
echo "  Dockerfile runs 'npm ci --omit=dev', which FAILS if the lockfile is absent."
