// Damped least-squares IK, in world metres and joint degrees. No hardware commands.
function solve(a,b){
  const m=a.map((row,i)=>[...row,b[i]]),n=b.length;
  for(let i=0;i<n;i++){
    let pivot=i;for(let k=i+1;k<n;k++)if(Math.abs(m[k][i])>Math.abs(m[pivot][i]))pivot=k;
    [m[i],m[pivot]]=[m[pivot],m[i]];
    if(Math.abs(m[i][i])<1e-14)return null;
    const d=m[i][i];for(let j=i;j<=n;j++)m[i][j]/=d;
    for(let k=0;k<n;k++)if(k!==i){const f=m[k][i];for(let j=i;j<=n;j++)m[k][j]-=f*m[i][j];}
  }
  return m.map(row=>row[n]);
}
export function inverseKinematics(forward,target,seed,limits,direction=[0,-1,0],side=null){
  const q=[...seed],goal=[...target,...direction.map(v=>v*.18),...(side?side.map(v=>v*.12):[])];
  const values=p=>[...p.position,...p.direction.map(v=>v*.18),...(side?p.side.map(v=>v*.12):[])];
  for(let iteration=0;iteration<110;iteration++){
    const p=forward(q),value=values(p);
    const error=goal.map((v,i)=>v-value[i]);
    if(Math.hypot(...error.slice(0,3))<.003&&Math.hypot(...error.slice(3))<.014)return q;
    const columns=q.map((v,i)=>{
      const probe=[...q];probe[i]+=.15;const p2=forward(probe);
      return values(p2).map((v,k)=>(v-value[k])/.15);
    });
    const a=columns.map((c,i)=>columns.map((d,j)=>c.reduce((s,v,k)=>s+v*d[k],0)+(i===j?2e-6:0)));
    const delta=solve(a,columns.map(c=>c.reduce((s,v,k)=>s+v*error[k],0)));
    if(!delta)return null;
    q.forEach((v,i)=>q[i]=Math.max(limits[i][0]+.1,Math.min(limits[i][1]-.1,v+Math.max(-7,Math.min(7,delta[i])))));
  }
  return null;
}

