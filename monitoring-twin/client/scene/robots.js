// Indy7 3대 + 스테이션 상태 링. web/preview_src.html의 createIndy7Factory(digital_twin2 포팅)를 가져왔다.
// 관절은 아직 실제 값을 받지 않는다(W1-1). 상태에 따라 대기 자세 ↔ 작업 자세를 오가는 표시용 동작만 한다.
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import URDFLoader from "urdf-loader";

const JOINTS = ["joint0", "joint1", "joint2", "joint3", "joint4", "joint5"];
const D2R = Math.PI / 180;
const READY_POSE = [0, 0, -90, 0, -90, 0];
// 팔레트 중심 위 TCP (preview_src.html에서 FK로 구한 값)
const WORK_POSE = {
  1: [23, -32, -99, 0, -64, 0],
  2: [23, -32, -99, 0, -64, 0],
  3: [23, -37, -100, 0, -60, 0],
};
const SWEEP = { ROBOT2_WELD_MOTION: 14 }; // 용접 모션: joint0 좌우 스윕 (deg)
const RING = {
  READY: new THREE.Color("#9aa1a9"),
  BUSY: new THREE.Color(1.0, 0.55, 0.08),
  DONE: new THREE.Color(0.15, 1.0, 0.45),
  ERR: new THREE.Color(1.0, 0.12, 0.08),
};

async function loadIndy7Factory(urdfUrl, meshBase) {
  const urdf = await (await fetch(urdfUrl)).text();
  const names = [...new Set([...urdf.matchAll(/filename="([^"]+)"/g)].map((m) => m[1].split("/").pop()))];
  const stl = new STLLoader();
  const geoms = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await stl.loadAsync(meshBase + n)])));
  const material = new THREE.MeshStandardMaterial({ color: 0xf1f2f4, metalness: 0.1, roughness: 0.42 });
  const loader = new URDFLoader();
  loader.parseCollision = false;
  loader.loadMeshCb = (path, manager, done) => {
    const g = geoms[path.split("/").pop()];
    if (g) done(new THREE.Mesh(g, material));
    else done(null, new Error(`Indy7 메시 없음: ${path}`));
  };
  return () => {
    const robot = loader.parse(urdf);
    robot.rotation.x = -Math.PI / 2; // URDF Z-up → three.js Y-up
    robot.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material !== material) { o.material.dispose(); o.material = material; }
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return robot;
  };
}

export async function createRobots(line, manifest) {
  const make = await loadIndy7Factory(manifest.models.indy7, manifest.models.indy7_meshes);
  const robots = {};
  for (const i of [1, 2, 3]) {
    const mount = line.getObjectByName(`Robot_Mount_ST${i}`);
    const obj = make();
    const rig = new THREE.Group();
    rig.name = `Indy7_ST${i}`;
    rig.rotation.y = -Math.PI / 2; // 베이스 정면을 컨베이어 쪽으로
    rig.add(obj);
    mount.add(rig);

    let ring = null;
    line.getObjectByName(`Status_Ring_ST${i}`).traverse((o) => { if (o.isMesh) { o.castShadow = false; ring = o.material; } });

    const el = document.createElement("div");
    el.className = "label3d";
    el.innerHTML = `<b>ST${i}</b> · 로봇${i}`;
    const label = new CSS2DObject(el);
    label.position.set(0, 1.12, 0);
    mount.add(label);

    robots[i] = { obj, ring, q: READY_POSE.slice(), state: "READY", job: null, t: 0 };
  }

  function setJoints(r, q) {
    JOINTS.forEach((n, k) => r.obj.joints[n]?.setJointValue(q[k] * D2R));
  }
  Object.values(robots).forEach((r) => setJoints(r, r.q));

  const target = [0, 0, 0, 0, 0, 0];
  return {
    robots, // 디버깅용 (twin.scene3d.robots.robots[1].q)
    update(snapshot) {
      for (const s of snapshot.robots) {
        const r = robots[s.robot];
        if (r.state !== s.state || r.job !== s.job) r.t = 0;
        r.state = s.state;
        r.job = s.job;
      }
    },
    tick(dt, time) {
      for (const [i, r] of Object.entries(robots)) {
        r.t += dt;
        // 링: BUSY는 은은하게, ERR는 빠르게 깜빡임
        const pulse = r.state === "ERR" ? 0.55 + 0.45 * Math.sin(time * 7) : r.state === "BUSY" ? 0.8 + 0.2 * Math.sin(time * 3) : 1;
        r.ring.emissive.copy(RING[r.state] ?? RING.READY);
        r.ring.emissiveIntensity = (r.state === "READY" ? 0.6 : 3) * pulse;
        if (r.state === "ERR") continue; // 오류가 난 자세 그대로 멈춤

        if (r.state === "BUSY") {
          const k = 0.5 - 0.5 * Math.cos(Math.min(r.t / 1.2, 1) * Math.PI); // 1.2초에 걸쳐 작업 자세로
          for (let j = 0; j < 6; j++) target[j] = READY_POSE[j] + (WORK_POSE[i][j] - READY_POSE[j]) * k;
          target[0] += (SWEEP[r.job] ?? 0) * Math.sin(r.t * 2.2) * k;
        } else {
          target.splice(0, 6, ...READY_POSE);
        }
        const a = 1 - Math.exp(-dt * 4);
        for (let j = 0; j < 6; j++) r.q[j] += (target[j] - r.q[j]) * a;
        setJoints(r, r.q);
      }
    },
  };
}
