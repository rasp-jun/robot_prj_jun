import asyncio
import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from mock.player import Player
from server.main import create_app, LineServer
from server.store import Store
from conftest import T0


class FakeClock:
    def __init__(self):
        self.t = 0.0
        self.hook = None

    def now(self):
        return self.t

    async def sleep(self, dt):
        self.t += dt
        if self.hook:
            self.hook()
        await asyncio.sleep(0)


def make_player(speed=1):
    ft = FakeClock()
    events = []
    async def sink(ev):
        events.append((ft.t, ev))
    async def restart():
        return {"steps": []}
    p = Player("test", speed, False, 1, sink, restart, clock=ft.now, sleep=ft.sleep)
    p.duration = 20
    return p, ft, events


def test_pause_freezes_clock_but_keeps_heartbeat():
    async def run():
        p, ft, events = make_player()
        p.state = "PAUSED"
        def resume():
            if ft.t >= 1.1:
                assert p.elapsed == 0
                p.state = "PLAYING"
                ft.hook = None
        ft.hook = resume
        await p.wait(1)
        assert p.elapsed == pytest.approx(1)
        assert ft.t > 2
        assert len(events) >= 2
    asyncio.run(run())


def test_speed_change_keeps_position_in_timeline():
    async def run():
        p, ft, _ = make_player()
        def accelerate():
            if ft.t >= .5:
                p.speed = 4
                ft.hook = None
        ft.hook = accelerate
        await p.wait(2)
        assert p.elapsed == pytest.approx(2)
        assert .8 < ft.t < 1
    asyncio.run(run())


def test_silence_uses_wall_time_and_emits_no_heartbeat():
    async def run():
        p, ft, events = make_player(speed=10)
        await p.wait(4, scaled=False, silent=True)
        assert ft.t == pytest.approx(4)
        assert events == []
    asyncio.run(run())


def test_job_hint_matches_next_robot_event():
    steps = [
        {"event":{"type":"robot","robot":1,"state":"BUSY"}},
        {"after_ms":500,"event":{"type":"conveyor","cv":1}},
        {"after_ms":1500,"event":{"type":"robot","robot":1,"state":"DONE"}},
    ]
    assert Player.span(steps,0,lambda x:x.get("type")=="robot",4)==2


def test_http_pause_resume_configuration_and_completed_state():
    app=create_app(source="mock",db_path=":memory:")
    with TestClient(app) as c:
        c.post("/api/mock/play",json={"scenario":"normal","speed":1})
        paused=c.post("/api/mock/control",json={"action":"pause"}).json()
        assert paused["state"]=="PAUSED"
        time.sleep(.12)
        assert c.get("/api/mock/status").json()["elapsed_s"]==paused["elapsed_s"]
        assert c.post("/api/mock/control",json={"action":"configure","speed":0}).status_code==422
        assert c.post("/api/mock/control",json={"action":"configure","speed":50}).json()["speed"]==50
        assert c.post("/api/mock/control",json={"action":"resume"}).json()["state"]=="PLAYING"
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            status=c.get("/api/mock/status").json()
            if status["state"]=="COMPLETED":
                break
            time.sleep(.02)
        assert status["state"]=="COMPLETED"
        assert status["elapsed_s"]==status["duration_s"]
        assert c.get("/api/snapshot").json()["trays"]["pass"]==1


def test_loop_generations_and_run_numbers_are_unique():
    app=create_app(source="mock",db_path=":memory:")
    with TestClient(app) as c:
        c.post("/api/mock/play",json={"scenario":"normal","speed":50,"loop":True})
        first=c.get("/api/mock/status").json()["generation"]
        deadline=time.monotonic()+7
        while time.monotonic()<deadline:
            runs=c.get("/api/runs?period=all").json()
            if len(runs)>=2:
                break
            time.sleep(.03)
        assert len(runs)>=2
        assert len({r["run_no"] for r in runs})==len(runs)
        assert c.get("/api/mock/status").json()["generation"]>first
        c.post("/api/mock/control",json={"action":"configure","loop":False})
        replacement=c.post("/api/mock/play",json={"scenario":"estop","speed":1})
        assert replacement.status_code==200
        assert c.get("/api/mock/status").json()["scenario"]=="estop"


def test_mock_controls_not_available_on_real_monitor():
    with TestClient(create_app(source="none",db_path=":memory:")) as c:
        assert c.get("/api/mock/status").status_code==404
        assert c.post("/api/mock/control",json={"action":"pause"}).status_code in (404,405)


def test_resume_watchdog_timestamp_never_moves_into_future():
    async def run():
        now=[T0]
        server=LineServer(clock=lambda:now[0],store=Store(":memory:"))
        p,_,_=make_player()
        server.player=p
        server.snapshot.last_rx=T0
        await server.control_mock("pause")
        now[0]+=timedelta(seconds=10)
        server.snapshot.last_rx=now[0]-timedelta(seconds=.1)  # paused heartbeat
        await server.control_mock("resume")
        assert server.snapshot.last_rx<=now[0]
        # During simulated silence no heartbeat arrives; intentional pause doesn't eat the timeout.
        server.snapshot.last_rx=now[0]-timedelta(seconds=.7)
        await server.control_mock("pause")
        now[0]+=timedelta(seconds=5)
        await server.control_mock("resume")
        assert (now[0]-server.snapshot.last_rx).total_seconds()==pytest.approx(.7)
    asyncio.run(run())

def test_transport_pause_does_not_inflate_robot_processing_time():
    async def run():
        now=[T0]
        server=LineServer(clock=lambda:now[0],store=Store(":memory:"))
        p,_,_=make_player()
        server.player=p
        async def event(type_,**fields):
            await server.ingest({"type":type_,"ts":now[0].isoformat(),**fields})
        await event("conveyor",cv=1,state="HOLD")
        await event("robot",robot=1,state="BUSY",job="ROBOT1_HULL_PLACE")
        now[0]+=timedelta(seconds=1)
        await server.control_mock("pause")
        now[0]+=timedelta(seconds=10)
        await server.control_mock("resume")
        now[0]+=timedelta(seconds=1)
        await event("robot",robot=1,state="DONE",job="ROBOT1_HULL_PLACE")
        assert server.snapshot.pallets[0].times["ST1"]==2
    asyncio.run(run())
