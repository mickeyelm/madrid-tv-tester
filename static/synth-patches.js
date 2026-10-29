/* CH 14 SYNTH VISIONS patches — pure data + math, no Web Audio, no DOM.
 *
 * Every pitched patch is a recipe the engine interprets: oscillator stack
 * (type, octave shift, detune cents, level), an ADSR-ish envelope, and a
 * lowpass whose cutoff tracks the note. Drum lanes are parameter sets for
 * the engine's three drum voices (swept sine, filtered noise, noise burst).
 * Rhythm presets live in synth-transport (timing); this file is timbre.
 * Dual export: browser global + module.exports (Node test runner). */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SynthPatches = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Stable IDs keep saved loops, native clients and MIDI maps playable.
  var PATCHES = {
    tape: {
      label: "VELVET TAPE",
      oscillators: [
        { type: "sawtooth", octave: 0, detune: -6, level: 0.32, pan: -0.55 },
        { type: "sawtooth", octave: 0, detune: 6, level: 0.32, pan: 0.55 },
        { type: "triangle", octave: 0, detune: 0, level: 0.28 }
      ],
      drift: { rate: 0.43, cents: 3.2 },
      envelope: { attack: 0.075, decay: 0.55, sustain: 0.58, release: 1.35 },
      filter: { base: 1350, track: 1.6, bloom: 0.45, q: 0.6 },
      gain: 0.11
    },
    organ: {
      label: "ROUND SUB",
      mono: true,
      octaveShift: -1,
      glide: 0.025,
      oscillators: [
        { type: "sine", octave: 0, detune: 0, level: 0.82 },
        { type: "triangle", octave: 1, detune: 0, level: 0.18 }
      ],
      envelope: { attack: 0.008, decay: 0.23, sustain: 0.52, release: 0.18 },
      filter: { base: 460, track: 1.4, q: 0.5 },
      gain: 0.19
    },
    harp: {
      label: "GLASS PLUCK",
      fm: { ratio: 2.76, index: 0.65, indexDecay: 0.16 },
      oscillators: [
        { type: "sine", octave: 0, detune: 0, level: 0.78 },
        { type: "sine", octave: 1, detune: 2, level: 0.13, decay: 0.19, pan: -0.35 },
        { type: "sine", octave: 2, detune: -3, level: 0.07, decay: 0.12, pan: 0.35 }
      ],
      envelope: { attack: 0.003, decay: 1.2, sustain: 0.012, release: 0.35 },
      filter: { base: 3800, track: 2, q: 0.4 },
      gain: 0.15
    },
    keys: {
      label: "ELECTRIC KEYS",
      fm: { ratio: 2, index: 1.6, indexDecay: 0.48 },
      oscillators: [
        { type: "sine", octave: 0, detune: -1.5, level: 0.76, pan: -0.15 },
        { type: "sine", octave: 0, detune: 1.5, level: 0.2, pan: 0.15 },
        { type: "sine", octave: 2, detune: 0, level: 0.045, decay: 0.055 }
      ],
      envelope: { attack: 0.004, decay: 0.75, sustain: 0.13, release: 0.65 },
      filter: { base: 2600, track: 2.5, q: 0.5 },
      gain: 0.145
    },
    bass: {
      label: "ACID BASS",
      mono: true,
      octaveShift: -1,
      glide: 0.035,
      oscillators: [
        { type: "sawtooth", octave: 0, detune: 0, level: 0.68 },
        { type: "square", octave: 0, detune: 0, level: 0.12 },
        { type: "sine", octave: 0, detune: 0, level: 0.2 }
      ],
      envelope: { attack: 0.004, decay: 0.2, sustain: 0.3, release: 0.15 },
      filter: { base: 230, track: 0.75, q: 5.5, envelope: 5, decay: 0.22 },
      gain: 0.12
    },
    brass: {
      label: "SOFT BRASS",
      oscillators: [
        { type: "sawtooth", octave: 0, detune: -4.5, level: 0.34, pan: -0.3 },
        { type: "sawtooth", octave: 0, detune: 4.5, level: 0.34, pan: 0.3 },
        { type: "triangle", octave: 0, detune: 0, level: 0.28 }
      ],
      drift: { rate: 4.7, cents: 2.4 },
      envelope: { attack: 0.095, decay: 0.24, sustain: 0.64, release: 0.42 },
      filter: { base: 650, track: 1.1, bloom: 1.7, q: 0.85 },
      gain: 0.11
    },
    vox: {
      label: "FORMANT CHOIR",
      oscillators: [
        { type: "sawtooth", octave: 0, detune: -7, level: 0.4, pan: -0.45 },
        { type: "sawtooth", octave: 0, detune: 7, level: 0.4, pan: 0.45 },
        { type: "triangle", octave: 0, detune: 0, level: 0.15 }
      ],
      drift: { rate: 5.1, cents: 4 },
      formants: [640, 1120, 2600],
      envelope: { attack: 0.16, decay: 0.45, sustain: 0.72, release: 1.2 },
      filter: { base: 3500, track: 0.4, q: 0.4 },
      gain: 0.14
    }
  };

  var DRUMS = {
    kick: {
      voice: "sweep", startHz: 156, endHz: 46, sweep: 0.055, click: 0.12,
      envelope: { attack: 0.002, release: 0.33 }, gain: 0.34
    },
    snare: {
      voice: "noise-tone", toneHz: 184, noiseHz: 1850,
      envelope: { attack: 0.001, release: 0.19 }, gain: 0.25
    },
    hat: {
      voice: "noise", noiseHz: 6700, metallic: true,
      envelope: { attack: 0.001, release: 0.072 }, gain: 0.16
    },
    clap: {
      voice: "noise", noiseHz: 1350, bursts: [0, 0.012, 0.024],
      envelope: { attack: 0.001, release: 0.16 }, gain: 0.24
    }
  };

  var ORDER = ["tape", "organ", "harp", "keys", "bass", "brass", "vox"];

  function patch(name) {
    return PATCHES[name] || PATCHES.tape;
  }

  function drum(lane) {
    return DRUMS[lane] || null;
  }

  function label(name) {
    return patch(name).label;
  }

  /* Envelope timeline for a note: returns absolute (time, level) ramp points
   * relative to `when`, scaled by velocity and a duration hint, so the
   * engine just replays them onto a GainNode. Pure and testable. */
  function envelopePoints(recipe, velocity, duration) {
    var env = recipe.envelope;
    var peak = Math.max(0.0002, recipe.gain * Math.min(1, Math.max(0.05, velocity)));
    var sustainLevel = Math.max(0.0001, peak * env.sustain);
    var hold = Math.max(0, (duration || 0) - env.attack - env.decay);
    var points = [
      { at: 0, level: 0.0001 },
      { at: env.attack, level: peak },
      { at: env.attack + env.decay, level: sustainLevel }
    ];
    if (hold > 0) {
      points.push({ at: env.attack + env.decay + hold, level: sustainLevel });
    }
    var last = points[points.length - 1].at;
    points.push({ at: last + env.release, level: 0.0001 });
    return points;
  }

  function filterHz(recipe, midiNote) {
    var hz = 440 * Math.pow(2, (midiNote - 69) / 12);
    return Math.min(9000, Math.max(220,
      recipe.filter.base + hz * recipe.filter.track * 2));
  }

  function noteSeconds(recipe, beatSeconds) {
    // Pads/organ hold about a beat; plucks/keys ring on their own decay.
    var env = recipe.envelope;
    if (env.sustain <= 0.15) { return 0; }
    return beatSeconds * 0.92;
  }

  return {
    ORDER: ORDER,
    patch: patch,
    drum: drum,
    label: label,
    envelopePoints: envelopePoints,
    filterHz: filterHz,
    noteSeconds: noteSeconds
  };
}));
