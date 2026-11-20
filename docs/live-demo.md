---
title: Live demo
nav_order: 9
---

# Live demo

The fastest way to see the product end to end isn't a slide — it's a scripted
browser run against the real, deployed app at
[stepchange5.vercel.app](https://stepchange5.vercel.app), driving every step
of the journey with a throwaway Clerk test user (deleted, with its data, when
the run finishes).

This is also what produced the 45-second clip embedded in the
[pitch deck](pitch/).

## Running it yourself

```bash
pnpm install                              # once, at the repo root
vercel env pull app/.env.local            # once, pulls Clerk keys + server URL

cd e2e
pnpm demo                                 # visible Chrome, timed pauses (5s)
DEMO_MODE=manual pnpm demo                # presenter mode: press Enter to advance
DEMO_SKIP_IMAGE=1 pnpm demo               # skip the AI room image (~1 min, costs credits)
E2E_APP=http://localhost:3000 pnpm demo   # against a local app instead of Vercel
```

It makes real AI calls (floor plan, taste, brief, layout, image) and walks the
whole journey with an on-screen caption bar: home → rooms + floor-plan upload
→ household → accessibility → style + taste → keep → budget → review → plan →
brief → layout → room image → products → budget → privacy. Allow 4–6 minutes.

## The underlying tests

The same journey also runs headless as part of the test suite:

```bash
cd e2e
pnpm journey                                          # whole journey, headless
E2E_APP=https://stepchange5.vercel.app pnpm journey   # against the live deploy
```

Full details — setup, individual test scripts, screenshots — live in
[`e2e/README.md`](https://github.com/dci-aloughran/stepchange5/blob/main/e2e/README.md)
in the repo.
