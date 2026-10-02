"""FastAPI 앱: 이벤트 수집 → 스냅샷 갱신 → 브라우저 방송.

브라우저로 가는 메시지(웹 내부 규격, 게이트웨이 계약 아님):
    {"seq": int, "event": <부록 B 이벤트> | null, "snapshot": <Snapshot.to_dict()>}
event가 null이면 서버가 스스로 바꾼 상태(접속 직후 스냅샷, 게이트웨이 끊김 감지, 모의 재생 초기화)다.

실행 (monitoring-twin 폴더에서):
    uvicorn server.main:app --port 8000
    MT_SOURCE=mock MT_SCENARIO=normal uvicorn server.main:app --port 8000   # 모의 시나리오 재생
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Callable, Optional, Literal

from fastapi import FastAPI, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from mock import replay
from mock.player import Player

from . import config
from .schema import parse_event
from .snapshot import Snapshot
from .store import Store, period_range
from .ws import Hub

log = logging.getLogger(__name__)


class LineServer:
    """스냅샷과 방송을 묶는다. 이벤트는 모두 ingest()로 들어온다.

    TODO(미정): 게이트웨이를 같은 프로세스로 둘지. 지금은 같은 이벤트 루프에서 ingest()를 await 한다.
    """

    def __init__(self, clock: Callable[[], datetime] = config.local_now, store: Optional[Store] = None) -> None:
        self.clock = clock
        self.store = store or Store()
        self.snapshot = Snapshot()
        self.hub = Hub()
        self._lock = asyncio.Lock()  # 적용·방송 순서를 seq 순서로 고정
        self._mock_task: Optional[asyncio.Task] = None
        self.player: Optional[Player] = None
        self._play_lock = asyncio.Lock()
        self._generation = 0
        self._paused_at = None

    def message(self, event: Optional[dict]) -> str:
        return json.dumps(
            {"seq": self.snapshot.seq, "event": event, "snapshot": self.snapshot.to_dict(),
             "playback": self.player.metadata() if self.player else None},
            ensure_ascii=False,
        )

    async def ingest(self, raw: dict | str | bytes) -> bool:
        """규격에 맞으면 적용하고 방송한다. 맞지 않으면 로그를 남기고 버린다."""
        try:
            ev = parse_event(raw)
        except ValidationError as e:
            log.warning("rejected event %r: %s", raw, e.errors(include_url=False))
            return False
        async with self._lock:
            now = self.clock()
            self.snapshot.apply(ev, now)
            event = ev.model_dump(mode="json", exclude_none=True)
            self.store.record(self.snapshot, event, now)
            await self.hub.broadcast(self.message(event))
        return True

    async def check_link(self) -> None:
        async with self._lock:
            if self.player and self.player.state == "PAUSED":
                return
            now = self.clock()
            if self.snapshot.check_gateway(now, config.LINK_TIMEOUT_S):
                self.store.record(self.snapshot, None, now)
                await self.hub.broadcast(self.message(None))

    async def watch_link(self, interval_s: float = 0.25) -> None:
        while True:
            await asyncio.sleep(interval_s)
            await self.check_link()

    async def join(self, ws: WebSocket) -> None:
        async with self._lock:
            self.hub.clients.add(ws)
            await self.hub.send(ws, self.message(None))

    # ---- 모의 재생 (MT_SOURCE=mock 전용) ----

    async def reset(self) -> None:
        """상태를 처음으로 되돌린다. 브라우저가 순서를 판단하도록 seq는 이어서 올린다."""
        async with self._lock:
            seq = self.snapshot.seq
            self.snapshot = Snapshot()
            self.snapshot.seq = seq + 1
            self.snapshot.updated_at = self.clock()
            await self.hub.broadcast(self.message(None))

    async def play(self, name: str, speed: float, reset: bool = True, loop: bool = False) -> None:
        """재생 중인 시나리오를 멈추고 새로 재생한다 (백그라운드)."""
        def prepare():
            scenario = replay.load(name)
            run_no = self.store.next_run_no()
            for step in scenario["steps"]:
                if step.get("event", {}).get("type") == "result":
                    step["event"]["run_no"] = run_no
                    run_no += 1
            return scenario

        async def restart():
            await self.reset()
            return prepare()

        async with self._play_lock:
            scenario = prepare()
            self.stop_mock()
            if self._mock_task:
                try:
                    await self._mock_task
                except asyncio.CancelledError:
                    pass
            self._generation = max(self._generation, self.player.generation if self.player else 0) + 1
            self.player = Player(name, speed, loop, self._generation, self.ingest, restart)
            self._paused_at = None
            if reset:
                await self.reset()
            self._mock_task = asyncio.create_task(self.player.run(scenario))

    async def control_mock(self, action, speed=None, loop=None):
        async with self._play_lock:
            player = self.player
            if player is None:
                raise HTTPException(409, "no demo playback")
            if action == "pause" and player.state == "PLAYING":
                self._paused_at = self.clock()
                player.state = "PAUSED"
            elif action == "resume" and player.state == "PAUSED":
                if self._paused_at:
                    pause_duration = self.clock() - self._paused_at
                    # Demo transport pause is not robot processing time. Keep wall-clock run timestamps.
                    for robot, started in self.snapshot._busy_since.items():
                        if started is not None:
                            self.snapshot._busy_since[robot] = started + pause_duration
                if self.snapshot.last_rx and self._paused_at and self.snapshot.last_rx <= self._paused_at:
                    # Exclude deliberate pause time from the watchdog without reviving a lost link.
                    self.snapshot.last_rx += self.clock() - self._paused_at
                player.state = "PLAYING"
                self._paused_at = None
            if speed is not None:
                player.speed = speed
            if loop is not None:
                player.loop = loop
            async with self._lock:
                await self.hub.broadcast(self.message(None))
            return player.metadata()

    def stop_mock(self) -> None:
        if self._mock_task and not self._mock_task.done():
            self._mock_task.cancel()


class MockPlay(BaseModel):
    scenario: str
    speed: float = Field(default=1.0, gt=0, le=50)
    reset: bool = True
    loop: bool = False


class MockControl(BaseModel):
    action: Literal["pause", "resume", "configure"]
    speed: Optional[float] = Field(default=None, gt=0, le=50)
    loop: Optional[bool] = None


EXPORT_ITEMS = ("runs", "alarms", "kpi", "events")
Period = Query("today", pattern="^(today|week|all)$")


def create_app(source: str = config.SOURCE, db_path=config.DB_PATH) -> FastAPI:
    server = LineServer(store=Store(db_path))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        watcher = asyncio.create_task(server.watch_link())
        if source == "mock":
            await server.play(config.SCENARIO, config.SPEED, reset=False)
        yield
        server.stop_mock()
        watcher.cancel()

    app = FastAPI(title="monitoring-twin", lifespan=lifespan)
    app.state.server = server

    @app.get("/api/snapshot")
    def get_snapshot() -> dict:
        return server.snapshot.to_dict()

    # ---- 기록·통계·내보내기 (W0-5·6·7) ----

    def rng(period: str) -> tuple[float, float]:
        return period_range(period, server.clock())

    @app.get("/api/stats")
    def get_stats(period: str = Period) -> dict:
        return server.store.stats(*rng(period))

    @app.get("/api/runs")
    def get_runs(period: str = Period, verdict: str = Query("all", pattern="^(all|ok|ng)$"),
                 limit: int = Query(200, ge=1, le=5000)) -> list[dict]:
        return server.store.runs(*rng(period), verdict=verdict, limit=limit)

    @app.get("/api/alarms")
    def get_alarms(period: str = Period, limit: int = Query(500, ge=1, le=5000)) -> list[dict]:
        return server.store.alarms(*rng(period), limit=limit)

    @app.get("/api/export/preview")
    def export_preview(period: str = Period) -> dict:
        return server.store.counts(*rng(period))

    @app.get("/api/export")
    def export(period: str = Period, items: str = "runs,alarms") -> Response:
        chosen = [i for i in items.split(",") if i]
        if not chosen or any(i not in EXPORT_ITEMS for i in chosen):
            raise HTTPException(400, f"items must be a subset of {EXPORT_ITEMS}")
        tag = {"today": server.clock().strftime("%Y-%m-%d"), "week": "7days", "all": "all"}[period]
        name, data, mime = server.store.export(chosen, *rng(period), tag)
        return Response(data, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{name}"'})

    if source == "mock":
        # 개발·시연 전용. PLC·로봇에 쓰지 않으므로 P0 읽기 전용 원칙과 무관하다

        @app.get("/api/mock/scenarios")
        def list_scenarios() -> list[str]:
            return replay.scenario_names()

        @app.post("/api/mock/play")
        async def play_scenario(req: MockPlay) -> dict:
            if req.scenario not in replay.scenario_names():
                raise HTTPException(404, f"unknown scenario: {req.scenario}")
            await server.play(req.scenario, req.speed, req.reset, req.loop)
            return {"playing": req.scenario, "speed": req.speed}

        @app.get("/api/mock/status")
        def mock_status() -> dict:
            return server.player.metadata() if server.player else {}

        @app.post("/api/mock/control")
        async def mock_control(req: MockControl) -> dict:
            return await server.control_mock(req.action, req.speed, req.loop)

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        await ws.accept()
        await server.join(ws)
        try:
            while True:
                await ws.receive_text()  # 브라우저는 보내지 않는다. 끊김 감지용
        except WebSocketDisconnect:
            pass
        finally:
            server.hub.clients.discard(ws)

    app.mount("/assets", StaticFiles(directory=config.ASSETS_DIR, check_dir=False), name="assets")
    app.mount("/models", StaticFiles(directory=config.MODELS_DIR, check_dir=False), name="models")
    app.mount("/", StaticFiles(directory=config.CLIENT_DIR, html=True, check_dir=False), name="client")
    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
