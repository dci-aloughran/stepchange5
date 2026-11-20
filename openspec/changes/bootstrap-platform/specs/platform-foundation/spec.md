## ADDED Requirements

### Requirement: Server health endpoint
The server SHALL expose a `GET /health` endpoint that returns a JSON body conforming to the shared `HealthResponseSchema` (`status`, `service`, `version`, `time`).

#### Scenario: Health check succeeds
- **WHEN** a client sends `GET /health` to the server
- **THEN** the server responds with HTTP 200 and a body matching `HealthResponseSchema`, with `status` equal to `"ok"`

### Requirement: App reflects server status
The app's home page SHALL call the server's `/health` endpoint through the shared, type-safe client and display whether the server is reachable.

#### Scenario: Server is reachable
- **WHEN** the home page loads and the server responds to `/health` with `status: "ok"`
- **THEN** the page displays that the server is ok

#### Scenario: Server is unreachable
- **WHEN** the home page loads and the request to `/health` fails or times out
- **THEN** the page displays that the server is unreachable instead of crashing or showing an unhandled error

### Requirement: Shared typed contract
The app and server SHALL share request/response types through `packages/shared` and the server's exported Hono app type, without a manual codegen or duplication step.

#### Scenario: Type changes propagate
- **WHEN** the shape of `HealthResponseSchema` changes in `packages/shared`
- **THEN** a TypeScript build of `app/` fails if its usage of the health response is no longer compatible, without any manual sync step

### Requirement: Mobile-first baseline
The scaffolded app shell SHALL reflow to a 320 CSS-pixel-wide viewport without page-level horizontal scrolling.

#### Scenario: Narrow viewport
- **WHEN** the home page is rendered at a 320px-wide viewport
- **THEN** no horizontal scrollbar appears and all content remains readable

### Requirement: Workspace quality gates
The monorepo SHALL provide root-level `lint`, `typecheck`, `test` and `build` scripts that run across all workspaces via Turborepo and SHALL pass on a clean checkout.

#### Scenario: Clean checkout builds
- **WHEN** a contributor runs `pnpm install` followed by `pnpm turbo run lint typecheck test build` on a clean checkout
- **THEN** all four tasks complete successfully
