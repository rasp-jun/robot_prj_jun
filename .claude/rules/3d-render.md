---
paths:
  - "web/preview_src.html"
  - "web/build.py"
  - "monitoring-twin/client/**"
---

# 3D 렌더 규칙 (스타일 · Indy7)

## 공통 스타일 (스튜디오 제품 렌더)
- 배경·안개 `#e4e7eb`, 바닥 `#dadde2`, RoomEnvironment 환경광 0.75, 그림자 있는 키 라이트 1개 + 보조광 1개
- 톤매핑 `NeutralToneMapping`
- 프레임 진회색 아노다이징, 벨트 검정 고무, 가이드 오프화이트, 로봇 흰색. 포인트 색은 상태 링과 LED만
- 로봇 상태 색: READY 회색, BUSY 주황, DONE 초록, ERR 빨강

## `web/preview_src.html` (미리보기)
- 후처리: GTAO → UnrealBloom(강도 0.5, 반경 0.4, **임계값 1.6** — 낮추면 바닥까지 번져 화면이 뿌옇게 됨) → OutputPass
- `__GLB_BASE64__`, `__THREE__` 자리표시자를 `web/build.py`가 채운다. three@0.169.0 CDN

## `monitoring-twin/client` (모니터링 트윈)
- 가볍게 유지: 후처리(GTAO·Bloom)·화질 전환 없음, 그림자 1024, 픽셀 배율 최대 1.25
  (2026-09-30: 후처리 때문에 버벅여 고품질 모드까지 없앰)
- GLB 원본은 `client`로 복사하지 않고 `/models` 경로로 읽는다
- GLB가 없는 것(트레이·보관창고·전차)은 박스 placeholder. 파일 이름·크기는 `assets/manifest.json`에서 읽는다

## Indy7
- digital_twin2 `urdfRobot.ts`를 포팅한 `createIndy7Factory` — urdf-loader@0.12.6, STL 형상·재질은 1벌을 3대가 공유
- `robots.ST1~3 = { object, q, setJoints(qDeg[6]) }` — 관절 상태는 로봇별. 받침대 위 `Indy7_ST{i}` 그룹(yaw -90°)으로 컨베이어를 향함
- 대기 자세 `[0,0,-90,0,-90,0]`, 팔레트 위 작업 자세 `[23,-32,-99,0,-64,0]` (TCP 높이 0.95, 툴 아래 방향)
