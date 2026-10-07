# mobile/: the current app's phone companion

These are the current app's rules. Claude Code loads this file when a session first reads a file
under `mobile/`. The rewrite (`core/`, `desktop/`) does not follow them. `README.md` here has the
full local build and device-testing flow.

## Stack

React Native + Expo, Android only, distributed as a sideloaded APK (package
`com.lesterhan.havefish`). It talks to the Hono backend directly.

## Structure

```
mobile/
├── app/                 # Expo Router file-based routes
│   ├── (auth)/          # Login screen
│   └── (app)/           # Authenticated screens: speed entry, cash wallets, balances, history, settings
├── components/          # Shared React Native components
├── lib/
│   ├── api.ts           # Typed fetch helpers — base URL + session pulled from SecureStore
│   ├── auth.ts          # Session + server base URL stored in SecureStore
│   └── theme.ts         # The only place a colour literal may appear (`bun run lint:tokens`)
├── plugins/             # Expo config plugins applied during prebuild (e.g. release signing)
└── app.json             # Expo config (package: com.lesterhan.havefish)
```

## Commands

```bash
# From mobile/
bun run start         # start Metro bundler (scan QR with Expo Go)
bun run android       # run on connected device / emulator (needs Android SDK)
bun test              # the unit tests beside lib/
bun run lint          # Biome, scoped to mobile/ (root CLAUDE.md, "Formatting and linting")
bun run lint:tokens   # fails on a raw colour outside lib/theme.ts
```

Signed release APKs are built in CI (`.github/workflows/build-android.yml`) and published as
GitHub Releases for Obtainium. Cut an `android-v*` tag to trigger a build (plain `v*` is the
desktop binary's, #493). See `README.md` for the local prebuild + `gradle assembleRelease` flow.
