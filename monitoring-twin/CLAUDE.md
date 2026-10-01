# 모니터링 웹·디지털 트윈 — 작업 지침

라인 장비(PLC Q03UDV, 로봇, ST3 비전)의 상태를 Python 게이트웨이를 거쳐 받아
실시간으로 보여 주는 3D 트윈 + 모니터링 대시보드. 라인 소개·표기는 루트 `CLAUDE.md`.

## 먼저 읽을 것 (이 순서)
1. `docs/monitoring-twin-prd.md` — 이 웹의 요구사항 (W0-n 핵심, W1-n 추가)
2. `docs/monitoring-twin-plan.md` — 마일스톤, 완료 조건, 진행 기록

## 표기
- 제품 ID는 없다. 추적 단위는 가동 순번(`run_no`)과 팔레트 위치다.
- P0/P1은 라인 PRD의 단계, W0/W1은 이 웹의 단계다. 섞어 쓰지 않는다.

## 스택
- 서버: Python FastAPI, WebSocket(`/ws`), REST(`/api/...`), SQLite(`data/monitoring.db`, 환경변수 `MT_DB`로 변경)
- 클라이언트: 번들러 없이 ES modules + importmap. three.js 0.169.0·urdf-loader 0.12.6은 `client/vendor/` 로컬 사본 (CDN 없이 시연)
- 서버 경로: `/` = `client/`, `/assets` = `assets/`, `/models` = `../web/assets/`
- 가상환경 `.venv` (Python 3.12). 테스트: `.venv/Scripts/python -m pytest -q`

## 반드시 지킬 것
- P0에서 웹은 읽기 전용이다. PLC·로봇에 쓰는 코드를 만들지 않는다 (원격 조작은 W1-5).
- 웹은 게이트웨이 이벤트만 받는다. PLC(MC 프로토콜)·로봇(IndyDCP3)에 직접 연결하지 않는다.
- 이벤트 규격은 `server/schema.py`(pydantic) 한 곳에 정의하고, 클라이언트·모의 발생기·게이트웨이 어댑터가 모두 따른다.
  규격을 바꾸면 `docs/monitoring-twin-prd.md` 부록 B도 같이 고친다.
- JSON 키는 snake_case, 상태 값은 대문자(`RUN`, `BUSY`, `HOLD`) (가정: PC팀 변수 규칙 확정 전)
- 현장 장비 없이 돌아가야 한다. 모든 화면 기능은 `mock/scenarios/` 시나리오로 재현·테스트 가능해야 한다.
- "미정"·"가정" 항목은 추측으로 확정하지 않는다. `config` 설정값이나 `TODO(미정): ...` 주석으로 남긴다.
- 폴더 구조를 바꿀 때는 이유를 남긴다.

## 작업 방식
- `docs/monitoring-twin-plan.md` 마일스톤 순서대로 한다 (M1 → M2 → B1 → M3 → M4 → M5 → B2 → M6). 마일스톤마다 완료 조건을 확인하고 멈춰서 보고한다.
- 서버 로직(스냅샷 갱신, 가동 기록, KPI 계산)은 pytest로 테스트한다. 시나리오를 재생해 최종 상태를 검사한다.
- 화면은 모의 시나리오를 틀어 놓고 확인한 방법을 보고에 적는다.
