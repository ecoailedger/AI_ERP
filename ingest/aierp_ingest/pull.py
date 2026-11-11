"""Pulls the rows the world needs from the mirror, and caches them on disk.

Every pull is saved as a parquet file under data/real/cache (gitignored). A second run reads the
cache and does not touch Fabric, unless asked to refresh. Read-only: nothing is written back.
"""
import hashlib
from datetime import date, timedelta

import pandas as pd
import pyarrow as pa
from deltalake import QueryBuilder

from . import lake
from .config import REAL_DIR

CACHE_DIR = REAL_DIR / "cache"
# Dates before this are the source's way of saying "no date".
VALID_FROM = "TIMESTAMP '2000-01-02'"


def _cached(name: str, tables: dict[str, str], sql: str, refresh: bool) -> pd.DataFrame:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(sql.encode("utf-8")).hexdigest()[:10]
    path = CACHE_DIR / f"{name}-{digest}.parquet"
    if path.exists() and not refresh:
        return pd.read_parquet(path)
    print(f"  pulling {name} ...", flush=True)
    builder = QueryBuilder()
    for alias, table in tables.items():
        builder = builder.register(alias, lake.table(table))
    frame = pa.table(builder.execute(sql).read_all()).to_pandas()
    frame.to_parquet(path, index=False)
    print(f"  cached {name}: {len(frame):,} rows", flush=True)
    return frame


def ts(day: date) -> str:
    return f"TIMESTAMP '{day.isoformat()}'"


def pull_all(start: date, refresh: bool = False) -> dict[str, pd.DataFrame]:
    """Everything needed to rebuild the world from `start` to today."""
    invoices_from = start - timedelta(days=100)  # unpaid invoices at the start are older than the start
    orders_from = start - timedelta(days=400)
    open_from = start - timedelta(days=180)
    po_from = start - timedelta(days=540)
    pull = lambda name, tables, sql: _cached(name, tables, sql, refresh)  # noqa: E731

    return {
        "products": pull("products", {"t": "StxCMPROD"}, """
            SELECT TRIM(CMP_PRODUCT) product, TRIM(CMP_DESC) description, TRIM(CMP_ANALCODE) line_code,
                   TRIM(CMP_SUPP) supplier, CMP_CURCOST cost, CMP_PERPU per_unit, CMP_SELLPR sell_price
            FROM t WHERE NOT IsDeleteFl"""),
        "stock": pull("stock", {"t": "StxSTOCK"}, """
            SELECT TRIM(STK_PRODUCT) product, SUM(STK_STKQTY) qty
            FROM t WHERE NOT IsDeleteFl GROUP BY 1 HAVING SUM(STK_STKQTY) <> 0"""),
        "locations": pull("locations", {"s": "StxSTLOC", "n": "StxNDMAS"}, """
            SELECT TRIM(s.STLOC_LOC) loc, MAX(TRIM(n.NDM_POSTCODE)) postcode
            FROM s LEFT JOIN n ON n.NDM_NDCODE = s.STLOC_NDCODE AND NOT n.IsDeleteFl
            WHERE NOT s.IsDeleteFl GROUP BY 1"""),
        "stock_by_location": pull("stock_by_location", {"t": "StxSTOCK"}, """
            SELECT TRIM(STK_LOC) loc, SUM(STK_STKQTY) qty
            FROM t WHERE NOT IsDeleteFl AND STK_STKQTY > 0 GROUP BY 1"""),
        "descriptions": pull("descriptions", {"t": "StxAPDESC"}, """
            SELECT TRIM(APDSC_TYPE) kind, TRIM(APDSC_CODE) code, TRIM(APDSC_NAME) name
            FROM t WHERE NOT IsDeleteFl AND APDSC_TYPE IN ('M', 'C')"""),
        "suppliers": pull("suppliers", {"s": "StxPLSUPP", "n": "StxNDMAS"}, """
            SELECT TRIM(s.PLSUP_SUPPLIER) supplier, TRIM(s.PLSUP_TERMCODE) term_code, MAX(TRIM(n.NDM_NAME)) name
            FROM s LEFT JOIN n ON n.NDM_NDCODE = s.PLSUP_NDCODE AND NOT n.IsDeleteFl
            WHERE NOT s.IsDeleteFl GROUP BY 1, 2"""),
        "supplier_terms": pull("supplier_terms", {"t": "StxPLTERM"}, """
            SELECT TRIM(PLTC_CODE) term_code, MAX(PLTC_DAYS1) days FROM t WHERE NOT IsDeleteFl GROUP BY 1"""),
        "customers": pull("customers", {"c": "StxDLCUST", "n": "StxNDMAS"}, """
            SELECT TRIM(c.DLCUS_CUSTOMER) customer, MAX(TRIM(n.NDM_NAME)) name, MAX(c.DLCUS_LIMIT) credit_limit,
                   MAX(TRIM(c.DLCUS_STOP)) stop, MAX(TRIM(n.NDM_POSTCODE)) postcode
            FROM c LEFT JOIN n ON n.NDM_NDCODE = c.DLCUS_NDCODE AND NOT n.IsDeleteFl
            WHERE NOT c.IsDeleteFl GROUP BY 1"""),
        "po_headers": pull("po_headers", {"t": "StxPORDER"}, f"""
            SELECT TRIM(PORD_ORDER) po, TRIM(PORD_SUPPLIER) supplier, PORD_DATEORD order_date,
                   PORD_ACKDATE ack_date, PORD_DELDATE delivery_date
            FROM t WHERE NOT IsDeleteFl AND PORD_TYPE = 'N' AND PORD_DATEORD >= {ts(po_from)}"""),
        "po_lines": pull("po_lines", {"t": "StxPOITEM"}, f"""
            SELECT TRIM(POIT_ORDER) po, POIT_LINE line, TRIM(POIT_PRODUCT) product, TRIM(POIT_STATUS) status,
                   POIT_QTYORD qty_ordered, POIT_SQTYORD stock_qty_ordered, POIT_QTYDEL qty_delivered,
                   POIT_VALORD value_ordered, POIT_LASTDEL last_delivery, POIT_DUEDATE due_date,
                   POIT_REQDATE required_date, POIT_EDD expected_date
            FROM t WHERE NOT IsDeleteFl AND POIT_QTYORD > 0
              AND ((POIT_STATUS = 'O' AND POIT_QTYORD > POIT_QTYDEL) OR POIT_LASTDEL >= {ts(start)})"""),
        "last_receipts": pull("last_receipts", {"t": "StxPOITEM"}, f"""
            SELECT TRIM(POIT_PRODUCT) product, MAX(POIT_LASTDEL) last_delivery
            FROM t WHERE NOT IsDeleteFl AND POIT_QTYDEL > 0 AND POIT_LASTDEL >= {VALID_FROM} AND POIT_LASTDEL < {ts(start)}
            GROUP BY 1"""),
        "so_headers": pull("so_headers", {"t": "StxSOHEAD"}, f"""
            SELECT TRIM(SOH_ORDREF) so, TRIM(SOH_ACCOUNT) customer, SOH_ORDDATE order_date, TRIM(SOH_STATUS) status,
                   TRIM(SOH_ORDTYPE) order_type, TRIM(SOH_DELPOST) delivery_postcode
            FROM t WHERE NOT IsDeleteFl AND SOH_ORDDATE >= {ts(orders_from)}"""),
        "so_invoiced_lines": pull("so_invoiced_lines", {"t": "StxSOITEM"}, f"""
            SELECT TRIM(SOI_ORDREF) so, TRIM(SOI_INVREF) invoice, TRIM(SOI_PRODUCT) product, SOI_ITQTY qty,
                   SOI_PRICE price, SOI_INVDATE invoice_date, SOI_COMDT2 committed_date, SOI_REQDATE required_date
            FROM t WHERE NOT IsDeleteFl AND TRIM(SOI_INVREF) <> '' AND SOI_INVDATE >= {ts(invoices_from)}"""),
        "so_open_lines": pull("so_open_lines", {"i": "StxSOITEM", "h": "StxSOHEAD"}, f"""
            SELECT TRIM(i.SOI_ORDREF) so, TRIM(i.SOI_PRODUCT) product, i.SOI_ITQTY qty, i.SOI_PRICE price,
                   TRIM(i.SOI_ITSTAT) line_status, i.SOI_COMDT2 committed_date, i.SOI_REQDATE required_date
            FROM i JOIN h ON h.SOH_ORDREF = i.SOI_ORDREF
            WHERE NOT i.IsDeleteFl AND NOT h.IsDeleteFl AND TRIM(i.SOI_INVREF) = '' AND i.SOI_ITQTY > 0
              AND h.SOH_STATUS <> 'C' AND h.SOH_ORDTYPE <> 'Q' AND h.SOH_ORDDATE >= {ts(open_from)}"""),
        "invoices": pull("invoices", {"t": "StxSOINVOICE"}, f"""
            SELECT TRIM(SOINV_INVREF) invoice, MAX(TRIM(SOINV_ORDREF)) so, MAX(TRIM(SOINV_ACCOUNT)) customer,
                   MAX(SOINV_INVDATE) invoice_date, MAX(SOINV_DUEDATE) due_date, MAX(TRIM(SOINV_TYPE)) kind
            FROM t WHERE NOT IsDeleteFl AND SOINV_INVDATE >= {ts(invoices_from)} GROUP BY 1"""),
    }
