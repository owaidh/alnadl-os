# Alnadl Hospitality OS — production container
#
# The image carried no dependency step while the project genuinely had none.
# That stopped being true when P0-01 added qrcode@1.5.3 for guest QR
# generation, and the stale comment below it was worse than the missing step:
# it asserted a property the project no longer had, so the gap read as
# intentional. A production image built without this step ships an app whose
# QR endpoint answers 503 forever.
FROM node:22-slim

WORKDIR /app

# Dependencies first, in their own layer: the manifest changes far less often
# than the source, so this layer is reused across ordinary code builds.
#
# npm ci (not npm install) because ci installs EXACTLY the lockfile and fails
# if the two disagree. npm install would silently resolve a different
# transitive graph than the one that was tested -- which is the whole reason a
# lockfile exists.
#
# --omit=dev keeps playwright (an optional test-only dependency) out of the
# production image entirely.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source.
COPY server.js db.js ./
COPY lib ./lib
COPY public ./public
# migrations/ is REQUIRED at runtime, not optional tooling. R4-A proved that
# omitting it produced a container that printed a successful bootstrap line
# and then died on "no such table: engage_outbox" with 37 tables instead of
# 63 -- every table added after the initial schema was simply absent.
COPY migrations ./migrations
COPY scripts ./scripts

# data.sqlite is created on first boot inside the container. Mount a volume
# at /app so the database survives container restarts/redeploys:
#   docker run -v alnadl-data:/app/data -e SQLITE_PATH=/app/data/data.sqlite ...
# (see db.js — DB_PATH honors this if you set it; default is ./data.sqlite)
# Release identification — تُمرَّر وقت البناء ولا تُستنتج من محتوى الحاوية.
# استنتاجها من الملفات يجعل الحاوية "تصف نفسها" بما قد لا يطابق ما بُني منه
# فعلًا؛ والقيمة الوحيدة الموثوقة هي ما حقنه خط البناء صراحةً.
#
#   docker build \
#     --build-arg BUILD_VERSION="$(git describe --tags --abbrev=0)" \
#     --build-arg BUILD_COMMIT="$(git rev-parse HEAD)" \
#     --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
#     -t alnadl:production .
ARG BUILD_VERSION=unknown
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV BUILD_VERSION=$BUILD_VERSION
ENV BUILD_COMMIT=$BUILD_COMMIT
ENV BUILD_TIME=$BUILD_TIME

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# --experimental-sqlite is not required on Node 22.5+ but kept explicit
# for older 22.x builds where node:sqlite is still gated.
CMD ["node", "server.js"]
