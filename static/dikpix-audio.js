(function(global){
  "use strict";
  // Original synthesized sounds. No sampled Kid Pix or commercial sound assets.
  function create(onError){
    var context=null,master=null,compressor=null,voices=[],enabled=true,lastTool=0,musicState=null,lastStep=-1,disposed=false;
    var picture=new Audio(),pictureKey="",picturePending=false,pictureBlocked="",pictureGeneration=0;
    picture.preload="auto";picture.volume=.75;
    picture.addEventListener("error",function(){if(pictureKey&&onError){onError("Picture audio could not play. Try importing it again.");}});
    function unlock(){
      if(disposed){return Promise.resolve(false);}pictureBlocked="";
      // A denied recording must be retried inside this actual user gesture.
      if(pictureKey&&picture.paused&&!picturePending&&enabled){playPicture();}
      try{
        if(!context){var Constructor=global.AudioContext||global.webkitAudioContext;if(!Constructor){return Promise.resolve(false);}context=new Constructor({latencyHint:"interactive"});master=context.createGain();master.gain.value=.24;compressor=context.createDynamicsCompressor();compressor.threshold.value=-12;compressor.ratio.value=5;master.connect(compressor);compressor.connect(context.destination);}
        return Promise.resolve(context.resume()).then(function(){return context.state==="running";}).catch(function(){return false;});
      }catch(error){if(onError){onError("Sound could not start on this screen. Tap Sound to try again.");}return Promise.resolve(false);}
    }
    function voice(freq,seconds,type,when,gain,end,musicVoice){
      if(!context||context.state!=="running"||!enabled){return;}var t=when===undefined?context.currentTime:when;
      var oscillator=context.createOscillator(),envelope=context.createGain();oscillator.type=type||"sine";
      oscillator.frequency.setValueAtTime(Math.max(20,freq),t);if(end){oscillator.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+seconds);}
      envelope.gain.setValueAtTime(0,t);envelope.gain.linearRampToValueAtTime(gain||.3,t+.008);envelope.gain.exponentialRampToValueAtTime(.0001,t+seconds);
      oscillator.connect(envelope);envelope.connect(master);oscillator.start(t);oscillator.stop(t+seconds+.01);var record={node:oscillator,music:!!musicVoice};voices.push(record);
      oscillator.onended=function(){oscillator.disconnect();envelope.disconnect();var i=voices.indexOf(record);if(i>=0){voices.splice(i,1);}};
    }
    function noise(seconds,gain,filter,when,musicVoice){
      if(!context||context.state!=="running"||!enabled){return;}var t=when===undefined?context.currentTime:when;
      var buffer=context.createBuffer(1,Math.ceil(context.sampleRate*seconds),context.sampleRate),samples=buffer.getChannelData(0);
      for(var i=0;i<samples.length;i++){samples[i]=(Math.random()*2-1)*Math.pow(1-i/samples.length,2);}
      var source=context.createBufferSource(),level=context.createGain(),tone=context.createBiquadFilter();source.buffer=buffer;tone.type="bandpass";tone.frequency.value=filter||1700;level.gain.value=gain;source.connect(tone);tone.connect(level);level.connect(master);source.start(t);var record={node:source,music:!!musicVoice};voices.push(record);
      source.onended=function(){source.disconnect();tone.disconnect();level.disconnect();var at=voices.indexOf(record);if(at>=0){voices.splice(at,1);}};
    }
    function tool(name,y,moving){
      if(!enabled||!context){return;}if(moving&&Date.now()-lastTool<85){return;}lastTool=Date.now();var t=context.currentTime,pitch=220+(1-(typeof y==="number"?y:.5))*500;
      if(name==="chalk"||name==="crayon"||name==="pencil"){noise(.07,.35,name==="chalk"?900:2400);if(!moving){voice(1200,.035,"triangle",t,.13,300);}}
      else if(name==="marker"||name==="ribbon"){voice(pitch,.15,"triangle",t,.28,pitch*(name==="ribbon"?1.8:.8));}
      else if(name==="spray"){noise(.16,.35,4000);}
      else if(name==="bubbles"||name==="fill"){voice(name==="fill"?140:400,.24,"sine",t,.6,name==="fill"?700:1100);voice(150,.13,"sine",t+.07,.3,500);}
      else if(name==="eraser"||name==="clear"){noise(.3,.4,450);voice(300,.28,"triangle",t,.3,55);}
      else if(name==="undo"||name==="redo"){[0,1,2].forEach(function(n){voice(name==="undo"?650-n*170:240+n*170,.13,"triangle",t+n*.07,.35);});}
      else if(name==="object"||name==="stamp"||name==="creatures"){voice(180,.18,"square",t,.12,600);voice(900,.17,"sine",t+.08,.35,350);}
      else if(name==="mixer"){[0,1,2,3,4].forEach(function(n){voice(100+n*190,.18,"sawtooth",t+n*.045,.13,80+n*80);});}
      else if(name==="page"||name==="play"){[440,554,659,880].forEach(function(f,n){voice(f,.25,"triangle",t+n*.07,.25);});}
      else{voice(pitch,.08,"sine",t,.25,pitch*1.25);}
    }
    function stopVoices(musicOnly){voices=voices.filter(function(v){if(musicOnly&&!v.music){return true;}try{v.node.stop(context.currentTime);}catch(ignore){}return false;});}
    function stopPicture(){picture.pause();if(pictureKey){pictureGeneration++;}pictureKey="";pictureBlocked="";}
    function stop(){musicState=null;lastStep=-1;stopVoices(false);stopPicture();}
    function music(show,active){
      if(!active||!show||!show.playing||show.soundtrack==="off"){musicState=null;lastStep=-1;stopVoices(true);return;}
      var key=show.started_at+":"+show.soundtrack;
      if(!musicState||musicState.key!==key){stopVoices(true);musicState={key:key,show:show};lastStep=-1;}
    }
    var musicTimer=global.setInterval(function(){
      if(!musicState||!context||context.state!=="running"||!enabled){return;}
      var show=musicState.show,beat=show.soundtrack==="dream"?.45:.25,elapsed=Math.max(0,Date.now()/1000-show.started_at),first=Math.floor(elapsed/beat);
      for(var step=first;step<=Math.floor((elapsed+.13)/beat);step++){
        if(step<=lastStep){continue;}lastStep=step;var t=context.currentTime+Math.max(0,step*beat-elapsed),chord=[0,5,9,7][Math.floor(step/16)%4],note=[0,7,12,16,19,12,7,4][step%8]+chord;
        var hz=220*Math.pow(2,note/12);
        if(show.soundtrack==="toybox"){voice(hz,.32,"triangle",t,.3,null,true);voice(hz*3,.07,"sine",t,.07,null,true);if(step%4===0){noise(.09,.25,700,t,true);}}
        if(show.soundtrack==="dream"){if(step%2===0){voice(hz,.9,"sine",t,.2,null,true);voice(hz*2.006,.65,"sine",t,.09,null,true);voice(hz/2,.6,"triangle",t,.1,null,true);}}
        if(show.soundtrack==="disco"){voice(55*Math.pow(2,(chord+[0,0,7,12][step%4])/12),.18,"sawtooth",t,.22,null,true);noise(.04,.18,7000,t,true);if(step%4===0){voice(130,.17,"sine",t,.6,42,true);}if(step%4===2){noise(.14,.45,1800,t,true);}}
      }
    },40);
    function playPicture(){
      var generation=pictureGeneration,key=pictureKey;picturePending=true;
      function failed(){if(generation===pictureGeneration&&key===pictureKey){pictureBlocked=key;if(onError){onError("Tap Sound to enable picture audio on this screen.");}}}
      try{Promise.resolve(picture.play()).then(function(){if(generation!==pictureGeneration||key!==pictureKey||!enabled){picture.pause();}},failed).then(function(){picturePending=false;});}
      catch(error){picturePending=false;failed();}
    }
    function pageAudio(frame,show){
      var url=frame&&frame.playing&&frame.page.audio||"",key=url+":"+(show&&show.started_at)+":"+(frame&&frame.index);
      if(!url||!enabled){stopPicture();return;}
      if(pictureKey!==key){pictureGeneration++;pictureBlocked="";pictureKey=key;picture.src=url;picture.load();}
      if(picture.readyState>=1&&Math.abs(picture.currentTime-frame.elapsed)>.7){try{picture.currentTime=Math.min(frame.elapsed,Number.isFinite(picture.duration)?Math.max(0,picture.duration-.05):frame.elapsed);}catch(ignore){}}
      if(picture.paused&&!picturePending&&pictureBlocked!==key&&(!picture.duration||frame.elapsed<picture.duration)){playPicture();}
    }
    return{unlock:unlock,tool:tool,music:music,pageAudio:pageAudio,stop:stop,setEnabled:function(value){enabled=!!value;if(!enabled){stop();}},dispose:function(){disposed=true;enabled=false;stop();global.clearInterval(musicTimer);if(context){context.close();}},getContext:function(){return context;}};
  }
  global.MadridDikPixAudio={create:create};
}(window));
