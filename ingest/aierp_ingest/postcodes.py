"""Rough positions for UK postcode areas, so customers can be placed by direction and distance.

Each entry is the approximate position of the area's main town. That is as precise as the world
needs: it only has to know which way a customer lies and roughly how far. Working it out here, from
a table, means no customer postcode is ever sent to an outside lookup service.
"""
import re

AREAS: dict[str, tuple[float, float]] = {
    "AB": (57.15, -2.10), "AL": (51.75, -0.34), "B": (52.48, -1.90), "BA": (51.38, -2.36), "BB": (53.75, -2.48),
    "BD": (53.79, -1.75), "BH": (50.72, -1.88), "BL": (53.58, -2.43), "BN": (50.83, -0.14), "BR": (51.41, 0.02),
    "BS": (51.45, -2.59), "BT": (54.60, -5.93), "CA": (54.89, -2.94), "CB": (52.20, 0.12), "CF": (51.48, -3.18),
    "CH": (53.19, -2.89), "CM": (51.73, 0.47), "CO": (51.89, 0.90), "CR": (51.37, -0.10), "CT": (51.28, 1.08),
    "CV": (52.41, -1.51), "CW": (53.10, -2.44), "DA": (51.45, 0.21), "DD": (56.46, -2.97), "DE": (52.92, -1.48),
    "DG": (55.07, -3.61), "DH": (54.78, -1.57), "DL": (54.52, -1.55), "DN": (53.52, -1.13), "DT": (50.71, -2.44),
    "DY": (52.51, -2.09), "E": (51.54, -0.03), "EC": (51.52, -0.09), "EH": (55.95, -3.19), "EN": (51.65, -0.08),
    "EX": (50.72, -3.53), "FK": (56.00, -3.78), "FY": (53.82, -3.05), "G": (55.86, -4.25), "GL": (51.86, -2.24),
    "GU": (51.24, -0.57), "GY": (49.45, -2.54), "HA": (51.58, -0.34), "HD": (53.65, -1.78), "HG": (53.99, -1.54),
    "HP": (51.75, -0.47), "HR": (52.06, -2.72), "HS": (58.21, -6.39), "HU": (53.74, -0.34), "HX": (53.72, -1.86),
    "IG": (51.56, 0.07), "IM": (54.15, -4.48), "IP": (52.06, 1.16), "IV": (57.48, -4.22), "JE": (49.19, -2.11),
    "KA": (55.61, -4.50), "KT": (51.41, -0.30), "KW": (58.44, -3.09), "KY": (56.20, -3.15), "L": (53.41, -2.98),
    "LA": (54.05, -2.80), "LD": (52.24, -3.38), "LE": (52.63, -1.13), "LL": (53.14, -3.80), "LN": (53.23, -0.54),
    "LS": (53.80, -1.55), "LU": (51.88, -0.42), "M": (53.48, -2.24), "ME": (51.39, 0.54), "MK": (52.04, -0.76),
    "ML": (55.78, -3.98), "N": (51.57, -0.11), "NE": (54.98, -1.61), "NG": (52.95, -1.15), "NN": (52.24, -0.90),
    "NP": (51.58, -3.00), "NR": (52.63, 1.30), "NW": (51.55, -0.19), "OL": (53.54, -2.12), "OX": (51.75, -1.26),
    "PA": (55.85, -4.42), "PE": (52.57, -0.24), "PH": (56.40, -3.43), "PL": (50.37, -4.14), "PO": (50.80, -1.09),
    "PR": (53.76, -2.70), "RG": (51.45, -0.97), "RH": (51.24, -0.17), "RM": (51.58, 0.18), "S": (53.38, -1.47),
    "SA": (51.62, -3.94), "SE": (51.48, -0.05), "SG": (51.90, -0.20), "SK": (53.41, -2.16), "SL": (51.51, -0.59),
    "SM": (51.36, -0.19), "SN": (51.56, -1.78), "SO": (50.90, -1.40), "SP": (51.07, -1.79), "SR": (54.91, -1.38),
    "SS": (51.54, 0.71), "ST": (53.00, -2.18), "SW": (51.47, -0.17), "SY": (52.71, -2.75), "TA": (51.02, -3.10),
    "TD": (55.60, -2.72), "TF": (52.68, -2.45), "TN": (51.13, 0.26), "TQ": (50.46, -3.53), "TR": (50.26, -5.05),
    "TS": (54.57, -1.23), "TW": (51.45, -0.34), "UB": (51.54, -0.42), "W": (51.51, -0.20), "WA": (53.39, -2.59),
    "WC": (51.52, -0.12), "WD": (51.66, -0.40), "WF": (53.68, -1.50), "WN": (53.55, -2.63), "WR": (52.19, -2.22),
    "WS": (52.59, -1.98), "WV": (52.59, -2.13), "YO": (53.96, -1.08), "ZE": (60.15, -1.14),
}

_AREA = re.compile(r"^\s*([A-Z]{1,2})\d")


def area_of(postcode) -> str | None:
    """The area letters of a UK postcode, e.g. "RG" from "RG24 8QQ". None if it is not one."""
    if not isinstance(postcode, str):
        return None
    match = _AREA.match(postcode.upper())
    return match.group(1) if match and match.group(1) in AREAS else None


def locate(postcode) -> dict | None:
    """Approximate position of a UK postcode, to the nearest postcode area. None if it cannot be placed."""
    area = area_of(postcode)
    if area is None:
        return None
    lat, lon = AREAS[area]
    return {"lat": lat, "lon": lon}
