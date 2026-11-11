# Data mapping: Fabric → AI_ERP

Every item the world draws, mapped to its Fabric source table and columns. Read [CONTEXT.md](CONTEXT.md) first.

This file holds **schema only**. It contains no data, IDs, endpoints, workspace GUIDs, tenant details, or customer or supplier names. Keep it that way: the repository is public.

## 1. How to read this

Status of each column:

| Mark | Meaning |
|---|---|
| ✅ | Confirmed: used in working queries against the mirror |
| 📄 | From the Strategix table spec only. The mirror column name (prefix) is not confirmed yet |
| ❓ | Not found. Needs a source or a decision |
| 🎲 | Not in Fabric. Simulate in the sandbox |

Rule from CONTEXT §8: **do not guess column names.** Anything 📄 or ❓ gets checked against the mirror before code depends on it.

## 2. Sources

| Source | What it is | Use it for | Notes |
|---|---|---|---|
| **UK orders mirror** (`db-orders_PROD`, Fabric mirrored database) | Near-real-time mirror of Strategix UK (Midwich UK), tables `Tables/Source/Stx*` | **Primary feed.** Purchase orders, sales orders, invoices, stock, products, customers | Lag is minutes. Only a column subset is mirrored. One company code |
| **Pallas dataset** (Fabric API for GraphQL, Pallas workspace) | Group sales and stock dataset, currently Iberia (ES01) | Group product identity (`item`), stock ageing, landed cost, a second OpCo later | **No supplier, PO, in-transit or lead-time data at all** |
| `dl_Slipstream` lakehouse | Older Slipstream copies | Special-deal costs only (`UB_SOSDITEM`) | **Stale:** SOITEM is empty and POs stop early. Do not use it for orders |

Read rules (all sources):

- Read-only. Never write back.
- For the mirror, read the Delta files over OneLake. Do not repeatedly hit the SQL endpoint, because it is charged per query.
- Every mirror table has `IsDeleteFl` (filter `= 0` / `NOT IsDeleteFl`) and `UpdateTs` (last change).
- Null-date sentinels: `1899-12-31` and `0001-01-01`. Treat dates before 2000 as empty. `2050-xx` means "TBC".
- Trim string keys (`RTRIM`), because Strategix pads them.
- Real-feed credentials and connection details live outside this repo (`.env`, gitignored).

## 3. World → entity → source (summary)

| In the world | Entity | Source table(s) | Status |
|---|---|---|---|
| Supplier port/factory | Supplier | `StxPORDER.PORD_SUPPLIER`, `StxCMPROD.CMP_SUPP` (codes only) | ✅ codes · ❓ supplier master (name, country, terms) |
| Customer village (size = revenue) | Customer | `StxDLCUST`, revenue from `StxSOINVOICE` + `StxSOITEM` | ✅ |
| Inbound lorry | PurchaseOrder + lines | `StxPORDER`, `StxPOITEM` | ✅ |
| Lorry stalled (late PO) | derived | `POIT_DUEDATE` < today and line open | ✅ |
| Pallets on goods-in dock | GoodsReceipt | `POIT_QTYDEL`, `POIT_LASTDEL` (cumulative only) | ✅ partial · ❓ per-receipt rows (GRN) |
| Stockpiles by category (size = value) | Stock, ProductCategory | `StxSTOCK` × `StxCMPROD` × `StxAPDESC` | ✅ |
| Ageing stockpiles | derived | days since last receipt (`POIT_LASTDEL`), or Pallas `agingBucket` | ✅ |
| Pick job → outbound van | SalesOrder + lines, Shipment | `StxSOHEAD`, `StxSOITEM` | ✅ orders · 📄 despatch date |
| Money returning from village | SalesInvoice, Payment | `StxSOINVOICE` · receipts ❓ | ✅ invoices · 🎲 payments |
| Bill arriving at accounts | PurchaseInvoice | ❓ | 🎲 |
| Resource bar | derived figures | see §5 | mixed |
| Buildings / locations | Location | `StxSTOCK.STK_LOC`, `StxSTLOC` | ✅ codes · ❓ `StxSTLOC` columns |
| Fog of war | data-quality flags | rules in §7 | derived |
| Time scrubber | history | mostly ❓: see §6 | gap |

## 4. Entity detail

### 4.1 Product: `StxCMPROD`

Key: `CMP_PRODUCT` (SKU).

| Field | Column | Status | Notes |
|---|---|---|---|
| sku | `CMP_PRODUCT` | ✅ | Trim it |
| description | `CMP_DESC` | ✅ | Skip descriptions containing `DO NOT USE` |
| business line / division | `CMP_ANALCODE` | ✅ | Codes like `M0##`. Name via `StxAPDESC` type `M` |
| brand / product group | `CMP_GROUP` | ✅ | Name via `StxAPDESC` type `P` (~28% have no name) |
| category | `CMP_CATEGORY` | ✅ | Name via `StxAPDESC` type `C`. **Drives stockpile grouping** |
| usual supplier | `CMP_SUPP` | ✅ | Supplier code. Use this, not `CMP_MANU` |
| manufacturer part no. | `CMP_LKSPCODE` | ✅ | |
| standard cost | `CMP_CURCOST` | ✅ | Per purchase unit. Not landed cost |
| sell price | `CMP_SELLPR` | ✅ | Standard list price |
| commodity code | `CMP_COMMODITY` | ✅ | |
| replacement SKU | `CMP_ALTERNATE` | ✅ | |
| lifecycle | `status`, `inactive`, `lastbuy`, `lastship` | 📄 | Feeds "obsolete" visual |
| lead time (weeks) | `nodelwks` | 📄 | Fallback for lorry travel time |
| MOQ / multiple | `pminqty`, `pordmult` | 📄 | |

Lookup table **`StxAPDESC`**: `APDSC_TYPE`, `APDSC_CODE`, `APDSC_NAME`, `IsDeleteFl` ✅. Types used: `P` brand/group, `C` category, `M` business line.

### 4.2 Location: `StxSTOCK.STK_LOC`, `StxSTLOC`

| Field | Column | Status |
|---|---|---|
| location code | `STK_LOC` | ✅ |
| location master (name, type) | `StxSTLOC` | ❓ table is mirrored; columns not yet listed |

Stage decision: the world is **one site**. Pick the main warehouse location and filter `STK_LOC` to it. Demo, returns and other-business locations stay out, or render them as small side yards.

### 4.3 Stock snapshot: `StxSTOCK`

Key: `STK_PRODUCT` + `STK_LOC`. **Current position only**: there is no history in the mirror (see §6).

| Field | Column / formula | Status |
|---|---|---|
| on hand | `STK_STKQTY` | ✅ |
| unavailable (damaged, QC) | `STK_UNAVQTY` | ✅ |
| allocated to orders | `STK_ALLSTK` | ✅ |
| back-ordered against incoming | `STK_BACKORD` | ✅ |
| usable | `STK_STKQTY − STK_UNAVQTY` | ✅ |
| free | `STK_STKQTY − STK_ALLSTK − STK_UNAVQTY` | ✅ |
| on order (PO) | `ospurch` | 📄 should equal Σ open PO lines |
| in transit (transfers) | `ositr` | 📄 |
| unit cost | `latecost`, `avcost` | 📄 · fallback `CMP_CURCOST` ✅ |
| last sale / purchase | `lastsale`, `lastpurch` | 📄 |
| as-of | `UpdateTs` | ✅ |

Stockpile size = Σ usable qty × unit cost, grouped by `CMP_CATEGORY`.

Known trap: `STK_ALLSTK` covers only ~20% of open order units. For "committed" use open sales-order lines instead (§4.7).

### 4.4 Supplier

| Field | Source | Status |
|---|---|---|
| supplier code | `StxPORDER.PORD_SUPPLIER`, `StxCMPROD.CMP_SUPP` | ✅ |
| name, country, terms, currency | supplier master (Strategix purchase ledger) | ❓ not found in the mirror. Ask whether it can be added |

Until then, suppliers are drawn from codes. **Display names are dummy aliases in every environment**: real supplier names never go into the repo or the screenshots.

### 4.5 Purchase order: `StxPORDER` (header) + `StxPOITEM` (lines)

Join: `POIT_ORDER = PORD_ORDER`.

| Field | Column | Status | Notes |
|---|---|---|---|
| PO number | `PORD_ORDER` / `POIT_ORDER` | ✅ | |
| order date | `PORD_DATEORD` | ✅ | Lorry leaves the port |
| supplier | `PORD_SUPPLIER` | ✅ | Which port the lorry starts at |
| PO type | `PORD_TYPE` | ✅ | Keep `N` (normal). Excludes master/reserve |
| product | `POIT_PRODUCT` | ✅ | |
| qty ordered (stock units) | `POIT_SQTYORD` | ✅ | `POIT_QTYORD` is purchase units |
| qty delivered | `POIT_QTYDEL` | ✅ | Cumulative |
| line status | `POIT_STATUS` | ✅ | `O` open, `C` complete |
| due date | `POIT_DUEDATE`, else `POIT_REQDATE` | ✅ | **Lorry position** = elapsed / (due − order date) |
| last delivery date | `POIT_LASTDEL` | ✅ | Actual receipt. All partials are dated here |
| original due date | `oduedate` | 📄 | Slip count `duecount`. Shows "promised vs now" |
| acknowledged | `ackdate`, `ackref` | 📄 | Unconfirmed POs could render greyed |
| cancelled qty | `sqtycan` | 📄 | |
| reserved for sales orders | `sorqty`, `soord` | 📄 | Back-to-back lorries can carry a customer flag |
| intercompany | `ternal = 'I'`, `ccomp` | 📄 | Lorry from a sister company |
| PO value | qty × unit price | ❓ | Price column not confirmed. Find before showing creditor value |

Derived:

- Open line: `POIT_STATUS = 'O' AND POIT_QTYORD > POIT_QTYDEL`.
- Outstanding qty: `POIT_SQTYORD − POIT_QTYDEL` (spec also subtracts cancelled).
- **Late (stalled lorry):** open line and due date < today. Days late = today − due date.
- Actual lead time: `POIT_LASTDEL − PORD_DATEORD` on complete lines.

Trap: completed POs are purged once delivered and invoiced, so completed-PO history may be thin.

### 4.6 Goods receipt

| Need | Source | Status |
|---|---|---|
| received qty and date (cumulative) | `POIT_QTYDEL`, `POIT_LASTDEL` | ✅ |
| one row per delivery (GRN) | `pogrn` | ❓ not confirmed in the mirror. Needed for exact dock events |
| count / variance on receipt | none | 🎲 sandbox |

Stage 1: "pallets on the dock" = POs with `POIT_LASTDEL` = today, or lines due today. Exact per-delivery events need the GRN table.

### 4.7 Sales order: `StxSOHEAD` (header) + `StxSOITEM` (lines)

Join: `SOI_ORDREF = SOH_ORDREF`.

| Field | Column | Status | Notes |
|---|---|---|---|
| order ref | `SOH_ORDREF` | ✅ | `S#######`. `ES######` refs also exist (unknown meaning) |
| order date | `SOH_ORDDATE` | ✅ | Pick job appears |
| order type | `SOH_ORDTYPE` | ✅ | Exclude `Q` (quotes). `C` = credit |
| currency | `SOH_CURRENCY` | ✅ | |
| sales team | `SOH_TEAM` | ✅ | |
| original value | `SOH_ORIGVAL` | ✅ | `SOH_ORDVAL` looks like outstanding value |
| customer account | `account` | 📄 | Mirror name not confirmed. Invoices give it via `SOINV_ACCOUNT` ✅ |
| product | `SOI_PRODUCT` | ✅ | |
| qty | `SOI_ITQTY` | ✅ | Stock units |
| unit price | `SOI_PRICE` | ✅ | Line value = qty × price |
| unit cost | `SOI_ITCOST` | ✅ | |
| line status | `SOI_ITSTAT` | ✅ | `0` back-ordered, `1` not allocated, `2` allocated, `6` confirmed |
| customer required date | `SOI_REQDATE` | ✅ | `0` = ASAP |
| committed delivery date | `SOI_COMDT2` (latest), `SOI_COMDT1` (original) | ✅ | Van departure target. Late van = open past COMDT2 |
| invoice ref / date | `SOI_INVREF`, `SOI_INVDATE` | ✅ | Invoiced = `SOI_INVREF <> ''` |
| quote / deal ref | `SOI_QUOTREF` | ✅ | Deal cost in `UB_SOSDITEM` (lakehouse) |
| despatch date | `despdate` | 📄 | Van leaves. Fallback: invoice date |
| warehouse | `stloc` | 📄 | Filter to the site |
| branch / delivery type / end customer | `StxSOEXTRA1` CODE1, CODE2, CODE6 | ✅ | |

Pick-job state from `SOI_ITSTAT`: back-ordered → waiting on lorry · allocated → on pick list · invoiced → van gone.

Trap: Strategix splits one product across several lines on an order (~4%). Sum by order × product.

### 4.8 Sales invoice: `StxSOINVOICE` + `StxSOITEM`

| Field | Column | Status | Notes |
|---|---|---|---|
| invoice ref | `SOINV_INVREF` | ✅ | **Every invoice appears twice in the mirror: dedupe on this** |
| customer | `SOINV_ACCOUNT` | ✅ | Trim |
| type | `SOINV_TYPE` | ✅ | `O`, `I` invoice; `C` credit note |
| date | `SOINV_INVDATE` | ✅ | |
| currency | `SOINV_CURRENCY` | ✅ | |
| net value | Σ `SOI_ITQTY × SOI_PRICE` by `SOI_INVREF` | ✅ | Credit notes are stored positive: negate them |
| VAT, gross, due date | none | ❓ | |

### 4.9 Customer: `StxDLCUST`

Key: `DLCUS_CUSTOMER`.

| Field | Column | Status | World use |
|---|---|---|---|
| account | `DLCUS_CUSTOMER` | ✅ | Village id |
| currency | `DLCUS_CURRENCY` | ✅ | |
| balance owed (gross) | `DLCUS_BALANCE` | ✅ | **Debtors** in the resource bar |
| credit limit | `DLCUS_LIMIT` | ✅ | Village "over limit" warning |
| on stop | `DLCUS_STOP` | ✅ | Village gate closed |
| terms | `DLCUS_TERMS` | ✅ | |
| credit controller | `DLCUS_CREDCONT` | ✅ | |
| sales rep | `DLCUS_REP` → `StxUSERS.US_USER` | ✅ | Case-insensitive match. USERS has duplicates |
| name, address, region | | ❓ | Not needed: villages use **dummy names**. Region could place villages on the map |
| intercompany flag | `class` / codes | 📄 | No explicit flag. Ask which code marks group companies |

Village size = trailing 12-month net invoiced (§4.8).

### 4.10 Purchase invoice, payments, ledger

| Entity | Source | Status |
|---|---|---|
| Purchase invoice | purchase ledger tables | ❓ not in the mirror. The `poiharc`/`poilarc` archives are invoice-matching records only |
| Customer receipt (payment in) | sales ledger transactions | ❓ not in the mirror. Debtor balance only, via `DLCUS_BALANCE` |
| Supplier payment | purchase ledger | ❓ |
| Cash | bank / GL | ❓ |
| Ledger entries | — | 🎲 sandbox double-entry ledger, by design |

Stage 1 to 3: simulate all of these in the sandbox. Bills arrive N days after receipt; customers pay on `DLCUS_TERMS`.

### 4.11 Stock movements and counts

| Entity | Source | Status |
|---|---|---|
| Stock movement | `stmove` | ❓ **not in Fabric**. Spec: `loc`, `product`, `trandate`, `qty`, `trantype` |
| Stock count / variance | none | 🎲 sandbox |
| Transfers between locations | `stitem` (`loc` → `toloc`) | 📄 not confirmed in mirror |

## 5. Resource bar

| Figure | Formula | Status |
|---|---|---|
| Stock value | Σ usable qty × unit cost (`StxSTOCK` × cost) | ✅ |
| Debtors | Σ `DLCUS_BALANCE` | ✅ |
| Open sales orders | count and value of uninvoiced SO lines (`SOI_INVREF = ''`, `SOH_ORDTYPE <> 'Q'`) | ✅ |
| Open purchase orders | count of open PO lines; value needs PO price | ✅ count · ❓ value |
| Creditors | purchase ledger balance | ❓ → 🎲 |
| Cash | bank | ❓ → 🎲 |

Each figure must click through to the records behind it (CONTEXT §5.4).

## 6. History and the time scrubber

The mirror holds **current state**, not history:

| Need | Reality |
|---|---|
| Sales lines over time | `StxSOITEM` holds current orders only. Purged orders move to history files (`soitemh`, `sohish`) that are **not mirrored**. Check monthly volumes for gaps |
| Stock over time | No `stmove`. Pallas rebuilds daily stock backwards from today's `StxSTOCK` using sales and receipts (back-tested error: ~3% at 0–4 weeks, ~18% at 14–26 weeks) |
| PO due-date changes | `UpdateTs` holds the last change only |
| Committed delivery date changes | Current value only |

Approach: **start a daily snapshot now** (stock, open POs, open SOs, debtor balances) into a project-owned table outside this repo. The scrubber replays snapshots. Older history uses the rebuild method, with confidence shown as fog of war.

## 7. Fog of war rules

Area goes dark or hazy when:

- Product has no category name (`StxAPDESC` miss) → category stockpile shown as "unknown".
- PO line has no due date (sentinel), or a due date before its order date.
- Stock row with `STK_STKQTY < 0`.
- Customer with invoices but no `StxDLCUST` row, or vice versa.
- Source `UpdateTs` older than the expected refresh (stale feed).
- Any reconstructed history (§6) beyond the back-tested range.

## 8. Pallas dataset (GraphQL): what it adds

Iberia only today (`companyID`, ES01). Key entities and fields:

| Entity | Fields useful here |
|---|---|
| `stock`, `stockHistory` | `companyID, reportDate, productID, warehouseID, locationID, onHandQTY, reservedQTY, availableQTY, backorderQTY, orderedQTY, allocatedQTY, landedCostUnit, agingBucket, agingBucketIndex, agedStockProvision` |
| `salesOrderHeader` / `salesOrderLine` | `salesOrderID, customerID, orderDate, status, creditBlock` / `productID, orderedQTY, remainingQTY, backOrderQTY, salesPrice, requestedShippingDate` |
| `salesInvoiceHeader` / `salesInvoiceLine` | `invoiceID, customerID, invoiceDate, totalAmount, paymentTermID` / `productID, quantity, lineAmount, landedCostLine, isCreditNote, purchaseOrderID` |
| `customer` | `customerID, interco, abc, creditLimit, paymentTermID, isActive` |
| `product` | `product_id, opco, sku, division, product_group, lifecycle, classification` |
| `item`, `item_product` | Group-level product identity (manufacturer + MPN) across OpCos |
| `lastLandedCostUnit` | `date, productID, lastLandedCostUnit` |

Gaps and traps:

- **No supplier, PO, in-transit, lead time or MOQ.** It cannot drive lorries.
- `productID` on transactional tables holds the SKU, not `product_id`.
- Real keys are composite (`companyID` + id). Primary keys are mis-declared, so **cursor paging stops at 200 rows**. Query by key lists or use the `Aggregations` / `GroupBy` companions.
- `product.product_group` is null for ES01.

Use for AI_ERP: ageing buckets and landed cost (consume, don't re-derive), and `item` for a later multi-OpCo world. The UK mirror stays the primary feed because it has purchasing.

## 9. Stage 1 dummy data

Dummy files use **the canonical entity fields above**, not the `Stx*` column names. One adapter later maps the mirror to the same shape, so swapping in Fabric changes one module.

Minimum Stage 1 set: `suppliers`, `customers`, `products`, `categories`, `locations`, `purchase_orders` + lines (with order, due and last-delivery dates), `stock`, `sales_orders` + lines, `sales_invoices`. Generate several months of dated events so the scrubber has something to replay. Include deliberate exceptions: late lorries, aged stock, customers on stop, a negative stock row (fog).

## 10. Open questions (for the data team)

Most of these were answered on 2026-11-11 by reading the mirror. See section 11.

1. Can the supplier master (name, country, currency, terms) be added to the mirror?
2. Can `pogrn` (goods received notes) and `stmove` (stock movements) be mirrored? They unlock exact dock events and real stock history.
3. Purchase ledger and sales ledger transactions: are they in Fabric anywhere? (purchase invoices, receipts, payments)
4. Mirror names for the 📄 columns: SO header customer account, PO line price, `oduedate`, `ackdate`, `sqtycan`, `despdate`, `stloc`, `ospurch`, `latecost`.
5. `StxSTLOC` columns: location name and type.
6. What are `ES######` sales order refs? Include or exclude?
7. Which `StxDLCUST` code marks intercompany customers?
8. Retention: earliest `PORD_DATEORD` and `SOH_ORDDATE` still in the mirror.

## 11. What the mirror holds: checked 2026-11-11

The mirror's tables and columns were read directly on 2026-11-11. This answers most of section 10. Where this section and the tables above disagree, this section is right.

### Answers to section 10

| # | Question | Answer |
|---|---|---|
| 1 | Supplier master | **In the mirror.** `StxPLSUPP`: `PLSUP_SUPPLIER`, `PLSUP_NDCODE`, `PLSUP_CURRENCY`, `PLSUP_TERMCODE`. Names come from `StxNDMAS` (`NDM_NDCODE`, `NDM_NAME`, `NDM_COUNTRY`). Payment terms in days come from `StxPLTERM` (`PLTC_CODE`, `PLTC_DAYS1`) |
| 2 | Goods received notes and stock movements | **Not in the mirror.** Still to ask for. Until then a delivery is dated from `POIT_LASTDEL`, and stock history is worked back from today |
| 3 | Purchase and sales ledgers | **Not in the mirror.** No supplier bills, no payments either way. `StxSOINVOICE` does hold `SOINV_DUEDATE` and `SOINV_VATTOT` |
| 4 | Mirror names for the unconfirmed columns | See the table below |
| 5 | `StxSTLOC` columns | `STLOC_LOC`, `STLOC_COMPANY`, `STLOC_NDCODE`, `STLOC_DESC` |
| 6 | `ES` sales order refs | Almost none exist. Ignore them. Every header in the mirror has order type `O`: quotes and credit orders are not there. Credit notes show up as `SOINV_TYPE = 'C'` |
| 7 | Intercompany customer flag | **Still open.** Candidates on `StxDLCUST`: `DLCUS_GRPACCIND`, `DLCUS_GROUP`, `DLCUS_DIV` |
| 8 | Retention | Purchase and sales order headers go back many years. History has not been purged from the mirror |

### Column names confirmed

| Need | Column | Was |
|---|---|---|
| Sales order customer | `SOH_ACCOUNT` | 📄 |
| Sales order status | `SOH_STATUS` (`C` complete, `I`, `H`) | new |
| Sales line warehouse | `SOI_STLOC`, and `SOH_STLOC` on the header | 📄 |
| Sales line number | `SOI_SEQ`, `SOI_LINSEQ` | 📄 |
| PO line number | `POIT_LINE` | 📄 |
| PO line price and value | `POIT_PRICE`, `POIT_VALORD`, `POIT_VALDEL`, `POIT_VALINV` | ❓ |
| PO currency | `PORD_CURRENCY` | new |
| PO confirmed by supplier | `PORD_ACKDATE`, `PORD_ACKREF`, `PORD_ACKSTATUS` | 📄 |
| PO expected delivery | `POIT_EDD`, and `PORD_DELDATE` on the header | new |
| PO invoiced quantity | `POIT_QTYINV`, `PORD_INVQTY` | new |
| Stock on order | `STK_OSPURCH` | 📄 |
| Product cost | `CMP_CURCOST`, `CMP_LASTCOST`, `CMP_ESTCOST`, per `CMP_PERPU` units. Also `StxPRODUCTCOSTS` (`PRODUCT`, `COMPANY`, `GBPCOST`, `COST`, `CURRENCY`) | 📄 |
| Product status | `CMP_STATUS`, `CMP_ORDSTAT` | 📄 |
| Customer name | `DLCUS_NDCODE` → `StxNDMAS.NDM_NAME` | ❓ |

### Who raised and entered orders (added 2026-11-11)

| Need | Column | Notes |
|---|---|---|
| Who raised a purchase order | `PORD_USERID` | Filled on every recent order. `PORD_AUTHOR` is also there but sometimes blank |
| Who entered a sales order | `SOH_USERID` | Filled on every recent order. `SOH_AUTHOR` is blank |

The adapter replaces each user id with an alias ("Buyer 01", "Sales 14") before anything is written. The real ids never leave the ingest run. Most ids both raise purchase orders and enter sales orders. A few do far more in a day than a person could, which suggests a system or automated feed.

### Not in the mirror

| Wanted | Effect on the world |
|---|---|
| Original due date and slip count (`oduedate`, `duecount`) | "Promised versus now" cannot be shown. Only today's due date is known |
| Cancelled quantity on a PO line | A closed line that came up short is treated as delivered in full at the short quantity |
| Despatch date on a sales line | The invoice date stands in for the ship date |
| Latest cost per stock location (`latecost`) | Stock is valued at `CMP_CURCOST / CMP_PERPU` |
| Lead time, minimum order quantity | Lead time is taken from each supplier's own orders |

### What the data is like

Things that shape how the world reads the feed. No figures here, on purpose.

- **Due dates.** Many open PO lines have no `POIT_DUEDATE`. `POIT_REQDATE`, `POIT_EDD` or the header's `PORD_DELDATE` nearly always fills the gap, so the adapter takes the first of those that is a real date.
- **Supplier confirmation is not reliably recorded.** A large share of orders that go on to be delivered have no `PORD_ACKDATE`. The adapter treats an order with no confirmation date as confirmed when raised, so "not confirmed" alerts are off for this feed.
- **Old open orders.** Some PO lines are still open long after their due date, and some sales lines long after their committed date. They look like orders that were never closed rather than deliveries still expected. They swell the late counts.
- **Uninvoiced sales lines.** `StxSOITEM` holds a very large number of old uninvoiced lines with status `1`. Open orders have to be found through the header (`SOH_STATUS <> 'C'` and a recent `SOH_ORDDATE`), not from the lines alone.
- **Many products, few stocked.** The product master is far larger than the set of products with stock or movement. The adapter keeps only products that are stocked, on order or sold in the window.
- **Categories.** There are too many `CMP_CATEGORY` codes for twelve stock plots. The adapter uses the business line (`CMP_ANALCODE`, named by `StxAPDESC` type `M`): the eleven biggest by stock value, and one plot for the rest.

### Still to ask the data team

1. Can `pogrn` (goods received notes) and `stmove` (stock movements) be added to the mirror?
2. Can the purchase and sales ledger transactions be added, or are they in Fabric somewhere else?
3. Which `StxDLCUST` code marks an intercompany customer?
4. Should PO lines open long past their due date be treated as dead orders? Is there a rule for closing them?
5. What do `SOH_STATUS` values `I` and `H` mean exactly?
