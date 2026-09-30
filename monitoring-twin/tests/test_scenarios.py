"""모의 시나리오 4개를 대기 없이(speed=0) 재생하고 최종 스냅샷을 검사한다."""
import asyncio

import pytest

from mock import replay
from server.schema import parse_event
from server.snapshot import Snapshot


def run(name: str) -> tuple[Snapshot, list[dict]]:
    """재생 후 스냅샷과 이벤트마다의 스냅샷 목록(중간 상태 검사용)을 돌려준다."""
    snap = Snapshot()
    frames: list[dict] = []

    async def sink(raw: dict) -> None:
        ev = parse_event(raw)
        snap.apply(ev, ev.ts)
        frames.append(snap.to_dict())

    asyncio.run(replay.play(replay.load(name), sink, speed=0))
    return snap, frames


def history(snap: Snapshot) -> set[tuple[str, str]]:
    return {(a["source"], a["code"]) for a in snap.alarm_history}


def assert_idle(d: dict) -> None:
    assert d["line"]["state"] == "STOP"
    assert d["alarms_active"] == []
    assert [r["state"] for r in d["robots"]] == ["READY"] * 3
    assert d["link"] == {"gateway": True, "plc": True, "robots": [True, True, True]}


def test_all_scenarios_listed_and_valid():
    assert replay.scenario_names() == ["estop", "link_lost", "normal", "robot1_err"]
    for name in replay.scenario_names():
        tl = replay.timeline(replay.load(name))
        assert [t for t, _, _ in tl] == sorted(t for t, _, _ in tl)


def test_invalid_scenario_rejected():
    with pytest.raises(ValueError, match="step 0"):
        replay.validate({"steps": [{"after_ms": 0, "event": {"type": "conveyor", "cv": 9, "state": "HOLD"}}]})
    with pytest.raises(ValueError, match="step 0"):
        replay.validate({"steps": [{"after_ms": 0}]})


def test_same_time_steps_keep_file_order():
    run_ = {"type": "line", "state": "RUN"}
    stop = {"type": "line", "state": "STOP"}
    tl = replay.timeline({"heartbeat_ms": 1000, "steps": [
        {"after_ms": 1000, "event": run_},
        {"after_ms": 0, "silence_ms": 4000},
        {"after_ms": 0, "event": stop},
    ]})
    assert [(t, ev, s) for t, ev, s in tl if t == 1000] == [
        (1000, run_, 0), (1000, None, 4000), (1000, stop, 0), (1000, replay.HEARTBEAT, 0)
    ]


def test_heartbeat_inserted_every_second():
    tl = replay.timeline({"heartbeat_ms": 1000, "steps": [{"after_ms": 3000, "event": {"type": "line", "state": "RUN"}}]})
    hb = [t for t, ev, _ in tl if ev is replay.HEARTBEAT]
    assert hb == [0, 1000, 2000, 3000]


def test_slow_playback_keeps_real_heartbeat_interval():
    sc = {"heartbeat_ms": 1000, "steps": [{"after_ms": 1000, "event": {"type": "line", "state": "RUN"}}]}
    hb = [t for t, ev, _ in replay.timeline(sc, speed=0.5) if ev is replay.HEARTBEAT]
    assert hb == [0, 500, 1000]  # 가상 500 ms = 0.5배속에서 실제 1초


def test_normal():
    snap, frames = run("normal")
    d = snap.to_dict()
    assert_idle(d)
    assert [c["state"] for c in d["conveyors"]] == ["EMPTY"] * 5
    assert d["pallets"] == []
    assert d["trays"] == {"pass": 1, "fail": 0}
    assert d["storage"] == {"count": 1, "capacity": 3}
    assert d["alarm_history"] == []
    run_ = d["last_run"]
    assert (run_["run_no"], run_["ng"], run_["reason"]) == (1, False, None)
    assert run_["times"] == {"ST1": 7.0, "ST2": 11.0, "ST3": 4.0}
    assert run_["started_at"] < run_["result_at"] < run_["finished_at"]
    # 중간: 팔레트가 CV1~CV5를 차례로 지나고, 단계가 HULL → POWERPACK → TURRET로 쌓임
    cvs = [f["pallets"][0]["cv"] for f in frames if f["pallets"]]
    assert sorted(set(cvs)) == [1, 2, 3, 4, 5] and cvs == sorted(cvs)
    stages = [f["pallets"][0]["stage"] for f in frames if f["pallets"]]
    assert [s for i, s in enumerate(stages) if s and (i == 0 or stages[i - 1] != s)] == ["HULL", "POWERPACK", "TURRET"]


def test_robot1_err():
    snap, frames = run("robot1_err")
    d = snap.to_dict()
    assert_idle(d)
    assert d["trays"] == {"pass": 0, "fail": 1}
    assert d["storage"]["count"] == 1
    assert history(snap) == {("robot1", "ERR")}
    assert d["alarm_history"][0]["cleared_at"] is not None
    run_ = d["last_run"]
    assert (run_["ng"], run_["reason"]) == (True, "ROBOT1_ERR")
    assert run_["times"] == {"ST1": 3.0, "ST2": 0.0, "ST3": 4.0}  # ST2 작업 생략
    # 중간: ERR 직후부터 팔레트는 NG·작업 생략으로 표시되고 파워팩 단계로 가지 않음
    after_err = [f for f in frames if f["pallets"] and f["pallets"][0]["skip"]]
    assert after_err and all(f["pallets"][0]["ng"] for f in after_err)
    assert {f["pallets"][0]["cv"] for f in after_err} == {1, 2, 3, 4, 5}
    assert all(f["pallets"][0]["stage"] in ("HULL", None) for f in frames if f["pallets"])


def test_estop():
    snap, frames = run("estop")
    d = snap.to_dict()
    assert_idle(d)
    assert any(f["line"]["state"] == "ESTOP" and f["alarms_active"] for f in frames)
    a = d["alarm_history"][0]
    assert (a["source"], a["code"]) == ("line", "ESTOP")
    assert a["cleared_at"] > a["raised_at"]
    assert d["pallets"][0]["stage"] == "HULL"  # 복귀 후 작업을 마침


def test_link_lost():
    snap, frames = run("link_lost")
    d = snap.to_dict()
    assert_idle(d)
    assert history(snap) == {("robot3", "LINK_LOST"), ("plc", "LINK_LOST")}
    assert all(a["cleared_at"] for a in d["alarm_history"])
    assert any(f["link"]["robots"] == [True, True, False] for f in frames)
    # 게이트웨이 끊김(silence)은 서버 감시 태스크가 감지한다 → test_link_watchdog.py
