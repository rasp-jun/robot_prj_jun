// Indy7 3대 + 스테이션 상태 링. web/preview_src.html의 createIndy7Factory(digital_twin2 포팅)를 가져왔다.
// 관절은 아직 실제 값을 받지 않는다(W1-1). 작업별 경로를 최소 저크 보간하는 모의 동작이다.
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import URDFLoader from "urdf-loader";
import { JointMotion, READY_POSE } from "./motion.js";

import { CollisionWorld, meshEnvelope, refreshEnvelope, checkedEdge, planMotion, planRoute } from "./collision.js";

import { taskTargets, solveTask } from "./tasks.js";
import {createRobotFinish,addRobotHardware} from "./robot-finish.js";

import {ASSEMBLY_JOBS,TOOL_LENGTH,createSupply,stockSupply,createSuctionTool,attachPart} from './assembly.js';

import {armOccupied} from './sequencer.js';

const JOINTS = ["joint0", "joint1", "joint2", "joint3", "joint4", "joint5"];
const D2R = Math.PI / 180;
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
  const material = createRobotFinish(geoms);
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

export async function createRobots(line, manifest, pallets) {
  const make = await loadIndy7Factory(manifest.models.indy7, manifest.models.indy7_meshes);
  const robots = {};
  const clearance=manifest.motion.clearance_m ?? .012;
  const supply=createSupply(line);
  const world=new CollisionWorld(line,clearance);
  const stock=stockSupply(supply,manifest.tank);
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

    const motion = new JointMotion(READY_POSE);
    const parts=[];
    obj.traverse(mesh=>{
      if(!mesh.isMesh)return;
      let parent=mesh;while(parent&&!/^link\d$/.test(parent.name))parent=parent.parent;
      if(parent)parts.push({...meshEnvelope(mesh,clearance),link:Number(parent.name.slice(4))});
    });
    addRobotHardware(obj,i);
    const limits=JOINTS.map(n=>[obj.joints[n].limit.lower/D2R,obj.joints[n].limit.upper/D2R]);
    const tcp=obj.getObjectByName("tcp");
    const tip=new THREE.Mesh(new THREE.SphereGeometry(.012,10,8),new THREE.MeshStandardMaterial({color:0x65757e,metalness:.8,roughness:.24}));
    tcp.add(tip);
    const suction=i<3?createSuctionTool(tcp):null;
    const toolMesh=new THREE.Mesh(new THREE.BoxGeometry(.054,.054,TOOL_LENGTH));toolMesh.position.z=TOOL_LENGTH/2;tcp.add(toolMesh);toolMesh.visible=false;
    const toolPart={...meshEnvelope(toolMesh,.002),link:8,payload:true};
    const path=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x27877a,transparent:true,opacity:.65}));
    path.frustumCulled=false;path.visible=false;line.add(path);
    const carried=new THREE.Mesh(new THREE.BoxGeometry(.34,.10,.16));
    const payload={...meshEnvelope(carried,clearance),link:8,payload:true};
    robots[i] = { obj, tcp, suction,toolPart,assembly:null, jobs:[], payload, parts, limits, path, ring, q: motion.q, motion, state: "READY", job: null,
      enabled: false, connected: true, report:"대기 자세 확인",blocked:null,detours:0, pending:null };
  }

  function setJoints(r, q) {
    JOINTS.forEach((n, k) => r.obj.joints[n]?.setJointValue(q[k] * D2R));
  }
  Object.values(robots).forEach((r) => setJoints(r, r.q));

  function refresh(r) {r.obj.updateWorldMatrix(true,true);r.parts.forEach(refreshEnvelope);}
  function forward(r,q) {
    setJoints(r,q);refresh(r);
    return {side:new THREE.Vector3(1,0,0).transformDirection(r.tcp.matrixWorld).toArray(),position:r.tcp.getWorldPosition(new THREE.Vector3()).toArray(),
      direction:new THREE.Vector3(0,0,1).transformDirection(r.tcp.matrixWorld).toArray()};
  }
  function check(r,q,dynamic=false) {
    if(q.some((v,i)=>!Number.isFinite(v)||v<r.limits[i][0]||v>r.limits[i][1]))return {kind:"limit",name:"관절 한계"};
    setJoints(r,q);refresh(r);
    const others=dynamic?Object.values(robots).filter(x=>x!==r).flatMap(x=>x.parts):[];
    const parts=[...r.parts];
    if(r.suction){refreshEnvelope(r.toolPart);parts.push(r.toolPart);}
    if(r.assembly){
      const a=r.assembly;
      if(a.carryLocal){a.envelope.mesh.matrixAutoUpdate=false;a.envelope.mesh.matrixWorld.multiplyMatrices(r.tcp.matrixWorld,a.carryLocal);}
      else {a.envelope.mesh.position.copy(r.tcp.getWorldPosition(new THREE.Vector3()));a.envelope.mesh.position.y-=TOOL_LENGTH+a.height/2;a.envelope.mesh.updateMatrixWorld(true);}
      refreshEnvelope(a.envelope);if(!a.released)parts.push(a.envelope);
    }
    if(r.motionJob==='ROBOT3_SORT'){
      r.payload.mesh.position.copy(r.tcp.getWorldPosition(new THREE.Vector3()));r.payload.mesh.position.y-=.07;
      r.payload.mesh.updateMatrixWorld(true);refreshEnvelope(r.payload);parts.push(r.payload);
    }
    return world.check(parts,others,{dynamic});
  }
  function showPath(r,points) {
    let prev=r.q;const vertices=[new THREE.Vector3(...forward(r,prev).position)];
    for(const point of points){
      const n=Math.max(4,Math.ceil(Math.max(...prev.map((v,i)=>Math.abs(v-point.q[i])))/3));
      for(let k=1;k<=n;k++)vertices.push(new THREE.Vector3(...forward(r,prev.map((v,i)=>v+(point.q[i]-v)*k/n)).position));
      prev=point.q;
    }
    r.path.geometry.dispose();r.path.geometry=new THREE.BufferGeometry().setFromPoints(vertices);
    setJoints(r,r.q);refresh(r);
  }
  function install(r,points) {
    const result=planMotion(r.q,points,q=>check(r,q),r.limits,manifest.motion.joint_limits);
    setJoints(r,r.q);refresh(r);
    r.blocked=result.failure??null;
    r.report=result.failure?"경로 보류 · "+result.failure.name:result.detours?`회피 경유 ${result.detours}개 · 검사 통과`:"경로 검사 통과";
    r.detours=result.detours;
    r.totalDuration=result.duration??0;
    // A new path starts from the actual stopped pose: no unvalidated spline overshoot.
    if(result.failure){r.motion.path([]);return;}
    r.motion.v.fill(0);r.motion.a.fill(0);r.motion.path(result.points);
    showPath(r,result.points);
  }
  function startTask(r,snapshot,playback,job=r.job,prepared=null) {
    r.motionJob=job;
    const id=Number(Object.keys(robots).find(k=>robots[k]===r)),cv=id===1?1:id===2?3:4;
    const position=name=>line.getObjectByName(name).getWorldPosition(new THREE.Vector3()).toArray();
    const work=position(`Zone_CV${cv}`);work[1]+=id===1?.20:id===3?.16:.14;
    if(job==='ROBOT2_WELD_MOTION')work[1]+=TOOL_LENGTH;
    const pallet=snapshot.pallets.find(p=>p.cv===cv);
    const tray=key=>{const n=Math.min(3,(snapshot.trays?.[key]??0)+1),p=position(`Tray_${key==='pass'?'Pass':'Fail'}_Slot_0${n}`);p[1]+=.22;return p;};
    const duration=playback?.jobs?.[id]?.duration_s??5;
    let pickup;
    const key=ASSEMBLY_JOBS[job];
    if(key){
      const target=prepared??pallets.assemblyTarget(cv,key),part=stock.peek(key);
      if(!target||!part){r.blocked={name:'공급 부품 또는 팔레트 없음'};r.report=r.blocked.name;return;}
      target.prepare();part.updateWorldMatrix(true,true);
      const b=new THREE.Box3().setFromObject(part),center=part.getWorldPosition(new THREE.Vector3());center.y=b.max.y+TOOL_LENGTH;
      pickup=center.toArray();work.splice(0,3,...target.position);work[1]+=TOOL_LENGTH;
      const size=b.getSize(new THREE.Vector3()),mesh=new THREE.Mesh(new THREE.BoxGeometry(size.x,size.y,size.z));
      const ignore=new Set();target.pallet.traverse(o=>{if(o.isMesh)ignore.add(o);});
      r.assembly={key,part,target,height:size.y,envelope:{...meshEnvelope(mesh,.002),link:9,payload:true,ignoreStatic:new Set(supply.bins[key].shelves),ignoreDynamic:ignore},held:false,released:false};
      r.toolPart.ignoreDynamic=ignore;
    }
    const targets=taskTargets(job,{work,pickup,pass:tray('pass'),fail:tray('fail'),ng:pallet?.ng===true},duration);
    const result=solveTask(targets,r.q,r.limits,q=>forward(r,q),q=>check(r,q));
    if(result.failure){setJoints(r,r.q);refresh(r);r.motion.path([]);r.blocked=result.failure;r.report='접근 경로 없음 · '+result.failure.name;return;}
    const points=result.points;
    if(r.assembly){
      const a=r.assembly,grip=points.find(p=>p.action==='grip');
      setJoints(r,grip.q);refresh(r);
      a.part.updateWorldMatrix(true,true);
      const center=new THREE.Box3().setFromObject(a.part).getCenter(new THREE.Vector3());
      a.carryLocal=new THREE.Matrix4().copy(r.tcp.matrixWorld).invert().multiply(new THREE.Matrix4().makeTranslation(...center.toArray()));
    }
    setJoints(r,r.q);refresh(r);install(r,points);
  }
  function retreat(r){r.motionJob=null;install(r,[{q:READY_POSE,seconds:1.6,label:"검사된 경로로 복귀"}]);}
  Object.values(robots).forEach(refresh);
  let overlays=false,uiTime=0,transportBlocked=false,transportHold=null;
  const resumeDuration=(a,b)=>{const d=Math.max(...a.map((v,i)=>Math.abs(v-b[i]))),limits=manifest.motion.joint_limits;return Math.max(.2,1.875*d/(limits?.velocity??110),Math.sqrt(5.774*d/(limits?.acceleration??300)));};
  document.getElementById('pathToggle')?.addEventListener('click',e=>{
    overlays=!overlays;e.currentTarget.setAttribute('aria-pressed',String(overlays));
    Object.values(robots).forEach(r=>r.path.visible=overlays);
  });
  return {
    robots,
    carryPose(){const r=robots[3];return {active:['검사품 들어올리기','합격 트레이 이동','불합격 트레이 이동','트레이 안착'].includes(r.motion.phase)&&!!r.motion.segment,position:r.tcp.getWorldPosition(new THREE.Vector3()).toArray()};},
    allowTransport(){const active=Object.entries(robots).find(([,r])=>armOccupied(r));transportHold=active?`ST${active[0]} 작업·복귀 완료 대기 · 이송 인터록`:null;if(active){transportBlocked=false;return false;}transportBlocked=!Object.values(robots).every(r=>!world.check(r.parts));return !transportBlocked;},
    setSafety(snapshot){for(const s of snapshot.robots){const r=robots[s.robot];r.safetyStopped=s.state==='ERR'||!snapshot.link.robots[s.robot-1];}} ,
    setDynamic(meshes){
      world.setDynamic(meshes);robots[3].payload.ignoreDynamic=new Set(meshes.filter(mesh=>{
        for(let p=mesh;p;p=p.parent)if(p.userData.pickupCv===4)return true;
        return false;
      }));
    },
    update(snapshot, playback, reset = false) {
      for(const s of snapshot.robots){
        const r=robots[s.robot];
        if(reset){if(s.robot===1)stock.reset();r.assembly=null;r.jobs=[];r.suction?.setVacuum(false);r.motion=new JointMotion(READY_POSE);r.q=r.motion.q;r.state=null;r.job=null;r.enabled=false;r.blocked=null;r.pending=null;r.motionJob=null;r.report="대기 자세 확인";r.path.geometry.dispose();r.path.geometry=new THREE.BufferGeometry();setJoints(r,r.q);refresh(r);}
        const changed=r.state!==s.state||r.job!==s.job,previous=r.state;
        r.state=s.state;r.job=s.job;r.connected=snapshot.link.robots[s.robot-1];
        if(changed){
          if(s.state==='BUSY'){
            const key=ASSEMBLY_JOBS[s.job],target=key?pallets.assemblyTarget(s.robot===1?1:3,key):null;
            target?.prepare();
            if(r.motionJob===s.job&&previous==='ERR'&&r.motion.segment)continue;
            if(r.motion.segment||r.assembly){if(r.motionJob!==s.job&&!r.jobs.some(j=>j.job===s.job))r.jobs.push({snapshot,playback,job:s.job,target});continue;}
            startTask(r,snapshot,playback,s.job,target);
            const hint=playback?.jobs?.[s.robot];
            if(reset&&hint&&!r.blocked&&!r.assembly){
              const total=(r.motion.segment?.duration??0)+r.motion.queue.reduce((sum,p)=>sum+p.seconds,0);
              r.q=r.motion.tick(Math.min(1,Math.max(0,playback.elapsed_s-hint.started_s)/hint.duration_s)*total);
              setJoints(r,r.q);refresh(r);
            }
          }
          else if(['DONE','READY'].includes(s.state)&&!(reset&&s.state==='READY')&&!(previous==='DONE'&&s.state==='READY')){
            // Let the final approach finish rather than cutting it off at the event boundary.
            if(r.motion.segment)r.pending='retreat';else retreat(r);
          }
        }
      }
    },
    tick(dt,time,motionEnabled=true) {
      // Substeps plus swept joint checks prevent high playback rates skipping thin obstacles.
      const steps=Math.max(1,Math.ceil(dt/.016)),step=dt/steps;
      for(let n=0;n<steps;n++)for(const r of Object.values(robots)){
        const enabled=motionEnabled&&r.connected&&r.state!=='ERR'&&!r.safetyStopped;
        if(enabled&&!r.enabled)r.motion.resume(resumeDuration);r.enabled=enabled;
        if(!enabled||!r.motion.segment)continue;
        const saved=r.motion.checkpoint(),before=[...r.q],candidate=[...r.motion.tick(step)];
        const collision=checkedEdge(before,candidate,q=>check(r,q,true),.5);
        if(collision){r.motion.restore(saved);r.q=r.motion.q;if(!r.blocked)r.motion.resume(resumeDuration);r.blocked=collision.hit;r.report='간섭 감지 · 이동 보류';}
        else {r.q=r.motion.q;if(r.blocked)r.report="간섭 해소 · 경로 재개";r.blocked=null;}
        setJoints(r,r.q);refresh(r);
        for(const action of r.motion.completed.splice(0)){
          const a=r.assembly;if(!a)continue;
          if(action==='grip'&&!a.held){stock.take(a.key);attachPart(r.tcp,a.part);a.held=true;r.suction.setVacuum(true);}
          if(action==='release'&&!a.released){a.part.visible=false;a.target.release();a.released=true;r.suction.setVacuum(false);}
        }
        if(!r.motion.segment){if(r.assembly){r.assembly.envelope.mesh.geometry.dispose();r.assembly.envelope.mesh.material.dispose();r.assembly=null;}
          const next=r.jobs.shift();if(next){r.pending=null;startTask(r,next.snapshot,next.playback,next.job,next.target);continue;}
        }
        if(!r.motion.segment&&r.pending){r.pending=null;retreat(r);}
      }
      uiTime+=dt;
      for(const [i,r] of Object.entries(robots)){
        const pulse=r.state==='ERR'? .55+.45*Math.sin(time*7):r.state==='BUSY'?.8+.2*Math.sin(time*3):1;
        r.ring.emissive.copy(r.blocked?RING.ERR:(RING[r.state]??RING.READY));
        r.ring.emissiveIntensity=(r.state==='READY'?.6:3)*pulse;
        const phase=document.querySelector(`[data-motion-phase="${i}"]`);
        const text=r.blocked?'간섭 회피 대기':r.enabled?(r.motion.segment?r.motion.phase:'대기'):'동작 정지';
        if(phase&&phase.textContent!==text)phase.textContent=text;
      }
      if(uiTime>.15){
        uiTime=0;const active=Object.entries(robots).filter(([,r])=>r.blocked),status=document.getElementById('safetyStatus');
        if(status){status.dataset.blocked=String(active.length>0||transportBlocked);status.textContent=active.length?active.map(([i,r])=>`ST${i} · ${r.blocked.name} · 이동 보류`).join(' / '):transportBlocked?'로봇 작업 영역 · 팔레트 이송 대기':transportHold??'모델 간섭 감시 중 · 경로 검사 통과';}
        const detail=document.getElementById('safetyDetail');
        if(detail)detail.textContent=Object.entries(robots).map(([i,r])=>`ST${i} ${r.report}`).join('  /  ');
      }
    },
  };
}
