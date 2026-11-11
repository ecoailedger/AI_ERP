# Handoff

Updated 2026-11-11.

## State

- **Stage 1 is built.** Milestones 1.0 to 1.9 done, 1.10 half done (the people test is outstanding).
- **People are in.** Each buyer and salesperson on the orders is an avatar with a 7.5 hour day (Stage 2b, milestones 2b.1 and 2b.2).
- **Stage 2 has started.** The world runs on a real look-back from the UK orders mirror: 1 October to 10 November 2026. Milestone 2.1 is done, 2.2 is half done, 2.3 and 2.4 are not started.
- `npm run check` passes: lint, typecheck, 86 tests, client build.

## Run it

| Command | What you get |
|---|---|
| `npm run dev` | Dummy data. World on http://localhost:5190, API on 127.0.0.1:5191 |
| `npm run dev:real` | The real look-back in `data/real/lookback/`. Same ports |
| `cd ingest && python -m aierp_ingest.snapshot --start 2026-10-01` | Rebuilds the look-back. Uses the cache unless `--refresh` is passed |

To run both at once, give the second copy other ports: `PORT=5193 AI_ERP_CLIENT_PORT=5192 npm run dev:real`.

The real look-back on this machine was built with `--real-names`. Do not commit or share screenshots of it.

## What is left

Stage 1:

1. The people test: 3 people, each names the late suppliers in 30 seconds, unprompted.
2. Decide whether hand-drawn pixel art is still wanted.
3. A static demo build for hosting.

Stage 2b (decisions, see CONTEXT section 13):

1. **Job times are assumptions.** `packages/core/src/workload.ts` sets how long raising a PO and entering an order take. Get timed figures.
2. Tell system and automated user ids apart from people. Some do several days of work in a day.
3. Show what a buyer knew when they raised a PO: stock, demand, what was on order.
4. 2b.3 to 2b.5: simulation mode, side-by-side comparison, an AI purchasing policy. Not started.

Stage 2:

1. Late lorries on real data jump in the last few days of the look-back. Likely goods receipts booked a few days after delivery. Ask the warehouse.
2. **2.2 daily snapshot.** Nothing runs the ingest each day, so real history is not building up. Each run today rebuilds the past from the current position.
3. **2.3 reconciliation.** Compare the world's totals for a date with the Slipstream figures. Not started. Nothing in the real look-back has been checked against a trusted figure yet.
4. **2.4 fog rules on real data.** Only negative rebuilt stock and undated orders fog today.
5. Send the data team the five questions at the end of DATA-MAPPING section 11.
6. State responses are 2 to 3 MB a day on real data. Fine locally; trim before hosting.

## How it fits together

| Where | What |
|---|---|
| `packages/domain` | Canonical dataset schema (zod), world-state API types, date helpers |
| `packages/core` | `createCore(dataset)`: state for any date, exception rules, figures with their records, record cards, events |
| `packages/scene` | Layout (ports, depots, villages, roads), vehicles per frame, workers and their schedules, A* |
| `apps/api` | Fastify over the core. `AI_ERP_DATA_DIR` picks the dataset |
| `apps/client` | PixiJS renderer (`world/`), React panels (`hud/`), app state (`store.ts`) |
| `tools/dummygen` | Seeded business simulation that writes `data/dummy/` |
| `ingest` | Python. Read-only pulls from the mirror, cached, mapped to the canonical dataset |

Rules the code enforces:

- The core never looks at facts dated after the state date.
- Every resource bar figure is the sum of its record rows. Tests check this for every day.
- ESLint stops the client and scene importing the core, and the core importing the game.
- `apps/api/src/world.test.ts` checks, for all 90 dummy days, that what is drawn matches what the core reports.
- `ingest` has no write function. Real data, `.env` and the cache are gitignored.

## Notes

- Fabric sign-in is a device code, cached by Windows. `.env` points at a sign-in shared with other projects on this machine.
- Workspace and item ids live in `.env` only. The repo is public: keep them out.
- If `npm run dev` says a port is in use, an earlier run is still alive.
- After changing `tools/dummygen`, run `npm run generate -w @ai-erp/dummygen`. A test fails if `data/dummy` is out of date.
- Business thresholds live in `packages/core/src/rules.ts`. Staffing lives in `packages/scene/src/workers.ts` and scales with `master.typicalQueue`.
