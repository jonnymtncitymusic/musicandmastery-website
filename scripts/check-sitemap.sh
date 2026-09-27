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
# named here by hand, so retiring drums-lessons-orange-county.html on 2026-09-27 would have
# made this report drift forever: a permanent false alarm is how a checker gets ignored,
# and then a real one goes unnoticed. Retiring a page is now one edit, the meta tag, and
# this follows on its own.
#
# Until 2026-09-27 NOTHING RAN THIS SCRIPT. The pre-commit hook only checked em dashes and
# there is no CI, so "it reports drift" described a run nobody performed. It is now part of
# `npm test` and of the installed pre-commit hook.

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

# `|| true` is load-bearing: with `set -o pipefail`, a loop whose LAST iteration ends in a
# failing `grep -q` makes the whole pipeline exit 1, the assignment fails, and `set -e`
# kills the script before it prints anything. It exited 1 with no output, which reads as
# "drift detected" and says nothing about what.
noindexed=$(ls *.html | while read -r f; do
  grep -qiE '<meta[^>]+name="robots"[^>]*noindex' "$f" && echo "$f" || true
done | sort)

missing_from_sitemap=$(comm -23 <(echo "$disk_pages") <(echo "$sitemap_pages") || true)
# A noindexed page that is STILL listed is its own fault, not "missing from disk". The
# file is right there; the contradiction is that we ask Google to skip it and then
# advertise it. Reported separately so the message matches the actual problem.
noindexed_but_listed=$(comm -12 <(echo "$noindexed") <(echo "$sitemap_pages") || true)
missing_from_disk=$(comm -13 <(echo "$disk_pages") <(echo "$sitemap_pages") || true)
missing_from_disk=$(comm -23 <(echo "$missing_from_disk") <(echo "$noindexed") || true)

drift=0
if [[ -n "$missing_from_sitemap" ]]; then
  echo "Pages on disk but missing from sitemap.xml:" >&2
  echo "$missing_from_sitemap" >&2
  drift=1
fi
if [[ -n "$noindexed_but_listed" ]]; then
  echo "Pages that declare noindex but are still listed in sitemap.xml:" >&2
  echo "$noindexed_but_listed" >&2
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
