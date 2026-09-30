"""게이트웨이 끊김 감지: 가짜 시계로 실제 시간 흐름(하트비트·silence)을 재현한다."""
import asyncio
from datetime import datetime, timedelta

from mock import replay
from server import config
from server.main import LineServer

from conftest import T0

TICK = 0.25  # 서버 감시 주기와 같게


class FakeTime:
    """sleep()이 시계를 TICK씩 진행시키며 그때마다 서버 감시(check_link)를 돌린다."""

    def __init__(self) -> None:
        self.now = T0
        self.server = LineServer(clock=self.clock)

    def clock(self) -> datetime:
        return self.now

    async def sleep(self, seconds: float) -> None:
        end = self.now + timedelta(seconds=seconds)
        while self.now < end:
            self.now = min(end, self.now + timedelta(seconds=TICK))
            await self.server.check_link()


def play(name: str) -> FakeTime:
    ft = FakeTime()
    asyncio.run(replay.play(replay.load(name), ft.server.ingest, speed=1, sleep=ft.sleep, clock=ft.clock))
    return ft


def gateway_alarms(ft: FakeTime) -> list[dict]:
    return [a for a in ft.server.snapshot.alarm_history if a["source"] == "gateway"]


def test_silence_detected_within_3s_and_recovered():
    ft = play("link_lost")
    alarms = gateway_alarms(ft)
    assert len(alarms) == 1
    a = alarms[0]
    assert a["code"] == "LINK_LOST" and a["cleared_at"] is not None
    # silence 직전 마지막 이벤트 시각을 시나리오에서 계산: 감지까지 3초 이하 (PRD 성공 기준)
    tl = replay.timeline(replay.load("link_lost"))
    k = next(i for i, (_, ev, _) in enumerate(tl) if ev is None)
    last_before = tl[k - 1][0]  # 타임라인 순서상 silence 바로 앞 이벤트
    detect = (a["raised_at"] - (T0 + timedelta(milliseconds=last_before))).total_seconds()
    assert config.LINK_TIMEOUT_S <= detect <= 3.0
    assert ft.server.snapshot.link["gateway"] is True


def test_heartbeat_keeps_gateway_alive_during_long_steps():
    ft = play("normal")  # 로봇2 용접 6초 등 긴 대기가 있어도 하트비트 덕에 끊김 없음
    assert gateway_alarms(ft) == []
    assert ft.server.snapshot.trays == {"pass": 1, "fail": 0}
