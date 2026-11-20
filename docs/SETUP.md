# Setup

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Git](https://git-scm.com/)
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`

## Clone the repo

```bash
git clone https://github.com/dci-aloughran/stepchange5.git
cd stepchange5
```

## Install dependencies

```bash
npm install
```

> No `package.json` exists yet — this project has not been scaffolded. Once a framework is chosen, update this section with the actual install command.

## Environment variables

Environment variables are not committed (see `.gitignore`). Pull them from the linked Vercel project:

```bash
vercel link
vercel env pull .env.local
```

## Run locally

```bash
vercel dev
```

> Update this once a local dev script exists in `package.json`.

## Deploy

```bash
vercel deploy
```
