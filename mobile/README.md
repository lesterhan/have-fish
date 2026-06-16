# have-fish mobile

React Native + Expo (SDK 52) Android client. Built and signed in CI on GitHub
Actions — no EAS / Expo cloud — and distributed as a GitHub Release that
[Obtainium](https://github.com/ImranR98/Obtainium) installs and auto-updates on
the phone.

## Local development

```bash
bun install
bun run start        # Metro bundler — scan QR with Expo Go for fast iteration
```

Set `BASE_URL` in `lib/api.ts` to your server's LAN IP (not `localhost` — the
phone can't reach that).

For a native dev build on an emulator or USB device you need a JDK and the
Android SDK on your PATH (see below), then:

```bash
bun run android      # expo run:android
```

## Building a release APK locally

`android/` is **not** committed — it's regenerated from `app.json` by
`expo prebuild`. To reproduce the CI build on your machine:

```bash
export JAVA_HOME=/path/to/jdk17        # JDK 17 recommended (21 also works)
export ANDROID_HOME=$HOME/Android/Sdk
export PATH="$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
```

Without the signing properties below, the release build falls back to the
**debug** key — fine for a quick local check, but such an APK cannot update over
an Obtainium-installed (release-signed) one. The signed build is what CI
produces.

## Signing

Release signing is injected at prebuild time by `plugins/withReleaseSigning.js`
(a config plugin, so it survives every `prebuild`). It reads the keystore from
Gradle properties — nothing sensitive is committed:

| Gradle property | Source |
| --- | --- |
| `MYAPP_RELEASE_STORE_FILE` | path to the decoded keystore |
| `MYAPP_RELEASE_STORE_PASSWORD` | `ANDROID_KEYSTORE_PASSWORD` secret |
| `MYAPP_RELEASE_KEY_ALIAS` | `ANDROID_KEY_ALIAS` secret |
| `MYAPP_RELEASE_KEY_PASSWORD` | `ANDROID_KEY_PASSWORD` secret |

The plugin also makes `versionCode` overridable via a `versionCode` Gradle
property; CI sets it to the workflow run number so every release is
monotonically higher (Android refuses an update with an equal or lower
`versionCode`).

### Generating the keystore (one-time)

The release keystore is your app's **permanent signing identity**. Generate it
once, store the four values as GitHub repo secrets, and back the keystore +
password up offline. **If you lose it, Obtainium and Android reject all future
updates over the installed app — there is no recovery, only uninstall +
reinstall.**

```fish
read -s -P "Keystore password: " HF_KS_PASS; echo
set -x HF_KS_PASS $HF_KS_PASS

keytool -genkeypair -v \
  -keystore ~/have-fish-release.keystore \
  -alias have-fish \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass:env HF_KS_PASS -keypass:env HF_KS_PASS \
  -dname "CN=have-fish, O=laserdanger, C=CA"

base64 -w0 ~/have-fish-release.keystore | gh secret set ANDROID_KEYSTORE_B64
printf '%s' "$HF_KS_PASS" | gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS --body have-fish
printf '%s' "$HF_KS_PASS" | gh secret set ANDROID_KEY_PASSWORD
set -e HF_KS_PASS
```

The `-alias` must match the `ANDROID_KEY_ALIAS` secret.

## Releasing

The `Build Android APK` workflow (`.github/workflows/build-android.yml`) runs on:

- a pushed tag matching `v*` — creates a GitHub Release with the APK attached, or
- manual dispatch — optionally pass a `release_tag` to also publish a Release.

```bash
git tag v1.0.1 && git push origin v1.0.1
```

This builds, signs, verifies the signature, and attaches `have-fish.apk` to the
`v1.0.1` Release.

## Installing on the phone (Obtainium)

1. Install [Obtainium](https://github.com/ImranR98/Obtainium) (e.g. from F-Droid).
2. **Add app** → paste the repo URL: `https://github.com/lesterhan/have-fish`.
3. Obtainium tracks the repo's Releases and offers the latest `have-fish.apk`.
   Tap install.
4. On later releases (higher `versionCode`), Obtainium installs the update
   **in place** — no uninstall — because every build is signed with the same
   keystore.

A signature-mismatch error on update means a build was signed with a different
key (e.g. a local debug-signed APK over a release one). Reinstall from a CI
release to fix.
