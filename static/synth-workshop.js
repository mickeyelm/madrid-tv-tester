/* Musical gestures shared by the phone instrument and room renderer. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.SynthWorkshop=api;}(typeof self!=='undefined'?self:this,function(){
'use strict';
const names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const roles={drums:{name:'DRUMS',color:'#df5934',sound:'harp'},bass:{name:'BASS',color:'#bdad43',sound:'bass'},chords:{name:'CHORDS',color:'#63898f',sound:'keys'},melody:{name:'MELODY',color:'#9771ae',sound:'harp'}};
function key(synth){return synth.tonality||{root:0,scale:'major'};}
function pad(role,index,synth){
 const k=key(synth),minor=k.scale==='minor',scale=minor?[0,2,3,5,7,8,10,12]:[0,2,4,5,7,9,11,12];
 if(role==='drums'){const lane=['kick','snare','hat','clap'][index%4];return {label:['KICK','SNARE','HI-HAT','CLAP','SOFT KICK','RIM','TICK','GHOST CLAP'][index],notes:[{lane,velocity:index<4?.92:.43}]};}
 if(role==='chords'){
  const degree=(minor?[5,6,0,1,2,3,4,5]:[0,1,2,3,4,5,6,7])[index],quality=['maj','min','min','maj','7','min','maj','maj'][degree];
  const pitch=([0,2,4,5,7,9,10,8][degree]+k.root+(minor?3:0))%12;
  return {label:names[pitch]+(quality==='min'?'m':quality==='7'?'7':'maj7'),notes:[{degree,quality,duration:2,velocity:.8}]};
 }
 const note=(role==='bass'?48:60)+k.root+scale[index];
 return {label:names[note%12],notes:[{note,velocity:.8,duration:role==='bass'?.6:.8}]};
}
function roleOf(event){return event.kind==='drum'?'drums':event.kind==='chord'?'chords':(event.instrument==='bass'||event.instrument==='organ')?'bass':'melody';}
function hash(n){const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);}
function vary(event,absoluteBeat,settings){
 const result={...event},role=roleOf(event),cycle=Math.max(0,Math.floor(absoluteBeat/32)-Number(event.born||0));
 if(!settings?.enabled||(settings.locks||[]).includes(role)||cycle===0)return result;
 const amount=Math.max(0,Math.min(1,Number(settings.amount)||0)),seed=(event.id||0)+cycle*29;
 // No melody deletion and no event writes: switching Wander off restores the exact score.
 if(event.kind==='note'&&role==='melody'&&hash(seed)<amount*.35)result.note=Math.min(96,event.note+12);
 result.velocity=Math.max(.2,Math.min(1,(event.velocity||.75)*(1+(hash(seed+3)-.5)*amount*.45)));
 if(event.kind==='drum'&&event.lane==='hat'&&hash(seed+8)<amount*.35)result.ratchet=true;
 if(event.kind==='chord')result.duration=Math.max(.5,(event.duration||2)*(1+(hash(seed+13)-.5)*amount*.6));
 return result;
}
function createRoomWatch(options){
 let running=false,timer=null,request=null,deadline=null,failures=0,generation=0;
 function stop(){running=false;generation++;if(timer!==null)clearTimeout(timer);timer=null;if(deadline!==null)clearTimeout(deadline);deadline=null;if(request)request.abort();request=null;}
 async function poll(){
  timer=null;
  if(!running||!options.enabled()){stop();return;}
  if(request)return;
  const token=generation,controller=new AbortController(),before=Number(options.rev()||0);request=controller;
  const timeout=setTimeout(()=>controller.abort(),23000);deadline=timeout;let delay=250;
  try{
   const response=await fetch('/api/synth/events?since='+before+'&wait_ms=20000',{signal:controller.signal});
   if(!response.ok)throw Error('Room unavailable');
   const incoming=await response.json();
   if(token!==generation)return;
   if(!incoming||!incoming.synth)throw Error('Invalid room state');
   options.receive(incoming);failures=0;
   // An unchanged/stale immediate reply must not become a busy loop.
   delay=Number(incoming.synth.rev)>before?0:250;
   if(incoming.channel!=='synth'){stop();return;}
  }catch(error){if(token!==generation)return;failures=Math.min(5,failures+1);delay=Math.min(8000,500*Math.pow(2,failures-1));}
  finally{
   clearTimeout(timeout);
   if(token===generation){request=null;deadline=null;if(running&&options.enabled())timer=setTimeout(poll,delay);else stop();}
  }
 }
 return {start(){if(running)return;running=true;failures=0;poll();},stop};
}
return {roles,pad,roleOf,vary,names,createRoomWatch};
}));
