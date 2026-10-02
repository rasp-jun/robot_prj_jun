// 3D 트윈: 무대 + 라인 GLB + 로봇 + 팔레트를 만들고 렌더 루프를 돌린다. main.js가 동적으로 불러온다.
import * as THREE from "three";
import { createStage, loadLine } from "./scene/line.js";
import { createRobots } from "./scene/robots.js";
import { createPallets } from "./scene/pallets.js";
import {SceneSequencer,transitionWait,motionPermitted} from './scene/sequencer.js';
import { initExperience } from "./ui/experience.js";

export async function startTwin(container,{onPresentation=()=>{}}={}) {
  const stage = createStage(container);
  const views = [...document.querySelectorAll(".views button[data-view]")];
  views.forEach((b) => b.addEventListener("click", () => {
    views.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    stage.setView(b.dataset.view);
    document.getElementById("viewName").textContent = { front: "정면 시점", top: "탑 뷰", free: "입체 시점" }[b.dataset.view];
  }));
  stage.onUserOrbit(() => {
    views.forEach((x) => x.setAttribute("aria-pressed", "false"));
    document.getElementById("viewName").textContent = "자유 시점";
  });

  const manifest = await (await fetch("/assets/manifest.json")).json();
  const lineInfo = await loadLine(manifest.models.line);
  stage.scene.add(lineInfo.line);
  function focusStation(station) {
    const mount = lineInfo.line.getObjectByName(`Robot_Mount_ST${station}`);
    const center = mount.getWorldPosition(new THREE.Vector3());
    stage.setView({pos:[center.x+.4,2.0,2.7],tgt:[center.x,.95,-.2]});
    views.forEach((b)=>b.setAttribute("aria-pressed","false"));
    document.getElementById("viewName").textContent=`ST${station} 작업 확대`;
  }
  document.getElementById("robots").addEventListener("click",e=>{
    const button=e.target.closest('[data-focus-st]');if(button)focusStation(Number(button.dataset.focusSt));
  });
  const pallets = createPallets(lineInfo, manifest);
  const robots = await createRobots(lineInfo.line, manifest, pallets);
  const experience=initExperience({robots,focusStation,stage});
  const sequence=new SceneSequencer({
    wait:(before,next)=>transitionWait(before,next,robots.robots,pallets.transporting()),
    apply:(snapshot,playback,event,reset)=>{
      pallets.update(snapshot,playback,reset);
      robots.update(snapshot,playback,reset);
      robots.setDynamic(pallets.colliders());
      if(event)pallets.onEvent(event);
    },
  });
  let presentedSeq=null;
  let motionEnabled = false;
  let speed = 1, generation = null, lastSeq = -1;
  // Returning to the tab preserves the stopped pose and queued visual transitions.

  // 렌더 루프 (fps 표시: M6 30 fps 확인용)
  const fpsEl = document.getElementById("fps");
  const clock = new THREE.Clock();
  let frames = 0, fpsT = 0;
  (function frame() {
    const elapsed = clock.getDelta();
    const dt = Math.min(elapsed, 0.05);
    const steps=Math.max(1,Math.ceil(dt*speed/.016)),step=dt*speed/steps;
    for(let i=0;i<steps;i++){
      robots.tick(step,clock.elapsedTime,motionEnabled);
      if(motionEnabled){
        const allowed=pallets.previewTransport(step,()=>robots.allowTransport());
        pallets.tick(step,robots.carryPose(),allowed);
        sequence.flush();
      }
    }
    if(sequence.current?.seq!==presentedSeq){presentedSeq=sequence.current?.seq;onPresentation();}
    experience.tick(elapsed);
    if(sequence.reason){
      const status=document.getElementById('safetyStatus');
      if(!Object.values(robots.robots).some(r=>r.blocked)){status.textContent=sequence.reason+' · 이송 인터록';status.dataset.blocked='false';}
    }
    stage.render(dt);
    frames++;
    fpsT += elapsed;
    if (fpsT >= 1) {
      fpsEl.textContent = `${Math.round(frames / fpsT)} fps`;
      frames = 0;
      fpsT = 0;
    }
    requestAnimationFrame(frame);
  })();

  return {
    robots, // 디버깅용
    presentation:()=>sequence.current,
    update(snapshot, event, { online = true, playback = null } = {}) {
      const reset = lastSeq < 0 || snapshot.seq < lastSeq || generation !== (playback?.generation ?? null);
      lastSeq = snapshot.seq;
      generation = playback?.generation ?? null;
      speed = playback?.speed ?? 1;
      const wasEnabled = motionEnabled;
      motionEnabled = motionPermitted(snapshot,{online,playback});
      robots.setSafety(snapshot);
      sequence.push(snapshot,playback,event,reset);
      if (motionEnabled && !wasEnabled && !reset) pallets.resume();

    },
  };
}
