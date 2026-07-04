# L05 — Distribution, signing & updates

**Status:** Outline — research queue for a future session. Precedent to mine
throughout: how Actual, Obsidian, and small Tauri apps actually ship.

## Sections to write (research queue)

1. **Release pipeline** — CI matrix cross-compiling the Bun binary (L01) for
   linux-x64/arm64, darwin-x64/arm64, windows-x64; checksums + SBOM; GitHub
   Releases as the channel (mirrors the existing Android APK/Obtainium flow —
   `build-android.yml` is the in-repo precedent to copy).
2. **Code signing — the real costs** (research done 2026-07-04, keep current):
   - **Windows:** unsigned binaries hit SmartScreen "unrecognized app" walls — a
     conversion killer. OV/individual Authenticode certs ~US$215–230/yr
     (Comodo/Sectigo via resellers; individual-developer certs exist for
     unincorporated devs). Azure Trusted/Artifact Signing (~$10/mo) is the cheap
     path but currently gated to US/Canada orgs with 3+ yrs history. From
     2026-02-15, cert lifespans cap at 1 year (annual renewal is now structural).
   - **macOS:** Apple Developer Program US$99/yr; notarization required or Gatekeeper
     blocks by default; Tauri docs cover the signing+notarize pipeline.
   - **Linux:** no gatekeeper; checksums/Sigstore + distro packaging (AppImage/deb;
     Flatpak/AUR by demand).
   - Budget line: ~US$320+/yr just to be double-clickable — a real Track B fixed
     cost; fold into L06's pricing math.
3. **Update mechanism, staged:** v1 manual download → v1.5 in-app update check
   (GitHub Releases API poll, notify only) → v2 Tauri updater (signed update
   manifests) once L01 Option B lands. **Never silent-update a finance app** —
   release notes + user consent; DB migration implications (L02: pre-migration
   backup + no-downgrade guard).
4. **Update supply-chain security** (with L07): signed artifacts, reproducible-ish
   builds, release-signing key custody (offline key, not in CI), Sigstore/cosign
   evaluation.
5. **Website & docs** — download page with per-OS detection, verification
   instructions, self-hosted-relay docs (L03). The website is the storefront in
   this track (no SaaS signup funnel).
6. **Telemetry decision** — recommendation: none, or opt-in crash reports only
   (Sentry local buffering). "We can't see your data — or your usage" is the
   marketing line; write it down as policy.

## Sources (seed list)

- [Tauri v2 — macOS signing](https://v2.tauri.app/distribute/sign/macos/), [Windows signing](https://v2.tauri.app/distribute/sign/windows/), [Updater](https://v2.tauri.app/plugin/updater/)
- [Ship your Tauri app: signing walkthrough](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n)
- [Code signing cert pricing survey](https://codesigncert.com/blog/code-signing-certificate-cost); [SignMyCode Authenticode pricing](https://signmycode.com/authenticode-signing)
- [Apple Developer Program](https://developer.apple.com/programs/) ($99/yr, notarization)
- [Sigstore/cosign](https://docs.sigstore.dev/)
- In-repo precedent: `.github/workflows/build-android.yml` + Obtainium flow (`mobile/README.md`)
