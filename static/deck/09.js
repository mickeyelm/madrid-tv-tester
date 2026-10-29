/* MADRiD TV Web: the remote's CH 09 DRONE pad, on the page. Ported from the
 * station's remote.html (#drone-panel 397-462) and drone-remote.js (gesture
 * 3-7, pad pointer handling 22-64, CLEAR 66, params 93-99, wave 100-102,
 * render 111-146). The pad posts the legacy form routes the shim answers
 * (/api/drone/node, /api/drone/clear, /api/drone/params). The layer list with
 * MUTE / REMOVE / REDRAW, STOP SOUND, the DELAY / REVERB ranges and the room
 * profile select rode the station's /api/remote/v1 command bus and are not
 * here. USE CAMERA stands where TUNE TO ROOM stood. */
(function (root) {
  "use strict";
  var Deck = root.MadridDeck, API = root.MadridStationAPI;
  if (!Deck) { return; }
  var REASON = "CH 09 DRONE WANTS YOUR CAMERA";
  var mounted = null;

  // drone-remote.js:3-7, with times re-based so points[0].t === 0 (channel_drone.py:78 rejects
  // a first point that is not at 0; the station pad could send a sub-millisecond first t).
  function gesture(points) {
    var result = [], count = Math.min(128, points.length), t0 = points[0].t;
    for (var i = 0; i < count; i++) {
      var p = points[Math.round(i * (points.length - 1) / Math.max(1, count - 1))];
      result.push({x: p.x, y: p.y, t: p.t - t0});
    }
    return {kind: points.length < 2 ? "tap" : "stroke", points: result};
  }

  Deck.register("drone", {
    title: "DRONE / ROOM INSTRUMENT",
    mount: function (el, api) {
      el.innerHTML =
        '<div id="drone-panel">' +
        '<div class="drone-pad-wrap"><canvas id="drone-pad" width="480" height="360" aria-label="Harmonic pad"></canvas></div>' +
        '<div class="drone-readout"><span id="drone-node-count">0 LAYERS</span><button type="button" id="drone-clear">CLEAR</button></div>' +
        '<div id="drone-command-status" role="status" aria-live="polite"></div>' +
        '<div class="drone-sliders">' +
        '<label class="drone-slider"><span class="drone-slider-name">OSC TUNE</span>' +
        '<input type="range" id="drone-tuning" min="0" max="100" step="0.5" value="36"><span class="drone-slider-value" id="drone-tuning-value">55 HZ</span></label>' +
        '<label class="drone-slider"><span class="drone-slider-name">FILTER CUTOFF</span>' +
        '<input type="range" id="drone-cutoff" min="0" max="100" step="0.5" value="55"><span class="drone-slider-value" id="drone-cutoff-value">900 HZ</span></label>' +
        '<label class="drone-slider"><span class="drone-slider-name">RESONANCE</span>' +
        '<input type="range" id="drone-resonance" min="0" max="30" step="0.5" value="7"><span class="drone-slider-value" id="drone-resonance-value">7.0</span></label>' +
        '</div>' +
        '<div class="drone-grid drone-wave-row">' +
        '<button type="button" data-drone-wave="sine">SINE</button>' +
        '<button type="button" data-drone-wave="triangle">TRI</button>' +
        '<button type="button" data-drone-wave="sawtooth" class="is-selected">SAW</button>' +
        '<button type="button" data-drone-wave="square">SQR</button>' +
        '</div>' +
        '<div class="drone-grid drone-camera-row"><button type="button" id="drone-camera">USE CAMERA</button></div>' +
        '</div>';
      var panel = el.querySelector("#drone-panel");
      var pad = panel.querySelector("#drone-pad"), ctx = pad.getContext("2d");
      var status = panel.querySelector("#drone-command-status");
      var camera = panel.querySelector("#drone-camera");
      var waves = panel.querySelectorAll("[data-drone-wave]");
      var state = null, points = [], pointer = null, began = 0, pending = false;
      function q(id) { return panel.querySelector("#" + id); }

      // drone-remote.js:14-21 against api.post; the answer is the station snapshot. The body goes
      // as a JSON string: the shell form-encodes plain objects, which would flatten a stroke's points.
      function send(path, body) {
        pending = true; status.textContent = "PENDING";
        return Promise.resolve(api.post(path, JSON.stringify(body))).then(function (next) {
          if (next && next.error) { throw new Error(next.error); }
          if (next && next.drone) { render(next); }
          status.textContent = "";
        }).catch(function (error) {
          status.textContent = String(error && error.message || error);
        }).then(function () { pending = false; });
      }
      // drone-remote.js:22-41, without the selected-layer colour (no layer list here).
      function point(event) {
        var rect = pad.getBoundingClientRect();
        return {x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
          t: Math.min(30, (performance.now() - began) / 1000)};
      }
      function trace(list, color) {
        if (!list.length) { return; }
        ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = 2; ctx.beginPath();
        list.forEach(function (p, i) { ctx[i ? "lineTo" : "moveTo"](p.x * pad.width, p.y * pad.height); });
        if (list.length === 1) { ctx.arc(list[0].x * pad.width, list[0].y * pad.height, 4, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.stroke(); }
      }
      function draw() {
        ctx.fillStyle = "#111111"; ctx.fillRect(0, 0, pad.width, pad.height);
        (state && state.drone.layers || []).forEach(function (layer) {
          trace(layer.points, layer.muted ? "#444444" : "#ff4f00");
        });
        trace(points, "#f0ede8");
      }
      // drone-remote.js:42-64
      pad.addEventListener("pointerdown", function (event) {
        if (pending || pointer !== null) { return; }
        event.preventDefault(); pointer = event.pointerId; began = performance.now();
        points = [point(event)];
        try { pad.setPointerCapture(pointer); } catch (e) { /* no active pointer (synthetic event): the stroke still ends on pointerup */ }
        draw();
      });
      pad.addEventListener("pointermove", function (event) {
        if (pointer !== event.pointerId) { return; }
        event.preventDefault();
        var p = point(event), last = points[points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) > .004 && points.length < 2048) { points.push(p); }
        draw();
      });
      pad.addEventListener("pointerup", function (event) {
        if (pointer !== event.pointerId) { return; }
        pointer = null;
        var value = gesture(points); points = [];
        // A tap is the legacy node (remote.js:799-800 posted x and y); a stroke carries the gesture.
        send("/api/drone/node", value.kind === "tap" ? {x: value.points[0].x, y: value.points[0].y} : value);
        draw();
      });
      function discard() { pointer = null; points = []; draw(); }
      pad.addEventListener("pointercancel", discard);
      pad.addEventListener("lostpointercapture", discard);

      // drone-remote.js:66, 93-102
      q("drone-clear").addEventListener("click", function () { send("/api/drone/clear", {}); });
      [["tuning", function (v) { return 24 * Math.pow(10, v / 100); }],
        ["cutoff", function (v) { return 40 * Math.pow(300, v / 100); }],
        ["resonance", Number]].forEach(function (entry) {
        q("drone-" + entry[0]).addEventListener("change", function () {
          var payload = {}; payload[entry[0]] = entry[1](Number(this.value)); send("/api/drone/params", payload);
        });
      });
      Array.prototype.forEach.call(waves, function (button) {
        button.addEventListener("click", function () { send("/api/drone/params", {wave: button.getAttribute("data-drone-wave")}); });
      });
      // The room sensor is the visitor's camera. A refusal on the consent card stands until the
      // visitor presses this; live, the same button stops it.
      camera.addEventListener("click", function () {
        var webcam = api.webcam;
        if (!webcam) { return; }
        if (webcam.status().state === "live") { webcam.release(); return; }
        if (webcam.status().decision === false) { webcam.forget(); }
        webcam.request(REASON);
      });
      function cameraLabel() {
        var s = api.webcam ? api.webcam.status() : {state: "unavailable"};
        var busy = s.state === "asking" || s.state === "loading";
        camera.textContent = s.state === "live" ? "STOP CAMERA" : busy ? "CAMERA..." :
          s.state === "unavailable" ? "NO CAMERA" : "USE CAMERA";
        camera.disabled = busy || s.state === "unavailable";
      }
      // drone-remote.js:111-146 minus the layer list, profile select, calibration and room rows.
      function render(next) {
        if (!next || !next.drone) { return; }
        state = next; var drone = state.drone, layers = drone.layers || [];
        q("drone-node-count").textContent = layers.length + " LAYERS";
        [["tuning", 100 * Math.log(drone.tuning / 24) / Math.LN10, Math.round(drone.tuning) + " HZ"],
          ["cutoff", 100 * Math.log(drone.cutoff / 40) / Math.log(300), Math.round(drone.cutoff) + " HZ"],
          ["resonance", drone.resonance, Number(drone.resonance).toFixed(1)]].forEach(function (item) {
          if (document.activeElement !== q("drone-" + item[0])) { q("drone-" + item[0]).value = item[1]; }
          q("drone-" + item[0] + "-value").textContent = item[2];
        });
        Array.prototype.forEach.call(waves, function (b) {
          b.classList.toggle("is-selected", b.getAttribute("data-drone-wave") === drone.wave);
        });
        cameraLabel();
        draw();
      }
      mounted = {render: render, cameraLabel: cameraLabel};
      render(api.state());
    }
  });

  // The station's remote re-rendered on every poll; here the state module says when.
  if (API && API.subscribe) { API.subscribe(function (state) { if (mounted) { mounted.render(state); } }); }
  if (root.MadridWebcam) { root.MadridWebcam.onChange(function () { if (mounted) { mounted.cameraLabel(); } }); }
}(window));
