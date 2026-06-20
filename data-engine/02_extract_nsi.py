"""Build the demand layer by fusing NSI demographics with GeoNames geography.

NSI gives WHO and HOW MANY but only at province x age x urban/rural granularity (no
coordinates). GeoNames gives WHERE — every settlement's lat/lon, province and size.
We fold NSI's age bands into our two cohorts (children_0_6, seniors_65p), split by
urban/rural, then distribute each province's cohort totals across that province's
settlements proportionally to settlement size. Result: a geocoded, per-settlement
demand grid whose provincial sums still equal the official NSI figures.
"""

import re
from collections import defaultdict

import numpy as np
import openpyxl

from config import (NSI_XLSX_PATH, OUT_DIR, PROVINCES, CHILD_BANDS, SENIOR_BANDS,
                    VILLAGE_DEFAULT_WEIGHT)
from geonames import load_settlements
import pandas as pd

# Column offsets within an NSI row: total / urban (в градовете) / rural (в селата), "all" sex.
COL_TOTAL_ALL, COL_URBAN_ALL, COL_RURAL_ALL = 1, 4, 7


def _norm(v) -> str:
    return re.sub(r"\s+", " ", str(v).replace("\xa0", " ")).strip()


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def parse_nsi() -> dict:
    """{district: {'urban': {group: count}, 'rural': {group: count}}} from the workbook."""
    wb = openpyxl.load_workbook(NSI_XLSX_PATH, read_only=True, data_only=True)
    rows = list(wb["Sheet1"].iter_rows(values_only=True))

    nsi = {}
    current = None
    for r in rows:
        label = _norm(r[0]) if r and r[0] is not None else ""
        if label in PROVINCES:                      # province header row -> start a block
            current = PROVINCES[label][1]           # Latin district name
            nsi[current] = {"urban": defaultdict(float), "rural": defaultdict(float)}
            continue
        if current is None:
            continue                                # inside the country-total block, skip
        # age-band row: add its contribution to whichever cohort(s) it feeds
        urban, rural = r[COL_URBAN_ALL], r[COL_RURAL_ALL]
        for bands, group in ((CHILD_BANDS, "children_0_6"), (SENIOR_BANDS, "seniors_65p")):
            if label in bands:
                nsi[current]["urban"][group] += bands[label] * _num(urban)
                nsi[current]["rural"][group] += bands[label] * _num(rural)
    return nsi


def main():
    nsi = parse_nsi()
    settlements = load_settlements()
    print(f"NSI: {len(nsi)} provinces parsed | GeoNames: {len(settlements)} settlements")

    # geonameid -> {group_key: population}, plus its metadata. Accumulating (rather than
    # appending) keeps one row per (cell, cohort) even if a fallback spreads both urban
    # and rural totals onto the same settlement.
    pop = defaultdict(lambda: defaultdict(int))
    meta = {}

    for district, by_res in nsi.items():
        d_set = settlements[settlements["district"] == district]
        for residence in ("urban", "rural"):
            sub = d_set[d_set["is_urban"] == (residence == "urban")]
            if sub.empty:                            # province has no settlement of this kind
                sub = d_set                          # -> spread its people across the province
            if sub.empty:
                continue
            weights = np.where(sub["geo_pop"].to_numpy() > 0,
                               sub["geo_pop"].to_numpy(), VILLAGE_DEFAULT_WEIGHT).astype(float)
            wsum = weights.sum()
            for group_key, total in by_res[residence].items():
                if total <= 0:
                    continue
                alloc = np.round(total * weights / wsum).astype(int)
                for row, a in zip(sub.itertuples(), alloc):
                    if a > 0:
                        pop[row.geonameid][group_key] += int(a)
                        meta[row.geonameid] = (row.settlement, district, row.lat, row.lon)

    records = [
        (gid, meta[gid][0], meta[gid][1], meta[gid][2], meta[gid][3], group_key, n)
        for gid, groups in pop.items()
        for group_key, n in groups.items() if n > 0
    ]
    out_df = pd.DataFrame(records, columns=[
        "cell_id", "settlement", "district", "lat", "lon", "group_key", "population"])

    out = OUT_DIR / "demographic_weights.csv"
    out_df.to_csv(out, index=False)
    print(f"Wrote {len(out_df)} weight rows across {out_df['district'].nunique()} provinces -> {out}")
    print(out_df.groupby("group_key")["population"].sum().to_string())


if __name__ == "__main__":
    main()
