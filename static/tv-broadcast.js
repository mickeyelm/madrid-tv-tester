/* CH03 follows wall-clock slots. Leaving CH03 releases its only decoder. */
(function () {
  "use strict";
  var video = document.getElementById("broadcast-video"), card = document.getElementById("broadcast-card");
  var title = document.getElementById("broadcast-title"), detail = document.getElementById("broadcast-detail");
  var next = document.getElementById("broadcast-next"), stamp = document.getElementById("broadcast-stamp");
  var slot = null, active = false, key = "", error = false, deadline = 0, serverAt = 0, observedAt = 0, ready = false, stalledUntil = 0, generation = 0;
  function clock() { return serverAt + (performance.now() - observedAt) / 1000; }
  function release() { generation++; video.pause(); video.removeAttribute("src"); video.load(); ready = false; }
  function slate(message) {
    card.hidden = false; video.hidden = true; ready = true;
    title.textContent = error ? "PLEASE STAND BY" : (slot ? slot.title : "CHANNEL MADRiD");
    detail.textContent = message;
  }
  function start() {
    if (!active || !slot || error || !video.getAttribute("src")) return;
    var elapsed = Math.max(0, clock() - slot.starts_at);
    if (elapsed >= (slot.media_duration || slot.duration) || elapsed >= video.duration) { slate("THE NEXT TRANSMISSION IS COMING UP"); return; }
    video.currentTime = elapsed;
    var startedGeneration = generation;
    video.play().catch(function () { if (active && generation === startedGeneration) { error = true; slate("PLAYBACK PAUSED · CHANGE CHANNEL TO RETRY"); } });
  }
  video.addEventListener("loadedmetadata", start);
  video.addEventListener("playing", function () { if (active && !error) { stalledUntil = 0; ready = true; card.hidden = true; video.hidden = false; } });
  video.addEventListener("error", function () { if (active && video.getAttribute("src")) { error = true; slate("THIS TAPE IS UNAVAILABLE · THE SCHEDULE CONTINUES"); } });
  video.addEventListener("waiting", function () { if (active && !error && !stalledUntil) stalledUntil = performance.now() + 10000; });
  video.addEventListener("ended", function () { if (active) slate("STAY TUNED · ANOTHER TRANSMISSION FOLLOWS"); });
  window.MadridBroadcast = {
    ready: function () { return active && ready; },
    stop: function () { if (window.MadridReality) window.MadridReality.stop(); active = false; key = ""; slot = null; release(); },
    sync: function (state) {
      var broadcast = state.broadcast || {};
      if (state.channel !== "archive" || !broadcast.enabled || state.desktop_mode) { if (active) this.stop(); return; }
      if (window.MadridReality) window.MadridReality.sync(state);
      active = true; serverAt = state.epoch || state.server_time_ms / 1000; observedAt = performance.now();
      slot = broadcast.now;
      if (!slot) return;
      next.textContent = "NEXT / " + ((broadcast.next || {}).title || "CHANNEL MADRiD");
      stamp.textContent = "CH 03 / " + (slot.year || "NEW YORK") + " / " + (slot.kind === "ads" ? "VINTAGE AD BREAK" : (broadcast.title || slot.block_title || "AFTER THE FUTURE"));
      var signature = slot.id + ":" + slot.starts_at + ":" + (slot.url || "");
      if (key !== signature) {
        key = signature; error = false; stalledUntil = 0; release(); deadline = performance.now() + 10000;
        slate(broadcast.mode === "reality" && !broadcast.episode_count ? "ADD EPISODES TO THE REALITY LINEUP TO BEGIN" : slot.kind === "community" ? "MAKE A VISION ON CH 14 · PUT IT ON AIR FROM STATION" : "A SIGNAL FROM ANOTHER TIME");
        if (slot.url && slot.available) {
          ready = false; video.src = slot.url; video.load();
        } else if (slot.url) { error = true; slate("THIS TAPE IS UNAVAILABLE · THE SCHEDULE CONTINUES"); }
      }
      if (slot.url && !error && video.readyState >= 2 && !video.seeking && !video.paused) {
        var offset = clock() - slot.starts_at;
        if (offset < video.duration && Math.abs(video.currentTime - offset) > 3) video.currentTime = Math.max(0, offset);
      }
      if (!error && ((!ready && performance.now() > deadline) || (stalledUntil && performance.now() > stalledUntil))) { error = true; release(); slate("SIGNAL DELAYED · THE NEXT PROGRAM WILL ARRIVE ON TIME"); }
    }
  };
}());
