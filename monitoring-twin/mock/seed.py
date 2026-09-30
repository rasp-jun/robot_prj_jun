"""예시 데이터 생성기: 지난 가동일의 가동 기록·알람을 SQLite에 채운다 (통계·기록 화면 시연·개발용).

실제 게이트웨이와 같은 경로(부록 B 이벤트 → Snapshot → Store)로 넣으므로 KPI 계산도 실제와 같다.
가동은 모의 시나리오(normal, robot1_err)를 가상 시각으로 재생해 만든다.

    python -m mock.seed --days 5 --per-day 40          # 가동일 5일 × 하루 최대 40회 (오늘은 지금 시각까지)
    python -m mock.seed --reset ...                     # 기존 기록을 지우고 다시 채움
"""
import argparse
import asyncio
import copy
import random
import sys
from datetime import datetime, timedelta

from server import config
from server.schema import parse_event
from server.snapshot import Snapshot
from server.store import Store

from . import replay

# 가동 종류와 비율: 정상 / 로봇1 오류(ST1 파워팩 실패) / ST3 비전 불합격 2종
# TODO(미정): NG 사유 코드 목록 (비전·PLC팀 합의 전 예시 코드)
KINDS = [("ok", 0.90), ("robot1_err", 0.04), ("TURRET_MISSING", 0.03), ("POSITION_OFFSET", 0.03)]


def make_run(base: dict, kind: str, run_no: int, rnd: random.Random) -> dict:
    sc = copy.deepcopy(base["robot1_err" if kind == "robot1_err" else "normal"])
    pace = rnd.uniform(0.9, 1.15)  # 가동마다 작업 시간이 조금씩 다르게
    for step in sc["steps"]:
        step["after_ms"] = int(step.get("after_ms", 0) * pace)
        ev = step.get("event")
        if ev and ev["type"] == "result":
            ev["run_no"] = run_no
            if kind in ("TURRET_MISSING", "POSITION_OFFSET"):
                ev["ng"], ev["reason"] = True, kind
    return sc


def workdays(n: int, today: datetime) -> list[datetime]:
    days, d = [], today
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    return sorted(days)


async def seed(store: Store, days: int, per_day: int, now: datetime, rnd: random.Random, start_run_no: int = 1) -> int:
    base = {n: replay.load(n) for n in ("normal", "robot1_err")}
    snap = Snapshot()
    run_no = start_run_no

    async def sink(raw: dict) -> None:
        ev = parse_event(raw)
        rx = ev.ts + timedelta(seconds=rnd.uniform(0.05, 0.4))  # 게이트웨이 → 서버 반영 지연 (K3)
        snap.apply(ev, rx)
        store.record(snap, ev.model_dump(mode="json", exclude_none=True), rx)

    for day in workdays(days, now.replace(hour=0, minute=0, second=0, microsecond=0)):
        t = day.replace(hour=9)
        for _ in range(per_day):
            if t > now - timedelta(minutes=2):
                break
            kind = rnd.choices([k for k, _ in KINDS], [w for _, w in KINDS])[0]
            start = t
            await replay.play(make_run(base, kind, run_no, rnd), sink, speed=0, clock=lambda: start)
            run_no += 1
            t += timedelta(minutes=rnd.uniform(4.5, 5.5))
    return run_no - start_run_no


def main() -> None:
    ap = argparse.ArgumentParser(description="통계·기록 화면용 예시 데이터 생성")
    ap.add_argument("--days", type=int, default=5, help="가동일 수 (주말 제외, 오늘 포함)")
    ap.add_argument("--per-day", type=int, default=40, help="하루 최대 가동 수 (09:00부터 약 5분 간격)")
    ap.add_argument("--db", default=str(config.DB_PATH))
    ap.add_argument("--reset", action="store_true", help="기존 runs·alarms·events를 지움")
    ap.add_argument("--seed", type=int, default=7, help="난수 시드 (같은 값이면 같은 데이터)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # Windows 콘솔 기본(cp949)에서 한글이 깨지지 않게

    store = Store(args.db)
    if args.reset:
        with store.db:
            store.db.executescript("DELETE FROM runs; DELETE FROM alarms; DELETE FROM events;")
    first = store.next_run_no()
    n = asyncio.run(seed(store, args.days, args.per_day, config.local_now(), random.Random(args.seed), first))
    print(f"{args.db}: 가동 {n}건 추가 (가동 순번 {first}~{first + n - 1})")


if __name__ == "__main__":
    main()
