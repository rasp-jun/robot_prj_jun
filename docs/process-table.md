# 탱크 스마트팩토리 최종 공정 계획

Tank Smart Factory Process Plan · Vision-Guided Welding Trajectory 포함

원본 표(0929.odt)입니다. 내용은 그대로입니다.

| 공정 | 내용 |
| --- | --- |
| 1. Hull 투입 | 바퀴와 하부가 포함된 기본 차체를 메인 컨베이어에 투입한다. |
| 2. Hull 구조 조립 | 차체 상부 및 측면 구조물을 조립하여 기본 Hull 형상을 구성한다. |
| 3. Hull 조립 검사 | Vision으로 구조물의 위치, 방향, 누락 여부를 확인한다. |
| 4. Powerpack Sub-Assembly | Engine, Transmission, Cooling Module을 조립하여 Powerpack Ass'y를 구성한다. |
| 5. Powerpack 검사 | Powerpack 구성품의 누락, 방향, 조립 상태를 Vision으로 확인한다. |
| 6. Powerpack 장착 | 완성된 Powerpack을 차체 후방 Bay에 정렬하여 삽입한다. |
| 7. Turret Sub-Assembly | 별도 Sub-Line에서 포탑 몸체, 포신 등의 부품을 선행 조립한다. |
| 8. Turret 검사 | 완성된 포탑의 부품 누락과 조립 상태를 Vision으로 검사한다. |
| 9. Turret Mating | 완성된 Turret Ass'y를 메인 차체 위에 정렬하여 결합한다. |
| 10. Final Assembly Inspection | Powerpack, Hull, Turret 등 주요 조립 상태를 종합적으로 확인한다. |
| 11. Function Test | 포탑 회전, LED, 모터 등 구현된 기능의 정상 작동 여부를 확인한다. |
| 12. Welding Path Input | 작업자가 최종 차체의 지정 영역에 용접 경로를 선으로 직접 표시한다. |
| 13. Welding Path Detection | 카메라가 작업자가 그린 선을 검출하고 Center Line을 추출한다. |
| 14. Trajectory Generation | 검출된 선을 Robot이 추종할 수 있도록 좌표 변환 및 Trajectory Point를 생성한다. |
| 15. Robotic Welding Simulation | Robot이 Marker Tool로 검출된 경로를 따라 이동하며 용접 공정을 모사한다. |
| 16. Weld Path Inspection | Reference Line과 Robot이 따라 그린 결과를 비교해 경로 오차를 검사한다. |
| 17. PASS / RETRY | 허용 오차 이내면 완료하고, 기준 초과 시 해당 경로 또는 구간을 재작업한다. |
| 18. Traceability / Roll-Out | 제품 ID와 검사 결과를 기록하고 정상 제품을 최종 배출한다. |

## 라인 배치 (PRD 기준)

표기는 PRD와 같습니다. 컨베이어는 ST1 → 버퍼 → ST2 → ST3 → 회수 5구간이고, 작업 위치는 ST1·ST2·ST3 세 곳입니다. 회수 구간은 팔레트 보관창고입니다. 로봇은 Indy7 3대(로봇1·로봇2·로봇3)이고, P0의 비전 카메라는 ST3에 1대입니다. 제품 ID는 부여하지 않고 팔레트 단위로 추적합니다. "범위" 열의 P0/P1은 구현 단계(P0 = 핵심, P1 = 추가)입니다.

| 공정 | 범위 | 위치 | 수행 | PRD 항목 | 비고 |
| --- | --- | --- | --- | --- | --- |
| 1 Hull 투입 | P0 | ST1 | 로봇1 (가정) | P0-6 | 하부 차체를 팔레트 위에 올림 |
| 2 Hull 구조 조립 | 제외 | - | - | - | 파워팩만 먼저 넣음. 상부·측면 구조물은 추후 |
| 3 Hull 조립 검사 | P1 | 버퍼 | 비전 | P1-13 | P0는 공정 10에 통합 |
| 4 Powerpack Sub-Assembly | P0 | 서브라인 | 작업자 | P0-9 | P0는 기능 없는 더미 모듈 |
| 5 Powerpack 검사 | P1 | 버퍼 | 비전 | P1-13 | P0는 공정 10에 통합 |
| 6 Powerpack 장착 | P0 | ST1 | 로봇1 | P0-6 | 120×80 모듈, 포켓 123×83, 챔퍼 1.5, ±1 mm |
| 7 Turret Sub-Assembly | P0 | 서브라인 | 작업자 | P0-9 | |
| 8 Turret 검사 | P0 | ST3 | 비전 | P0-11 | 공정 10에 통합 |
| 9 Turret Mating | P0 | ST2 | 로봇2 (파지 툴) | P0-7 | 위치결정핀 + 자석 |
| 10 Final Assembly Inspection | P0 | ST3 | 비전 | P0-11, P0-13 | 합격/불합격 확정 |
| 11 Function Test | P1 | ST1 (파워팩 장착 직후) | PCB 자체 테스트 | P1-3, P1-6, P1-10 | P0는 더미 모듈이라 미구현 |
| 12 Welding Path Input | 제외 | - | - | - | 작업자 경로 표시 뺌 |
| 13 Welding Path Detection | 제외 | - | - | - | |
| 14 Trajectory Generation | 제외 | - | - | - | |
| 15 Robotic Welding Simulation | P0 | ST2 | 로봇2 (파지 툴) | P0-8 | 교시한 고정 경로를 따라 이동 |
| 16 Weld Path Inspection | 제외 | - | - | - | |
| 17 PASS / RETRY | 제외 | - | - | - | 합격/불합격 판정은 공정 10에서 |
| 18 Traceability / Roll-Out | P0 | ST3, 회수 구간 | 로봇3, PLC | P0-12, P0-13 | 로봇3가 트레이로 분류, 팔레트는 보관창고로. 기록은 가동 순번 (제품 ID 없음) |

## 표와 다르게 처리한 점

- 공정 3·5의 Vision 검사는 P1(버퍼 1차 검증)로 뺐습니다. P0에서는 공정 3·5·8을 ST3의 공정 10에 통합했습니다.
- 공정 2(상부·측면 구조물 조립)는 파워팩만 먼저 넣기로 해서 P0에서 제외했습니다.
- 공정 11(Function Test)은 P0 모듈이 더미라서 P1로 뺐습니다.
- 공정 12~14·16·17(작업자 경로 표시, 검출, 궤적 생성, 경로 검사, PASS/RETRY)은 뺐습니다. 공정 15는 교시한 고정 경로를 따라 이동하는 모션만 남겼습니다.
- 로봇 툴은 로봇2만 파지 툴로 정했습니다. 로봇1·로봇3는 미정입니다.
