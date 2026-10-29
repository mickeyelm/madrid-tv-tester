(function (global) {
  "use strict";

  var PAPER = "#f8f1df";
  var background = PAPER;
  var WIDTH = 720, HEIGHT = 500;
  var caches = new WeakMap();
  var reducedMotion = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)");

  function point(canvas, x, y) {
    return [Number(x) * canvas.width, Number(y) * canvas.height];
  }

  function seeded(seed) {
    var value = (Number(seed) || 1) >>> 0;
    return function () {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function strokePath(ctx, canvas, action) {
    var points = action.points || [];
    if (!points.length) { return; }
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Number(action.size) || 6;
    ctx.strokeStyle = action.tool === "eraser" ? background : action.color;
    ctx.fillStyle = ctx.strokeStyle;
    if (action.tool === "marker") { ctx.globalAlpha = 0.48; }
    var first = point(canvas, points[0][0], points[0][1]);
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(first[0], first[1], ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    for (var i = 1; i < points.length; i += 1) {
      var current = point(canvas, points[i][0], points[i][1]);
      ctx.lineTo(current[0], current[1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  function spray(ctx, canvas, action) {
    var random = seeded(action.seed || action.id || 1);
    var radius = Math.max(8, Number(action.size) || 18);
    ctx.save();
    ctx.fillStyle = action.color;
    (action.points || []).forEach(function (raw) {
      var center = point(canvas, raw[0], raw[1]);
      for (var i = 0; i < 14; i += 1) {
        var angle = random() * Math.PI * 2;
        var distance = Math.sqrt(random()) * radius;
        var dot = Math.max(1.2, radius * (0.035 + random() * 0.045));
        ctx.beginPath();
        ctx.arc(
          center[0] + Math.cos(angle) * distance,
          center[1] + Math.sin(angle) * distance,
          dot,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    });
    ctx.restore();
  }

  function drawLine(ctx, canvas, action) {
    var start = point(canvas, action.x1, action.y1);
    var end = point(canvas, action.x2, action.y2);
    ctx.save();
    ctx.strokeStyle = action.color;
    ctx.lineWidth = Number(action.size) || 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
    ctx.restore();
  }

  function drawShape(ctx, canvas, action) {
    var start = point(canvas, action.x1, action.y1);
    var end = point(canvas, action.x2, action.y2);
    var left = Math.min(start[0], end[0]);
    var top = Math.min(start[1], end[1]);
    var width = Math.max(2, Math.abs(end[0] - start[0]));
    var height = Math.max(2, Math.abs(end[1] - start[1]));
    ctx.save();
    ctx.strokeStyle = action.color;
    ctx.lineWidth = Number(action.size) || 6;
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (action.shape === "ellipse") {
      ctx.ellipse(
        left + width / 2,
        top + height / 2,
        width / 2,
        height / 2,
        0,
        0,
        Math.PI * 2
      );
    } else if (action.shape === "triangle") {
      ctx.moveTo(left + width / 2, top);
      ctx.lineTo(left + width, top + height);
      ctx.lineTo(left, top + height);
      ctx.closePath();
    } else {
      ctx.rect(left, top, width, height);
    }
    ctx.stroke();
    ctx.restore();
  }

  function starPath(ctx, radius) {
    for (var i = 0; i < 10; i += 1) {
      var angle = -Math.PI / 2 + i * Math.PI / 5;
      var length = i % 2 ? radius * 0.43 : radius;
      var x = Math.cos(angle) * length;
      var y = Math.sin(angle) * length;
      if (!i) { ctx.moveTo(x, y); }
      else { ctx.lineTo(x, y); }
    }
    ctx.closePath();
  }

  function heartPath(ctx, radius) {
    ctx.moveTo(0, radius * 0.85);
    ctx.bezierCurveTo(-radius * 1.25, 0, -radius, -radius, -radius * 0.42, -radius);
    ctx.bezierCurveTo(0, -radius, 0, -radius * 0.42, 0, -radius * 0.25);
    ctx.bezierCurveTo(0, -radius * 0.42, 0, -radius, radius * 0.42, -radius);
    ctx.bezierCurveTo(radius, -radius, radius * 1.25, 0, 0, radius * 0.85);
    ctx.closePath();
  }

  function drawFace(ctx, radius, alien) {
    ctx.beginPath();
    if (alien) {
      ctx.ellipse(0, 0, radius * 0.72, radius, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#171717";
    ctx.beginPath();
    ctx.arc(-radius * 0.34, -radius * 0.18, radius * (alien ? 0.16 : 0.1), 0, Math.PI * 2);
    ctx.arc(radius * 0.34, -radius * 0.18, radius * (alien ? 0.16 : 0.1), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    if (alien) {
      ctx.moveTo(-radius * 0.18, radius * 0.42);
      ctx.quadraticCurveTo(0, radius * 0.32, radius * 0.18, radius * 0.42);
    } else {
      ctx.arc(0, radius * 0.08, radius * 0.48, 0.15 * Math.PI, 0.85 * Math.PI);
    }
    ctx.stroke();
    if (alien) {
      ctx.beginPath();
      ctx.moveTo(-radius * 0.34, -radius * 0.82);
      ctx.lineTo(-radius * 0.58, -radius * 1.24);
      ctx.moveTo(radius * 0.34, -radius * 0.82);
      ctx.lineTo(radius * 0.58, -radius * 1.24);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-radius * 0.58, -radius * 1.24, radius * 0.1, 0, Math.PI * 2);
      ctx.arc(radius * 0.58, -radius * 1.24, radius * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawStamp(ctx, canvas, action) {
    var center = point(canvas, action.x, action.y);
    var radius = Number(action.size) || 36;
    ctx.save();
    ctx.translate(center[0], center[1]);
    ctx.fillStyle = action.color;
    ctx.strokeStyle = "#171717";
    ctx.lineWidth = Math.max(2, radius * 0.09);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    if (action.stamp === "robot") {
      ctx.rect(-radius * .75, -radius * .65, radius * 1.5, radius * 1.3);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,-radius*.65);ctx.lineTo(0,-radius);ctx.stroke();
      ctx.fillStyle="#f5c400";ctx.fillRect(-radius*.14,-radius*1.12,radius*.28,radius*.25);
      ctx.fillStyle="#f8f1df";ctx.fillRect(-radius*.55,-radius*.35,radius*.38,radius*.38);ctx.fillRect(radius*.17,-radius*.35,radius*.38,radius*.38);
      ctx.fillStyle="#171717";ctx.fillRect(-radius*.38,-radius*.25,radius*.15,radius*.2);ctx.fillRect(radius*.25,-radius*.25,radius*.15,radius*.2);ctx.fillRect(-radius*.4,radius*.28,radius*.8,radius*.13);
    } else if (action.stamp === "ufo") {
      ctx.beginPath();ctx.ellipse(0,-radius*.22,radius*.53,radius*.63,0,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle="#18a6c9";ctx.beginPath();ctx.ellipse(0,radius*.12,radius,radius*.32,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle="#f5c400";
      for(var lamp=-1;lamp<=1;lamp++){ctx.beginPath();ctx.arc(lamp*radius*.58,radius*.13,radius*.09,0,Math.PI*2);ctx.fill();}
    } else if (action.stamp === "fish") {
      ctx.moveTo(-radius*.5,0);ctx.lineTo(-radius,-radius*.6);ctx.lineTo(-radius,radius*.6);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.ellipse(radius*.12,0,radius*.75,radius*.48,0,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle="#f8f1df";ctx.beginPath();ctx.arc(radius*.52,-radius*.08,radius*.21,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#171717";ctx.beginPath();ctx.arc(radius*.58,-radius*.08,radius*.1,0,Math.PI*2);ctx.fill();
    } else if (action.stamp === "eye") {
      ctx.fillStyle="#f8f1df";ctx.moveTo(-radius,0);ctx.quadraticCurveTo(0,-radius*1.25,radius,0);ctx.quadraticCurveTo(0,radius*1.25,-radius,0);ctx.fill();ctx.stroke();
      ctx.fillStyle=action.color;ctx.beginPath();ctx.arc(0,0,radius*.45,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle="#171717";ctx.beginPath();ctx.arc(0,0,radius*.18,0,Math.PI*2);ctx.fill();
    } else if (action.stamp === "star") {
      starPath(ctx, radius);
      ctx.fill();
      ctx.stroke();
    } else if (action.stamp === "heart") {
      heartPath(ctx, radius);
      ctx.fill();
      ctx.stroke();
    } else if (action.stamp === "flower") {
      for (var petal = 0; petal < 8; petal += 1) {
        ctx.save();
        ctx.rotate(petal * Math.PI / 4);
        ctx.beginPath();
        ctx.ellipse(0, -radius * 0.63, radius * 0.27, radius * 0.48, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.fillStyle = "#f5c400";
      ctx.arc(0, 0, radius * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (action.stamp === "lightning") {
      ctx.moveTo(radius * 0.12, -radius);
      ctx.lineTo(-radius * 0.62, radius * 0.08);
      ctx.lineTo(-radius * 0.12, radius * 0.08);
      ctx.lineTo(-radius * 0.28, radius);
      ctx.lineTo(radius * 0.66, -radius * 0.2);
      ctx.lineTo(radius * 0.16, -radius * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (action.stamp === "cat") {
      ctx.moveTo(-radius * 0.72, -radius * 0.48);
      ctx.lineTo(-radius * 0.78, -radius);
      ctx.lineTo(-radius * 0.25, -radius * 0.7);
      ctx.quadraticCurveTo(0, -radius * 0.82, radius * 0.25, -radius * 0.7);
      ctx.lineTo(radius * 0.78, -radius);
      ctx.lineTo(radius * 0.72, -radius * 0.48);
      ctx.arc(0, 0, radius * 0.8, -0.2 * Math.PI, 1.2 * Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#171717";
      ctx.beginPath();
      ctx.arc(-radius * 0.3, -radius * 0.08, radius * 0.1, 0, Math.PI * 2);
      ctx.arc(radius * 0.3, -radius * 0.08, radius * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, radius * 0.08);
      ctx.lineTo(-radius * 0.1, radius * 0.24);
      ctx.lineTo(radius * 0.1, radius * 0.24);
      ctx.closePath();
      ctx.fill();
    } else {
      drawFace(ctx, radius, action.stamp === "alien");
    }
    ctx.restore();
  }

  function floodFill(ctx, canvas, action) {
    var image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var data = image.data;
    var x = Math.max(0, Math.min(canvas.width - 1, Math.floor(Number(action.x) * canvas.width)));
    var y = Math.max(0, Math.min(canvas.height - 1, Math.floor(Number(action.y) * canvas.height)));
    var start = (y * canvas.width + x) * 4;
    var target = [data[start], data[start + 1], data[start + 2], data[start + 3]];
    var hex = action.color.replace("#", "");
    var fill = [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      255
    ];
    var style = action.style || "solid", cream = [240, 237, 232];
    if (style === "solid" && target[0] === fill[0] && target[1] === fill[1] &&
        target[2] === fill[2] && target[3] === fill[3]) { return; }
    var firstPixel = y * canvas.width + x;
    var stack = [firstPixel];
    var visited = new Uint8Array(canvas.width * canvas.height);
    visited[firstPixel] = 1;
    while (stack.length) {
      var pixel = stack.pop();
      var cx = pixel % canvas.width;
      var cy = Math.floor(pixel / canvas.width);
      var offset = pixel * 4;
      if (data[offset] !== target[0] || data[offset + 1] !== target[1] ||
          data[offset + 2] !== target[2] || data[offset + 3] !== target[3]) { continue; }
      var mix = style === "gradient" ? cy / Math.max(1, canvas.height - 1) :
        style === "checkers" ? (Math.floor(cx / 12) + Math.floor(cy / 12)) % 2 :
        style === "stripes" ? ((cx + cy) % 24 < 12 ? 0 : 1) : 0;
      for (var channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = Math.round(fill[channel] * (1 - mix) + cream[channel] * mix);
      }
      data[offset + 3] = 255;
      if (cx + 1 < canvas.width && !visited[pixel + 1]) {
        visited[pixel + 1] = 1;
        stack.push(pixel + 1);
      }
      if (cx > 0 && !visited[pixel - 1]) {
        visited[pixel - 1] = 1;
        stack.push(pixel - 1);
      }
      if (cy + 1 < canvas.height && !visited[pixel + canvas.width]) {
        visited[pixel + canvas.width] = 1;
        stack.push(pixel + canvas.width);
      }
      if (cy > 0 && !visited[pixel - canvas.width]) {
        visited[pixel - canvas.width] = 1;
        stack.push(pixel - canvas.width);
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  function material(ctx, canvas, action) {
    var random=seeded(action.seed||action.id||1),size=action.size||10,points=action.points||[],last=null,count=0;
    ctx.save();
    points.forEach(function(raw){
      var p=point(canvas,raw[0],raw[1]);
      var steps=last?Math.max(1,Math.ceil(Math.hypot(p[0]-last[0],p[1]-last[1])/Math.max(2,size/3))):1;
      for(var step=0;step<steps;step++){
        var x=last?last[0]+(p[0]-last[0])*(step+1)/steps:p[0],y=last?last[1]+(p[1]-last[1])*(step+1)/steps:p[1];
        ctx.fillStyle=action.color;ctx.strokeStyle=action.color;
        if(action.tool==="crayon"||action.tool==="chalk"){
          var chalk=action.tool==="chalk";ctx.globalAlpha=chalk?.2:.55;
          for(var dot=0;dot<(chalk?24:14);dot++){var angle=random()*Math.PI*2,radius=Math.sqrt(random())*size/2;ctx.fillRect(x+Math.cos(angle)*radius,y+Math.sin(angle)*radius,chalk?2:1.5,chalk?2:1.5);}
        }else if(action.tool==="ribbon"){
          ctx.globalAlpha=.88;ctx.lineWidth=Math.max(2,size*.28);
          for(var strand=0;strand<3;strand++){ctx.strokeStyle=[action.color,"#f05d9d","#18a6c9"][strand];ctx.beginPath();ctx.moveTo(x-size*.45,y+(strand-1)*size*.3);ctx.lineTo(x+size*.45,y+(strand-1)*size*.3+Math.sin(count*.35)*size*.5);ctx.stroke();}
        }else if(action.tool==="bubbles"&&count%3===0){
          ctx.globalAlpha=.55;ctx.lineWidth=2;var r=size*(.25+random()*.65);ctx.beginPath();ctx.arc(x+(random()-.5)*size,y+(random()-.5)*size,r,0,Math.PI*2);ctx.stroke();ctx.strokeStyle="#f0ede8";ctx.beginPath();ctx.arc(x,y,r*.6,Math.PI,Math.PI*1.5);ctx.stroke();
        }else if(action.tool==="creatures"&&count%5===0){ctx.globalAlpha=1;drawStamp(ctx,canvas,{x:x/canvas.width,y:y/canvas.height,size:size*(.6+random()*.4),color:action.color,stamp:["alien","eye","fish","star"][Math.floor(random()*4)]});}
        count++;
      }last=p;
    });ctx.restore();
  }
  function drawAction(canvas,action){
    if(!canvas||!action){return;}var ctx=canvas.getContext("2d");
    if(action.kind==="stroke"){
      if(action.tool==="spray"){spray(ctx,canvas,action);}
      else if(["crayon","chalk","ribbon","bubbles","creatures"].indexOf(action.tool)>=0){material(ctx,canvas,action);}
      else{strokePath(ctx,canvas,action);}
    }else if(action.kind==="line"){drawLine(ctx,canvas,action);}
    else if(action.kind==="shape"){drawShape(ctx,canvas,action);}
    else if(action.kind==="stamp"){drawStamp(ctx,canvas,action);}
    else if(action.kind==="text"){
      var location=point(canvas,action.x,action.y);ctx.save();ctx.fillStyle=action.color;ctx.strokeStyle="#171717";ctx.lineWidth=Math.max(1,Number(action.size)*.05);ctx.font="bold "+Number(action.size)+"px monospace";ctx.textBaseline="middle";ctx.strokeText(action.text,location[0],location[1]);ctx.fillText(action.text,location[0],location[1]);ctx.restore();
    }else if(action.kind==="fill"){floodFill(ctx,canvas,action);}
  }
  function objects(actions){
    var result=Object.create(null);(actions||[]).forEach(function(a){
      if(a.kind==="clear"){result=Object.create(null);}
      if(a.kind==="object"){result[a.object_id]=Object.assign({},a);}
      if(a.kind==="object_update"&&result[a.object_id]){Object.assign(result[a.object_id],a,{kind:"object",id:result[a.object_id].id});}
      if(a.kind==="object_delete"){delete result[a.object_id];}
    });return Object.keys(result).map(function(id){return result[id];});
  }
  function pose(object,time){
    var o=Object.assign({},object),t=time*2+(Number(object.id)||0)*.61;
    o.angle=(Number(o.rotation)||0)*Math.PI/180;o.sx=1;o.sy=1;
    if(o.motion==="bounce"){o.y-=Math.abs(Math.sin(t))*.075;o.sy=1-Math.max(0,Math.cos(t*2))*.1;}
    if(o.motion==="orbit"){o.x+=Math.cos(t)*.055;o.y+=Math.sin(t)*.055;}
    if(o.motion==="wiggle"){o.angle+=Math.sin(t*3)*.22;o.sx=1+Math.sin(t*2)*.07;}
    if(o.motion==="spin"){o.angle+=t;}return o;
  }
  function drawObject(ctx,object,time){var o=pose(object,time);ctx.save();ctx.translate(o.x*WIDTH,o.y*HEIGHT);ctx.rotate(o.angle);ctx.scale(o.sx,o.sy);drawStamp(ctx,{width:WIDTH,height:HEIGHT},Object.assign({},o,{x:0,y:0}));ctx.restore();}
  function currentPage(board){var pages=board.pages||[];return pages.find(function(p){return p.id===board.active_page;})||pages[0]||board;}
  function pageAt(board,now){
    var pages=board.pages||[board],show=board.show||{};
    if(!show.playing||!pages.length){return{page:currentPage(board),elapsed:0,index:pages.indexOf(currentPage(board)),playing:false};}
    var duration=pages.reduce(function(sum,p){return sum+(p.duration||3);},0),start=Number(show.started_at),elapsed=Math.max(0,now-(Number.isFinite(start)?start:now));
    if(!show.loop&&elapsed>=duration){return{page:pages[pages.length-1],elapsed:pages[pages.length-1].duration||3,index:pages.length-1,playing:false};}
    elapsed=elapsed%duration;
    for(var i=0;i<pages.length;i++){var length=pages[i].duration||3;if(elapsed<length){return{page:pages[i],elapsed:elapsed,index:i,playing:true};}elapsed-=length;}
    return{page:pages[0],elapsed:0,index:0,playing:true};
  }
  function paint(canvas,page){
    var cache=caches.get(canvas),actions=page.actions||[],key;
    // Server snapshots replace pages; unchanged animation frames need no history scan.
    if(cache&&cache.page===page&&cache.actions===actions&&cache.count===actions.length&&cache.rev===page.rev){return cache;}
    key=String(page.id||"")+":"+JSON.stringify(actions);
    if(cache&&cache.key===key){cache.page=page;cache.actions=actions;cache.count=actions.length;cache.rev=page.rev;return cache;}
    var base=document.createElement("canvas");base.width=WIDTH;base.height=HEIGHT;
    var ctx=base.getContext("2d");background=PAPER;
    actions.forEach(function(a){if(a.kind==="paper"){background=a.color;}});ctx.fillStyle=background;ctx.fillRect(0,0,WIDTH,HEIGHT);
    actions.forEach(function(a){
      if(a.kind==="clear"){ctx.fillStyle=background;ctx.fillRect(0,0,WIDTH,HEIGHT);}
      else if(a.kind==="mixer"){
        var copy=document.createElement("canvas");copy.width=WIDTH;copy.height=HEIGHT;copy.getContext("2d").drawImage(base,0,0);ctx.save();
        if(a.effect==="mirror"){ctx.translate(WIDTH,0);ctx.scale(-1,1);ctx.drawImage(copy,0,0);}
        else if(a.effect==="invert"){ctx.filter="invert(1)";ctx.drawImage(copy,0,0);}
        else{var small=document.createElement("canvas");small.width=36;small.height=25;small.getContext("2d").drawImage(copy,0,0,36,25);ctx.imageSmoothingEnabled=false;ctx.drawImage(small,0,0,WIDTH,HEIGHT);}ctx.restore();
      }else{drawAction(base,a);}
    });cache={key:key,page:page,actions:actions,count:actions.length,rev:page.rev,base:base,objects:objects(actions),background:background};caches.set(canvas,cache);return cache;
  }
  function render(canvas,board,preview,time,selected,explicitPlayback){
    if(!canvas){return;}var page=board||{actions:[]};
    var cache=paint(canvas,page),ctx=canvas.getContext("2d"),at=typeof time==="number"?time:0,list=cache.objects;background=cache.background;
    if(reducedMotion&&reducedMotion.matches&&!explicitPlayback){at=0;}
    ctx.save();ctx.scale(canvas.width/WIDTH,canvas.height/HEIGHT);ctx.drawImage(cache.base,0,0);
    if(preview&&!/^object/.test(preview.kind)){var overlay=cache.overlay;if(!overlay){overlay=cache.overlay=document.createElement("canvas");overlay.width=WIDTH;overlay.height=HEIGHT;}overlay.getContext("2d").drawImage(cache.base,0,0);drawAction(overlay,preview);ctx.drawImage(overlay,0,0);}
    if(preview&&/^object/.test(preview.kind)){list=objects((page.actions||[]).concat([preview]));}
    list.forEach(function(o){drawObject(ctx,o,at);if(o.object_id===selected){var p=pose(o,at);ctx.save();ctx.setLineDash([5,4]);ctx.strokeStyle="#0044ff";ctx.lineWidth=2;ctx.strokeRect(p.x*WIDTH-o.size-7,p.y*HEIGHT-o.size-7,o.size*2+14,o.size*2+14);ctx.restore();}});ctx.restore();
  }
  var transitionCanvas=null;
  function renderShow(canvas,board,now){
    var frame=pageAt(board,now),previous,alpha,transition=Math.min(.45,(frame.page.duration||3)*.45);render(canvas,frame.page,null,now,null,frame.playing);
    if(frame.playing&&frame.elapsed<transition&&frame.page.transition!=="cut"){
      previous=(board.pages||[])[(frame.index+(board.pages||[]).length-1)%(board.pages||[]).length];
      if(previous){if(!transitionCanvas){transitionCanvas=document.createElement("canvas");}var before=transitionCanvas;if(before.width!==canvas.width||before.height!==canvas.height){before.width=canvas.width;before.height=canvas.height;}render(before,previous,null,now,null,true);var ctx=canvas.getContext("2d");alpha=1-frame.elapsed/transition;ctx.save();
        if(frame.page.transition==="wipe"){ctx.beginPath();ctx.rect(canvas.width*(1-alpha),0,canvas.width*alpha,canvas.height);ctx.clip();}else{ctx.globalAlpha=alpha;}ctx.drawImage(before,0,0);ctx.restore();}
    }return frame;
  }
  function hitTest(page,x,y,time){if(reducedMotion&&reducedMotion.matches){time=0;}return objects(page.actions||[]).reverse().find(function(o){var p=pose(o,time);return Math.hypot((x-p.x)*WIDTH,(y-p.y)*HEIGHT)<o.size*1.25;})||null;}
  global.MadridDikPixCore={PAPER:PAPER,WIDTH:WIDTH,HEIGHT:HEIGHT,drawAction:drawAction,render:render,objects:objects,pose:pose,currentPage:currentPage,pageAt:pageAt,renderShow:renderShow,hitTest:hitTest};
}(window));
