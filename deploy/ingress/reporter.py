#!/usr/bin/env python3
"""Bounded Caddy diagnostic delivery over a command-restricted operator key."""

import argparse
import datetime as dt
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import selectors
import subprocess
import time

LOG = logging.getLogger("poise-ingress")
UTC = dt.timezone.utc
MAX_BYTES = 1024 * 1024
MAX_LINES = 1000


class ReadBound(Exception):
    """The source window must be reduced or recorded as incomplete."""


def iso(value):
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def instant(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def capture(process, payload, timeout, limit):
    """Drain finite output and write stdin under one absolute deadline."""
    deadline = time.monotonic() + timeout
    result = bytearray()
    offset = 0
    with selectors.DefaultSelector() as ready:
        ready.register(process.stdout, selectors.EVENT_READ)
        if process.stdin:
            os.set_blocking(process.stdin.fileno(), False)
            if payload:
                ready.register(process.stdin, selectors.EVENT_WRITE)
            else:
                process.stdin.close()
        while ready.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ReadBound("process exceeded its read deadline")
            for key, mode in ready.select(remaining):
                if mode == selectors.EVENT_WRITE:
                    offset += os.write(key.fd, payload[offset:offset + 8192])
                    if offset == len(payload):
                        ready.unregister(key.fileobj)
                        key.fileobj.close()
                else:
                    chunk = os.read(key.fd, 8192)
                    if not chunk:
                        ready.unregister(key.fileobj)
                    else:
                        result.extend(chunk)
                        if len(result) > limit:
                            raise ReadBound("process exceeded its output bound")
        process.wait(timeout=max(0.01, deadline - time.monotonic()))
    if process.returncode:
        raise RuntimeError("diagnostic source or transport process failed")
    return bytes(result)


def bounded_command(argv, timeout=8, limit=MAX_BYTES):
    with subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as process:
        try:
            return capture(process, None, timeout, limit)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def projected(line, domain, start, end, occurrence=0):
    stamp, separator, text = line.partition(b" ")
    if not separator:
        return None
    try:
        observed = instant(stamp.decode("ascii"))
        row = json.loads(text)
    except (ValueError, UnicodeError):
        return None  # Unstructured process output is outside the native contract.
    if not isinstance(row, dict) or not start <= observed <= end:
        return None
    request = row.get("request")
    if not isinstance(request, dict) or not isinstance(request.get("host"), str):
        return None
    host = request["host"].lower().split(":", 1)[0]
    if host != domain and not host.endswith("." + domain):
        return None
    if str(row.get("level", "unknown")).lower() in ("debug", "info", "notice", "trace"):
        return None
    # Never transmit headers, URI/query, body or unrelated application fields.
    log = {key: row[key] for key in ("level", "ts", "msg", "message", "logger", "request_id", "duration", "errno") if key in row}
    log["request"] = {"host": host, "method": request.get("method")}
    record = {"id": hashlib.sha256(line + b":" + str(occurrence).encode()).hexdigest(), "time": iso(observed), "log": log}
    if len(json.dumps(record).encode()) > 64 * 1024:
        raise ReadBound("Poise source record exceeds 64 KiB")
    return record


def retained_boundary(container):
    """Read only Docker's first retained timestamp, never materialize its history."""
    with subprocess.Popen(["/usr/bin/docker", "logs", "--timestamps", container], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as process:
        deadline = time.monotonic() + 3
        prefix = bytearray()
        try:
            with selectors.DefaultSelector() as ready:
                ready.register(process.stdout, selectors.EVENT_READ)
                while b" " not in prefix:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not ready.select(remaining):
                        raise RuntimeError("source retention boundary timed out")
                    chunk = os.read(process.stdout.fileno(), 128)
                    if not chunk:
                        if process.wait(timeout=1):
                            raise RuntimeError("source retention boundary failed")
                        return None
                    prefix.extend(chunk)
                    if len(prefix) > 256:
                        raise RuntimeError("source retention timestamp is invalid")
            return iso(instant(prefix.split(b" ", 1)[0].decode("ascii")))
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def collect(config, hello, now=None):
    now = now or dt.datetime.now(UTC)
    domain = config["domain"]
    if hello.get("version") != 1 or hello.get("domain") != domain:
        raise RuntimeError("gateway ingress contract/domain does not match reporter configuration")
    container = bounded_command(["/usr/bin/docker", "inspect", "--format", "{{.Id}}", config["container"]], timeout=3, limit=1024).decode().strip()
    if not re.fullmatch(r"[a-f0-9]{64}", container):
        raise RuntimeError("source container identity is invalid")
    checkpoint = hello.get("checkpoint")
    cursor = json.loads(checkpoint) if checkpoint is not None else None
    retained = retained_boundary(container)
    end = now - dt.timedelta(seconds=1)
    initial = max(end - dt.timedelta(days=30), min(instant(retained), end)) if retained else end - dt.timedelta(minutes=5)
    start = instant(cursor["until"]) if cursor and cursor["container"] == container else initial
    # Catch up a stopped reader in finite windows; do not pretend old replay is current.
    end = min(end, start + dt.timedelta(days=30))
    batch = {"version": 1, "expected": checkpoint, "container": container, "from": iso(start), "until": iso(end), "state": "complete", "records": []}
    batch["retainedFrom"] = retained
    deadline = time.monotonic() + 12
    while True:
        remaining = deadline - time.monotonic()
        if remaining < 1:
            batch["state"] = "unavailable"
            batch["records"] = []
            break
        try:
            raw = bounded_command(["/usr/bin/docker", "logs", "--timestamps", "--since", iso(start), "--until", iso(end), "--tail", str(MAX_LINES + 1), container], timeout=min(3, remaining))
            lines = raw.splitlines()
            if len(lines) > MAX_LINES:
                raise ReadBound("source window exceeds 1000 records")
            records = []
            repeats = {}
            for line in lines:
                identity = hashlib.sha256(line).digest()
                occurrence = repeats.get(identity, 0)
                repeats[identity] = occurrence + 1
                record = projected(line, domain, start, end, occurrence)
                if record is not None:
                    records.append(record)
            batch["records"] = records
            if len(records) > 100:
                raise ReadBound("delivery exceeds 100 diagnostic records")
            if len(json.dumps(batch).encode()) > MAX_BYTES:
                raise ReadBound("source delivery exceeds 1 MiB")
            break
        except ReadBound:
            if (end - start).total_seconds() <= 1:
                batch["state"] = "bounded"
                batch["records"] = []
                break
            end = start + (end - start) / 2
            batch["until"] = iso(end)
        except RuntimeError:
            batch["state"] = "unavailable"
            break
    return batch


def read_hello(process):
    deadline = time.monotonic() + 8
    result = bytearray()
    with selectors.DefaultSelector() as ready:
        ready.register(process.stdout, selectors.EVENT_READ)
        while b"\n" not in result:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not ready.select(remaining):
                raise RuntimeError("gateway ingress handshake timed out")
            chunk = os.read(process.stdout.fileno(), 4096)
            if not chunk:
                raise RuntimeError("gateway ingress handshake closed")
            result.extend(chunk)
            if len(result) > 4096:
                raise RuntimeError("gateway ingress handshake exceeds its bound")
    return json.loads(result)


def deliver(config):
    argv = ["/usr/bin/ssh", "-F", "/dev/null", "-T", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
            "-o", "ConnectTimeout=5", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2", "-o", "IdentityAgent=none",
            "-o", "UserKnownHostsFile=" + config["known_hosts"], "-i", config["identity"], config["target"]]
    # The server's authorized_keys entry supplies the sole command.
    with subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
        try:
            hello = read_hello(process)
            batch = collect(config, hello)
            reply = json.loads(capture(process, json.dumps(batch, separators=(",", ":")).encode(), 8, 4096))
            expected = hello["checkpoint"] if batch["state"] == "unavailable" else json.dumps({"container": batch["container"], "until": batch["until"]}, separators=(",", ":"))
            if reply.get("accepted") is not True or reply.get("checkpoint") != expected:
                raise RuntimeError("gateway did not acknowledge the committed source window")
            return reply
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def configuration(path):
    config = json.loads(Path(path).read_text())
    if set(config) != {"domain", "container", "target", "identity", "known_hosts"} or not all(isinstance(value, str) for value in config.values()):
        raise ValueError("reporter configuration requires domain, container, target, identity and known_hosts")
    if not re.fullmatch(r"[a-z0-9.-]+", config["domain"]) or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,128}", config["container"]) or not re.fullmatch(r"[a-z_][a-z0-9_-]*@[a-zA-Z0-9.-]+", config["target"]):
        raise ValueError("invalid reporter domain, container or SSH target")
    for key in ("identity", "known_hosts"):
        if not Path(config[key]).is_absolute() or not Path(config[key]).is_file():
            raise ValueError(key + " must name an existing absolute file")
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    config = configuration(args.config)
    previous = None
    while True:
        reply = deliver(config)
        if reply["currentStatus"] != previous and reply["currentStatus"] != "connected":
            LOG.warning("external proxy collection is %s", reply["currentStatus"])
        previous = reply["currentStatus"]
        if args.once:
            return
        time.sleep(1 if reply["currentStatus"] == "partial" else 15)


if __name__ == "__main__":
    main()
