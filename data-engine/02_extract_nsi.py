"""Slice the NSI population workbook down to the active district, fold age
columns into our two target groups, and emit demographic weights CSV."""

import pandas as pd
from config import NSI_XLSX_PATH, OUT_DIR, ACTIVE_DISTRICT, ACTIVE_BBOX

# --- Adjust these to match the actual workbook after inspection ---
SHEET = 0                      # or the exact sheet name for the district
HEADER_ROW = 3                 # 0-indexed row holding the real column headers
COL_DISTRICT   = "Област"      # district
COL_SETTLEMENT = "Населено място"
# Age-band columns (NSI single-year or 5-year bands). Map them to our groups:
CHILDREN_COLS = ["0", "1", "2", "3", "4", "5", "6"]          # ages 0–6
SENIORS_COLS  = ["65-69", "70-74", "75-79", "80-84", "85+"]  # ages 65+

# Settlement centroids: for the hackathon, approximate with the district bbox
# center, or join a small settlement->lat/lon lookup CSV if available.
MIN_LON, MIN_LAT, MAX_LON, MAX_LAT = ACTIVE_BBOX
FALLBACK_LAT = (MIN_LAT + MAX_LAT) / 2
FALLBACK_LON = (MIN_LON + MAX_LON) / 2

def to_int(series):
    return (pd.to_numeric(series, errors="coerce").fillna(0).astype(int))

def main():
    raw = pd.read_excel(NSI_XLSX_PATH, sheet_name=SHEET, header=HEADER_ROW)
    raw.columns = [str(c).strip() for c in raw.columns]

    # Slice to the active district (case-insensitive contains)
    mask = raw[COL_DISTRICT].astype(str).str.contains(ACTIVE_DISTRICT, case=False, na=False)
    d = raw[mask].copy()
    print(f"{ACTIVE_DISTRICT}: {len(d)} settlement rows")

    children = sum(to_int(d[c]) for c in CHILDREN_COLS if c in d.columns)
    seniors  = sum(to_int(d[c]) for c in SENIORS_COLS  if c in d.columns)

    records = []
    for i, (_, row) in enumerate(d.iterrows()):
        settlement = str(row.get(COL_SETTLEMENT, f"cell_{i}")).strip()
        cell_id = f"{ACTIVE_DISTRICT}-{i:04d}"
        # TODO: replace fallback centroid with real settlement coords when available
        lat, lon = FALLBACK_LAT, FALLBACK_LON
        records.append((cell_id, settlement, "children_0_6", int(children.iloc[i]), lat, lon))
        records.append((cell_id, settlement, "seniors_65p",  int(seniors.iloc[i]),  lat, lon))

    out_df = pd.DataFrame(records, columns=[
        "cell_id", "settlement", "group_key", "population", "lat", "lon"
    ])
    out_df["district"] = ACTIVE_DISTRICT
    out_df = out_df[out_df["population"] > 0].reset_index(drop=True)

    out = OUT_DIR / "demographic_weights.csv"
    out_df.to_csv(out, index=False)
    print(f"Wrote {len(out_df)} weight rows -> {out}")
    print(out_df.groupby("group_key")["population"].sum().to_string())

if __name__ == "__main__":
    main()
