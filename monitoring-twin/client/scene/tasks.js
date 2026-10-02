import {inverseKinematics} from "./kinematics.js";
import {planRoute} from "./collision.js";
// Task targets are anchored to the displayed equipment, not arbitrary joint angles.
export function taskTargets(job,{work,pass,fail,ng=false,pickup},duration){
  const at=(p,dx=0,dy=0,dz=0)=>[p[0]+dx,p[1]+dy,p[2]+dz];
  const side=job==='ROBOT1_POWERPACK_MOUNT'?-.16:.16;
  let points;
  if(pickup){
    points=[[at(pickup,0,.14,0),.12,'공급대 접근'],[pickup,.12,'흡착 패드 하강'],[pickup,.07,'진공 형성 · 흡착 확인','grip'],[at(pickup,0,.12,0),.14,'부품 들어올리기'],[at(work,0,.22,0),.24,'흡착 운반 · 조립 정렬'],[work,.16,'부품 내려놓기'],[work,.07,'진공 해제 · 안착 확인','release'],[at(work,0,.20,0),.08,'흡착 툴 후퇴']];
  } else if(job==='ROBOT2_WELD_MOTION')points=[
    [at(work,.12,.16,-.16),.16,'용접 접근'],[at(work,.055,.025,.025),.18,'용접 시작점'],
    [at(work,-.055,.025,.025),.18,'용접 경로 1/3'],[at(work,-.055,.025,-.025),.16,'용접 경로 2/3'],
    [at(work,.055,.025,-.025),.16,'용접 경로 3/3'],[at(work,.12,.16,-.16),.16,'툴 후퇴']];
  else if(job==='ROBOT3_SORT'){
    const tray=ng?fail:pass;
    points=[[at(work,0,.16,-.12),.14,'검사품 접근'],[work,.2,'검사품 집기'],
      [at(work,0,.24,-.14),.18,'검사품 들어올리기'],[at(tray,0,.24,0),.28,ng?'불합격 트레이 이동':'합격 트레이 이동'],
      [tray,.2,'트레이 안착']];
  } else points=[
    [at(work,side,.16,-.24),.18,'부품 접근'],[at(work,side,.08,-.24),.16,'부품 집기'],
    [at(work,side,.24,-.24),.16,'부품 들어올리기'],[at(work,.12,.16,-.16),.2,'조립 위치 정렬'],
    [work,.22,'부품 안착'],[at(work,.12,.16,-.16),.08,'툴 후퇴']];
  return points.map(([target,fraction,label,action])=>({target,seconds:duration*fraction,label,action,directions:pickup?[[0,-1,0]]:undefined}));
}

export function solveTask(targets,from,limits,forward,check){
  const points=[];let seed=[...from];
  for(const point of targets){
    let found=null;
    for(const direction of point.directions??[[0,-1,0],[-Math.SQRT1_2,-Math.SQRT1_2,0],[0,-.3,Math.sqrt(.91)]]){
      const guesses=[seed,[23,-32,-99,0,-64,0],[35,-40,-136,34,70,0],[145,-25,-100,0,-65,0],[-145,-25,-100,0,-65,0]];
      if(point.directions)for(const q of [...guesses])for(const wrist of [-160,-90,90,160])guesses.push([...q.slice(0,5),wrist]);
      for(const guess of guesses){
        const q=inverseKinematics(forward,point.target,guess,limits,direction,point.directions?[1,0,0]:null);
        if(q&&!check(q)&&!planRoute(seed,q,check).failure){found=q;break;}
      }
      if(found)break;
    }
    if(!found)return {points:[],failure:{kind:'unreachable',name:point.label}};
    points.push({q:found,seconds:point.seconds,label:point.label,action:point.action});seed=found;
  }
  return {points};
}

