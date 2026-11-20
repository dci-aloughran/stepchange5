# One-shot prompt to reach current state

Paste the block below into a fresh session on a clean checkout of `main`
(before PRs #3–#6). It's written as a single ask, with the gotchas we hit
already folded in as constraints, so a fresh agent doesn't have to
rediscover them.

---

> We need three things added to this repo's docs site (GitHub Pages, built
> from `docs/` via `.github/workflows/pages.yml`) and root README. Do all of
> it in one pass, as a single coherent change, then open a PR.
>
> **1. Publish test coverage and code-structure reports to GitHub Pages**
> - Add `docs/scripts/build-reports.sh`: builds `packages/shared` *first*
>   (its `exports.default` points at `dist/index.js`, which only exists after
>   a build — running `pnpm --filter <pkg> test` directly, instead of the
>   root `pnpm test` which goes through Turborepo's `dependsOn: ["^build"]`
>   graph, skips this and fails with "Failed to resolve entry for package
>   `@stepchange/shared`"), then runs `test:coverage` for `app` and `server`,
>   copies the HTML coverage reports into `docs/coverage/{app,server}/`,
>   extracts a summary table via `jq` into `docs/reports/coverage-summary.md`,
>   runs `madge` to generate dependency-graph SVGs
>   (`docs/reports/structure-{app,server,shared}.svg`) and a
>   `circular-deps.md` (strip ANSI codes from madge's output with
>   `sed -E 's/\x1b\[[0-9;]*m//g'` and filter noise lines like
>   `^(- Finding files|Processed )`), and a `cloc.md` line-count report.
> - Add `docs/quality.md` (Jekyll page, `nav_order: 8`) that embeds these via
>   `{% include_relative %}` and links to the coverage HTML.
> - Wire `build-reports.sh` into `.github/workflows/pages.yml` before the
>   Jekyll build step (needs pnpm/Node setup matching `.nvmrc` — Node 20
>   lacks `Map.groupBy`, used somewhere in the server tests — and
>   `apt-get install graphviz` for madge).
> - Add `/docs/reports/` to `.gitignore` (coverage/ is already covered by the
>   existing bare `coverage/` pattern).
> - Link the new page from `docs/index.md`'s Sections list.
>
> **2. Add a hackathon-context README**
> - Root `README.md`: explain this is a time-boxed hackathon project, not for
>   production use (warning blockquote up top), what it is, how it was built,
>   a link to the GitHub Pages docs site, repo layout, getting-started
>   commands, and a license/rights note.
>
> **3. Build a sub-6-minute pitch deck and publish it at `docs/pitch/`**
> - Use reveal.js, **vendored locally** (download the `dist/reveal.css`,
>   `dist/reveal.min.js`, and `plugin/notes/notes.min.js` from
>   `https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/...` into
>   `docs/assets/pitch/vendor/reveal/`) rather than loaded from a CDN, so it
>   presents offline. **The bare `dist/` line already in `.gitignore` will
>   silently swallow this vendored folder** — add an explicit negation
>   (`!/docs/assets/pitch/vendor/reveal/dist/`) and verify with
>   `git check-ignore -v` before committing.
> - 15 slides, structured so the **first half is the problem statement** and
>   the **second half is "the fun stuff"** (how we built it), with the
>   **45-second demo video embedded at the midpoint** as the pivot. Source
>   content from `openspec.yaml` (vision, core principle "function first,
>   then the pretty picture — recommend the requirement before we recommend
>   the product", the 4 hard constraints, 91 functional requirements) and
>   `docs/collaboration.md` (four roles: Product/Tech/Claude/Design; two
>   agent build waves: API then UI). Include per-slide `<aside class="notes">`
>   speaker notes with timing cues, targeting ~5:30–5:45 total runtime.
>   Find the demo video among the untracked `*.mp4` files at the repo root
>   (check `mdls -name kMDItemDurationSeconds -raw <file>` for ~45s — there
>   are several numbered takes, use the latest) and copy it to
>   `docs/assets/pitch/video.mp4`.
> - Style it with the app's actual Stone theme tokens, read from
>   `app/src/app/globals.css` (`--color-background: #111a16`,
>   `--color-foreground: #f2ede4`, `--color-card: #1c2722`,
>   `--color-accent: #8bc34a`, etc.; fonts Inter + DM Serif Display via
>   Google Fonts). Reuse `docs/assets/diagrams/{collaboration-convergence,
>   tech-stack}.svg` (already in the repo) and a handful of resized/compressed
>   screenshots from `docs/figmamake/*.png` (`sips --resampleWidth 420` then
>   `sips -s format jpeg -s formatOptions 75`) for a 5-step "journey strip".
> - **Critical CSS gotcha to get right the first time**: reveal.js's core
>   CSS does **not** set `html, body { height: 100% }` itself — without it,
>   the whole presentation canvas collapses to content size instead of
>   filling the viewport. Add that rule explicitly. Separately, reveal's own
>   `.reveal .slides > section.present { display: block }` rule has higher
>   specificity (0,3,1) than a naive `.reveal section { display: flex }`
>   override (0,1,1) meant to vertically center slide content — write the
>   centering rule as `.reveal .slides > section { display: flex !important;
>   ... }` so it actually wins. Verify by rendering with headless Chrome
>   (`google-chrome --headless --disable-gpu --screenshot=out.png
>   --window-size=1280,720 --virtual-time-budget=3000 file://...index.html`,
>   or `...index.html#/N` for slide N) and visually checking a few slides —
>   don't just validate the HTML statically.
> - Link it from `docs/index.md`'s Sections list.
>
> **4. Add a "live demo" docs page**
> - There's already an `e2e/README.md` documenting a scripted Playwright/
>   Chrome walkthrough (`cd e2e && pnpm demo`) that drives the real deployed
>   app at `stepchange5.vercel.app` with a throwaway Clerk test user — this
>   is what produced the pitch deck's video. Add `docs/live-demo.md`
>   (`nav_order: 9`) summarizing it and linking to it (note: `e2e/` is
>   outside the Jekyll build root, which is `./docs` per `pages.yml` — link
>   out to the GitHub blob URL for full details rather than trying to
>   include it). Link this page too from `docs/index.md`'s Sections list,
>   next to the pitch deck link.
>
> Work through all four in one sitting, commit as you go rather than in one
> giant commit at the end, and open a single PR (or logically-split PRs) at
> the end — check whether anything merged to `main` out from under you before
> pushing the final branch, since this review cycle can take a while.

---

**Current actual state** (for reference, not part of the prompt): all four
items are done and merged except the live-demo page, which is open as
[PR #6](https://github.com/dci-aloughran/stepchange5/pull/6)
(`docs-live-demo-link` → `main`). Reports/README landed via PR #3, the pitch
deck via PR #4, and a layout fix (missing `html,body` height +
`display:flex` specificity) via PR #5.
