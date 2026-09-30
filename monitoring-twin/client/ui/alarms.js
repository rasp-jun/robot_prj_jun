// 알람 카드: 활성 알람(위) + 이번 세션 이력 (W0-5). 이력은 서버 스냅샷의 최근 50건.
const $ = (id) => document.getElementById(id);
const t = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour12: false }) : "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function renderAlarms(s) {
  const active = s.alarms_active;
  const cleared = s.alarm_history.filter((a) => a.cleared_at);
  $("alarmCount").textContent = active.length ? `활성 ${active.length}건` : "활성 없음";
  $("alarmCount").style.color = active.length ? "#b91c1c" : "";
  const row = (a, on) => `<li data-active="${on}">
      <b>${esc(a.source)} · ${esc(a.code)}</b><span>${t(a.raised_at)}</span>
      <span>${esc(a.msg)}</span><span>${on ? "해제 전" : "해제 " + t(a.cleared_at)}</span>
    </li>`;
  const items = [...active.map((a) => row(a, true)), ...cleared.slice(0, 4).map((a) => row(a, false))];
  $("alarmList").innerHTML = items.length ? items.join("") : `<li class="empty">알람 이력이 없습니다</li>`;
}
