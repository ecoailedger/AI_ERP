# Project Initiation Document: AI_ERP

| | |
|---|---|
| Project | AI_ERP: a gamified ERP proof of concept |
| Owner | Wil Kitcher, Group Head of Data, Midwich Group |
| Status | Draft v0.1, initiation |
| Date | 11 November 2026 |
| Sponsor | TBC |

## 1. Purpose

Prove that core ERP activity (purchasing, receiving, stock, sales, shipping, invoices and payments) can be run through an interface that looks and plays like an isometric strategy game, driven by real business data.

The aim is to produce something striking enough to change how people at Midwich think about what an ERP interface can be, and to inform thinking on what could eventually replace Strategix.

## 2. Background

- Midwich UK, Midwich Ireland and Square One run Strategix. It is ageing, and integrating with it is hard.
- Conventional ERP screens show documents as rows. Flow, bottlenecks and exceptions are invisible until someone runs a report.
- Purchase order data from Strategix is already available in Microsoft Fabric through the Slipstream work, so a data-driven prototype can start without new integration.
- The idea began as a warehouse game and widened to the whole ERP once it was clear that a fictional warehouse alone would not show much.

## 3. Objectives

1. Render the business as a world generated from data, not drawn by hand.
2. Make document flow and exceptions visible at a glance: what is moving, what is stuck, what is late.
3. Let a user complete the main ERP loops as game actions in a sandbox.
4. Be visually good enough that people choose to look at it.
5. Produce a reusable core (data model and API) that is independent of the game front end.

## 4. Scope

### In scope

- A single-site world: warehouse, goods-in, dispatch, sales office, accounts, with suppliers and customers on the surrounding map.
- Purchase orders, deliveries, receipt and count, stock, sales orders, pick and ship, sales and purchase invoices, payments.
- A time scrubber to replay history as a timelapse.
- Data-quality "fog of war": missing or untrusted data shown as dark map.
- An AI advisor that narrates what matters.
- A sandbox ledger for all write actions.
- Dummy data first, then a read-only feed from Fabric.

### Out of scope

- Any write to Strategix or any other live system.
- Statutory finance: period close, VAT returns, multi-currency revaluation, audit sign-off.
- Bank, carrier and EDI integrations.
- Multi-site and multi-company operation.
- Production security, permissions and resilience.
- A real warehouse layout. The world is schematic.

## 5. Approach

Two layers, kept strictly apart:

1. **Core.** Stock movements, document state machines and a double-entry sandbox ledger behind an API. Every action is an audited event.
2. **Game client.** An isometric world that reads state from the core and sends actions to it. No business logic lives in the client.

A plain table view over the same API is a likely later addition, because volume data entry does not suit a game interface.

All artwork, audio and naming are original. The look is the isometric management-sim genre, not a copy of any specific game.

## 6. Stages

| Stage | Deliverable | Exit test |
|---|---|---|
| 1. Living world | Read-only world on dummy data shaped like Slipstream purchase orders: map, lorries, stockpiles, time scrubber | A viewer can name the late suppliers within 30 seconds, unprompted |
| 2. Real data | Stage 1 driven by a read-only Fabric feed | World state reconciles to Slipstream figures for the same date |
| 3. Play | Order, receive, count, ship, invoice and pay loop in the sandbox | A user completes purchase-to-pay and order-to-cash without instruction |
| 4. Advisor | AI narration and alerts over world state | Advisor statements are traceable to underlying records |
| 5. Review | Demo and decision on next step | Go, change direction, or stop |

Dates are not set. Stage 1 is deliberately small.

## 7. Success criteria

- People who see the demo ask to use it or show it to others.
- Exceptions are found faster in the world than in the existing reports.
- The figures in the world match the source data.
- The core can be driven without the game client.

## 8. Assumptions

- Slipstream purchase order data in Fabric is accessible read-only for this purpose.
- Sales, invoice and stock-count data will be simulated until other Fabric tables are identified.
- The work is done on the side, without a dedicated budget or team.

## 9. Constraints

- No approved budget.
- No live-system writes, ever, within this project.
- The repository is public, so no real company data, credentials or commercially sensitive figures are committed to it.

## 10. Risks

| Risk | Effect | Response |
|---|---|---|
| Seen as a toy | Idea dismissed before it is understood | Reconcile to real figures; show a serious summary alongside the world |
| Artwork absorbs the effort | Good-looking shell with no substance | Fix a small art set per stage; data-driven rendering before polish |
| Prototype drifts into production | Unsupported system carrying real process | Sandbox only; stage 5 is an explicit decision point |
| Figures drift from source | Loss of trust | Reconciliation test at stage 2 and after |
| Real data in a public repository | Disclosure | Dummy data only in the repository; real feed configured outside it |
| Single-person dependency | Work stalls | Context document kept current so others, and AI agents, can pick it up |

## 11. Roles

| Role | Who |
|---|---|
| Owner and lead | Wil Kitcher |
| Sponsor | TBC |
| Domain input: purchasing, warehouse, finance | TBC |
| Build | Wil Kitcher with AI coding agents |

## 12. Open decisions

1. Technology for the game client and the core.
2. Where the proof of concept is hosted.
3. Which Fabric tables beyond Slipstream can be used.
4. Which model powers the advisor.
5. Who sponsors it and who sees the first demo.
