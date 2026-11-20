---
title: Quality reports
nav_order: 8
---

# Quality reports

Test coverage and code-structure reports, regenerated from the latest `main`
on every push, via `docs/scripts/build-reports.sh`. These are a snapshot of
the build that produced this page — not hand-maintained, so they can't drift.

## Test coverage

{% include_relative reports/coverage-summary.md %}

Full line-by-line HTML reports (via `vitest --coverage`, V8 provider):

- [`app` coverage](coverage/app/)
- [`server` coverage](coverage/server/)

## Code structure

Module dependency graphs, generated with [madge](https://github.com/pahen/madge).
Arrows point from a module to what it imports.

### `app/src`

![app dependency graph](reports/structure-app.svg)

### `server/src`

![server dependency graph](reports/structure-server.svg)

### `packages/shared/src`

![shared dependency graph](reports/structure-shared.svg)

## Circular dependencies

{% include_relative reports/circular-deps.md %}

## Lines of code

Counted with [cloc](https://github.com/AlDanial/cloc) across `app/src`,
`server/src` and `packages/shared/src` (tests excluded).

{% include_relative reports/cloc.md %}
