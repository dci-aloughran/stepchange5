# Setup

This is a pnpm + Turborepo monorepo:

- `app/` — Next.js (App Router), the mobile-first PWA.
- `server/` — Hono API.
- `packages/shared/` — Zod schemas and types shared by `app` and `server`.

See `openspec.yaml` for the product roadmap and `openspec/` for the detailed change specs.

## Prerequisites

- [Node.js](https://nodejs.org/) 24+ (see `.nvmrc`)
- [pnpm](https://pnpm.io/) 12+: `corepack enable` (or `npm i -g pnpm`)
- [Git](https://git-scm.com/)
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel` (for env pull and deploys)

## Clone the repo

```bash
git clone https://github.com/dci-aloughran/stepchange5.git
cd stepchange5
```

## Install dependencies

```bash
pnpm install
```

## Environment variables

Environment variables are not committed (see `.gitignore`). Each app has a `.env.example`:

```bash
cp app/.env.example app/.env.local
cp server/.env.example server/.env
```

Defaults point `app` at a `server` running on `http://localhost:8787`. To pull real values from the linked Vercel project instead:

```bash
vercel link
vercel env pull .env.local
```

## Run locally

```bash
pnpm dev
```

This runs `app` on `http://localhost:3000` and `server` on `http://localhost:8787` together via Turborepo. The home page shows the server's `/health` status.

## Lint, typecheck, test, build

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Deploy

```bash
vercel deploy
```
