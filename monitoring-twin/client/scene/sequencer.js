// Presentation ordering only. Gateway state and recorded production times are untouched.
export const armOccupied=r=>!!(r.blocked||r.assembly||r.jobs?.length||r.motion?.segment||r.pending||r.state==='BUSY');
export function motionPermitted(snapshot,{online=true,playback=null}={}){
  return online&&snapshot.link.gateway&&snapshot.link.plc
    &&!['ESTOP','PAUSE'].includes(snapshot.line.state)&&playback?.state!=='PAUSED'
    &&(snapshot.line.state==='RUN'||playback?.state==='COMPLETED');
}
export function transitionWait(previous,next,robots,transporting){
  if(!previous)return null;
  const moved=previous.pallets.some(p=>!next.pallets.some(n=>n.id===p.id&&n.cv===p.cv));
  const departing=(next.conveyors??[]).some(c=>c.state==='DEPARTING'&&(previous.conveyors??[]).find(p=>p.cv===c.cv)?.state!=='DEPARTING');
  if(moved||departing){
    const active=Object.entries(robots).find(([,r])=>armOccupied(r));
    if(active)return `ST${active[0]} 작업·복귀 완료 대기`;
    if(transporting)return '팔레트 도착 대기';
  }
  for(const s of next.robots){
    const before=previous.robots.find(r=>r.robot===s.robot);
    if(s.state!=='BUSY'||(before?.state==='BUSY'&&before.job===s.job))continue;
    const r=robots[s.robot];
    // Fault recovery resumes the existing task, never starts a second copy.
    if(r.motionJob===s.job&&before?.state==='ERR')continue;
    if(r.motion?.segment||r.assembly||r.pending||r.blocked)return `ST${s.robot} 앞 작업·복귀 완료 대기`;
    if(transporting)return '팔레트 정위치 도착 대기';
  }
  return null;
}

export class SceneSequencer {
  constructor({wait,apply}){this.wait=wait;this.apply=apply;this.queue=[];this.current=null;this.reason=null;}
  push(snapshot,playback,event,reset=false){
    if(reset){this.queue=[];this.current=null;this.reason=null;this.apply(snapshot,playback,event,true);this.current=snapshot;return;}
    this.queue.push({snapshot,playback,event});
    this.flush();
  }
  flush(){
    while(this.queue.length){
      const next=this.queue[0];this.reason=this.wait(this.current,next.snapshot);
      if(this.reason)return;
      this.queue.shift();this.apply(next.snapshot,next.playback,next.event,false);this.current=next.snapshot;
    }
    this.reason=null;
  }
}
