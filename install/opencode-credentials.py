"""Repair imported Azure form metadata and Vertex keys conflicting with ADC.

The original credential stays available; no database files are edited directly.
"""

import base64
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen


def corrected_azure_value(value):
    if value.get("type") != "key":
        return None
    metadata = value.get("metadata", {})
    # Limit the workaround to the known Azure form answer, not arbitrary metadata.
    if set(metadata) != {"resourceName"} or not isinstance(
        metadata["resourceName"], str
    ):
        return None
    corrected = dict(value)
    corrected.pop("metadata")
    corrected["configuration"] = {**metadata, **value.get("configuration", {})}
    return corrected


def api(operation, data=None, credential_id=None):
    if credential_id is not None:
        result = subprocess.run(
            [
                "opencode",
                "api",
                "credential.remove",
                "--param",
                f"credentialID={credential_id}",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            raise RuntimeError("Could not remove conflicting Vertex credential")
        return None
    if data is not None:
        state = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))
        service = json.loads((state / "opencode/service.json").read_text())
        authorization = base64.b64encode(
            f"opencode:{service['password']}".encode()
        ).decode()
        request = Request(
            service["url"] + "/api/credential",
            data=json.dumps(data).encode(),
            headers={
                "Authorization": f"Basic {authorization}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    command = ["opencode", "api", operation]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        # Request bodies and responses can include secrets. Do not print them.
        raise RuntimeError(f"OpenCode API operation {operation} failed")
    return json.loads(result.stdout) if result.stdout.strip() else None


def credential_backup(credential, prefix):
    state = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))
    parent = state / "opencode/dotfiles-backups"
    parent.mkdir(parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix=prefix, dir=parent))
    os.chmod(backup, 0o700)
    (backup / "credential.json").write_text(json.dumps(credential, indent=2) + "\n")
    os.chmod(backup / "credential.json", 0o600)
    return backup


def repair():
    credentials = api("credential.list")["data"]
    for credential in credentials:
        if credential["integrationID"] != "azure" or not credential.get("active"):
            continue
        corrected = corrected_azure_value(credential["value"])
        if corrected is None:
            continue
        backup = credential_backup(credential, "azure-credential-")
        api(
            "credential.create",
            {
                "integrationID": "azure",
                "label": f"{credential['label']} (V2 migration)",
                "value": corrected,
                "activate": True,
            },
        )
        print(f"Repaired Azure credential; original retained. Backup: {backup}")
        subprocess.run(["opencode", "reload"], check=True)

    vertex_keys = [
        item
        for item in credentials
        if item["integrationID"] == "google-vertex" and item["value"]["type"] == "key"
    ]
    if not vertex_keys:
        return
    # Only switch away from keys when the user's existing ADC actually works.
    if shutil.which("gcloud") is None:
        print(
            "Vertex requires gcloud and working ADC before removing the imported API key."
        )
        return
    result = subprocess.run(
        ["gcloud", "auth", "application-default", "print-access-token"],
        capture_output=True,
        check=False,
        timeout=60,
    )
    if result.returncode:
        print(
            "Vertex has an imported API key. Claude requires ADC; run gcloud auth application-default login, then rerun this repair."
        )
        return
    for credential in vertex_keys:
        backup = credential_backup(credential, "vertex-credential-")
        api("credential.remove", credential_id=credential["id"])
        print(
            f"Removed conflicting Vertex API key; using existing ADC. Backup: {backup}"
        )
    subprocess.run(["opencode", "reload"], check=True)


if __name__ == "__main__":
    repair()
