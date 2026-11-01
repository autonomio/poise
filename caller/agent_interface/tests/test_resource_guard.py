"""Resource accounting and durable-cause contracts; no provider is invoked."""
import json
import os
import threading

import pytest

import agent_interface as api
from agent_interface import resource_guard as guard


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "DB", tmp_path / "calls.sqlite3")
    monkeypatch.setattr(api, "RESPONSES", tmp_path / "responses")
    monkeypatch.setattr(api, "_native_cli", False)
    api.init_db()
    call = api.track("fixture-model", "contract", "7", "example/repo", "reviewer", "implement_issue",
                     source="poise:behavior-chain", correlation_id="guard-contract")
    return call


def receipt(call):
    with api.db() as conn:
        return dict(conn.execute("select * from calls where id=?", (call,)).fetchone())


def observer(call, memory=10, disk=None):
    monitor = guard.Guard(api.DB, call, None, {"version": 1, "memoryBytes": memory, "diskBytes": disk})
    monitor.breach = {"memoryBytes": 11, "diskBytes": 12, "completedAt": 1800000000,
                      "completedMonotonic": 1, "memoryModel": "rss"}
    return monitor


@pytest.mark.parametrize("value", [False, [], {}, {"version": 1, "memoryBytes": None, "diskBytes": None},
                                 {"version": True, "memoryBytes": 1, "diskBytes": None},
                                 {"version": 1, "memoryBytes": 0, "diskBytes": None},
                                 {"version": 1, "memoryBytes": 2 ** 53, "diskBytes": None}])
def test_contradictory_limits_refuse_before_any_execution(value):
    with pytest.raises(ValueError):
        guard.limits(json.dumps(value))


def test_bounded_dimensions_are_explicit_and_legacy_is_unenforced():
    assert guard.limits(None) is None
    assert guard.limits('{"version":1,"memoryBytes":null,"diskBytes":8}') == {
        "version": 1, "memoryBytes": None, "diskBytes": 8}


def test_allocated_disk_deduplicates_links_and_never_follows_symlink(tmp_path):
    own, foreign = tmp_path / "own", tmp_path / "foreign"
    own.mkdir()
    foreign.mkdir()
    (own / "data").write_bytes(b"x" * 65536)
    os.link(own / "data", own / "same-inode")
    (foreign / "unrelated").write_bytes(b"x" * 1048576)
    (own / "outside").symlink_to(foreign, target_is_directory=True)
    fd = os.open(own, os.O_RDONLY)
    try:
        seen = set()
        measured = guard.tree_bytes(fd, seen, threading.Event())
        assert measured == sum(path.lstat().st_blocks * 512 for path in (own, own / "data", own / "outside"))
        assert guard.tree_bytes(fd, seen, threading.Event()) == 0
    finally:
        os.close(fd)


@pytest.mark.parametrize("memory,disk,code", [(10, None, "resource_memory_exceeded"), (None, 8, "resource_disk_exceeded")])
def test_breach_survives_completion_and_no_write_reclassification(database, memory, disk, code):
    call = database
    monitor = observer(call, memory, disk)
    assert monitor.poll() is True
    api.finish(call, "completed", response='{"accepted":"original-artifact"}', action="published", outcome="published")
    first = receipt(call)
    assert first["status"] == "failed" and first["error_code"] == code
    assert first["action"] is None and first["outcome"] is None
    assert json.loads(first["resource_guard"])["failure"]["code"] == code
    with api.db() as conn:
        conn.execute("update calls set artifact=?,resources_settled_at=? where id=?",
                     ('{"phase":"executing"}', 1, call))
        api.mark_managed_no_write(conn, call)
    assert receipt(call)["action"] is None
    assert receipt(call)["response_path"] == first["response_path"]


@pytest.mark.parametrize("first", ["stopping", "native_timeout", "completed"])
def test_prior_stop_timeout_or_completion_wins_over_later_breach(database, first):
    call = database
    if first == "completed":
        api.finish(call, "completed", response="durable-original")
    else:
        with api.db() as conn:
            conn.execute("update calls set error_code=?,error='original cause' where id=?", (first, call))
    before = receipt(call)
    assert observer(call).poll() is False
    assert receipt(call) == before


def test_unavailable_sample_is_a_durable_stop_not_zero(database, monkeypatch):
    monitor = guard.Guard(api.DB, database, None, {"version": 1, "memoryBytes": 10, "diskBytes": None})
    monitor.last_complete = 1
    monitor.error = "permission denied"
    monkeypatch.setattr(guard, "monotonic", lambda: 7)
    assert monitor.poll() is True
    value = receipt(database)
    assert value["error_code"] == "resource_measurement_unavailable"
    assert "permission denied" in value["error"]


def test_breach_survives_original_parent_loss_and_reaping(database, monkeypatch):
    assert observer(database).poll() is True
    monkeypatch.setattr(api.process_identity, "state", lambda *args: "gone")
    assert api.reap_interrupted() == 0
    assert receipt(database)["error_code"] == "resource_memory_exceeded"


@pytest.mark.parametrize("phase,no_write", [("executing", True), ("publishing", False)])
def test_terminal_guard_fences_new_publication_but_keeps_an_uncertain_existing_plan(database, phase, no_write):
    call = database
    with api.db() as conn:
        conn.execute("update calls set artifact=?,action_plan=? where id=?",
                     (json.dumps({"phase": phase}), '{"original":"plan"}', call))
    assert observer(call).poll() is True
    row = receipt(call)
    assert row["status"] == "failed"
    assert json.loads(row["resource_guard"])["failure"]["noWrite"] is no_write
    assert row["action_plan"] == '{"original":"plan"}'
    with pytest.raises(ValueError, match="original durable record"):
        api.persist_action_plan(call, {"replacement": "forbidden"})


def test_parent_loss_before_a_breach_does_not_invent_a_limit_failure(database, monkeypatch):
    monkeypatch.setattr(api.process_identity, "state", lambda *args: "gone")
    assert api.reap_interrupted() == 1
    assert receipt(database)["error_code"] == "interrupted"
