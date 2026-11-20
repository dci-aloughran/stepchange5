---
title: Home
layout: home
nav_order: 1
---

# Home Furnishing Planner — Team Docs
{: .fs-9 }

Help people see how a home could work for their real life before they spend money furnishing it.
{: .fs-6 .fw-300 }

This is internal engineering documentation for the project: how the monorepo is
put together, the product roadmap, and the source PRD. For the product itself,
see Vercel below — nothing here is part of the deployed app.

## Where things run

| | |
|---|---|
| **Product** (`app/`, `server/`) | Deployed on **Vercel** (project `stepchange5`) |
| **These docs** | Built from `docs/` by GitHub Actions and served on **GitHub Pages** |

## Sections

- [Getting started](setup-repo.md) — the fastest path to a running app on your machine.
- [Setup](SETUP.md) — full environment variables, Vercel link, and deploy details.
- [Collaboration](collaboration.md) — how a change gets proposed, reviewed and shipped here.
- [Architecture](architecture.md) — monorepo layout, the app/server contract, local dev.
- [Roadmap & changes](openspec/) — the product roadmap and OpenSpec change proposals.
- [PRD](prd.md) — the original product requirements document.
- [Quality reports](quality.md) — test coverage and code-structure reports, generated from the latest `main`.
- [Pitch deck](pitch/) — the under-6-minute pitch: problem, demo video, and how we built it.
