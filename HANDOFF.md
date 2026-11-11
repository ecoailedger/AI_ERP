# HANDOFF — AI_ERP (2026-11-11 13:30)
**Goal:** An ERP shown as an isometric world, where the decisions people make (raising POs, entering orders) can later be replayed by an AI and compared.
**State:** working — runs on dummy data and on a real look-back (1 Oct to 10 Nov 2026) from the UK orders mirror.

## Done & verified
- Stage 1 world (map, lorries, stock, workers, record cards, figures, table view, time scrubber) — verified by `npm run check` (86 tests) and a browser check on dummy data
- Real-data ingest, read-only, cached locally (`ingest/`, milestone 2.1) — verified by loading `data/real/lookback` into the core and viewing it in a browser at ~120 fps
- 192-tile map: 64 ports, 8 depots, 100 villages placed by real location (postcode area) — verified by scene tests and a browser check
- Lorries spaced by days until due; orders over 90 days overdue are "stale", not "late" — verified by core and scene tests
- People as avatars with a 7.5 hour day, Purchasing office, People tab (2b.1, 2b.2) — verified by tests and a browser check on real data
- Page waits for the core to load instead of erroring — verified by `npm run check` only; the slow-start case was not re-tested in a browser

## In flight (exactly where work stopped)
- Nothing half-edited. Working tree clean, everything pushed to `origin/main`.
- Stage 1 exit test not run: 3 people must each name the late suppliers in 30 seconds. Needs people.
- 2b.1 exit test part met: hovering a buyer does not yet show stock and demand at the time of the PO.

## Do NOT (hard-won constraints)
- Never commit real data, `.env`, workspace or item ids, or screenshots of the real look-back. The repo is public. `data/real/` and `.env` are gitignored.
- Never write to Fabric or Strategix. `ingest/aierp_ingest/lake.py` has no write function: keep it that way.
- People are always shown by alias. Real user ids must not leave `snapshot.py`.
- No business logic in `packages/scene` or `apps/client`. ESLint blocks them importing `@ai-erp/core`.
- Do not guess column names: `docs/DATA-MAPPING.md` section 11 records what the mirror holds.
- Port 5180 belongs to another project (Pallas2-buyer). This project uses 5190 (client) and 5191 (API).
- Multi-line edits through bash heredocs fail in this shell when the text has quotes. Write a `.py` script file and run it.
- After changing `tools/dummygen`, run `npm run generate -w @ai-erp/dummygen` or a test fails.

## Key references
- Files: `packages/core/src/state.ts` (world state, queues, alerts), `packages/core/src/rules.ts` and `workload.ts` (thresholds, job times), `packages/scene/src/layout.ts` (map placement), `packages/scene/src/workers.ts` (avatars), `apps/client/src/world/WorldView.ts` (renderer), `ingest/aierp_ingest/snapshot.py` (mirror → canonical dataset)
- Docs: `docs/CONTEXT.md` section 13 (direction), `docs/BUILD-PLAN.md` (milestones, Stage 2b), `docs/DATA-MAPPING.md` section 11
- IDs: mirror workspace and item ids are in `.env` only (see `.env.example`). Fabric sign-in is a device code, cached by Windows.
- Run: `npm run dev` (dummy), `npm run dev:real` (real look-back), `cd ingest && python -m aierp_ingest.snapshot --start 2026-10-01` (rebuild; add `--refresh` to re-pull, `--real-names` for real supplier and customer names)

## Messages sent
| When | To | Channel | Gist | Awaiting reply? |
|---|---|---|---|---|
| — | — | — | None sent. The five data-team questions at the end of DATA-MAPPING section 11 are drafted but not sent | — |

## Next steps, in order
1. Get real times for raising a PO and entering a sales order; replace the assumed ones in `packages/core/src/workload.ts`.
2. Tell system and automated user ids apart from people (one id does ~50 hours of work a day).
3. Show what a buyer knew when raising a PO: stock, demand, on order.
4. 2b.3: simulation mode in the core (real demand and lead times, swappable purchasing policy).
5. 2b.4 and 2b.5: side-by-side comparison, then an AI purchasing policy held to the same 7.5 hour day.
6. Send the data team the five questions (goods received notes, stock movements, ledgers, intercompany flag, dead orders).
7. Ask the warehouse whether goods receipts are booked days after delivery (late lorries jump in the last days of the look-back).
8. Still open from Stage 2: daily snapshot schedule (2.2), reconciliation against Slipstream figures (2.3).

## Stakeholder summary
The proof of concept now shows Midwich UK's real October trading as a living map: suppliers, deliveries, stock, customers and the people raising and entering orders. Each person is held to a 7.5 hour day, which shows who is overloaded. Debtors, creditors and cash are simulated, the job times are assumptions, and nothing has yet been reconciled against trusted figures. The next step is replaying the same period with an AI making the purchasing decisions, to compare outcomes.
