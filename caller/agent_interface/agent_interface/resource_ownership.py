"""Per-Call resource receipts in Caller, independent of publication artifacts.

Registration is append-only and precedes allocation. Only the cleaner which
observed the pinned directory can acknowledge its reclamation; disappearance
or process loss alone is not a cleanup receipt. This is resource metadata,
not another behavior/action ledger.
"""
from __future__ import annotations

import json
import os
import sqlite3
import stat
from contextlib import closing, contextmanager
from pathlib import Path
from time import time
from uuid import uuid4


def initial(call_id: str | None = None, correlation: str | None = None) -> str:
    value = {"version": 1, "roots": [], "errors": []}
    if call_id is not None or correlation is not None:
        if not call_id or not correlation:
            raise ValueError("native namespace requires its original Call and correlation")
        value.update(version=2, namespace={"state": "requested", "callId": call_id, "correlation": correlation})
    return json.dumps(value)


def call_directory(database: Path, call_id: str) -> Path:
    return database.parent / "native-resources" / call_id


@contextmanager
def _database(path: Path):
    with closing(sqlite3.connect(path, timeout=30)) as conn:
        with conn:
            yield conn


def read(conn: sqlite3.Connection, call_id: str) -> dict:
    row = conn.execute("select resource_ownership from calls where id=? and source='poise:behavior-chain'", (call_id,)).fetchone()
    value = json.loads(row[0]) if row and row[0] else None
    if not isinstance(value, dict) or value.get("version") not in (1, 2) \
            or not isinstance(value.get("roots"), list) or not isinstance(value.get("errors"), list):
        raise RuntimeError("native Call lacks its durable resource ownership")
    if value["version"] == 2 and (not isinstance(value.get("namespace"), dict)
                                  or value["namespace"].get("callId") != call_id):
        raise RuntimeError("native Call lacks its original namespace ownership")
    return value


def _write(conn: sqlite3.Connection, call_id: str, value: dict) -> None:
    encoded = json.dumps(value, separators=(",", ":"))
    if len(encoded.encode()) > 128 * 1024:
        raise RuntimeError("native resource ownership receipt exceeds its size limit")
    if conn.execute("update calls set resource_ownership=? where id=? and resources_settled_at is null",
                    (encoded, call_id)).rowcount != 1:
        raise RuntimeError("native Call no longer owns unsettled resources")


def request_namespace(database: Path, call_id: str, scope) -> None:
    with _database(database) as conn:
        conn.execute("begin immediate")
        value = read(conn, call_id)
        namespace = value.get("namespace")
        if not namespace or namespace != {"state": "requested", "callId": call_id, "correlation": scope.key["correlation"]}:
            raise RuntimeError("native namespace request differs from its original claim")
        # The socket address and retirement token are private Caller state.
        # They never enter the public log DTO or canonical journal evidence.
        changed = conn.execute("update calls set namespace_control=? where id=? and namespace_control is null "
                               "and status='running' and resources_settled_at is null",
                               (json.dumps({"address": scope.address, **scope.key}), call_id)).rowcount
        if changed != 1:
            raise RuntimeError("native namespace already has an original controller")


def register_namespace(database: Path, call_id: str, receipt: dict) -> None:
    with _database(database) as conn:
        conn.execute("begin immediate")
        value = read(conn, call_id)
        namespace = value.get("namespace")
        if not namespace or namespace["state"] != "requested" or namespace["callId"] != receipt["callId"] \
                or namespace["correlation"] != receipt["correlation"] or value["roots"]:
            raise RuntimeError("native namespace registration conflicts with its original admission")
        row = conn.execute("select namespace_control,process_identity,pid from calls where id=?", (call_id,)).fetchone()
        expected = {"address": receipt["controller"], **{key: receipt[key] for key in ("callId", "correlation", "token")}}
        if row is None or json.loads(row[0] or "null") != expected:
            raise RuntimeError("native namespace registration lacks its original private controller")
        original = json.loads(row[1] or "null")
        binding = receipt["binding"]
        if not isinstance(original, dict) or not isinstance(original.get("epoch"), dict) \
                or binding.get("owner") != {"pid": int(row[2]), "start": original.get("start")} \
                or binding.get("epoch") != {key: str(value) for key, value in original["epoch"].items()}:
            raise RuntimeError("native namespace does not belong to its original Caller identity")
        namespace.update(state="active", controller={"version": 1, "instance": receipt["controller"]["instance"]},
                         binding=receipt["binding"])
        _write(conn, call_id, value)


def settle_namespace(database: Path, call_id: str, scope) -> None:
    # Callers must observe the original retained witness immediately before
    # committing. A missing/replaced controller cannot certify settlement.
    if not scope.read()["empty"]:
        raise RuntimeError("native namespace still owns processes")
    with _database(database) as conn:
        conn.execute("begin immediate")
        value = read(conn, call_id)
        namespace = value.get("namespace")
        if not namespace or namespace["state"] not in ("active", "settled") \
                or namespace.get("binding") != scope.binding or namespace["correlation"] != scope.key["correlation"] \
                or namespace.get("controller") != {"version": 1, "instance": scope.address["instance"]}:
            raise RuntimeError("native settlement differs from its original namespace")
        if namespace["state"] == "active":
            namespace.update(state="settled", settled_at=int(time() * 1000) / 1000)
            value["process_pending"] = False
            _write(conn, call_id, value)


def namespace_not_started(database: Path, call_id: str) -> None:
    from . import process_identity
    with _database(database) as conn:
        conn.execute("begin immediate")
        value = read(conn, call_id)
        namespace = value.get("namespace")
        if not namespace or namespace["state"] != "requested" or value["roots"]:
            raise RuntimeError("native no-GO evidence conflicts with allocated resources")
        row = conn.execute("select process_identity from calls where id=?", (call_id,)).fetchone()
        if not row or not process_identity.owns_registration(row[0]):
            raise RuntimeError("native no-GO evidence requires its original Caller")
        namespace.update(state="not_started", no_effect="original-no-go", settled_at=int(time() * 1000) / 1000)
        _write(conn, call_id, value)


def binding() -> tuple[Path, str] | None:
    database, call_id = os.environ.get("AGENT_INTERFACE_RECEIPT_DB"), os.environ.get("AGENT_INTERFACE_RECEIPT_CALL")
    if not database and not call_id:
        return None
    if not database or not call_id:
        raise RuntimeError("native resource ownership lacks its Call binding")
    with _database(Path(database)) as conn:
        row = conn.execute("select source from calls where id=?", (call_id,)).fetchone()
    if row is None:
        raise RuntimeError("resource ownership binding does not identify a Call")
    if row[0] != "poise:behavior-chain":
        return None
    return Path(database), call_id


def allocate(database: Path, call_id: str, root: Path) -> Path:
    # Resolve legitimate system ancestors (/var on macOS), never the leaf.
    root = root.parent.resolve() / root.name
    with _database(database) as conn:
        conn.execute("begin immediate")
        value = read(conn, call_id)
        if any(entry["path"] == str(root) for entry in value["roots"]):
            raise RuntimeError("native resource directory was already registered")
        value["roots"].append({"path": str(root), "state": "registered"})
        _write(conn, call_id, value)
    # A crash before the next transaction retains the registered, incomplete
    # root. No cleaner may infer that incomplete registration means no disk.
    root.mkdir(mode=0o700, parents=True)
    parent = root.parent.stat()
    node = root.lstat()
    if not stat.S_ISDIR(node.st_mode) or node.st_uid != os.getuid() or node.st_mode & 0o077:
        raise RuntimeError("native resource directory is not private and owned")
    with _database(database) as conn:
        conn.execute("begin immediate")
        value = read(conn, call_id)
        entry = next(entry for entry in value["roots"] if entry["path"] == str(root))
        entry.update(state="allocated", device=str(node.st_dev), inode=str(node.st_ino),
                     parent_device=str(parent.st_dev), parent_inode=str(parent.st_ino))
        _write(conn, call_id, value)
    return root


def failure(database: Path, call_id: str, cause: str, root: Path | None = None) -> None:
    with _database(database) as conn:
        conn.execute("begin immediate")
        value = read(conn, call_id)
        evidence = {"cause": cause, "path": str(root) if root else None}
        if not any(all(item.get(key) == val for key, val in evidence.items()) for item in value["errors"]):
            value["errors"].append({**evidence, "at": time()})
        _write(conn, call_id, value)


def released(value: dict | None) -> bool:
    if not healthy(value):
        return False
    return all(entry.get("state") == "reclaimed" for entry in value["roots"])


def healthy(value: dict | None) -> bool:
    if not isinstance(value, dict) or value.get("version") not in (1, 2) or value.get("process_pending") is True \
            or not isinstance(value.get("roots"), list) or not isinstance(value.get("errors"), list):
        return False
    if value["version"] == 2 and (not isinstance(value.get("namespace"), dict)
                                  or value["namespace"].get("state") not in ("settled", "not_started")):
        return False
    roots = {entry["path"]: entry for entry in value["roots"]}
    return all(item.get("cause") != "resources_unknown" and item.get("path") in roots
               and roots[item["path"]].get("recovered_at", 0) >= item["at"] for item in value["errors"])


def process_check(database: Path, call_id: str, *, complete: bool = False) -> None:
    with _database(database) as conn:
        conn.execute("begin immediate")
        value = read(conn, call_id)
        value["process_pending"] = not complete
        _write(conn, call_id, value)


def publication_released(settled_at, encoded: str | None, artifact: dict) -> bool:
    value = json.loads(encoded) if encoded else None
    return settled_at is not None and released(value) and not artifact.get("resource_error") \
        and artifact.get("phase") != "resources_unknown"


def _remove_directory(parent_fd: int, name: str, device: int, inode: int) -> None:
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    try:
        node = os.fstat(fd)
        if (node.st_dev, node.st_ino) != (device, inode):
            raise RuntimeError("native resource directory changed before opening")
        os.fchmod(fd, stat.S_IMODE(node.st_mode) | stat.S_IRWXU)
        for child in os.listdir(fd):
            info = os.stat(child, dir_fd=fd, follow_symlinks=False)
            if info.st_dev != node.st_dev:
                raise RuntimeError("native resource cleanup crosses a filesystem boundary")
            if stat.S_ISDIR(info.st_mode):
                _remove_directory(fd, child, info.st_dev, info.st_ino)
            else:
                os.unlink(child, dir_fd=fd)
        current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (device, inode):
            raise RuntimeError("native resource directory changed before unlinking")
        os.rmdir(name, dir_fd=parent_fd)
    finally:
        os.close(fd)


def cleanup(database: Path, call_id: str, root: Path) -> bool:
    from . import issue_review, native_namespace
    root = root.parent.resolve() / root.name
    with _database(database) as conn:
        value = read(conn, call_id)
    if value.get("process_pending") or any(item["cause"] == "resources_unknown" for item in value["errors"]):
        return False
    entry = next((entry for entry in value["roots"] if entry["path"] == str(root)), None)
    if entry is None:
        raise RuntimeError("native cleanup lacks a registered directory")
    if entry["state"] == "reclaimed":
        return True
    try:
        if value["version"] == 2 and value["namespace"]["state"] == "active":
            scope = native_namespace.active()
            if scope is None or scope.key["callId"] != call_id:
                raise RuntimeError("native disk cleanup lacks its original live or settled namespace")
            scope.require_idle()
        elif value["version"] == 2 and value["namespace"]["state"] != "settled":
            raise RuntimeError("native disk cleanup lacks process settlement")
        if entry["state"] != "allocated":
            raise RuntimeError("native resource allocation identity is incomplete")
        parent_fd = os.open(root.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            parent = os.fstat(parent_fd)
            node = os.stat(root.name, dir_fd=parent_fd, follow_symlinks=False)
            if tuple(str(item) for item in (parent.st_dev, parent.st_ino, node.st_dev, node.st_ino)) != \
                    (entry["parent_device"], entry["parent_inode"], entry["device"], entry["inode"]) \
                    or not stat.S_ISDIR(node.st_mode):
                raise RuntimeError("native resource directory identity changed")
            # Historical Calls retain their path-scan veto. A version-2 Call
            # uses its original namespace proof; cleanup must not launch an
            # unowned ps helper after that boundary has already ended.
            if value["version"] == 1 and issue_review._cwd_pids(root, require_complete=True) != []:
                raise RuntimeError("native resource directory still has unverified processes")
            _remove_directory(parent_fd, root.name, node.st_dev, node.st_ino)
        finally:
            os.close(parent_fd)
    except (OSError, RuntimeError) as error:
        failure(database, call_id, str(error), root)
        return False
    with _database(database) as conn:
        conn.execute("begin immediate")
        value = read(conn, call_id)
        kept = next(item for item in value["roots"] if item["path"] == str(root))
        if kept != entry:
            raise RuntimeError("native resource ownership changed during cleanup")
        kept.update(state="reclaimed", reclaimed_at=time())
        if any(item.get("path") == str(root) and item["cause"] != "resources_unknown" for item in value["errors"]):
            kept["recovered_at"] = kept["reclaimed_at"]
        _write(conn, call_id, value)
    return True


@contextmanager
def temporary_directory(prefix: str):
    bound = binding()
    if bound is None:
        import tempfile
        with tempfile.TemporaryDirectory(prefix=prefix) as directory:
            yield directory
        return
    database, call_id = bound
    # All PR attempts and all three preparation/provider/watch roots live
    # below the same deterministic Call parent, rather than untracked /tmp.
    parent = call_directory(database, call_id)
    with _database(database) as conn:
        value = read(conn, call_id)
    if not any(entry["path"] == str(parent.parent.resolve() / parent.name) for entry in value["roots"]):
        allocate(database, call_id, parent)
    root = allocate(database, call_id, parent / f"{prefix}{uuid4().hex}")
    try:
        yield str(root)
    finally:
        if not cleanup(database, call_id, root):
            raise RuntimeError("native temporary resource cleanup is unverified")


def cleanup_remaining(database: Path, call_id: str) -> None:
    with _database(database) as conn:
        value = read(conn, call_id)
    # Nested temporary directories are acknowledged before their Call parent.
    for entry in sorted(value["roots"], key=lambda item: len(Path(item["path"]).parts), reverse=True):
        if entry["state"] != "reclaimed":
            cleanup(database, call_id, Path(entry["path"]))
