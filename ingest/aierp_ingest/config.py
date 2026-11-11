"""Where the real feed lives. Read from the environment or a .env file, never from the repository.

This repository is public. Workspace ids, item ids and anything else that identifies the tenant
stay in .env, which is gitignored. See .env.example for the names.
"""
import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
REAL_DIR = REPO / "data" / "real"


def _load_env_file() -> None:
    path = REPO / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


_load_env_file()


def required(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise SystemExit(f"{name} is not set. Copy .env.example to .env and fill it in.")
    return value


def mirror_root() -> str:
    """OneLake path of the mirrored database's source tables."""
    workspace = required("AI_ERP_MIRROR_WORKSPACE_ID")
    item = required("AI_ERP_MIRROR_ITEM_ID")
    schema = os.environ.get("AI_ERP_MIRROR_SCHEMA", "Source")
    return f"abfss://{workspace}@onelake.dfs.fabric.microsoft.com/{item}/Tables/{schema}"
