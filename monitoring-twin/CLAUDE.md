# 모니터링 웹·디지털 트윈 — Claude Code 작업 지침

전차 모형 조립·검사 라인(Indy7 3대, 컨베이어 5구간, PLC Q03UDV, Python 게이트웨이, ST3 비전)의 상태를
웹에서 실시간으로 보여 주는 3D 트윈 + 모니터링 대시보드를 만든다.

## 먼저 읽을 것 (이 순서)

1. `docs/monitoring-twin-prd.md` — 이 웹의 요구사항 (W0-n 핵심, W1-n 추가)
2. `docs/monitoring-twin-plan.md` — 만드는 순서와 마일스톤, 완료 확인 방법
3. `../docs/prd.md` — 라인 전체 PRD (참고용. 기능 번호 P0-n/P1-n은 이 문서 것)
4. `../CLAUDE.md` — GLB 오브젝트 이름 규칙·좌표계·렌더 스타일 (3D 작업 시). 라인 구성·용어가 다르면 라인 PRD를 따른다
   (루트 문서는 PRD 이전 "EV 모형·컨베이어 1개" 기준이다)

## 표기

- 위치: ST1, ST2, ST3 / 로봇: 로봇1·로봇2·로봇3 (코드에서는 `robot1`~`robot3`)
- 컨베이어 구간: CV1(ST1) → CV2(버퍼) → CV3(ST2) → CV4(ST3) → CV5(잉여, 팔레트 보관창고)
- 보관창고: CV5 끝. 서보가 3단 선반(`Storage_Rack`) 전체를 상하로 움직여 채울 칸을 벨트 높이에 맞춘다 (아래 칸부터 `Storage_Slot_01~03`)
- 제품 ID는 없다. 추적 단위는 가동 순번(`run_no`)과 팔레트 위치다.
- P0/P1은 라인 PRD의 단계, W0/W1은 이 웹의 단계다. 섞어 쓰지 않는다.

## 스택

- 서버: Python, FastAPI, WebSocket(`/ws`), REST(`/api/...`), SQLite (가정)
- 클라이언트: 번들러 없이 ES modules + importmap (확정). three.js 0.169.0과 urdf-loader 0.12.6을
  `client/vendor/`에 로컬 사본으로 둔다 (`web/preview_src.html`과 같은 조합, CDN 없이 시연)
- 가상환경: `monitoring-twin/.venv` (Python 3.12), 테스트는 `.venv/Scripts/python -m pytest -q`

## 반드시 지킬 것

- P0에서 웹은 읽기 전용이다. PLC·로봇에 쓰는 코드를 만들지 않는다. (원격 조작은 W1-5)
- 웹은 게이트웨이 이벤트만 받는다. PLC(MC 프로토콜)·로봇(IndyDCP3)에 직접 연결하지 않는다.
- 이벤트 규격(`docs/monitoring-twin-prd.md` 부록 B)이 계약이다. `server/schema.py`(pydantic) 한 곳에 정의하고,
  클라이언트·모의 발생기·게이트웨이 어댑터가 모두 이것을 따른다. 규격을 바꾸면 monitoring-twin-prd.md 부록 B도 같이 고친다.
- JSON 키는 snake_case, 상태 값은 대문자(`RUN`, `BUSY`, `HOLD`) (가정: PC팀 변수 규칙 확정 전)
- 현장 장비 없이 돌아가야 한다. 모든 화면 기능은 `mock/` 시나리오로 재현·테스트 가능해야 한다.
- "미정"·"가정" 항목은 추측으로 확정하지 않는다. 설정값(`config`)이나 `TODO(미정): ...` 주석으로 남긴다.
- 3D 모델 원본은 `../web/assets/`(컨베이어 GLB, Indy7, 전차 GLB)이다. 복사하지 않고 서버가 그 폴더를 그대로 서빙한다.
- 모델은 손으로 고치지 않는다. 설비는 `../blender/conveyor_gen.py`, 전차는 `../blender/tank_prepare.py`를 고쳐
  `blender -b -P ...`로 재생성한다 (계획 B1·B2). 오브젝트 이름을 바꾸거나 추가하면 루트 `CLAUDE.md` 이름 표,
  스크립트 머리 주석, `web/preview_src.html`의 `getObjectByName` 호출을 같은 작업에서 함께 고친다.
- Blender는 설치되어 있으면 그것을 쓰고, 없을 때만 설치한다.
- GLB가 없는 것(트레이·보관창고·전차)은 박스 placeholder로 그린다. 파일 이름·크기는 `assets/manifest.json`에서 읽는다.
- 로봇 상태 색: READY 회색, BUSY 주황, DONE 초록, ERR 빨강 (GLB 상태 링과 같은 색 체계)
- 3D는 가볍게 유지한다: 후처리(GTAO·Bloom)·화질 전환을 넣지 않는다, 그림자 1024, 픽셀 배율 최대 1.25
  (2026-09-30: 후처리 때문에 버벅여 고품질 모드까지 없앰. 조명·톤매핑·바닥 색은 루트 CLAUDE.md 렌더 스타일 유지)

## 폴더 구조 (가정, 바꿀 때는 이유를 남긴다)

```
monitoring-twin/
  CLAUDE.md
  docs/        monitoring-twin-prd.md, monitoring-twin-plan.md
  server/      main.py, ws.py, snapshot.py, store.py (SQLite), schema.py, config.py
  client/      index.html (트윈), stats.html (통계), records.html (기록), style.css
               main.js (패널·WebSocket 먼저), twin3d.js (3D는 동적 import)
               scene/  line.js, pallets.js, robots.js
               ui/     status.js, alarms.js (트윈) · kpi.js (통계) · runs.js (기록) · header.js, export.js (공통)
               vendor/ three 0.169.0, urdf-loader 0.12.6
               (서버 경로: / = client, /assets = monitoring-twin/assets, /models = ../web/assets)
  assets/      manifest.json (placeholder 크기·위치, GLB 원본은 ../web/assets/)
  mock/        replay.py, seed.py (예시 데이터), scenarios/normal.json, robot1_err.json, estop.json, link_lost.json
  data/        monitoring.db (SQLite, git 제외, 환경변수 MT_DB로 경로 변경)
  tests/
```

## 작업 방식

- `docs/monitoring-twin-plan.md`의 마일스톤 순서대로 한다 (M1 → M2 → B1 → M3 → M4 → M5 → B2 → M6). 마일스톤마다 완료 조건을 확인하고 멈춰서 보고한다.
- 서버 로직(스냅샷 갱신, 가동 기록, KPI 계산)은 pytest로 테스트한다. 시나리오를 재생해 최종 상태를 검사한다.
- 화면은 모의 시나리오를 틀어 놓고 확인한 방법을 보고에 적는다.
