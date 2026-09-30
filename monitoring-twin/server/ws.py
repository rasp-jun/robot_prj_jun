"""브라우저 WebSocket 접속 관리와 방송."""
import logging

from fastapi import WebSocket

log = logging.getLogger(__name__)


class Hub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def send(self, ws: WebSocket, text: str) -> bool:
        try:
            await ws.send_text(text)
            return True
        except Exception:  # 끊긴 소켓은 정리한다
            self.clients.discard(ws)
            log.info("ws client dropped (%d left)", len(self.clients))
            return False

    async def broadcast(self, text: str) -> None:
        for ws in list(self.clients):
            await self.send(ws, text)
