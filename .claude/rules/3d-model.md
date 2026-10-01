---
paths:
  - "blender/**"
  - "web/**"
  - "monitoring-twin/assets/**"
  - "monitoring-twin/client/twin3d.js"
  - "monitoring-twin/client/scene/**"
---

# 3D 모델 규칙 (좌표계 · 오브젝트 이름 · 에셋)

## 재생성
- 모델 파일(GLB·blend)은 손으로 고치지 않는다. 설비는 `blender/conveyor_gen.py`, 전차는 `blender/tank_prepare.py`(B2에서 작성 예정)를 고쳐 `blender -b -P ...`로 재생성한다.
- 설비 치수는 `conveyor_gen.py` 맨 위 `P` 딕셔너리만 수정한다.
- `blender/source/`(디자인팀 전차 원본)는 손대지 않는다.

## 에셋 제작 원칙
- 설비(치수·움직임 중요) → 스크립트 모델링
- 전차 → 디자인팀 원본 → Blender 정리(스케일, 면 수 감소, 부품 분리, 이름) → GLB
- 그 밖의 소품 → Higgsfield 생성 → 같은 Blender 정리 → GLB
- AO 베이크는 모양 확정 후 고정 설비에만. 움직이는 물체는 베이크 금지

## 좌표계
- Blender: +X = 제품 흐름(ST1→ST3), +Y = 로봇 쪽(뒤), -Y = 관람자 쪽(앞), +Z = 위, 원점 = 라인 중앙 바닥
- three.js(glTF Y-up): Blender Z → three Y, Blender Y → three -Z. X는 동일
- 단위 m. 벨트 윗면 0.80, 스테이션 x = -1.1 / 0 / 1.1, 로봇 받침대 윗면 0.72

## 오브젝트 이름 (three.js `getObjectByName`으로 찾음)
이름을 바꾸거나 추가하면 같은 작업에서 **이 표, `conveyor_gen.py` 머리 주석, `web/preview_src.html`·`monitoring-twin/client`의 `getObjectByName` 호출**을 함께 고친다. 이름 변경은 사람 승인 후에만.

| 이름 | 용도 |
|---|---|
| `Conveyor_Belt` | 벨트. `map.offset.x -= v*dt/tile` 로 흐름 표현 (tile = `EV_Line.userData.belt_tile_m`) |
| `Drum_Head`, `Drum_Tail` | 드럼. 기준점 = 회전축. 벨트 윗면이 +X로 갈 때 `rotation.z -= v/0.032*dt` |
| `Roller_01`~ | 하부 리턴 롤러. `rotation.z += v/0.015*dt` |
| `Pallet_01`~`03` | 팔레트. 기준점 = 바닥 중심 |
| `Robot_Mount_ST1`~`3` | Indy7을 붙일 빈 오브젝트 (받침대 윗면 중심) |
| `Status_Ring_ST1`~`3` | 상태 링. 재질이 스테이션별로 분리됨 |
| `Sensor_ST1`~`3_LED`, `Sensor_CV2_LED`, `Sensor_CV5_LED` | 도착 센서 표시등 (재질 공유 → 런타임에서 clone 후 제어) |
| `Camera_ST2_Light`, `Camera_ST3_Light` | 카메라 링 조명 |
| `Zone_CV1`~`Zone_CV5` | 컨베이어 구간 경계 빈 오브젝트. extras `cv`, `role`, `x_start`, `x_end` (벨트는 하나, 구간은 논리 분할) |
| `Tray_Pass`, `Tray_Fail` | ST3 양옆 합격/불합격 트레이. 전차 자리 `Tray_Pass_Slot_01`~`03` |
| `Storage` | 보관창고 고정부 (헤드 드럼 너머, 기둥·서보 모터) |
| `Storage_Rack` | 서보가 상하로 움직이는 3단 선반. 기준점 = 1칸 윗면 중심, 기본 = 1칸이 벨트 높이. k칸을 벨트에 맞추려면 `position.y -= (k-1)*storage_pitch` |
| `Storage_Slot_01`~`03` | 선반 칸 (`Storage_Rack` 자식, extras `level`). 들어간 팔레트는 여기에 붙인다 |

`EV_Line` extras: `zone_x`(구간 경계), `storage_slots`(3), `storage_pitch`, `storage_stroke`(= (칸 수-1)×칸 간격), `storage_x`, `belt_tile_m`.
