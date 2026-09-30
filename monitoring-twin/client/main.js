// 트윈 화면 진입점: /ws로 스냅샷을 받아 패널과 3D를 그린다.
// 상태 계산은 서버(server/snapshot.py)에만 있고, 여기서는 받은 snapshot을 그대로 그린다.
// 새로고침 뒤 1초 안에 현장과 맞추려고 패널·WebSocket을 먼저 띄우고, 3D(three.js)는 뒤에서 불러온다.
import { renderStatus, tickElapsed } from "./ui/status.js";
import { renderAlarms } from "./ui/alarms.js";

const $ = (id) => document.getElementById(id);

let snapshot = null;
let lastSeq = -1;
let online = false;
let twin3d = null; // 3D를 다 불러온 뒤 채워짐 (twin3d.js)

function draw(event) {
  if (!snapshot) return;
  renderStatus(snapshot, { online });
  renderAlarms(snapshot);
  twin3d?.update(snapshot, event);
}

// ── WebSocket: 끊기면 바로 회색 처리, 지수 백오프로 재접속, 재접속하면 첫 메시지(스냅샷)로 다시 그림 ──
function connect(delay = 500) {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => { delay = 500; };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    // event가 null이면 접속 직후·초기화·서버 재시작 스냅샷이므로 seq와 관계없이 받는다
    if (msg.event !== null && msg.seq <= lastSeq) return;
    lastSeq = msg.seq;
    online = true;
    snapshot = msg.snapshot;
    draw(msg.event);
  };
  ws.onclose = () => {
    if (online) { online = false; draw(null); }
    setTimeout(() => connect(Math.min(delay * 2, 5000)), delay);
  };
}
connect();
setInterval(tickElapsed, 1000);

// ── 3D: 패널이 뜬 뒤에 불러온다 ──
import("./twin3d.js")
  .then(async ({ startTwin }) => {
    twin3d = await startTwin($("stage"));
    draw(null);
    $("loading").classList.add("done");
  })
  .catch((e) => {
    $("loading").textContent = `3D 모델을 불러오지 못했습니다: ${e.message}`;
    console.error(e);
  });

// ── 모의 시나리오 재생 (서버가 MT_SOURCE=mock일 때만 API가 있음) ──
(async () => {
  const r = await fetch("/api/mock/scenarios");
  if (!r.ok) return;
  $("demoScenario").innerHTML = (await r.json()).map((n) => `<option${n === "normal" ? " selected" : ""}>${n}</option>`).join("");
  $("demo").hidden = false;
  $("demoPlay").addEventListener("click", () => fetch("/api/mock/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: $("demoScenario").value, speed: +$("demoSpeed").value }),
  }));
})();

window.twin = { get snapshot() { return snapshot; }, get twin3d() { return twin3d; } }; // 콘솔 디버깅용
