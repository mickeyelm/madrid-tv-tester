/* MADRiD TV Web: CH 03 CHANNEL DRIFT. Each time the channel opens it shuffles among three modes
 * (never the one it had last): PROGRAMMING (the AFTER THE FUTURE schedule, shim/03.js and the
 * station's tv-broadcast.js), ROCK OF LOVE and REALITY DRIFT (drift.json). ?drift=<mode> picks one.
 *
 * Rock of Love plays through YouTube's own embedded player, the official Banijay Reality uploads,
 * on the station's Rock of Love clock (drift.json carries its anchor and episode order). It starts
 * muted, as every visitor's autoplay must; with SOUND on it is asked to unmute (YouTube may still
 * want a tap on the player). While ?mute holds the shell keeps SOUND off, so it stays muted.
 *
 * Playing is what counts, not loading: the player's own events say whether the episode is
 * playing (state 1, or its clock moving). An error code, or nothing playing after 15 s, is a
 * refusal: the channel says so on the picture (owner does not allow this player / removed or
 * private / YouTube did not start it), tries once more, then remembers for this tab that YouTube
 * will not play here. After that the opening shuffle leaves Rock of Love out and the remote marks
 * it BLOCKED HERE (it can still be picked), and Reality Drift drifts over the station's own
 * broadcast instead, and says so. Nothing is replaced without saying it.
 *
 * Reality Drift: the picture is pushed by CSS filters over a 30-minute descent and, once the
 * visitor allows the camera, their room is cut into it, as the station's Kinect did. A page cannot
 * read a YouTube picture or an archive.org one, so the station's datamosh and audio echo cannot be
 * done here; everything is drawn over the player.
 *
 * In-page API: GET /api/drift    POST /api/drift/mode {mode}  (the remote's mode row) */
(function (root) {
  "use strict";
  var api = root.MadridStationAPI;
  if (!api) { return; }
  var MODES = ["programming", "rock-of-love", "reality-drift"];
  var NAMES = {"programming": "PROGRAMMING", "rock-of-love": "ROCK OF LOVE", "reality-drift": "REALITY DRIFT"};
  var REFUSED = {"2": "THE PLAYER WAS GIVEN A BAD REQUEST", "5": "THIS BROWSER CANNOT PLAY IT", "100": "IT IS REMOVED OR PRIVATE",
    "101": "ITS OWNER DOES NOT ALLOW THIS PLAYER", "150": "ITS OWNER DOES NOT ALLOW THIS PLAYER", "153": "YOUTUBE REFUSED THIS PAGE", "timeout": "YOUTUBE DID NOT START IT"};
  var params = new URLSearchParams(root.location.search);
  var forced = MODES.indexOf(params.get("drift")) >= 0 ? params.get("drift") : "";
  var DESCENT = Number(params.get("descent")) >= 30 ? Number(params.get("descent")) : 0;   // ?descent=<s>: a shorter descent for previews and checks
  var EMBED = "https://www.youtube-nocookie.com";
  var data = null, onAir = false, mode = "", startedAt = 0, last = "", stage = null, frame = null, room = null, slate = null;
  var episodeKey = "", episodeTimer = null, drawTimer = null, watchdog = null, soundSent = null, playing = false, attempts = 0;
  var blocked = null;
  try { blocked = root.sessionStorage.getItem("madrid-tv-youtube-blocked"); } catch (e) { blocked = null; }
  api.state.drift = {mode: "", name: "", episode: null, descent: 0, playing: false, refused: "", youtubeBlocked: Boolean(blocked), over: ""};

  function now() { return Date.now() / 1000; }
  function pick() {
    if (forced) { return forced; }
    var choices = MODES.filter(function (m) { return m !== last && !(blocked && m === "rock-of-love"); });
    return choices[Math.floor(Math.random() * choices.length)] || "programming";
  }
  function onTheClock() {
    var r = data && data.rockOfLove, eps = r ? r.episodes : [];
    var cycle = eps.reduce(function (a, e) { return a + e.duration; }, 0);
    if (!cycle) { return null; }
    var t = ((now() - r.anchor_epoch) % cycle + cycle) % cycle;
    for (var i = 0; i < eps.length; i += 1) { if (t < eps[i].duration) { return {episode: eps[i], offset: t, left: eps[i].duration - t}; } t -= eps[i].duration; }
    return {episode: eps[0], offset: 0, left: eps[0].duration};
  }
  function ensureStage() {
    if (stage) { return stage; }
    var layer = document.getElementById("layer-broadcast");
    if (!layer) { return null; }
    stage = document.createElement("div"); stage.id = "drift-stage";
    stage.innerHTML = '<iframe id="drift-player" title="Rock of Love" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
      '<canvas id="drift-room" width="320" height="240"></canvas><div id="drift-slate" hidden><b></b><span></span></div><div id="drift-credit"></div>';
    layer.appendChild(stage);
    frame = stage.querySelector("#drift-player"); room = stage.querySelector("#drift-room"); slate = stage.querySelector("#drift-slate");
    return stage;
  }
  function say(title, detail) {
    if (!slate) { return; }
    slate.hidden = !title; slate.querySelector("b").textContent = title || ""; slate.querySelector("span").textContent = detail || "";
  }
  function post(message) { try { frame.contentWindow.postMessage(JSON.stringify(message), EMBED); } catch (e) { /* not loaded */ } }
  function tell(func) { post({event: "command", func: func, args: []}); }

  /* ---- Rock of Love on YouTube's player ---------------------------------- */
  function overYouTube() { return mode === "rock-of-love" || (mode === "reality-drift" && !blocked); }
  function play() {
    var at = onTheClock();
    if (!at || !ensureStage()) { return; }
    var key = at.episode.youtube + ":" + attempts;
    if (key !== episodeKey) {
      episodeKey = key; soundSent = null; playing = false; api.state.drift.playing = false;
      frame.src = EMBED + "/embed/" + encodeURIComponent(at.episode.youtube) + "?autoplay=1&mute=1&playsinline=1&controls=0&rel=0&modestbranding=1&enablejsapi=1&start=" + Math.floor(at.offset) + "&origin=" + encodeURIComponent(root.location.origin);
      stage.querySelector("#drift-credit").textContent = "ROCK OF LOVE · S" + String(at.episode.season).padStart(2, "0") + "E" + String(at.episode.episode).padStart(2, "0") + " · " + (data.rockOfLove.credit || "").toUpperCase();
      api.state.drift.episode = {season: at.episode.season, episode: at.episode.episode, title: at.episode.title};
      if (!blocked) { say("", ""); }
      root.clearTimeout(watchdog);
      watchdog = root.setTimeout(function () { refused("timeout"); }, 15000);
    }
    root.clearTimeout(episodeTimer);
    episodeTimer = root.setTimeout(function () { attempts = 0; play(); }, Math.max(1000, at.left * 1000 + 500));   // the next episode, on the clock
  }
  function started() {
    if (playing) { return; }
    playing = true; root.clearTimeout(watchdog); attempts = 0;
    api.state.drift.playing = true; api.state.drift.refused = ""; say("", "");
    if (blocked) { blocked = null; api.state.drift.youtubeBlocked = false; try { root.sessionStorage.removeItem("madrid-tv-youtube-blocked"); } catch (e) { /* tab only */ } }
  }
  function refused(code) {
    if (playing || !overYouTube()) { return; }
    root.clearTimeout(watchdog);
    var why = REFUSED[String(code)] || "YOUTUBE WOULD NOT PLAY IT";
    api.state.drift.refused = why;
    if (attempts < 1) {                                    // once more, in case it was the network
      attempts += 1; say("ROCK OF LOVE · NOT PLAYING", why + " · TRYING AGAIN");
      root.setTimeout(function () { if (overYouTube()) { episodeKey = ""; play(); } }, 8000);
      return;
    }
    blocked = String(code); api.state.drift.youtubeBlocked = true;
    try { root.sessionStorage.setItem("madrid-tv-youtube-blocked", blocked); } catch (e) { /* tab only */ }
    if (mode === "reality-drift") { setMode("reality-drift"); return; }   // drift over the broadcast instead, said on the picture
    say("ROCK OF LOVE · NOT PLAYING HERE", why);
  }
  root.addEventListener("message", function (event) {
    if (event.origin !== EMBED || !frame || event.source !== frame.contentWindow) { return; }
    var m; try { m = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch (e) { return; }
    if (!m || typeof m !== "object") { return; }
    if (m.event === "onError") { refused(m.info); return; }
    var info = m.info || {};
    if (m.event === "onStateChange" && m.info === 1) { started(); }
    if (m.event === "infoDelivery" && (info.playerState === 1 || (typeof info.currentTime === "number" && info.currentTime > 0 && info.playerState !== -1 && info.playerState !== 5))) { started(); }
    if (m.event === "onReady") { soundSent = null; }
  });
  // Ask the player for its events once it has loaded (the iframe API's postMessage handshake).
  document.addEventListener("load", function (event) {
    if (event.target !== frame) { return; }
    post({event: "listening", id: 1, channel: "widget"});
    root.setTimeout(function () { soundSent = null; sync(); }, 1500);
  }, true);

  /* ---- the drift ----------------------------------------------------------- */
  function target() { return overYouTube() ? frame : document.getElementById("broadcast-video"); }
  function drawRoom() {
    var descent = Math.min(1, (now() - startedAt) / (DESCENT || (data && data.rockOfLove.descent_seconds) || 1800));
    api.state.drift.descent = Math.round(descent * 100) / 100;
    var t = now(), d = descent, el = target();
    if (el) {
      el.style.filter = "contrast(" + (1 + 0.6 * d).toFixed(2) + ") saturate(" + (1 + 0.9 * d).toFixed(2) + ") hue-rotate(" + Math.round(Math.sin(t / 7) * 60 * d) + "deg) blur(" + (d * 1.4).toFixed(2) + "px)";
      el.style.transform = "scale(" + (1 + 0.04 * d) + ") skewX(" + (Math.sin(t / 3.1) * 4 * d).toFixed(2) + "deg)";
    }
    var cam = root.MadridWebcam, ctx = room.getContext("2d");
    var video = cam && cam.status().state === "live" ? document.querySelector("#webcam-indicator video") : null;
    room.style.opacity = d < 0.18 ? "0" : Math.min(0.85, (d - 0.18) * 1.4).toFixed(2);
    if (video && video.readyState >= 2) {
      ctx.globalAlpha = 0.92; ctx.drawImage(room, 2 + 3 * Math.sin(t), 1, 320, 240);       // feedback: the room smears into itself
      ctx.globalAlpha = 0.5 + 0.4 * d;
      for (var i = 0; i < 2 + Math.floor(6 * d); i += 1) {
        var w = 40 + Math.random() * 120, h = 30 + Math.random() * 90, x = Math.random() * (320 - w), y = Math.random() * (240 - h);
        ctx.drawImage(video, x / 320 * video.videoWidth, y / 240 * video.videoHeight, w / 320 * video.videoWidth, h / 240 * video.videoHeight, x, y, w, h);
      }
      ctx.globalAlpha = 1;
    }
    drawTimer = root.setTimeout(drawRoom, 1000 / 12);
  }
  function clearDrift() {
    [frame, document.getElementById("broadcast-video")].forEach(function (el) { if (el) { el.style.filter = ""; el.style.transform = ""; } });
    if (room) { room.style.opacity = "0"; room.getContext("2d").clearRect(0, 0, 320, 240); }
  }
  function setMode(next) {
    mode = next; last = next; startedAt = startedAt && next === "reality-drift" && api.state.drift.mode === "reality-drift" ? startedAt : now();
    api.state.drift.mode = next; api.state.drift.name = NAMES[next];
    root.clearTimeout(episodeTimer); root.clearTimeout(drawTimer); root.clearTimeout(watchdog);
    if (!ensureStage()) { return; }
    clearDrift(); say("", "");
    var youtube = overYouTube();
    api.state.drift.over = next === "programming" ? "" : youtube ? "youtube" : "broadcast";
    stage.classList.toggle("is-on", next !== "programming");
    stage.classList.toggle("is-youtube", youtube);
    stage.classList.toggle("is-drift", next === "reality-drift");
    if (!youtube) { episodeKey = ""; frame.removeAttribute("src"); api.state.drift.episode = null; playing = false; api.state.drift.playing = false; }
    if (next === "programming") { return; }
    if (youtube) {
      // Picked although YouTube refused this tab: say so at once and try once more quietly; playing clears it.
      attempts = blocked ? 1 : 0; episodeKey = ""; play();
      if (blocked) { say("ROCK OF LOVE · NOT PLAYING HERE", REFUSED[blocked] || "YOUTUBE WOULD NOT PLAY IT"); }
    }
    else if (next === "reality-drift") { stage.querySelector("#drift-credit").textContent = "REALITY DRIFT · OVER THE BROADCAST · ROCK OF LOVE DOES NOT PLAY HERE"; }
    if (next === "reality-drift") {
      if (root.MadridWebcam) { root.MadridWebcam.request("CH 03 CHANNEL DRIFT WANTS YOUR CAMERA"); }
      drawRoom();
    }
  }
  function stop() {
    root.clearTimeout(episodeTimer); root.clearTimeout(drawTimer); root.clearTimeout(watchdog);
    episodeKey = ""; mode = ""; playing = false; clearDrift();
    api.state.drift.mode = ""; api.state.drift.episode = null; api.state.drift.playing = false; api.state.drift.over = "";
    if (stage) { stage.classList.remove("is-on", "is-youtube", "is-drift"); say("", ""); }
    if (frame) { frame.removeAttribute("src"); }
  }
  function sync() {
    var want = api.state.channel === "archive" && Boolean(data);
    if (want && !onAir) { onAir = true; startedAt = 0; setMode(pick()); }
    else if (!want && onAir) { onAir = false; stop(); }
    if (onAir && overYouTube() && frame && frame.getAttribute("src")) {
      var loud = api.state.sound_enabled === true;   // the shell keeps it false while ?mute holds
      if (loud !== soundSent) { soundSent = loud; tell(loud ? "unMute" : "mute"); if (loud) { tell("playVideo"); } }
    }
  }
  // shim/03.js reads this: the station's player runs in PROGRAMMING, and under a Reality Drift over the broadcast.
  root.MadridDrift = {programming: function () { return !onAir || !mode || mode === "programming" || (mode === "reality-drift" && !overYouTube()); }};

  api.register("GET", "/api/drift", function () { return api.state.drift; });
  api.register("POST", "/api/drift/mode", function (body) {
    if (MODES.indexOf(body.mode) < 0) { throw new Error("unknown mode"); }
    if (api.state.channel !== "archive") { throw new Error("CH 03 is not on air"); }
    setMode(body.mode); return api.state.drift;
  });
  root.fetch("drift.json", {cache: "no-store"}).then(function (r) { return r.json(); }).then(function (d) { data = d; })
    .catch(function (error) { if (root.console) { root.console.error("CH 03 drift list unavailable: " + (error && error.message || error)); } });
  ["click", "keydown"].forEach(function (type) { document.addEventListener(type, function () { root.setTimeout(sync, 0); }); });
  var timer = root.setInterval(sync, 400);
  if (timer && timer.unref) { timer.unref(); }
}(window));
