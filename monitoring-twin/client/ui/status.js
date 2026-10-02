// 상단 연결 상태, 상황 카드, 로봇 카드, 라인 요약 (W0-4)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const CV_NAMES = ["파워팩 조립", "버퍼", "포탑·용접", "비전·분류", "팔레트 회수"];
const CV_STATES = { EMPTY: "비어 있음", ARRIVING: "진입 중", HOLD: "정위치", DEPARTING: "이송 중" };

const TASK = {
  ROBOT1_HULL_PLACE: "하부 차체를 팔레트에 올리는 중",
  ROBOT1_POWERPACK_MOUNT: "파워팩을 차체에 넣는 중",
  ROBOT2_TURRET_MATE: "포탑을 결합하는 중",
  ROBOT2_WELD_MOTION: "용접 모션 실행 중",
  ROBOT3_SORT: "트레이로 분류하는 중",
};
const LINE = {
  RUN: ["지금, 라인이 돌고 있습니다", "ok"],
  PAUSE: ["라인이 일시정지 상태입니다", "warn"],
  STOP: ["라인이 멈춰 있습니다", "muted"],
  ESTOP: ["라인이 비상정지로 멈췄습니다", "bad"],
};
const clock = (d) => d.toLocaleTimeString("en-GB", { hour12: false }); // 14:31:57
const hhmmss = (iso) => (iso ? clock(new Date(iso)) : "");

// 로봇이 BUSY가 된 시각 (경과 시간 표시용, 브라우저 시계 기준)
const busySince = {};
let demoClock = null;

export function renderStatus(s, { online, playback = null }) {
  demoClock = playback;
  const stale = !online || !s.link.gateway;

  // 연결 상태
  const links = [["게이트웨이", !stale], ["PLC", !stale && s.link.plc], ...s.link.robots.map((ok, i) => [`로봇${i + 1}`, !stale && ok])];
  $("links").innerHTML = links.map(([n, ok]) => `<span data-ok="${!!ok}"><i></i>${n}</span>`).join("");

  // 배너: 비상정지가 연결 끊김보다 먼저
  const banner = $("banner");
  if (s.line.state === "ESTOP") {
    const a = s.alarms_active.find((x) => x.code === "ESTOP");
    banner.dataset.kind = "estop";
    banner.innerHTML = `<b>비상정지</b><span>${a ? hhmmss(a.raised_at) + " 발생" : ""} · 복귀하면 해제 시각이 기록됩니다</span>`;
    banner.hidden = false;
  } else if (stale) {
    banner.dataset.kind = "offline";
    banner.innerHTML = `<b>${online ? "게이트웨이 연결 끊김" : "서버 연결 끊김"}</b><span>마지막 상태를 회색으로 표시하고 있습니다</span>`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
  document.body.classList.toggle("stale", stale);
  $("syncNote").textContent = stale ? "연결 복구 대기 · 마지막 수신 상태" : `마지막 동기화 ${hhmmss(s.updated_at)}`;
  $("processFlow").innerHTML = s.conveyors.map(({ cv, state }) => {
    const pallet = s.pallets.find((p) => p.cv === cv);
    return `<div class="process-step" data-state="${esc(state)}" data-ng="${pallet?.ng === true}"><strong>CV${cv} →</strong><b>${CV_NAMES[cv - 1]}</b><span>${stale ? "확인 불가" : CV_STATES[state] ?? esc(state)}${pallet?.ng ? " · NG" : ""}</span></div>`;
  }).join("");

  // 상황 카드
  const paused = playback?.state === "PAUSED";
  const [head, tone] = stale ? ["현장 상태를 확인할 수 없습니다", "muted"]
    : paused ? ["시뮬레이션을 일시정지했습니다", "warn"] : LINE[s.line.state];
  $("headline").textContent = head;
  const pill = $("linePill");
  pill.dataset.tone = tone;
  pill.textContent = paused ? "DEMO PAUSED" : s.line.state;
  const runs = s.pallets.filter((p) => p.run_no != null).map((p) => `#${p.run_no}`);
  $("lineNote").textContent = `팔레트 ${s.pallets.length}개 라인 위${runs.length ? " · " + runs.join(", ") : ""}`;

  // 로봇 카드
  const now = performance.now();
  $("robots").innerHTML = s.robots.map((r) => {
    if (r.state === "BUSY") busySince[r.robot] ??= now;
    else delete busySince[r.robot];
    const task = r.state === "BUSY" ? TASK[r.job] ?? r.job
      : r.state === "ERR" ? `오류 · ${r.job ?? "작업 코드 없음"}`
      : r.state === "DONE" ? (TASK[r.job] ? `${TASK[r.job].replace(" 중", "")} 완료` : "작업 완료")
      : "대기";
    const connected = !stale && s.link.robots[r.robot - 1];
    return `<div class="robot" data-state="${r.state}" data-connected="${connected}">
      <div class="head"><span class="name">로봇${r.robot}<button type="button" class="focus-station" data-focus-st="${r.robot}" aria-label="ST${r.robot} 작업 확대">ST${r.robot} ↗</button></span><span class="state">${r.state}</span></div>
      <div class="task">${connected ? esc(task) : "연결 끊김 · 마지막 수신 상태"}</div>
      <div class="motion-phase" data-motion-phase="${r.robot}"></div>
      <div class="meta">${r.job ? `<span>${esc(r.job)}</span> ` : "작업 대기 "}<span data-elapsed="${connected ? r.robot : ""}"></span></div>
    </div>`;
  }).join("");
  tickElapsed();

  // 라인 요약
  $("trayPass").textContent = s.trays.pass;
  $("trayFail").textContent = s.trays.fail;
  $("storage").textContent = `${s.storage.count} / ${s.storage.capacity}`;
  const lr = s.last_run;
  $("lastRun").textContent = lr ? `#${lr.run_no ?? "?"} ${lr.ng ? "불합격" : "합격"}` : "–";
  $("lastRunNote").textContent = lr
    ? lr.ng ? lr.reason ?? "" : ["ST1", "ST2", "ST3"].map((k) => `${k} ${lr.times[k].toFixed(1)}s`).join(" · ")
    : "";
}

export function tickElapsed() {
  const now = performance.now();
  for (const el of document.querySelectorAll("[data-elapsed]")) {
    const t0 = busySince[el.dataset.elapsed];
    const hint = demoClock?.jobs?.[el.dataset.elapsed];
    const seconds = hint ? Math.max(0, Math.min(hint.duration_s, demoClock.elapsed_s - hint.started_s)) : (now - t0) / 1000;
    el.textContent = t0 != null ? `· ${seconds.toFixed(1)} s` : "";
  }
  $("clock").textContent = clock(new Date());
}
