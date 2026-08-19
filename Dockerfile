# Alnadl Hospitality OS — production container
# No external npm dependencies exist in this project, so the image is
# intentionally minimal: official Node image + the source, nothing else.
FROM node:22-slim

WORKDIR /app

# Copy source. There is no package.json/npm install step because this
# project has zero external dependencies (node:http, node:sqlite, node:crypto
# only) — that is a deliberate architectural choice, not an oversight.
COPY server.js db.js ./
COPY lib ./lib
COPY public ./public
# migrations/ is REQUIRED at runtime, not optional tooling. R4-A proved that
# omitting it produced a container that printed a successful bootstrap line
# and then died on "no such table: engage_outbox" with 37 tables instead of
# 63 -- every table added after the initial schema was simply absent.
COPY migrations ./migrations

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
