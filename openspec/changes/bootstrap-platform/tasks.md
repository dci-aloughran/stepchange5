# Tasks: bootstrap-platform

- [x] Root tooling: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`, `.nvmrc`, `.gitignore` updates.
- [x] `packages/shared`: `HealthResponseSchema` + type.
- [x] `server/`: Hono app with `GET /health`, dev entry, Vitest test, `.env.example`.
- [x] `app/`: Next.js scaffold, `hono/client` API lib, mobile-first home page showing server status, PWA manifest, `.env.example`.
- [x] `docs/SETUP.md` updated with real commands.
- [ ] Verify: `pnpm install && pnpm turbo run lint typecheck test build` all pass.
- [ ] Verify: `pnpm dev` — app shows "Server: ok"; stopping the server shows "Server: unreachable" without crashing.
- [ ] Verify: page reflows at a 320px-wide viewport with no horizontal scroll.
