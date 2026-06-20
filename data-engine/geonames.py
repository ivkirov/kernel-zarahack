"""GeoNames (BG.zip) loader — the geocoding backbone of the data engine.

GeoNames lists ~7.2k Bulgarian populated places, each with lat/lon, the province
(admin1 code) it belongs to, a feature code (city/town/village), and — for the ~355
largest — a population figure. We use it two ways:

  1. as the demand grid: every settlement is a cell with real coordinates
     (02_extract_nsi.py spreads NSI's province age-shares onto these cells);
  2. as a point-in-province oracle: assign_districts() tags any lat/lon (e.g. an OSM
     amenity) with the province of its nearest settlement (01_extract_osm.py).
"""

import csv
import io
import zipfile

import numpy as np
import pandas as pd

from config import (GEONAMES_ZIP, GEONAMES_MEMBER, ADMIN1_TO_DISTRICT,
                    URBAN_FCODES, URBAN_POP_THRESHOLD)

# 0-indexed GeoNames "geoname" table columns we care about.
COL_GEONAMEID, COL_NAME, COL_ASCII = 0, 1, 2
COL_LAT, COL_LON = 4, 5
COL_FCLASS, COL_FCODE = 6, 7
COL_ADMIN1, COL_POP = 10, 14


def load_settlements() -> pd.DataFrame:
    """All populated places (feature class P) as a DataFrame, tagged with district."""
    with zipfile.ZipFile(GEONAMES_ZIP) as zf:
        text = zf.read(GEONAMES_MEMBER).decode("utf-8")

    rows = []
    for r in csv.reader(io.StringIO(text), delimiter="\t"):
        if r[COL_FCLASS] != "P":
            continue
        district = ADMIN1_TO_DISTRICT.get(r[COL_ADMIN1])
        if district is None:            # places outside the 28-province crosswalk
            continue
        pop = int(r[COL_POP]) if r[COL_POP] else 0
        fcode = r[COL_FCODE]
        rows.append({
            "geonameid": r[COL_GEONAMEID],
            "settlement": r[COL_ASCII] or r[COL_NAME],
            "lat": round(float(r[COL_LAT]), 6),
            "lon": round(float(r[COL_LON]), 6),
            "admin1": r[COL_ADMIN1],
            "district": district,
            "fcode": fcode,
            "geo_pop": pop,
            "is_urban": fcode in URBAN_FCODES or pop >= URBAN_POP_THRESHOLD,
        })

    df = pd.DataFrame(rows)
    # GeoNames occasionally double-lists a place; keep the most-populated record per id.
    df = (df.sort_values("geo_pop", ascending=False)
            .drop_duplicates(subset="geonameid")
            .reset_index(drop=True))
    return df


def assign_districts(lats, lons, settlements: pd.DataFrame) -> list[str]:
    """For each (lat, lon), return the district of the nearest settlement.

    Province assignment only needs to pick the right large region, so we use a cheap
    equirectangular projection (cos-scaled lon) instead of full haversine — exact enough
    at this scale and dependency-free (no scipy/shapely).
    """
    s_lat = settlements["lat"].to_numpy()
    s_lon = settlements["lon"].to_numpy()
    s_dist = settlements["district"].to_numpy()
    cos0 = np.cos(np.radians(float(np.mean(s_lat))))
    sx, sy = s_lon * cos0, s_lat               # settlement plane coords

    q_lat = np.asarray(lats, dtype=float)
    q_lon = np.asarray(lons, dtype=float)
    out = np.empty(len(q_lat), dtype=object)
    # Chunk the queries so the (chunk x settlements) distance matrix stays small.
    for i in range(0, len(q_lat), 512):
        qx = q_lon[i:i + 512] * cos0
        qy = q_lat[i:i + 512]
        d2 = (qx[:, None] - sx[None, :]) ** 2 + (qy[:, None] - sy[None, :]) ** 2
        out[i:i + 512] = s_dist[d2.argmin(axis=1)]
    return out.tolist()
