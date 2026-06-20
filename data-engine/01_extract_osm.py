"""Extract essential-service locations (kindergartens, schools, hospitals, clinics,
pharmacies) from the Bulgaria .pbf and tag each with its province. Fully offline.

Every matching amenity — mapped as a node OR as a building outline (way/relation) — is
kept, deduplicated, and assigned to a district via its nearest GeoNames settlement.
"""

import csv

import osmium
import pandas as pd

from config import PBF_PATH, OUT_DIR, AMENITY_MAP, SEED_NATIONWIDE, ACTIVE_DISTRICT
from geonames import load_settlements, assign_districts


class AmenityHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.rows = []

    def _maybe_add(self, osm_id, tags, lat, lon):
        amenity = tags.get("amenity")
        if amenity not in AMENITY_MAP:
            return
        service_type, _group = AMENITY_MAP[amenity]
        self.rows.append({
            "osm_id": osm_id,
            "service_type": service_type,
            "amenity_raw": amenity,
            "name": tags.get("name", ""),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
        })

    def node(self, n):
        if n.location.valid():
            self._maybe_add(n.id, n.tags, n.location.lat, n.location.lon)

    def area(self, a):
        # ways/relations tagged as amenities -> use polygon centroid
        try:
            c = a.geom().centroid()
            self._maybe_add(a.orig_id(), a.tags, c.y, c.x)
        except Exception:
            pass


def main():
    print(f"Scanning {PBF_PATH.name} for amenities (whole country)...")
    handler = AmenityHandler()
    # locations=True builds the node-location index so area (building) centroids resolve.
    handler.apply_file(str(PBF_PATH), locations=True, idx="flex_mem")

    df = pd.DataFrame(handler.rows).drop_duplicates(subset=["osm_id", "service_type"])
    df = df.reset_index(drop=True)
    print(f"Matched {len(df)} amenity records; assigning provinces...")

    settlements = load_settlements()
    df["district"] = assign_districts(df["lat"], df["lon"], settlements)

    if not SEED_NATIONWIDE:
        df = df[df["district"] == ACTIVE_DISTRICT].reset_index(drop=True)
        print(f"Filtered to {ACTIVE_DISTRICT}: {len(df)} nodes")

    df = df[["osm_id", "service_type", "amenity_raw", "name", "lat", "lon", "district"]]
    out = OUT_DIR / "infrastructure_nodes.csv"
    df.to_csv(out, index=False, quoting=csv.QUOTE_MINIMAL)

    print(f"Wrote {len(df)} nodes -> {out}")
    print(df["service_type"].value_counts().to_string())


if __name__ == "__main__":
    main()
