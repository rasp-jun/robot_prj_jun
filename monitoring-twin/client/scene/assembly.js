import * as THREE from 'three';
import {makeTank} from './pallets.js';
import {CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';

// Illustrative fixture dimensions, not surveyed hardware dimensions.
export const TOOL_LENGTH=.105;
export const ASSEMBLY_JOBS={ROBOT1_HULL_PLACE:'hull',ROBOT1_POWERPACK_MOUNT:'pp',ROBOT2_TURRET_MATE:'turret'};
const metal=new THREE.MeshStandardMaterial({color:0x68767d,metalness:.75,roughness:.3});
const rubber=new THREE.MeshStandardMaterial({color:0x263338,roughness:.75});
const frame=new THREE.MeshStandardMaterial({color:0x3b454c,metalness:.5,roughness:.45});
function box(parent,size,position,material=frame){const m=new THREE.Mesh(new THREE.BoxGeometry(...size),material);m.position.set(...position);m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
export function createSuctionTool(tcp){
  const group=new THREE.Group();tcp.add(group);
  for(const [radius,height,z,material] of [[.027,.015,.008,metal],[.012,.063,.046,metal],[.021,.016,.086,rubber],[.026,.012,.099,rubber]]){
    const m=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius*.9,height,20),material);m.rotation.x=Math.PI/2;m.position.z=z;group.add(m);
  }
  const lamp=new THREE.Mesh(new THREE.SphereGeometry(.006,8,6),new THREE.MeshStandardMaterial({color:0x78998c,emissive:0x299f79,emissiveIntensity:0}));lamp.position.set(.019,0,.025);group.add(lamp);
  const hose=new THREE.Mesh(new THREE.TorusGeometry(.019,.003,6,18,Math.PI),rubber);hose.position.set(.014,0,.038);hose.rotation.y=Math.PI/2;group.add(hose);
  return {group,setVacuum(on){lamp.material.emissiveIntensity=on?2:0;}};
}
export function createSupply(line){
  const fixtures=[],bins={};
  for(const station of [1,2]){
    const mount=line.getObjectByName(`Robot_Mount_ST${station}`).getWorldPosition(new THREE.Vector3());
    const table=new THREE.Group();table.position.set(mount.x,.0,mount.z-.48);line.add(table);
    table.name=`부품 공급대 ST${station}`;
    fixtures.push(box(table,[.65,.035,.34],[0,.765,0]));
    for(const x of [-.28,.28])for(const z of [-.13,.13])fixtures.push(box(table,[.026,.75,.026],[x,.375,z]));
    for(const [key,x] of station===1?[['hull',-.17],['pp',.16]]:[['turret',0]]){
      const nest=new THREE.Group();nest.position.set(x,.787,0);table.add(nest);
      fixtures.push(box(nest,[.27,.008,.25],[0,0,0],metal));
      const shelves=[];
      for(let i=0;i<3;i++)shelves.push(box(nest,[.255,.008,.22],[0,.041+i*.085,0],metal));
      for(const x of [-.13,.13])box(nest,[.012,.255,.014],[x,.127,-.112]);
      bins[key]={nest,station,stock:[],used:0,shelves};
    }
  }
  line.updateMatrixWorld(true);
  return {bins,fixtures};
}

// A physical-looking handoff: part coordinates remain rigidly attached to the TCP.
export function attachPart(tcp,part){
  tcp.attach(part);
  // Capture the contact transform; neither the part nor cup jumps at pickup.
}

export function stockSupply(supply,spec){
  for(const [key,bin] of Object.entries(supply.bins)){
    for(let i=0;i<3;i++){
      const tank=makeTank(spec),part=tank.userData[key];tank.remove(part);
      part.position.set(0,0,0);part.updateMatrixWorld(true);
      const bounds=new THREE.Box3().setFromObject(part),height=bounds.max.y-bounds.min.y;
      part.position.y=.045+i*.085-bounds.min.y;bin.nest.add(part);bin.stock.push(part);
      part.userData.height=height;part.userData.home=part.position.clone();
    }
    const el=document.createElement('div');el.className='label3d';
    const name={hull:'차체',pp:'파워팩',turret:'포탑'}[key];
    const label=new CSS2DObject(el);label.position.set(0,.36,0);bin.nest.add(label);
    bin.label=el;bin.title=name;
  }
  const update=()=>Object.values(supply.bins).forEach(b=>b.label.textContent=`${b.title} 준비 · ${3-b.used}/3`);
  update();
  return {
    reset(){for(const b of Object.values(supply.bins)){b.used=0;for(const p of b.stock){b.nest.add(p);p.position.copy(p.userData.home);p.quaternion.identity();p.visible=true;}}update();},
    take(key){const b=supply.bins[key],part=b.stock[2-b.used];if(!part)return null;b.used++;update();return part;},
    peek(key){const b=supply.bins[key];return b.stock[2-b.used];},
  };
}
