// 기록 페이지 (W0-6 가동 기록, W0-5 알람 이력). 5초마다 갱신, 선택한 행은 유지.
import { mountHeader, mountSeg, PERIODS, esc, hms } from "./header.js";
import { setupExport } from "./export.js";

const $ = (id) => document.getElementById(id);
const st = { tab: "runs", verdict: "all", period: "today", selected: null, runs: [] };

mountHeader($("topbar"), "기록");
mountSeg($("tabs"), [["runs", "가동 기록"], ["alarms", "알람 이력"]], st.tab, (t) => { st.tab = t; show(); load(); });
mountSeg($("period"), PERIODS, st.period, (p) => { st.period = p; load(); });
mountSeg($("verdict"), [["all", "전체"], ["ok", "합격"], ["ng", "불합격"]], st.verdict, (v) => { st.verdict = v; load(); });
setupExport($("exportBtn"), () => st.period);

// 오늘이면 시각만, 여러 날이면 날짜도
const when = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return st.period === "today" ? hms(d) : `${d.toLocaleDateString("en-CA").slice(5)} ${hms(d)}`;
};
const sec = (v) => (v > 0 ? v.toFixed(1) : "—");
const span = (a, b) => {
  if (!a || !b) return "—";
  const s = Math.round((new Date(b) - new Date(a)) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// 가동 1건의 진행 과정: 기록된 작업 결과(jobs)로 다시 그린다
const STEPS = [
  ["ROBOT1_HULL_PLACE", "ST1 하부 차체 투입", "ST1"],
  ["ROBOT1_POWERPACK_MOUNT", "ST1 파워팩 조립", "ST1"],
  ["ROBOT2_TURRET_MATE", "ST2 포탑 결합", "ST2"],
  ["ROBOT2_WELD_MOTION", "ST2 용접 모션", "ST2"],
];
function steps(r) {
  const out = STEPS.map(([job, label]) => {
    const s = r.jobs[job];
    if (s === "DONE") return { tone: "ok", label, meta: job };
    if (s === "ERR") return { tone: "bad", label: `${label} 실패`, meta: `${job} · ERR` };
    return { tone: "skip", label, meta: r.ng ? "작업 생략 (조기 차단)" : "기록 없음" };
  });
  if (r.times.ST1 > 0) out[1].meta += ` · ST1 ${sec(r.times.ST1)} s`;
  if (r.times.ST2 > 0) out[3].meta += ` · ST2 ${sec(r.times.ST2)} s`;
  out.push({ tone: r.ng ? "bad" : "ok", label: "ST3 판정", meta: r.ng ? `불합격 · ${r.reason ?? "사유 없음"}` : "합격" });
  out.push({ tone: r.jobs.ROBOT3_SORT === "DONE" ? "ok" : "skip", label: r.ng ? "불합격 트레이로 분류" : "합격 트레이로 분류", meta: `ROBOT3_SORT · ST3 ${sec(r.times.ST3)} s` });
  out.push({ tone: "ok", label: "보관창고", meta: `${when(r.finished_at)} 입고` });
  return out;
}

function renderDetail() {
  const r = st.runs.find((x) => key(x) === st.selected) ?? st.runs[0];
  if (!r) { $("detail").innerHTML = `<p class="muted">이 기간에 끝난 가동이 없습니다.</p>`; return; }
  $("detail").innerHTML = `
    <div class="detail-head"><b>#${r.run_no ?? "?"}</b><span class="verdict" data-ng="${r.ng}">${r.ng ? "불합격 · " + esc(r.reason ?? "") : "합격"}</span></div>
    <div class="muted small">팔레트 ${esc(r.pallet)} · ${when(r.started_at)} 시작 · 소요 ${span(r.started_at, r.finished_at)}</div>
    <ol class="timeline">${steps(r).map((s) => `<li data-tone="${s.tone}"><b>${esc(s.label)}</b><span>${esc(s.meta)}</span></li>`).join("")}</ol>`;
}

const key = (r) => `${r.run_no}|${r.finished_at}`;

async function load() {
  if (st.tab === "runs") {
    st.runs = await (await fetch(`/api/runs?period=${st.period}&verdict=${st.verdict}&limit=500`)).json();
    $("runRows").innerHTML = st.runs.map((r) => `
      <button type="button" class="trow runs-cols" data-key="${esc(key(r))}" aria-pressed="${key(r) === st.selected}">
        <span><b>#${r.run_no ?? "?"}</b></span><span>${when(r.started_at)}</span><span>${when(r.finished_at)}</span>
        <span class="verdict" data-ng="${r.ng}">${r.ng ? "불합격" : "합격"}</span><span class="small">${esc(r.reason ?? "—")}</span>
        <span class="num">${sec(r.times.ST1)}</span><span class="num">${sec(r.times.ST2)}</span><span class="num">${sec(r.times.ST3)}</span>
        <span class="num">${span(r.started_at, r.finished_at)}</span>
      </button>`).join("") || `<p class="empty muted">이 기간에 끝난 가동이 없습니다.</p>`;
    $("runFoot").textContent = `${st.runs.length}건 · 작업 시간은 초 단위 (로봇 BUSY → DONE)${st.runs.length === 500 ? " · 최근 500건만 표시, 전체는 내보내기로" : ""}`;
    renderDetail();
  } else {
    const alarms = await (await fetch(`/api/alarms?period=${st.period}`)).json();
    $("alarmRows").innerHTML = alarms.map((a) => `
      <div class="trow alarm-cols" data-active="${!a.cleared_at}">
        <span>${when(a.raised_at)}</span><span>${a.cleared_at ? when(a.cleared_at) : "해제 전"}</span>
        <span>${a.cleared_at ? Math.round((new Date(a.cleared_at) - new Date(a.raised_at)) / 1000) + " s" : "—"}</span>
        <span><b>${esc(a.source)}</b></span><span class="small">${esc(a.code)}</span><span>${esc(a.msg ?? "")}</span>
      </div>`).join("") || `<p class="empty muted">이 기간에 알람이 없습니다.</p>`;
  }
}

$("runRows").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-key]");
  if (!b) return;
  st.selected = b.dataset.key;
  $("runRows").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  renderDetail();
});

function show() {
  $("runsView").hidden = st.tab !== "runs";
  $("alarmsView").hidden = st.tab !== "alarms";
  $("verdict").hidden = st.tab !== "runs";
}

show();
load();
setInterval(load, 5000);
