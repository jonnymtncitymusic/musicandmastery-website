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
HOOK
chmod +x "$hook"
echo "installed: $hook"
