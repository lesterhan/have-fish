// Expo config plugin: give debug builds a distinct applicationId so a local
// `expo run:android` dev build installs *alongside* the signed release APK
// (from CI / Obtainium) instead of colliding with it.
//
// Without this, the debug build shares com.lesterhan.havefish with the release
// app already on the device. Android then refuses to install the debug APK over
// a release one ("INSTALL_FAILED_VERSION_DOWNGRADE" / signature mismatch), and
// you'd have to uninstall your daily-driver app to iterate.
//
// With the suffix, the dev build is com.lesterhan.havefish.dev — a separate app
// with its own data, so both coexist. Release builds are untouched.
//
// Like withReleaseSigning, this patches the generated app/build.gradle during
// prebuild because android/ is gitignored and regenerated every run.

const { withAppBuildGradle } = require('@expo/config-plugins')

const SUFFIX_LINE = "            applicationIdSuffix '.dev'\n"

function patchDebugBuildType(contents) {
  if (contents.includes("applicationIdSuffix '.dev'")) {
    return contents // already patched
  }
  // Insert the suffix as the first line inside the debug buildType block.
  // Anchor on `buildTypes {` followed by `debug {` to avoid matching the
  // signingConfigs.debug block.
  const anchor = /(buildTypes \{\s*\n\s*debug \{\n)/
  if (!anchor.test(contents)) {
    throw new Error(
      'withDebugAppIdSuffix: could not find buildTypes.debug anchor in build.gradle — Expo template changed, plugin needs updating',
    )
  }
  return contents.replace(anchor, `$1${SUFFIX_LINE}`)
}

module.exports = function withDebugAppIdSuffix(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withDebugAppIdSuffix: expected groovy build.gradle, got ' + cfg.modResults.language,
      )
    }
    cfg.modResults.contents = patchDebugBuildType(cfg.modResults.contents)
    return cfg
  })
}
