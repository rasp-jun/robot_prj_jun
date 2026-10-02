import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {fixture} from './scene-fixture.mjs';
import {createRobotFinish,CAP_DETAILS,capMatrices} from '../client/scene/robot-finish.js';
test('surface finishes preserve every STL vertex, normal and collision bound',()=>{
  const robot=fixture().robot(1),geometries=Object.fromEntries(robot.links.map((m,i)=>[`Indy7_${i}.stl`,m.geometry]));
  const original=robot.links.map(m=>({position:m.geometry.attributes.position.array.slice(),normal:m.geometry.attributes.normal.array.slice()}));
  const material=createRobotFinish(geometries);
  robot.links.forEach((mesh,i)=>{
    const g=mesh.geometry;
    assert.deepEqual(g.attributes.position.array,original[i].position);
    assert.deepEqual(g.attributes.normal.array,original[i].normal);
    assert.equal(g.attributes.finishLink.count,g.attributes.position.count);
    assert.ok([...g.attributes.finishLink.array].every(v=>v===i));
  });
  assert.equal(material.customProgramCacheKey(),"indy7-finish-v1");
  material.dispose();
});
test('visual fasteners stay within existing link collision envelopes',()=>{
  const robot=fixture().robot(1);
  for(const cap of CAP_DETAILS){
    const g=robot.links[cap.link].geometry;g.computeBoundingBox();
    const envelope=g.boundingBox.clone().expandByScalar(.012);
    for(const matrix of capMatrices(cap)){
      const bounds=new THREE.Box3(new THREE.Vector3(-.003,-.001,-.003),new THREE.Vector3(.003,.001,.003)).applyMatrix4(matrix);
      assert.ok(envelope.containsBox(bounds),`link${cap.link}: decorative hardware exceeds guard`);
    }
  }
});
