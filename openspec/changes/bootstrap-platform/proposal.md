# Bootstrap platform

## Why
The repo currently has no application code — only `docs/PRD v1.docx`, a `LICENSE`, and a link to the Vercel project `stepchange5`. Every later capability in `openspec.yaml` (household profile, secure uploads, home model, taste, room planning, visual concepts, product catalogue, budget, charity ledger) needs a working monorepo with a typed contract between the UI and the API before any of them can be built or reviewed in isolation.

## What changes
- Add a pnpm + Turborepo monorepo: `app/` (Next.js, mobile-first), `server/` (Hono API), `packages/shared/` (Zod schemas shared by both).
- Add a single `GET /health` endpoint in `server/`, validated against a shared schema, and render its status on the app's home page.
- Add root tooling: TypeScript strict config, Biome lint/format, Vitest.
- Update `docs/SETUP.md` with real install/run commands.

No product capability from the PRD is implemented yet — this only establishes the foundation the later changes build on.

## FR references
None directly — this is a platform/infrastructure change. It unblocks every capability in `/openspec.yaml`.

## Mobile-first / accessibility impact
The app shell is scaffolded mobile-first (reflows at 320px, no horizontal scroll) so every later screen inherits that baseline. No user-facing journey exists yet, so WCAG 2.2 AA content checks are not applicable to this change.

## Uploads impact
None. This change does not add any upload surface.
