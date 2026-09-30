// 데이터 내보내기 패널 (통계·기록 공통). 항목 × 기간을 골라 CSV(여러 개면 zip)로 받는다.
import { PERIODS, mountSeg } from "./header.js";

const ITEMS = [
  ["runs", "가동 기록", "가동 순번·시각·판정·NG 사유·위치별 작업 시간", true],
  ["alarms", "알람 이력", "발생·해제 시각, 출처, 코드, 내용", true],
  ["kpi", "KPI 요약", "K1 조립 성공률, K3 반영 지연, K5 작업 시간, K6 용접 완주율", false],
  ["events", "이벤트 원본", "게이트웨이 이벤트 전체 (디버깅·리플레이용)", false],
];

export function setupExport(openButton, getPeriod) {
  const dlg = document.createElement("dialog");
  dlg.className = "export";
  dlg.setAttribute("aria-label", "데이터 내보내기");
  dlg.innerHTML = `
    <form method="dialog" class="export-body">
      <div class="export-head"><h2>데이터 내보내기</h2>
        <button value="close" class="icon" aria-label="닫기"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg></button></div>
      <fieldset><legend>항목</legend>${ITEMS.map(([id, label, desc, on]) => `
        <label class="check"><input type="checkbox" name="item" value="${id}"${on ? " checked" : ""}>
          <span><b>${label}</b><small>${desc}</small></span></label>`).join("")}
      </fieldset>
      <fieldset><legend>기간</legend><div class="seg" data-role="period"></div></fieldset>
      <div><div class="muted small">형식</div><div>CSV · UTF-8 (Excel에서 한글이 깨지지 않게 BOM 포함). 여러 항목은 zip으로 묶음</div></div>
      <p class="summary-box" data-role="summary">…</p>
      <div class="export-foot">
        <button value="close" class="btn ghost">취소</button>
        <a class="btn" data-role="download" download>내보내기</a>
      </div>
    </form>`;
  document.body.appendChild(dlg);

  const summary = dlg.querySelector('[data-role="summary"]');
  const download = dlg.querySelector('[data-role="download"]');
  let period = "today";
  const chosen = () => [...dlg.querySelectorAll('input[name="item"]:checked')].map((i) => i.value);

  async function refresh() {
    const items = chosen();
    download.toggleAttribute("aria-disabled", !items.length);
    download.href = items.length ? `/api/export?period=${period}&items=${items.join(",")}` : "#";
    download.textContent = items.length > 1 ? `${items.length}개 항목 zip으로 내보내기` : "CSV 내보내기";
    if (!items.length) { summary.textContent = "항목을 하나 이상 고르세요"; return; }
    const n = await (await fetch(`/api/export/preview?period=${period}`)).json();
    const rows = { runs: `${n.runs}행`, alarms: `${n.alarms}행`, kpi: "1행", events: `${n.events.toLocaleString()}행` };
    summary.textContent = items.map((i) => `${ITEMS.find((x) => x[0] === i)[1]} ${rows[i]}`).join(" · ");
  }
  mountSeg(dlg.querySelector('[data-role="period"]'), PERIODS, period, (p) => { period = p; refresh(); });
  dlg.addEventListener("change", refresh);
  download.addEventListener("click", (e) => {
    if (download.hasAttribute("aria-disabled")) { e.preventDefault(); return; }
    setTimeout(() => dlg.close(), 300);
  });

  openButton.addEventListener("click", () => {
    period = getPeriod();
    dlg.querySelectorAll('[data-role="period"] button').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === period)));
    refresh();
    dlg.showModal();
  });
}
