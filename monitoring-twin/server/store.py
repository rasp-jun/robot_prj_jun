"""SQLite 저장소 (W0-5 알람 이력, W0-6 가동 기록, W0-7 KPI). 표준 라이브러리 sqlite3만 쓴다.

- runs: 분류(ROBOT3_SORT)가 끝난 가동 1건 = 1행
- alarms: 발생 시 추가, 해제 시 cleared_at 갱신 (source, code, raised_at으로 식별)
- events: 게이트웨이 이벤트 원본 (하트비트 제외). K3 반영 지연 = 서버 수신 시각 - 게이트웨이 ts
"""
import csv
import io
import json
import sqlite3
import statistics
import zipfile
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable, Optional

from .snapshot import Pallet, Snapshot

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  run_no INTEGER, pallet TEXT,
  started_at TEXT, result_at TEXT, finished_at TEXT, finished_epoch REAL NOT NULL,
  ng INTEGER, reason TEXT,
  st1 REAL, st2 REAL, st3 REAL,
  jobs TEXT
);
CREATE INDEX IF NOT EXISTS runs_finished ON runs(finished_epoch);
CREATE TABLE IF NOT EXISTS alarms (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL, code TEXT NOT NULL, msg TEXT,
  raised_at TEXT NOT NULL, raised_epoch REAL NOT NULL, cleared_at TEXT,
  UNIQUE(source, code, raised_at)
);
CREATE INDEX IF NOT EXISTS alarms_raised ON alarms(raised_epoch);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  rx_epoch REAL NOT NULL, ts_epoch REAL NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_rx ON events(rx_epoch);
"""

KPI_JOBS = {"k1_robot1": "ROBOT1_POWERPACK_MOUNT", "k1_robot2": "ROBOT2_TURRET_MATE", "k6_weld": "ROBOT2_WELD_MOTION"}


def period_range(period: str, now: datetime) -> tuple[float, float]:
    """today: 오늘 0시부터, week: 오늘 포함 7일, all: 전체. 반환은 epoch 초 [since, until]."""
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    since = {"today": midnight, "week": midnight - timedelta(days=6)}.get(period)
    return (since.timestamp() if since else 0.0, now.timestamp())


class Store:
    def __init__(self, path: str | Path = ":memory:") -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    # ---- 쓰기 ----

    def record(self, snap: Snapshot, event: Optional[dict], rx: datetime) -> None:
        """스냅샷에 쌓인 변경분(끝난 가동·알람)과 이벤트 원본을 저장한다. ingest마다 호출."""
        with self.db:
            if event and not (event["type"] == "link" and len(event) == 2):  # 하트비트({"type","ts"})는 저장하지 않음
                ts = datetime.fromisoformat(event["ts"]).timestamp()
                self.db.execute("INSERT INTO events(rx_epoch, ts_epoch, type, body) VALUES (?,?,?,?)",
                                (rx.timestamp(), ts, event["type"], json.dumps(event, ensure_ascii=False)))
            for p in snap.finished:
                self._add_run(p)
            for a in snap.alarm_changes:
                self._upsert_alarm(a)
        snap.finished.clear()
        snap.alarm_changes.clear()

    def _add_run(self, p: Pallet) -> None:
        r = p.run_record()
        self.db.execute(
            "INSERT INTO runs(run_no, pallet, started_at, result_at, finished_at, finished_epoch, ng, reason, st1, st2, st3, jobs)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (r["run_no"], p.id, r["started_at"], r["result_at"], r["finished_at"], p.finished_at.timestamp(),
             # TODO(미정): 판정 전에 분류가 끝나면(ng=None) 불합격으로 본다 (snapshot.py 트레이 규칙과 같음)
             0 if p.ng is False else 1, r["reason"],
             r["times"]["ST1"], r["times"]["ST2"], r["times"]["ST3"], json.dumps(r["jobs"])),
        )

    def _upsert_alarm(self, a: dict) -> None:
        self.db.execute(
            "INSERT INTO alarms(source, code, msg, raised_at, raised_epoch, cleared_at) VALUES (?,?,?,?,?,?)"
            " ON CONFLICT(source, code, raised_at) DO UPDATE SET cleared_at = excluded.cleared_at",
            (a["source"], a["code"], a["msg"], a["raised_at"].isoformat(), a["raised_at"].timestamp(),
             a["cleared_at"].isoformat() if a["cleared_at"] else None),
        )

    # ---- 읽기 ----

    def runs(self, since: float, until: float, verdict: str = "all", limit: Optional[int] = None) -> list[dict]:
        q = "SELECT * FROM runs WHERE finished_epoch BETWEEN ? AND ?"
        if verdict in ("ok", "ng"):
            q += f" AND ng = {1 if verdict == 'ng' else 0}"
        q += " ORDER BY finished_epoch DESC" + (f" LIMIT {int(limit)}" if limit else "")
        return [self._run_dict(r) for r in self.db.execute(q, (since, until))]

    @staticmethod
    def _run_dict(r: sqlite3.Row) -> dict:
        return {
            "run_no": r["run_no"], "pallet": r["pallet"],
            "started_at": r["started_at"], "result_at": r["result_at"], "finished_at": r["finished_at"],
            "ng": bool(r["ng"]), "reason": r["reason"],
            "times": {"ST1": r["st1"], "ST2": r["st2"], "ST3": r["st3"]},
            "jobs": json.loads(r["jobs"] or "{}"),
        }

    def alarms(self, since: float, until: float, limit: Optional[int] = None) -> list[dict]:
        q = "SELECT source, code, msg, raised_at, cleared_at FROM alarms WHERE raised_epoch BETWEEN ? AND ? ORDER BY raised_epoch DESC"
        q += f" LIMIT {int(limit)}" if limit else ""
        return [dict(r) for r in self.db.execute(q, (since, until))]

    def events(self, since: float, until: float) -> list[sqlite3.Row]:
        return list(self.db.execute("SELECT * FROM events WHERE rx_epoch BETWEEN ? AND ? ORDER BY rx_epoch", (since, until)))

    def next_run_no(self) -> int:
        return (self.db.execute("SELECT MAX(run_no) FROM runs").fetchone()[0] or 0) + 1

    def counts(self, since: float, until: float) -> dict:
        one = lambda q: self.db.execute(q, (since, until)).fetchone()[0]
        return {
            "runs": one("SELECT COUNT(*) FROM runs WHERE finished_epoch BETWEEN ? AND ?"),
            "alarms": one("SELECT COUNT(*) FROM alarms WHERE raised_epoch BETWEEN ? AND ?"),
            "events": one("SELECT COUNT(*) FROM events WHERE rx_epoch BETWEEN ? AND ?"),
        }

    def stats(self, since: float, until: float) -> dict:
        """스코어카드 수치. 목표 대비 판단(달성/근접/미달)은 화면에서 한다."""
        runs = self.runs(since, until)
        total = len(runs)
        fail = sum(r["ng"] for r in runs)
        produced = total - fail

        # 생산 속도: 하루 안이면 첫 가동 시작부터 마지막 완료까지 시간당, 여러 날이면 가동일 평균
        days = {r["finished_at"][:10] for r in runs}
        speed, speed_unit = None, "대/h"
        if len(days) > 1:
            speed, speed_unit = produced / len(days), "대/일"
        elif runs:
            first = min(r["started_at"] or r["finished_at"] for r in runs)
            hours = (datetime.fromisoformat(runs[0]["finished_at"]) - datetime.fromisoformat(first)).total_seconds() / 3600
            speed = produced / hours if hours > 0 else None

        def rate(job: str) -> dict:
            states = [r["jobs"][job] for r in runs if job in r["jobs"]]
            done = states.count("DONE")
            return {"value": done / len(states) * 100 if states else None, "done": done, "tried": len(states)}

        # K5: 작업을 한 가동만 평균 (생략된 0초는 빼고)
        avg = {}
        for st in ("ST1", "ST2", "ST3"):
            xs = [r["times"][st] for r in runs if r["times"][st] > 0]
            avg[st] = statistics.fmean(xs) if xs else None
        worked = {k: v for k, v in avg.items() if v is not None}

        lat = sorted(e["rx_epoch"] - e["ts_epoch"] for e in self.events(since, until))
        p95 = lat[min(len(lat) - 1, int(len(lat) * 0.95))] if lat else None

        return {
            "runs": total, "produced": produced, "fail": fail,
            "defect_rate": fail / total * 100 if total else None,
            "speed": speed, "speed_unit": speed_unit, "days": len(days),
            **{k: rate(job) for k, job in KPI_JOBS.items()},
            "k3_p95_s": p95, "k3_samples": len(lat),
            "station_avg_s": avg, "bottleneck": max(worked, key=worked.get) if worked else None,
            "reasons": Counter(r["reason"] or "UNKNOWN" for r in runs if r["ng"]).most_common(),
        }

    # ---- 내보내기 (CSV, UTF-8 BOM: Excel에서 한글이 깨지지 않게) ----

    def export(self, items: Iterable[str], since: float, until: float, tag: str) -> tuple[str, bytes, str]:
        """(파일 이름, 내용, MIME). 항목이 하나면 CSV, 여러 개면 zip."""
        files = {f"monitoring_{tag}_{item}.csv": self._csv(item, since, until) for item in items}
        if len(files) == 1:
            (name, data), = files.items()
            return name, data, "text/csv; charset=utf-8"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for name, data in files.items():
                z.writestr(name, data)
        return f"monitoring_{tag}.zip", buf.getvalue(), "application/zip"

    def _csv(self, item: str, since: float, until: float) -> bytes:
        out = io.StringIO()
        w = csv.writer(out)
        if item == "runs":
            w.writerow(["run_no", "pallet", "started_at", "result_at", "finished_at", "verdict", "reason", "st1_s", "st2_s", "st3_s", "jobs"])
            for r in reversed(self.runs(since, until)):
                w.writerow([r["run_no"], r["pallet"], r["started_at"], r["result_at"], r["finished_at"], "NG" if r["ng"] else "OK",
                            r["reason"] or "", r["times"]["ST1"], r["times"]["ST2"], r["times"]["ST3"], json.dumps(r["jobs"])])
        elif item == "alarms":
            w.writerow(["raised_at", "cleared_at", "duration_s", "source", "code", "msg"])
            for a in reversed(self.alarms(since, until)):
                dur = ((datetime.fromisoformat(a["cleared_at"]) - datetime.fromisoformat(a["raised_at"])).total_seconds()
                       if a["cleared_at"] else "")
                w.writerow([a["raised_at"], a["cleared_at"] or "", dur, a["source"], a["code"], a["msg"] or ""])
        elif item == "kpi":
            s = self.stats(since, until)
            w.writerow(["runs", "produced", "fail", "defect_rate_pct", "k1_robot1_pct", "k1_robot2_pct", "k6_weld_pct",
                        "k3_p95_s", "st1_avg_s", "st2_avg_s", "st3_avg_s", "bottleneck"])
            w.writerow([s["runs"], s["produced"], s["fail"], s["defect_rate"], s["k1_robot1"]["value"], s["k1_robot2"]["value"],
                        s["k6_weld"]["value"], s["k3_p95_s"], *s["station_avg_s"].values(), s["bottleneck"]])
        elif item == "events":
            w.writerow(["rx_epoch", "ts_epoch", "type", "json"])
            for e in self.events(since, until):
                w.writerow([e["rx_epoch"], e["ts_epoch"], e["type"], e["body"]])
        else:
            raise ValueError(item)
        return ("﻿" + out.getvalue()).encode("utf-8")
