// Presentation only: these controls never change plant events or robot commands.
export function initExperience({robots,focusStation,stage}) {
  const $=id=>document.getElementById(id);
  let selected=1,follow=false,lastActive=null,timer=0;
  const joints=$('jointReadout');
  joints.innerHTML=Array.from({length:6},(_,i)=>`<div class="joint-cell"><span>J${i+1}</span><b>0.0°</b><div class="joint-track"><i></i></div></div>`).join('');
  const cells=[...joints.children];
  const background=[...document.querySelectorAll('.topbar,.overview,.summary,.side-panel,#demo,.dashboard-footer,#banner')];
  const originalInert=background.map(el=>el.inert);
  function select(id){selected=id;$('inspectorName').textContent=`ST${id} · 로봇${id}`;}
  function setFollow(value){follow=value;lastActive=null;$('followToggle').setAttribute('aria-pressed',String(value));}
  function setFocus(value){
    document.body.classList.toggle('focus-mode',value);
    $('focusToggle').setAttribute('aria-pressed',String(value));
    $('focusToggle').textContent=value?'집중 모드 닫기 ↙':'집중 모드 ↗';
    background.forEach((el,i)=>el.inert=value||originalInert[i]);
    if(value)$('focusToggle').focus({preventScroll:true});
  }
  $('focusToggle').addEventListener('click',()=>setFocus(!document.body.classList.contains('focus-mode')));
  $('followToggle').addEventListener('click',()=>setFollow(!follow));
  document.getElementById('robots').addEventListener('click',e=>{
    const button=e.target.closest('[data-focus-st]');if(button){select(Number(button.dataset.focusSt));setFollow(false);}
  });
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setFollow(false)));
  stage.onUserOrbit(()=>setFollow(false));
  document.addEventListener('keydown',e=>{
    if(e.altKey||e.ctrlKey||e.metaKey||e.repeat||e.target.closest('input,select,textarea,[contenteditable="true"]'))return;
    if(e.key==='Escape'){setFocus(false);return;}
    if(e.key.toLowerCase()==='f'){e.preventDefault();setFocus(!document.body.classList.contains('focus-mode'));}
    if(['1','2','3'].includes(e.key)){e.preventDefault();document.querySelector(`[data-view="${['front','top','free'][Number(e.key)-1]}"]`)?.click();}
    if(e.code==='Space'&&!e.target.closest('button,a')&&!$('demo').hidden&&!$('demoPause').disabled){e.preventDefault();$('demoPause').click();}
  });
  // Escape also works when the focused element is a button in the scene toolbar.
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('focus-mode')){setFocus(false);$('focusToggle').focus({preventScroll:true});}});
  return {
    tick(dt){
      timer+=dt;if(timer<.1)return;timer=0;
      const active=Object.entries(robots.robots).find(([,r])=>(r.state==='BUSY'||r.assembly)&&r.connected);
      if(follow&&active&&lastActive!==active[0]){lastActive=active[0];select(Number(active[0]));focusStation(selected);}
      if(!active)lastActive=null;
      const r=robots.robots[selected];
      $('inspectorState').textContent=r.blocked?'이동 보류':!r.connected?'연결 끊김':r.motion.segment?(r.enabled?'동작 중':'동작 정지'):'대기';
      $('inspectorState').dataset.blocked=String(!!r.blocked);
      r.q.forEach((q,i)=>{
        cells[i].querySelector('b').textContent=`${(Math.abs(q)<.05?0:q).toFixed(1)}°`;
        const [lo,hi]=r.limits[i];cells[i].querySelector('i').style.width=`${Math.max(0,Math.min(100,100*(q-lo)/(hi-lo)))}%`;
      });
      const actor=active?robots.robots[active[0]]:r;
      const total=actor.totalDuration??0;
      const remaining=(actor.motion.segment?actor.motion.segment.duration-actor.motion.segment.elapsed:0)+actor.motion.queue.reduce((sum,p)=>sum+p.seconds,0);
      const progress=total?Math.max(0,Math.min(1,1-remaining/total)):0;
      $('motionActor').textContent=active?`ST${active[0]} · 작업 중`:`ST${selected} · ${r.motion.segment?'복귀 중':'대기'}`;
      $('motionPhase').textContent=actor.blocked?'간섭 확인 · 이동 보류':!actor.enabled?'동작 정지':actor.motion.segment?actor.motion.phase:'다음 작업을 기다립니다';
      $('motionMeter').value=actor.motion.segment?Math.round(progress*100):0;
      $('motionPercent').textContent=actor.motion.segment?`${Math.round(progress*100)}%`:'—';
    }
  };
}
