# One image: the API with the built frontend inside it.
#
# The build context is the repository root rather than `backend/`, because the backend now
# serves the frontend's output and a context rooted at either half cannot see the other.
# That is the only reason this file sits here.

# --- the frontend build -----------------------------------------------------------------
FROM oven/bun:1 AS frontend
WORKDIR /app
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
ARG PUBLIC_VERSION=dev
ENV PUBLIC_VERSION=$PUBLIC_VERSION
RUN bun run build

# --- the backend's dependencies ---------------------------------------------------------
# Not pruned to production: `db:migrate` runs drizzle-kit, which is a devDependency, and
# the container runs migrations on start.
FROM oven/bun:1 AS backend
WORKDIR /app
COPY backend/package.json backend/bun.lock ./
RUN bun install --frozen-lockfile
COPY backend/ ./

# --- what actually runs -------------------------------------------------------------------
FROM oven/bun:1
WORKDIR /app
COPY --from=backend /app ./
# `src/index.ts` looks here, and serves the API alone if it is empty.
COPY --from=frontend /app/build ./public
EXPOSE 8887
CMD ["bun", "run", "src/index.ts"]
