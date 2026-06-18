// Expo config plugin: permit cleartext (HTTP) traffic to the self-hosted
// backend, scoped to Tailscale hosts only.
//
// Why this is needed:
//   Android 9+ blocks cleartext HTTP in non-debuggable (release) builds by
//   default. The dev build worked because debuggable apps implicitly allow
//   cleartext; the signed release APK does not, so it fails with
//   "CLEARTEXT communication to <host> not permitted by network security
//   policy". The backend is served as plain HTTP on :8887 (no TLS), so HTTPS
//   isn't an option without standing up a cert.
//
// Why scoping to Tailscale is safe:
//   All traffic to the server goes over the Tailscale tunnel, which is itself
//   WireGuard-encrypted end to end. Cleartext *inside* that tunnel is not
//   exposed on the local network or the internet. We scope the cleartext
//   permission to the `ts.net` MagicDNS suffix only, so the app still refuses
//   plaintext to any other host — no blanket cleartext allow.
//
// Applied during prebuild (android/ is gitignored and regenerated each run):
//   1. Write res/xml/network_security_config.xml with the scoped allow-list.
//   2. Point <application android:networkSecurityConfig> at it.

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

// Cleartext permitted only for the Tailscale MagicDNS suffix:
//  - includeSubdomains ts.net → covers any *.<tailnet>.ts.net FQDN
//
// Deliberately NOT permitting bare short names (the MagicDNS short name): an
// unqualified name can be hijacked by hostile DNS on an untrusted network,
// which would let an attacker receive our cleartext (session token included).
// The ts.net namespace is resolvable only via Tailscale MagicDNS and cannot
// be spoofed that way, so the app MUST use the full ...ts.net hostname.
const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">ts.net</domain>
    </domain-config>
</network-security-config>
`

function withNetworkSecurityConfigFile(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      )
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'network_security_config.xml'),
        NETWORK_SECURITY_CONFIG,
      )
      return cfg
    },
  ])
}

function withManifestReference(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0]
    if (!application) {
      throw new Error(
        'withTailscaleCleartext: no <application> in AndroidManifest — Expo template changed, plugin needs updating',
      )
    }
    application.$['android:networkSecurityConfig'] =
      '@xml/network_security_config'
    return cfg
  })
}

module.exports = function withTailscaleCleartext(config) {
  config = withNetworkSecurityConfigFile(config)
  config = withManifestReference(config)
  return config
}
