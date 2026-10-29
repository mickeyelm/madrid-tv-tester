/* CH 14 SYNTH VISIONS strumplate — pure zone math, no DOM, no audio.
 *
 * The Omnichord idea: the current chord's tones are laid across the strip
 * over two octaves; dragging a finger across zone boundaries plucks each
 * tone it enters. Velocity comes from how fast the finger is moving. The
 * remote batches one strum gesture segment into a single /api/synth/strum
 * request; the server quantizes each pluck onto the quarter-beat grid.
 * Dual export: browser global + module.exports (Node test runner). */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SynthStrum = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Mirror of the server's degree/quality tables (channel_core.py /
  // synth-voicing.js). C-major gravity, root octave MIDI 48 (C3).
  var DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 10, 8];
  var DEGREE_QUALITIES = ["maj", "min", "min", "maj", "maj", "min", "maj", "ghost"];
  var QUALITY_INTERVALS = {
    maj: [0, 4, 7, 11],
    min: [0, 3, 7, 10],
    "7": [0, 4, 7, 10],
    sus: [0, 5, 7, 10],
    ghost: [0, 3, 7, 11]
  };
  var ROOT_BASE = 48;

  /* The strip's note ladder: chord tones over two octaves, low to high.
   * Eight zones — four tones twice — exactly like the Omnichord's harp
   * covers its chord in repeating octaves. */
  function ladder(degree, quality) {
    var semitone = DEGREE_SEMITONES[degree] || 0;
    var name = !quality || quality === "default"
      ? DEGREE_QUALITIES[degree] || "maj"
      : quality;
    var intervals = QUALITY_INTERVALS[name] || QUALITY_INTERVALS.maj;
    var notes = [];
    for (var octave = 0; octave < 2; octave += 1) {
      for (var i = 0; i < intervals.length; i += 1) {
        notes.push(ROOT_BASE + semitone + intervals[i] + octave * 12);
      }
    }
    return notes;
  }

  function zoneAt(x, zoneCount) {
    if (!(x >= 0)) { x = 0; }
    if (x > 1) { x = 1; }
    var zone = Math.floor(x * zoneCount);
    return zone >= zoneCount ? zoneCount - 1 : zone;
  }

  /* Walk a touch trace (positions {x: 0..1, t: ms}) and emit one pluck per
   * zone boundary crossed, in order, including the starting zone. Velocity
   * maps finger speed (strip-widths per second) into 0.35..1. Offsets
   * preserve intra-gesture timing in seconds relative to the trace start. */
  function plucksForTrace(notes, trace) {
    if (!notes || !notes.length || !trace || !trace.length) { return []; }
    var zoneCount = notes.length;
    var plucks = [];
    var zone = zoneAt(trace[0].x, zoneCount);
    plucks.push({ zone: zone, note: notes[zone], velocity: 0.7,
      offsetSeconds: 0 });
    for (var i = 1; i < trace.length; i += 1) {
      var previous = trace[i - 1];
      var current = trace[i];
      var nextZone = zoneAt(current.x, zoneCount);
      if (nextZone === zone) { continue; }
      var dt = Math.max(1, current.t - previous.t) / 1000;
      var speed = Math.abs(current.x - previous.x) / dt;
      var velocity = Math.min(1, Math.max(0.35, 0.3 + speed * 0.35));
      var step = nextZone > zone ? 1 : -1;
      for (var z = zone + step; step > 0 ? z <= nextZone : z >= nextZone; z += step) {
        plucks.push({
          zone: z,
          note: notes[z],
          velocity: velocity,
          offsetSeconds: (current.t - trace[0].t) / 1000
        });
      }
      zone = nextZone;
    }
    return plucks;
  }

  return {
    ladder: ladder,
    zoneAt: zoneAt,
    plucksForTrace: plucksForTrace
  };
}));
