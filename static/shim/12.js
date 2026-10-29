/* MADRiD TV Web: CH 12 DEAD INTERNET AQUARIUM, the station server's side, in the page.
 * Load after static/station-api.js and before static/tv-aquarium.js. The module
 * reads only state (GET /api/state, already answered); this shim supplies the
 * programming schedule channel_programming.py built for the channel, keeps the
 * aquarium's own mute in step with the shell's SOUND switch and re-enters the
 * scene after a lost WebGL context. No /api/room: the room transport is off
 * (tv-aquarium.js rewrite) and nothing else calls it. No Kinect: CH 12 never
 * read it, so no camera request. */
(function (root) {
  "use strict";
  var API = root.MadridStationAPI;
  if (!API) { return; }

  // runtime.js:7-11 and tv-aquarium.js:16,46-56 read these.
  API.defaults({desktop_mode: false, muted: false, volume: 75, aquarium: {muted: false, volume: 75}, programming: {}});

  // config/channel-programming.json "aquarium" blocks; minutes since midnight on the station clock.
  var BLOCKS = [
    {id: "morning-reef", start: 360, end: 720, title: "MORNING REEF", now: "Clear water", next: "Feeding Hour", presentation: {profile: "reef", view: "scene"}},
    {id: "feeding-hour", start: 720, end: 1080, title: "FEEDING HOUR", now: "Portrait watch", next: "Slow Drift", presentation: {profile: "feeding", view: "portrait"}},
    {id: "slow-drift", start: 1080, end: 1320, title: "SLOW DRIFT", now: "Evening current", next: "Overnight Abyss", presentation: {profile: "drift", view: "scene"}},
    {id: "overnight-abyss", start: 1320, end: 360, title: "OVERNIGHT ABYSS", now: "Deep water", next: "Morning Reef", presentation: {profile: "abyss", view: "portrait"}}
  ];
  // channel_programming.py:27 schedules in America/New_York; the visitor's clock is the fallback.
  function stationMinute(date) {
    try {
      var h = 0, m = 0;
      new Intl.DateTimeFormat("en-US", {timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23"})
        .formatToParts(date).forEach(function (part) {
          if (part.type === "hour") { h = Number(part.value) % 24; }
          if (part.type === "minute") { m = Number(part.value); }
        });
      return h * 60 + m;
    } catch (e) { return date.getHours() * 60 + date.getMinutes(); }
  }
  function blockAt(minute) {
    for (var i = 0; i < BLOCKS.length; i += 1) {
      var b = BLOCKS[i];
      if (b.start < b.end ? minute >= b.start && minute < b.end : minute >= b.start || minute < b.end) { return b; }
    }
    return BLOCKS[0];
  }
  // channel_programming.snapshot(): "selected" for the tuned channel, status "scheduled".
  function schedule(state) {
    var block = blockAt(stationMinute(new Date()));
    if (!state.programming || typeof state.programming !== "object") { state.programming = {}; }
    var selected = state.programming.selected;
    if (selected && selected.channel === "aquarium" && selected.block === block.id) { return false; }
    state.programming.selected = {
      channel: "aquarium", block: block.id, title: block.title, now: block.now, next: block.next,
      status: "scheduled", presentation: {profile: block.presentation.profile, view: block.presentation.view}
    };
    return true;
  }

  // WebGL context loss ends the scene (runtime.js:400); a bare re-tune while the
  // context is still lost fails again, so re-enter on the browser's restore event.
  var wired = false;
  function wireCanvas() {
    if (wired || !root.document) { return; }
    var canvas = root.document.getElementById("aquarium-canvas");
    if (!canvas) { return; }
    wired = true;
    canvas.addEventListener("webglcontextrestored", function () {
      var tv = root.MadridAquarium;
      if (!tv) { return; }
      tv.setActive(false, {});
      tv.setActive(API.state.channel === "aquarium", API.state);
    });
  }

  function tick() {
    var state = API.state;
    wireCanvas();
    // The shell's SOUND switch suspends every AudioContext; keeping the channel's own
    // mute in step stops the pointerdown unlock (tv-aquarium.js:72) resuming it while off.
    if (state.aquarium) { state.aquarium.muted = state.sound_enabled === false; }
    var selected = state.programming && state.programming.selected;
    if (state.channel !== "aquarium") {
      // channel_programming.py:140-141 drops "selected" once the tuned channel is not programmed.
      if (selected && selected.channel === "aquarium") { delete state.programming.selected; API.emit(); }
      return;
    }
    if (schedule(state)) { API.emit(); }
  }
  root.setInterval(tick, 1000);
  tick();
}(window));
