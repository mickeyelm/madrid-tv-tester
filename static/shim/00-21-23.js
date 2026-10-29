/* MADRiD TV Web: CH 00 OFF AIR, CH 21 FACETIME, CH 23 STAIN TV.
 * The server slice these three layers saw, answered in the page. Loads after
 * static/station-api.js and before stain-timeline.js, stain-audio.js, stain-tv.js.
 * None of the three ever read the Kinect, so nothing here touches the webcam.
 * Audio needs nothing here either: stain-audio.js takes window.AudioContext at
 * load, which by then is station-api.js's tracked constructor, so the shell's
 * SOUND key and first-gesture unlock reach the CH 23 context like every other. */
(function (root) {
  "use strict";
  var api = root.MadridStationAPI;
  if (!api) { return; }

  // channel_server.py:405-410 stamps these on every snapshot; channel_core.py:1284-1286
  // adds `recent`, the owner's real call list on the station. Empty here, always.
  // The station.* fields the CH 00 LAN card read (tv-onboard.js:40-55) are not defaulted:
  // the card, tv-onboard.js and qrcode-generator.js are not shipped.
  api.defaults({
    facetime: {camera_ready: false, mic_ready: false, ready: false, status: "coming-soon", recent: []}
  });

  // channel_server.py:1595-1597: POST /api/facetime -> 503 {"error": "FaceTime coming soon"}.
  // station-api.js has no status knob; a throw answers 500 with the same body.
  api.register("POST", "/api/facetime", function () { throw new Error("FaceTime coming soon"); });
  // GET /api/state and POST /api/channel are station-api.js's own (the dial is the shell's).
}(window));
