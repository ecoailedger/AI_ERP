"""Read-only access to Delta tables in OneLake. There is no write function here on purpose."""
import json
import urllib.parse
import urllib.request

import pandas as pd
import pyarrow as pa
from deltalake import DeltaTable, QueryBuilder

from . import ipv4  # noqa: F401
from .auth import STORAGE, credential
from .config import mirror_root

_cred = None


def _token() -> str:
    global _cred
    _cred = _cred or credential()
    return _cred.get_token(STORAGE).token


def table(name: str) -> DeltaTable:
    return DeltaTable(f"{mirror_root()}/{name}", storage_options={"bearer_token": _token(), "use_fabric_endpoint": "true"})


def query(name: str, sql: str) -> pd.DataFrame:
    """Runs SQL over one mirror table, registered as `t`."""
    # The mirror's tables use deletion vectors, so the result has to go through pa.table().
    return pa.table(QueryBuilder().register("t", table(name)).execute(sql).read_all()).to_pandas()


def columns(name: str) -> list[tuple[str, str]]:
    return [(field.name, str(field.type)) for field in pa.schema(table(name).schema())]


def list_tables() -> list[str]:
    """Names of the tables under the mirror's schema folder."""
    root = mirror_root()
    workspace = root.split("//", 1)[1].split("@", 1)[0]
    directory = root.split(".com/", 1)[1]
    url = (
        f"https://onelake.dfs.fabric.microsoft.com/{workspace}"
        f"?resource=filesystem&recursive=false&directory={urllib.parse.quote(directory)}"
    )
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {_token()}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        paths = json.load(response).get("paths", [])
    return sorted(path["name"].rsplit("/", 1)[-1] for path in paths if path.get("isDirectory") == "true")
