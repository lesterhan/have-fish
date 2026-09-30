#!/usr/bin/env bash
# Starts the installed Flatpak the way the menu does and checks what #518 promises of it: it
# is the release it says, it keeps its ledger under ~/.var/app and writes no menu entry of its
# own, a second launch hands over to the first, and a crash inside the sandbox does not wedge
# the next launch (#516: every sandbox's app is pid 2, so a pid in the lock proves nothing).
#
#   flatpak/smoke.sh [expected version]
#
# CI runs it after installing the bundle. It kills the app it starts, so it refuses to run
# where a ledger already exists.

set -euo pipefail

app=com.lesterhan.havefish
data="$HOME/.var/app/$app/data/havefish"
lock="$data/havefish.lock"
out=$(mktemp -d)

if [ -e "$data/havefish.sqlite" ]; then
  echo "refusing: $data already holds a ledger, and this test kills the app it starts" >&2
  exit 1
fi

run() { flatpak run --env=HAVEFISH_NO_BROWSER=1 "$app" "$@"; }

fail() {
  echo "FAIL: $*" >&2
  for f in "$out"/*.out "$data/havefish.log"; do
    [ -f "$f" ] && { echo "--- $f" >&2; tail -n 40 "$f" >&2; }
  done
  exit 1
}

cleanup() {
  flatpak kill "$app" 2>/dev/null || true
  rm -rf "$out"
}
trap cleanup EXIT

# The launch key in the lock, once an instance has published one.
key_in_lock() { grep -o '"launchKey":"[^"]*"' "$lock" 2>/dev/null | cut -d'"' -f4; }
port_in_lock() { grep -o '"port":[0-9]*' "$lock" 2>/dev/null | cut -d: -f2; }

# Waits for an instance other than the one holding launch key $1 to publish and answer.
wait_for_instance() {
  local previous=${1:-} key port
  for _ in $(seq 120); do
    key=$(key_in_lock || true)
    port=$(port_in_lock || true)
    if [ -n "$key" ] && [ "$key" != "$previous" ] &&
      curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

echo "== the version"
version=$(run --version) || fail "--version did not run"
echo "$version"
if [ -n "${1:-}" ] && [ "$version" != "havefish $1" ]; then
  fail "expected havefish $1, got $version"
fi

echo "== the first launch starts"
run >"$out/first.out" 2>&1 &
first=$!
wait_for_instance || fail "the first launch never answered"
port=$(port_in_lock)
key=$(key_in_lock)
[ -f "$data/havefish.sqlite" ] || fail "no ledger in $data"
grep -q "Your ledger is in $data" "$out/first.out" || fail "it did not say where the ledger is"
grep -q "#token=" "$out/first.out" || fail "it printed no link to open"
entry="$HOME/.var/app/$app/data/applications/havefish.desktop"
[ ! -e "$entry" ] || fail "it wrote its own menu entry, $entry"
echo "running on $port"

echo "== a second launch hands over"
timeout 60 flatpak run --env=HAVEFISH_NO_BROWSER=1 "$app" >"$out/second.out" 2>&1 ||
  fail "the second launch did not exit cleanly"
grep -q "have-fish is running at http://127.0.0.1:$port" "$out/second.out" ||
  fail "the second launch did not hand over to $port"
[ "$(key_in_lock)" = "$key" ] || fail "the second launch took the lock"

echo "== a crash does not wedge the next launch"
flatpak kill "$app"
wait "$first" 2>/dev/null || true
[ "$(key_in_lock)" = "$key" ] || fail "the killed instance left no lock behind to test with"
run >"$out/third.out" 2>&1 &
wait_for_instance "$key" || fail "the launch after a crash did not take over"
grep -q "Open it with this link" "$out/third.out" ||
  fail "the launch after a crash handed over to a dead instance"
echo "took over on $(port_in_lock)"

echo "ok"
