"""게이트웨이 → 웹 이벤트 규격 (docs/monitoring-twin-prd.md 부록 B v0).

이 파일이 계약이다. 모의 발생기·게이트웨이 어댑터·서버가 모두 이것을 따른다.
규격을 바꾸면 PRD 부록 B도 같이 고친다.
"""
from typing import Annotated, Literal, Optional, Union

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, TypeAdapter

LineState = Literal["STOP", "RUN", "PAUSE", "ESTOP"]
ConveyorState = Literal["EMPTY", "ARRIVING", "HOLD", "DEPARTING"]
RobotState = Literal["READY", "BUSY", "DONE", "ERR"]
JobCode = Literal[
    "ROBOT1_HULL_PLACE",
    "ROBOT1_POWERPACK_MOUNT",
    "ROBOT2_TURRET_MATE",
    "ROBOT2_WELD_MOTION",
    "ROBOT3_SORT",
]


class _Event(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ts: AwareDatetime  # 게이트웨이 시각 (ISO 8601, 시간대 포함)


class LineEvent(_Event):
    type: Literal["line"]
    state: LineState


class ConveyorEvent(_Event):
    type: Literal["conveyor"]
    cv: int = Field(ge=1, le=5)
    state: ConveyorState


class RobotEvent(_Event):
    type: Literal["robot"]
    robot: int = Field(ge=1, le=3)
    state: RobotState
    job: Optional[JobCode] = None


class ResultEvent(_Event):
    type: Literal["result"]
    run_no: int = Field(ge=0)
    ng: bool
    reason: Optional[str] = None  # TODO(미정): NG 사유 코드 목록 (비전·PLC팀 합의 전까지 자유 문자열)


class AlarmEvent(_Event):
    type: Literal["alarm"]
    source: str
    code: str
    msg: Optional[str] = None
    cleared: bool = False


class LinkEvent(_Event):
    """연결 상태. 빠진 필드는 바뀌지 않은 것으로 본다(부분 갱신)."""

    type: Literal["link"]
    gateway: Optional[bool] = None
    plc: Optional[bool] = None
    robots: Optional[Annotated[list[bool], Field(min_length=3, max_length=3)]] = None


Event = Annotated[
    Union[LineEvent, ConveyorEvent, RobotEvent, ResultEvent, AlarmEvent, LinkEvent],
    Field(discriminator="type"),
]

_adapter: TypeAdapter[Event] = TypeAdapter(Event)


def parse_event(raw: dict | str | bytes) -> Event:
    """규격에 맞지 않으면 pydantic.ValidationError를 낸다."""
    if isinstance(raw, (str, bytes)):
        return _adapter.validate_json(raw)
    return _adapter.validate_python(raw)
