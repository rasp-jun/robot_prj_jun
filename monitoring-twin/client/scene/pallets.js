// 팔레트·전차 단계·트레이·보관창고·센서 표시등·벨트 흐름.
// 서버 스냅샷의 pallets[{id, cv, stage, ng, skip, run_no}]만 보고 그린다 (상태 계산은 서버에 있음).
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { JointMotion, smooth } from "./motion.js";

const LED_OF_CV = { 1: "Sensor_ST1_LED", 2: "Sensor_CV2_LED", 3: "Sensor_ST2_LED", 4: "Sensor_ST3_LED", 5: "Sensor_CV5_LED" };
const STAGES = ["HULL", "POWERPACK", "TURRET"];

export function makeTank(spec) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.1 });
  const [hl, hh, hw] = spec.hull.size;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(hl, hh, hw), mat(spec.hull.color));
  hull.position.y = hh / 2;
  // Lightweight illustrative tracks and road wheels; the design team's source assets stay untouched.
  const trackMaterial = mat("#282e2d");
  const wheelMaterial = mat("#606951");
  const trackGeometry = new THREE.BoxGeometry(hl * 1.06, hh * .7, .018);
  const wheelGeometry = new THREE.CylinderGeometry(hh * .28, hh * .28, .02, 12);
  for (const side of [-1, 1]) {
    const track = new THREE.Mesh(trackGeometry, trackMaterial);
    track.position.set(0, -hh * .15, side * (hw / 2 + .008));
    hull.add(track);
    for (let n = 0; n < 6; n++) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set((n / 5 - .5) * hl * .86, -hh * .15, side * (hw / 2 + .013));
      hull.add(wheel);
    }
  }

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

function disposeTank(tank) {
  if (!tank) return;
  const geometries = new Set(), materials = new Set();
  tank.traverse((o) => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
const clampCount = (n, capacity) => Math.max(0, Math.min(capacity, n));

export function createPallets(lineInfo, manifest) {
  const { line, root, zones, info } = lineInfo;
  const bt = info.belt_top_m;
  const template = line.getObjectByName("Pallet_01");
  for (const name of ["Pallet_01", "Pallet_02", "Pallet_03"]) line.getObjectByName(name).visible = false;
  const palletTop = new THREE.Box3().setFromObject(template).max.y - template.position.y;
  function newPallet(withTank) {
    const p = template.clone(true);
    p.visible = true; p.position.z = 0;
    if (withTank) {
      const tank = makeTank(manifest.tank);
      tank.position.y = palletTop;
      p.add(tank); p.userData.tank = tank;
    }
    return p;
  }
  function removePallet(obj) {
    obj.parent?.remove(obj);
    disposeTank(obj.userData.tank);
  }
  const belt = line.getObjectByName("Conveyor_Belt");
  let beltMap = null;
  belt.traverse((o) => { if (o.isMesh && o.material.map) { o.material.map.wrapS = THREE.RepeatWrapping; beltMap = o.material.map; } });
  const drums = [], rollers = [];
  line.traverse((o) => {
    if (/^Drum_/.test(o.name)) drums.push(o);
    if (/^Roller_\d+$/.test(o.name)) rollers.push(o);
  });
  const leds = {};
  for (const [cv, name] of Object.entries(LED_OF_CV)) {
    line.getObjectByName(name)?.traverse((o) => {
      if (o.isMesh) { o.material = o.material.clone(); o.castShadow = false; leds[cv] = o.material; }
    });
  }
  let camLight = null;
  line.getObjectByName("Camera_ST3_Light")?.traverse((o) => {
    if (o.isMesh) { o.material = o.material.clone(); camLight = o.material; }
  });
  let flashT = 0;
  const zoneLabels = {};
  for (const [cv,z] of Object.entries(zones)) {
    const el = document.createElement("div");
    el.className = "label3d zone-label";
    el.textContent = `CV${cv}`;
    const label = new CSS2DObject(el);
    label.position.set(z.center, bt - .16, .26);
    root.add(label); zoneLabels[cv] = el;
  }
  const traySlots = {}, trays = {};
  for (const [key,ng] of [["pass",false],["fail",true]]) {
    const name = key === "pass" ? "Tray_Pass" : "Tray_Fail";
    traySlots[key] = [1,2,3].map((k) => line.getObjectByName(`${name}_Slot_0${k}`));
    trays[key] = traySlots[key].map((slot) => {
      const tank = makeTank(manifest.tank);
      setTank(tank,"TURRET",ng); tank.visible = false; slot.add(tank); return tank;
    });
  }
  const rack = line.getObjectByName("Storage_Rack");
  const rackY0 = rack.position.y;
  const storeAnchors = [1,2,3].map((k) => line.getObjectByName(`Storage_Slot_0${k}`));
  const storeSlots = storeAnchors.map((slot) => {
    const p = newPallet(false); p.position.set(0,0,0); p.visible=false; slot.add(p); return p;
  });
  let rackMotion = new JointMotion([rackY0]);
  let targetStorage = 0, previousStorage = 0;
  let trayCounts = {pass:0, fail:0};
  let sortConnected = true;
  const assemblyState=new Map();
  const live = new Map(), leaving = [], sorting = [];
  const rootPoint = (object) => {
    root.updateWorldMatrix(true,true);
    return root.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
  };

  function clear() {
    for (const e of live.values()) { e.obj.remove(e.labelObj); removePallet(e.obj); }
    live.clear();assemblyState.clear();
    leaving.splice(0).forEach((e) => removePallet(e.obj));
    sorting.splice(0).forEach((e) => { root.remove(e.obj); disposeTank(e.obj); });
  }

  function update(s, playback, reset = false) {
    if (reset) clear();
    const count = clampCount(s.storage.count,storeSlots.length);
    const robot3 = s.robots.find((r)=>r.robot===3);
    sortConnected = s.link.robots[2];
    const source = [...live.values()].find((e)=>e.cv===4 && e.stage);
    const verdict = s.pallets.find((p)=>p.cv===4)?.ng;
    // Pick-up begins during SORT, then the visible product follows a lifted path to the tray.
    if (!reset && source && robot3?.state === "BUSY" && robot3.job === "ROBOT3_SORT"
      && !sorting.some((e)=>e.source===source)) {
      const key=verdict===false?"pass":"fail", slot=clampCount(s.trays[key],trays[key].length);
      if (slot<trays[key].length && !source.sorted) {
        const hint=playback?.jobs?.[3];
        const duration=hint?Math.max(.3,hint.duration_s-Math.max(0,playback.elapsed_s-hint.started_s)):4;
        const obj=makeTank(manifest.tank); setTank(obj,source.stage,key==="fail");
        const from=rootPoint(source.obj.userData.tank),to=rootPoint(traySlots[key][slot]);
        obj.position.copy(from);obj.visible=false;root.add(obj);
        sorting.push({obj,from,to,t:0,duration:duration*.54,delay:duration*.4,key,slot,stage:source.stage,source,confirmed:false});
        source.sorted=true;
      }
    }
    if (robot3?.state==="ERR") {
      for(let i=sorting.length-1;i>=0;i--) {
        const e=sorting[i]; if(e.confirmed)continue;
        if(e.source){e.source.carried=false;e.source.sorted=false;}
        root.remove(e.obj);disposeTank(e.obj);sorting.splice(i,1);
      }
    }
    // Sorting starts at the displayed product pose; the tray only fills after the transfer lands.
    for (const key of ["pass","fail"]) {
      const n = clampCount(s.trays[key],trays[key].length);
      const before = clampCount(trayCounts[key],trays[key].length);
      sorting.filter((e)=>e.key===key&&e.slot<n).forEach((e)=>{e.confirmed=true;});
      if (!reset && n > before && !sorting.some((e)=>e.key===key&&e.slot===n-1)) {
        const source = [...live.values()].find((e) => e.cv === 4 && e.stage);
        if (source) {
          const obj = makeTank(manifest.tank);
          setTank(obj,source.stage,key === "fail");
          const from = rootPoint(source.obj.userData.tank);
          const to = rootPoint(traySlots[key][n-1]);
          obj.position.copy(from); root.add(obj);
          sorting.push({obj,from,to,t:0,duration:manifest.motion.sort_move_s ?? .8,delay:0,key,slot:n-1,stage:source.stage,confirmed:true});
        }
      }
      trays[key].forEach((tank,k) => {
        const pending = sorting.some((x) => x.key === key && x.slot === k);
        tank.visible = k < n && !pending;
        if (reset) setTank(tank,"TURRET",key === "fail");
        if (reset) tank.visible = k < n;
      });
    }
    trayCounts = {...s.trays};
    const seen = new Set();
    for (const p of s.pallets) {
      seen.add(p.id);
      const zone = zones[p.cv];
      let e = live.get(p.id);
      if (!e) {
        const obj = newPallet(true);
        const arriving = !reset && p.cv === 1 && s.conveyors.find((c) => c.cv === 1)?.state === "ARRIVING";
        obj.position.set(arriving ? zone.center - .42 : zone.center,bt,0);
        root.add(obj);
        const label = document.createElement("div"); label.className="label3d";
        const labelObj = new CSS2DObject(label); labelObj.position.set(0,.24,0); obj.add(labelObj);
        e = {obj,cv:p.cv,label,labelObj,stage:p.stage,motion:new JointMotion(obj.position.toArray())};
        if (arriving) e.motion.path([{q:[zone.center,bt,0],seconds:playback?.transfers?.[p.cv] ?? manifest.motion.pallet_move_s,label:"진입"}]);
        live.set(p.id,e);
        setTank(obj.userData.tank,p.stage,p.ng);
      } else if (e.cv !== p.cv) {
        e.motion.path([{q:[zone.center,bt,0],seconds:playback?.transfers?.[p.cv] ?? manifest.motion.pallet_move_s,label:"이송"}]);
        e.cv=p.cv;
      }
      const tank=e.obj.userData.tank;
      const oldStage=e.stage;
      setTank(tank,p.stage,p.ng);
      applyAssembly(e);
      if(e.carried)tank.visible=false;
      if (!reset && p.stage && p.stage !== oldStage && !assemblyState.has(e.obj.uuid+({HULL:"hull",POWERPACK:"pp",TURRET:"turret"}[p.stage]))) {
        const part = p.stage === "HULL" ? tank.userData.hull : p.stage === "POWERPACK" ? tank.userData.pp : tank.userData.turret;
        // Finish any interrupted insertion before starting a new component.
        if (tank.userData.insertion) tank.userData.insertion.part.position.y = tank.userData.insertion.base;
        tank.userData.insertion = {part,base:part.position.y,t:0};
        part.position.y += .012;
      }
      e.stage=p.stage;
      e.obj.userData.pickupCv=p.cv;
      e.label.textContent = `${p.run_no != null ? "#" + p.run_no : p.id}${p.ng ? " · NG" : ""}${p.skip ? " · 작업 생략" : ""}`;
    }
    for (const [id,e] of live) {
      if (seen.has(id)) continue;
      live.delete(id); e.obj.remove(e.labelObj);
      if (!reset && e.cv === 5 && count > previousStorage) {
        const slot = count-1;
        const from=e.obj.position.clone(), to=rootPoint(storeAnchors[slot]);
        leaving.push({obj:e.obj,from,to,t:0,slot,duration:manifest.motion.storage_move_s});
      } else removePallet(e.obj);
    }
    targetStorage=count;
    if (reset) {
      rack.position.y=rackY0 - Math.min(count,storeSlots.length-1)*info.storage_pitch;
      rackMotion=new JointMotion([rack.position.y]);
    }
    storeSlots.forEach((obj,k) => { obj.visible=k<count && !leaving.some((e)=>e.slot===k); });
    previousStorage=count;
    for (const c of s.conveyors) {
      if (leds[c.cv]) leds[c.cv].emissiveIntensity = c.state === "EMPTY" ? .08 : 3.2;
      if (zoneLabels[c.cv]) zoneLabels[c.cv].dataset.state=c.state;
    }
  }

  function applyAssembly(e){
    const tank=e.obj.userData.tank;
    for(const key of ['hull','pp','turret']){
      const state=assemblyState.get(e.obj.uuid+key);
      if(state!==undefined){tank.userData[key].visible=state;if(key==='hull'&&state)tank.visible=true;}
    }
  }
  function assemblyTarget(cv,key){
    const e=[...live.values()].find(e=>e.cv===cv);if(!e)return null;
    const tank=e.obj.userData.tank,part=tank.userData[key];
    root.updateWorldMatrix(true,true);
    const bounds=new THREE.Box3().setFromObject(part),position=part.getWorldPosition(new THREE.Vector3());
    position.y=bounds.max.y;
    return {position:position.toArray(),part,pallet:e.obj,
      prepare(){assemblyState.set(e.obj.uuid+key,false);applyAssembly(e);},
      release(){assemblyState.set(e.obj.uuid+key,true);applyAssembly(e);}};
  }
  function tick(dt, carry = undefined, transportAllowed = true) {
    let speed=0;
    for (const e of live.values()) {
      const before=e.obj.position.x;
      if(transportAllowed)e.obj.position.fromArray(e.motion.tick(dt));
      speed=Math.max(speed,Math.abs(e.obj.position.x-before)/Math.max(dt,.001));
      const insertion=e.obj.userData.tank.userData.insertion;
      if (insertion) {
        insertion.t=Math.min(1,insertion.t+dt/(manifest.motion.assembly_settle_s ?? .5));
        insertion.part.position.y=insertion.base+.012*(1-smooth(insertion.t));
        if (insertion.t===1) delete e.obj.userData.tank.userData.insertion;
      }
    }
    for (let i=sorting.length-1;i>=0;i--) {
      const e=sorting[i];
      if(!sortConnected)continue;
      if(carry!==undefined){
        if(!carry?.active&&!e.following)continue;
        if(carry?.active){
          e.following=true;e.delay=0;e.t=0;
          if(e.source){e.source.carried=true;e.source.obj.userData.tank.visible=false;}
          e.obj.visible=true;
          const point=root.worldToLocal(new THREE.Vector3(...carry.position));point.y-=.12;e.obj.position.copy(point);
        }else{
          if(!e.settling){e.from.copy(e.obj.position);e.t=0;e.settling=true;}
          e.t=Math.min(1,e.t+dt/.45);e.obj.position.lerpVectors(e.from,e.to,smooth(e.t));
        }
      }else{
      let activeDt=dt;
      if(e.delay>0){const used=Math.min(e.delay,dt);e.delay-=used;activeDt-=used;if(activeDt<=0)continue;}
      if(e.source){e.source.carried=true;e.source.obj.userData.tank.visible=false;}
      e.obj.visible=true;
      e.t=Math.min(1,e.t+activeDt/e.duration);
      const k=smooth(e.t);
      e.obj.position.lerpVectors(e.from,e.to,k);
      e.obj.position.y+=.24*Math.sin(Math.PI*k);
      }
      if (e.t===1 && e.confirmed) {
        setTank(trays[e.key][e.slot],e.stage,e.key==="fail");
        root.remove(e.obj); disposeTank(e.obj); sorting.splice(i,1);
      }
    }
    const hadIncoming=leaving.length>0;
    let incomingCompletion=0;
    for (let i=leaving.length-1;transportAllowed&&i>=0;i--) {
      const e=leaving[i], before=e.obj.position.x;
      incomingCompletion=Math.max(incomingCompletion,e.duration*(1-e.t));
      e.t=Math.min(1,e.t+dt/e.duration);
      e.obj.position.lerpVectors(e.from,e.to,smooth(e.t));
      speed=Math.max(speed,Math.abs(e.obj.position.x-before)/Math.max(dt,.001));
      if (e.t===1) { storeSlots[e.slot].visible=true; removePallet(e.obj); leaving.splice(i,1); }
    }
    // The rack waits for the incoming pallet to seat before moving to the next empty shelf.
    if (transportAllowed && !leaving.length) {
      const target=rackY0-Math.min(targetStorage,storeSlots.length-1)*info.storage_pitch;
      if (Math.abs((rackMotion.segment?.target[0] ?? rackMotion.q[0])-target)>1e-6)
        rackMotion.path([{q:[target],seconds:manifest.motion.storage_move_s,label:"선반 이동"}]);
      rack.position.y=rackMotion.tick(hadIncoming?Math.max(0,dt-incomingCompletion):dt)[0];
    }
    if (beltMap) beltMap.offset.x -= speed*dt/info.belt_tile_m;
    drums.forEach((d)=>{d.rotation.z-=speed/.032*dt;});
    rollers.forEach((r)=>{r.rotation.z+=speed/.015*dt;});
    if (camLight) {
      flashT=Math.max(0,flashT-dt);
      camLight.emissiveIntensity=2+7*smooth(Math.min(1,flashT/.25));
    }
  }
  return {update,tick,assemblyTarget,
    transporting(){return [...live.values()].some(e=>!!e.motion.segment)||leaving.length>0||!!rackMotion.segment;},
    previewTransport(dt,accept){
      const saved=[];
      const move=(obj,position)=>{saved.push([obj,obj.position.clone()]);obj.position.copy(position);};
      for(const e of live.values()){
        const state=e.motion.checkpoint();const next=new THREE.Vector3(...e.motion.tick(dt));e.motion.restore(state);move(e.obj,next);
      }
      for(const e of leaving)move(e.obj,new THREE.Vector3().lerpVectors(e.from,e.to,smooth(Math.min(1,e.t+dt/e.duration))));
      if(!leaving.length){const state=rackMotion.checkpoint();const y=rackMotion.tick(dt)[0];rackMotion.restore(state);const p=rack.position.clone();p.y=y;move(rack,p);}
      root.updateWorldMatrix(true,true);
      const allowed=accept();
      saved.forEach(([obj,p])=>obj.position.copy(p));root.updateWorldMatrix(true,true);
      return allowed;
    },
    colliders(){const meshes=[];const objects=[...[...live.values()].map(e=>e.obj),...leaving.map(e=>e.obj),...Object.values(trays).flat(),rack];for(const obj of objects)obj.traverse(o=>{if(o.isMesh)meshes.push(o);});return [...new Set(meshes)];},
    onEvent(ev){if(ev?.type==="result") flashT=.35;},dispose:clear,
    resume() {
      live.forEach((e)=>e.motion.resume());
      rackMotion.resume();
      for (const e of [...leaving,...sorting]) {
        e.from.copy(e.obj.position); e.duration=Math.max(.2,e.duration*(1-e.t)); e.t=0;
      }
    }
  };
}
