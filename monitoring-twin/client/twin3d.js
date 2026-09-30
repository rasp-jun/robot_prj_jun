// 3D 트윈: 무대 + 라인 GLB + 로봇 + 팔레트를 만들고 렌더 루프를 돌린다. main.js가 동적으로 불러온다.
import * as THREE from "three";
import { createStage, loadLine } from "./scene/line.js";
import { createRobots } from "./scene/robots.js";
import { createPallets } from "./scene/pallets.js";

export async function startTwin(container) {
  const stage = createStage(container);
  const views = [...document.querySelectorAll(".views button")];
  views.forEach((b) => b.addEventListener("click", () => {
    views.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    stage.setView(b.dataset.view);
  }));
  stage.onUserOrbit(() => views.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.view === "free"))));

  const manifest = await (await fetch("/assets/manifest.json")).json();
  const lineInfo = await loadLine(manifest.models.line);
  stage.scene.add(lineInfo.line);
  const robots = await createRobots(lineInfo.line, manifest);
  const pallets = createPallets(lineInfo, manifest);

  // 렌더 루프 (fps 표시: M6 30 fps 확인용)
  const fpsEl = document.getElementById("fps");
  const clock = new THREE.Clock();
  let frames = 0, fpsT = 0;
  (function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    robots.tick(dt, clock.elapsedTime);
    pallets.tick(dt);
    stage.render(dt);
    frames++;
    fpsT += dt;
    if (fpsT >= 1) {
      fpsEl.textContent = `${frames} fps`;
      frames = 0;
      fpsT = 0;
    }
    requestAnimationFrame(frame);
  })();

  return {
    robots, // 디버깅용
    update(snapshot, event) {
      robots.update(snapshot);
      pallets.update(snapshot);
      if (event) pallets.onEvent(event);
    },
  };
}
