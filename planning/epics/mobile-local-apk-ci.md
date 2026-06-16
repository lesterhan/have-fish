# Epic: Mobile — Local APK CI (drop EAS)

**Goal:** Build the Android APK entirely on GitHub Actions runners — no Expo/EAS cloud, no Expo account — and publish each build as a GitHub Release so [Obtainium](https://github.com/ImranR98/Obtainium) on the phone can install and self-update the app. The native Android project is regenerated from `app.json` on every run via `expo prebuild`, compiled with Gradle, and signed with a permanent keystore we own.

---

## Background

The current `build-android.yml` triggers an **EAS cloud build** (`eas build --profile preview`), downloads the resulting APK, and optionally attaches it to a GitHub Release. Obtainium can already consume that Release. The problem is the dependency on EAS: it requires a working Expo account, cloud build credentials, and the Expo build queue — friction we have not been able to get past.

The mobile app uses the **managed Expo workflow** (Expo SDK 52, RN 0.76). There is no `android/` directory committed — it's gitignored. `expo prebuild` generates it deterministically from `app.json`, so we can produce the native project fresh inside CI and build it with Gradle on the free `ubuntu-latest` runner. This removes EAS, the Expo account, and the cloud queue from the critical path entirely.

### Why a config plugin for signing

Because `android/` is regenerated on every CI run, we can't hand-edit `android/app/build.gradle` — the edit would be wiped by the next `prebuild`. An [Expo config plugin](https://docs.expo.dev/config-plugins/introduction/) runs *during* prebuild and patches the generated Gradle files declaratively, so the signing config survives every regeneration. This is the supported, repeatable mechanism — preferred over a brittle post-prebuild `sed`/patch step in CI.

### Signing & Obtainium constraint

Obtainium installs updates over the existing app only if **every build is signed with the same key**. We generate one release keystore once, store it as a GitHub secret, and reuse it forever. **This keystore is permanent and must be backed up offline** — losing it means Obtainium (and the OS) will reject updates due to signature mismatch, forcing a full uninstall/reinstall. Additionally, `versionCode` must strictly increase on each release or Android refuses to install the update.

---

## Design

### Pipeline (replaces the EAS steps in `build-android.yml`)

```
checkout
setup bun + JDK 17 + Android SDK
bun install
decode ANDROID_KEYSTORE_B64 secret -> mobile/release.keystore
npx expo prebuild --platform android --no-install   # generates android/, plugin injects signingConfig
cd android && ./gradlew assembleRelease             # builds + signs release APK
attach app/build/outputs/apk/release/app-release.apk to a GitHub Release
```

### Signing config plugin

A local plugin at `mobile/plugins/withReleaseSigning.js`, registered in `app.json` `plugins`. During prebuild it:

- Adds a `release` entry to `signingConfigs` in `android/app/build.gradle` reading the keystore path, store password, key alias, and key password from Gradle properties (`MYAPP_RELEASE_*`), which CI supplies via `-P` flags or `gradle.properties`.
- Points `buildTypes.release.signingConfig` at that `release` config (default managed template signs release with the debug key — we override it).

The four signing values come from secrets; nothing sensitive is committed.

### Versioning

`versionCode` must increment per release. Drive it from the CI run: the plugin (or a `--props`/gradle arg) sets `versionCode` to `github.run_number` so every build is monotonically higher. `versionName` continues to come from `app.json` `version` for human-readable releases.

### Secrets (GitHub repo settings)

| Secret | Purpose |
|---|---|
| `ANDROID_KEYSTORE_B64` | base64 of the release keystore |
| `ANDROID_KEYSTORE_PASSWORD` | keystore (store) password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

`EXPO_TOKEN` is no longer used and can be removed after cutover. `eas.json` and the `build` script in `package.json` can be deleted.

### Obtainium setup (end state)

Point Obtainium at `github.com/lesterhan/have-fish` (public repo → no PAT needed). It tracks GitHub Releases and pulls the `app-release.apk` asset. Because builds are tag-gated Releases (not bare workflow artifacts), Obtainium sees a clean version list.

---

## Stories

### 1. Signing keystore generation (manual, documented)

Not code — a one-time operational step, but documented in the epic and in `mobile/README` so it's reproducible.

- Generate the release keystore locally:
  ```
  keytool -genkeypair -v -keystore have-fish.keystore \
    -alias have-fish -keyalg RSA -keysize 2048 -validity 10000
  ```
- base64-encode it and add `ANDROID_KEYSTORE_B64` + the three password/alias secrets to the GitHub repo.
- Store the raw keystore + passwords in an offline backup (password manager). Document the recovery consequence of losing it.

**Acceptance:** secrets present in repo; keystore backed up; recovery note written.

### 2. Release-signing config plugin

- `mobile/plugins/withReleaseSigning.js` — Expo config plugin patching the generated `android/app/build.gradle`: adds `release` signingConfig from `MYAPP_RELEASE_*` Gradle properties, wires `buildTypes.release` to it, sets `versionCode` from an env/prop override.
- Register the plugin in `app.json` `plugins`.
- Verify locally: `npx expo prebuild --platform android` then inspect `android/app/build.gradle` for the injected `release` config and the release buildType pointing at it.

**Acceptance:** after prebuild, generated Gradle has a `release` signingConfig sourced from properties (no hard-coded secrets), and `buildTypes.release.signingConfig = signingConfigs.release`. Tested by running prebuild and asserting on the generated file.

### 3. Rewrite `build-android.yml` for local Gradle build

- Replace EAS steps with: JDK 17 setup (`actions/setup-java`), Android SDK setup, keystore decode, `expo prebuild --no-install`, `./gradlew assembleRelease` (passing `-PMYAPP_RELEASE_*` from secrets and `versionCode` from `github.run_number`).
- Add Gradle + bun caching to keep build time reasonable.
- Keep the artifact upload (debugging) and the conditional GitHub Release step (Obtainium).
- Decide trigger: keep `workflow_dispatch` with `release_tag`, and add **tag push** (`on: push: tags: 'v*'`) so cutting a `v*` tag produces a signed Release automatically.

**Acceptance:** manual run with a `release_tag` (and a `v*` tag push) produces a Release with `app-release.apk` attached, signed with the release key (verify with `apksigner verify --print-certs`).

### 4. Obtainium install + update round-trip

- Document Obtainium setup in `mobile/README`: add app by GitHub URL, pin to APK asset.
- Validate the full loop end-to-end: cut `v1.0.1`, confirm Obtainium detects it, installs; cut `v1.0.2` (higher `versionCode`), confirm it updates **in place** (no uninstall) — proving signing + versionCode are correct.

**Acceptance:** two successive releases install and update over each other on a real device via Obtainium with no signature/version errors.

### 5. Cleanup

- Remove `eas.json`, the `build` (eas) script in `package.json`, and the `EXPO_TOKEN` secret.
- Update `CLAUDE.md` mobile commands (drop `eas build`, document the new CI/Obtainium flow).
- Update `planning/ROADMAP.md`.

**Acceptance:** no remaining EAS references; docs reflect the local-Gradle + Obtainium flow.

---

## Out of scope

- **Expo OTA / `expo-updates`** — `updates.enabled` is already `false`; JS-only updates still ship as full APK releases. Could revisit later.
- **Play Store / AAB** — this epic is sideload-via-Obtainium only. The old `production` AAB profile is dropped with `eas.json`.
- **iOS** — Android only, unchanged from current scope.

## Risks

- **Keystore loss** → Obtainium/OS reject updates (signature mismatch), forcing uninstall/reinstall. Mitigation: offline backup in story 1.
- **Prebuild drift** — an Expo SDK upgrade can change generated Gradle; the plugin patches by AST/string match and may need updating. Mitigation: plugin asserts the anchor it patches and fails loudly if absent.
- **Build time** — cold prebuild + Gradle is ~8–15 min. Mitigation: Gradle + bun caching (story 3).
