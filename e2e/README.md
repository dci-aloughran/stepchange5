# End-to-end tests and live demo

Browser tests drive the real app in Google Chrome (installed locally; no
browser download) with a throwaway Clerk test user that is deleted, along
with all its data, when the run finishes.

Setup once: `pnpm install` at the repo root and `vercel env pull app/.env.local`
(the scripts read Clerk keys and the server URL from `app/.env.local`).

## Live demo

```bash
cd e2e
pnpm demo                         # visible Chrome, timed pauses (5s)
DEMO_MODE=manual pnpm demo        # presenter mode: press Enter to advance
DEMO_PAUSE=8 pnpm demo            # longer pauses
DEMO_SKIP_IMAGE=1 pnpm demo       # skip the AI room image (~1 min, costs credits)
E2E_APP=http://localhost:3000 pnpm demo   # against a local app
DEMO_HEADLESS=1 DEMO_SHOTS=1 DEMO_PAUSE=0.5 pnpm demo   # unattended rehearsal; saves what the audience sees at each pause to output/
```

The demo runs against https://stepchange5.vercel.app by default and walks the
whole journey with a caption bar: home → rooms + floor-plan upload →
household → accessibility → style + taste → keep → budget → review → plan →
brief → layout → room image → products → budget → privacy. It makes real AI
calls (floor plan, taste, brief, layout, image), so allow 4–6 minutes.

The view follows the action: each element is smoothly centred above the
caption bar before it's used, results scroll into view when AI steps finish,
and long sections (rooms, taste, review, brief, products, budget) are panned
through slowly during the pause. The run warns in the terminal if anything it
acted on wasn't fully on screen.

## Tests

```bash
cd e2e
pnpm journey                      # whole journey (headless)
E2E_APP=https://stepchange5.vercel.app pnpm journey
node --env-file=../app/.env.local rooms.e2e.mjs     # or taste/plan/account
```

Set `E2E_HEADED=1` to watch any test. Screenshots land in `e2e/output/`.
