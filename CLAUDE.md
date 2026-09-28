# EV 모형 생산 라인 · 모니터링 트윈

협동로봇 Indy7 3대 + 컨베이어 1개로 전기차 모형을 조립(ST1)·가공(ST2)·검사(ST3)하는 라인의
웹 모니터링 트윈. 실물 라인 데이터를 받아 3D로 보여주는 **보기 전용** 트윈이다 (운전 명령 없음).

## 폴더
- `blender/conveyor_gen.py` — 컨베이어·받침대·팔레트·카메라 스탠드를 생성하는 Blender 스크립트 (파라메트릭)
- `web/assets/ev_line_conveyor.glb` — 위 스크립트 결과물 (`.blend`도 같은 폴더)
- `web/preview_src.html` — three.js 스튜디오 미리보기 원본 (`__GLB_BASE64__`, `__THREE__` 자리표시자)
- `web/assets/indy7/` — digital_twin2에서 복사한 Indy7 URDF·STL (BSD-3, `NOTICE.md`)
- `web/build.py` — GLB·Indy7을 base64로 넣어 단일 HTML(`web/conveyor_preview.html`)로 빌드

## 명령
```powershell
# 모델 재생성 (Blender 4.2+)
$env:CONVEYOR_OUT = "$PWD\web\assets"
blender -b -P blender\conveyor_gen.py

# 미리보기 빌드 (CDN three@0.169.0 사용)
python web\build.py
```
치수는 `conveyor_gen.py` 맨 위 `P` 딕셔너리만 수정한다. 모델을 손으로 고치지 말고 스크립트를 고쳐 재생성한다.

## 좌표계
- Blender: +X = 제품 흐름(ST1→ST3), +Y = 로봇 쪽(뒤), -Y = 관람자 쪽(앞), +Z = 위, 원점 = 라인 중앙 바닥
- three.js(glTF Y-up): Blender Z → three Y, Blender Y → three -Z. X는 동일
- 단위 m. 벨트 윗면 0.80, 스테이션 x = -1.1 / 0 / 1.1, 로봇 받침대 윗면 0.72

## 오브젝트 이름 규칙 (three.js에서 getObjectByName으로 찾음 — 바꾸지 말 것)
| 이름 | 용도 |
|---|---|
| `Conveyor_Belt` | 벨트. `map.offset.x -= v*dt/tile` 로 흐름 표현 (tile = `EV_Line.userData.belt_tile_m`) |
| `Drum_Head`, `Drum_Tail` | 드럼. 기준점 = 회전축. 벨트 윗면이 +X로 갈 때 `rotation.z -= v/0.032*dt` |
| `Roller_01`~ | 하부 리턴 롤러. `rotation.z += v/0.015*dt` |
| `Pallet_01`~`03` | 팔레트. 기준점 = 바닥 중심 |
| `Robot_Mount_ST1`~`3` | Indy7을 붙일 빈 오브젝트 (받침대 윗면 중심) |
| `Status_Ring_ST1`~`3` | 상태 링. 재질이 스테이션별로 분리됨 (RUN 초록 / BUSY 주황 / ERROR 빨강) |
| `Sensor_ST1`~`3_LED` | 도착 센서 표시등 (재질 공유 → 런타임에서 clone 후 제어) |
| `Camera_ST2_Light`, `Camera_ST3_Light` | 카메라 링 조명 |

## 렌더 스타일 (스튜디오 제품 렌더)
- 배경·안개 `#e4e7eb`, 바닥 `#dadde2`, RoomEnvironment 환경광 0.75, 그림자 있는 키 라이트 1개 + 보조광 1개
- 톤매핑 `NeutralToneMapping`, 후처리: GTAO → UnrealBloom(강도 0.5, 반경 0.4, **임계값 1.6** — 낮추면 바닥까지 번져 화면이 뿌옇게 됨) → OutputPass
- 프레임 진회색 아노다이징, 벨트 검정 고무, 가이드 오프화이트, 로봇 흰색. 포인트 색은 상태 링과 LED만
- AO는 현재 실시간(GTAO). 모양이 확정되면 고정 설비만 Blender에서 AO 베이크 (움직이는 물체는 베이크 금지)

## 에셋 제작 원칙
- 설비(치수·움직임 중요) → 스크립트 모델링
- 디자인 물체(차체 셸·소품) → Higgsfield 생성 → Blender 정리(스케일, 면 수 감소, 부품 분리, 이름) → GLB
- Indy7 → 기존 three.js(digital_twin2) 로더 재사용

## Indy7 (preview_src.html)
- digital_twin2 `urdfRobot.ts`를 포팅한 `createIndy7Factory` — urdf-loader@0.12.6(CDN), STL 형상·재질은 1벌을 3대가 공유
- `robots.ST1~3 = { object, q, setJoints(qDeg[6]) }` — 관절 상태는 로봇별. 받침대 위 `Indy7_ST{i}` 그룹(yaw -90°)으로 컨베이어를 향함
- 대기 자세 `[0,0,-90,0,-90,0]`, 팔레트 위 작업 자세 `[23,-32,-99,0,-64,0]` (TCP 높이 0.95, 툴 아래 방향)

## 다음 작업
1. 실제 GPU에서 인덱싱 데모·fps 확인 (로봇 3대 포함 약 617k 삼각형)
2. 미리보기를 WebSocket 수신 구조로 전환 (서버가 PLC·로봇 데이터를 모아 송신, 메시지 형식은 PRD의 인터페이스 정의서 기준) — 수신한 q는 `robots[id].setJoints(q)`로, 데모 `stepRobots()`는 제거
