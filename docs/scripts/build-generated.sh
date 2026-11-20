#!/usr/bin/env bash
# Generates docs pages from sources that live outside docs/ (openspec.yaml,
# openspec/changes/**, docs/PRD v1.docx). Run before the Jekyll build.
# Output files are gitignored — they only exist in the build artifact.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
docs="$root/docs"
openspec_out="$docs/openspec"

# Only clear generated per-change subdirectories — docs/openspec/index.md is
# hand-authored and tracked in git, not generated.
mkdir -p "$openspec_out"
find "$openspec_out" -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +

# --- roadmap.md -------------------------------------------------------------

cat > "$docs/roadmap.md" <<'EOF'
---
title: Roadmap
parent: Roadmap & changes
nav_order: 1
---

# Roadmap

Generated from [`openspec.yaml`](https://github.com/dci-aloughran/stepchange5/blob/main/openspec.yaml),
the source of truth for the product roadmap.

```yaml
EOF
cat "$root/openspec.yaml" >> "$docs/roadmap.md"
printf '```\n' >> "$docs/roadmap.md"

# --- openspec/changes/<id>/ --------------------------------------------------

order=2
for change_dir in "$root"/openspec/changes/*/; do
  [ -d "$change_dir" ] || continue
  id="$(basename "$change_dir")"
  out_dir="$openspec_out/$id"
  mkdir -p "$out_dir"

  {
    echo "---"
    echo "title: $id"
    echo "parent: Roadmap & changes"
    echo "has_children: true"
    echo "nav_order: $order"
    echo "---"
    echo
    if [ -f "$change_dir/proposal.md" ]; then
      cat "$change_dir/proposal.md"
    else
      echo "# $id"
    fi
  } > "$out_dir/index.md"
  order=$((order + 1))

  sub_order=1
  if [ -f "$change_dir/design.md" ]; then
    {
      echo "---"
      echo "title: Design"
      echo "parent: $id"
      echo "grand_parent: Roadmap & changes"
      echo "nav_order: $sub_order"
      echo "---"
      echo
      cat "$change_dir/design.md"
    } > "$out_dir/design.md"
    sub_order=$((sub_order + 1))
  fi

  if [ -f "$change_dir/tasks.md" ]; then
    {
      echo "---"
      echo "title: Tasks"
      echo "parent: $id"
      echo "grand_parent: Roadmap & changes"
      echo "nav_order: $sub_order"
      echo "---"
      echo
      cat "$change_dir/tasks.md"
    } > "$out_dir/tasks.md"
    sub_order=$((sub_order + 1))
  fi

  if [ -d "$change_dir/specs" ]; then
    for spec_file in "$change_dir"/specs/*/spec.md; do
      [ -f "$spec_file" ] || continue
      spec_name="$(basename "$(dirname "$spec_file")")"
      {
        echo "---"
        echo "title: \"Spec: $spec_name\""
        echo "parent: $id"
        echo "grand_parent: Roadmap & changes"
        echo "nav_order: $sub_order"
        echo "---"
        echo
        cat "$spec_file"
      } > "$out_dir/spec-$spec_name.md"
      sub_order=$((sub_order + 1))
    done
  fi
done

# --- prd.md -------------------------------------------------------------

prd_src="$docs/PRD v2.docx"
prd_label="PRD v2.docx"
if [ ! -f "$prd_src" ]; then
  prd_src="$docs/PRD v1.docx"
  prd_label="PRD v1.docx"
fi

if [ -f "$prd_src" ]; then
  if ! command -v pandoc >/dev/null 2>&1; then
    echo "error: pandoc is required to generate docs/prd.md" >&2
    exit 1
  fi
  {
    echo "---"
    echo "title: PRD"
    echo "nav_order: 7"
    echo "---"
    echo
    echo "# PRD"
    echo
    prd_href="${prd_label// /%20}"
    echo "> Generated from [\`docs/$prd_label\`]($prd_href) via pandoc. The \`.docx\` is the source of truth."
    echo
    pandoc "$prd_src" -t gfm --wrap=none
  } > "$docs/prd.md"
fi
