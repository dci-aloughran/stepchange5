# Home Furnishing Planner (StepChange Team 5)

> **This is a time-bound hackathon project, not a production system.**
> It was built in a fixed, short time window to demonstrate a concept and a
> way of working. Expect rough edges, partial test coverage, thin error
> handling, and scope that stops where the clock did — see
> [docs/quality.md](docs/quality.md) for an honest, auto-generated look at
> current coverage and code structure. Do not deploy this for real users,
> store real personal data in it, or treat its output (including any
> AI-generated measurements or layouts) as accurate, compliant, or safe to
> act on.

## What this is

Help people see how a home could work for their real life before they spend
money furnishing it: upload a floor plan and some inspiration, get back a
feasible, visual, shoppable room plan. The product idea, roadmap, and
constraints are defined in the PRD and roadmap under `docs/` and
`openspec/`.

## How it was built

This project was built as a short, spec-driven sprint combining four roles —
Product Management (PRD), Tech (platform), Claude (tech stack selection and
implementation), and Design (Figma prototypes) — converging on one solution
under a hard time box, rather than a conventional multi-week engineering
effort. The full writeup, including diagrams of the stack and the
development process, lives in the team docs:

**→ [dci-aloughran.github.io/stepchange5](https://dci-aloughran.github.io/stepchange5/)**

Locally, the docs site source is under `docs/` (see
[docs/SETUP.md](docs/SETUP.md) for how to preview it).

## Repository layout

```
app/              Next.js app (App Router), Clerk auth
server/           Hono API, deployed as a Vercel Function
packages/shared/  Shared Zod schemas and types
e2e/              End-to-end tests
docs/             Team docs, published to GitHub Pages
openspec/         Spec-driven change proposals (proposal/design/tasks/specs)
```

## Getting started

See [docs/setup-repo.md](docs/setup-repo.md) for the fastest path to a
running app locally, and [docs/SETUP.md](docs/SETUP.md) for full environment
variable and deploy details.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## License

No license is granted for reuse. This repository exists to support a
specific hackathon submission and internal review; treat its contents as
all rights reserved unless you've been told otherwise by its authors.
