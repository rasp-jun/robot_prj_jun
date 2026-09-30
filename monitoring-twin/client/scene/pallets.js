// 팔레트·전차 단계·트레이·보관창고·센서 표시등·벨트 흐름.
// 서버 스냅샷의 pallets[{id, cv, stage, ng, skip, run_no}]만 보고 그린다 (상태 계산은 서버에 있음).
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const LED_OF_CV = { 1: "Sensor_ST1_LED", 2: "Sensor_CV2_LED", 3: "Sensor_ST2_LED", 4: "Sensor_ST3_LED", 5: "Sensor_CV5_LED" };
const STAGES = ["HULL", "POWERPACK", "TURRET"];
const ease = (u) => u - Math.sin(2 * Math.PI * u) / (2 * Math.PI); // 사이클로이드 가감속 (preview_src.html과 같음)

function makeTank(spec) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.1 });
  const [hl, hh, hw] = spec.hull.size;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(hl, hh, hw), mat(spec.hull.color));
  hull.position.y = hh / 2;
  const [pl, ph, pw] = spec.powerpack.size;
  const pp = new THREE.Mesh(new THREE.BoxGeometry(pl, ph, pw), mat(spec.powerpack.color));
  pp.position.set(spec.powerpack.offset_x, hh + ph / 2, 0);
  const turret = new THREE.Group();
  const t = spec.turret;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(t.radius, t.radius * 1.1, t.height, 32), mat(t.color));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, t.barrel, 16), mat(t.color));
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(t.barrel / 2 + t.radius * 0.6, 0.004, 0);
  turret.add(body, barrel);
  turret.position.set(0.02, hh + t.height / 2, 0);
  for (const m of [hull, pp, body, barrel]) m.castShadow = m.receiveShadow = true;
  g.add(hull, pp, turret);
  g.userData = { hull, pp, turret, baseColor: new THREE.Color(spec.hull.color), ngColor: new THREE.Color(spec.ng_color) };
  return g;
}

function setTank(tank, stage, ng) {
  const k = STAGES.indexOf(stage);
  tank.visible = k >= 0;
  tank.userData.pp.visible = k >= 1;
  tank.userData.turret.visible = k >= 2;
  tank.userData.hull.material.color.copy(ng ? tank.userData.ngColor : tank.userData.baseColor);
}

export function createPallets(lineInfo, manifest) {
  const { line, root, zones, info } = lineInfo;
  const bt = info.belt_top_m;
  const pitch = info.storage_pitch;
  const moveS = manifest.motion.pallet_move_s;

  const template = line.getObjectByName("Pallet_01");
  for (const n of ["Pallet_01", "Pallet_02", "Pallet_03"]) line.getObjectByName(n).visible = false;
  const palletTop = new THREE.Box3().setFromObject(template).max.y - template.position.y;

  function newPallet(withTank) {
    const p = template.clone(true);
    p.visible = true;
    p.position.z = 0;
    if (withTank) {
      const tank = makeTank(manifest.tank);
      tank.position.y = palletTop;
      p.add(tank);
      p.userData.tank = tank;
    }
    return p;
  }

  // 벨트·드럼·롤러
  const belt = line.getObjectByName("Conveyor_Belt");
  let beltMap = null;
  belt.traverse((o) => { if (o.isMesh && o.material.map) { o.material.map.wrapS = THREE.RepeatWrapping; beltMap = o.material.map; } });
  const drums = [], rollers = [];
  line.traverse((o) => {
    if (/^Drum_/.test(o.name)) drums.push(o);
    if (/^Roller_\d+$/.test(o.name)) rollers.push(o);
  });

  // 센서 표시등 (재질을 복제해 따로 켠다)
  const leds = {};
  for (const [cv, name] of Object.entries(LED_OF_CV)) {
    line.getObjectByName(name)?.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.castShadow = false; leds[cv] = o.material; } });
  }
  let camLight = null;
  line.getObjectByName("Camera_ST3_Light")?.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); camLight = o.material; } });
  let flashT = 0;

  // 구간 라벨 (관람자 쪽 레일 앞)
  const zoneLabels = {};
  for (const [cv, z] of Object.entries(zones)) {
    const el = document.createElement("div");
    el.className = "label3d";
    const obj = new CSS2DObject(el);
    obj.position.set(z.center, bt - 0.16, 0.26);
    root.add(obj);
    zoneLabels[cv] = el;
  }

  // 트레이: 칸 3개에 전차를 채워 보여 준다 (수량은 화면 카드에 숫자로)
  const trays = {};
  for (const [key, ng] of [["pass", false], ["fail", true]]) {
    const name = key === "pass" ? "Tray_Pass" : "Tray_Fail";
    trays[key] = [1, 2, 3].map((k) => {
      const slot = line.getObjectByName(`${name}_Slot_0${k}`);
      const tank = makeTank(manifest.tank);
      setTank(tank, "TURRET", ng);
      tank.visible = false;
      slot.add(tank);
      return tank;
    });
  }

  // 보관창고: 서보가 선반 전체를 움직여 다음 빈 칸을 벨트 높이에 맞춘다
  const rack = line.getObjectByName("Storage_Rack");
  const rackY0 = rack.position.y; // 1칸이 벨트 높이일 때
  const storeSlots = [1, 2, 3].map((k) => {
    const p = newPallet(false);
    p.position.set(0, 0, 0);
    p.visible = false;
    line.getObjectByName(`Storage_Slot_0${k}`).add(p);
    return p;
  });
  const rackMove = { from: rackY0, to: rackY0, t: 1 };

  const live = new Map(); // id → { obj, cv, move:{x0,x1,t} }
  const leaving = []; // 회수 구간에서 보관창고로 들어가는 팔레트

  function update(s) {
    const seen = new Set();
    for (const p of s.pallets) {
      seen.add(p.id);
      const z = zones[p.cv];
      let e = live.get(p.id);
      if (!e) {
        const obj = newPallet(true);
        obj.position.set(z.center, bt, 0);
        root.add(obj);
        const el = document.createElement("div");
        el.className = "label3d";
        const label = new CSS2DObject(el);
        label.position.set(0, 0.24, 0);
        obj.add(label);
        e = { obj, cv: p.cv, label: el, labelObj: label, move: null };
        live.set(p.id, e);
      } else if (e.cv !== p.cv) {
        e.move = { x0: e.obj.position.x, x1: z.center, t: 0 };
        e.cv = p.cv;
      }
      setTank(e.obj.userData.tank, p.stage, p.ng);
      const tag = p.run_no != null ? `#${p.run_no}` : p.id;
      e.label.innerHTML = p.ng ? `<b>${tag}</b> 불합격${p.skip ? " · 작업 생략" : ""}` : `<b>${tag}</b>`;
    }
    for (const [id, e] of live) {
      if (seen.has(id)) continue;
      live.delete(id);
      e.obj.remove(e.labelObj); // CSS2DObject는 직접 떼어야 라벨 DOM도 사라진다
      if (e.cv === 5) leaving.push({ obj: e.obj, x0: e.obj.position.x, x1: info.storage_x, t: 0 });
      else root.remove(e.obj); // 초기화 등으로 사라진 팔레트
    }
    // 보관창고 칸과 선반 높이
    const n = s.storage.count;
    storeSlots.forEach((p, k) => (p.visible = k < n));
    const level = Math.min(n + 1, info.storage_slots);
    const to = rackY0 - (level - 1) * pitch;
    if (to !== rackMove.to) Object.assign(rackMove, { from: rack.position.y, to, t: 0 });
    // 트레이
    trays.pass.forEach((t, k) => (t.visible = k < s.trays.pass));
    trays.fail.forEach((t, k) => (t.visible = k < s.trays.fail));
    // 센서 표시등·구간 라벨
    for (const c of s.conveyors) {
      if (leds[c.cv]) leds[c.cv].emissiveIntensity = c.state === "EMPTY" ? 0.08 : 3.2;
      const z = zones[c.cv];
      if (zoneLabels[c.cv]) zoneLabels[c.cv].innerHTML = `<b>CV${c.cv}</b> ${z.role === "BUFFER" ? "버퍼" : z.role === "SURPLUS" ? "회수" : z.role} · ${c.state}`;
    }
  }

  function onEvent(ev) {
    if (ev?.type === "result") flashT = 0.35; // ST3 판정 순간 카메라 조명
  }

  function tick(dt) {
    let speed = 0;
    for (const e of live.values()) {
      if (!e.move) continue;
      e.move.t = Math.min(e.move.t + dt / moveS, 1);
      e.obj.position.x = e.move.x0 + (e.move.x1 - e.move.x0) * ease(e.move.t);
      speed = Math.max(speed, Math.abs(e.move.x1 - e.move.x0) / moveS * (1 - Math.cos(2 * Math.PI * e.move.t)));
      if (e.move.t >= 1) e.move = null;
    }
    for (let i = leaving.length - 1; i >= 0; i--) {
      const l = leaving[i];
      l.t = Math.min(l.t + dt / manifest.motion.storage_move_s, 1);
      l.obj.position.x = l.x0 + (l.x1 - l.x0) * ease(l.t);
      if (l.t >= 1) { root.remove(l.obj); leaving.splice(i, 1); }
    }
    rackMove.t = Math.min(rackMove.t + dt / manifest.motion.storage_move_s, 1);
    rack.position.y = rackMove.from + (rackMove.to - rackMove.from) * ease(rackMove.t);

    if (beltMap) beltMap.offset.x -= (speed * dt) / info.belt_tile_m;
    for (const d of drums) d.rotation.z -= (speed / 0.032) * dt;
    for (const r of rollers) r.rotation.z += (speed / 0.015) * dt;
    if (camLight) {
      flashT = Math.max(0, flashT - dt);
      camLight.emissiveIntensity = flashT > 0 ? 9 : 2;
    }
  }

  return { update, onEvent, tick };
}
