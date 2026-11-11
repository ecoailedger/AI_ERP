# Context: AI_ERP

Read this before changing anything in the repository. It is written for people and for AI coding agents. The [PID](PID.md) covers why and when; this covers what the thing is and the rules it is built under.

## 1. What this is

A proof of concept of an ERP presented as an isometric strategy game. The business is a settlement on a map. The settlement is generated from data, and it changes as the data changes.

It is not a production system, not a replacement for Strategix, and not a real warehouse model.

## 2. The business

- Midwich Group is a specialist audio-visual distributor: it buys from manufacturers, holds stock, and sells to trade customers.
- The group runs many companies on different ERPs. Midwich UK, Midwich Ireland and Square One run Strategix.
- Group data is consolidated in Microsoft Fabric.
- Slipstream is the existing purchase order reporting work. Its data in Fabric is the first real feed for this project.

## 3. The world model

How ERP things appear in the world. This mapping is the heart of the concept; keep it consistent.

| ERP thing | In the world |
|---|---|
| The company site | The settlement at the centre of the map |
| Supplier | A port or factory at the map edge |
| Customer | A village; size tracks revenue |
| Purchase order | An inbound lorry; position on the road tracks progress to due date |
| Late purchase order | A lorry stalled in a visible queue |
| Delivery awaiting receipt | Pallets on the goods-in dock |
| Stock | Stockpiles by product category; size tracks value |
| Slow or dead stock | Stockpiles that visibly age |
| Sales order | A pick job, then an outbound van to the customer village |
| Purchase invoice | A bill arriving at the accounts building |
| Sales invoice and receipt | Money returning from the customer village |
| Cash, stock value, debtors, creditors, open orders | The resource bar along the top |
| Functions: goods-in, warehouse, sales, accounts, dispatch | Buildings; selecting one opens its queue |
| Exceptions | Alerts and events |
| Missing or untrusted data | Fog of war |
| History | A time scrubber that replays the world |

## 4. Core loops

**Purchase to pay:** raise purchase order → lorry travels → delivery arrives → receive and count → put away → invoice arrives → match → pay.

**Order to cash:** sales order arrives → allocate stock → pick → ship → invoice → payment received.

**Stock control:** count → variance → adjust; damaged stock and returns.

## 5. Design principles

1. **Data draws the world.** Nothing on the map is decorative. If it is there, a record put it there.
2. **Stuck things look stuck.** The main value is seeing exceptions without asking.
3. **Every action is a transaction.** A game action maps to one audited event in the core.
4. **Figures must reconcile.** Any number shown can be traced to source records.
5. **The core does not know about the game.** No business logic in the client.
6. **Looks matter.** It has to be good enough that people want to watch it.
7. **Small stages.** Each stage is demonstrable on its own.

## 6. Guardrails

These are not negotiable within this project.

- Never write to Strategix or any live system. All actions go to the sandbox.
- Read-only access to Fabric.
- This repository is public. Commit dummy data only. No real company data, customer or supplier names, prices, credentials, connection strings or tenant identifiers.
- All artwork, audio and names are original. The style is the isometric management-sim genre. Do not copy assets, characters, logos or interface layouts from any published game.
- Advisor statements must be grounded in records and say which ones.

## 7. Architecture (proposed)

```
Fabric (read-only)  ──►  ingest  ──►  core  ◄──►  game client
dummy data          ──►                │
                                       └──►  sandbox ledger + event log
```

- **Core:** entities, document state machines, stock movements, double-entry sandbox ledger, append-only event log, API.
- **Game client:** browser-based isometric renderer. Reads world state, sends actions.
- **Advisor:** a language model given a summary of world state and exceptions.

Technology choices are open. See the PID, section 12.

## 8. Data

### Entities

Supplier, Customer, Product, ProductCategory, Location, PurchaseOrder and lines, GoodsReceipt, StockMovement, StockCount, SalesOrder and lines, Shipment, PurchaseInvoice, SalesInvoice, Payment, LedgerEntry, Event.

### Sources

| Data | Stage 1 | Later |
|---|---|---|
| Purchase orders, suppliers, due and receipt dates | Dummy, shaped like Slipstream | Slipstream in Fabric |
| Products and categories | Dummy | Fabric, to be identified |
| Stock | Dummy | Fabric, to be identified |
| Sales orders, invoices, payments | Simulated | Fabric, to be identified |

Source tables and columns are mapped in [DATA-MAPPING.md](DATA-MAPPING.md). Do not guess column names: anything not marked confirmed there gets checked first.

## 9. Build order

1. Read-only living world on dummy data, with time scrubber.
2. Swap in the Fabric feed.
3. Play: the core loops in the sandbox.
4. Advisor.
5. Review and decide.

## 10. Glossary

| Term | Meaning |
|---|---|
| ERP | The system that records buying, selling, stock and money |
| Strategix | The ERP currently used by Midwich UK, Midwich Ireland and Square One |
| Fabric | Microsoft Fabric, the group data platform |
| Slipstream | Purchase order reporting work and its data in Fabric |
| PO / SO | Purchase order / sales order |
| Goods receipt | Recording that a delivery has arrived and what was in it |
| Putaway | Moving received stock to its storage location |
| Sandbox | The project's own simulated ledger and stock; never a live system |
| Fog of war | Map areas kept dark because data is missing or untrusted |

## 11. Decision log

| Date | Decision |
|---|---|
| 2026-11-11 | Scope is a gamified ERP proof of concept, not a warehouse-only game |
| 2026-11-11 | Map-and-units style (settlement, buildings, vehicles) over a people-in-rooms style |
| 2026-11-11 | World is generated from data; no real warehouse layout |
| 2026-11-11 | All writes go to a sandbox; no live-system writes |
| 2026-11-11 | Stage 1 runs on dummy data shaped like Slipstream purchase orders |
| 2026-11-11 | TypeScript throughout: PixiJS world, React panels, Fastify API. Ingest will be Python. See [BUILD-PLAN.md](BUILD-PLAN.md) section 0 |
| 2026-11-11 | Workers are drawn, each tied to a record in a building's queue. No work, no workers |
| 2026-11-11 | One canonical dataset shape for every source. Dummy data and the Fabric feed both map into it |
| 2026-11-11 | Art is drawn in code as isometric shapes. No image assets yet |
| 2026-11-11 | The focus is the decisions people make, such as raising a PO, with a later aim of replaying history with an AI making them. See section 13 |
| 2026-11-11 | An order more than 90 days overdue is "stale", shown apart from "late" |
| 2026-11-11 | Customers are placed by real direction and distance from the site, to the nearest postcode area |
| 2026-11-11 | Lorries are spaced along the road by days until due, not by share of lead time elapsed |

## 12. Open questions

- Slipstream schema and refresh cadence.
- Which other Fabric tables can feed stock, sales and finance.
- Hosting.
- Advisor model.

## 13. Direction: decisions, not deliveries

Added 2026-11-11.

The physical work cannot be handed to software: a lorry still has to arrive and a pallet still has to be moved. What can change is the **decisions people make**: a buyer raising a purchase order, a salesperson committing a date, a credit controller putting an account on stop.

So the part of the world worth getting right is the decision, and who or what made it. The aim further out:

1. Show each decision as a visible act by a role. A buyer raises a PO; the lorry is the consequence.
2. Record what the decision-maker knew at the time: stock, demand, what was already on order.
3. Replay the same period with a different decision-maker, for example an AI buyer, against the same demand and the same supplier behaviour.
4. Compare the outcomes side by side: stock value, stock-outs, late customer orders, cash tied up.

That comparison is the point. It answers "how much better would this have gone?" with the business's own history, not a claim.

What this means for the build:

- Purchasing needs its own place in the settlement. Today there is no buyer and no purchasing queue.
- The feed says who raised each order (`PORD_USERID`, `PORD_AUTHOR`, `SOH_USERID`, `SOH_AUTHOR`). These are not pulled yet. People are shown by role or alias, never by name.
- The core needs a simulation mode: take real demand and real supplier lead times, swap in a purchasing policy, and run the days forward. The dummy data generator already does a simple version of this.
- Deliveries, picking and loading stay in the world as consequences. They are not where the effort goes.
