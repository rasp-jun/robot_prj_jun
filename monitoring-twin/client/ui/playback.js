const $ = (id) => document.getElementById(id);
const NAMES = {normal:"정상 조립 · 검사",robot1_err:"로봇 1 오류",estop:"비상정지 · 복구",link_lost:"통신 끊김 · 복구"};
let current = null, connected = false, pending = false, generation = null;
const clock = (seconds) => {
  const value = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2,"0")}`;
};

export function renderPlayback(state, online) {
  current = state; connected = online;
  if (!state) return;
  const first = generation !== state.generation;
  generation = state.generation;
  if (first && $("demoScenario").options.length) $("demoScenario").value = state.scenario;
  if (!pending) {
    if (document.activeElement !== $("demoSpeed")) $("demoSpeed").value = String(state.speed);
    $("demoLoop").checked = state.loop;
  }
  const paused = state.state === "PAUSED";
  $("demoPause").textContent = paused ? "계속 재생" : "일시정지";
  $("demoPause").disabled = pending || !online || !["PLAYING","PAUSED"].includes(state.state);
  $("demoPlay").disabled = pending || !online;
  $("playbackState").textContent = !online ? "연결 복구 대기" :
    `${{PLAYING:"재생 중",PAUSED:"일시정지",COMPLETED:"재생 완료"}[state.state] ?? "대기"} · ${state.cycle}회차 · ${NAMES[state.scenario] ?? state.scenario}`;
  $("playbackTime").textContent = `${clock(state.elapsed_s)} / ${clock(state.duration_s)}`;
  $("demoProgress").value = state.duration_s ? Math.min(100,state.elapsed_s/state.duration_s*100) : 0;
  document.body.classList.toggle("simulation-paused",paused);
}

async function request(path, body) {
  if (pending) return;
  pending=true;
  $("demoFeedback").dataset.error="false";
  renderPlayback(current,connected);
  try {
    const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result=await response.json();
    if (result.generation != null) current=result;
    $("demoFeedback").textContent=path.endsWith("/play") ? "시나리오를 처음부터 재생합니다. 완료된 가동 기록은 유지됩니다." :
      body.action==="pause" ? "공정 시계와 3D 동작을 함께 멈췄습니다." : body.action==="resume" ? "멈춘 위치에서 부드럽게 재개합니다." : "재생 설정을 적용했습니다.";
  } catch {
    $("demoFeedback").dataset.error="true";
    $("demoFeedback").textContent="재생 요청을 확인하지 못했습니다. 연결을 확인하고 다시 시도하세요.";
  } finally {
    pending=false; renderPlayback(current,connected);
  }
}

export async function initPlayback() {
  $("demoPlay").addEventListener("click",()=>request("/api/mock/play",{scenario:$("demoScenario").value,speed:+$("demoSpeed").value,loop:$("demoLoop").checked}));
  $("demoPause").addEventListener("click",()=>request("/api/mock/control",{action:current?.state==="PAUSED"?"resume":"pause"}));
  $("demoSpeed").addEventListener("change",()=>request("/api/mock/control",{action:"configure",speed:+$("demoSpeed").value}));
  $("demoLoop").addEventListener("change",()=>request("/api/mock/control",{action:"configure",loop:$("demoLoop").checked}));
  async function load() {
    try {
      const response=await fetch("/api/mock/scenarios",{signal:AbortSignal.timeout(5000)});
      if (response.status===404) { $("sourceTag").textContent="MONITOR / 읽기 전용"; return; }
      if (!response.ok) throw new Error("scenario list");
      const names=await response.json();
      $("demoScenario").replaceChildren(...names.map((name)=>new Option(NAMES[name]??name,name,false,name===(current?.scenario??"normal"))));
      $("sourceTag").textContent="DEMO / 모의 데이터";
      $("sourceTag").dataset.source="mock";
      $("demo").hidden=false;
      renderPlayback(current,connected);
    } catch {
      $("sourceTag").textContent="모드 확인 재시도 중";
      setTimeout(load,5000);
    }
  }
  await load();
}
