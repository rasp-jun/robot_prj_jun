// 통계·기록 페이지 공통 상단: 제목, 페이지 메뉴, 라인 상태, 시계. 라인 상태는 3초마다 /api/snapshot으로 갱신.
const PAGES = [["./", "트윈"], ["stats.html", "통계"], ["records.html", "기록"]];
const LINE_TONE = { RUN: "ok", PAUSE: "warn", STOP: "muted", ESTOP: "bad" };
export const hms = (d) => d.toLocaleTimeString("en-GB", { hour12: false });

export function mountHeader(el, current) {
  el.innerHTML = `
    <div class="brand"><span class="eyebrow">전차 모형 조립·검사 라인</span><span class="brand-name">모니터링 트윈</span></div>
    <nav class="nav" aria-label="페이지">${PAGES.map(([href, name]) =>
      `<a href="${href}"${name === current ? ' aria-current="page"' : ""}>${name}</a>`).join("")}</nav>
    <span class="pill line-pill" data-tone="muted">–</span>
    <time class="clock">--:--:--</time>`;
  const pill = el.querySelector(".line-pill");
  const clock = el.querySelector(".clock");
  async function poll() {
    try {
      const s = await (await fetch("/api/snapshot")).json();
      const state = s.link.gateway ? s.line.state : "확인 불가";
      pill.dataset.tone = s.link.gateway ? LINE_TONE[state] : "muted";
      pill.textContent = state;
    } catch {
      pill.dataset.tone = "muted";
      pill.textContent = "서버 연결 끊김";
    }
  }
  poll();
  setInterval(poll, 3000);
  setInterval(() => (clock.textContent = hms(new Date())), 1000);
}

// 기간 선택 버튼 묶음 (오늘 / 최근 7일 / 전체)
export const PERIODS = [["today", "오늘"], ["week", "최근 7일"], ["all", "전체"]];
export function mountSeg(el, options, value, onChange) {
  el.innerHTML = options.map(([id, label]) => `<button type="button" data-id="${id}" aria-pressed="${id === value}">${label}</button>`).join("");
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    onChange(b.dataset.id);
  });
}

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
