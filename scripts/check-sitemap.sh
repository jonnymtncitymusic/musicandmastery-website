#!/usr/bin/env bash
# Compare *.html files against sitemap.xml entries. Emits drift to stderr.
# Exit 0 = in sync, 1 = drift detected.
#
# Two kinds of page are legitimately absent from the sitemap:
#   * print-only assets (banner.html, flyer.html), which are not web pages at all;
#   * any page that declares `noindex`, because asking Google not to index a page and
#     then listing it in the sitemap are contradictory instructions.
#
# The noindex set is READ FROM THE PAGES rather than hardcoded. thank-you.html used to be
# named here by hand, and when drums-lessons-orange-county.html was retired on 2026-09-27
# this check started reporting drift on every run: a permanent false alarm is how a
# checker gets ignored, and then a real one goes unnoticed. Retiring a page is now one
# edit (add the meta tag) and this follows on its own.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITEMAP="$ROOT/sitemap.xml"
EXCLUDE_REGEX='^(banner|flyer)\.html$'

cd "$ROOT"

disk_pages=$(ls *.html | grep -Ev "$EXCLUDE_REGEX" | while read -r f; do
  grep -qiE '<meta[^>]+name="robots"[^>]*noindex' "$f" || echo "$f"
done | sort)
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
