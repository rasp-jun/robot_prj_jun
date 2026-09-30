from datetime import datetime, timedelta, timezone

import pytest

from server.schema import parse_event
from server.snapshot import Snapshot

T0 = datetime(2026, 9, 30, 9, 0, 0, tzinfo=timezone(timedelta(hours=9)))


class Feeder:
    """이벤트를 1초 간격 ts로 스냅샷에 넣는 도우미."""

    def __init__(self) -> None:
        self.snap = Snapshot()
        self.t = T0

    def __call__(self, type_: str, dt: float = 1.0, **fields) -> Snapshot:
        self.t += timedelta(seconds=dt)
        ev = parse_event({"type": type_, "ts": self.t.isoformat(), **fields})
        self.snap.apply(ev, self.t)
        return self.snap


@pytest.fixture
def feed() -> Feeder:
    return Feeder()
