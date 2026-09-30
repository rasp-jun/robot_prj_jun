import pytest
from pydantic import ValidationError

from server.schema import (
    AlarmEvent,
    ConveyorEvent,
    LineEvent,
    LinkEvent,
    ResultEvent,
    RobotEvent,
    parse_event,
)

TS = "2026-09-30T09:00:00+09:00"

# 부록 B 예시 그대로 + 공통 필드 ts
APPENDIX_B = [
    ({"type": "line", "state": "RUN"}, LineEvent),
    ({"type": "conveyor", "cv": 2, "state": "HOLD"}, ConveyorEvent),
    ({"type": "robot", "robot": 1, "state": "BUSY", "job": "ROBOT1_POWERPACK_MOUNT"}, RobotEvent),
    ({"type": "result", "run_no": 12, "ng": True, "reason": "TURRET_MISSING"}, ResultEvent),
    ({"type": "alarm", "source": "robot2", "code": "ERR", "cleared": False}, AlarmEvent),
    ({"type": "link", "plc": True, "robots": [True, True, False]}, LinkEvent),
]


@pytest.mark.parametrize("raw,cls", APPENDIX_B)
def test_appendix_b_examples_parse(raw, cls):
    ev = parse_event({**raw, "ts": TS})
    assert isinstance(ev, cls)
    assert ev.model_dump(mode="json", exclude_none=True) == {**raw, "ts": TS} | (
        {"cleared": False} if cls is AlarmEvent else {}
    )


def test_parse_json_string():
    ev = parse_event('{"type":"line","state":"ESTOP","ts":"%s"}' % TS)
    assert ev.state == "ESTOP"


def test_link_partial_fields_default_to_none():
    ev = parse_event({"type": "link", "ts": TS, "plc": False})
    assert ev.gateway is None and ev.robots is None


@pytest.mark.parametrize(
    "raw",
    [
        {"type": "unknown", "state": "RUN"},  # 알 수 없는 type
        {"state": "RUN"},  # type 없음
        {"type": "conveyor", "cv": 6, "state": "HOLD"},  # 범위 밖 cv
        {"type": "conveyor", "cv": 0, "state": "HOLD"},
        {"type": "robot", "robot": 4, "state": "BUSY"},  # 범위 밖 로봇
        {"type": "line", "state": "run"},  # 소문자 상태
        {"type": "line", "state": "IDLE"},  # 없는 상태
        {"type": "robot", "robot": 1, "state": "BUSY", "job": "ROBOT1_UNKNOWN"},  # 없는 작업 코드
        {"type": "result", "run_no": 1},  # ng 누락
        {"type": "alarm", "code": "ERR"},  # source 누락
        {"type": "link", "robots": [True, True]},  # 로봇 3대가 아님
        {"type": "line", "state": "RUN", "extra": 1},  # 추가 키
    ],
)
def test_invalid_events_rejected(raw):
    with pytest.raises(ValidationError):
        parse_event({**raw, "ts": TS})


def test_missing_or_naive_ts_rejected():
    with pytest.raises(ValidationError):
        parse_event({"type": "line", "state": "RUN"})
    with pytest.raises(ValidationError):
        parse_event({"type": "line", "state": "RUN", "ts": "2026-09-30T09:00:00"})
