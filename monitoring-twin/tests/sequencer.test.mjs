import test from 'node:test';
import assert from 'node:assert/strict';
import {SceneSequencer,transitionWait,armOccupied,motionPermitted} from '../client/scene/sequencer.js';
const snapshot=(cv=3,state='DONE',job='ROBOT2_WELD_MOTION')=>({pallets:[{id:'P1',cv}],robots:[{robot:2,state,job}]});
const arm=()=>({motion:{segment:null},state:'READY',jobs:[],motionJob:null});
test('ST2 conveyor waits through welding, retreat, blocked paths and pending jobs',()=>{
  for(const partial of [{state:'BUSY'},{motion:{segment:{}}},{pending:'retreat'},{blocked:{name:'fixture'}},{jobs:[{}]},{assembly:{}}]){
    const r={...arm(),...partial};assert.equal(armOccupied(r),true);
    assert.match(transitionWait(snapshot(),snapshot(4),{2:r},false),/ST2/);
  }
  assert.equal(transitionWait(snapshot(),snapshot(4),{2:arm()},false),null);
});
test('an early next job cannot replace the current motion or start on a moving pallet',()=>{
  const a=snapshot(3,'DONE','ROBOT2_TURRET_MATE'),b=snapshot(3,'BUSY');
  assert.match(transitionWait(a,b,{2:{...arm(),motion:{segment:{}}}},false),/앞 작업/);
  assert.match(transitionWait(a,b,{2:arm()},true),/정위치/);
});
test('queued conveyor events preserve every intermediate stop at high playback rates',()=>{
  let moving=true;const applied=[],r=arm();
  const queue=new SceneSequencer({wait:(a,b)=>transitionWait(a,b,{2:r},moving),apply:s=>{applied.push(s.pallets[0].cv);if(applied.length>1)moving=true;}});
  queue.push(snapshot(3),null,null,true);queue.push(snapshot(4));queue.push(snapshot(5));
  assert.deepEqual(applied,[3]);moving=false;queue.flush();assert.deepEqual(applied,[3,4]);
  moving=false;queue.flush();assert.deepEqual(applied,[3,4,5]);
});
test('restart discards stale events; same-job error recovery is not queued as a new task',()=>{
  const r={...arm(),motion:{segment:{}},motionJob:'ROBOT2_WELD_MOTION'},applied=[];
  const q=new SceneSequencer({wait:(a,b)=>transitionWait(a,b,{2:r},false),apply:s=>applied.push(s)});
  q.push(snapshot(),null,null,true);q.push(snapshot(4));assert.equal(q.queue.length,1);
  q.push(snapshot(1),null,null,true);assert.equal(q.queue.length,0);assert.equal(q.current.pallets[0].cv,1);
  assert.equal(transitionWait(snapshot(3,'ERR'),snapshot(3,'BUSY'),{2:r},false),null);
});


test('ESTOP, recovery STOP, disconnection and explicit pause freeze motion immediately',()=>{
  const s={line:{state:'RUN'},link:{gateway:true,plc:true}};
  assert.equal(motionPermitted(s),true);
  for(const state of ['ESTOP','PAUSE','STOP'])assert.equal(motionPermitted({...s,line:{state}}),false);
  assert.equal(motionPermitted(s,{online:false}),false);
  assert.equal(motionPermitted(s,{playback:{state:'PAUSED'}}),false);
  assert.equal(motionPermitted({...s,line:{state:'STOP'}},{playback:{state:'PLAYING'}}),false);
  assert.equal(motionPermitted({...s,line:{state:'STOP'}},{playback:{state:'COMPLETED'}}),true);
});

test('DEPARTING display waits for arm return before a CV reassignment arrives',()=>{
  const before={...snapshot(),conveyors:[{cv:3,state:'HOLD'}]};
  const after={...snapshot(),conveyors:[{cv:3,state:'DEPARTING'}]};
  assert.match(transitionWait(before,after,{2:{...arm(),pending:'retreat'}},false),/ST2/);
  assert.equal(transitionWait(before,after,{2:arm()},false),null);
});
