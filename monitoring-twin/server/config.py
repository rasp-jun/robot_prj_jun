"""서버 설정. 환경변수로 덮어쓴다."""
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLIENT_DIR = ROOT / "client"
ASSETS_DIR = ROOT / "assets"
MODELS_DIR = ROOT.parent / "web" / "assets"  # 컨베이어 GLB·Indy7 원본 (복사하지 않고 그대로 서빙)
SCENARIO_DIR = ROOT / "mock" / "scenarios"

# 이벤트 출처: "mock"이면 서버 시작 시 MT_SCENARIO를 재생, "none"이면 아무것도 넣지 않음
SOURCE = os.getenv("MT_SOURCE", "none")
SCENARIO = os.getenv("MT_SCENARIO", "normal")
SPEED = float(os.getenv("MT_SPEED", "1"))

# 이 시간 동안 게이트웨이 이벤트가 없으면 연결 끊김으로 본다 (PRD 목표: 3초 안에 표시)
LINK_TIMEOUT_S = float(os.getenv("MT_LINK_TIMEOUT_S", "2.0"))

# TODO(미정): 로봇이 작업하는 컨베이어 구간. I/O 할당표 확정 시 맞춤
ROBOT_CV = {1: 1, 2: 3, 3: 4}

# ST3 판정(result)이 붙는 구간
RESULT_CV = 4

# CV5 끝 팔레트 보관창고 수용 수 (2026-09-30 확정)
STORAGE_SLOTS = 3


def local_now() -> datetime:
    """시간대가 붙은 현재 시각 (이벤트 ts는 시간대가 필수)."""
    return datetime.now(timezone.utc).astimezone()
