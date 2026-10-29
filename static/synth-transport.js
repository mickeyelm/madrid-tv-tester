/* CH 14 SYNTH VISIONS transport — pure timing math, no Web Audio, no DOM.
 *
 * Everything the audio engine must decide about WHEN lives here so it can be
 * proven under simulated polling jitter: epoch<->beat conversion, integer
 * scheduling windows without duplicates, event matching, deterministic pulse
 * tiers, the shared audio/visual dropout schedule, late-event accounting,
 * and the polyphony voice ledger. tv-synth.js only executes what this module
 * decides. Dual export: browser global + module.exports. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SynthTransport = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BPM = 63;
  var TOTAL_BEATS = 32;

  /* Tempo objects come from server state: {bpm, anchor_epoch, anchor_beat}.
   * Omitting one falls back to the historical fixed-63 line, so every old
   * call site and saved vision replays identically. */
  function absoluteBeat(epochSeconds, tempo) {
    if (!tempo || !tempo.bpm) { return epochSeconds * BPM / 60; }
    if (tempo.paused) { return tempo.anchor_beat; }
    return tempo.anchor_beat +
      (epochSeconds - tempo.anchor_epoch) * tempo.bpm / 60;
  }

  function beatSeconds(tempo) {
    return 60 / (tempo && tempo.bpm ? tempo.bpm : BPM);
  }

  function loopBeat(beat) {
    return ((beat % TOTAL_BEATS) + TOTAL_BEATS) % TOTAL_BEATS;
  }

  function isSeam(beat) {
    return loopBeat(beat) === 0;
  }

  /* Deterministic 0..1 hash — random-looking variation with memory, never
   * Math.random(). Shared by pulse ghosts and the dropout schedule so sound
   * and image agree about the same damaged moments. */
  function hash(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /* Integer-beat scheduling windows. advance() returns every not-yet-emitted
   * integer beat up to now+lookahead — consecutive, no duplicates, never the
   * past. The engine calls this from its tick and schedules exactly what it
   * receives. */
  function createScheduler() {
    var last = null;
    return {
      advance: function (nowBeat, lookaheadBeats) {
        var horizon = nowBeat + lookaheadBeats;
        if (last === null) { last = Math.ceil(nowBeat) - 1; }
        var out = [];
        while (last + 1 <= horizon) {
          last += 1;
          out.push(last);
        }
        return out;
      },
      lastScheduled: function () {
        return last === null ? -Infinity : last;
      }
    };
  }

  function eventsAtBeat(events, beat) {
    var slot = loopBeat(beat);
    var matched = [];
    for (var i = 0; i < (events ? events.length : 0); i += 1) {
      var kind = events[i].kind || "chord";
      if (kind === "chord" && events[i].beat === slot) {
        matched.push(events[i]);
      }
    }
    return matched;
  }

  /* Layered note/drum events carry float beats on a quarter-beat grid.
   * For an integer scheduling beat, return each layered event that falls
   * inside [beat, beat+1) with its fractional offset in beats. */
  function layeredAtBeat(events, beat) {
    var slot = loopBeat(beat);
    var matched = [];
    for (var i = 0; i < (events ? events.length : 0); i += 1) {
      var kind = events[i].kind || "chord";
      if (kind !== "note" && kind !== "drum") { continue; }
      var offset = events[i].beat - slot;
      if (offset >= 0 && offset < 1) {
        matched.push({ event: events[i], offset: offset });
      }
    }
    return matched;
  }

  /* Deterministic Omnichord-style rhythm unit. For an integer beat, return
   * kit hits inside [beat, beat+1): {lane, gain, offset}. PULSE accents the
   * backbeats and (high tiers) adds deterministic ghost hats — the old lone
   * thump's articulation job, now applied to a real kit. */
  function rhythmHits(preset, beat, pulse) {
    if (!preset || preset === "off") { return []; }
    var slot = loopBeat(beat);
    var inBar = slot % 4;
    var accent = 0.62 + 0.38 * Math.min(1, Math.max(0, pulse || 0));
    var hits = [];
    function hit(lane, gain, offset) {
      hits.push({ lane: lane, gain: gain * accent, offset: offset || 0 });
    }
    if (preset === "train") {
      hit("kick", inBar === 0 ? 1 : 0.8, 0);
      hit("hat", 0.55, 0);
      hit("hat", 0.4, 0.5);
      if (inBar === 1 || inBar === 3) { hit("snare", 0.85, 0); }
      if ((pulse || 0) >= 0.7 && hash(slot * 3.1) > 0.45) {
        hit("hat", 0.22, 0.75);
      }
    } else if (preset === "waltz") {
      // 3-beat cycle over the 32-beat ring: OOM pah pah.
      var three = slot % 3;
      if (three === 0) { hit("kick", 1, 0); }
      else { hit("hat", 0.5, 0); hit("snare", three === 2 ? 0.3 : 0.22, 0.5); }
    } else if (preset === "bossa") {
      if (inBar === 0) { hit("kick", 0.95, 0); hit("kick", 0.6, 0.75); }
      if (inBar === 2) { hit("kick", 0.85, 0); }
      hit("hat", 0.4, 0); hit("hat", 0.34, 0.5);
      if (hash(slot * 1.9 + 2) > 0.55 && (inBar === 1 || inBar === 3)) {
        hit("snare", 0.3, 0.5);
      }
    } else if (preset === "rock") {
      if (inBar === 0 || inBar === 2) { hit("kick", 1, 0); }
      if (inBar === 2) { hit("kick", 0.7, 0.5); }
      if (inBar === 1 || inBar === 3) { hit("snare", 0.95, 0); }
      hit("hat", 0.5, 0); hit("hat", 0.4, 0.5);
      if ((pulse || 0) >= 0.7) { hit("hat", 0.2, 0.25); hit("hat", 0.2, 0.75); }
    }
    return hits;
  }

  /* Live strum plucks: transient entries {id, at (absolute float beat)}.
   * Return the not-yet-played entries due inside the lookahead window; the
   * engine tracks seen ids so a pluck fires exactly once. */
  function dueLive(live, seen, nowBeat, lookaheadBeats, nowEpoch) {
    var due = [];
    for (var i = 0; i < (live ? live.length : 0); i += 1) {
      var item = live[i];
      if (seen[item.id]) { continue; }
      if (typeof item.at_epoch === "number" && typeof nowEpoch === "number") {
        if (item.at_epoch <= nowEpoch + .18 && item.at_epoch >= nowEpoch - .2) due.push(item);
        continue;
      }
      if (item.at <= nowBeat + lookaheadBeats && item.at > nowBeat - 0.5) {
        due.push(item);
      }
    }
    return due;
  }

  /* Deterministic pulse patterns by PULSE tier (spec section 6):
   * 0 none; low = seam + bar downbeats; middle adds beats 1 and 3 of the
   * bar; high adds quiet deterministic ghost subdivisions. */
  var PULSE_LOW = 0.02;
  var PULSE_MID = 0.35;
  var PULSE_HIGH = 0.7;

  function pulseHits(pulse, beat) {
    if (!pulse || pulse < PULSE_LOW) { return []; }
    var slot = loopBeat(beat);
    var inBar = slot % 4;
    var hits = [];
    if (slot === 0) {
      hits.push({ type: "seam", gain: Math.min(1, 0.4 + 0.5 * pulse) });
    } else if (inBar === 0) {
      hits.push({ type: "down", gain: Math.min(1, 0.3 + 0.5 * pulse) });
    }
    if (pulse >= PULSE_MID && inBar === 2) {
      hits.push({ type: "beat", gain: Math.min(1, 0.25 + 0.45 * pulse) });
    }
    if (pulse >= PULSE_HIGH && (inBar === 1 || inBar === 3)) {
      var roll = hash(slot);
      if (roll > 0.35) {
        hits.push({ type: "ghost", gain: 0.06 + 0.1 * pulse * roll });
      }
    }
    return hits;
  }

  /* Shared deterministic dropout schedule. Healthy signal never drops; the
   * probability and shape of each hole are pure functions of the absolute
   * beat, so the audio gate and the picture blank the same moments on every
   * replay of the same loop position. */
  var DROPOUT_SIGNAL_FLOOR = 0.6;

  function dropoutAt(beat, signal) {
    if (typeof signal !== "number" || signal >= DROPOUT_SIGNAL_FLOOR) {
      return null;
    }
    var probability = (DROPOUT_SIGNAL_FLOOR - signal) * 1.2;
    if (hash(beat * 1.7 + 5) >= probability) { return null; }
    return {
      offset: hash(beat + 13),
      duration: 0.05 + 0.3 * hash(beat + 29)
    };
  }

  function isLate(event, scheduler) {
    var target = event.born * TOTAL_BEATS + event.beat;
    return target <= scheduler.lastScheduled();
  }

  /* Polyphony ledger: the engine may never run more than `max` chord
   * envelopes. Allocating past the ceiling names the oldest voices to steal;
   * the engine must stop them before starting the new one. */
  function createVoiceLedger(max) {
    var active = [];
    return {
      allocate: function (id) {
        var steal = [];
        while (active.length >= max) {
          steal.push(active.shift().id);
        }
        active.push({ id: id });
        return { steal: steal };
      },
      release: function (id) {
        for (var i = active.length - 1; i >= 0; i -= 1) {
          if (active[i].id === id) { active.splice(i, 1); }
        }
      },
      activeCount: function () {
        return active.length;
      }
    };
  }

  return {
    BPM: BPM,
    TOTAL_BEATS: TOTAL_BEATS,
    absoluteBeat: absoluteBeat,
    beatSeconds: beatSeconds,
    loopBeat: loopBeat,
    isSeam: isSeam,
    hash: hash,
    createScheduler: createScheduler,
    eventsAtBeat: eventsAtBeat,
    layeredAtBeat: layeredAtBeat,
    rhythmHits: rhythmHits,
    dueLive: dueLive,
    pulseHits: pulseHits,
    dropoutAt: dropoutAt,
    isLate: isLate,
    createVoiceLedger: createVoiceLedger
  };
}));
