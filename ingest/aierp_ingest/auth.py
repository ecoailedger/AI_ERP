"""Entra sign-in for OneLake, as the person running the script.

Device code the first time. After that the account pointer (no secrets) and the operating
system's encrypted token cache make it silent. No app registration and no stored secret.
"""
import os
from pathlib import Path

from . import ipv4  # noqa: F401
from azure.identity import AuthenticationRecord, DeviceCodeCredential, TokenCachePersistenceOptions

STORAGE = "https://storage.azure.com/.default"
# The record and cache names can point at ones another project already created, to share one sign-in.
RECORD = Path(os.environ.get("AI_ERP_AUTH_RECORD", Path.home() / ".ai-erp-fabric-auth-record.json"))
CACHE = os.environ.get("AI_ERP_AUTH_CACHE", "ai-erp-fabric")


def _prompt(uri, code, _expires):
    print(f"\n=== SIGN IN TO FABRIC: open {uri} and enter {code} ===\n", flush=True)


def credential() -> DeviceCodeCredential:
    options = {
        "prompt_callback": _prompt,
        "cache_persistence_options": TokenCachePersistenceOptions(name=CACHE, allow_unencrypted_storage=True),
    }
    if RECORD.exists():
        return DeviceCodeCredential(authentication_record=AuthenticationRecord.deserialize(RECORD.read_text()), **options)
    cred = DeviceCodeCredential(**options)
    RECORD.write_text(cred.authenticate(scopes=[STORAGE]).serialize())
    return cred
