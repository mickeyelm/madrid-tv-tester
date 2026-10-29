/* CH 14 SYNTH VISIONS — pure Signal Loom geometry and deterministic wear. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SynthVisualModel = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WIDTH = 240;
  var HEIGHT = 180;
  var SAFE_X = 17;
  var SAFE_Y = 13;

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function hash(value) {
    var x = Math.sin(Number(value) * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function noteY(note) {
    return clamp(HEIGHT * (0.81 - (note - 40) / 44 * 0.62), SAFE_Y, HEIGHT - SAFE_Y);
  }

  function beatX(beat) {
    return SAFE_X + (((beat % 32) + 32) % 32) / 31 * (WIDTH - SAFE_X * 2);
  }

  function qualityStyle(quality) {
    if (quality === "min") { return { topology: "twin", phase: 0, knockout: false }; }
    if (quality === "7") { return { topology: "broken", phase: 1, knockout: false }; }
    if (quality === "sus") { return { topology: "shelf", phase: 0, knockout: false }; }
    if (quality === "ghost") { return { topology: "negative", phase: 1, knockout: true }; }
    return { topology: "solid", phase: 0, knockout: false };
  }

  function rotationAge(event, rotation) {
    return Math.max(0, rotation - (typeof event.born === "number" ? event.born : rotation));
  }

  function primitives(events, voiced, rotation, currentBeat, pulse, signal, body) {
    var rows = [];
    var eventList = events || [];
    var voiceList = voiced || [];
    for (var i = 0; i < eventList.length; i += 1) {
      var event = eventList[i];
      var notes = voiceList[i] || event.notes || [48, 52, 55, 60];
      var age = rotationAge(event, rotation);
      var intensity = clamp(Math.pow(0.78, age) * (0.62 + 0.38 * signal), 0.04, 1);
      rows.push({
        id: event.id,
        player: event.player || null,
        beat: event.beat,
        x: beatX(event.beat),
        notes: notes.slice(0, 4),
        ys: notes.slice(0, 4).map(noteY),
        age: age,
        intensity: intensity,
        style: qualityStyle(event.quality),
        seed: hash((event.id || i + 1) * 97 + rotation * 131)
      });
    }
    var bodyAmount = body && body.amount ? clamp(body.amount, 0, 1) : 0;
    var bodyAttractors = [];
    if (bodyAmount > 0) {
      bodyAttractors.push({
        x: WIDTH * clamp(0.5 + (body.lean || 0) * 0.14, 0.24, 0.76),
        y: HEIGHT * clamp(0.54 - (body.lift || 0) * 0.12, 0.28, 0.74),
        radius: 9 + 20 * clamp(body.span || 0, 0, 1),
        strength: bodyAmount * clamp(body.confidence || 0, 0, 1)
      });
    }
    var damaged = 1 - clamp(signal, 0, 1);
    return {
      width: WIDTH,
      height: HEIGHT,
      events: rows,
      beamX: beatX(currentBeat),
      seam: ((Math.floor(currentBeat) % 32) + 32) % 32 === 0,
      pulseScale: 1 - 0.035 * clamp(pulse, 0, 1),
      memory: 0.78 + 0.205 * clamp(signal, 0, 1),
      rowSlip: damaged > 0.28 ? Math.round(hash(rotation * 17 + Math.floor(currentBeat)) * damaged * 12) : 0,
      phaseOffset: damaged > 0.12 ? damaged * (1 + hash(rotation + 41) * 3) : 0,
      dropout: damaged > 0.48 && hash(rotation * 37 + Math.floor(currentBeat) * 11) < damaged * 0.16,
      bodyAttractors: bodyAttractors
    };
  }

  return {
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    clamp: clamp,
    hash: hash,
    noteY: noteY,
    beatX: beatX,
    qualityStyle: qualityStyle,
    primitives: primitives
  };
}));
