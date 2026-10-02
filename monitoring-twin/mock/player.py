"""Controllable demo clock. Never sends control commands to physical devices."""
import asyncio
import time

from server import config


class Player:
    def __init__(self, name, speed, loop, generation, sink, restart, clock=time.monotonic, sleep=asyncio.sleep):
        self.name, self.speed, self.loop = name, speed, loop
        self.generation = generation
        self.sink, self.restart = sink, restart
        self.clock, self.sleep = clock, sleep
        self.state = "PLAYING"
        self.elapsed = self.duration = 0.0
        self.cycle = 1
        self.jobs, self.transfers = {}, {}
        self.silence = False
        self._last_heartbeat = clock()

    def metadata(self):
        return {
            "scenario": self.name, "state": self.state, "speed": self.speed,
            "loop": self.loop, "cycle": self.cycle, "generation": self.generation,
            "elapsed_s": round(self.elapsed, 3), "duration_s": round(self.duration, 3),
            "jobs": self.jobs, "transfers": self.transfers,
        }

    async def heartbeat(self):
        self._last_heartbeat = self.clock()
        await self.sink({"type": "link", "ts": config.local_now().isoformat()})

    async def wait(self, seconds, *, scaled=True, progress=True, silent=False):
        remaining, last = seconds, self.clock()
        self.silence = silent
        while remaining > 1e-8 or self.state == "PAUSED":
            await self.sleep(0.02 if self.state == "PAUSED" else min(0.02, remaining / max(self.speed if scaled else 1, 1)))
            now = self.clock()
            dt, last = max(0, now - last), now
            if self.state != "PAUSED":
                used = min(remaining, dt * (self.speed if scaled else 1))
                remaining -= used
                if progress:
                    self.elapsed = min(self.duration, self.elapsed + used)
            # Keep the demo connected during an intentional pause, but preserve fault scenarios.
            if not silent and now - self._last_heartbeat >= 0.5:
                await self.heartbeat()
        self.silence = False

    @staticmethod
    def span(steps, index, matches, default):
        duration = 0.0
        for step in steps[index + 1:]:
            duration += (step.get("after_ms", 0) + step.get("silence_ms", 0)) / 1000
            if matches(step.get("event", {})):
                return max(0.05, duration)
        return default

    async def run(self, scenario):
        while True:
            steps = scenario["steps"]
            self.duration = sum(s.get("after_ms", 0) + s.get("silence_ms", 0) for s in steps) / 1000
            self.elapsed = 0.0
            for i, step in enumerate(steps):
                await self.wait(step.get("after_ms", 0) / 1000)
                if "silence_ms" in step:
                    # Link-loss simulation keeps a real-time silence even at high playback speed.
                    await self.wait(step["silence_ms"] / 1000, scaled=False, silent=True)
                    continue
                ev = step["event"]
                if ev["type"] == "robot" and ev["state"] == "BUSY":
                    duration = self.span(steps, i, lambda x: x.get("type") == "robot" and x.get("robot") == ev["robot"], 4)
                    self.jobs[str(ev["robot"])] = {"duration_s": duration, "started_s": self.elapsed}
                if ev["type"] == "conveyor" and ev["state"] in ("ARRIVING", "DEPARTING"):
                    duration = self.span(steps, i, lambda x: x.get("type") == "conveyor" and x.get("cv") == ev["cv"] and x.get("state") in ("HOLD", "EMPTY"), 1.4)
                    self.transfers[str(ev["cv"])] = duration
                await self.sink({**ev, "ts": config.local_now().isoformat()})
                # Same-timestamp events stay ordered, while allowing cancellation and HTTP control.
                await self.sleep(0)
            self.elapsed = self.duration
            self.state = "COMPLETED"
            await self.heartbeat()
            while True:
                await self.wait(0.5, scaled=False, progress=False)
                if self.loop:
                    await self.wait(2, scaled=False, progress=False)
                    if self.loop:
                        break
            self.state = "PLAYING"
            self.cycle += 1
            self.generation += 1
            self.jobs, self.transfers = {}, {}
            self.elapsed = 0
            scenario = await self.restart()
