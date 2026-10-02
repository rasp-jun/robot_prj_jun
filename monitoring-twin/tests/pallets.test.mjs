import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as THREE from "../client/vendor/three/build/three.module.js";
import {JointMotion,smooth} from "../client/scene/motion.js";

const code=fs.readFileSync(new URL("../client/scene/pallets.js",import.meta.url),"utf8")
  .replace(/^import[^\n]*\n/gm,"").replaceAll("export function", "function");
const manifest=JSON.parse(fs.readFileSync(new URL("../assets/manifest.json",import.meta.url),"utf8"));
function fixture(){
  const root=new THREE.Group();
  const line=new THREE.Group();line.add(root);
  const group=(name,parent=root,x=0,y=0,z=0)=>{const o=new THREE.Group();o.name=name;o.position.set(x,y,z);parent.add(o);return o;};
  for(const n of [1,2,3]){
    const p=new THREE.Mesh(new THREE.BoxGeometry(.28,.01,.2),new THREE.MeshStandardMaterial());
    p.name="Pallet_0"+n;p.position.set(-1.1,.8,0);root.add(p);
  }
  group("Conveyor_Belt");
  for(const side of ["Pass","Fail"])for(const n of [1,2,3])group("Tray_"+side+"_Slot_0"+n,root,1.1,.8,side==="Pass"?.4:-.4);
  const rack=group("Storage_Rack",root,2.18,.8,0);
  for(const n of [1,2,3])group("Storage_Slot_0"+n,rack,0,(n-1)*.18,0);
  const context={THREE,JointMotion,smooth,document:{createElement:()=>({dataset:{}})},CSS2DObject:class extends THREE.Object3D{constructor(el){super();this.element=el;}}};
  vm.createContext(context);vm.runInContext(code,context);
  const zones=Object.fromEntries([-1.1,-.55,0,1.1,1.7].map((x,i)=>[i+1,{center:x}]));
  const api=context.createPallets({line,root,zones,info:{belt_top_m:.8,storage_pitch:.18,belt_tile_m:.1}},manifest);
  const slot=(n)=>line.getObjectByName("Storage_Slot_0"+n).children[0];
  return {root,line,rack,api,slot};
}
const snapshot=(pallets=[],count=0,pass=0,fail=0,state="READY")=>({
  pallets,storage:{count},trays:{pass,fail},link:{robots:[true,true,true]},
  robots:[{robot:3,state,job:"ROBOT3_SORT"}],conveyors:[1,2,3,4,5].map(cv=>({cv,state:"EMPTY"}))
});
const pallet=(cv,stage=null)=>({id:"P1",cv,stage,ng:false});
test("storage pallet seats before rack moves; there is no duplicate on arrival",()=>{
  const f=fixture();
  f.api.update(snapshot([pallet(5)]),null,true);
  f.api.update(snapshot([],1));
  assert.equal(f.slot(1).visible,false);
  f.api.tick(.6);assert.equal(f.rack.position.y,.8);
  f.api.tick(.6);assert.equal(f.slot(1).visible,true);assert.equal(f.rack.position.y,.8);
  f.api.tick(.6);assert.ok(f.rack.position.y<.8&&f.rack.position.y>.62);
  f.api.tick(.6);assert.ok(Math.abs(f.rack.position.y-.62)<1e-8);
  assert.equal(f.root.children.filter(o=>o.userData.tank).length,0);
});
test("restart clears incoming ghosts and resets storage pose",()=>{
  const f=fixture();
  f.api.update(snapshot([pallet(5)]),null,true);
  f.api.update(snapshot([],1));f.api.tick(.4);
  f.api.update(snapshot([pallet(1)]),null,true);
  f.api.tick(2);
  assert.equal(f.slot(1).visible,false);assert.equal(f.rack.position.y,.8);
  assert.equal(f.root.children.filter(o=>o.userData.tank).length,1);
});
test("sorting keeps partial assembly and commits to the tray only once",()=>{
  const f=fixture();
  const source=pallet(4,"HULL");
  f.api.update(snapshot([source]),null,true);
  f.api.update(snapshot([source],0,0,0,"BUSY"));
  f.api.tick(2);
  const carried=f.root.children.filter(o=>o.userData.hull);
  assert.equal(carried.length,1);
  assert.equal(carried[0].visible,true);
  f.api.update(snapshot([source],0,0,0,"BUSY")); // duplicate snapshot must not duplicate the payload
  assert.equal(f.root.children.filter(o=>o.userData.hull).length,1);
  f.api.update(snapshot([pallet(4)],0,1,0,"DONE"));
  f.api.tick(3);
  const placed=f.line.getObjectByName("Tray_Pass_Slot_01").children[0];
  assert.equal(placed.visible,true);assert.equal(placed.userData.turret.visible,false);
  assert.equal(f.root.children.filter(o=>o.userData.hull).length,0);
});
test("sorting waits when the sorting robot disconnects",()=>{
  const f=fixture(),s=snapshot([pallet(4,"TURRET")],0,0,0,"BUSY");
  f.api.update(s,null,true);f.api.update(s);
  const object=f.root.children.find(o=>o.userData.hull);
  const start=object.position.clone();
  s.link.robots[2]=false;f.api.update(s);f.api.tick(10);
  assert.ok(object.position.equals(start));assert.equal(object.visible,false);
});

test("transport preview restores both the displayed pose and the motion clock",()=>{
  const f=fixture();f.api.update(snapshot([pallet(1)]),null,true);
  f.api.update(snapshot([pallet(3)]));
  const obj=f.root.children.find(o=>o.userData.tank),before=obj.position.clone();
  const allowed=f.api.previewTransport(.5,()=>{assert.ok(obj.position.x>before.x);return false;});
  assert.equal(allowed,false);assert.ok(obj.position.equals(before));
  f.api.previewTransport(.5,()=>true);f.api.tick(.5);
  assert.ok(obj.position.x>before.x);
});
test("carried product waits for the arm, follows its TCP, and settles once",()=>{
  const f=fixture(),source=pallet(4,"TURRET");
  f.api.update(snapshot([source]),null,true);f.api.update(snapshot([source],0,0,0,"BUSY"));
  const obj=f.root.children.find(o=>o.userData.hull);
  f.api.tick(10,{active:false,position:[0,0,0]});assert.equal(obj.visible,false);
  f.api.tick(.1,{active:true,position:[1.2,1.4,-.3]});
  assert.equal(obj.visible,true);assert.ok(obj.position.distanceTo(new THREE.Vector3(1.2,1.28,-.3))<1e-8);
  f.api.update(snapshot([pallet(4)],0,1,0,"DONE"));
  f.api.tick(.1,{active:false,position:[0,0,0]});
  assert.ok(f.root.children.includes(obj));
  f.api.tick(.5,{active:false,position:[0,0,0]});assert.ok(!f.root.children.includes(obj));
  assert.equal(f.line.getObjectByName("Tray_Pass_Slot_01").children[0].visible,true);
});

test("assembly stays hidden until vacuum release, including early stage events",()=>{
  const f=fixture();f.api.update(snapshot([pallet(1)]),null,true);
  const target=f.api.assemblyTarget(1,'hull');assert.ok(target);target.prepare();
  f.api.update(snapshot([pallet(1,'HULL')]));assert.equal(target.part.visible,false);
  target.release();assert.equal(target.part.visible,true);
  f.api.update(snapshot([pallet(1,'HULL')]));assert.equal(target.part.visible,true);
  assert.equal(target.pallet.userData.tank.userData.insertion,undefined);
});


test("transport interlock freezes conveyor clocks while carried product still follows the arm",()=>{
  const f=fixture();f.api.update(snapshot([pallet(4,'TURRET')]),null,true);
  f.api.update(snapshot([pallet(4,'TURRET')],0,0,0,'BUSY'));
  f.api.tick(.2,{active:true,position:[1.15,1.3,.2]},false);
  const carried=f.root.children.find(o=>o.userData.hull);
  assert.equal(carried.visible,true);assert.ok(Math.abs(carried.position.y-1.18)<1e-8);
  f.api.update(snapshot([pallet(5,'TURRET')],0,0,0,'BUSY'));
  const source=f.root.children.find(o=>o.userData.tank),x=source.position.x;
  f.api.tick(.5,{active:true,position:[1.2,1.4,.3]},false);
  assert.equal(source.position.x,x);assert.ok(Math.abs(carried.position.y-1.28)<1e-8);
  assert.equal(f.api.transporting(),true);
});
