#!/usr/bin/env bash
# Generates test coverage and code-structure reports for the docs site.
#
# Run after `pnpm install` and before the Jekyll build. Output lives under
# docs/coverage/ and docs/reports/ — both gitignored, regenerated fresh from
# the latest main on every Pages build.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
docs="$root/docs"

echo "==> Building packages/shared (dependency of app/server test runs)"
pnpm --filter @stepchange/shared build

echo "==> Running app test coverage"
pnpm --filter @stepchange/app test:coverage

echo "==> Running server test coverage"
pnpm --filter @stepchange/server test:coverage

echo "==> Publishing coverage reports"
rm -rf "$docs/coverage"
mkdir -p "$docs/coverage"
cp -r "$root/app/coverage" "$docs/coverage/app"
cp -r "$root/server/coverage" "$docs/coverage/server"

mkdir -p "$docs/reports"

echo "==> Building coverage summary table"
{
  echo "| Package | Statements | Branches | Functions | Lines |"
  echo "|---|---|---|---|---|"
  for pkg in app server; do
    summary="$docs/coverage/$pkg/coverage-summary.json"
    if [ -f "$summary" ]; then
      stmts=$(jq -r '.total.statements.pct' "$summary")
      branches=$(jq -r '.total.branches.pct' "$summary")
      funcs=$(jq -r '.total.functions.pct' "$summary")
      lines=$(jq -r '.total.lines.pct' "$summary")
      echo "| [\`$pkg\`](coverage/$pkg/) | ${stmts}% | ${branches}% | ${funcs}% | ${lines}% |"
    fi
  done
} > "$docs/reports/coverage-summary.md"

echo "==> Generating code-structure diagrams"
npx --yes madge --extensions ts,tsx --exclude '\.test\.' --image "$docs/reports/structure-app.svg" "$root/app/src"
npx --yes madge --extensions ts --exclude '\.test\.' --image "$docs/reports/structure-server.svg" "$root/server/src"
npx --yes madge --extensions ts --exclude '\.test\.' --image "$docs/reports/structure-shared.svg" "$root/packages/shared/src"

echo "==> Checking for circular dependencies"
circular_check() {
  npx --yes madge --no-color --no-spinner --circular --extensions "$1" "$2" 2>&1 \
    | sed -E 's/\x1b\[[0-9;]*m//g' \
    | grep -v -E '^(- Finding files|Processed )'
}
{
  echo "**\`app/src\`**"
  echo
  echo '```'
  circular_check ts,tsx "$root/app/src" || true
  echo '```'
  echo
  echo "**\`server/src\`**"
  echo
  echo '```'
  circular_check ts "$root/server/src" || true
  echo '```'
  echo
  echo "**\`packages/shared/src\`**"
  echo
  echo '```'
  circular_check ts "$root/packages/shared/src" || true
  echo '```'
} > "$docs/reports/circular-deps.md"

echo "==> Generating lines-of-code summary"
npx --yes cloc "$root/app/src" "$root/server/src" "$root/packages/shared/src" --md > "$docs/reports/cloc.md"

echo "==> Reports ready under docs/coverage/ and docs/reports/"
