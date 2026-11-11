# Plan: make the people the subject, not the lorries

## Context

The world today is built around goods: lorries, stockpiles, vans. People were added last, as a layer on top. They only do two jobs (raise a PO, enter a sales order), and they loop an animation instead of living through a day.

The aim has changed (see `docs/CONTEXT.md` section 13). Deliveries cannot be handed to software; the decisions and desk work of people can. So the thing to see, measure and improve is **each person's day**: what they spend their 7.5 hours on, who is overloaded, what could be taken off them, and whether their decisions turned out well.

Goods stay in the world as the *consequence* of what people decide. They stop being the headline.

**Outcome:** open the world and the first thing you read is the team: who is working, on what, how full their day is, and how many hours could be freed.

## What changes, in order

Each step is demonstrable alone. Estimates are focused build hours.

### P1. People-first screen (~5 h)

Client only. No new data.

- **Top bar becomes people figures:** people working today, hours of work, share of capacity used, people over 7.5 hours, hours that do not fit, orders handled per hour. Each opens its rows, the same way money figures do now. The money figures move to a second row or a toggle.
- **Roster panel** (left, always open): one row per person, a bar showing their day filling up to 7.5 hours, red past it. Sorted busiest first. Click flies to the avatar.
- **Goods fade back:** a "Show goods" toggle, off by default. Off means roads, lorries, vans and ports draw at low opacity with no labels. The settlement and its people stay full strength.
- **Camera opens on the settlement**, not the whole map.
- **Alerts lead with people** (over capacity, backlog at an office), then goods.

Files: `apps/client/src/hud/ResourceBar.tsx`, new `hud/RosterPanel.tsx`, `apps/client/src/world/WorldView.ts` (layer opacity, `fitWorld`), `apps/client/src/store.ts` (toggle), `packages/core/src/figures.ts` (people figures, reusing the rows-sum-to-figure pattern in `figureRecords`).

### P2. A real working day per person (~6 h)

Today a person's jobs are a list and a total. Make them a **timeline**.

- **Core:** new `packages/core/src/people.ts`. For each person and date, lay jobs end to end from the start of the day: each job gets a start and end minute. Past minute 450 is overtime. Reuse `deskJob` logic in `state.ts`, `ordersEntered` and the minute functions in `workload.ts`.
- **Domain:** `PersonState` gains `timeline: { ref, kind, label, startMinute, endMinute, overtime }[]`.
- **Scene:** `packages/scene/src/workers.ts` drives a person's avatar from the timeline and the time of day (`dayFraction`), not a loop. At 10:40 they are on the job that covers 10:40. When their jobs are done they go idle, then leave. Past 7.5 hours they are flagged and stop. Pool workers (warehouse, dispatch) keep the current loop.
- **Person card:** a day bar showing each job as a block, hoverable, with the 7.5 hour line marked.
- **Clock in the scrubber:** show time of day while playing, so a day reads 09:00 to 16:30.

### P3. More of what people actually do (~6 h)

Two job types is too thin to optimise anyone. Add the work the data can support, each as a `TaskKind` with assumed minutes in `workload.ts`:

| Job | Who | Derived from |
|---|---|---|
| Chase a late PO | The buyer who raised it | Late POs by `raisedBy`, one chase per order per day late (capped) |
| Chase stock for a late order | The person who entered it | Late unallocated orders by `enteredBy` |
| Chase an overdue account | The credit controller | `DLCUS_CREDCONT` on the customer. Not pulled yet: add to `ingest/aierp_ingest/pull.py` |
| Approve a PO | The approver | The mirror has `PaPurchaseOrderApprovals`, `PaUsers`, `PaRoles`. **Unprofiled: read their columns first** |

Move the existing `chase_stock` and `chase_debt` queue items from anonymous pools onto named people where the data says who.

Only add a job where a record says who did it or owns it. No invented work.

### P4. Tell people from machines (~2 h)

One user id does about 50 hours of "work" a day. That is a feed, not a person.

- **Core rule** in `rules.ts`: an id whose median day is above a threshold (say 2 working days) is a `system`.
- Systems get a different avatar (a terminal, not a figure), are left out of people figures, and are listed apart: "already automated".
- This also gives the first honest number for the comparison: how much desk work is done by machines today.

### P5. Each person over time (~4 h)

One day is an anecdote. Add history per person across the range:

- Average and peak hours, days over 7.5, mix of job types.
- **Outcomes of their decisions**, where traceable: for a buyer, share of their POs that arrived late, and stock-outs and aged stock on the products they buy. For sales, share of their orders shipped past the committed date.
- New endpoint `GET /people/:id/history`, sampled the way `typicalQueue` already samples states in `packages/core/src/index.ts`.
- Shown on the person card as small charts.

### P6. Optimise: what-ifs on the team (~8 h)

This is the point of the whole thing. All pure functions in the core, shown side by side with the actual day.

1. **Rebalance:** share the same jobs evenly within a role. How many over-capacity days disappear? No AI involved: this is the cheapest win and the baseline.
2. **Take work off people:** for each job type, a share an assistant could do (a slider, an assumption until tested). Show hours freed per person and across the team, and what the day looks like after.
3. **AI buyer (existing 2b.3 to 2b.5):** replay the period with a purchasing policy in place of the buyers, held to the same 7.5 hour day, and compare stock value, stock-outs and late customer orders.

Every what-if result must trace to rows, like figures do. No headline number without the jobs behind it.

## What stays and what goes

- **Stays:** the canonical dataset, the core's date-honest projection, the ingest and cache, record cards, the scrubber, the table view.
- **Demoted, not deleted:** ports, roads, lorries, vans, stockpiles. They are how a decision's result is seen.
- **Dropped from the plan:** hand-drawn art for goods, more goods exceptions, Stage 3 "play" loops for receiving and picking. Not where the value is.

## Decisions needed from you

1. **Job times.** Everything in P2 to P6 rests on how long jobs take. Today they are my guesses in `workload.ts`. Rough real figures are enough to start.
2. **Goods off by default?** I recommend yes, with the toggle.
3. **Outcome measures in P5.** Judging a buyer by late deliveries is sensitive, even by alias. Say if any measure should be left out.

## Guardrails that still hold

- People by alias only. Real user ids never leave `ingest/aierp_ingest/snapshot.py`.
- No real data, ids or real-data screenshots in the repo.
- Business rules live in the core (`rules.ts`, `workload.ts`, new `people.ts`). The scene and client only draw.
- Read-only on Fabric.

## How to verify

- `npm run check` after each step: lint, typecheck, tests, build.
- **New core tests:** a timeline's jobs never overlap and sum to the person's minutes; nothing is scheduled past minute 450 without being marked overtime; rebalancing conserves total minutes and jobs; a system id is excluded from people figures.
- **Whole-world test** (`apps/api/src/world.test.ts`): for every day, each avatar's job at a given time matches the core's timeline, and people figures equal the sum of their rows.
- **Browser check** with Playwright on dummy and real data: roster shows, avatars follow the clock when playing, goods fade with the toggle off, person card shows the day bar. Real-data screenshots stay in the scratchpad.
- **P3 first step:** read the `Pa*` and `DLCUS_CREDCONT` columns from the mirror (schema only) before writing any adapter code.

## Order of work

P1 → P2 → P4 → P3 → P5 → P6. P4 moves ahead of P3 because machines distort every people figure until they are separated. About 31 hours in all.
