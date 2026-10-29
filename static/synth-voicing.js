/* CH 14 SYNTH VISIONS voicing engine — pure functions, no DOM, no audio.
 *
 * The Orchid inheritance, earned: every pad is a lush seventh chord, and the
 * solver chooses among real close-position inversion candidates (MIDI 40-84)
 * by minimizing voice travel, single-voice leaps, register drift, and spread
 * — not by matching interval indexes. Re-taps take a nearby different
 * candidate instead of ratcheting octaves. voiceRing() solves the whole
 * 32-beat loop with last->first closure so the seam is never the worst jump.
 *
 * The exact four MIDI notes returned here are consumed by BOTH the audio
 * engine and the Signal Loom, so voice-leading failures are visible failures.
 * Dual export: browser global + module.exports (Node test runner). */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SynthVoicing = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // C-major / A-minor gravity: I ii iii IV V vi bVII bVI.
  var DEGREES = [
    { label: "C", semitone: 0, quality: "maj" },
    { label: "D", semitone: 2, quality: "min" },
    { label: "E", semitone: 4, quality: "min" },
    { label: "F", semitone: 5, quality: "maj" },
    { label: "G", semitone: 7, quality: "maj" },
    { label: "A", semitone: 9, quality: "min" },
    { label: "Bb", semitone: 10, quality: "maj" },
    { label: "Ab", semitone: 8, quality: "maj" }
  ];

  var QUALITIES = {
    maj: { suffix: "maj7", intervals: [0, 4, 7, 11] },
    min: { suffix: "m7", intervals: [0, 3, 7, 10] },
    "7": { suffix: "7", intervals: [0, 4, 7, 10] },
    sus: { suffix: "sus7", intervals: [0, 5, 7, 10] },
    ghost: { suffix: "mM7", intervals: [0, 3, 7, 11] }
  };

  var RANGE_LOW = 40;
  var RANGE_HIGH = 84;
  // Warm tape-ballad register: candidates are pulled toward this center so
  // long sessions neither sink into mud nor ratchet into glass.
  var REGISTER_CENTER = 58;
  var MAX_COMFORT_SPREAD = 17;

  // Cost weights. Travel dominates (close voicing), leaps hurt extra, the
  // register term prevents drift, and repeat penalties force re-voicing.
  var W_TRAVEL = 3;
  var W_LEAP = 2;
  var W_CENTER = 1;
  var W_CENTER_SQUARED = 0.6; // quadratic: drift away from center self-corrects
  var W_SPREAD = 2;
  var PENALTY_SAME_AS_PREVIOUS = 200;
  var PENALTY_IN_HISTORY = 20;

  function chordSpec(degree, quality) {
    var index = Math.max(0, Math.min(DEGREES.length - 1, degree | 0));
    var pad = DEGREES[index];
    var name = quality === "default" || !QUALITIES[quality] ? pad.quality : quality;
    var shape = QUALITIES[name];
    return {
      label: pad.label + shape.suffix,
      rootPc: pad.semitone,
      quality: name,
      intervals: shape.intervals.slice()
    };
  }

  function sortedPitchClasses(spec) {
    var seen = {};
    var pcs = [];
    for (var i = 0; i < spec.intervals.length; i += 1) {
      var pc = (spec.rootPc + spec.intervals[i]) % 12;
      if (!seen[pc]) { seen[pc] = true; pcs.push(pc); }
    }
    pcs.sort(function (x, y) { return x - y; });
    return pcs;
  }

  /* Every close-position stack of the chord's pitch classes: each rotation
   * (inversion) at each octave placement that fits MIDI 40-84. Construction
   * stacks each next pitch class directly above the previous voice, so
   * candidates are strictly ascending — no unisons, no crossings. */
  function voicingCandidates(spec, range) {
    var low = range && range.low !== undefined ? range.low : RANGE_LOW;
    var high = range && range.high !== undefined ? range.high : RANGE_HIGH;
    var pcs = sortedPitchClasses(spec);
    var candidates = [];
    for (var inversion = 0; inversion < pcs.length; inversion += 1) {
      var sequence = pcs.slice(inversion).concat(pcs.slice(0, inversion));
      var bass = sequence[0] + 12 * Math.ceil((low - sequence[0]) / 12);
      for (var start = bass; start <= high; start += 12) {
        var notes = [start];
        for (var voice = 1; voice < sequence.length; voice += 1) {
          var step = (sequence[voice] - sequence[voice - 1] + 12) % 12;
          if (step === 0) { step = 12; }
          notes.push(notes[voice - 1] + step);
        }
        if (notes[notes.length - 1] > high) { break; }
        candidates.push(notes);
      }
    }
    return candidates;
  }

  function sameNoteSet(a, b) {
    if (!a || !b || a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) { return false; }
    }
    return true;
  }

  function shapeCost(notes) {
    var sum = 0;
    for (var i = 0; i < notes.length; i += 1) { sum += notes[i]; }
    var center = sum / notes.length;
    var spread = notes[notes.length - 1] - notes[0];
    var drift = Math.abs(center - REGISTER_CENTER);
    var cost = drift * W_CENTER + drift * drift * W_CENTER_SQUARED;
    if (spread > MAX_COMFORT_SPREAD) {
      cost += (spread - MAX_COMFORT_SPREAD) * W_SPREAD;
    }
    return cost;
  }

  function transitionCost(previous, next) {
    var total = 0;
    var worst = 0;
    for (var i = 0; i < previous.length; i += 1) {
      var move = Math.abs(next[i] - previous[i]);
      total += move;
      if (move > worst) { worst = move; }
    }
    return total * W_TRAVEL + worst * W_LEAP;
  }

  /* Choose the best candidate for one chord. `previous` is the four MIDI
   * notes sounding before this chord (or null). `history` optionally lists
   * recent voicings already used for this same chord, so re-taps pick a
   * nearby different inversion instead of repeating or walking the range. */
  function voiceChord(spec, previous, history) {
    var candidates = voicingCandidates(spec);
    var hasPrevious = previous && previous.length === 4;
    var best = null;
    var bestCost = Infinity;
    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = candidates[i];
      var cost = shapeCost(candidate);
      if (hasPrevious) {
        cost += transitionCost(previous, candidate);
        if (sameNoteSet(candidate, previous)) {
          cost += PENALTY_SAME_AS_PREVIOUS;
        }
      }
      if (history) {
        for (var h = 0; h < history.length; h += 1) {
          if (sameNoteSet(candidate, history[h])) {
            cost += PENALTY_IN_HISTORY;
          }
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    }
    return best ? best.slice() : [];
  }

  function pruneCandidates(spec, limit) {
    var candidates = voicingCandidates(spec);
    var scored = candidates.map(function (candidate, index) {
      return { notes: candidate, cost: shapeCost(candidate), index: index };
    });
    scored.sort(function (x, y) {
      return x.cost - y.cost || x.index - y.index;
    });
    return scored.slice(0, limit).map(function (entry) { return entry.notes; });
  }

  /* Solve the whole event ring cyclically. Events carry
   * {id, beat, degree, quality}; the result preserves beat order and returns
   * {id, beat, degree, quality, label, notes} per event. A bounded
   * dynamic-programming pass runs once per pinned first-chord candidate so
   * the last->first seam transition is optimized, not ignored. */
  var RING_CANDIDATE_LIMIT = 8;

  function voiceRing(events) {
    if (!events || !events.length) { return []; }
    var ordered = events.slice().sort(function (x, y) {
      return x.beat - y.beat || x.id - y.id;
    });
    var specs = ordered.map(function (event) {
      return chordSpec(event.degree, event.quality || "default");
    });
    var options = specs.map(function (spec) {
      return pruneCandidates(spec, RING_CANDIDATE_LIMIT);
    });
    var count = ordered.length;
    var chosen = null;

    if (count === 1) {
      chosen = [voiceChord(specs[0], null)];
    } else {
      var bestTotal = Infinity;
      for (var pin = 0; pin < options[0].length; pin += 1) {
        var first = options[0][pin];
        var costs = [];
        var pointers = [];
        var previousCosts = null;
        for (var step = 1; step < count; step += 1) {
          var stepCosts = [];
          var stepPointers = [];
          for (var c = 0; c < options[step].length; c += 1) {
            var candidate = options[step][c];
            var localShape = shapeCost(candidate);
            var bestHere = Infinity;
            var bestFrom = 0;
            var fromOptions = step === 1 ? [first] : options[step - 1];
            for (var p = 0; p < fromOptions.length; p += 1) {
              var fromCost = step === 1 ? shapeCost(first) : previousCosts[p];
              var candidateCost = fromCost + localShape +
                transitionCost(fromOptions[p], candidate);
              if (sameNoteSet(fromOptions[p], candidate) &&
                  specs[step].label === specs[step - 1].label) {
                candidateCost += PENALTY_IN_HISTORY;
              }
              if (candidateCost < bestHere) {
                bestHere = candidateCost;
                bestFrom = p;
              }
            }
            stepCosts.push(bestHere);
            stepPointers.push(bestFrom);
          }
          costs.push(stepCosts);
          pointers.push(stepPointers);
          previousCosts = stepCosts;
        }
        for (var last = 0; last < options[count - 1].length; last += 1) {
          var closed = previousCosts[last] +
            transitionCost(options[count - 1][last], first);
          if (closed < bestTotal) {
            bestTotal = closed;
            var path = new Array(count);
            path[count - 1] = last;
            for (var back = count - 1; back >= 1; back -= 1) {
              path[back - 1] = pointers[back - 1][path[back]];
            }
            chosen = new Array(count);
            chosen[0] = first;
            for (var fill = 1; fill < count; fill += 1) {
              chosen[fill] = options[fill][path[fill]];
            }
          }
        }
      }
    }

    return ordered.map(function (event, index) {
      return {
        id: event.id,
        beat: event.beat,
        degree: event.degree,
        quality: specs[index].quality,
        label: specs[index].label,
        notes: chosen[index].slice()
      };
    });
  }

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  return {
    DEGREES: DEGREES,
    chordSpec: chordSpec,
    voicingCandidates: voicingCandidates,
    voiceChord: voiceChord,
    voiceRing: voiceRing,
    midiToHz: midiToHz
  };
}));
