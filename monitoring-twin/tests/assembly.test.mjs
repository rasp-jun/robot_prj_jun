import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {fixture} from './scene-fixture.mjs';
import {createSupply,TOOL_LENGTH,attachPart} from '../client/scene/assembly.js';
import {CollisionWorld,meshEnvelope,refreshEnvelope,planMotion} from '../client/scene/collision.js';
import {taskTargets,solveTask} from '../client/scene/tasks.js';
import {JointMotion,READY_POSE} from '../client/scene/motion.js';
for(const [station,job,key,size,x,top] of [
  [1,'ROBOT1_HULL_PLACE','hull',[.212,.05,.156],0,.888],
  [1,'ROBOT1_POWERPACK_MOUNT','pp',[.06,.035,.09],-.065,.923],
  [2,'ROBOT2_TURRET_MATE','turret',[.187,.035,.099],.02,.923],
])test(`rear supply suction route: ${key}`,()=>{
  const f=fixture();f.line.updateMatrixWorld(true);const supply=createSupply(f.line),world=new CollisionWorld(f.line),r=f.robot(station);
  const parts=r.links.map((m,link)=>({...meshEnvelope(m),link}));
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size)),payload={...meshEnvelope(mesh,.002),link:9,payload:true,ignoreStatic:new Set(supply.bins[key].shelves)};
  const tool=new THREE.Mesh(new THREE.BoxGeometry(.054,.054,TOOL_LENGTH));tool.position.z=.06+TOOL_LENGTH/2;r.links[6].add(tool);
  parts.push({...meshEnvelope(tool,.002),link:8,payload:true});
  const tcp=()=>r.links[6].localToWorld(new THREE.Vector3(0,0,.06));
  const forward=q=>{r.set(q);return {side:new THREE.Vector3(1,0,0).transformDirection(r.links[6].matrixWorld).toArray(),position:tcp().toArray(),direction:new THREE.Vector3(0,0,1).transformDirection(r.links[6].matrixWorld).toArray()};};
  let carryLocal;
  const check=q=>{r.set(q);parts.forEach(refreshEnvelope);mesh.position.copy(tcp());mesh.position.y-=TOOL_LENGTH+size[1]/2;mesh.updateMatrixWorld();if(carryLocal){const tcpMatrix=r.links[6].matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0,0,.06));mesh.matrixWorld.multiplyMatrices(tcpMatrix,carryLocal);}refreshEnvelope(payload);return world.check([...parts,payload]);};
  f.line.updateMatrixWorld(true);
  const pickup=supply.bins[key].nest.getWorldPosition(new THREE.Vector3());pickup.y+=.045+2*.085+size[1]+TOOL_LENGTH;
  const work=f.line.getObjectByName('Zone_CV'+(station===1?1:3)).getWorldPosition(new THREE.Vector3());work.x+=x;work.y=top+TOOL_LENGTH;
  const targets=taskTargets(job,{work:work.toArray(),pickup:pickup.toArray()},8);
  const solved=solveTask(targets,READY_POSE,r.limits,forward,check);
  assert.equal(solved.failure,undefined,JSON.stringify(solved.failure));
  r.set(solved.points.find(p=>p.action==='grip').q);
  const center=pickup.clone();center.y-=TOOL_LENGTH+size[1]/2;
  carryLocal=r.links[6].matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0,0,.06)).invert().multiply(new THREE.Matrix4().makeTranslation(...center.toArray()));
  const planned=planMotion(READY_POSE,solved.points,check,r.limits);
  assert.equal(planned.failure,undefined,JSON.stringify(planned.failure));
  const motion=new JointMotion(READY_POSE);motion.path(planned.points);
  while(motion.segment)assert.equal(check(motion.tick(1/120)),null);
  assert.deepEqual(motion.completed,['grip','release']);
});
test('vacuum dwell and events survive pause and collision rollback exactly once',()=>{
  const m=new JointMotion([0]);m.path([{q:[0],seconds:.4,label:'vacuum',action:'grip'},{q:[1],seconds:1,label:'carry',action:'release'}]);
  m.tick(.2);m.resume();assert.deepEqual(m.completed,[]);
  const saved=m.checkpoint();m.tick(.3);m.restore(saved);assert.deepEqual(m.completed,[]);
  m.tick(3);assert.deepEqual(m.completed,['grip','release']);
});
test('suction attachment preserves contact and then follows wrist rotation',()=>{
  const root=new THREE.Group(),tcp=new THREE.Group(),part=new THREE.Mesh(new THREE.BoxGeometry(.2,.05,.12));root.add(tcp,part);tcp.position.set(1,2,3);part.position.set(1,1.87,3);root.updateMatrixWorld(true);
  const before=part.getWorldPosition(new THREE.Vector3());attachPart(tcp,part);assert.ok(part.getWorldPosition(new THREE.Vector3()).distanceTo(before)<1e-9);
  tcp.position.x+=.3;root.updateMatrixWorld(true);assert.ok(Math.abs(part.getWorldPosition(new THREE.Vector3()).x-before.x-.3)<1e-9);
});

test('ST2 weld keeps suction tool and wrist clear of the completed product, including return',()=>{
  const f=fixture();f.line.updateMatrixWorld(true);createSupply(f.line);const world=new CollisionWorld(f.line),r=f.robot(2);
  const tool=new THREE.Mesh(new THREE.BoxGeometry(.054,.054,TOOL_LENGTH));tool.position.z=.06+TOOL_LENGTH/2;r.links[6].add(tool);
  const parts=r.links.map((m,link)=>({...meshEnvelope(m),link}));parts.push({...meshEnvelope(tool,.002),link:8,payload:true});
  const work=f.line.getObjectByName('Zone_CV3').getWorldPosition(new THREE.Vector3());
  const product=new THREE.Mesh(new THREE.BoxGeometry(.24,.085,.16));product.position.set(work.x,.8805,work.z);product.updateMatrixWorld();world.setDynamic([product]);
  work.y+=.14+TOOL_LENGTH;
  const forward=q=>{r.set(q);return {position:r.links[6].localToWorld(new THREE.Vector3(0,0,.06)).toArray(),direction:new THREE.Vector3(0,0,1).transformDirection(r.links[6].matrixWorld).toArray()};};
  const check=q=>{r.set(q);parts.forEach(refreshEnvelope);return world.check(parts);};
  const task=solveTask(taskTargets('ROBOT2_WELD_MOTION',{work:work.toArray()},6),READY_POSE,r.limits,forward,check);
  assert.equal(task.failure,undefined,JSON.stringify(task.failure));
  const plan=planMotion(READY_POSE,[...task.points,{q:READY_POSE,seconds:1.6,label:'return'}],check,r.limits,{velocity:75,acceleration:180});
  assert.equal(plan.failure,undefined,JSON.stringify(plan.failure));
  const motion=new JointMotion(READY_POSE);motion.path(plan.points);
  while(motion.segment)assert.equal(check(motion.tick(1/120)),null);
});
