// Expo config plugin: make the local debug build a clearly-separate app from
// the signed release (CI / Obtainium) build, so both coexist on a device.
//
// Two changes, both applied during prebuild (android/ is gitignored and
// regenerated every run, so they can't be hand-edited into the project):
//
//  1. applicationIdSuffix '.dev' on the debug buildType — gives the dev build
//     its own package (com.lesterhan.havefish.dev) and its own data. Without it
//     Android refuses to install the debug APK over a release one
//     ("INSTALL_FAILED_VERSION_DOWNGRADE" / signature mismatch), and you'd have
//     to uninstall your daily-driver app to iterate.
//
//  2. A debug-variant strings.xml overriding app_name to "have-fish-dev" — so
//     the two home-screen icons are distinguishable at a glance instead of both
//     reading "have-fish". Debug-variant resources override main/ at build time.
//
// Release builds are untouched by both.

const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const SUFFIX_LINE = "            applicationIdSuffix '.dev'\n"

const DEBUG_STRINGS_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">have-fish-dev</string>
</resources>
`

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

// Patches app/build.gradle to give the debug build a .dev applicationId.
function withDebugSuffix(config) {
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

// Writes app/src/debug/res/values/strings.xml so the debug build's launcher
// label is "have-fish-dev". The debug resource set overrides main/ at build
// time, leaving the release label ("have-fish") untouched.
function withDebugAppName(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'debug',
        'res',
        'values',
      )
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'strings.xml'), DEBUG_STRINGS_XML)
      return cfg
    },
  ])
}

module.exports = function withDebugAppIdSuffix(config) {
  config = withDebugSuffix(config)
  config = withDebugAppName(config)
  return config
}
