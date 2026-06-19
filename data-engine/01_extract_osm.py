"""Extract kindergartens, schools, hospitals, clinics, pharmacies from the
local Bulgaria .pbf and write a clean CSV. Fully offline."""

import csv
import osmium
import pandas as pd
from tqdm import tqdm
from config import PBF_PATH, OUT_DIR, AMENITY_MAP, ACTIVE_DISTRICT, ACTIVE_BBOX

MIN_LON, MIN_LAT, MAX_LON, MAX_LAT = ACTIVE_BBOX

def in_bbox(lat, lon):
    return MIN_LAT <= lat <= MAX_LAT and MIN_LON <= lon <= MAX_LON

class AmenityHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.rows = []

    def _maybe_add(self, osm_id, tags, lat, lon):
        amenity = tags.get("amenity")
        if amenity not in AMENITY_MAP:
            return
        if not in_bbox(lat, lon):
            return
        service_type, _group = AMENITY_MAP[amenity]
        self.rows.append({
            "osm_id": osm_id,
            "service_type": service_type,
            "amenity_raw": amenity,
            "name": tags.get("name", ""),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "district": ACTIVE_DISTRICT,
        })

    def node(self, n):
        if n.location.valid():
            self._maybe_add(n.id, n.tags, n.location.lat, n.location.lon)

    def area(self, a):
        # ways/relations tagged as amenities -> use centroid
        try:
            centroid = a.geom().centroid()
            self._maybe_add(a.orig_id(), a.tags, centroid.y, centroid.x)
        except Exception:
            pass

def main():
    handler = AmenityHandler()
    # locations=True builds the node-location index so area centroids resolve.
    print(f"Scanning {PBF_PATH} for amenities in {ACTIVE_DISTRICT}...")
    handler.apply_file(str(PBF_PATH), locations=True, idx="flex_mem")

    df = pd.DataFrame(handler.rows)
    df = df.drop_duplicates(subset=["osm_id", "service_type"]).reset_index(drop=True)

    out = OUT_DIR / "infrastructure_nodes.csv"
    df.to_csv(out, index=False, quoting=csv.QUOTE_MINIMAL)
    print(f"Wrote {len(df)} nodes -> {out}")
    print(df["service_type"].value_counts().to_string())

if __name__ == "__main__":
    main()
