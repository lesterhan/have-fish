# have-fish mobile

Android client for have-fish — React Native + Expo (SDK 56, Expo Router).
Primarily the Fish Pie group-expense flow on the go.

## Quick start (development build)

**Expo Go does not work for this app** — it uses native config plugins
(`plugins/withReleaseSigning`, `withDebugAppIdSuffix`) and tracks a specific SDK,
so it must run as a *development build*, not in the Expo Go sandbox. Trying Expo
Go shows a blank screen / "Failed to download remote update".

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
(stored in SecureStore via `lib/auth.ts`), not hardcoded — point it at your dev
backend's LAN address (e.g. `http://192.168.x.x:8887`), not `localhost`, since
that resolves to the phone itself.

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
