"""모의 이벤트 발생기 (W0-0): 시나리오 JSON을 게이트웨이와 같은 규격(부록 B)의 이벤트로 재생한다.

시나리오 형식 (mock/scenarios/*.json)
    {"name": "...", "description": "...", "heartbeat_ms": 1000,
     "steps": [{"after_ms": 500, "event": {"type": "line", "state": "RUN"}},
               {"after_ms": 0, "silence_ms": 4000}, ...]}
    - after_ms: 앞 단계로부터의 대기 시간 (배속 적용)
    - event: 부록 B 이벤트. ts는 재생할 때 채운다
    - silence_ms: 하트비트까지 모두 멈춘다 (게이트웨이 끊김 재현). 배속과 무관하게 실제 시간으로 멈춘다
    - heartbeat_ms: 재생 중 주기적으로 {"type": "link"}를 보낸다
      TODO(미정): 하트비트 규격. 지금은 필드 없는 link 이벤트를 게이트웨이 생존 신호로 쓴다

CLI (monitoring-twin 폴더에서)
    python -m mock.replay normal --print     시나리오를 검증하고 이벤트 목록 출력
    python -m mock.replay --all              모든 시나리오 검증
"""
import argparse
import asyncio
import json
import sys
from datetime import timedelta
from pathlib import Path
from typing import Awaitable, Callable

from server import config
from server.schema import parse_event

Sink = Callable[[dict], Awaitable[object]]

HEARTBEAT = {"type": "link"}


def scenario_names() -> list[str]:
    return sorted(p.stem for p in config.SCENARIO_DIR.glob("*.json"))


def load(name: str) -> dict:
    """이름(normal) 또는 .json 경로로 시나리오를 읽고 검증한다."""
    path = Path(name) if name.endswith(".json") else config.SCENARIO_DIR / f"{name}.json"
    scenario = json.loads(path.read_text(encoding="utf-8"))
    validate(scenario)
    return scenario


def validate(scenario: dict) -> None:
    """형식이 틀리면 ValueError (몇 번째 단계인지 포함)."""
    now = config.local_now().isoformat()
    for i, step in enumerate(scenario["steps"]):
        if step.get("after_ms", 0) < 0:
            raise ValueError(f"step {i}: after_ms < 0")
        if ("event" in step) == ("silence_ms" in step):
            raise ValueError(f"step {i}: event와 silence_ms 중 하나만 있어야 함")
        if "event" in step:
            try:
                parse_event({**step["event"], "ts": now})
            except Exception as e:
                raise ValueError(f"step {i}: {e}") from e


def timeline(scenario: dict, speed: float = 1.0) -> list[tuple[int, dict | None, int]]:
    """(가상 시각 ms, 이벤트 | None, 멈춤 ms) 목록. 하트비트를 끼워 넣고 시각순으로 정렬한다.

    1배속보다 느리게 재생해도 하트비트의 실제 간격은 heartbeat_ms를 넘지 않게 한다 (끊김 오검출 방지).
    """
    # (t, 정렬 키, 이벤트, 멈춤). 같은 시각이면 단계는 파일 순서대로, 하트비트는 그 뒤
    items: list[tuple[int, int, dict | None, int]] = []
    t = 0
    for i, step in enumerate(scenario["steps"]):
        t += step.get("after_ms", 0)
        items.append((t, i, step.get("event"), step.get("silence_ms", 0)))
    hb = scenario.get("heartbeat_ms")
    if hb and 0 < speed < 1:
        hb = max(1, int(hb * speed))
    if hb:
        items += [(h, len(items), HEARTBEAT, 0) for h in range(0, t + 1, hb)]
    items.sort(key=lambda x: (x[0], x[1]))
    return [(t, ev, silence) for t, _, ev, silence in items]


async def play(
    scenario: dict,
    sink: Sink,
    speed: float = 1.0,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    clock=config.local_now,
) -> int:
    """시나리오를 재생해 이벤트마다 sink(raw)를 await 한다. 보낸 이벤트 수를 돌려준다.

    speed=0이면 기다리지 않고 가상 시각을 ts로 쓴다 (테스트용).
    """
    start = clock()
    prev = 0
    paused = 0.0  # speed=0일 때 ts에 더할 멈춤 시간
    sent = 0
    for t, ev, silence_ms in timeline(scenario, speed):
        if speed > 0 and t > prev:
            await sleep((t - prev) / 1000 / speed)
        prev = t
        if ev is None:
            if speed > 0:
                await sleep(silence_ms / 1000)
            else:
                paused += silence_ms
            continue
        ts = clock() if speed > 0 else start + timedelta(milliseconds=t + paused)
        await sink({**ev, "ts": ts.isoformat()})
        sent += 1
    return sent


def main() -> None:
    ap = argparse.ArgumentParser(description="모의 시나리오 검증·출력")
    ap.add_argument("scenario", nargs="?", help="시나리오 이름 또는 .json 경로")
    ap.add_argument("--print", action="store_true", help="이벤트 목록 출력")
    ap.add_argument("--all", action="store_true", help="모든 시나리오 검증")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # Windows 콘솔 기본(cp949)에서 한글이 깨지지 않게

    names = scenario_names() if args.all or not args.scenario else [args.scenario]
    for name in names:
        sc = load(name)
        tl = timeline(sc)
        n_ev = sum(1 for _, ev, _ in tl if ev is not None and ev is not HEARTBEAT)
        print(f"{name}: OK  events={n_ev}  length={tl[-1][0] / 1000:.1f}s  {sc.get('description', '')}")
        if args.print:
            for t, ev, silence in tl:
                if ev is HEARTBEAT:
                    continue
                print(f"  {t / 1000:7.1f}s  " + (json.dumps(ev, ensure_ascii=False) if ev else f"(silence {silence} ms)"))


if __name__ == "__main__":
    main()
