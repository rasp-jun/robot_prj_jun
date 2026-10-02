import fs from 'node:fs';
import * as THREE from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
const assets=new URL('../../web/assets/',import.meta.url);
export function fixture(){
  const bytes=fs.readFileSync(new URL('ev_line_conveyor.glb',assets));
  const length=bytes.readUInt32LE(12), gltf=JSON.parse(bytes.subarray(20,20+length).toString());
  const binary=bytes.subarray(28+length);
  function attribute(id){
    const a=gltf.accessors[id],v=gltf.bufferViews[a.bufferView];
    const Types={5126:Float32Array,5125:Uint32Array,5123:Uint16Array,5121:Uint8Array};
    const size={SCALAR:1,VEC3:3,VEC2:2,VEC4:4}[a.type],T=Types[a.componentType];
    const start=(v.byteOffset??0)+(a.byteOffset??0);
    const copy=Uint8Array.from(binary.subarray(start,start+a.count*size*T.BYTES_PER_ELEMENT));
    return new THREE.BufferAttribute(new T(copy.buffer),size);
  }
  const nodes=gltf.nodes.map(n=>{
    const group=new THREE.Group();group.name=n.name??'';
    if(n.matrix)new THREE.Matrix4().fromArray(n.matrix).decompose(group.position,group.quaternion,group.scale);
    else {if(n.translation)group.position.fromArray(n.translation);if(n.rotation)group.quaternion.fromArray(n.rotation);if(n.scale)group.scale.fromArray(n.scale);}
    if(n.mesh!==undefined)for(const p of gltf.meshes[n.mesh].primitives){
      const g=new THREE.BufferGeometry();g.setAttribute('position',attribute(p.attributes.POSITION));
      if(p.indices!==undefined)g.setIndex(attribute(p.indices));
      const mesh=new THREE.Mesh(g);mesh.name=n.name;group.add(mesh);
    }
    return group;
  });
  gltf.nodes.forEach((n,i)=>(n.children??[]).forEach(c=>nodes[i].add(nodes[c])));
  const line=new THREE.Group();gltf.scenes[gltf.scene??0].nodes.forEach(i=>line.add(nodes[i]));
  const xml=fs.readFileSync(new URL('indy7/indy7.urdf',assets),'utf8');
  const loader=new STLLoader(),geometries=Array.from({length:7},(_,i)=>{
    const b=fs.readFileSync(new URL(`indy7/meshes/Indy7_${i}.stl`,assets));
    return loader.parse(Uint8Array.from(b).buffer);
  });
  function robot(station){
    const rig=new THREE.Group();rig.name=`Indy7_ST${station}`;rig.rotation.y=-Math.PI/2;
    line.getObjectByName(`Robot_Mount_ST${station}`).add(rig);
    const obj=new THREE.Group();obj.rotation.x=-Math.PI/2;rig.add(obj);
    const links=geometries.map((g,i)=>{const mesh=new THREE.Mesh(g);mesh.name='link'+i;return mesh;});
    obj.add(links[0]);const joints=[],origins=[],limits=[];
    for(const match of xml.matchAll(/<joint name="joint(\d)" type="revolute">([\s\S]*?)<\/joint>/g)){
      const i=Number(match[1]),body=match[2],joint=new THREE.Group();
      const tag=body.match(/<origin[^>]+>/)[0];
      joint.position.fromArray(tag.match(/xyz="([^"]+)/)[1].trim().split(/\s+/).map(Number));
      const [r,p,y]=tag.match(/rpy="([^"]+)/)[1].trim().split(/\s+/).map(Number);
      joint.quaternion.setFromEuler(new THREE.Euler(r,p,y,'ZYX'));origins.push(joint.quaternion.clone());
      links[i].add(joint);joint.add(links[i+1]);joints.push(joint);
      limits.push(['lower','upper'].map(k=>Number(body.match(new RegExp(k+'="([^"]+)'))[1])*180/Math.PI));
    }
    return {obj,links,limits,set(q){joints.forEach((j,i)=>j.quaternion.copy(origins[i]).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),q[i]*Math.PI/180)));line.updateMatrixWorld(true);}};
  }
  return {line,robot};
}
