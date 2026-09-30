from datetime import timedelta

from server.snapshot import Snapshot


def active(snap: Snapshot) -> set[tuple[str, str]]:
    return {(a["source"], a["code"]) for a in snap.to_dict()["alarms_active"]}


def pallet_map(snap: Snapshot) -> dict[int, dict]:
    return {p["cv"]: p for p in snap.to_dict()["pallets"]}


def move(feed, frm: int, to: int) -> None:
    """팔레트 한 칸 이동: 출발 → 도착 → 출발 구간 비움 → 도착 구간 정지."""
    feed("conveyor", cv=frm, state="DEPARTING")
    feed("conveyor", cv=to, state="ARRIVING")
    feed("conveyor", cv=frm, state="EMPTY")
    feed("conveyor", cv=to, state="HOLD")


def work(feed, robot: int, job: str, secs: float = 3.0) -> None:
    feed("robot", robot=robot, state="BUSY", job=job)
    feed("robot", robot=robot, state="DONE", job=job, dt=secs)
    feed("robot", robot=robot, state="READY")


# ---- 6종 이벤트 각각 ----


def test_initial_state():
    d = Snapshot().to_dict()
    assert d["seq"] == 0
    assert d["line"]["state"] == "STOP"
    assert [c["state"] for c in d["conveyors"]] == ["EMPTY"] * 5
    assert [r["state"] for r in d["robots"]] == ["READY"] * 3
    assert d["link"] == {"gateway": False, "plc": False, "robots": [False, False, False]}
    assert d["alarms_active"] == [] and d["pallets"] == [] and d["last_run"] is None


def test_line_event(feed):
    snap = feed("line", state="RUN")
    assert snap.to_dict()["line"]["state"] == "RUN"
    assert snap.seq == 1


def test_conveyor_event(feed):
    snap = feed("conveyor", cv=3, state="DEPARTING")
    assert snap.to_dict()["conveyors"][2] == {"cv": 3, "state": "DEPARTING"}


def test_robot_event(feed):
    snap = feed("robot", robot=2, state="BUSY", job="ROBOT2_TURRET_MATE")
    assert snap.to_dict()["robots"][1] == {"robot": 2, "state": "BUSY", "job": "ROBOT2_TURRET_MATE"}
    snap = feed("robot", robot=2, state="READY")
    assert snap.to_dict()["robots"][1]["job"] is None


def test_result_event(feed):
    feed("conveyor", cv=4, state="HOLD")
    snap = feed("result", run_no=7, ng=True, reason="TURRET_MISSING")
    p = pallet_map(snap)[4]
    assert (p["run_no"], p["ng"], p["reason"]) == (7, True, "TURRET_MISSING")
    assert snap.to_dict()["last_run"]["run_no"] == 7


def test_alarm_event_raise_and_clear(feed):
    snap = feed("alarm", source="plc", code="E100", msg="서보 이상")
    assert active(snap) == {("plc", "E100")}
    snap = feed("alarm", source="plc", code="E100", cleared=True)
    assert active(snap) == set()
    hist = snap.to_dict()["alarm_history"]
    assert hist[0]["cleared_at"] is not None and hist[0]["msg"] == "서보 이상"


def test_link_event_partial_update(feed):
    snap = feed("link", plc=True, robots=[True, True, True])
    assert snap.link == {"gateway": True, "plc": True, "robots": [True, True, True]}
    snap = feed("link", robots=[True, True, False])
    assert snap.link["plc"] is True
    assert active(snap) == {("robot3", "LINK_LOST")}
    snap = feed("link", robots=[True, True, True])
    assert active(snap) == set()


# ---- 파생 알람 ----


def test_alarm_dedupe_between_explicit_and_derived(feed):
    feed("robot", robot=2, state="ERR", job="ROBOT2_WELD_MOTION")
    snap = feed("alarm", source="robot2", code="ERR", msg="gateway alarm")
    assert active(snap) == {("robot2", "ERR")}
    assert len(snap.alarm_history) == 1
    snap = feed("robot", robot=2, state="READY")
    assert active(snap) == set()


def test_estop_alarm_derived_and_cleared_with_time(feed):
    feed("line", state="RUN")
    snap = feed("line", state="ESTOP")
    assert active(snap) == {("line", "ESTOP")}
    snap = feed("line", state="STOP")
    assert active(snap) == set()
    a = snap.to_dict()["alarm_history"][0]
    assert a["code"] == "ESTOP" and a["cleared_at"] > a["raised_at"]


def test_initial_link_false_does_not_raise_alarm(feed):
    snap = feed("link", plc=False, robots=[False, False, False])
    assert active(snap) == set()


def test_any_event_marks_gateway_alive(feed):
    snap = feed("line", state="STOP")
    assert snap.link["gateway"] is True


def test_gateway_timeout(feed):
    snap = feed("line", state="RUN")
    t = feed.t
    assert snap.check_gateway(t + timedelta(seconds=1.9), 2.0) is False
    assert snap.check_gateway(t + timedelta(seconds=2.1), 2.0) is True
    assert snap.link["gateway"] is False
    assert active(snap) == {("gateway", "LINK_LOST")}
    assert snap.check_gateway(t + timedelta(seconds=5), 2.0) is False  # 이미 끊김
    snap = feed("link", plc=True)
    assert snap.link["gateway"] is True and active(snap) == set()


# ---- 팔레트 추적 ----


def test_pallet_fifo_moves_through_all_segments(feed):
    feed("conveyor", cv=1, state="ARRIVING")
    snap = feed("conveyor", cv=1, state="HOLD")
    assert list(pallet_map(snap)) == [1]
    pid = snap.pallets[0].id
    for k in range(1, 5):
        move(feed, k, k + 1)
        assert list(pallet_map(snap)) == [k + 1]
    assert snap.pallets[0].id == pid
    snap = feed("conveyor", cv=5, state="EMPTY")
    assert snap.pallets == []  # 보관창고로 이동


def test_two_pallets_keep_order(feed):
    feed("conveyor", cv=1, state="HOLD")
    move(feed, 1, 2)
    snap = feed("conveyor", cv=1, state="HOLD")
    first, second = snap.pallets
    assert (first.cv, second.cv) == (2, 1)
    move(feed, 2, 3)
    move(feed, 1, 2)
    assert (first.cv, second.cv) == (3, 2)


def test_stage_progress_and_station_times(feed):
    feed("conveyor", cv=1, state="HOLD")
    work(feed, 1, "ROBOT1_HULL_PLACE", secs=4)
    assert feed.snap.pallets[0].stage == "HULL"
    work(feed, 1, "ROBOT1_POWERPACK_MOUNT", secs=6)
    assert feed.snap.pallets[0].stage == "POWERPACK"
    move(feed, 1, 2)
    move(feed, 2, 3)
    work(feed, 2, "ROBOT2_TURRET_MATE", secs=5)
    work(feed, 2, "ROBOT2_WELD_MOTION", secs=2)
    p = feed.snap.pallets[0]
    assert (p.stage, p.welded) == ("TURRET", True)
    assert p.times == {"ST1": 10.0, "ST2": 7.0, "ST3": 0.0}


def test_robot_err_marks_pallet_ng_and_skip(feed):
    feed("conveyor", cv=1, state="HOLD")
    feed("robot", robot=1, state="BUSY", job="ROBOT1_POWERPACK_MOUNT")
    snap = feed("robot", robot=1, state="ERR")
    p = pallet_map(snap)[1]
    assert (p["ng"], p["skip"], p["reason"]) == (True, True, "ROBOT1_ERR")
    assert snap.robots[1]["job"] == "ROBOT1_POWERPACK_MOUNT"  # ERR 중에도 작업 코드 유지
    assert active(snap) == {("robot1", "ERR")}


def test_sort_counts_tray_and_finishes_run(feed):
    feed("conveyor", cv=1, state="HOLD")
    feed("robot", robot=1, state="BUSY", job="ROBOT1_HULL_PLACE")
    for k in range(1, 4):
        move(feed, k, k + 1)
    feed("result", run_no=3, ng=False)
    work(feed, 3, "ROBOT3_SORT", secs=5)
    snap = feed.snap
    assert snap.trays == {"pass": 1, "fail": 0}
    run = snap.to_dict()["last_run"]
    assert run["run_no"] == 3 and run["ng"] is False and run["reason"] is None
    assert run["started_at"] and run["result_at"] and run["finished_at"]
    assert run["times"]["ST3"] == 5.0
    assert pallet_map(snap)[4]["stage"] is None  # 전차를 트레이로 옮김


def test_sort_after_ng_result_goes_to_fail_tray(feed):
    feed("conveyor", cv=4, state="HOLD")
    feed("result", run_no=4, ng=True)
    snap = feed.snap
    assert pallet_map(snap)[4]["reason"] == "UNKNOWN"
    work(feed, 3, "ROBOT3_SORT")
    assert snap.trays == {"pass": 0, "fail": 1}


def test_seq_increments_per_event(feed):
    for _ in range(5):
        feed("line", state="RUN")
    assert feed.snap.seq == 5
