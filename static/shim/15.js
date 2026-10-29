/* MADRiD TV Web: CH 15 MARLIN'S PLAYHOUSE, the station server's side, in the page.
 * Load after static/station-api.js and before static/playhouse-core.js and
 * static/playhouse.js. Answers the /api calls the module and its deck panel make
 * the way channel_server.py did (POST /api/programming/control -> take_control;
 * POST /api/surface-command -> channel_core.send_surface_command) and asks for
 * the visitor's camera where the station read the Kinect. GET /api/kinect is
 * answered by station-api.js from MadridWebcam.snapshot(). */
(function (root) {
  "use strict";
  var API = root.MadridStationAPI;
  if (!API) { return; }
  var ACTIONS = ["start", "reset", "binsky", "calibrate"]; // channel_core.py SURFACE_ACTIONS["playhouse"]
  var MAX_COUNT = 20;                                      // channel_core.py SURFACE_COMMAND_MAX_COUNT

  API.defaults({surfaces: {playhouse: {command: "", command_id: 0, count: 1}}, programming: {}});

  // channel_programming.take_control: only the tuned, programmed channel leaves its
  // schedule. The module ignores presentation once status is live-control, so it is
  // left in place (the Python snapshot recomputes it on every poll).
  function takeControl(state, channel) {
    var selected = state.programming && state.programming.selected;
    if (selected && selected.channel === channel && channel === state.channel) { selected.status = "live-control"; }
  }

  API.register("POST", "/api/programming/control", function (body, query, ctx) {
    takeControl(ctx.state, ctx.state.channel);
    ctx.emit();
    return ctx.state;
  });

  // channel_server.py /api/surface-command for the playhouse surface only: any other
  // surface is "unknown surface" here, as in Python for a surface it does not know.
  API.register("POST", "/api/surface-command", function (body, query, ctx) {
    var state = ctx.state;
    if (String(body.surface || "") !== "playhouse") { throw new Error("unknown surface"); }
    var action = String(body.action || "");
    if (ACTIONS.indexOf(action) < 0) { throw new Error("unknown surface action"); }
    var count = body.count === undefined ? 1 : Number(body.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) { throw new Error("invalid surface command count"); }
    takeControl(state, "playhouse");
    var surfaces = state.surfaces || (state.surfaces = {});
    var current = surfaces.playhouse || {command_id: 0};
    // count is 1: none of the playhouse actions is in REPEATABLE_SURFACE_ACTIONS.
    surfaces.playhouse = {command: action, command_id: (Number(current.command_id) || 0) + 1, count: 1};
    ctx.emit();
    return state;
  });

  // The Kinect's seat: ask for the visitor's camera the first time CH 15 is tuned.
  // Asked once per page; a refusal is kept by MadridWebcam and the deck's USE
  // CAMERA button is the way back. The shell's tune() writes state.channel
  // without emit(), so the station's 400 ms heartbeat is checked as well.
  // Releasing the camera when the dial leaves 15 is the shell's call (MadridWebcam
  // is shared with other channels and has no owner); see docs/channels/15.md.
  var asked = false;
  function onState(state) {
    if (asked || !state || state.channel !== "playhouse") { return; }
    asked = true;
    if (root.MadridWebcam) { root.MadridWebcam.request("CH 15 MARLIN'S PLAYHOUSE WANTS YOUR CAMERA"); }
  }
  API.subscribe(onState);
  var watch = root.setInterval(function () { onState(API.state); if (asked) { root.clearInterval(watch); } }, 400);
  onState(API.state);
}(window));
