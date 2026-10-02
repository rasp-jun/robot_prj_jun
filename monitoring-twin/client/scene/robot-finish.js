import * as THREE from 'three';

// Surface finishes only: source STL vertices and the kinematic/collision model stay intact.
export function createRobotFinish(geometries){
  const colors=[0xe7ebed,0x35434b,0xa5b0b7,0xd3dbe0].map(c=>new THREE.Color(c));
  const material=new THREE.MeshStandardMaterial({color:0xffffff,metalness:.18,roughness:.36});
  for(const [name,g] of Object.entries(geometries)){
    const link=Number(name.match(/_(\d)\.stl$/)[1]);
    g.setAttribute('finishLink',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(link),1));
  }
  // Fragment-space boundaries remain smooth across the long triangles of the CAD STL.
  material.onBeforeCompile=shader=>{
    shader.uniforms.finishColors={value:colors};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute float finishLink;
      varying vec3 surfacePosition;
      varying float surfaceLink;`).replace('#include <begin_vertex>',`#include <begin_vertex>
      surfacePosition=position;surfaceLink=finishLink;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 surfacePosition;
      varying float surfaceLink;
      uniform vec3 finishColors[4];
      float surfaceFinish(){
        float x=surfacePosition.x,y=surfacePosition.y,z=surfacePosition.z;
        int link=int(surfaceLink+.5);
        if(link==0)return z<.016||x<-.105?1.:z>.072?2.:0.;
        if(link==1){if(z<.012)return 1.;if(y<-.098)return length(vec2(x,z-.222))<.058?2.:1.;}
        if(link==2){if(z>.142&&length(vec2(x,y))<.076)return length(vec2(x,y))>.062?1.:2.;if(z<-.022&&length(vec2(x+.45,y))<.066)return 1.;}
        if(link==3){if(z>-.012&&length(vec2(x,y))<.052)return 2.;if(x<-.252)return 1.;}
        if(link==4){if(z<.008)return 1.;if(y<-.104)return length(vec2(x,z-.083))<.034?2.:1.;}
        if(link==5){if(z>.109&&length(vec2(x,y))<.045)return 2.;if(x<-.155)return 1.;}
        if(link==6)return z<.011?1.:z>.048?3.:2.;
        return 0.;
      }`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        int finish=int(surfaceFinish());
        diffuseColor.rgb*=finishColors[finish];`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=finish==0?.36:finish==1?.63:finish==2?.30:.22;`)
      .replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>
        metalnessFactor=finish==0?.18:finish==1?.25:finish==2?.82:.95;`);
  };
  material.customProgramCacheKey=()=>"indy7-finish-v1";
  return material;
}

// Tiny screw heads fit inside the 12 mm collision envelope; no added link length.
export const CAP_DETAILS=[
  {link:1,center:[0,-.109,.222],normal:[0,-1,0],radius:.053,count:6},
  {link:2,center:[0,0,.155],normal:[0,0,1],radius:.051,count:6},
  {link:4,center:[0,-.114,.083],normal:[0,-1,0],radius:.029,count:6},
  {link:6,center:[0,0,.061],normal:[0,0,1],radius:.032,count:6},
];
const boltGeometry=new THREE.CylinderGeometry(.0026,.0026,.0014,6);
const boltMaterial=new THREE.MeshStandardMaterial({color:0x46535b,roughness:.32,metalness:.85});
export function capMatrices(cap){
  const n=new THREE.Vector3(...cap.normal),u=new THREE.Vector3(1,0,0),v=new THREE.Vector3().crossVectors(n,u);
  const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),n);
  return Array.from({length:cap.count},(_,k)=>{
    const a=k*Math.PI*2/cap.count,position=new THREE.Vector3(...cap.center).addScaledVector(u,Math.cos(a)*cap.radius).addScaledVector(v,Math.sin(a)*cap.radius);
    return new THREE.Matrix4().compose(position,rotation,new THREE.Vector3(1,1,1));
  });
}
export function addRobotHardware(robot,station){
  for(const cap of CAP_DETAILS){
    const bolts=new THREE.InstancedMesh(boltGeometry,boltMaterial,cap.count);
    capMatrices(cap).forEach((m,i)=>bolts.setMatrixAt(i,m));bolts.instanceMatrix.needsUpdate=true;
    bolts.name='Visual_fasteners';bolts.castShadow=false;bolts.receiveShadow=true;
    robot.getObjectByName('link'+cap.link).add(bolts);
  }
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=160;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#27383f';ctx.fillRect(0,0,512,160);
  ctx.fillStyle='#f2f5f6';ctx.font='bold 65px sans-serif';ctx.fillText('INDY7',24,82);
  ctx.fillStyle='#bac8ce';ctx.font='24px sans-serif';ctx.fillText(`STATION 0${station}  /  6 AXIS`,26,127);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  const badge=new THREE.Mesh(new THREE.PlaneGeometry(.073,.023),new THREE.MeshStandardMaterial({map,roughness:.65,metalness:.15}));
  badge.position.set(.103,0,.041);
  badge.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(1,0,0)));
  badge.name='Visual_identification';robot.getObjectByName('link0').add(badge);
}
