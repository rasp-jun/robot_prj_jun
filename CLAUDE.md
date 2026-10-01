# 전차 모형 조립·검사 라인 · 모니터링 트윈

Indy7 3대 + 컨베이어 5구간으로 전차 모형을 조립(ST1 파워팩, ST2 포탑·용접 모션)·검사(ST3 비전·분류)하는
라인의 웹 모니터링 트윈. 실물 라인 데이터를 받아 3D로 보여주는 **보기 전용** 트윈이다.

## 표기
- 위치: ST1~ST3 / 로봇: 로봇1~로봇3 (코드 `robot1`~`robot3`)
- 컨베이어: CV1(ST1) → CV2(버퍼) → CV3(ST2) → CV4(ST3) → CV5(회수, 팔레트 보관창고)

## 기준 문서 (이 문서와 다르면 그쪽이 우선)
- 라인 요구사항: `docs/prd.md`, 공정: `docs/process-table.md`
- 웹 앱 작업: `monitoring-twin/CLAUDE.md`
- 게이트웨이·비전 코드: `docs/gateway-vision-rules.md`
- 3D 작업: `.claude/rules/3d-model.md`(좌표계·오브젝트 이름·에셋), `.claude/rules/3d-render.md`(렌더 스타일·Indy7)
  — 해당 폴더 파일을 다룰 때 자동으로 읽힌다

## 폴더
- `docs/` — PRD, 공정표, 시스템 블록도, 발표 이미지, 게이트웨이·비전 규칙
- `monitoring-twin/` — 모니터링 웹 앱 (FastAPI + three.js)
- `blender/source/` — 디자인팀 전차 원본 (`README.md`)
- `blender/conveyor_gen.py` — 컨베이어·받침대·팔레트·카메라 스탠드·트레이·보관창고 생성 스크립트
- `web/assets/` — 생성된 `ev_line_conveyor.glb`(+`.blend`), Indy7 URDF·STL(`indy7/`, BSD-3)
- `web/preview_src.html` → `web/build.py` → `web/conveyor_preview.html` (단일 HTML 미리보기, 빌드 결과물은 git 제외)

## 명령
```powershell
# 모델 재생성 (Blender 4.2+, 이 PC: C:\Users\user\tools\blender-4.5.14-windows-x64\blender.exe 포터블. 없을 때만 설치)
$env:CONVEYOR_OUT = "$PWD\web\assets"
blender -b -P blender\conveyor_gen.py

# 미리보기 빌드
python web\build.py
```
