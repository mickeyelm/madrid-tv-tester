/* MADRiD TV Web, CH 09 DRONE shim. Ports channel_drone.py (default_drone_state
 * 51-59, normalize_layer 62-88, the nodes projection 185-187) and the
 * channel_core.py mutations behind the legacy form routes (add_drone_node
 * 2028-2039, set_drone_params 2045-2070, _commit_drone 2072-2081,
 * commit_drone_layer 2088-2096, clear_drone_layers 2127-2130) into the page,
 * answering them on the paths channel_server.py served (1875-1897) plus the
 * TV's calibration report (1292-1309). The Kinect the server handed CH 09
 * while on air (channel_server.py:416-420) becomes the visitor's camera via
 * static/webcam.js. Loaded after station-api.js, before the drone modules. */
(function (root) {
  "use strict";
  var API = root.MadridStationAPI;
  if (!API) { return; }
  var WAVES = ["sine", "triangle", "sawtooth", "square"];                       // DRONE_WAVES
  var RANGES = {tuning: [24, 240], cutoff: [40, 12000], resonance: [0, 30]};    // DRONE_RANGES
  var MAX_LAYERS = 40, MAX_POINTS = 128;                                        // DRONE_MAX_*
  var NEUTRAL = {occupancy: 0, horizontalCenter: 0, averageDepth: .5, movementEnergy: 0, trackingConfidence: 0};
  var asked = false;

  // channel_drone.default_drone_state
  function defaultDrone() {
    return {schema: 1, tuning: 55, cutoff: 900, resonance: 7, wave: "sawtooth", layers: [], profiles: [],
      selected_profile_id: "", delay: {time: .375, feedback: .28, tone: 3200, send: 0},
      reverb: {decay: 2.6, damping: 4800, send: .34}, movement_fx: 0, sound_enabled: true,
      rev: 0, next_layer_id: 1, nodes: [], next_node_id: 1};
  }
  // channel_core.add_drone_node / set_drone_params: float() on a form value; never a bool or
  // non-finite. Python's float() takes decimal literals only, so a string must look like one (no hex).
  var DECIMAL = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;
  function numeric(value, name) {
    if (typeof value === "string" && DECIMAL.test(value)) { value = Number(value); }
    if (typeof value !== "number" || !isFinite(value)) { throw new Error("invalid drone " + name); }
    return value;
  }
  // channel_drone.number: a JSON number inside a layer, never a string or bool.
  function number(value, low, high, name) {
    if (typeof value !== "number" || !isFinite(value) || value < low || value > high) {
      throw new Error("invalid drone " + name);
    }
    return value;
  }
  // channel_drone.fields with allowed == required: a plain object with exactly these keys.
  function fields(value, keys, message) {
    var own = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : null;
    if (!own || own.length !== keys.length || keys.some(function (k) { return own.indexOf(k) < 0; })) {
      throw new Error(message || "invalid drone fields");
    }
    return value;
  }
  function present(value) { return value !== undefined && value !== null; }
  // channel_drone.normalize_layer for a new layer (muted false, server clock).
  function normalizeLayer(kind, points, id) {
    if ((kind !== "tap" && kind !== "stroke") || !Array.isArray(points)) { throw new Error("invalid drone layer"); }
    if (points.length < 1 || points.length > MAX_POINTS || (kind === "tap" && points.length !== 1)) {
      throw new Error("invalid drone point count");
    }
    var out = [], previous = 0;
    points.forEach(function (p, i) {
      fields(p, ["x", "y", "t"]);
      var t = number(p.t, 0, 60, "point time");
      if ((i === 0 && t !== 0) || t < previous) { throw new Error("invalid drone point order"); }
      out.push({x: number(p.x, 0, 1, "x"), y: number(p.y, 0, 1, "y"), t: t});
      previous = t;
    });
    return {schema: 1, id: id, kind: kind, points: out, muted: false, created_at: Date.now() / 1000};
  }
  // channel_core._commit_drone: mutate a copy, bump rev, refresh the nodes projection, swap it in.
  // A throw inside mutate leaves state.drone untouched, as the server's deepcopy did.
  function commit(ctx, mutate) {
    var next = JSON.parse(JSON.stringify(ctx.state.drone));
    mutate(next);
    next.rev += 1;
    next.nodes = next.layers.map(function (l) { return {id: l.id, x: l.points[0].x, y: l.points[0].y}; });
    next.next_node_id = next.next_layer_id;
    ctx.state.drone = next;
    ctx.emit();
    return ctx.state;   // _drone_transaction returned the station snapshot
  }
  // channel_core.commit_drone_layer
  function commitLayer(next, kind, points) {
    if (next.layers.length >= MAX_LAYERS) { throw new Error("drone layer capacity reached"); }
    next.layers.push(normalizeLayer(kind, points, next.next_layer_id));
    next.next_layer_id += 1;
  }

  API.defaults({
    drone: defaultDrone(),
    drone_runtime: {
      // No room calibration in the page: tv-drone.js:335-338 aborts the driver on a null session.
      calibration: null,
      // tv-drone.js:456 reads roomRuntime.environment before roomRuntime.kinect. Read live on
      // every apply; neutral (no room expression) until the visitor allows the camera.
      get environment() { return root.MadridWebcam ? root.MadridWebcam.environment() : NEUTRAL; }
    }
  });

  // POST /api/drone/node: channel_server.py:1875-1881 -> add_drone_node, x/y clamped into one tap
  // layer. Also takes the pad's {kind, points} gesture (the drone.layer.commit command,
  // channel_server.py:2614-2615) so strokes survive without this shim owning the shared
  // /api/remote/v1 command bus.
  API.register("POST", "/api/drone/node", function (body, query, ctx) {
    return commit(ctx, function (next) {
      if (Array.isArray(body.points)) {   // the gesture form carries exactly {kind, points}
        fields(body, ["kind", "points"], "invalid drone layer"); commitLayer(next, body.kind, body.points); return;
      }
      var x = numeric(body.x, "node"), y = numeric(body.y, "node");
      commitLayer(next, "tap", [{x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), t: 0}]);
    });
  });
  // POST /api/drone/clear: channel_server.py:1882-1886 -> clear_drone_layers
  API.register("POST", "/api/drone/clear", function (body, query, ctx) {
    return commit(ctx, function (next) { next.layers = []; });
  });
  // POST /api/drone/params: channel_server.py:1887-1897 -> set_drone_params (clamped; wave checked)
  API.register("POST", "/api/drone/params", function (body, query, ctx) {
    return commit(ctx, function (next) {
      var changed = false;
      Object.keys(RANGES).forEach(function (name) {
        if (!present(body[name])) { return; }
        var value = numeric(body[name], name);
        next[name] = Math.min(RANGES[name][1], Math.max(RANGES[name][0], value));
        changed = true;
      });
      if (present(body.wave)) {
        if (WAVES.indexOf(body.wave) < 0) { throw new Error("invalid drone wave"); }
        next.wave = body.wave; changed = true;
      }
      if (!changed) { throw new Error("no drone parameters supplied"); }
    });
  });
  // POST /api/drone/calibration/renderer: channel_server.py:1292-1309. The TV reports calibration
  // events to the room coordinator; there is none here. tv-drone.js:437-439 only checks
  // response.ok, and never sends without a session.
  API.register("POST", "/api/drone/calibration/renderer", function (body) {
    fields(body, ["session", "event"], "invalid renderer report");   // set(data) == {session, event}
    if (typeof body.session !== "string" || typeof body.event !== "string") {
      throw new Error("invalid renderer report");
    }
    return {ok: true, session: body.session, event: body.event, accepted: false};
  });

  // Kinect -> webcam: ask once when the dial lands on DRONE; a refusal stands for this page
  // (the deck's USE CAMERA button is the visitor's way back). The shell re-applies state on its
  // own clock and may not emit on a tune, so poll the channel until the ask has happened.
  function askCamera() {
    if (asked || API.state.channel !== "drone" || !root.MadridWebcam) { return false; }
    asked = true;
    root.MadridWebcam.request("CH 09 DRONE WANTS YOUR CAMERA");
    return true;
  }
  if (!askCamera()) {
    var watch = root.setInterval(function () { if (askCamera()) { root.clearInterval(watch); } }, 500);
    if (watch && watch.unref) { watch.unref(); }   // Node self-check only; browsers return a number
  }
}(window));
