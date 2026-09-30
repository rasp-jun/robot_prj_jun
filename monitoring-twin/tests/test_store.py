"""SQLite 저장·통계·내보내기 (W0-5·6·7). 모의 시나리오를 가상 시각으로 재생해 저장한다."""
import asyncio
import csv
import io
import random
import zipfile
from datetime import timedelta

from fastapi.testclient import TestClient

from conftest import T0
from mock import replay
from mock.seed import seed
from server.main import create_app
from server.schema import parse_event
from server.snapshot import Snapshot
from server.store import Store, period_range

LATENCY = 0.2  # 이벤트 반영 지연 (초)


def play_into(store: Store, names: list[str]) -> None:
    snap = Snapshot()

    async def sink(raw: dict) -> None:
        ev = parse_event(raw)
        rx = ev.ts + timedelta(seconds=LATENCY)
        snap.apply(ev, rx)
        store.record(snap, ev.model_dump(mode="json", exclude_none=True), rx)

    async def run() -> None:
        for k, name in enumerate(names):
            start = T0 + timedelta(minutes=5 * k)
            await replay.play(replay.load(name), sink, speed=0, clock=lambda: start)

    asyncio.run(run())


ALL = (0.0, (T0 + timedelta(days=1)).timestamp())


def test_runs_alarms_events_saved():
    store = Store()
    play_into(store, ["normal", "robot1_err"])
    runs = store.runs(*ALL)
    assert [(r["ng"], r["reason"]) for r in runs] == [(True, "ROBOT1_ERR"), (False, None)]  # 최신이 먼저
    ok = runs[1]
    assert ok["times"] == {"ST1": 7.0, "ST2": 11.0, "ST3": 4.0}
    assert ok["jobs"] == {"ROBOT1_HULL_PLACE": "DONE", "ROBOT1_POWERPACK_MOUNT": "DONE",
                          "ROBOT2_TURRET_MATE": "DONE", "ROBOT2_WELD_MOTION": "DONE", "ROBOT3_SORT": "DONE"}
    assert runs[0]["jobs"]["ROBOT1_POWERPACK_MOUNT"] == "ERR"
    alarms = store.alarms(*ALL)
    assert [(a["source"], a["code"]) for a in alarms] == [("robot1", "ERR")]
    assert alarms[0]["cleared_at"] is not None  # 해제 시각이 같은 행에 갱신됨
    counts = store.counts(*ALL)
    assert counts["runs"] == 2 and counts["alarms"] == 1
    assert counts["events"] == 38 + 32  # 하트비트는 저장하지 않음 (시나리오 이벤트 수와 같음)


def test_history_survives_restart(tmp_path):
    db = tmp_path / "m.db"
    play_into(Store(db), ["robot1_err"])
    again = Store(db)  # 서버 재시작
    assert len(again.runs(*ALL)) == 1 and len(again.alarms(*ALL)) == 1


def test_stats_kpi():
    store = Store()
    play_into(store, ["normal", "normal", "robot1_err"])
    s = store.stats(*ALL)
    assert (s["runs"], s["produced"], s["fail"]) == (3, 2, 1)
    assert round(s["defect_rate"], 1) == 33.3
    assert s["k1_robot1"] == {"value": 2 / 3 * 100, "done": 2, "tried": 3}
    assert s["k1_robot2"]["tried"] == 2 and s["k6_weld"]["value"] == 100.0  # 로봇1 오류 가동은 ST2 작업 생략
    assert round(s["k3_p95_s"], 3) == LATENCY
    assert s["station_avg_s"]["ST2"] == 11.0 and s["bottleneck"] == "ST2"
    assert s["reasons"] == [("ROBOT1_ERR", 1)]
    assert s["speed_unit"] == "대/h" and s["speed"] > 0


def test_period_range():
    since, until = period_range("today", T0)
    assert until - since == 9 * 3600  # T0 = 09:00
    assert period_range("week", T0)[0] == since - 6 * 86400
    assert period_range("all", T0)[0] == 0.0


def test_export_csv_and_zip():
    store = Store()
    play_into(store, ["normal", "robot1_err"])
    name, data, mime = store.export(["runs"], *ALL, "t")
    assert name == "monitoring_t_runs.csv" and mime.startswith("text/csv")
    assert data.startswith("﻿".encode())  # Excel용 BOM
    rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    assert rows[0][:6] == ["run_no", "pallet", "started_at", "result_at", "finished_at", "verdict"]
    assert [r[5] for r in rows[1:]] == ["OK", "NG"]  # 오래된 것부터
    name, data, mime = store.export(["runs", "alarms", "kpi", "events"], *ALL, "t")
    assert name == "monitoring_t.zip"
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert sorted(z.namelist()) == sorted(f"monitoring_t_{i}.csv" for i in ("runs", "alarms", "kpi", "events"))


def test_seed_fills_workdays():
    store = Store()
    now = T0.replace(hour=12)  # 2026-09-30 수요일 12:00
    n = asyncio.run(seed(store, days=3, per_day=10, now=now, rnd=random.Random(1)))
    runs = store.runs(0.0, now.timestamp())
    assert n == len(runs) == 30
    assert {r["finished_at"][:10] for r in runs} == {"2026-09-28", "2026-09-29", "2026-09-30"}
    assert sorted(r["run_no"] for r in runs) == list(range(1, 31))


def test_api_stats_runs_export():
    app = create_app(source="none", db_path=":memory:")
    with TestClient(app) as c:
        play_into(app.state.server.store, ["normal", "robot1_err"])
        # 저장 시각이 T0(2026-09-30)라 'all'로 조회
        s = c.get("/api/stats", params={"period": "all"}).json()
        assert (s["runs"], s["fail"]) == (2, 1)
        assert [r["ng"] for r in c.get("/api/runs", params={"period": "all", "verdict": "ng"}).json()] == [True]
        assert len(c.get("/api/alarms", params={"period": "all"}).json()) == 1
        assert c.get("/api/export/preview", params={"period": "all"}).json()["runs"] == 2
        r = c.get("/api/export", params={"period": "all", "items": "runs,alarms"})
        assert r.headers["content-type"] == "application/zip"
        assert 'filename="monitoring_all.zip"' in r.headers["content-disposition"]
        assert c.get("/api/export", params={"items": "passwords"}).status_code == 400
        assert c.get("/api/stats", params={"period": "year"}).status_code == 422
