# Handoff

Updated 2026-11-11.

## State

Stage 1 is built: milestones 1.0 to 1.9 are done, 1.10 is half done.

- `npm run check` passes: lint, typecheck, 73 tests, client build.
- `npm run dev` starts the API (127.0.0.1:5191) and the world (http://localhost:5190).
- Checked in a browser: the map, late-lorry queue, workers, record cards, figure drill-down, table view and replay all work, with no console errors. Screenshots are in `docs/progress/`.

## What is left in Stage 1

1. **The people test (the Stage 1 exit test).** Show it to 3 people. Each should name the late suppliers within 30 seconds, unprompted. Not done: it needs people.
2. Frame rate has not been measured.
3. Art is code-drawn shapes. Decide whether hand-drawn pixel art is still wanted.
4. A static demo build (no API) for hosting. Not started.

## How it fits together

| Where | What |
|---|---|
| `packages/domain` | Canonical dataset schema (zod), world-state API types, date helpers |
| `packages/core` | `createCore(dataset)`: state for any date, exception rules, figures with their records, record cards, events |
| `packages/scene` | Layout (ports, villages, roads), vehicles per frame, workers and their schedules, A* |
| `apps/api` | Fastify over the core: `/master`, `/state`, `/events`, `/records/:type/:id`, `/figures/:name/records` |
| `apps/client` | PixiJS renderer (`world/`), React panels (`hud/`), app state (`store.ts`) |
| `tools/dummygen` | Seeded day-by-day business simulation that writes `data/dummy/` |

Rules the code enforces:

- The core never looks at facts dated after the state date, so replay cannot peek ahead.
- Every resource bar figure is the sum of its record rows. Tests check this for every day.
- ESLint stops the client and scene importing the core, and the core importing the game.
- `apps/api/src/world.test.ts` checks, for all 90 days, that what is drawn matches what the core reports.

## Notes

- Ports: client 5190, API 5191. Vite's 5173 and port 5180 are used by other projects on the dev machine.
- If `npm run dev` says a port is in use, an earlier run is still alive: stop the old `node` processes.
- After changing `tools/dummygen`, run `npm run generate -w @ai-erp/dummygen`. A test fails if `data/dummy` is out of date.
- Business thresholds (late, aged, stale) live in `packages/core/src/rules.ts`. Staffing levels live in `packages/scene/src/workers.ts`.
- `data/real/`, `.env*`, `*.parquet` and `*.sqlite` are gitignored. Dummy data only in this repo.

## Next

Run the people test. Then Stage 2, milestone **2.1**: the Python ingest adapters that map the UK orders mirror into the canonical dataset (docs/DATA-MAPPING.md, docs/BUILD-PLAN.md section 8). It needs Fabric sign-in, and the open questions in DATA-MAPPING section 10 answered for the unconfirmed columns.
