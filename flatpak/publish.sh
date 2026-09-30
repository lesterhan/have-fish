#!/usr/bin/env bash
# Builds the site a `v*` tag publishes on GitHub Pages (#518): an OSTree repo holding the
# bundles given, signed with the key whose fingerprint is given, and the files that point
# Flatpak at it.
#
#   flatpak/publish.sh <site dir> <site url> <fingerprint> <bundle>...
#
# The key must already be in GPG's keyring (GNUPGHOME, when set). Every tag builds the repo
# afresh: an installed copy updates from any commit to the newest, so the site keeps only the
# release it is for.

set -euo pipefail

site=$1 url=${2%/} fingerprint=$3
shift 3
app=com.lesterhan.havefish
repo="$site/repo"

gpg --batch --list-secret-keys "$fingerprint" >/dev/null ||
  { echo "no secret key $fingerprint in the keyring" >&2; exit 1; }
sign=(--gpg-sign="$fingerprint")
[ -n "${GNUPGHOME:-}" ] && sign+=(--gpg-homedir="$GNUPGHOME")

mkdir -p "$site"
ostree init --mode=archive --repo="$repo"
for bundle in "$@"; do
  flatpak build-import-bundle "${sign[@]}" "$repo" "$bundle"
done
flatpak build-update-repo "${sign[@]}" --generate-static-deltas --prune \
  --title=have-fish --default-branch=stable "$repo"

# The public half of the key, which Flatpak pins when the remote is added.
key=$(gpg --batch --export "$fingerprint" | base64 -w0)

# `flatpak install <url>/havefish.flatpakref` installs the app and adds the repo as a remote,
# so `flatpak update` and software centres find the next release there. The runtime comes
# from Flathub.
cat >"$site/havefish.flatpakref" <<EOF
[Flatpak Ref]
Title=have-fish
Name=$app
Branch=stable
Url=$url/repo/
SuggestRemoteName=havefish
Homepage=https://github.com/lesterhan/have-fish
RuntimeRepo=https://dl.flathub.org/repo/flathub.flatpakrepo
IsRuntime=false
GPGKey=$key
EOF

# The repo alone, for `flatpak remote-add`.
cat >"$site/havefish.flatpakrepo" <<EOF
[Flatpak Repo]
Title=have-fish
Url=$url/repo/
Homepage=https://github.com/lesterhan/have-fish
Comment=Personal finance, kept on your own computer
GPGKey=$key
EOF

cat >"$site/index.html" <<EOF
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>have-fish</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
  pre { background: #f2f2f2; padding: 0.75rem 1rem; overflow-x: auto; }
  @media (prefers-color-scheme: dark) {
    body { background: #1b1b1b; color: #e6e6e6; }
    pre { background: #2a2a2a; }
    a { color: #8ab4f8; }
  }
</style>
<h1>have-fish 有鱼</h1>
<p>Personal finance, kept on your own computer. For Linux, as a Flatpak:</p>
<pre>flatpak install --user $url/havefish.flatpakref</pre>
<p>It then updates with the rest of your Flatpaks. The source, and the plain binary, are on
<a href="https://github.com/lesterhan/have-fish">GitHub</a>.</p>
</html>
EOF

echo "published $(ostree refs --repo="$repo" | grep "^app/" | tr '\n' ' ')to $site"
