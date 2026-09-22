FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG PUBLIC_VERSION=dev
ENV PUBLIC_VERSION=$PUBLIC_VERSION
RUN bun run build

# The build is now a directory of static files rather than a Node server, so nothing here
# runs JavaScript. This stage is interim: once the backend serves `build/` directly the
# whole service goes away and this file with it.
FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8888
