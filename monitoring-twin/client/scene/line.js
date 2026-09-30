// 렌더러·조명·후처리·카메라 시점 + 라인 GLB 불러오기.
// 렌더 스타일은 루트 CLAUDE.md "렌더 스타일"과 web/preview_src.html을 그대로 따른다.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

const STUDIO = new THREE.Color("#e4e7eb");

// 보관창고까지 보이게 원래 미리보기보다 조금 넓게 잡았다
const VIEWS = {
  front: { pos: [0.45, 2.35, 6.8], tgt: [0.45, 1.12, -0.2] }, // 라인을 화면 아래쪽에 두어 위쪽 카드와 겹치지 않게
  top: { pos: [0.351, 7.2, 0.6], tgt: [0.35, 0.6, -0.25] },
  free: { pos: [-2.8, 2.6, 4.8], tgt: [0.4, 0.62, -0.1] },
};

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.setSize(innerWidth, innerHeight);
  labels.domElement.style.cssText = "position:absolute;inset:0;pointer-events:none";
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = STUDIO;
  scene.fog = new THREE.Fog(STUDIO, 8, 18);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;

  const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 0.6;
  controls.maxDistance = 10;

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-2.4, 4.2, 3.0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3.4, right: 3.4, top: 2.4, bottom: -2.4, near: 0.5, far: 12 });
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.012;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
  fill.position.set(3, 2.5, -3);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(20, 96),
    new THREE.MeshStandardMaterial({ color: 0xdadde2, roughness: 0.94, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.12, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  gtao.blendIntensity = 0.85;
  gtao.enabled = innerWidth > 760;
  composer.addPass(gtao);
  // 임계값 1.6: 낮추면 바닥까지 번져 화면이 뿌옇게 된다 (루트 CLAUDE.md)
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.4, 1.6));
  composer.addPass(new OutputPass());

  let fly = null;
  function setView(name, instant = false) {
    const v = VIEWS[name];
    const to = { pos: new THREE.Vector3(...v.pos), tgt: new THREE.Vector3(...v.tgt) };
    if (instant) {
      camera.position.copy(to.pos);
      controls.target.copy(to.tgt);
      controls.update();
      return;
    }
    fly = { from: { pos: camera.position.clone(), tgt: controls.target.clone() }, to, t: 0 };
  }
  setView("front", true);

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    labels.setSize(innerWidth, innerHeight);
  });

  function render(dt) {
    if (fly) {
      fly.t = Math.min(fly.t + dt / 1.1, 1);
      const k = 1 - Math.pow(1 - fly.t, 3);
      camera.position.lerpVectors(fly.from.pos, fly.to.pos, k);
      controls.target.lerpVectors(fly.from.tgt, fly.to.tgt, k);
      if (fly.t >= 1) fly = null;
    }
    controls.update();
    composer.render();
    labels.render(scene, camera);
  }

  return { scene, camera, renderer, controls, setView, render, onUserOrbit: (fn) => controls.addEventListener("start", () => { fly = null; fn(); }) };
}

export async function loadLine(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const line = gltf.scene;
  line.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const root = line.getObjectByName("EV_Line");
  // 구간 좌표는 GLB의 Zone_CV# extras에서 읽는다 (코드에 적지 않음)
  const zones = {};
  line.traverse((o) => {
    const m = /^Zone_CV(\d)$/.exec(o.name);
    if (m) zones[+m[1]] = { center: o.position.x, ...o.userData };
  });
  return { line, root, zones, info: root.userData };
}
