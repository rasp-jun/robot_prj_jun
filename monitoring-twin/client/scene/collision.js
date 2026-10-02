// Conservative visual envelopes: STL link boxes against the actual GLB triangles.
// This is a simulator guard, not a certified physical robot safety system.
import * as THREE from "three";
import { OBB } from "three/addons/math/OBB.js";

const V = THREE.Vector3;
export const CLEARANCE = .012; // Assumed 12 mm visual clearance; adjustable in manifest.
export function meshEnvelope(mesh, margin = CLEARANCE) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const local = mesh.geometry.boundingBox.clone().expandByScalar(margin);
  return {mesh, local, obb:new OBB(), bounds:new THREE.Box3(), inverse:new THREE.Matrix4()};
}
export function refreshEnvelope(e) {
  e.obb.fromBox3(e.local).applyMatrix4(e.mesh.matrixWorld);
  e.local.getCenter(e.obb.center).applyMatrix4(e.mesh.matrixWorld);
  e.bounds.copy(e.local).applyMatrix4(e.mesh.matrixWorld);
  e.inverse.copy(e.mesh.matrixWorld).invert();
  return e;
}

// A median-split BVH avoids testing every triangle for every planning sample.
function tree(triangles) {
  const bounds=new THREE.Box3();
  for(const t of triangles) bounds.union(t.bounds);
  if(triangles.length<=16)return {bounds,triangles};
  const size=bounds.getSize(new V()), axis=size.x>size.y?(size.x>size.z?'x':'z'):(size.y>size.z?'y':'z');
  triangles.sort((a,b)=>a.center[axis]-b.center[axis]);
  const mid=Math.floor(triangles.length/2);
  return {bounds,left:tree(triangles.slice(0,mid)),right:tree(triangles.slice(mid))};
}
export class CollisionWorld {
  constructor(line, margin = CLEARANCE) {
    this.margin=margin; this.dynamic=[];
    line.updateMatrixWorld(true);
    const triangles=[];
    line.traverse(mesh=>{
      if(!mesh.isMesh)return;
      for(let p=mesh;p;p=p.parent)if(!p.visible)return;
      // Movable pallets/rack are checked from their live transforms below.
      for(let p=mesh;p;p=p.parent) if(/^(Indy7_|Pallet_|Storage_Rack)/.test(p.name))return;
      const pos=mesh.geometry.attributes.position, index=mesh.geometry.index;
      for(let i=0;i<(index?.count??pos.count);i+=3){
        const vertices=[0,1,2].map(k=>new V().fromBufferAttribute(pos,index?index.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld));
        const bounds=new THREE.Box3().setFromPoints(vertices);
        triangles.push({mesh,vertices,bounds,center:bounds.getCenter(new V()),name:mesh.name});
      }
    });
    this.tree=tree(triangles); this.triangle=new THREE.Triangle();
  }
  setDynamic(meshes) {this.dynamic=meshes.map(m=>meshEnvelope(m,this.margin));}
  staticHit(envelope,node=this.tree) {
    if(!envelope.bounds.intersectsBox(node.bounds))return null;
    if(!node.triangles)return this.staticHit(envelope,node.left)||this.staticHit(envelope,node.right);
    for(const t of node.triangles){
      if(envelope.ignoreStatic?.has(t.mesh))continue;
      if(!envelope.bounds.intersectsBox(t.bounds))continue;
      [this.triangle.a,this.triangle.b,this.triangle.c].forEach((v,i)=>v.copy(t.vertices[i]).applyMatrix4(envelope.inverse));
      if(envelope.local.intersectsTriangle(this.triangle))return t.name;
    }
    return null;
  }
  check(parts,others=[], {dynamic=true}={}) {
    for(const part of parts){
      // link0 is bolted to the pedestal; only this intentional fixed contact is excluded.
      if(part.link===0)continue;
      if(part.bounds.min.y<0)return {kind:'floor',name:'바닥'};
      const hit=this.staticHit(part);
      if(hit)return {kind:'fixture',name:hit};
      if(dynamic)for(const other of this.dynamic){
        if(part.ignoreDynamic?.has(other.mesh))continue;
        let visible=true; for(let p=other.mesh;p;p=p.parent)if(!p.visible){visible=false;break;}
        if(!visible)continue;
        refreshEnvelope(other);
        if(part.bounds.intersectsBox(other.bounds)&&part.obb.intersectsOBB(other.obb))return {kind:'payload',name:(other.mesh.name||'팔레트 / 제품')+' (링크 '+part.link+')'};
      }
      for(const other of others)if(part.bounds.intersectsBox(other.bounds)&&part.obb.intersectsOBB(other.obb))return {kind:'robot',name:'다른 로봇'};
      for(const other of parts){
        if(part.payload&&other.link>=4)continue; // Held part/tool contact is intentional.
        // Directly connected housings intentionally overlap at the joint bearing.
        if(other.link>=part.link-1)continue;
        if(part.bounds.intersectsBox(other.bounds)&&part.obb.intersectsOBB(other.obb))return {kind:'self',name:`링크 ${other.link} / ${part.link}`};
      }
    }
    return null;
  }
}

export const jointDistance=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
export function checkedEdge(a,b,check,step=2) {
  const count=Math.max(1,Math.ceil(jointDistance(a,b)/step));
  for(let i=0;i<=count;i++){
    const q=a.map((v,k)=>v+(b[k]-v)*i/count), hit=check(q);
    if(hit)return {hit,q};
  }
  return null;
}

// Deterministic, bounded roadmap: try a raised elbow before rotating the base.
// Invalid endpoints are never silently replaced with an unrelated task position.
export function planRoute(from,to,check) {
  let failure=checkedEdge(from,to,check);
  if(!failure)return {points:[to],detour:false};
  if(check(from)||check(to))return {points:[],failure:failure.hit};
  for(const shoulder of [15,30,45,-10])for(const elbow of [-90,-115,-65]){
    const a=[from[0],shoulder,elbow,0,-90,0];
    const b=[to[0],shoulder,elbow,0,-90,0];
    if(!checkedEdge(from,a,check)&&!checkedEdge(a,b,check)&&!checkedEdge(b,to,check))
      return {points:[a,b,to],detour:true};
  }
  return {points:[],failure:failure.hit};
}

export function planMotion(from,points,check,limits,{velocity=110,acceleration=300}={}) {
  const limited=q=>q.some((v,i)=>!Number.isFinite(v)||v<limits[i][0]||v>limits[i][1])?{kind:'limit',name:'관절 한계'}:check(q);
  const result=[];let cursor=from,detours=0;
  for(const point of points){
    const route=planRoute(cursor,point.q,limited);
    if(route.failure)return {points:[],failure:route.failure,detours};
    detours+=Number(route.detour);
    const lengths=route.points.map((q,i)=>jointDistance(i?route.points[i-1]:cursor,q));
    const total=lengths.reduce((a,b)=>a+b,0)||1;
    route.points.forEach((q,i)=>{
      const d=lengths[i];
      // Quintic peak speed = 1.875*d/T; peak acceleration < 5.774*d/T².
      const seconds=Math.max(d?point.seconds*d/total:point.seconds,.08,1.875*d/velocity,Math.sqrt(5.774*d/acceleration));
      result.push({q:[...q],seconds,action:i===route.points.length-1?point.action:undefined,label:i<route.points.length-1?'간섭 회피 · 상승 / 선회':point.label});
    });
    cursor=point.q;
  }
  return {points:result,detours,duration:result.reduce((sum,p)=>sum+p.seconds,0)};
}
