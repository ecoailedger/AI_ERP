# ingest

Read-only ingest from Fabric into the canonical dataset. Python 3.11 or later.

Nothing here writes to Fabric. Everything it pulls lands in `data/real/`, which is gitignored: real data must never reach this public repository.

## Set up, once

```
pip install -r ingest/requirements.txt
copy .env.example .env      # then fill in the workspace and item ids
```

`.env` is gitignored. It holds the ids of the mirrored database, which identify the tenant and so stay out of the repo.

## Build a look-back

```
cd ingest
python -m aierp_ingest.snapshot --start 2026-10-01
```

- The first run asks you to sign in with a device code. After that it is silent.
- The first run pulls from Fabric (a few minutes) and caches every pull as parquet in `data/real/cache/`.
- Later runs read the cache and do not touch Fabric. Add `--refresh` to pull again.
- Output goes to `data/real/lookback/`, in the same shape as `data/dummy/`. `REPORT.json` there lists what was rebuilt and what was left out.
- Supplier and customer names are replaced with aliases unless you pass `--real-names`.

Then, from the repository root:

```
npm run dev:real
```

## What is real and what is rebuilt

The mirror holds today's position, not history. The look-back rebuilds the past from it:

| In the world | How it is known |
|---|---|
| Purchase orders, due dates, deliveries | Real. A delivery is dated at the line's last delivery date; earlier part deliveries fold into it |
| Sales orders, shipments, invoices | Real. One shipment per invoice, shipped on the invoice date |
| Stock today | Real |
| Stock on earlier days | Worked back from today using deliveries and shipments. Adjustments, transfers and returns are not in the feed, so it drifts the further back you go |
| Put-away, picking and allocation dates | Assumed: not in the feed |
| Customers on stop | Today's flag, shown for the whole period |
| Debtors, creditors, cash | Simulated: the feed has no payments or supplier bills. Marked "simulated" in the world |

Due dates and committed dates are today's values. If one was moved after the fact, the look-back shows the moved date, so past lateness can be understated.

## Files

| File | What it does |
|---|---|
| `aierp_ingest/config.py` | Reads `.env`. Builds the OneLake path |
| `aierp_ingest/auth.py` | Device-code sign-in, cached by the operating system |
| `aierp_ingest/lake.py` | Read-only Delta access: `table`, `query`, `columns`, `list_tables` |
| `aierp_ingest/pull.py` | The SQL for each pull, and the parquet cache |
| `aierp_ingest/snapshot.py` | Maps the pulls into the canonical dataset |
