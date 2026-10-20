"""Load, schema-validate and index a plan.json."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import jsonschema

SCHEMA_PATH = Path(__file__).parent / "schema" / "plan.schema.json"
COLLECTIONS = ("sources", "dimensions", "levels", "wall_types", "walls", "openings", "rooms", "details", "stairs")


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text())


def schema_errors(raw: dict) -> list[str]:
    validator = jsonschema.Draft202012Validator(load_schema())
    errors = sorted(validator.iter_errors(raw), key=lambda e: list(e.absolute_path))
    return [f"/{'/'.join(map(str, e.absolute_path))}: {e.message}" for e in errors]


class Plan:
    """Indexed view of a schema-valid plan dict. Collections keyed by id."""

    def __init__(self, raw: dict, path: Path | None = None):
        self.raw = raw
        self.path = path
        self.project = raw["project"]
        self.tolerances = raw["tolerances"]
        self.duplicate_ids: list[str] = []
        for name in COLLECTIONS:
            index: dict[str, dict] = {}
            for item in raw.get(name, []):
                if item["id"] in index:
                    self.duplicate_ids.append(f"{name}.{item['id']}")
                index[item["id"]] = item
            setattr(self, name, index)

    @property
    def sha256(self) -> str:
        return hashlib.sha256(json.dumps(self.raw, sort_keys=True).encode()).hexdigest()

    def get_param(self, target: str):
        """Resolve 'collection.id.field' to its value; raises KeyError."""
        collection, item_id, fld = target.split(".")
        if collection not in COLLECTIONS:
            raise KeyError(target)
        return getattr(self, collection)[item_id][fld]

    def elements(self):
        """Yield (collection, item) for every element that must carry provenance."""
        for name in ("levels", "wall_types", "walls", "openings", "rooms", "details", "stairs"):
            for item in getattr(self, name).values():
                yield name, item


def load_plan(path: str | Path) -> tuple[Plan | None, list[str]]:
    """Return (plan, schema_errors). plan is None when the schema check fails."""
    path = Path(path)
    raw = json.loads(path.read_text())
    errors = schema_errors(raw)
    if errors:
        return None, errors
    return Plan(raw, path), []
