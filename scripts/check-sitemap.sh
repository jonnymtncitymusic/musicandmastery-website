#!/usr/bin/env bash
# Compare *.html files against sitemap.xml entries. Emits drift to stderr.
# Exit 0 = in sync, 1 = drift detected.
# Excludes print-only assets (banner.html, flyer.html).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITEMAP="$ROOT/sitemap.xml"
EXCLUDE_REGEX='^(banner|flyer)\.html$'

cd "$ROOT"

disk_pages=$(ls *.html | grep -Ev "$EXCLUDE_REGEX" | sort)
sitemap_pages=$(grep -oE '<loc>[^<]+</loc>' "$SITEMAP" \
  | sed -E 's#<loc>https://[^/]+/##; s#</loc>##; s#^$#index.html#' \
  | sort)

missing_from_sitemap=$(comm -23 <(echo "$disk_pages") <(echo "$sitemap_pages") || true)
missing_from_disk=$(comm -13 <(echo "$disk_pages") <(echo "$sitemap_pages") || true)

drift=0
if [[ -n "$missing_from_sitemap" ]]; then
  echo "Pages on disk but missing from sitemap.xml:" >&2
  echo "$missing_from_sitemap" >&2
  drift=1
fi
if [[ -n "$missing_from_disk" ]]; then
  echo "Pages in sitemap.xml but missing from disk:" >&2
  echo "$missing_from_disk" >&2
  drift=1
fi

if [[ $drift -eq 0 ]]; then
  echo "Sitemap in sync ($(echo "$disk_pages" | wc -l | tr -d ' ') pages)"
fi
exit $drift
