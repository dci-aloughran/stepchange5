# Design: bootstrap-platform

## Layout
```
/
├─ app/                 Next.js App Router, TS, Tailwind — mobile-first PWA
├─ server/              Hono API, deployed as a Vercel Function
├─ packages/shared/     Zod schemas + types shared by app and server
├─ package.json         pnpm + turbo scripts: dev, build, lint, typecheck, test
├─ pnpm-workspace.yaml  app, server, packages/*
├─ turbo.json
├─ tsconfig.base.json
└─ biome.json
```

## Contract between app and server
`server/src/index.ts` exports the Hono app instance as default (Vercel zero-config Hono entry) and `export type AppType = typeof app`. `app/` imports that type only (devDependency on `server`, type-only) and calls `hc<AppType>(SERVER_URL)` from `hono/client`. This gives end-to-end type safety for routes and response shapes without a codegen step or a shared OpenAPI document.

`packages/shared` holds the `HealthResponseSchema` (Zod) so both sides validate the same shape: `{ status: "ok", service: string, version: string, time: string }`.

## Why Hono over a plain Next.js API route
`server/` is deployed independently so later capabilities (upload quarantine, sandboxed parsing, connectors) can scale, time out, and be secured separately from the UI, per the PRD's upload-security principle. Hono keeps this lightweight and portable (runs identically on Vercel Functions or `@hono/node-server` locally) rather than committing to a heavier framework before the domain is built out.

## Local dev
- `server`: `tsx watch src/dev.ts` on port 8787.
- `app`: `next dev` on port 3000, reading `SERVER_URL=http://localhost:8787`.
- Root `pnpm dev` runs both via Turborepo.

## What this does not decide yet
Database, auth, and storage choices are deferred to `household-and-budget` and `secure-upload-pipeline` respectively, per `/openspec.yaml`.
