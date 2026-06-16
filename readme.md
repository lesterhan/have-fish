# have-fish 有鱼

Personal finance tracker that brings clarity to money spent while out and about. Built for self-hosting.

年年有余 `nián nián yǒu yǔ` is a common blessing for having left overs each harvest. 有鱼 `yǒu yǔ` to "have fish" is often substituted as a wordplay, with iconographies of fish as representing prosperity each Spring Festival.

## Stack

- **Backend** — [Hono](https://hono.dev/) + [Bun](https://bun.sh/)
- **Frontend** — [SvelteKit](https://kit.svelte.dev/) + Svelte 5
- **Mobile** — React Native + [Expo](https://expo.dev/) (Android)
- **Database** — PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/)
- **Auth** — [Better Auth](https://www.better-auth.com/) (email + password)
- **Deployment** — Docker/Podman Compose

## Local Development

**Prerequisites:** Bun, Podman (or Docker)

```bash
# 1. start postgres
podman compose up postgres -d

# 2. backend
cd backend
cp .env.example .env      # fill in BETTER_AUTH_SECRET (openssl rand -base64 32)
bun install
bun run db:reset           # generate + apply migrations
bun run dev                # http://localhost:8887

# 3. create your user (first time only)
SEED_EMAIL=you@example.com SEED_PASSWORD=yourpassword bun run seed-user

# 4. frontend (new terminal)
cd frontend
bun install
bun run dev                # http://localhost:8888
```

## Running Tests

```bash
cd backend
bun test
# or in watch mode
bun run test:watch
```

## Full Stack (Docker/Podman)

```bash
# from project root
cp .env.example .env      # then fill in your values
podman compose up --build
```

Frontend at `http://localhost:8888`, backend at `http://localhost:8887`.

## Mobile App (Android)

The `mobile/` directory is a React Native + Expo app that talks directly to the Hono backend. It targets Android only and is distributed as a sideloaded APK — no Play Store. See [`mobile/README.md`](mobile/README.md) for full details.

### Run on device / emulator (Expo Go)

```bash
cd mobile
bun install
bun run start        # starts Metro bundler — scan QR with Expo Go on device
```

Point the app at your server **from within the app** (server URL is stored in
SecureStore, not hardcoded) — use your backend's Tailscale or LAN address, e.g.
`http://100.x.x.x:8887`, not `localhost`.

### Dev build (full native, no Expo Go)

```bash
cd mobile
bun run android      # requires Android SDK / connected device or emulator
```

### Install on your phone (Obtainium)

Signed release APKs are built in CI (`.github/workflows/build-android.yml`) and
published as GitHub Releases. Install and auto-update them with
[Obtainium](https://github.com/ImranR98/Obtainium): add the app by this repo's
URL and it tracks each Release. Cutting a `v*` tag produces a new release build.
