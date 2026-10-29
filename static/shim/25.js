/* MADRiD TV Web: CH 25 STAINED 2. The layer is the station's (tv.html:30-32); the player is
 * this file, not the station's tv-stained2.js, which mixes a four-channel master (score plus
 * MADRiD's and Jeremy's narration) through Web Audio. The web edition carries only the stereo
 * cut (score and Foley, no narration; tools/manifest.25.json), so a plain looping <video> does.
 * It plays only while CH 25 is on air, muted until the shell's SOUND is on. */
(function (root) {
  "use strict";
  var api = root.MadridStationAPI;
  if (!api) { return; }
  api.defaults({stained2: {narration: "none", edition: "stereo-cut"}});
  var FILM = "static/assets/stained2-v1.mp4";
  function sync() {
    var video = document.getElementById("stained2-video"), fault = document.getElementById("stained2-fault");
    if (!video) { return; }
    var onAir = api.state.channel === "stained-2";
    video.muted = api.state.sound_enabled !== true;
    if (!onAir) { if (!video.paused) { video.pause(); } return; }
    if (!video.getAttribute("src")) {
      video.addEventListener("error", function () { if (fault) { fault.hidden = false; fault.style.display = "grid"; } });
      video.addEventListener("playing", function () { if (fault) { fault.hidden = true; fault.style.display = "none"; } });
      video.src = FILM;
    }
    if (video.paused) { video.play().catch(function () { /* muted autoplay refused: the next tap's sync retries */ }); }
  }
  var timer = root.setInterval(sync, 400);
  if (timer && timer.unref) { timer.unref(); }
  if (document.addEventListener) { ["click", "keydown"].forEach(function (type) { document.addEventListener(type, function () { root.setTimeout(sync, 0); }); }); }
}(window));
