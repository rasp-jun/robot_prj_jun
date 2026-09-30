import logging
import time

import pytest
from fastapi.testclient import TestClient

from server.main import create_app

TS = "2026-09-30T09:00:00+09:00"


@pytest.fixture
def client():
    app = create_app(source="none", db_path=":memory:")
    with TestClient(app) as c:
        c.server = app.state.server
        yield c


def ingest(client, raw) -> bool:
    return client.portal.call(client.server.ingest, raw)


def test_snapshot_endpoint(client):
    d = client.get("/api/snapshot").json()
    assert d["line"]["state"] == "STOP" and len(d["conveyors"]) == 5 and len(d["robots"]) == 3
    assert ingest(client, {"type": "line", "state": "RUN", "ts": TS})
    assert client.get("/api/snapshot").json()["line"]["state"] == "RUN"


def test_ws_sends_snapshot_on_join_then_broadcasts(client):
    with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
        first_a, first_b = a.receive_json(), b.receive_json()
        assert first_a["event"] is None and first_a["snapshot"]["line"]["state"] == "STOP"
        assert first_b == first_a

        ingest(client, {"type": "robot", "robot": 1, "state": "BUSY", "job": "ROBOT1_HULL_PLACE", "ts": TS})
        ma, mb = a.receive_json(), b.receive_json()
        assert ma == mb  # 두 브라우저가 같은 메시지를 받는다
        assert ma["seq"] == 1
        assert ma["event"]["type"] == "robot"
        assert ma["snapshot"]["robots"][0]["state"] == "BUSY"


def test_invalid_event_not_broadcast_and_logged(client, caplog):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        with caplog.at_level(logging.WARNING, logger="server.main"):
            assert ingest(client, {"type": "conveyor", "cv": 9, "state": "HOLD", "ts": TS}) is False
        assert "rejected event" in caplog.text
        assert client.server.snapshot.seq == 0
        # 다음 유효 이벤트가 바로 첫 방송이어야 한다
        ingest(client, {"type": "line", "state": "RUN", "ts": TS})
        assert ws.receive_json()["seq"] == 1


def test_mock_endpoints_absent_without_mock_source(client):
    assert client.get("/api/mock/scenarios").status_code == 404
    assert client.post("/api/mock/play", json={"scenario": "normal"}).status_code in (404, 405)


def test_mock_play_over_http_and_ws():
    app = create_app(source="mock", db_path=":memory:")  # 시작 시 MT_SCENARIO를 1배속으로 재생
    with TestClient(app) as c:
        assert c.get("/api/mock/scenarios").json() == ["estop", "link_lost", "normal", "robot1_err"]
        assert c.post("/api/mock/play", json={"scenario": "nope"}).status_code == 404
        assert c.post("/api/mock/play", json={"scenario": "normal", "speed": 0}).status_code == 422

        with c.websocket_connect("/ws") as ws:
            ws.receive_json()
            r = c.post("/api/mock/play", json={"scenario": "normal", "speed": 50})
            assert r.json() == {"playing": "normal", "speed": 50.0}
            # 초기화 메시지 → 이후 이벤트가 seq 순서대로 온다
            seqs, done = [], False
            deadline = time.monotonic() + 10
            while not done and time.monotonic() < deadline:
                m = ws.receive_json()
                seqs.append(m["seq"])
                done = m["snapshot"]["trays"]["pass"] == 1 and m["snapshot"]["storage"]["count"] == 1
            assert done
            assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
        assert c.get("/api/snapshot").json()["last_run"]["run_no"] == 1


def test_static_client_manifest_and_models(client):
    assert client.get("/").status_code == 200
    manifest = client.get("/assets/manifest.json").json()
    for key in ("line", "indy7"):
        r = client.get(manifest["models"][key])
        assert r.status_code == 200, manifest["models"][key]
    assert client.get(manifest["models"]["indy7_meshes"] + "Indy7_0.stl").status_code == 200
    assert client.get("/vendor/three/build/three.module.js").status_code == 200
