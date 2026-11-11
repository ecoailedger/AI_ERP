# AI_ERP

Proof of concept: an ERP you play like a strategy game.

The business is rendered as a living settlement generated from data. Purchase orders are lorries on the road, stock is stockpiles in the yard, customers are villages, and late or broken things are visibly stuck. Orders, deliveries, counts, shipments and invoice payments are actions you take in the world.

This is a proof of concept. It is not a production ERP and it never writes to a live system.

## Documents

- [Project Initiation Document](docs/PID.md): why, what, scope, stages, risks.
- [Context](docs/CONTEXT.md): the concept, domain, design rules and guardrails. Read this before writing any code, human or AI agent.
- [Data mapping](docs/DATA-MAPPING.md): every Fabric table and column the world needs, with gaps.
- [Build plan](docs/BUILD-PLAN.md): stack, sim people, world generation, architecture, data connections, milestones.

## Status

Stage 1 in progress. Milestone 1.0 (scaffold) is done; 1.1 (domain types and dummy data) is next. See the [build plan](docs/BUILD-PLAN.md#11-milestones).

## Run it

Needs Node 22 or later.

```
npm install
npm run dev      # API on 127.0.0.1:5180, world on http://localhost:5190
npm run check    # lint, typecheck, tests, build
```
