# Handoff

Updated 2026-11-11.

## State

- Milestone **1.0 (scaffold) done**. `npm run check` passes: lint, typecheck, 7 tests, client build.
- `npm run dev` starts the API (127.0.0.1:5180) and the client (http://localhost:5190). The client proxies `/api` to the API.
- The client shows a placeholder 12x12 iso grid and a HUD strip with the core health status. Not yet looked at in a browser by a person.

## Layout

- `packages/domain`: shared types. `packages/core`: business logic. `packages/scene`: iso maths, later world generation.
- `apps/api`: Fastify. `apps/client`: PixiJS + React. `tools/dummygen`: stub.
- Workspaces import each other's TypeScript source directly (`exports` points at `src/index.ts`). No build step for packages.
- ESLint enforces the layers: client and scene cannot import core; core cannot import the game.

## Notes

- Client port is 5190, not Vite's default 5173, because 5173 is often taken by other projects on the dev machine.
- `data/real/`, `.env*`, `*.parquet` and `*.sqlite` are gitignored. Dummy data only in this repo.
- npm reports esbuild's postinstall script as not approved. Everything works without it.

## Next

Milestone **1.1**: canonical entity types in `packages/domain` (field names from docs/DATA-MAPPING.md) and the seeded generator in `tools/dummygen`. Exit test: same seed gives the same files, and exception counts match the spec in docs/BUILD-PLAN.md section 8.
