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

The `mobile/` directory is a React Native + Expo app that talks directly to the Hono backend. It targets Android only and is distributed as a sideloaded APK — no Play Store.

**Prerequisites:** Node.js, [Expo CLI](https://docs.expo.dev/more/expo-cli/), [EAS CLI](https://docs.expo.dev/eas-update/getting-started/) (`npm i -g expo-cli eas-cli`)

### Run on device / emulator (Expo Go)

```bash
cd mobile
bun install          # or npm install

# Point the app at your server — edit mobile/lib/api.ts and set BASE_URL
# to your backend's Tailscale or local address, e.g. http://100.x.x.x:8887

bun run start        # starts Metro bundler — scan QR with Expo Go on device
```

### Dev build (full native, no Expo Go)

```bash
cd mobile
bun run android      # requires Android SDK / connected device or emulator
```

### Build a sideload-ready APK (EAS)

```bash
cd mobile
eas build --platform android --profile preview
# EAS builds in the cloud and gives you a download link for the .apk
# Install on device: adb install have-fish.apk
```

The `production` EAS profile produces an `.aab` (App Bundle) for Play Store submission if ever needed.
