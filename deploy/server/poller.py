#!/usr/bin/env python3
"""Apply trusted build receipts to fixed Kubernetes targets; never execute repository code."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time
import urllib.request
from urllib.parse import urlsplit


HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
NAME = re.compile(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\Z")
REPO = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")


class DeliveryError(Exception):
    pass


def run(args, *, timeout=120):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        # Never expose a Git URL's possible credentials or arbitrary subprocess output.
        raise DeliveryError(f"{Path(args[0]).name} command failed (exit {result.returncode})")
    return result.stdout


def trusted_file(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise DeliveryError("Configuration must be a regular root-owned file")
    for item in (path, *path.parents):
        info = item.stat()
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise DeliveryError("Configuration and ancestors must be root-owned and not writable by others")
    return json.loads(path.read_text())


def trusted_directory(path):
    path = Path(path)
    if path.is_symlink() or not path.is_dir():
        raise DeliveryError("Checkout must be a trusted directory")
    for item in (path, *path.parents):
        info = item.stat()
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise DeliveryError("Checkout and ancestors must be root-owned and not writable by others")


def validate_config(config):
    if not isinstance(config, dict) or not isinstance(config.get("applications"), list):
        raise DeliveryError("Invalid configuration")
    state = Path(config.get("stateDirectory", ""))
    if not state.is_absolute():
        raise DeliveryError("State directory must be absolute")
    seen = set()
    for app in config["applications"]:
        key = app.get("id", "")
        if not NAME.fullmatch(key) or key in seen:
            raise DeliveryError("Invalid or duplicate application id")
        seen.add(key)
        if not REPO.fullmatch(app.get("repository", "")) or app.get("branch") not in {"dev", "main"}:
            raise DeliveryError("Invalid repository or branch")
        if not Path(app.get("checkout", "")).is_absolute():
            raise DeliveryError("Checkout must be an absolute trusted path")
        if not isinstance(app.get("targets"), dict) or not app["targets"]:
            raise DeliveryError("At least one image target is required")
        for component, target in app["targets"].items():
            if not NAME.fullmatch(component):
                raise DeliveryError("Invalid component")
            for field in ("namespace", "deployment", "container"):
                if not NAME.fullmatch(target.get(field, "")):
                    raise DeliveryError("Invalid Kubernetes target")
            if not re.fullmatch(r"ghcr\.io/[a-z0-9_.-]+/[a-z0-9_./-]+", target.get("imageRepository", "")):
                raise DeliveryError("Invalid fixed image repository")
        artifacts = app.get("artifactRepositories", {})
        if not isinstance(artifacts, dict) or set(artifacts) & set(app["targets"]):
            raise DeliveryError("Artifacts must be separate from deployed components")
        for component, repository in artifacts.items():
            if not NAME.fullmatch(component) or not isinstance(repository, str) or not re.fullmatch(r"ghcr\.io/[a-z0-9_.-]+/[a-z0-9_./-]+", repository):
                raise DeliveryError("Invalid fixed artifact repository")
        schemas = app.get("approvedSchemaHashes")
        if not isinstance(schemas, dict) or any(not isinstance(v, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", v) for v in schemas.values()):
            raise DeliveryError("Explicit approvedSchemaHashes mapping required")
        if not isinstance(app.get("probes"), list) or not app["probes"]:
            raise DeliveryError("At least one revision probe is required")
        for probe in app["probes"]:
            url = urlsplit(probe.get("url", ""))
            if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password:
                raise DeliveryError("Invalid probe URL")
    return config


def validate_receipt(receipt, app, head):
    if not isinstance(receipt, dict):
        raise DeliveryError("Receipt must be an object")
    if receipt.get("schema") != 1:
        raise DeliveryError("Unsupported receipt schema")
    if receipt.get("repository") != app["repository"] or receipt.get("branch") != app["branch"]:
        raise DeliveryError("Receipt identity mismatch")
    source = receipt.get("source", "")
    if not isinstance(source, str) or not HEX40.fullmatch(source) or source != head:
        raise DeliveryError("Stale or invalid source revision")
    images = receipt.get("images")
    repositories = {component: target["imageRepository"] for component, target in app["targets"].items()}
    repositories.update(app.get("artifactRepositories", {}))
    if not isinstance(images, dict) or set(images) != set(repositories):
        raise DeliveryError("Receipt components must exactly match configured targets")
    for component, image in images.items():
        prefix = repositories[component] + "@sha256:"
        if not isinstance(image, str) or not image.startswith(prefix) or not HEX64.fullmatch(image[len(prefix):]):
            raise DeliveryError("Image must use its configured repository and immutable sha256 digest")
    if receipt.get("schemaHashes") != app["approvedSchemaHashes"]:
        raise DeliveryError("Schema change requires operator review and approved hash update; no migrations executed")
    return receipt


def git(app, *args):
    return run(["git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never", "-C", app["checkout"], *args])


def receipt_from_git(app):
    trusted_directory(app["checkout"])
    branch = app["branch"]
    git(app, "fetch", "--no-tags", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}",
        f"+refs/heads/deploy/{branch}:refs/remotes/origin/deploy/{branch}")
    head = git(app, "rev-parse", f"refs/remotes/origin/{branch}").strip()
    receipt_commit = git(app, "rev-parse", f"refs/remotes/origin/deploy/{branch}").strip()
    if not HEX40.fullmatch(head) or not HEX40.fullmatch(receipt_commit):
        raise DeliveryError("Invalid fetched Git commit")
    payload = git(app, "show", f"{receipt_commit}:release.json")
    if len(payload) > 65536:
        raise DeliveryError("Receipt exceeds size limit")
    return validate_receipt(json.loads(payload), app, head), receipt_commit


def atomic_json(path, data):
    path = Path(path)
    temporary = path.with_suffix(".tmp")
    fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(data, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def recheck_source(app, expected):
    branch = app["branch"]
    git(app, "fetch", "--no-tags", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}")
    current = git(app, "rev-parse", f"refs/remotes/origin/{branch}").strip()
    if current != expected:
        raise DeliveryError("Source advanced while preparing rollout; refusing stale receipt")


def kubectl(target, *args):
    return run(["kubectl", "--namespace", target["namespace"], *args], timeout=360)


def probe_revision(probe, expected):
    request = urllib.request.Request(probe["url"], headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=10) as response:
        data = json.loads(response.read(65537))
    for field in probe.get("revisionField", "revision").split("."):
        data = data[field]
    if data != expected:
        raise DeliveryError("Running application revision does not match receipt")


def apply_receipt(app, receipt, receipt_commit, state_dir, *, dry_run=False):
    state_file = state_dir / f"{app['id']}.json"
    old_state = json.loads(state_file.read_text()) if state_file.exists() else {}
    if old_state.get("status") == "success" and old_state.get("receiptCommit") == receipt_commit:
        return "unchanged"
    if dry_run:
        return "validated-dry-run"
    previous = {}
    for component, target in app["targets"].items():
        deployment = json.loads(kubectl(target, "get", "deployment", target["deployment"], "-o", "json"))
        containers = deployment["spec"]["template"]["spec"]["containers"]
        matches = [c for c in containers if c["name"] == target["container"]]
        if len(matches) != 1:
            raise DeliveryError("Configured container not present")
        previous[component] = matches[0]["image"]
    state = {"status": "applying", "receiptCommit": receipt_commit, "source": receipt["source"],
             "previousImages": previous, "desiredImages": receipt["images"], "updatedAt": int(time.time())}
    history = state_dir / "attempts"
    history.mkdir(mode=0o700, exist_ok=True)
    attempt_file = history / f"{app['id']}-{time.time_ns()}.json"
    atomic_json(attempt_file, state)
    atomic_json(state_file, state)
    try:
        recheck_source(app, receipt["source"])
        for component, target in app["targets"].items():
            # Strategic merge selects exactly the configured container; no shell, manifests or repo scripts.
            patch = {"spec": {"template": {"spec": {"containers": [
                {"name": target["container"], "image": receipt["images"][component]}]}}}}
            kubectl(target, "patch", "deployment", target["deployment"], "--type=strategic", "-p", json.dumps(patch))
        for target in app["targets"].values():
            kubectl(target, "rollout", "status", f"deployment/{target['deployment']}", "--timeout=300s")
        for probe in app["probes"]:
            error = None
            for attempt in range(12):
                try:
                    probe_revision(probe, receipt["source"])
                    error = None
                    break
                except Exception as exc:
                    error = exc
                    time.sleep(5)
            if error is not None:
                raise DeliveryError("Revision probe failed after rollout") from error
        state["status"] = "success"
    except Exception as exc:
        state["status"] = "failed"
        state["error"] = str(exc) if isinstance(exc, DeliveryError) else type(exc).__name__
        raise
    finally:
        state["updatedAt"] = int(time.time())
        atomic_json(attempt_file, state)
        atomic_json(state_file, state)
    return "success"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/uar-delivery/config.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    config = validate_config(trusted_file(args.config))
    state_dir = Path(config["stateDirectory"])
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if state_dir.is_symlink() or state_dir.stat().st_uid != 0 or stat.S_IMODE(state_dir.stat().st_mode) & 0o077:
        raise DeliveryError("State directory must be private and root-owned")
    failures = 0
    with (state_dir / "poll.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        for app in config["applications"]:
            try:
                receipt, commit = receipt_from_git(app)
                result = apply_receipt(app, receipt, commit, state_dir, dry_run=args.dry_run)
                if not args.dry_run and result in {"success", "unchanged"}:
                    (state_dir / f"{app['id']}-error.json").unlink(missing_ok=True)
                print(json.dumps({"application": app["id"], "result": result, "source": receipt["source"]}))
            except Exception as exc:
                failures += 1
                message = str(exc) if isinstance(exc, DeliveryError) else type(exc).__name__
                atomic_json(state_dir / f"{app['id']}-error.json", {"status": "failed", "error": message, "updatedAt": int(time.time())})
                print(json.dumps({"application": app["id"], "result": "failed", "error": message}))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
