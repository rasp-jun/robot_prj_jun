// The server owns process state; this module only presents snapshots and mock controls.
import { renderStatus, tickElapsed } from "./ui/status.js";
import { renderAlarms } from "./ui/alarms.js";
import { initPlayback, renderPlayback } from "./ui/playback.js";

const $ = (id) => document.getElementById(id);
let snapshot = null;
let lastSeq = -1;
let online = false;
let twin3d = null;
let playback = null;

function draw(event) {
  if (!snapshot) return;
  renderSceneStatus();
  renderAlarms(snapshot);
  renderPlayback(playback, online);
  twin3d?.update(snapshot, event, { online, playback });
  renderSceneStatus();
}

function renderSceneStatus(){
  if(!snapshot)return;
  const shown=playback?twin3d?.presentation():null;
  // In demo mode cards follow the displayed sequence; faults/links remain immediate.
  const s=shown?{...shown,updated_at:snapshot.updated_at,link:snapshot.link,alarms_active:snapshot.alarms_active,
    line:['ESTOP','PAUSE'].includes(snapshot.line.state)?snapshot.line:shown.line,
    robots:shown.robots.map(r=>snapshot.robots.find(n=>n.robot===r.robot)?.state==='ERR'?snapshot.robots.find(n=>n.robot===r.robot):r)}:snapshot;
  renderStatus(s,{online,playback});
}

function showDisconnected() {
  online = false;
  if (snapshot) return draw(null);
  $("headline").textContent = "서버에 연결할 수 없습니다. 자동으로 다시 연결합니다.";
  $("linePill").textContent = "연결 대기";
  $("syncNote").textContent = "서버 연결 복구 대기";
  $("banner").dataset.kind = "offline";
  $("banner").textContent = "서버 연결 대기 · 수신된 공정 데이터가 없습니다";
  $("banner").hidden = false;
  document.body.classList.add("stale");
}

function connect(delay = 500) {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => { delay = 500; };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.event !== null && msg.seq <= lastSeq) return;
    lastSeq = msg.seq;
    online = true;
    snapshot = msg.snapshot;
    playback = msg.playback ?? null;
    draw(msg.event);
  };
  ws.onclose = () => {
    showDisconnected();
    setTimeout(() => connect(Math.min(delay * 2, 5000)), delay);
  };
  ws.onerror = () => ws.close();
}
connect();
setInterval(tickElapsed, 1000);
tickElapsed();

import("./twin3d.js")
  .then(async ({ startTwin }) => {
    twin3d = await startTwin($("stage"),{onPresentation:renderSceneStatus});
    draw(null);
    $("loading").classList.add("done");
    $("loading").hidden = true;
    document.querySelectorAll(".views button, #labelToggle").forEach((b) => { b.disabled = false; });
  })
  .catch((e) => {
    $("loading").classList.add("error");
    $("loading").textContent = "3D를 불러오지 못했습니다. 페이지를 새로고침해 다시 시도하세요. 상태 패널은 계속 사용할 수 있습니다.";
    console.error(e);
  });

$("labelToggle").addEventListener("click", () => {
  const hidden = document.body.classList.toggle("labels-hidden");
  $("labelToggle").setAttribute("aria-pressed", String(!hidden));
});

initPlayback();
window.twin = { get snapshot() { return snapshot; }, get twin3d() { return twin3d; } };
