# L07 — Security in the local model

**Status:** Outline — research queue. Companion to Track A doc 02; this doc covers
what *changes*, not general hygiene.

## The threat-model shift (frame for the full doc)

| Cloud track worry | Local track status |
|---|---|
| Multi-tenant IDOR | **Gone** — one user per process/DB |
| Server breach → all ledgers | **Gone** — no server ledger store (relay holds ciphertext, L03) |
| Credential stuffing | Gone locally; returns (small) on relay accounts |
| Backup theft from our bucket | Ours gone; user's own backup hygiene now matters |
| **New: malicious website → localhost API** | The signature local-app risk (below) |
| **New: update supply chain** | We ship executables; a compromised release = RCE on every user (L05 §4) |
| New: other local users / stolen laptop | OS accounts + disk encryption (L02 encryption question LQ2) |
| Malicious CSV / export injection | **Unchanged** — doc 02 §3 applies verbatim |

## Sections to write (research queue)

1. **The localhost attack surface (top priority).** Any webpage the user visits can
   fire requests at `http://127.0.0.1:<port>`; DNS-rebinding can bypass same-origin
   assumptions. Required design (lands in L01's server bootstrap):
   - bind `127.0.0.1` only;
   - **validate `Host` and `Origin`/`Sec-Fetch-Site` headers** on every request
     (kills rebinding + cross-site fetches);
   - session bootstrap via **single-use token in the launch URL** → cookie
     (`SameSite=Strict`), so bare `localhost:port` from another context has no
     session;
   - CORS: no CORS headers at all (same-origin only);
   - note: browsers' Private Network Access work helps but is not something to
     rely on cross-browser. Research current state when writing.
2. **Update supply chain** — joint with L05 §4: signed releases, key custody,
   dependency/lockfile gates (Track A doc 02 §7 CI gates apply unchanged),
   the "curl | sh" installer question (avoid; checksummed downloads).
3. **Local data protection** — file permissions (0700 data dir), OS keychain for
   relay credentials/group keys (Tauri keychain plugin or keytar-equivalent under
   Bun — research), memory hygiene expectations (realistic: none beyond not logging
   secrets), the LQ2 passphrase-encryption decision.
4. **Relay security (with L03)** — E2E key design review: sealed invites, key
   rotation on member removal, relay account auth hardening = mini Track A doc 04.
   What a fully-compromised relay can and cannot learn — write it as a table; it's
   also the marketing/privacy-policy artifact.
5. **Vulnerability handling for shipped software** — SECURITY.md, advisory channel,
   how users get patched (update cadence, L05) — a CVE in a desktop app can't be
   hot-patched server-side; this changes response SLAs.
6. **Privacy posture doc** — what never leaves the machine (everything except relay
   ciphertext + FX fetches + update checks); each outbound call enumerated. Doubles
   as the privacy policy's technical annex (shrinks Track A doc 03 obligations to
   nearly nil for the local app: PIPEDA still applies to relay accounts + any
   crash telemetry, and that's about it).

## Sources (seed list)

- [OWASP — DNS rebinding](https://owasp.org/www-community/attacks/DNS_Rebinding); research current browser Private Network Access status when writing
- [MDN — Sec-Fetch-Site](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site)
- Prior art to study: how Jupyter (localhost token URLs) and Syncthing (CSRF tokens + host check) secure their local web UIs — both survived years of scrutiny
- [SLSA framework](https://slsa.dev/) — supply-chain levels, right-size for a solo shop
- Track A `../02-data-security.md` §3 (input handling), §7 (supply chain) — apply unchanged
