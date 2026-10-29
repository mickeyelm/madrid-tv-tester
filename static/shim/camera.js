/* MADRiD TV Web: CH 04 CAMERA, the station server's part, reimagined.
 * On the home station the layer showed a phone's feed over WebRTC on the LAN
 * (tv-camera.js; /api/camera/offer, /answer, /stop; channel_core.py
 * 3066-3090). None of that is copied. Here the layer shows the visitor's own
 * webcam through static/webcam.js, after its permission card, mirrored.
 * state.camera keeps the server's shape ({session, offer_pending,
 * answer_pending}, channel_core.py 1314-1318) so the remote panel renders
 * exactly as remote.js did. Frames stay in this page; nothing is sent.
 * Load after static/station-api.js and static/webcam.js. */
(function (root) {
  "use strict";
  var API = root.MadridStationAPI;
  if (!API) { return; }
  var S = API.state;
  var REASON = "CH 04 CAMERA WANTS YOUR CAMERA";
  var asked = false;          // the dial asks once; after that it is USE CAMERA on the remote
  var calling = false;        // a request() is pending (card up or getUserMedia in flight)
  var attached = null;        // the MediaStream currently on #camera-video

  API.defaults({camera: {session: 0, offer_pending: false, answer_pending: false}});

  function webcam() { return root.MadridWebcam || null; }
  // webcam.js stays "idle" while its card is up and only turns "asking" after
  // the click, so the pending request() is what marks the transmitter calling.
  function phase() {
    var W = webcam();
    if (!W) { return "refused"; }
    var s = W.status();
    if (s.state === "live") { return "live"; }
    if (s.state === "denied" || s.state === "unavailable" || s.decision === false) { return "refused"; }
    if (calling || s.state === "asking" || s.state === "loading") { return "asking"; }
    return "idle";
  }
  // channel_core.py: offer_pending while the transmitter calls, both flags once linked.
  function project(p) {
    var c = S.camera;
    var offer = p === "asking" || p === "live", answer = p === "live";
    if (c.offer_pending !== offer || c.answer_pending !== answer) {
      c.offer_pending = offer; c.answer_pending = answer; API.emit();
    }
  }
  // Same slate/picture swap tv-camera.js did, by inline display.
  function status(text, live) {
    var element = document.getElementById("camera-status");
    if (element) { element.textContent = text; }
    var slate = document.getElementById("camera-slate");
    var video = document.getElementById("camera-video");
    if (slate) { slate.style.display = live ? "none" : "flex"; }
    if (video) { video.style.display = live ? "block" : "none"; }
  }
  // tv-camera.js's words: AWAITING TRANSMITTER (31), LINKING TRANSMITTER (71),
  // LIVE FEED (83); NO TRANSMITTER is the remote's (remote.js 663-676).
  var WORDS = {idle: "AWAITING TRANSMITTER", asking: "LINKING TRANSMITTER", live: "LIVE FEED", refused: "NO TRANSMITTER"};
  function sync() {
    var p = phase();
    project(p);
    var W = webcam();
    var stream = p === "live" && W ? W.stream : null;
    var video = document.getElementById("camera-video");
    if (video && stream !== attached) {
      attached = stream;
      video.muted = true; video.playsInline = true;
      video.srcObject = stream;
      if (stream) { var play = video.play(); if (play && play.catch) { play.catch(function () { /* autoplay gate */ }); } }
    }
    status(WORDS[p], p === "live");
  }
  function settle() { calling = false; sync(); }
  // channel_core.py:3066 start_camera_offer bumps the session; so does each ask here.
  function request() {
    var W = webcam();
    S.camera.session += 1;
    if (W) { calling = true; W.request(REASON).then(settle, settle); }
    sync();
  }

  // The shell writes state.channel directly (tune() does not emit), so watch it
  // at the station's own poll cadence. ponytail: 400 ms watch; a dial that only
  // passes through CH 04 inside one tick never asks.
  var previous = null;
  var timer = root.setInterval(function () {
    if (S.channel === "camera") {
      if (previous !== "camera" && !asked) { asked = true; request(); } else { sync(); }
    }
    previous = S.channel;
  }, 400);
  if (timer && timer.unref) { timer.unref(); }   // lets the Node self-check exit
  if (webcam()) { webcam().onChange(function () { sync(); }); }

  // Own stand-in: the station had no start path (the phone posted an SDP offer).
  // An explicit press re-offers the card after a NOT NOW; the automatic ask never does.
  API.register("POST", "/api/camera/start", function () {
    var W = webcam();
    if (W && W.status().decision === false && W.status().state !== "denied") { W.forget(); }
    asked = true;
    request();
    return {session: S.camera.session};
  });
  // channel_core.py:3086 stop_camera: session += 1, offer and answer cleared.
  API.register("POST", "/api/camera/stop", function (body, query, ctx) {
    var W = webcam();
    if (W) { W.release(); }
    S.camera.session += 1;
    S.camera.offer_pending = false; S.camera.answer_pending = false;
    sync();
    ctx.emit();
    return {session: S.camera.session};
  });
}(window));
