import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {fixture} from './scene-fixture.mjs';
import {CollisionWorld,meshEnvelope,refreshEnvelope,checkedEdge,planRoute,planMotion} from '../client/scene/collision.js';
import {taskTargets,solveTask} from '../client/scene/tasks.js';
import {JointMotion,READY_POSE,jobPath} from '../client/scene/motion.js';

const f=fixture(),world=new CollisionWorld(f.line);
function arm(id){
  const r=f.robot(id),parts=r.links.map((m,i)=>Object.assign(meshEnvelope(m),{link:i}));
  let carrying=id===3;
  const payload={...meshEnvelope(new THREE.Mesh(new THREE.BoxGeometry(.34,.10,.16))),link:8,payload:true};
  const check=q=>{r.set(q);parts.forEach(refreshEnvelope);const all=[...parts];
    if(carrying){payload.mesh.position.copy(r.links[6].localToWorld(new THREE.Vector3(0,0,.06)));payload.mesh.position.y-=.07;payload.mesh.updateMatrixWorld();refreshEnvelope(payload);all.push(payload);}
    return world.check(all);
  };
  const forward=q=>{r.set(q);return {position:r.links[6].localToWorld(new THREE.Vector3(0,0,.06)).toArray(),direction:new THREE.Vector3(0,0,1).transformDirection(r.links[6].matrixWorld).toArray()};};
  return {...r,parts,check,forward,carry(v){carrying=v;}};
}
const arms=[1,2,3].map(arm);
test('actual STL envelopes expose old ST2 camera interference',()=>{
  assert.equal(arms[1].check(READY_POSE),null);
  assert.match(arms[1].check(jobPath('ROBOT2_WELD_MOTION')[1].q).name,/Camera/);
});
for(const [station,job] of [[1,'ROBOT1_HULL_PLACE'],[1,'ROBOT1_POWERPACK_MOUNT'],[2,'ROBOT2_TURRET_MATE'],[2,'ROBOT2_WELD_MOTION'],[3,'ROBOT3_SORT']]){
  for(const ng of job==='ROBOT3_SORT'?[false,true]:[false])test(`actual equipment: ${job}${ng?' FAIL':''}, approach and retreat`,()=>{
    const r=arms[station-1],cv=station===1?1:station===2?3:4;
    const position=name=>f.line.getObjectByName(name).getWorldPosition(new THREE.Vector3()).toArray();
    const work=position('Zone_CV'+cv);work[1]+=station===1?.20:station===3?.16:.14;
    for(const slot of job==='ROBOT3_SORT'?[1,2,3]:[1]){
      const pass=position(`Tray_Pass_Slot_0${slot}`),fail=position(`Tray_Fail_Slot_0${slot}`);pass[1]+=.22;fail[1]+=.22;
      r.carry(station===3);
      const targets=taskTargets(job,{work,pass,fail,ng},5);
      const solved=solveTask(targets,READY_POSE,r.limits,r.forward,r.check);
      assert.equal(solved.failure,undefined,JSON.stringify(solved.failure));
      solved.points.forEach((p,i)=>assert.ok(Math.hypot(...r.forward(p.q).position.map((v,k)=>v-targets[i].target[k]))<.004));
      const planned=planMotion(READY_POSE,solved.points,r.check,r.limits);
      assert.equal(planned.failure,undefined,JSON.stringify(planned.failure));
      // Sample the actual spline, more densely than the planner, not only waypoints.
      const motion=new JointMotion(READY_POSE);motion.path(planned.points);
      while(motion.segment){const q=motion.tick(1/120);assert.equal(r.check(q),null,JSON.stringify({job,q,hit:r.check(q)}));}
      r.carry(false);
      const back=planMotion(motion.q,[{q:READY_POSE,seconds:1.6,label:'return'}],r.check,r.limits);
      assert.equal(back.failure,undefined);motion.path(back.points);
      while(motion.segment)assert.equal(r.check(motion.tick(1/120)),null);
    }
  });
}
test('bounded planner routes around an obstacle, and rejects blocked endpoints',()=>{
  const check=q=>Math.abs(q[0])<8&&q[1]<10?{kind:'fixture',name:'barrier'}:null;
  const a=[-30,0,-90,0,-90,0],b=[30,0,-90,0,-90,0];
  const result=planRoute(a,b,check);assert.equal(result.detour,true);
  let from=a;for(const q of result.points){assert.equal(checkedEdge(from,q,check,.2),null);from=q;}
  assert.ok(planRoute(a,[0,0,-90,0,-90,0],check).failure);
});
test('joint limits reject invalid targets; speed/acceleration limits shape the spline',()=>{
  const limits=Array.from({length:6},()=>[-175,175]);
  assert.ok(planMotion(READY_POSE,[{q:[200,0,0,0,0,0],seconds:.1}],()=>null,limits).failure);
  const p=planMotion(READY_POSE,[{q:[90,30,-70,0,-90,0],seconds:.1}],()=>null,limits);
  const m=new JointMotion(READY_POSE);m.path(p.points);
  while(m.segment){m.tick(.001);assert.ok(Math.max(...m.v.map(Math.abs))<=110.001);assert.ok(Math.max(...m.a.map(Math.abs))<=300.001);}
});
test('dynamic robot/payload envelopes and swept edges cannot be skipped',()=>{
  const r=arms[0];r.check(READY_POSE);
  const other={...r.parts[3],link:0};assert.equal(world.check(r.parts,[other]).kind,'robot');
  const box=new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1));box.position.copy(r.parts[3].bounds.getCenter(new THREE.Vector3()));box.updateMatrixWorld();
  world.setDynamic([box]);assert.equal(world.check(r.parts).kind,'payload');world.setDynamic([]);
  const hit=checkedEdge([0],[10],q=>q[0]>=4&&q[0]<=5?{name:'thin barrier'}:null,.5);assert.ok(hit);
  const m=new JointMotion([0]);m.path([{q:[10],seconds:1,label:'move'}]);const saved=m.checkpoint();m.tick(.7);m.restore(saved);assert.equal(m.q[0],0);assert.equal(m.segment.elapsed,0);
});

test('completed product appearing at ST1 leaves room for wrist and retreat',()=>{
  const r=arms[0],work=f.line.getObjectByName('Zone_CV1').getWorldPosition(new THREE.Vector3()).toArray();work[1]+=.20;
  const product=new THREE.Mesh(new THREE.BoxGeometry(.29,.10,.13));product.position.set(work[0]+.025,.89,0);product.updateMatrixWorld();world.setDynamic([product]);
  try {
    const targets=taskTargets('ROBOT1_POWERPACK_MOUNT',{work},4);
    const task=solveTask(targets,READY_POSE,r.limits,r.forward,r.check);assert.equal(task.failure,undefined);
    const plan=planMotion(READY_POSE,[...task.points,{q:READY_POSE,seconds:1.6}],r.check,r.limits);assert.equal(plan.failure,undefined);
    const motion=new JointMotion(READY_POSE);motion.path(plan.points);
    while(motion.segment)assert.equal(r.check(motion.tick(1/120)),null);
  } finally {world.setDynamic([]);}
});
