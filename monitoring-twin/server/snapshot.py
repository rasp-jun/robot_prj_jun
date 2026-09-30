"""이벤트를 받아 현재 라인 상태를 유지하는 순수 상태 기계 (I/O 없음).

브라우저는 이 스냅샷만 그린다. 상태 계산은 여기 한 곳에만 둔다.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from . import config
from .schema import (
    AlarmEvent,
    ConveyorEvent,
    Event,
    LineEvent,
    LinkEvent,
    ResultEvent,
    RobotEvent,
)

HISTORY_MAX = 500  # 메모리에 두는 알람 이력 (SQLite 저장은 M5)
HISTORY_SENT = 50  # 스냅샷에 싣는 최근 알람 이력

# 작업 코드가 DONE이 되었을 때 팔레트 위 전차의 진행 단계
JOB_STAGE = {
    "ROBOT1_HULL_PLACE": "HULL",
    "ROBOT1_POWERPACK_MOUNT": "POWERPACK",
    "ROBOT2_TURRET_MATE": "TURRET",
}


def _iso(t: Optional[datetime]) -> Optional[str]:
    return t.isoformat() if t else None


@dataclass
class Pallet:
    id: str
    cv: int
    stage: Optional[str] = None  # None(빈 팔레트) → HULL → POWERPACK → TURRET
    welded: bool = False
    ng: Optional[bool] = None  # None: 아직 판정 전
    reason: Optional[str] = None
    skip: bool = False  # 로봇 ERR 이후 위치는 작업 생략
    run_no: Optional[int] = None
    started_at: Optional[datetime] = None
    result_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    times: dict = field(default_factory=lambda: {"ST1": 0.0, "ST2": 0.0, "ST3": 0.0})
    jobs: dict = field(default_factory=dict)  # 작업 코드 → BUSY/DONE/ERR (K1·K6 성공률 계산용)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "cv": self.cv,
            "stage": self.stage,
            "welded": self.welded,
            "ng": self.ng,
            "reason": self.reason,
            "skip": self.skip,
            "run_no": self.run_no,
        }

    def run_record(self) -> dict:
        return {
            "run_no": self.run_no,
            "started_at": _iso(self.started_at),
            "result_at": _iso(self.result_at),
            "finished_at": _iso(self.finished_at),
            "ng": self.ng,
            "reason": self.reason,
            "times": {k: round(v, 3) for k, v in self.times.items()},
            "jobs": dict(self.jobs),
        }


class Snapshot:
    def __init__(self) -> None:
        self.seq = 0
        self.updated_at: Optional[datetime] = None
        self.last_rx: Optional[datetime] = None  # 서버가 마지막으로 이벤트를 받은 시각
        self.line = "STOP"
        self.conveyors = {cv: "EMPTY" for cv in range(1, 6)}
        self.robots = {n: {"state": "READY", "job": None} for n in range(1, 4)}
        self.link = {"gateway": False, "plc": False, "robots": [False, False, False]}
        self.alarms_active: dict[tuple[str, str], dict] = {}
        self.alarm_history: list[dict] = []
        # TODO(미정): 제품 ID가 없어 팔레트는 컨베이어 순서(FIFO)로 추적한다. 구간당 팔레트 1개 가정
        self.pallets: list[Pallet] = []
        self.trays = {"pass": 0, "fail": 0}
        # 보관창고(CV5 끝, 서보가 3단 선반 전체를 상하 이동)에 있는 팔레트 수
        # TODO(미정): 선반 신호(벨트에 맞춘 칸·칸별 적재)가 없어 CV5 EMPTY 횟수로 추정. 화면은 아래 칸부터 채운다
        self.storage = 0
        self.last_run: Optional[Pallet] = None
        # 저장소(store.py)가 가져갈 변경분: 끝난 가동(분류 완료), 새로 생기거나 해제된 알람
        self.finished: list[Pallet] = []
        self.alarm_changes: list[dict] = []
        self._pallet_no = 0
        self._busy_since: dict[int, Optional[datetime]] = {1: None, 2: None, 3: None}

    # ---- 입력 ----

    def apply(self, ev: Event, now: datetime) -> None:
        self.last_rx = now
        # 이벤트가 왔다는 것 자체가 게이트웨이가 살아 있다는 뜻
        if not (isinstance(ev, LinkEvent) and ev.gateway is False):
            self._set_link("gateway", True, ev.ts)

        if isinstance(ev, LineEvent):
            self._on_line(ev)
        elif isinstance(ev, ConveyorEvent):
            self._on_conveyor(ev)
        elif isinstance(ev, RobotEvent):
            self._on_robot(ev)
        elif isinstance(ev, ResultEvent):
            self._on_result(ev)
        elif isinstance(ev, AlarmEvent):
            if ev.cleared:
                self._clear_alarm(ev.source, ev.code, ev.ts)
            else:
                self._raise_alarm(ev.source, ev.code, ev.msg, ev.ts)
        elif isinstance(ev, LinkEvent):
            self._on_link(ev)
        self._touch(now)

    def check_gateway(self, now: datetime, timeout_s: float) -> bool:
        """이벤트가 timeout_s 동안 없으면 게이트웨이 끊김으로 바꾼다. 바뀌었으면 True."""
        if not self.link["gateway"] or self.last_rx is None:
            return False
        if (now - self.last_rx).total_seconds() < timeout_s:
            return False
        self._set_link("gateway", False, now, msg=f"{timeout_s:g}초 동안 게이트웨이 이벤트 없음")
        self._touch(now)
        return True

    # ---- 이벤트별 처리 ----

    def _on_line(self, ev: LineEvent) -> None:
        self.line = ev.state
        if ev.state == "ESTOP":
            self._raise_alarm("line", "ESTOP", "비상정지", ev.ts)
        else:
            self._clear_alarm("line", "ESTOP", ev.ts)

    def _on_conveyor(self, ev: ConveyorEvent) -> None:
        cv = ev.cv
        self.conveyors[cv] = ev.state
        if ev.state in ("ARRIVING", "HOLD") and self._pallet_at(cv) is None:
            prev = self._pallet_at(cv - 1) if cv > 1 else None
            if prev is not None:
                prev.cv = cv
            else:
                # CV1 새 팔레트, 또는 중간 접속으로 이력을 모르는 팔레트
                self._pallet_no += 1
                self.pallets.append(Pallet(id=f"P{self._pallet_no}", cv=cv))
                if cv == 1 and self.storage > 0:
                    # TODO(미정): 보관창고에서 꺼내는 신호가 없어 CV1 새 팔레트는 창고에서 꺼낸 것으로 본다
                    self.storage -= 1
        elif ev.state == "EMPTY" and cv == 5:
            p = self._pallet_at(5)
            if p is not None:
                self.pallets.remove(p)  # 보관창고로 이동
                self.storage += 1

    def _on_robot(self, ev: RobotEvent) -> None:
        n = ev.robot
        r = self.robots[n]
        job = ev.job or r["job"]
        r["state"] = ev.state
        r["job"] = None if ev.state == "READY" else job
        pallet = self._pallet_at(config.ROBOT_CV[n])

        if ev.state == "BUSY":
            self._busy_since[n] = ev.ts
            if pallet is not None and n == 1 and pallet.started_at is None:
                pallet.started_at = ev.ts  # 가정: 가동 시작 = 로봇1이 처음 BUSY가 된 시각
            if pallet is not None and ev.job:
                pallet.jobs[ev.job] = "BUSY"
        elif ev.state == "DONE":
            since = self._busy_since[n]
            self._busy_since[n] = None
            self._clear_alarm(f"robot{n}", "ERR", ev.ts)
            if pallet is None:
                return
            if since is not None:
                pallet.times[f"ST{n}"] += (ev.ts - since).total_seconds()
            if job:
                pallet.jobs[job] = "DONE"
            if job in JOB_STAGE:
                pallet.stage = JOB_STAGE[job]
            elif job == "ROBOT2_WELD_MOTION":
                pallet.welded = True
            elif job == "ROBOT3_SORT":
                # TODO(미정): 판정 전에 SORT가 오면 불합격 트레이로 센다
                self.trays["pass" if pallet.ng is False else "fail"] += 1
                pallet.stage = None
                pallet.welded = False
                pallet.finished_at = ev.ts
                self.last_run = pallet
                self.finished.append(pallet)
        elif ev.state == "ERR":
            self._busy_since[n] = None
            self._raise_alarm(f"robot{n}", "ERR", f"로봇{n} 오류 ({job or '작업 코드 없음'})", ev.ts)
            if pallet is not None:
                pallet.ng = True
                pallet.skip = True
                pallet.jobs[job or "UNKNOWN"] = "ERR"
                pallet.reason = pallet.reason or f"ROBOT{n}_ERR"
        elif ev.state == "READY":
            self._busy_since[n] = None
            self._clear_alarm(f"robot{n}", "ERR", ev.ts)

    def _on_result(self, ev: ResultEvent) -> None:
        pallet = self._pallet_at(config.RESULT_CV)
        if pallet is None:
            # 팔레트 위치를 모르는 경우에도 판정 기록은 남긴다
            self._pallet_no += 1
            pallet = Pallet(id=f"P{self._pallet_no}", cv=config.RESULT_CV)
            self.pallets.append(pallet)
        pallet.run_no = ev.run_no
        pallet.ng = ev.ng
        pallet.reason = ev.reason if ev.ng else None
        if ev.ng and pallet.reason is None:
            pallet.reason = "UNKNOWN"
        pallet.result_at = ev.ts
        self.last_run = pallet

    def _on_link(self, ev: LinkEvent) -> None:
        if ev.gateway is not None:
            self._set_link("gateway", ev.gateway, ev.ts)
        if ev.plc is not None:
            self._set_link("plc", ev.plc, ev.ts)
        if ev.robots is not None:
            for i, ok in enumerate(ev.robots):
                self._set_link(i, ok, ev.ts)

    # ---- 보조 ----

    def _set_link(self, key, ok: bool, ts: datetime, msg: Optional[str] = None) -> None:
        """key: "gateway" | "plc" | 로봇 인덱스(0~2). 연결됨→끊김 전환에서만 알람을 올린다."""
        if isinstance(key, int):
            was, name = self.link["robots"][key], f"robot{key + 1}"
            self.link["robots"][key] = ok
        else:
            was, name = self.link[key], key
            self.link[key] = ok
        if was and not ok:
            self._raise_alarm(name, "LINK_LOST", msg or f"{name} 연결 끊김", ts)
        elif ok:
            self._clear_alarm(name, "LINK_LOST", ts)

    def _raise_alarm(self, source: str, code: str, msg: Optional[str], ts: datetime) -> None:
        key = (source, code)
        if key in self.alarms_active:
            return
        alarm = {"source": source, "code": code, "msg": msg, "raised_at": ts, "cleared_at": None}
        self.alarms_active[key] = alarm
        self.alarm_history.append(alarm)
        self.alarm_changes.append(alarm)
        del self.alarm_history[:-HISTORY_MAX]

    def _clear_alarm(self, source: str, code: str, ts: datetime) -> None:
        alarm = self.alarms_active.pop((source, code), None)
        if alarm is not None:
            alarm["cleared_at"] = ts
            self.alarm_changes.append(alarm)

    def _pallet_at(self, cv: int) -> Optional[Pallet]:
        return next((p for p in self.pallets if p.cv == cv), None)

    def _touch(self, now: datetime) -> None:
        self.seq += 1
        self.updated_at = now

    # ---- 출력 ----

    def to_dict(self) -> dict:
        def alarm_dict(a: dict) -> dict:
            return {**a, "raised_at": _iso(a["raised_at"]), "cleared_at": _iso(a["cleared_at"])}

        return {
            "seq": self.seq,
            "updated_at": _iso(self.updated_at),
            "line": {"state": self.line},
            "conveyors": [{"cv": cv, "state": s} for cv, s in self.conveyors.items()],
            "robots": [{"robot": n, **r} for n, r in self.robots.items()],
            "link": {**self.link, "robots": list(self.link["robots"])},
            "alarms_active": [alarm_dict(a) for a in self.alarms_active.values()],
            "alarm_history": [alarm_dict(a) for a in reversed(self.alarm_history[-HISTORY_SENT:])],
            "pallets": [p.to_dict() for p in self.pallets],
            "trays": dict(self.trays),
            "storage": {"count": self.storage, "capacity": config.STORAGE_SLOTS},
            "last_run": self.last_run.run_record() if self.last_run else None,
        }
