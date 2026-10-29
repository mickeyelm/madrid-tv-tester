(function(global){
  "use strict";
  var root=document.getElementById("layer-dikpix"),canvas=document.getElementById("dikpix-tv-canvas"),empty=document.getElementById("dikpix-tv-empty"),presence=document.getElementById("dikpix-tv-presence"),core=global.MadridDikPixCore;
  if(!root||!canvas||!core){return;}
  root.classList.add("dp-tv-studio");canvas.width=720;canvas.height=500;
  root.querySelector(".dikpix-tv-header strong").textContent="diK·pix — make a beautiful mess";
  var footer=root.querySelector(".dikpix-tv-actions");footer.removeAttribute("aria-hidden");footer.innerHTML='<span id="dp-tv-page">Your picture, on television.</span><button id="dp-tv-sound" class="dp-tv-audio" type="button">♪ Enable sound</button>';
  if(empty){empty.innerHTML='<strong>A little mess.<br>A whole new world.</strong><span>Open the remote, grab a crayon, and give this picture a life.</span>';}
  var active=false,board={actions:[],rev:-1},lastFrame=0,lastAction=0,wasPlaying=false,soundReady=false,audio=global.MadridDikPixAudio&&global.MadridDikPixAudio.create(function(message){var button=document.getElementById("dp-tv-sound");button.hidden=false;button.textContent="♪ Tap for sound";button.title=message;});
  function unlock(){if(audio){audio.unlock().then(function(ok){soundReady=ok;document.getElementById("dp-tv-sound").hidden=ok;});}}
  document.getElementById("dp-tv-sound").addEventListener("click",unlock);
  document.addEventListener("pointerdown",function(){if(active&&!soundReady){unlock();}},{passive:true});
  function setActive(next,state){
    var entered=next&&!active;active=!!next;state=state||{};board=state;
    if(!active){if(audio){audio.stop();}wasPlaying=false;return;}
    if(entered){unlock();lastAction=Math.max.apply(null,[0].concat((core.currentPage(board).actions||[]).map(a=>a.id||0)));}
    var players=state.players||[];presence.textContent=players.length+(players.length===1?" hand making trouble":" hands making trouble");
    var actions=core.currentPage(board).actions||[],newActions=actions.filter(a=>(a.id||0)>lastAction);
    if(newActions.length&&!entered&&audio){var action=newActions[newActions.length-1];audio.tool(action.tool||action.kind,action.y||.5,false);}
    if(newActions.length){lastAction=Math.max.apply(null,[lastAction].concat(newActions.map(a=>a.id||0)));}
  }
  function frame(now){
    if(active&&!document.hidden&&now-lastFrame>32){
      lastFrame=now;var shot=core.renderShow(canvas,board,Date.now()/1000),actions=shot.page.actions||[];
      if(empty){empty.style.display=actions.slice(actions.map(a=>a.kind).lastIndexOf("clear")+1).some(a=>a.kind!=="paper")?"none":"flex";}
      document.getElementById("dp-tv-page").textContent=(shot.playing?"▶ ":"✎ ")+(shot.page.title||"Your picture")+((board.pages||[]).length?"  /  "+(shot.index+1)+" of "+board.pages.length:"");
      if(audio){if(wasPlaying&&!shot.playing){audio.stop();}audio.music(board.show,shot.playing);audio.pageAudio(shot,board.show);}wasPlaying=shot.playing;
    }global.requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange",function(){if(document.hidden&&audio){audio.stop();}});
  global.requestAnimationFrame(frame);global.MadridDikPix={setActive:setActive};
}(window));
