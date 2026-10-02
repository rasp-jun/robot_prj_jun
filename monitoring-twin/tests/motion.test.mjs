import test from "node:test";
import assert from "node:assert/strict";
import { JointMotion, jobPath, READY_POSE, smooth } from "../client/scene/motion.js";

test("minimum-jerk endpoints are stationary",()=>{
  const m=new JointMotion([0]);
  m.path([{q:[10],seconds:1,label:"move"}]);
  assert.equal(m.q[0],0);
  m.tick(.5);
  assert.ok(Math.abs(m.q[0]-5)<1e-10);
  m.tick(.5);
  assert.deepEqual(m.q,[10]);
  assert.deepEqual(m.v,[0]);
  assert.deepEqual(m.a,[0]);
  assert.equal(smooth(-1),0); assert.equal(smooth(2),1);
});
test("retarget preserves position, velocity and acceleration",()=>{
  const m=new JointMotion([0,4]);
  m.path([{q:[15,-10],seconds:2,label:"move"}]); m.tick(.6);
  const before=[...m.q,...m.v,...m.a];
  m.path([{q:[-3,8],seconds:1.2,label:"return"}]);
  assert.deepEqual([...m.q,...m.v,...m.a],before);
  m.tick(1.2); assert.deepEqual(m.q,[-3,8]);
});
test("frame rate does not change the path timing",()=>{
  const sample=(fps)=>{
    const m=new JointMotion(READY_POSE);
    m.path(jobPath("ROBOT1_POWERPACK_MOUNT",4));
    for(let i=0;i<fps*2;i++)m.tick(1/fps);
    return m.q;
  };
  const a=sample(30),b=sample(144);
  a.forEach((value,i)=>assert.ok(Math.abs(value-b[i])<1e-7));
});
test("pause and resume retain pose and restart from rest",()=>{
  const m=new JointMotion([0]);
  m.path([{q:[20],seconds:2,label:"move"}]);m.tick(.8);
  const before=[...m.q];
  m.tick(0);m.resume();
  assert.deepEqual(m.q,before);assert.deepEqual(m.v,[0]);
  m.tick(2);assert.deepEqual(m.q,[20]);
});
test("all five jobs have distinct finite paths and preserve duration",()=>{
  const jobs=["ROBOT1_HULL_PLACE","ROBOT1_POWERPACK_MOUNT","ROBOT2_TURRET_MATE","ROBOT2_WELD_MOTION","ROBOT3_SORT"];
  const paths=jobs.map((job)=>jobPath(job,5));
  for(const path of paths){
    assert.ok(Math.abs(path.reduce((sum,p)=>sum+p.seconds,0)-5)<1e-9);
    assert.ok(path.every(p=>p.q.length===6&&p.q.every(Number.isFinite)));
  }
  assert.equal(new Set(paths.map(p=>JSON.stringify(p))).size,5);
  assert.notDeepEqual(jobPath("ROBOT3_SORT",4,true),jobPath("ROBOT3_SORT",4,false));
});
test("high playback speed can cross multiple segments without losing time",()=>{
  const m=new JointMotion([0]);m.path([{q:[1],seconds:.2,label:"first"},{q:[2],seconds:.2,label:"second"}]);
  m.tick(.4);assert.deepEqual(m.q,[2]);assert.equal(m.segment,null);
});
