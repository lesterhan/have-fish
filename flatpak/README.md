# have-fish as a Flatpak

The desktop app, installed once and updated in place (#518). It is the same binary a release
publishes, on the freedesktop runtime, with one permission: the network, so the browser can
reach it on 127.0.0.1 and the opt-in exchange-rate lookup can reach its provider. The app never
checks for updates itself; `flatpak update` and your software centre do.

## Install

```sh
flatpak install --user https://lesterhan.github.io/have-fish/havefish.flatpakref
```

That adds the `havefish` remote, installs the app, and fetches the runtime from Flathub if it
is not there yet. have-fish is then in the applications menu. It opens your browser signed in,
a second launch opens another tab on the one already running, and the ✕ in its title bar quits
it. `flatpak update` brings the next release, and the next launch replaces an instance still
running the old one (#517).

Its data is in `~/.var/app/com.lesterhan.havefish/data/havefish`: the ledger, its `backups/`,
and `havefish.log`.

## Moving a ledger in

If you already use the plain binary, its ledger is in `~/.local/share/havefish`. Quit it with
the ✕ first, then let the Flatpak adopt the file:

```sh
flatpak run --filesystem=~/.local/share/havefish:ro com.lesterhan.havefish \
  --adopt ~/.local/share/havefish/havefish.sqlite
```

`--filesystem` lets that one run read the old folder, read-only; the next launch from the menu
cannot see it again. `--adopt` copies the ledger in, migrating it if it needs to, and keeps the
Flatpak's own empty ledger in `backups/` (#289). It refuses to replace a ledger that already
has transactions, so run it before you start entering them in the Flatpak.

Write the path as `~/.local/share/havefish`, not `xdg-data/havefish`. Flatpak also mounts an
`xdg-data/…` folder over the app's own data directory, so the app would try to run on the old
folder, read-only, and stop.

Then take the binary's menu entry out, or the menu shows two have-fish entries:

```sh
rm ~/.local/share/applications/havefish.desktop ~/.local/share/icons/hicolor/scalable/apps/havefish.svg
```

The old folder stays where it is until you delete it.

## Releasing

A `vX.Y.Z` tag runs `.github/workflows/release-desktop.yml`. For each architecture it builds the
binary, packages it with the manifest here, installs the bundle and runs `smoke.sh` against it.
Then it publishes the binaries as a GitHub Release, and `publish.sh` builds the repo:

- the bundles are imported into a fresh OSTree repo, signed with the key recorded in
  `have-fish-ops/process/credentials.md` (the `FLATPAK_GPG_PRIVATE_KEY` secret; the workflow
  pins its fingerprint);
- `havefish.flatpakref` and `havefish.flatpakrepo` carry the public half of the key;
- all of it is deployed to GitHub Pages.

The repo holds only the newest release. An installed copy updates from any older commit, so
nothing is lost but the option to roll back with `flatpak update --commit`.

The metainfo's version comes from the binary itself (`havefish --version`), so a tag needs no
edit here.

A pull request that touches this folder or the workflow runs the build and the smoke test, and
publishes nothing.

## Building it by hand

```sh
cd backend && bun run build:binary && cd ..
mkdir -p flatpak/build && cp backend/dist/havefish flatpak/build/havefish
flatpak-builder --user --install-deps-from=flathub --force-clean --install build-dir \
  flatpak/com.lesterhan.havefish.yml
flatpak run com.lesterhan.havefish
```

`--install` puts it in your user installation from a local remote, which `flatpak update` will
not update from the published repo; `flatpak uninstall --user com.lesterhan.havefish` before
installing the published one.

`smoke.sh` checks an installed copy the way CI does. It kills the app it starts, so it refuses
to run where a ledger already exists.

## Later

Flathub, which builds from source with no network; bun and `node_modules` need their own
answer first. The app ID is `com.lesterhan.havefish` for that reason: Flathub verifies it
through `lesterhan.com`.
