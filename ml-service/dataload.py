"""File-based data layer for the Reclaim ML models.

Reads directly from ../datasets (no Postgres needed for training):
  - NSI Excel        -> demographic weights per district (children_0_6, seniors_65p)
  - GeoNames BG.txt  -> district centroid coordinates (ADM1)
  - OSM .pbf         -> infrastructure nodes (kindergarten/school/hospital/clinic/pharmacy)

Produces two pandas DataFrames mirroring the app's `demographic_weights` and
`infrastructure_nodes` tables, so the same models work later against Postgres.
"""

import csv
import re
from pathlib import Path

import pandas as pd

DATASETS = Path(__file__).resolve().parent.parent / "datasets"
NSI_XLSX = DATASETS / "Население по области, възраст, местоживеене и пол.xlsx"
GEONAMES = DATASETS / "BG" / "BG.txt"
PBF = DATASETS / "bulgaria-260618.osm.pbf"

# OSM amenity -> (service_type, target group)
AMENITY_MAP = {
    "kindergarten": ("kindergarten", "children_0_6"),
    "school":       ("school",       "children_0_6"),
    "hospital":     ("hospital",     "seniors_65p"),
    "clinic":       ("clinic",       "seniors_65p"),
    "doctors":      ("clinic",       "seniors_65p"),
    "pharmacy":     ("pharmacy",     "seniors_65p"),
}

# NSI districts that are NOT real province blocks
_SKIP_LABELS = {"Общо за страната"}


# --------------------------------------------------------------------------- #
# GeoNames: district (ADM1) centroids
# --------------------------------------------------------------------------- #
def load_district_coords():
    """Return {nsi_district_name: (lat, lon)} using GeoNames ADM1 entries."""
    adm1 = []
    with open(GEONAMES, encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="\t"):
            if len(row) < 19 or row[7] != "ADM1":
                continue
            adm1.append((row[1], float(row[4]), float(row[5]), row[3]))  # name, lat, lon, alt
    return adm1


def _match_coords(district, adm1):
    key = district.replace("(столица)", "").strip()
    for name, lat, lon, alt in adm1:
        if key in alt or key in name:
            return lat, lon
    return None


def load_admin1_index():
    """Return (code->(lat,lon,name,alt)) for ADM1 rows, to map GeoNames adm1 codes."""
    idx = {}
    with open(GEONAMES, encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="\t"):
            if len(row) < 19 or row[7] != "ADM1":
                continue
            idx[row[10]] = (float(row[4]), float(row[5]), row[1], row[3])
    return idx


def load_settlements():
    """Return DataFrame of GeoNames populated places with population>0:
    name, lat, lon, population, adm1_code."""
    rows = []
    with open(GEONAMES, encoding="utf-8") as f:
        for r in csv.reader(f, delimiter="\t"):
            if len(r) < 19 or r[6] != "P":
                continue
            pop = int(r[14]) if r[14].isdigit() else 0
            if pop <= 0:
                continue
            rows.append((r[1], float(r[4]), float(r[5]), pop, r[10]))
    return pd.DataFrame(rows, columns=["name", "lat", "lon", "population", "adm1_code"])


# --------------------------------------------------------------------------- #
# NSI: demographic weights per district
# --------------------------------------------------------------------------- #
def _is_age(s):
    s = str(s).strip()
    return bool(re.match(r"^\d+\s*(-\s*\d+)?\s*\+?$", s)) or s == "100 +"


def _age_low(label):
    """Lower bound year of an NSI age band label ('5 - 9' -> 5, '0' -> 0)."""
    m = re.match(r"^\s*(\d+)", str(label))
    return int(m.group(1)) if m else None


def district_totals():
    """Return {district_name: {'children_0_6': n, 'seniors_65p': n}} from the NSI sheet."""
    raw = pd.read_excel(NSI_XLSX, header=None)
    district_rows = []
    for i, v in raw[0].items():
        s = str(v).strip()
        if s and s != "nan" and not _is_age(s) and "Възраст" not in s \
                and "НАСЕЛЕНИЕ" not in s and s not in _SKIP_LABELS:
            district_rows.append((i, s))

    totals = {}
    for idx, (row, district) in enumerate(district_rows):
        end = district_rows[idx + 1][0] if idx + 1 < len(district_rows) else len(raw)
        children = seniors = 0.0
        for r in range(row + 1, end):
            label = raw.iat[r, 0]
            if not _is_age(label):
                continue
            total = pd.to_numeric(raw.iat[r, 1], errors="coerce")
            if pd.isna(total):
                continue
            lo = _age_low(label)
            if lo is None:
                continue
            if lo == 0:                       # band "0"
                children += total
            elif lo == 1:                     # band "1 - 4"  (ages 1-4)
                children += total
            elif lo == 5:                     # band "5 - 9" -> ages 5,6 = 2/5 of band
                children += total * (2 / 5)
            elif lo >= 65:                    # 65-69 .. 100+
                seniors += total
        totals[district] = {"children_0_6": int(round(children)),
                            "seniors_65p": int(round(seniors))}
    return totals


def load_weights():
    """District-level weights (one point per district capital)."""
    adm1 = load_district_coords()
    records = []
    for district, t in district_totals().items():
        coords = _match_coords(district, adm1)
        if coords is None:
            continue
        lat, lon = coords
        for group in ("children_0_6", "seniors_65p"):
            records.append((district, district, district, lat, lon, group, t[group]))
    df = pd.DataFrame(records, columns=[
        "cell_id", "settlement", "district", "lat", "lon", "group_key", "population"])
    return df[df["population"] > 0].reset_index(drop=True)


# Authoritative crosswalk (mirrors data-engine/config.py PROVINCES):
#   NSI Cyrillic name -> (GeoNames admin1 code, app/Latin name)
# Using the explicit admin1 code correctly separates София (столица)=42 from
# София=58 and yields the Latin names the rest of this project speaks.
PROVINCES = {
    "Благоевград": ("38", "Blagoevgrad"), "Бургас": ("39", "Burgas"),
    "Добрич": ("40", "Dobrich"), "Габрово": ("41", "Gabrovo"),
    "София (столица)": ("42", "Sofia (Capital)"), "Хасково": ("43", "Haskovo"),
    "Кърджали": ("44", "Kardzhali"), "Кюстендил": ("45", "Kyustendil"),
    "Ловеч": ("46", "Lovech"), "Монтана": ("47", "Montana"),
    "Пазарджик": ("48", "Pazardzhik"), "Перник": ("49", "Pernik"),
    "Плевен": ("50", "Pleven"), "Пловдив": ("51", "Plovdiv"),
    "Разград": ("52", "Razgrad"), "Русе": ("53", "Ruse"), "Шумен": ("54", "Shumen"),
    "Силистра": ("55", "Silistra"), "Сливен": ("56", "Sliven"),
    "Смолян": ("57", "Smolyan"), "София": ("58", "Sofia Province"),
    "Стара Загора": ("59", "Stara Zagora"), "Търговище": ("60", "Targovishte"),
    "Варна": ("61", "Varna"), "Велико Търново": ("62", "Veliko Tarnovo"),
    "Видин": ("63", "Vidin"), "Враца": ("64", "Vratsa"), "Ямбол": ("65", "Yambol"),
}
# admin1 code -> (NSI Cyrillic key for the totals lookup, Latin display name)
_CODE_TO_PROVINCE = {code: (cyr, latin) for cyr, (code, latin) in PROVINCES.items()}


def load_weights_settlement():
    """Settlement-level weights: distribute each province's NSI demographics across
    its GeoNames towns, proportional to town population. ~hundreds of demand points
    with real coordinates — the spatial layer the placement model needs.
    District labels are the project's Latin names (all 28 provinces, Sofia split)."""
    totals = district_totals()                      # Cyrillic-keyed
    settlements = load_settlements()

    records = []
    for code, grp in settlements.groupby("adm1_code"):
        prov = _CODE_TO_PROVINCE.get(code)
        if prov is None:
            continue
        cyr, latin = prov
        if cyr not in totals:
            continue
        denom = grp["population"].sum()
        if denom == 0:
            continue
        for _, s in grp.iterrows():
            share = s["population"] / denom
            for group in ("children_0_6", "seniors_65p"):
                pop = int(round(totals[cyr][group] * share))
                if pop <= 0:
                    continue
                records.append((f"{latin}:{s['name']}", s["name"], latin,
                                s["lat"], s["lon"], group, pop))
    df = pd.DataFrame(records, columns=[
        "cell_id", "settlement", "district", "lat", "lon", "group_key", "population"])
    return df.reset_index(drop=True)


# --------------------------------------------------------------------------- #
# OSM: infrastructure nodes (lazy import so NSI works without osmium installed)
# --------------------------------------------------------------------------- #
def load_nodes(bbox=None):
    """Return DataFrame: osm_id, service_type, name, lat, lon.

    bbox = (min_lon, min_lat, max_lon, max_lat) to restrict; None = whole country.
    """
    import osmium  # imported here so the NSI path doesn't require it

    amenity_map = AMENITY_MAP

    class Handler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.rows = []

        def _add(self, osm_id, tags, lat, lon):
            amenity = tags.get("amenity")
            if amenity not in amenity_map:
                return
            if bbox and not (bbox[1] <= lat <= bbox[3] and bbox[0] <= lon <= bbox[2]):
                return
            self.rows.append((osm_id, amenity_map[amenity][0],
                              tags.get("name", ""), round(lat, 6), round(lon, 6)))

        def node(self, n):
            if n.location.valid():
                self._add(n.id, n.tags, n.location.lat, n.location.lon)

        def area(self, a):
            try:
                c = a.geom().centroid()
                self._add(a.orig_id(), a.tags, c.y, c.x)
            except Exception:
                pass

    h = Handler()
    h.apply_file(str(PBF), locations=True, idx="flex_mem")
    df = pd.DataFrame(h.rows, columns=["osm_id", "service_type", "name", "lat", "lon"])
    return df.drop_duplicates(subset=["osm_id", "service_type"]).reset_index(drop=True)


if __name__ == "__main__":
    w = load_weights()
    print(f"weights: {len(w)} rows, {w.district.nunique()} districts")
    print(w.groupby("group_key").population.sum().to_string())
    print(w.head(6).to_string())
