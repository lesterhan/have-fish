FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY . .
# VITE_API_URL must be passed as a build arg so Vite can bake it into the
# client bundle at build time.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN bun run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json .
RUN npm install --omit=dev
EXPOSE 8888
CMD ["node", "build"]
