"""Resume removal of a specifically recorded, abandoned mirror generation."""
import json
import os
import re
import shutil
import stat
import sys
import uuid
from pathlib import Path

FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _read(parent: int, name: str) -> bytes:
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    with os.fdopen(descriptor, "rb") as file:
        if not stat.S_ISREG(os.fstat(file.fileno()).st_mode):
            raise ValueError("mirror recovery metadata is not a regular file")
        data = file.read(4097)
        if len(data) > 4096:
            raise ValueError("mirror recovery metadata is too large")
        return data


def _remove(parent: int, name: str, marker: str, identity: tuple[int, int], receipt: str) -> None:
    descriptor = os.open(name, FLAGS, dir_fd=parent)
    try:
        info = os.fstat(descriptor)
        if (info.st_dev, info.st_ino) != identity or _read(descriptor, marker) != marker.encode():
            raise ValueError("mirror recovery identity changed")
        # Keep the marker until all payload is gone. An interruption at any
        # earlier point leaves the same proof for the next attempt.
        with os.scandir(descriptor) as entries:
            names = [entry.name for entry in entries if entry.name != marker]
        for child in names:
            info = os.stat(child, dir_fd=descriptor, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                shutil.rmtree(child, dir_fd=descriptor)
            else:
                os.unlink(child, dir_fd=descriptor)
        # Persist the empty state before removing its marker and directory.
        # A crash after rmdir can then retire the receipt without mistaking a
        # newly created mirror for the recorded generation.
        next_receipt = receipt + "." + uuid.uuid4().hex
        next_fd = os.open(next_receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        with os.fdopen(next_fd, "w") as file:
            json.dump({"version": 1, "dev": identity[0], "ino": identity[1], "empty": True}, file)
            file.flush()
            os.fsync(file.fileno())
        os.replace(next_receipt, receipt, src_dir_fd=parent, dst_dir_fd=parent)
        os.fsync(parent)
        os.unlink(marker, dir_fd=descriptor)
        info = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if not os.path.samestat(info, os.fstat(descriptor)):
            raise ValueError("mirror recovery pathname changed")
        os.rmdir(name, dir_fd=parent)
    finally:
        os.close(descriptor)


def recover(mirror: Path) -> None:
    """Called only while holding the repository's exclusive mirror lock."""
    if not shutil.rmtree.avoids_symlink_attacks:
        raise RuntimeError("mirror recovery requires symlink-safe directory removal")
    parent = os.open(mirror.parent, FLAGS)
    held = False
    try:
        prefix = mirror.name + ".discard-"
        with os.scandir(parent) as entries:
            receipts = [e.name for e in entries if re.fullmatch(re.escape(prefix) + r"[0-9a-f]{32}\.receipt", e.name)]
        for receipt in receipts:
            try:
                token = receipt[len(prefix):-len(".receipt")]
                marker = ".poise-discard-" + token
                sibling = receipt[:-len(".receipt")]
                value = json.loads(_read(parent, receipt))
                if not isinstance(value, dict) or set(value) not in ({"version", "dev", "ino"},
                        {"version", "dev", "ino", "empty"}) or value["version"] != 1 \
                        or type(value["dev"]) is not int or type(value["ino"]) is not int \
                        or ("empty" in value and value["empty"] is not True):
                    raise ValueError("invalid mirror recovery receipt")
                identity = (value["dev"], value["ino"])
                try:
                    descriptor = os.open(sibling, FLAGS, dir_fd=parent)
                except FileNotFoundError:
                    if value.get("empty") is True:
                        os.unlink(receipt, dir_fd=parent)
                        continue
                    # The receipt was durable before rename. Only move the
                    # same recorded generation, never a later replacement.
                    try:
                        descriptor = os.open(mirror.name, FLAGS, dir_fd=parent)
                    except FileNotFoundError:
                        # Neither pathname names the recorded generation.
                        # Preserve the receipt for inspection and report this
                        # attempt; the next checkout can create a new mirror.
                        try:
                            os.link(receipt, receipt + ".missing", src_dir_fd=parent, dst_dir_fd=parent,
                                    follow_symlinks=False)
                        except FileExistsError:
                            source = os.stat(receipt, dir_fd=parent, follow_symlinks=False)
                            destination = os.stat(receipt + ".missing", dir_fd=parent, follow_symlinks=False)
                            if not stat.S_ISREG(source.st_mode) or not os.path.samestat(source, destination):
                                raise ValueError("missing mirror receipt destination changed")
                        os.unlink(receipt, dir_fd=parent)
                        os.fsync(parent)
                        print(f"mirror recovery held {receipt}: generation missing; receipt retained", file=sys.stderr)
                        held = True
                        continue
                    try:
                        info = os.fstat(descriptor)
                        if (info.st_dev, info.st_ino) != identity or _read(descriptor, marker) != marker.encode():
                            raise ValueError("mirror recovery identity changed")
                        os.rename(mirror.name, sibling, src_dir_fd=parent, dst_dir_fd=parent)
                    finally:
                        os.close(descriptor)
                else:
                    try:
                        info = os.fstat(descriptor)
                        if (info.st_dev, info.st_ino) != identity:
                            raise ValueError("mirror recovery identity changed")
                        if value.get("empty") is True:
                            try:
                                os.stat(marker, dir_fd=descriptor, follow_symlinks=False)
                            except FileNotFoundError:
                                with os.scandir(descriptor) as entries:
                                    if any(entries):
                                        raise ValueError("empty mirror recovery directory contains new files")
                                if not os.path.samestat(os.stat(sibling, dir_fd=parent, follow_symlinks=False), os.fstat(descriptor)):
                                    raise ValueError("mirror recovery pathname changed")
                                os.rmdir(sibling, dir_fd=parent)
                                os.unlink(receipt, dir_fd=parent)
                                continue
                    finally:
                        os.close(descriptor)
                _remove(parent, sibling, marker, identity, receipt)
                os.unlink(receipt, dir_fd=parent)
            except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
                # Missing or altered proof leaves the generation untouched.
                print(f"mirror recovery held {receipt}: {error}", file=sys.stderr)
                held = True
    finally:
        os.close(parent)
    if held:
        raise RuntimeError(f"mirror recovery held for {mirror}; see the recorded recovery evidence")


def discard(mirror: Path, descriptor: int) -> bool:
    """Record and remove one opened mirror; recovery never adopts an unknown path."""
    if not shutil.rmtree.avoids_symlink_attacks:
        raise RuntimeError("mirror recovery requires symlink-safe directory removal")
    token = uuid.uuid4().hex
    marker = ".poise-discard-" + token
    sibling = mirror.name + ".discard-" + token
    receipt = sibling + ".receipt"
    info = os.fstat(descriptor)
    parent = os.open(mirror.parent, FLAGS)
    try:
        try:
            if not os.path.samestat(os.stat(mirror.name, dir_fd=parent, follow_symlinks=False), info):
                return False
        except FileNotFoundError:
            return False
        marker_fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=descriptor)
        with os.fdopen(marker_fd, "wb") as file:
            file.write(marker.encode())
            file.flush()
            os.fsync(file.fileno())
        os.fsync(descriptor)
        pending = receipt + ".pending"
        receipt_fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        with os.fdopen(receipt_fd, "w") as file:
            json.dump({"version": 1, "dev": info.st_dev, "ino": info.st_ino}, file)
            file.flush()
            os.fsync(file.fileno())
        os.link(pending, receipt, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
        os.unlink(pending, dir_fd=parent)
        os.fsync(parent)
        try:
            if not os.path.samestat(os.stat(mirror.name, dir_fd=parent, follow_symlinks=False), info):
                return False
            os.rename(mirror.name, sibling, src_dir_fd=parent, dst_dir_fd=parent)
        except FileNotFoundError:
            return False
        if not os.path.samestat(os.stat(sibling, dir_fd=parent, follow_symlinks=False), info):
            try:
                os.rename(sibling, mirror.name, src_dir_fd=parent, dst_dir_fd=parent)
            except OSError:
                pass
            return False
        _remove(parent, sibling, marker, (info.st_dev, info.st_ino), receipt)
        os.unlink(receipt, dir_fd=parent)
        return not os.path.lexists(mirror)
    finally:
        os.close(parent)
