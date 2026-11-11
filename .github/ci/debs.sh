#!/usr/bin/env bash
# The packages CI installs from apt, kept as .debs in a folder CI caches, so a mirror that's
# down fails only a run with nothing cached. A cache is good for one runner image: the folder
# holds what that image lacks, so a newer image must not install it.
#
#   debs.sh fetch <folder> <package>...    download what this machine lacks, retrying
#   debs.sh install <folder> <package>...  install from the folder alone, then check each one

set -euo pipefail

command=$1
folder=$2
shift 2

fetch() {
  mkdir -p "$folder/partial"
  for attempt in 1 2 3; do
    # A failed index fetch is only a warning to apt, so the download is what's checked.
    if sudo apt-get update -q &&
      sudo apt-get install -y -q --no-install-recommends --download-only \
        -o Dir::Cache::Archives="$folder" "$@"; then
      sudo rm -rf "$folder/partial" "$folder/lock"
      sudo chown -R "$(id -u):$(id -g)" "$folder"
      return 0
    fi
    if [ "$attempt" -lt 3 ]; then
      echo "debs: attempt $attempt failed, trying again in $((attempt * 60)) s" >&2
      sleep $((attempt * 60))
    fi
  done
  echo "debs: no mirror answered after 3 attempts" >&2
  return 1
}

install() {
  shopt -s nullglob
  local debs=("$folder"/*.deb)
  # None when the image already has them all.
  if [ ${#debs[@]} -gt 0 ]; then sudo dpkg -i "${debs[@]}"; fi
  for package in "$@"; do
    if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      echo "debs: $package is not installed; is $folder from another image?" >&2
      return 1
    fi
  done
}

case $command in
  fetch) fetch "$@" ;;
  install) install "$@" ;;
  *) echo "usage: debs.sh fetch|install <folder> <package>..." >&2; exit 1 ;;
esac
