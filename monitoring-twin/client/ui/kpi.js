// 통계 페이지 (W0-7): 스코어카드. 그래프는 늘리지 않는다 — 숫자와 목표 대비 상태가 먼저 읽히게.
import { mountHeader, mountSeg, PERIODS, esc } from "./header.js";
import { setupExport } from "./export.js";

const $ = (id) => document.getElementById(id);
const TARGET = 95; // K1·K6 목표 (라인 PRD 성공 기준, %)
let period = "today";

mountHeader($("topbar"), "통계");
mountSeg($("period"), PERIODS, period, (p) => { period = p; load(); });
setupExport($("exportBtn"), () => period);

// 상태는 아이콘 + 글자로 (색만으로 구분하지 않음)
const ICON = {
  ok: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/></svg>',
};
function judge(v) {
  if (v == null) return { tone: "none", label: "데이터 없음" };
  if (v >= TARGET + 1) return { tone: "ok", label: "달성" };
  if (v >= TARGET) return { tone: "warn", label: "근접" };
  return { tone: "bad", label: "미달" };
}
const fmt = (v, d = 1) => (v == null ? "–" : v.toFixed(d));
const pct = (v) => `${Math.max(0, Math.min(100, (v - 90) * 10))}%`; // 막대 눈금 90~100%

function card({ label, value, unit, note, kpi }) {
  const j = kpi ? judge(kpi.value) : null;
  return `<section class="score" data-tone="${j?.tone ?? "plain"}">
    <div class="score-head"><span>${label}</span>${j ? `<span class="status" data-tone="${j.tone}">${ICON[j.tone === "ok" ? "ok" : "warn"] ?? ""}${j.label}</span>` : ""}</div>
    <div class="score-value"><b>${value}</b><span>${unit}</span></div>
    <div class="muted">${note}</div>
    ${kpi && kpi.value != null ? `<div class="meter"><div class="track"><i style="width:${pct(kpi.value)}"></i><em style="left:${pct(TARGET)}"></em></div>
      <div class="scale"><span>90%</span><span>목표 ${TARGET}%</span><span>100%</span></div></div>` : ""}
  </section>`;
}

async function load() {
  const s = await (await fetch(`/api/stats?period=${period}`)).json();
  const kpis = [["로봇1 파워팩 조립 성공률", s.k1_robot1], ["로봇2 포탑 조립 성공률", s.k1_robot2], ["용접 모션 완주율", s.k6_weld]];
  const perDay = s.speed_unit === "대/일";
  $("cards").innerHTML = [
    card({ label: "생산 (합격)", value: s.produced, unit: "대", note: `가동 ${s.runs}회 중` }),
    card({ label: "불량률", value: fmt(s.defect_rate), unit: "%", note: `불합격 ${s.fail}대` }),
    card({ label: perDay ? "가동일 평균 생산" : "시간당 생산", value: fmt(s.speed), unit: s.speed_unit, note: perDay ? `가동일 ${s.days}일` : "첫 가동 시작부터" }),
    ...kpis.map(([label, k]) => card({ label, value: fmt(k.value), unit: "%", note: k.tried ? `${k.done}/${k.tried} 성공` : "시도 없음", kpi: k })),
  ].join("");

  const k3ok = s.k3_p95_s != null && s.k3_p95_s <= 1;
  const [topCode, topN] = s.reasons[0] ?? ["–", 0];
  $("facts").innerHTML = [
    ["트윈 반영 지연 (95%)", s.k3_p95_s == null ? "–" : `${s.k3_p95_s.toFixed(2)} s`, s.k3_p95_s == null ? "측정값 없음" : `목표 1 s 이하 · ${k3ok ? "달성" : "미달"}`],
    ["가장 느린 위치", s.bottleneck ?? "–", s.bottleneck ? `평균 ${fmt(s.station_avg_s[s.bottleneck])} s` : ""],
    ["불량 원인 1위", topCode, topN ? `${topN}건` : ""],
  ].map(([l, v, n]) => `<div class="fact"><span class="muted">${l}</span><b>${esc(v)}</b><span class="muted small">${n}</span></div>`).join("");

  const judged = [...kpis.map(([, k]) => judge(k.value).tone), s.k3_p95_s == null ? "none" : k3ok ? "ok" : "bad"];
  $("goal").innerHTML = `<b class="t-ok">목표 달성 ${judged.filter((t) => t === "ok").length}</b> · <b class="t-warn">근접 ${judged.filter((t) => t === "warn").length}</b> / 4개`;
  $("range").textContent = { today: `${new Date().toLocaleDateString("en-CA")} 오늘`, week: "오늘 포함 최근 7일", all: "전체 기록" }[period];
}

load();
setInterval(load, 5000); // 가동이 끝날 때마다 바뀌므로 5초마다 갱신
