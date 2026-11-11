# Build plan: AI_ERP

This is the full build, from the small sim people up to the overview map and down to the Fabric connection. Read [CONTEXT.md](CONTEXT.md) and [DATA-MAPPING.md](DATA-MAPPING.md) first.

It is written for whoever picks up the work next, human or AI agent. Work one milestone per session and tick it off here.

---

## 0. Decisions this plan makes

These close the open decisions in PID §12 and CONTEXT §12. Once they are agreed, copy them into the CONTEXT decision log.

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere, except ingest | One language across core, API and client |
| Ingest | Python 3.12 + `deltalake` + `azure-identity` | Reuses the proven, read-only OneLake read pattern from other Midwich projects |
| Renderer | PixiJS v8 (WebGL) | Fast 2D sprites, handles thousands of units, and we own the sim loop |
| HUD and panels | React + Vite, layered over the canvas | Standard UI for cards, tables and the scrubber |
| Core and API | Node + Fastify + SQLite (`better-sqlite3`) | Event log and sandbox ledger in one local file. No server to run |
| Monorepo | npm workspaces | No extra tooling on a locked-down laptop |
| Tests | Vitest | |
| Hosting | Stage 1 is a static build (dummy data only, so it can be public). Stage 2+ is **local only** | Real data never goes onto a public host |
| Advisor | Claude via the Anthropic API. Pick the model at Stage 4 | |
| Sim people | Yes, as **workers that carry real tasks**, not decoration (see §3) | Fits principle 1: if it is on the map, a record put it there |

The CONTEXT decision log chose "map-and-units over people-in-rooms". Workers walking between buildings outdoors are units, so this still holds. There are no room interiors.

---

## 1. The experience, top down

Four zoom levels, one continuous camera.

| Level | What you see | Answers |
|---|---|---|
| **L0 Overview map** | Supplier ports on the map edges, roads, the settlement in the centre, customer villages around it. Lorries and vans moving. The late-lorry queue | "What is moving, what is stuck, who is late?" |
| **L1 Settlement** | Buildings (goods-in, warehouse, sales office, accounts, dispatch), the goods-in dock, stockpile yard, workers | "Where is work piling up?" |
| **L2 Building** | Selecting a building opens its **queue panel**: a plain table of the records it holds, with filters | "Which exact records?" |
| **L3 Record card** | Clicking any lorry, van, pallet, stockpile, village or worker shows the record(s) behind it, with source IDs | "Prove it." (principle 4) |

Always on screen:

- **Resource bar** (top): stock value, debtors, open SOs, open POs, creditors, cash. Each figure clicks through to its records.
- **Alerts** (right): exceptions, newest first. Clicking one flies the camera to it.
- **Time scrubber** (bottom): live, or replay any date.
- **Table view toggle**: the same data as plain tables. This is the "serious summary" from PID risk 1.
- **Advisor** (Stage 4): a narration panel.

---

## 2. World generation (data draws the world)

The layout is generated deterministically from data:

- Same inputs → same map.
- A new record slots in without reshuffling everything else.

| Element | Placement rule |
|---|---|
| Map | Iso grid with 2:1 tiles (64×32 px). 192×192 tiles |
| Settlement | Fixed footprint at the centre. Building positions are fixed by design, not by data |
| Supplier ports | On a ring near the map edge. Angle = stable hash of supplier code. The biggest 64 get a port; the rest share 8 depots |
| Customer villages | Where the customer really is: compass direction from the site, and further out the further away (distance compressed). Size = trailing revenue. The top 100 get a village; the rest share a hamlet with others in the same direction. With no locations, bigger customers sit closer in |
| Roads | Auto-routed from each port and village to the settlement gate (A* on the grid, then smoothed). Shared trunk roads are merged |
| Stockpile yard | One plot per product category. Pile height = stock value. Plots ordered by value |
| Fog | Tiles tied to untrusted data are darkened (rules in DATA-MAPPING §7) |

"Stable hash" means an angle (or slot) derived from the ID, so a supplier always sits in the same place.

Placement collisions are resolved by nudging to the next free slot. Never move an existing entity.

---

## 3. The sim people (workers)

### Rule

Every worker is doing a job that a record created. Hovering over a worker shows the job, e.g. "Unloading PO 104233, line 2". With no work, a building's workers go idle and then go home. **A busy building looks busy because it is.**

These are role figures, not models of real staff. No real names, and no staff data.

### Roles

| Role | Lives at | Jobs (from records) |
|---|---|---|
| Goods-in hand | Goods-in | Unload a lorry → pallets on the dock. Count a delivery |
| Warehouse hand | Warehouse | Put away: dock → stockpile. Pick: stockpile → dispatch |
| Dispatch hand | Dispatch | Load a van for a shipped order |
| Sales clerk | Sales office | New sales order arrives (paper icon appears). Allocate |
| Accounts clerk | Accounts | Bill arrives, match, pay. Chase overdue debtors (walks to the gate) |
| Drivers | Vehicles | Implicit in lorries and vans. Not separate walking figures |

### Headcount

Workers per building = `clamp(ceil(open_tasks / tasks_per_worker), 0, max_slots)`. The overflow becomes a visible **backlog pile** at the door. So understaffing (work exceeding capacity) is itself a "stuck" signal.

### Behaviour

- **State machine per worker:** `idle → walk_to(task.from) → work(duration) → carry → walk_to(task.to) → drop → next task | idle`.
- **Task queue per building:** the client derives it from core world state. The client only *animates* it: it never decides a business outcome (principle 5).
- **Pathfinding:** A* over a walkability grid of the settlement. Paths are cached per (from, to) pair.
- **Determinism:** each task's timing jitter is seeded from its record ID, so a replay looks identical every time.
- **Animation:** 4 directions × idle / walk / carry / work, 4–6 frames each. One body sprite with a palette swap per role.

### Performance

- Cap about 150 visible workers.
- Beyond that, buildings show a crowd count badge instead of more figures.

---

## 4. Vehicles and flows

| Thing | Rule |
|---|---|
| **Lorry** (one per open PO; a supplier's POs due the same day form a convoy with a count badge) | Spaced by delivery date: distance from the gate = days until due, out of a 28-day horizon |
| **Late lorry** | Past due and still open → parks in the **stalled queue** outside the gate, nose-to-tail, oldest first. Colour deepens with days late |
| **Arrival** | When a receipt is recorded (`POIT_LASTDEL`), the lorry reaches the dock and unloads pallets (goods-in workers take over) |
| **Van** | One per shipped sales order (or a convoy per village per day). Drives from dispatch to the village |
| **Money cart** | Customer payment returns from the village to accounts. Simulated until ledger data exists |
| **Bill** | A purchase invoice arrives at accounts as a letter. Simulated |

---

## 5. Stuck things look stuck

| Exception (computed in core) | Visual |
|---|---|
| PO past due | Lorry in the stalled queue. Red tint deepens with days late |
| PO unacknowledged | Lorry greyed, still at the port |
| Pallets on the dock more than 1 day | Pallets gather dust and a tarp. Worker shrug icon |
| Stock aged over 180 / 365 / 730 days | Stockpile weathers in three steps: dust, weeds, moss |
| Negative or untrusted stock | Fog over the plot |
| Sales line back-ordered | Paper on the sales office board turns red. Ghost box waits at dispatch |
| Order past committed date | Van stays parked at dispatch with a warning flag |
| Customer on stop | Village gate closes, with a barrier |
| Customer over credit limit | Village banner turns amber |
| Building backlog over capacity | Backlog pile at the door grows |

---

## 6. Time

- **World clock:** live mode follows today. The scrubber can jump to any date in range.
- **Replay:** the core serves `state at t`. Between daily snapshots, the client interpolates positions. Events (receipts, invoices) happen at their recorded timestamps, or at a seeded time of day where only a date is known.
- **Speed control:** 1 day = 10 s up to 1 day = 1 s.
- **History beyond what we hold:** fog over the whole map, shading with confidence (DATA-MAPPING §6).

---

## 7. Architecture and repository layout

```
AI_ERP/
  packages/
    domain/        canonical entity types + zod schemas (DATA-MAPPING field names)
    core/          state machines, exceptions, projections (state at t), sandbox ledger, event log
    scene/         world-state → scene description: layout, placement, task queues. Pure, no rendering
  apps/
    api/           Fastify: serves core over HTTP + WebSocket
    client/        PixiJS world + React HUD
  ingest/          Python: Fabric (read-only) → canonical snapshot files. Stage 2
  tools/
    dummygen/      dummy data generator (seeded)
  data/
    dummy/         committed dummy dataset (safe, synthetic)
    real/          GITIGNORED. Real snapshots live here and never get committed
  art/             original source art (.aseprite / .svg) + exported atlases
  docs/
```

Rules:

- `core` imports nothing from `scene` or `client`. The core does not know about the game.
- `scene` and `client` never compute a business outcome (late, aged, balance). They read flags from core.
- `data/real/` and `.env*` sit in `.gitignore` from the first commit.

### API (core)

| Endpoint | Returns |
|---|---|
| `GET /state?at=YYYY-MM-DD` | World state: entities, exception flags, resource bar figures |
| `GET /events?from=&to=` | Event log slice (drives the replay) |
| `GET /records/:type/:id` | One record with source references (record cards) |
| `GET /figures/:name/records` | The records behind a resource bar figure |
| `WS /live` | Push of new events |
| `POST /actions/:type` | Stage 3: a game action → one audited event |

### Core domain

**PO state machine:** `raised → acknowledged → in_transit → partly_received → received → invoiced → matched → paid`, with `late` as a flag, not a state.

**SO state machine:** `entered → allocated | back_ordered → picked → shipped → invoiced → paid`.

**Stock:** movements (`receipt, putaway, pick, adjust, count_variance, damage, return`) against product × location. On-hand = Σ movements.

**Ledger** (sandbox, double entry):

| Event | Debit | Credit |
|---|---|---|
| Receipt | Stock | GRNI (goods received, not invoiced) |
| Purchase invoice | GRNI | Creditors |
| Pay supplier | Creditors | Cash |
| Ship | Cost of sales | Stock |
| Sales invoice | Debtors | Sales |
| Customer payment | Cash | Debtors |

**Event log:** append-only. Each event records `id, ts, type, actor, payload, source_refs[]`. Imported Fabric facts are events too, with `actor = ingest`.

---

## 8. Data connections

### Stage 1: dummy

`tools/dummygen` writes about 90 days of canonical data:

- 25 suppliers, 120 customers, 600 products in 12 categories.
- About 400 POs and 3,000 SOs, with invoices.
- Exceptions seeded on purpose: 10% late POs, aged stock, 3 customers on stop, 1 negative stock row.

Names come from an original word generator ("Brindlecombe Audio Ltd"). No real names.

### Stage 2: Fabric (read-only)

1. `ingest/` reads the UK orders mirror over OneLake with `deltalake`. Device-code sign-in, so no app registration is needed. Tables and columns as in DATA-MAPPING.
2. One adapter function per canonical entity. Only the adapter knows `Stx*` names.
3. Writes `data/real/snapshot-YYYY-MM-DD/*.parquet` (gitignored). The core loads snapshots the same way it loads dummy data.
4. **Daily snapshot:** run once a day (Task Scheduler on the laptop to start). This builds the history the mirror lacks.
5. Supplier and customer names in real mode use **aliases** by default. Real names only appear behind an explicit local toggle.
6. **Reconciliation test** (the Stage 2 exit test): for a given date, these totals must match the Slipstream figures:
   - open PO count and quantity
   - late PO count
   - stock units and value
   - open SO value
   - debtors

   A mismatch fails the run and fogs the affected area.
7. Fog rules from DATA-MAPPING §7 are applied in core.

### Later sources

These depend on the data-team questions in DATA-MAPPING §10:

- supplier master
- goods-received notes (`pogrn`)
- stock movements (`stmove`)
- purchase and sales ledgers

Each new source replaces a simulated piece and removes fog.

---

## 9. Advisor (Stage 4)

- **Input:** a compact world summary (resource bar figures, top exceptions, deltas since yesterday), with record IDs.
- **Output contract:** JSON statements, each with `text` and `record_refs[]`.
- **Validator:** drops any statement with no refs, or refs that do not resolve. This is what keeps it grounded (CONTEXT §6).
- **Display:** a narration panel. Clicking a statement flies the camera to its records.
- **Data:** only aliased summaries are sent in real-data mode, unless approved otherwise.

---

## 10. Art and audio

- **Style:** isometric management sim. Clean, warm, readable at a glance. **Original art only.** Do not reference or imitate any specific published game in briefs, prompts or file names.
- **Grid:** 2:1 iso, 64×32 tiles. The palette is fixed in `apps/client/src/world/palette.ts`.
- **Stage 1 art set** (fixed, so art doesn't eat the effort):
  - Terrain: grass, road (straight, corner, T, cross), dock, yard.
  - Five buildings, a port, and a village in three sizes.
  - Lorry and van (4 directions), pallets, and stockpile tiers (3 sizes × 3 ageing states).
  - Worker base sprite (4 directions × 4 animations), role palette swaps.
  - UI icons.
- **Route:** first pass is programmatic placeholders (Pixi Graphics). Then hand-drawn pixel art in Aseprite, packed into one atlas. AI-generated drafts are allowed only as rough references that get redrawn.
- **Audio:** after Stage 3. Ambient yard noise, lorry horns for arrivals, a till for payments.

---

## 11. Milestones

Estimates are hours of focused build time with an AI agent. One milestone ≈ one session.

### Stage 1: Living world, dummy data (~35 h)

| # | Milestone | Est. | Exit test |
|---|---|---|---|
| 1.0 ✅ | Scaffold: workspaces, Vite, TS strict, Vitest, lint, `.gitignore` (incl. `data/real`, `.env*`), CI build | 1 h | `npm test` and `npm run dev` both work |
| 1.1 ✅ | `domain` types + `dummygen` with seeded exceptions | 3 h | Same seed → same files. Exception counts match the spec |
| 1.2 ✅ | `core`: load, project state at t, exception flags, resource figures | 4 h | Unit tests: late POs, aged stock and figures computed correctly |
| 1.3 ✅ | `api`: `/state`, `/records`, `/figures`, `/events` | 2 h | Each endpoint returns valid schema |
| 1.4 ✅ | Renderer base: iso grid, camera pan/zoom, tile picking, placeholder art | 4 h | 160×160 map at 60 fps. Clicking a tile shows its coordinates |
| 1.5 ✅ | `scene` world gen: ports, villages, roads, buildings, stockpiles | 4 h | Layout stable across reloads. Adding a supplier moves nothing else |
| 1.6 ✅ | Vehicles: lorries on roads, stalled queue, vans | 3 h | Late POs visibly queued. Counts match core |
| 1.7 ✅ | Workers: task queues, state machine, A*, animation, backlog piles | 5 h | Hovering a worker shows its record. Idle buildings are empty |
| 1.8 ✅ | HUD: resource bar, alerts, record cards, building queue panel, table view | 4 h | Every figure clicks through to records |
| 1.9 ✅ | Time scrubber + replay | 3 h | Scrub 90 days. Replay is identical twice |
| 1.10 ◐ | Stage 1 art pass (fixed set) + polish | 4 h | Shown to 3 people: each names the late suppliers in 30 s, unprompted (PID exit test) |

Stage 1 notes (2026-11-11):

- ✅ means built and its exit test met by automated tests or a browser check. See `docs/progress/` for screenshots.
- **1.10 is half done (◐).** The art set is built, drawn in code as isometric shapes. Still to do: show it to 3 people and time whether each names the late suppliers in 30 seconds. Hand-drawn pixel art has not been started; the code-drawn art may be good enough to skip it.
- The map is 128×128 tiles, not 160×160. Ports sit on a ring 56 tiles out, which is as far as the layout needs.
- Frame rate (1.4) was not measured. It ran smoothly in a browser check; nobody has profiled it.
- Stage 1 runs against the local API, not as a static build. A static demo build is still open.

### Stage 2: Real data (~12 h)

| # | Milestone | Est. | Exit test |
|---|---|---|---|
| 2.1 ✅ | `ingest` adapters (PO, SO, invoice, stock, product, customer) | 5 h | Snapshot validates against the domain schema |
| 2.2 ◐ | Daily snapshot schedule + aliasing | 2 h | 3 consecutive daily snapshots on disk. No real names shown by default |
| 2.3 | Reconciliation test vs Slipstream figures | 3 h | All totals match for one date (PID exit test) |
| 2.4 | Fog rules on real data | 2 h | Each fog area links to the rule that triggered it |

Stage 2 notes (2026-11-11):

- **2.1 is done as a look-back.** `python -m aierp_ingest.snapshot --start 2026-10-01` pulls from the mirror, caches the pulls, and writes a canonical dataset to `data/real/lookback/`. `npm run dev:real` runs the world on it. See `ingest/README.md`.
- The snapshot is JSON in the same shape as `data/dummy`, not parquet. The raw pulls are cached as parquet.
- **2.2 is half done (◐).** Aliasing is built and is the default. The daily schedule is not set up: nothing runs the ingest each day yet, so real history is not accumulating.
- **2.3 and 2.4 are not started.** Nothing has been reconciled against Slipstream figures. Fog on real data covers negative rebuilt stock and orders with no due date only.
- The world now sizes itself to the business: suppliers beyond the biggest 34 share six depots, and worker capacity scales with each building's usual queue.
- What the mirror turned out to hold is in DATA-MAPPING section 11.

- The map is now 192×192 tiles: 64 supplier ports, 8 shared depots, 100 customer villages.
- Customers sit where they really are relative to the site. Lorries are spaced by days until due.
- Orders more than 90 days overdue are "stale" and kept out of the late queue.

### Stage 2b: Decisions (new, 2026-11-11)

The direction changed: see CONTEXT section 13. Before the play loops, make decisions visible and comparable.

| # | Milestone | Exit test |
|---|---|---|
| 2b.1 ✅ | Purchasing building and buyers: each PO raised is a visible act by a role | Hovering a buyer shows the PO being raised and what stock and demand looked like |
| 2b.2 ✅ | Pull who raised each order from the feed, shown by alias | The table view lists each person's orders and hours for the day |
| 2b.3 | Simulation mode in the core: real demand and lead times, a swappable purchasing policy | The same period replays under a simple rule-based policy, deterministically |
| 2b.4 | Side-by-side comparison of two runs | Stock value, stock-outs and late customer orders shown for actual versus simulated |
| 2b.5 | An AI purchasing policy | Its run can be compared with the actual one, with every PO it raised traceable to its reasons |

Stage 2b notes (2026-11-11):

- Each person with orders on the day is an avatar. Hovering shows their hours against a 7.5 hour day; clicking opens their orders.
- Work that does not fit in the day is flagged on the person and piled at the office door.
- **The job times are assumptions**, set in `packages/core/src/workload.ts`: 20 minutes plus 6 a line to raise a PO, 15 plus 5 a line to enter a sales order. Nobody has timed these.
- 2b.1's exit test is only part met: hovering a buyer shows the PO and their hours, but not yet what stock and demand looked like when they raised it.
- Not yet told apart: user ids that are systems or automated feeds rather than people.

### Stage 3: Play (~20 h)

| # | Milestone | Est. |
|---|---|---|
| 3.1 | Actions and state machines in core: raise PO, receive, count, put away | 5 h |
| 3.2 | Allocate, pick, ship, sales invoice | 5 h |
| 3.3 | Purchase invoice, match, pay supplier, customer payment | 4 h |
| 3.4 | Sandbox ledger + trial balance check (Σ debits = Σ credits after every action) | 3 h |
| 3.5 | In-world interactions (drag a lorry to the dock, click a pile to count) + undo-free audit | 3 h |

Exit: a new user completes purchase-to-pay and order-to-cash without instruction.

### Stage 4: Advisor (~7 h)

Build the summary builder, prompt, validator and narration panel.

Exit: 20 sampled statements, all traceable to records.

### Stage 5: Review

A demo and a go / change / stop decision.

---

## 12. Testing

- **Core:** unit tests for every state machine transition, exception rule and figure.
- **Ledger:** property test. Any random sequence of valid actions keeps the trial balance at zero.
- **Scene:** snapshot tests on layout (stable placement).
- **Ingest:** schema validation + the reconciliation test.
- **Visual:** a screenshot per milestone in `docs/progress/`. Dummy data only.

---

## 13. Build risks

| Risk | Response |
|---|---|
| Workers become decoration | The headcount formula and hover-to-record rule are tested in 1.7 |
| Art swallows Stage 1 | Fixed art set. Placeholders until 1.10 |
| Business logic leaks into the client | Lint rule: `client` and `scene` cannot import core internals, only the API types |
| Real data in a public repo | `data/real` gitignored from 1.0. Pre-commit hook scans for GUIDs and `.parquet` |
| Mirror lacks history | Start the daily snapshot as early as possible in Stage 2 |
| Too many units for performance | Convoys, crowd badges, visible-unit caps |

---

## 14. How to work on this (AI agents included)

1. Read CONTEXT, DATA-MAPPING, then this plan.
2. Take the next unticked milestone. Do only that.
3. Meet its exit test, commit, and tick it here.
4. Update `HANDOFF.md` with the current state and the next milestone.
