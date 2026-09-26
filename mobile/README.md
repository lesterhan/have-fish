# have-fish mobile

Android client for have-fish — React Native + Expo (SDK 56, Expo Router).
Primarily the Fish Pie group-expense flow on the go.

## Two ways to run it

| | Expo Go | Development build |
|---|---|---|
| Setup | Expo Go from the Play Store, nothing else | JDK + Android SDK, a slow first native build |
| Good for | Walking through flows, JS/UI changes | Anything native: a config plugin, a native dependency, release-only behaviour |
| Start | `bun run start -- --localhost`, press `a` | `bun run android` |

**Expo Go** runs the app as long as its SDK matches the project's (Expo Go 56 for
SDK 56). The config plugins under `plugins/` only act at prebuild, so Expo Go never
applies them, which is fine for testing flows. For the full USB recipe, including a
local backend, see [Testing on a phone over USB](#testing-on-a-phone-over-usb).

## Quick start (development build)

First-time setup needs a JDK and the Android SDK. The Android Studio bundled
JBR (a JDK 21) and the SDK at `~/Android/Sdk` both work:

```fish
# persist these in ~/.config/fish/config.fish so every build/prebuild sees them
set -gx JAVA_HOME ~/apps/android-studio/jbr
set -gx ANDROID_HOME ~/Android/Sdk

bun install
bun run android      # expo run:android — prebuild + native build + install + Metro
```

The **first** native build is slow (compiles RN/Hermes C++ from scratch, single
arch). After that the daily loop is fast: leave the dev app installed and run
`bun run start` (Metro) — JS edits hot-reload instantly. Only rebuild natively
when a native dependency changes.

The dev build installs as `com.lesterhan.havefish.dev` (the `.dev` suffix comes
from `withDebugAppIdSuffix`), so it sits **alongside** the signed release app
from Obtainium without colliding.

The app talks to a have-fish backend. The **server URL is entered in the app**
(stored in SecureStore via `lib/auth.ts`), not hardcoded. 8888 is the port a
deployed have-fish answers on; a `bun run dev` backend is on 8887. On the phone,
`localhost` is the phone itself, unless `adb reverse` forwards the port to the laptop
(see below).

## Testing on a phone over USB

A USB cable is the most reliable path from phone to laptop: it doesn't care which
Wi-Fi the phone is on or whether the laptop's firewall blocks the port. The recipe
below runs the app in Expo Go against a **local backend with seeded data**, so a test
never writes to the deployed server.

### One-time setup

Turn on USB debugging on the phone (Developer options), plug it in, and check that
`adb devices` lists it as `device`.

Then give the backend its own dev database. This is a standalone container, separate
from the compose stack's `postgres_data` volume, so it can be wiped freely:

```fish
podman run -d --name have-fish-dev-db \
  -e POSTGRES_USER=havefish -e POSTGRES_PASSWORD=havefish -e POSTGRES_DB=havefish \
  -p 127.0.0.1:5432:5432 -v have-fish-dev-data:/var/lib/postgresql/data \
  docker.io/library/postgres:16-alpine
podman exec have-fish-dev-db psql -U havefish -d havefish -c 'CREATE DATABASE havefish_test'
```

Match the user, password and port to `DATABASE_URL` in `backend/.env`; the values
above are the ones in `.env.example`. Then, from `backend/`:

```fish
bun install
bun run db:migrate
bun run db:migrate:test
SEED_EMAIL=you@example.com SEED_PASSWORD=yourpassword \
  SEED_PARTNER_EMAIL=partner@example.com bun run scripts/seed-all.ts
```

`seed-all` creates you and a partner account (`password123` unless
`SEED_PARTNER_PASSWORD` is set), two months of transactions and a shared Fish Pie
group, so both sides of a split can be tested.

Finally, add the phone's view of the backend to `backend/.env`:

```
TRUSTED_ORIGINS=http://localhost:8887,http://127.0.0.1:8887
```

The app sends the server address as its `Origin` on sign-in, and Better Auth's CSRF
guard answers 403 to an origin it doesn't trust.

### Each session

```fish
podman start have-fish-dev-db
cd backend; bun run dev                  # backend on :8887

# second terminal
adb reverse tcp:8081 tcp:8081            # Metro, for Expo Go
adb reverse tcp:8887 tcp:8887            # the backend, for the app
cd mobile; bun run start -- --localhost  # then press a
```

`adb reverse` makes `localhost:<port>` on the phone reach the laptop. It is lost
whenever the cable is unplugged or adb restarts, so run it again after that.
`--localhost` makes Expo Go load the bundle from `127.0.0.1:8081`, which goes over the
cable, instead of the laptop's Wi-Fi address.

In the app, sign in to `http://localhost:8887` with the seeded account. To go back to
the deployed server, sign out and pick it from the remembered list.

> **Empty the offline queue before switching servers.** Expenses saved while
> offline replay against whichever server the app is signed in to, so a queued
> expense meant for the deployed server would land in the local one instead.

To start over with an empty database, run `bun run reset-db` from `backend/`, then the
seed command again.

### When it doesn't connect

| Symptom | Cause | Fix |
|---|---|---|
| Expo Go: "Failed to download remote update" | The phone can't reach Metro. Usually the laptop's firewall (`ufw`) is blocking 8081, or the phone is on another network | Start with `--localhost` and `adb reverse tcp:8081 tcp:8081` |
| Expo Go: "incompatible with this version of Expo Go" | Expo Go's SDK doesn't match the project's | Update Expo Go, or use the development build |
| Sign-in: network request failed | Port 8887 isn't forwarded, or the backend isn't running | `adb reverse tcp:8887 tcp:8887`; check `bun run dev` |
| Sign-in: 403 | The backend doesn't trust the phone's origin | `TRUSTED_ORIGINS` above, then restart the backend |
| Backend: "Cannot find package …" | The backend's dependencies are out of date | `bun install` in `backend/` |

To check the phone's side directly: `adb shell nc -z -w 3 127.0.0.1 8887 && echo ok`.

## Project layout

```
mobile/
├── app/                    # Expo Router file-based routes
│   ├── _layout.tsx         # root layout
│   ├── (auth)/login.tsx    # unauthenticated: server URL + email/password
│   └── (app)/              # authenticated screens
│       ├── index.tsx       # group list
│       ├── groups/[id].tsx # group detail (balances, expenses, settle)
│       └── settings.tsx
├── components/             # screen-level UI (ExpenseForm, SettleModal, …)
│                           #   + design primitives: Chip, Button, ScreenHeader,
│                           #     SegmentedTabs
├── lib/
│   ├── api.ts              # typed fetch helpers; pulls base URL + session
│   ├── auth.ts             # SecureStore-backed base URL + session storage
│   └── theme.ts            # design tokens — the only place raw colors live
├── plugins/                # Expo config plugins applied during prebuild
└── app.json               # Expo config (package: com.lesterhan.havefish)
```

Auth is a Better Auth session cookie captured at login and replayed on each
request — see `getSession`/`setSession` in `lib/auth.ts` and how `api.ts`
attaches it.

## Design system — "have-fish Pocket Companion"

The mobile UI mirrors the web's Graphite aesthetic as an **Aqua-card subset**:
flat bordered cards on a graphite desktop, a fixed Aqua accent, sharp corners,
and the system font. (No XP bevels — React Native has no `box-shadow` parity.)

**The one rule: never hardcode a visual value. Always read from `lib/theme.ts`.**

- `theme` — spacing (`sp`), type scale (`text`), `weight`, `font`, `radius`,
  the Graphite `color` palette, `duration`, and the `card` surface. `cardStyle`
  is a ready-to-spread card style.
- Reuse the shared primitives instead of re-styling: **`Chip`** (toggle pills),
  **`Button`** (`primary`/`neutral`/`danger`), **`ScreenHeader`**, and
  **`SegmentedTabs`**.
- `bun run lint:tokens` fails if a raw hex or `rgba(...)` appears anywhere
  outside `lib/theme.ts`. Run it before opening a PR.

Light theme only today; the palette is structured so a dark variant can be
swapped in at a single point later. The per-user accent preference (web's
`accent.ts`) is not yet honored — the accent is the fixed Aqua default.

## `android/` is generated, not committed

`android/` is produced by `expo prebuild` and is gitignored — never hand-edit
it; changes belong in `app.json` or a config plugin under `plugins/`. Force a
clean regenerate with `bunx expo prebuild --platform android --clean` (needed
after an SDK bump — an incremental prebuild can leave stale Gradle files).

## First-build gotchas

Hit once on a fresh machine / after an SDK bump (all one-time):

- **Gradle wrapper download times out.** The RN template ships
  `gradle-wrapper.properties` with `networkTimeout=10000` (10s), too short for
  the ~130 MB Gradle distribution on a slow link. Either pre-seed it once —
  download the `gradle-*-bin.zip` named in that file into
  `~/.gradle/wrapper/dists/<name>/<hash>/`, unzip it there, and `touch`
  `<name>.zip.ok` — or bump `networkTimeout` (ephemeral; `android/` is
  regenerated). The `~/.gradle` cache is durable and survives prebuilds.
- **"SDK location not found."** A stale Gradle daemon started without
  `ANDROID_HOME` ignores the env var. Set `ANDROID_HOME` (above) and/or write
  `sdk.dir=$HOME/Android/Sdk` into `android/local.properties`, then
  `./android/gradlew --stop` to kill stale daemons.
- **"INSTALL_FAILED_VERSION_DOWNGRADE."** The release app is already installed
  at a higher versionCode. The `.dev` suffix (above) avoids this; if you hit it
  on a same-package build, `adb uninstall <package>` first.

## Dependency versions

Native deps are pinned to the versions Expo SDK 56 expects — run
`bunx expo install --check` (and `bunx expo-doctor`) after touching
`package.json`. Mismatched native modules surface as Metro/codegen errors at
build time, not install time.

## Releases

Signed APKs are built in CI (`.github/workflows/build-android.yml`) and
published as GitHub Releases for install via Obtainium. The build, signing, and
keystore setup are documented in the epic at
`planning/epics/archive/mobile-local-apk-ci.md`.
