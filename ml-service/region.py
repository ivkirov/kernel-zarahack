"""Region configuration loader for the ML service.

Reads the single region YAML (repo-root ``config/``) that decouples the whole
pipeline from any one country. Resolution order:

  1. ``$REGION_CONFIG`` (explicit path)
  2. ``config/region.yaml`` (your copy)
  3. ``config/region.example.yaml`` (the shipped Bulgaria pilot — so a fresh
     clone trains out-of-the-box)

Everything region-specific — bounding box, dataset filenames, the province
crosswalk, the amenity map, demographic bands — comes from here, never hard-coded
in the training or serving code. See ``config/region.example.yaml``.
"""

import os
from functools import lru_cache
from pathlib import Path

import yaml

_REPO = Path(__file__).resolve().parent.parent


def _resolve_path() -> Path:
    candidates = [
        os.getenv("REGION_CONFIG"),
        _REPO / "config" / "region.yaml",
        _REPO / "config" / "region.example.yaml",
    ]
    for c in candidates:
        if c and Path(c).exists():
            return Path(c)
    raise FileNotFoundError(
        "No region config found. Create config/region.yaml from "
        "config/region.example.yaml, or set REGION_CONFIG=/path/to/region.yaml."
    )


@lru_cache(maxsize=1)
def load() -> dict:
    path = _resolve_path()
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    cfg["_path"] = str(path)
    return cfg


# --- typed accessors -------------------------------------------------------- #
def name() -> str:
    return load().get("name", "region")


def bbox() -> tuple:
    """(min_lon, min_lat, max_lon, max_lat)."""
    return tuple(load()["bbox"])


def datasets_dir() -> Path:
    d = Path(load()["datasets_dir"])
    return d if d.is_absolute() else _REPO / d


def dataset_path(key: str) -> Path:
    return datasets_dir() / load()["datasets"][key]


def amenity_map() -> dict:
    """OSM amenity -> (service_type, demand group)."""
    return {k: tuple(v) for k, v in load()["amenity_map"].items()}


def provinces() -> dict:
    """census_name -> (geonames_admin1_code, Latin display name)."""
    return {k: tuple(v) for k, v in load()["provinces"].items()}


def visits_per_year() -> dict:
    return dict(load()["visits_per_year"])


def placement_amenity() -> str:
    return os.getenv("PLACE_AMENITY", load().get("placement_amenity", "kindergarten"))


def child_bands() -> dict:
    return dict(load()["child_bands"])


def senior_bands() -> list:
    return list(load()["senior_bands"])
