"""Builds a canonical dataset from the UK orders mirror, for a look-back over a date range.

    python -m aierp_ingest.snapshot --start 2026-10-01

Output goes to data/real/<name>/ as one JSON file per entity, the same shape as data/dummy.
data/real is gitignored: real data must never reach the public repository.

The mirror holds the current position, not history. What this rebuilds, and how, is listed in
REBUILT below and written into the dataset's meta so the world can say what is simulated.
"""
import argparse
import json
import os
from datetime import date, timedelta

import pandas as pd

from .config import REAL_DIR
from .postcodes import area_of, locate
from .pull import pull_all

SCHEMA_VERSION = 1
UNKNOWN_DATE = "2099-12-31"
PLOT_COUNT = 12
EARLIEST = pd.Timestamp("2000-01-02")
# The source writes "to be confirmed" as a date decades away.
LATEST = pd.Timestamp("2040-01-01")

REBUILT = [
    "Stock before today is worked back from today's stock using deliveries and shipments. Adjustments, transfers and returns are not in the feed.",
    "A delivery is dated at the purchase order line's last delivery date. Part deliveries on earlier days are folded into it.",
    "Deliveries are shown as put away on the day they arrive. The feed has no put-away time.",
    "A sales order is split into one shipment per invoice, shipped on the invoice date. Picking is assumed the same day, allocation the working day before.",
    "A purchase order with no confirmation date is treated as confirmed when raised: confirmations are not reliably recorded.",
    "Customers on stop today are shown on stop for the whole period.",
    "People are the user ids on purchase and sales orders, always shown by alias. A user id may be a system or an automated feed, not a person: those show up with far more work than fits in a day.",
    "A sales order shipped in parts is several records sharing one source order id. Entering it counts once, for the parts and lines the look-back holds.",
    "A customer is placed by the postcode area it has most deliveries to, or failing that its account address. Positions are to the nearest postcode area. Customers outside the UK have no position.",
    "Customer payments, supplier bills and supplier payments are not in the feed. Debtors, creditors and cash are simulated: every invoice is paid on its due date.",
]


def iso(value) -> str | None:
    """A source timestamp as YYYY-MM-DD, or None when the source holds no real date."""
    if value is None or pd.isna(value):
        return None
    stamp = pd.Timestamp(value)
    if stamp.tzinfo is not None:
        stamp = stamp.tz_localize(None)
    if stamp < EARLIEST or stamp > LATEST:
        return None
    return stamp.date().isoformat()


def add_days(day: str, days: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def workday(day: str, step: int = 1) -> str:
    """The same day if it is a weekday, otherwise the next (or previous) weekday."""
    current = date.fromisoformat(day)
    while current.weekday() >= 5:
        current += timedelta(days=step)
    return current.isoformat()


def money(value) -> float:
    return round(float(value), 2)


def build(start: str, end: str, real_names: bool, refresh: bool) -> tuple[dict, dict]:
    raw = pull_all(date.fromisoformat(start), refresh)
    notes: dict[str, int] = {}

    # ---- Products and their unit cost
    products = raw["products"].drop_duplicates("product").set_index("product")
    per_unit = products["per_unit"].astype(float).where(lambda s: s > 0, 1.0)
    products["unit_cost"] = (products["cost"].astype(float) / per_unit).fillna(0.0)
    unit_cost = products["unit_cost"].to_dict()

    # ---- Purchase orders
    headers = raw["po_headers"].drop_duplicates("po").set_index("po")
    lines = raw["po_lines"].copy()
    notes["purchase order lines left out: order older than the window"] = int((~lines["po"].isin(headers.index)).sum())
    lines = lines[lines["po"].isin(headers.index) & lines["product"].isin(products.index)]
    for column in ("qty_ordered", "stock_qty_ordered", "qty_delivered", "value_ordered"):
        lines[column] = lines[column].astype(float)

    purchase_orders, receipts = [], []
    received_by_product: dict[str, float] = {}
    for po, group in lines.groupby("po", sort=True):
        header = headers.loc[po]
        order_date = iso(header["order_date"])
        if order_date is None:
            continue
        po_lines, delivered = [], {}
        for number, row in enumerate(group.sort_values("line").itertuples(), start=1):
            # Quantities are held in purchase units and stock units. The world counts stock units.
            factor = row.stock_qty_ordered / row.qty_ordered if row.stock_qty_ordered > 0 else 1.0
            got = max(0.0, row.qty_delivered) * factor
            # A closed line that came up short will never deliver the rest, so only what arrived counts.
            qty = got if row.status == "C" else max(row.qty_ordered * factor, got)
            if qty <= 0:
                continue
            cost = unit_cost.get(row.product, 0.0) or (row.value_ordered / (row.qty_ordered * factor) if row.qty_ordered else 0.0)
            due = iso(row.due_date) or iso(row.required_date) or iso(row.expected_date) or iso(header["delivery_date"]) or UNKNOWN_DATE
            po_lines.append({"line": number, "productId": row.product, "qty": round(qty, 3), "unitCost": money(cost),
                             "dueDate": due, "originalDueDate": due})
            arrived = iso(row.last_delivery)
            if got > 0 and arrived is not None:
                arrived = max(arrived, order_date)
                delivered.setdefault(arrived, []).append({"line": number, "qty": round(got, 3)})
                received_by_product[row.product] = received_by_product.get(row.product, 0.0) + got
        if not po_lines:
            continue
        purchase_orders.append({
            "id": po, "supplierId": header["supplier"], "orderDate": order_date,
            "raisedBy": header["raised_by"] or None,
            "acknowledgedDate": iso(header["ack_date"]) or order_date, "lines": po_lines,
        })
        for arrived, received in sorted(delivered.items()):
            receipts.append({"id": f"{po}@{arrived}", "purchaseOrderId": po, "date": arrived,
                             "putawayDate": arrived, "lines": received})

    # ---- Sales: one shipment per invoice, plus whatever is still open
    so_headers = raw["so_headers"].drop_duplicates("so").set_index("so")
    invoices_raw = raw["invoices"].set_index("invoice")
    credit_notes = set(invoices_raw.index[invoices_raw["kind"] == "C"])
    invoiced = raw["so_invoiced_lines"].copy()
    invoiced["qty"] = invoiced["qty"].astype(float)
    invoiced["price"] = invoiced["price"].astype(float)
    invoiced["net"] = invoiced["qty"] * invoiced["price"]
    net_by_invoice = invoiced.groupby("invoice")["net"].sum().to_dict()

    def committed(group, fallback: str) -> str:
        dates = [iso(v) for v in group["committed_date"]] + [iso(v) for v in group["required_date"]]
        dates = [d for d in dates if d is not None]
        return max(dates) if dates else fallback

    sales_orders = []

    def entered_by(header) -> str | None:
        return (header["entered_by"] or None) if header is not None else None

    shipped_by_product: dict[str, float] = {}
    shipment_of_invoice: dict[str, str] = {}
    shipments = invoiced[(invoiced["qty"] > 0) & invoiced["product"].isin(products.index) & ~invoiced["invoice"].isin(credit_notes)]
    for (so, invoice), group in shipments.groupby(["so", "invoice"], sort=True):
        shipped = iso(group["invoice_date"].max())
        if shipped is None or shipped < start:
            continue
        header = so_headers.loc[so] if so in so_headers.index else None
        if header is not None and header["order_type"] == "Q":
            continue
        customer = header["customer"] if header is not None else invoices_raw["customer"].get(invoice)
        if not customer:
            continue
        order_date = min(iso(header["order_date"]) or shipped, shipped) if header is not None else shipped
        merged = group.groupby("product", sort=True).agg(qty=("qty", "sum"), net=("net", "sum"))
        shipment_id = f"{so}_{invoice}"
        shipment_of_invoice[invoice] = shipment_id
        sales_orders.append({
            "id": shipment_id, "customerId": customer, "sourceOrderId": so, "enteredBy": entered_by(header), "orderDate": order_date,
            "committedDate": max(committed(group, shipped), order_date),
            "allocatedDate": max(order_date, workday(add_days(shipped, -1), -1)),
            "pickedDate": shipped, "shippedDate": shipped, "deliveredDate": add_days(shipped, 1),
            "lines": [{"line": n, "productId": product, "qty": round(row.qty, 3), "unitPrice": money(row.net / row.qty)}
                      for n, (product, row) in enumerate(merged.iterrows(), start=1)],
        })
        for product, row in merged.iterrows():
            shipped_by_product[product] = shipped_by_product.get(product, 0.0) + row.qty

    open_lines = raw["so_open_lines"].copy()
    open_lines["qty"] = open_lines["qty"].astype(float)
    open_lines["price"] = open_lines["price"].astype(float)
    open_lines = open_lines[open_lines["product"].isin(products.index) & open_lines["so"].isin(so_headers.index)]
    for so, group in open_lines.groupby("so", sort=True):
        header = so_headers.loc[so]
        order_date = iso(header["order_date"])
        if order_date is None or order_date > end:
            continue
        merged = group.assign(net=group["qty"] * group["price"]).groupby("product", sort=True).agg(qty=("qty", "sum"), net=("net", "sum"))
        # Line status 2 and 6 mean stock is allocated today. When that happened is not held.
        allocated = bool(group["line_status"].isin(["2", "6"]).all())
        sales_orders.append({
            "id": f"{so}_OPEN", "customerId": header["customer"], "sourceOrderId": so, "enteredBy": entered_by(header), "orderDate": order_date,
            # No committed date on any line means nothing was promised, so the order cannot be late.
            "committedDate": max(committed(group, UNKNOWN_DATE), order_date),
            "allocatedDate": end if allocated else None, "pickedDate": None, "shippedDate": None, "deliveredDate": None,
            "lines": [{"line": n, "productId": product, "qty": round(row.qty, 3), "unitPrice": money(row.net / row.qty)}
                      for n, (product, row) in enumerate(merged.iterrows(), start=1)],
        })

    # ---- Sales invoices. Paid dates are simulated: see REBUILT.
    sales_invoices = []
    for invoice, row in invoices_raw.iterrows():
        invoiced_on = iso(row["invoice_date"])
        net = net_by_invoice.get(invoice, 0.0)
        if invoiced_on is None or invoiced_on > end or not row["customer"] or abs(net) < 0.005:
            continue
        due = iso(row["due_date"]) or add_days(invoiced_on, 30)
        due = max(due, invoiced_on)
        paid = workday(due)
        sales_invoices.append({
            "id": invoice, "salesOrderId": shipment_of_invoice.get(invoice, f"{row['so']}_{invoice}"),
            "customerId": row["customer"], "date": invoiced_on,
            "net": money(-abs(net) if row["kind"] == "C" else net),
            "dueDate": due, "paidDate": paid if paid <= end else None,
        })

    # ---- Suppliers, with bills simulated from deliveries
    supplier_rows = raw["suppliers"].drop_duplicates("supplier").set_index("supplier")
    term_days = raw["supplier_terms"].set_index("term_code")["days"].to_dict()
    supplier_ids = sorted({order["supplierId"] for order in purchase_orders})
    lead_days: dict[str, list[int]] = {}
    for order in purchase_orders:
        due = order["lines"][0]["dueDate"]
        if due != UNKNOWN_DATE:
            lead_days.setdefault(order["supplierId"], []).append((date.fromisoformat(due) - date.fromisoformat(order["orderDate"])).days)

    def supplier_terms(supplier: str) -> int:
        code = supplier_rows["term_code"].get(supplier) if supplier in supplier_rows.index else None
        days = term_days.get(code)
        return int(days) if days is not None and not pd.isna(days) and int(days) > 0 else 30

    order_by_id = {order["id"]: order for order in purchase_orders}
    purchase_invoices = []
    for receipt in receipts:
        order = order_by_id[receipt["purchaseOrderId"]]
        cost_by_line = {line["line"]: line["unitCost"] for line in order["lines"]}
        billed = workday(add_days(receipt["date"], 3))
        if billed > end:
            continue
        due = add_days(billed, supplier_terms(order["supplierId"]))
        paid = workday(due)
        purchase_invoices.append({
            "id": f"BILL-{receipt['id']}", "purchaseOrderId": order["id"], "goodsReceiptId": receipt["id"],
            "supplierId": order["supplierId"], "date": billed,
            "net": money(sum(line["qty"] * cost_by_line[line["line"]] for line in receipt["lines"])),
            "dueDate": due, "paidDate": paid if paid <= end else None,
        })

    # ---- Stock: today's position worked back to the start
    stock_today = raw["stock"].set_index("product")["qty"].astype(float).to_dict()
    used = set(stock_today) | set(received_by_product) | set(shipped_by_product)
    used |= {line["productId"] for order in purchase_orders for line in order["lines"]}
    used |= {line["productId"] for order in sales_orders for line in order["lines"]}
    used &= set(products.index)
    last_receipt = {row.product: iso(row.last_delivery) for row in raw["last_receipts"].itertuples()}
    notes["products with stock and no delivery on record: age unknown, shown as a year old"] = sum(
        1 for product in used if stock_today.get(product, 0) > 0 and not last_receipt.get(product))
    unknown_age = add_days(start, -365)
    opening_stock = [{
        "productId": product,
        "qty": round(stock_today.get(product, 0.0) - received_by_product.get(product, 0.0) + shipped_by_product.get(product, 0.0), 3),
        "lastReceiptDate": last_receipt.get(product) or unknown_age,
    } for product in sorted(used)]

    # ---- Categories: the biggest business lines by stock value, and one plot for the rest
    line_names = raw["descriptions"][raw["descriptions"]["kind"] == "M"].drop_duplicates("code").set_index("code")["name"].to_dict()
    value_by_line: dict[str, float] = {}
    for product in used:
        code = products.at[product, "line_code"] or "NONE"
        value_by_line[code] = value_by_line.get(code, 0.0) + max(0.0, stock_today.get(product, 0.0)) * unit_cost.get(product, 0.0)
    top = [code for code, _ in sorted(value_by_line.items(), key=lambda item: (-item[1], item[0]))[:PLOT_COUNT - 1]]
    categories = [{"id": code, "name": line_names.get(code) or code} for code in top]
    categories.append({"id": "OTHER", "name": f"{max(0, len(value_by_line) - len(top))} other lines"})
    top_set = set(top)

    def alias(kind: str, ids: list[str]) -> dict[str, str]:
        return {identifier: f"{kind} {index:04d}" for index, identifier in enumerate(sorted(ids), start=1)}

    product_suppliers = {products.at[product, "supplier"] for product in used if products.at[product, "supplier"]}
    supplier_ids = sorted(set(supplier_ids) | product_suppliers)
    customer_ids = sorted({order["customerId"] for order in sales_orders} | {invoice["customerId"] for invoice in sales_invoices})
    supplier_alias, customer_alias = alias("Supplier", supplier_ids), alias("Customer", customer_ids)
    customer_rows = raw["customers"].drop_duplicates("customer").set_index("customer")

    def supplier_name(supplier: str) -> str:
        name = supplier_rows["name"].get(supplier) if supplier in supplier_rows.index else None
        return name if real_names and isinstance(name, str) and name else supplier_alias[supplier]

    def customer_name(customer: str) -> str:
        name = customer_rows["name"].get(customer) if customer in customer_rows.index else None
        return name if real_names and isinstance(name, str) and name else customer_alias[customer]

    def median(values: list[int], fallback: int) -> int:
        usable = sorted(value for value in values if value > 0)
        return usable[len(usable) // 2] if usable else fallback

    suppliers = [{"id": supplier, "name": supplier_name(supplier), "leadTimeDays": median(lead_days.get(supplier, []), 14)}
                 for supplier in supplier_ids]
    terms_seen: dict[str, list[int]] = {}
    for invoice in sales_invoices:
        terms_seen.setdefault(invoice["customerId"], []).append((date.fromisoformat(invoice["dueDate"]) - date.fromisoformat(invoice["date"])).days)
    # Where each customer is: the postcode area most of its deliveries go to, else its account address.
    delivery_areas = raw["so_headers"].assign(area=raw["so_headers"]["delivery_postcode"].map(area_of)).dropna(subset=["area"])
    usual_area = delivery_areas.groupby("customer")["area"].agg(lambda areas: areas.mode().iloc[0]).to_dict()

    def customer_location(customer: str, row) -> dict | None:
        area = usual_area.get(customer)
        if area is not None:
            return locate(f"{area}1")
        return locate(row["postcode"]) if row is not None else None

    # The site is the stock location holding the most stock, unless .env names a postcode.
    busiest = raw["stock_by_location"].sort_values("qty", ascending=False)["loc"]
    location_postcodes = raw["locations"].set_index("loc")["postcode"].to_dict()
    site = locate(os.environ.get("AI_ERP_SITE_POSTCODE"))
    for loc in busiest:
        if site is not None:
            break
        site = locate(location_postcodes.get(loc))
    notes["customers with no position: outside the UK or no usable postcode"] = 0

    on_stop_from = add_days(start, -1)
    customers = []
    for customer in customer_ids:
        row = customer_rows.loc[customer] if customer in customer_rows.index else None
        limit = float(row["credit_limit"]) if row is not None and not pd.isna(row["credit_limit"]) else 0.0
        customers.append({
            "id": customer, "name": customer_name(customer), "creditLimit": money(limit),
            "termsDays": median(terms_seen.get(customer, []), 30),
            "onStopFrom": on_stop_from if row is not None and row["stop"] == "Y" else None,
            "location": customer_location(customer, row),
        })
        if customers[-1]["location"] is None:
            notes["customers with no position: outside the UK or no usable postcode"] += 1

    # ---- People: the user ids behind the orders, replaced with aliases. The real ids go no further than this function.
    raised: dict[str, int] = {}
    entered: dict[str, int] = {}
    for order in purchase_orders:
        if order["raisedBy"]:
            raised[order["raisedBy"]] = raised.get(order["raisedBy"], 0) + 1
    for user in {(order["sourceOrderId"], order["enteredBy"]) for order in sales_orders if order["enteredBy"]}:
        entered[user[1]] = entered.get(user[1], 0) + 1
    people, person_id = [], {}
    counters = {"Buyer": 0, "Sales": 0, "Buyer and sales": 0}
    # Numbered from the busiest down, so "Buyer 01" is whoever raised the most orders.
    for user in sorted(set(raised) | set(entered), key=lambda u: (-(raised.get(u, 0) + entered.get(u, 0)), u)):
        role = "Buyer and sales" if user in raised and user in entered else "Buyer" if user in raised else "Sales"
        counters[role] += 1
        person_id[user] = f"PER{len(people) + 1:04d}"
        people.append({"id": person_id[user], "name": f"{role} {counters[role]:02d}"})
    for order in purchase_orders:
        order["raisedBy"] = person_id.get(order["raisedBy"])
    for order in sales_orders:
        order["enteredBy"] = person_id.get(order["enteredBy"])

    dataset = {
        "meta": {
            "schemaVersion": SCHEMA_VERSION,
            "source": "UK orders mirror, look-back",
            "seed": None,
            "startDate": start,
            "endDate": end,
            "openingCash": 0,
            "site": site,
            "simulated": ["debtors", "creditors", "cash"],
        },
        "people": people,
        "suppliers": suppliers,
        "customers": customers,
        "categories": categories,
        "products": [{
            "id": product,
            "description": products.at[product, "description"] or product,
            "categoryId": (products.at[product, "line_code"] or "NONE") if (products.at[product, "line_code"] or "NONE") in top_set else "OTHER",
            "supplierId": products.at[product, "supplier"] or supplier_ids[0],
            "unitCost": money(unit_cost.get(product, 0.0)),
            "sellPrice": money(products.at[product, "sell_price"] or 0.0),
        } for product in sorted(used)],
        "openingStock": opening_stock,
        "purchaseOrders": purchase_orders,
        "goodsReceipts": receipts,
        "salesOrders": sales_orders,
        "salesInvoices": sales_invoices,
        "purchaseInvoices": purchase_invoices,
    }
    report = {
        "range": f"{start} to {end}",
        "names": "real" if real_names else "aliases",
        "counts": {name: len(value) for name, value in dataset.items() if isinstance(value, list)},
        "rebuilt": REBUILT,
        "left out": notes,
    }
    return dataset, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start", default="2026-10-01", help="first day of the look-back")
    parser.add_argument("--end", default=(date.today() - timedelta(days=1)).isoformat(), help="last day (default: yesterday)")
    parser.add_argument("--name", default="lookback", help="folder under data/real to write")
    parser.add_argument("--real-names", action="store_true", help="keep real supplier and customer names (default: aliases)")
    parser.add_argument("--refresh", action="store_true", help="pull from Fabric again instead of using the cache")
    args = parser.parse_args()

    dataset, report = build(args.start, args.end, args.real_names, args.refresh)
    out = REAL_DIR / args.name
    out.mkdir(parents=True, exist_ok=True)
    for name, value in dataset.items():
        text = (json.dumps(value, indent=2) if isinstance(value, dict)
                else "[\n" + ",\n".join(json.dumps(record, separators=(",", ":")) for record in value) + "\n]")
        (out / f"{name}.json").write_text(text + "\n", encoding="utf-8")
    (out / "REPORT.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("range", "names", "counts", "left out")}, indent=2))
    print(f"written to {out}")


if __name__ == "__main__":
    main()
