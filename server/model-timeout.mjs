/** Total deadlines are caller-owned; streaming uses a resettable inactivity clock. */
export function modelTimeout({idleMs,totalMs=Infinity,streaming=false}) {
  const controller=new AbortController();
  let idleTimer,totalTimer;
  const abort=()=>controller.abort(new DOMException('Model request timed out.','TimeoutError'));
  const touch=()=>{
    clearTimeout(idleTimer);
    if(!controller.signal.aborted){idleTimer=setTimeout(abort,Math.max(1,idleMs));}
  };
  touch();
  if(Number.isFinite(totalMs)){totalTimer=setTimeout(abort,Math.max(1,totalMs));}
  return {signal:controller.signal,activity:streaming?touch:()=>{},dispose(){clearTimeout(idleTimer);clearTimeout(totalTimer);}};
}
