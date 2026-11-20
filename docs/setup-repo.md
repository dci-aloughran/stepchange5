---
title: Getting started
nav_order: 2
---

# Getting started

The fastest path to a running app on your machine.

## 1. Prerequisites

- [Node.js](https://nodejs.org/) 24+ (see `.nvmrc`)
- [pnpm](https://pnpm.io/) 12+: `corepack enable`
- [Git](https://git-scm.com/)

## 2. Clone and install

```bash
git clone https://github.com/dci-aloughran/stepchange5.git
cd stepchange5
pnpm install
```

## 3. Environment variables

```bash
cp app/.env.example app/.env.local
cp server/.env.example server/.env
```

The defaults point `app` at a `server` running on `http://localhost:8787`, so
this is enough to run locally — no real secrets needed yet.

## 4. Run it

```bash
pnpm dev
```

This starts `app` on `http://localhost:3000` and `server` on
`http://localhost:8787` together. The home page shows the server's `/health`
status — if it says "Server: ok", you're set up correctly.

## What's next

- [Setup](SETUP.md) — full environment variable, Vercel and deploy details.
- [Collaboration](collaboration.md) — how a change gets proposed, reviewed and shipped here.
- [Architecture](architecture.md) — how the monorepo fits together.
