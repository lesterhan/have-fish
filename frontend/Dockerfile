FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY . .
ARG PUBLIC_VERSION=dev
ENV PUBLIC_VERSION=$PUBLIC_VERSION
RUN bun run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json .
RUN npm install --omit=dev
EXPOSE 8888
CMD ["node", "build"]
