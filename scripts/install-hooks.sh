#!/usr/bin/env bash
# Installs the repo's pre-commit checks into .git/hooks (which git does not track).
# Run once per clone: bash scripts/install-hooks.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
hook="$root/.git/hooks/pre-commit"
cat > "$hook" <<'HOOK'
#!/usr/bin/env bash
# Blocks any commit that puts an em dash into customer-facing copy.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
node "$root/scripts/check-em-dashes.mjs" || {
  echo ""
  echo "Commit blocked. Fix the copy above, or bypass deliberately with: git commit --no-verify"
  exit 1
}
# Added 2026-09-27. This script existed for weeks and nothing ever ran it, so sitemap drift
# was detected only by whoever happened to run it by hand, which was nobody.
bash "$root/scripts/check-sitemap.sh" || {
  echo ""
  echo "Commit blocked on sitemap drift. Fix it, or bypass deliberately with: git commit --no-verify"
  exit 1
}
# Added 2026-10-05. A file can be in git and still never reach the live site: .vercelignore
# kept the piano hero image off the CDN for a month while the ad landing pages used it.
node "$root/scripts/check-vercelignore.mjs" || {
  echo ""
  echo "Commit blocked: a referenced file is excluded from deploy. Fix .vercelignore, or bypass deliberately with: git commit --no-verify"
  exit 1
}
# Added 2026-10-23. There is no CI and Vercel deploys on push, so these only protect the live
# site if they run before the commit: a region-page edit without npm run build:city, or a paid
# keyword whose page stopped saying its words, would otherwise ship.
node "$root/scripts/build-city-pages.mjs" --check || {
  echo ""
  echo "Commit blocked: city pages are out of date. Run: npm run build:city (or bypass deliberately with: git commit --no-verify)"
  exit 1
}
node "$root/scripts/check-keyword-map.mjs" || {
  echo ""
  echo "Commit blocked: a paid keyword's landing page no longer says its words (data/keyword-map.json). Fix the copy, or bypass deliberately with: git commit --no-verify"
  exit 1
}
HOOK
chmod +x "$hook"
echo "installed: $hook"
