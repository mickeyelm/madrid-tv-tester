/* CH 14 SYNTH VISIONS — bounded Web Audio engine + persistent Signal Loom. */
(function () {
  "use strict";

  var T = window.SynthTransport;
  var Voice = window.SynthVoicing;
  var Visual = window.SynthVisualModel;
  var Patches = window.SynthPatches;
  var canvas = document.getElementById("synth-program");
  var context2d = canvas ? canvas.getContext("2d") : null;
  var unlockButton = null;
  if(canvas) {
    unlockButton=document.createElement('button');
    unlockButton.id='synth-enable-sound';unlockButton.textContent='ENABLE ROOM SOUND';unlockButton.hidden=true;
    unlockButton.style.cssText='position:absolute;z-index:10;left:50%;top:45%;transform:translate(-50%,-50%);padding:20px 30px;background:#e96338;color:#171e17;border:3px solid #f2f0df;border-radius:4px;font:700 20px monospace;cursor:pointer;pointer-events:auto';
    canvas.parentElement.appendChild(unlockButton);
    unlockButton.addEventListener('click',function(){var engine=ensureAudio();if(engine)engine.ctx.resume().then(function(){unlockButton.hidden=engine.ctx.state==='running';}).catch(function(){unlockButton.textContent='TRY ENABLING ROOM SOUND AGAIN';});});
  }
  var feedbackA = document.createElement("canvas");
  var feedbackB = document.createElement("canvas");
  feedbackA.width = feedbackB.width = 240;
  feedbackA.height = feedbackB.height = 180;
  var front = feedbackA;
  var back = feedbackB;
  var active = false;
  var recallPlaying = false;
  var seenEventIds = {};
  var state = { bpm: 63, beats: 32, pulse: 0, signal: 1, body: 0.2,
    events: [], live: [], instrument: "tape", rhythm: "off", tempo: null };
  var seenLiveIds = {};
  var noiseBuffer = null;
  var roomWatch = window.MadridStationAPI ? null : window.SynthWorkshop ? window.SynthWorkshop.createRoomWatch({
    enabled: function(){return active;},
    rev: function(){return state.rev;},
    receive: function(incoming){if(incoming.channel==='synth')updateState(incoming.synth);else setActive(false,incoming.synth);}
  }) : null;
  var pocketScene = null;
  var sampler = null;
  var midiBridge = window.PocketMIDITV ? new window.PocketMIDITV() : null;
  var heldVoices = {}, seenMidiTokens = new Set(), sourceAuthor = null;
  function releaseHeld(token) {
    var item=heldVoices[token];if(!item)return;delete heldVoices[token];if(item.oneshot)return;
    var now=audio.ctx.currentTime;item.gain.gain.cancelScheduledValues(now);item.gain.gain.setTargetAtTime(.0001,now,.012);
    item.oscillators.forEach(function(source){try{source.stop(now+.08);}catch(e){}});
  }
  function soundEnabled(origin) {
    var midi=(state.pocket||{}).midi||{};
    return !(midi.enabled && (midi.mode==='hardware' || (origin && midi.mode==='visual')));
  }
  var playingSources = [];
  var visualHits = [];
  var lastChord = null;
  function trackSource(source, gain) {
    playingSources.push({ source: source, gain: gain, author: sourceAuthor });
    source.onended = function () { source.disconnect(); playingSources = playingSources.filter(function (x) { return x.source !== source; }); };
    while (playingSources.length > 96) { var old = playingSources.shift(); try { old.source.stop(); } catch (e) {} }
  }
  function panic() {
    if (audio) {
      var t = audio.ctx.currentTime; audio.master.gain.cancelScheduledValues(t);
      audio.master.gain.setTargetAtTime(.0001, t, .003);
      audio.master.gain.setTargetAtTime(recallPlaying || !active ? .0001 : .72, t+.018, .008);
    }
    playingSources.splice(0).forEach(function (x) { try { x.source.stop(audio ? audio.ctx.currentTime+.015 : 0); } catch (e) {} });
    Object.keys(envelopes).forEach(function (id) { stealEnvelope(id, audio ? audio.ctx.currentTime : 0); });
    heldVoices={}; bassSources={}; seenMidiTokens.clear(); if(midiBridge)midiBridge.panic();
    scheduler = T.createScheduler(); visualHits = [];
  }
  function effectOn(name) {
    return Object.values((state.pocket || {}).fx || {}).some(function (x) { return x.effect === name && x.until > Date.now()/1000; });
  }
  function visualHit(note, velocity, when, chord) {
    visualHits.push({note: note, velocity: velocity, at: when, chord: chord});
    visualHits = visualHits.slice(-96);
  }
  var bassSources = {};
  var scheduler = T.createScheduler();
  var timer = null;
  var frameId = null;
  var audio = null;
  var voiceLedger = T.createVoiceLedger(4);
  var envelopes = {};
  var lastEventKey = "";
  var voicedById = {};
  var expression = neutralExpression();
  var lastVisualAt = 0;
  var stats = {
    lateEvents: 0,
    activeOscillators: 0,
    activeEnvelopes: 0,
    visualFrameMs: 0,
    visualFrames: 0,
    audioMode: "clean",
    currentBeat: 0,
    scheduledBeats: 0
  };

  function neutralExpression() {
    return { available: false, confidence: 0, lean: 0, lift: 0, span: 0,
      depth: 0, energy: 0, calibrated: false };
  }

  function xhrJSON(path, done) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", path + "?t=" + Date.now(), true);
    xhr.timeout = 1000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status === 200) {
        try { done(JSON.parse(xhr.responseText)); } catch (ignore) { done(null); }
      } else { done(null); }
    };
    xhr.onerror = function () { done(null); };
    xhr.ontimeout = function () { done(null); };
    xhr.send();
  }

  function makeImpulse(ctx) {
    var length = Math.floor(ctx.sampleRate * 1.8);
    var buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (var channel = 0; channel < 2; channel += 1) {
      var data = buffer.getChannelData(channel);
      for (var i = 0; i < length; i += 1) {
        var seed = T.hash(i * 1.37 + channel * 97);
        data[i] = (seed * 2 - 1) * Math.pow(1 - i / length, 2.4) * 0.34;
      }
    }
    return buffer;
  }

  function ensureAudio() {
    if (audio) { return audio; }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { return null; }
    var ctx;
    try { ctx = new Ctx({ latencyHint: "interactive" }); }
    catch (error) { ctx = new Ctx(); }
    var input = ctx.createGain();
    var color = ctx.createBiquadFilter();
    var rumble = ctx.createBiquadFilter();
    var preDelay = ctx.createDelay(0.1);
    var reverbColor = ctx.createBiquadFilter();
    var gate = ctx.createGain();
    var dry = ctx.createGain();
    var reverb = ctx.createConvolver();
    var wet = ctx.createGain();
    var mix = ctx.createGain();
    var compressor = ctx.createDynamicsCompressor();
    var limiter = ctx.createDynamicsCompressor();
    var master = ctx.createGain();
    var recorder = ctx.createMediaStreamDestination();
    color.type = "lowpass";
    color.frequency.value = 7200;
    color.Q.value = 0.35;
    rumble.type = "highpass"; rumble.frequency.value = 28; rumble.Q.value = 0.5;
    preDelay.delayTime.value = 0.023;
    reverbColor.type = "lowpass"; reverbColor.frequency.value = 4800;
    reverb.buffer = makeImpulse(ctx);
    dry.gain.value = 0.9;
    wet.gain.value = 0.1;
    gate.gain.value = 1;
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 2.8;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.18;
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    master.gain.value = 0.0001;
    input.connect(rumble);
    rumble.connect(color);
    color.connect(gate);
    gate.connect(dry);
    gate.connect(preDelay);
    preDelay.connect(reverb);
    reverb.connect(reverbColor);
    reverbColor.connect(wet);
    dry.connect(mix);
    wet.connect(mix);
    mix.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(master);
    master.connect(ctx.destination);
    master.connect(recorder);
    audio = { ctx: ctx, input: input, color: color, gate: gate, wet: wet,
      compressor: compressor, limiter: limiter, master: master,
      recorder: recorder };
    if(window.PocketSampler)sampler=new window.PocketSampler(ctx,trackSource);
    return audio;
  }

  function voicesForEvents() {
    var events = (state.events || []).filter(function (event) {
      return (event.kind || "chord") === "chord";
    }).sort(function (a, b) {
      return a.beat - b.beat || a.id - b.id;
    });
    var signature = JSON.stringify(events.map(function (event) {
      return [event.id, event.degree, event.quality, event.beat, event.born];
    }));
    if (signature === lastEventKey) { return events; }
    lastEventKey = signature;
    voicedById = {};
    if (!events.length) { return events; }
    var voiced = Voice.voiceRing(events);
    for (var i = 0; i < events.length; i += 1) {
      var notes = voiced[i] && voiced[i].notes ? voiced[i].notes : voiced[i];
      voicedById[events[i].id] = notes;
    }
    return events;
  }

  function finishEnvelope(id) {
    var item = envelopes[id];
    if (!item) { return; }
    item.oscillators.forEach(function (oscillator) {
      try { oscillator.stop(); } catch (ignore) {}
    });
    stats.activeOscillators -= item.oscillators.length;
    stats.activeOscillators = Math.max(0, stats.activeOscillators);
    delete envelopes[id];
    voiceLedger.release(id);
    stats.activeEnvelopes = Object.keys(envelopes).length;
  }

  function stealEnvelope(id, at) {
    var item = envelopes[id];
    if (!item) { return; }
    try {
      item.gain.gain.cancelScheduledValues(at);
      item.gain.gain.setTargetAtTime(0.0001, at, 0.018);
    } catch (ignore) {}
    window.setTimeout(function () { finishEnvelope(id); }, 90);
  }

  function ensureNoise(ctx) {
    if (noiseBuffer) { return noiseBuffer; }
    var length = Math.floor(ctx.sampleRate * 0.5);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < length; i += 1) {
      data[i] = T.hash(i * 0.731) * 2 - 1;
    }
    return noiseBuffer;
  }

  /* Build one patch-recipe oscillator stack into `destination`, starting at
   * `when`, stopping at `stopAt`. Returns the oscillators for the ledger. */
  function buildStack(engine, recipe, note, when, stopAt, destination, extraDetune, velocity) {
    var oscillators = [];
    var monoKey = (sourceAuthor || "room") + ":" + recipe.label;
    var previous = recipe.mono ? bassSources[monoKey] : null;
    if (previous) {
      previous.gain.gain.cancelScheduledValues(when);
      previous.gain.gain.setTargetAtTime(0.0001, when, 0.004);
      previous.sources.forEach(function (source) { try { source.stop(when + 0.025); } catch (ignore) {} });
    }
    note += effectOn("lift") ? 12 : effectOn("sub") ? -12 : 0;
    var output = destination;
    if (recipe.formants) {
      output = engine.ctx.createGain();
      recipe.formants.forEach(function (hz, index) {
        var formant = engine.ctx.createBiquadFilter();
        formant.type = "bandpass";
        formant.frequency.setValueAtTime(hz * 0.92, when);
        formant.frequency.exponentialRampToValueAtTime(hz, when + 0.3);
        formant.Q.value = 4 + index * 2;
        var level = engine.ctx.createGain();
        level.gain.value = [2.4, 1.5, 0.7][index];
        output.connect(formant); formant.connect(level); level.connect(destination);
      });
    }
    var hz = Voice.midiToHz(note + (recipe.octaveShift || 0) * 12);
    var dynamics = Math.max(0.05, Math.min(1, velocity == null ? 0.8 : velocity));
    var modulator = null, drift = null;
    if (recipe.fm) {
      modulator = engine.ctx.createOscillator();
      modulator.frequency.setValueAtTime(hz * recipe.fm.ratio, when);
      trackSource(modulator, destination);
      modulator.start(when); modulator.stop(stopAt);
      oscillators.push(modulator);
    }
    if (recipe.drift) {
      drift = engine.ctx.createOscillator();
      drift.frequency.setValueAtTime(recipe.drift.rate, when);
      trackSource(drift, destination);
      drift.start(when); drift.stop(stopAt);
      oscillators.push(drift);
    }
    recipe.oscillators.forEach(function (spec, index) {
      var oscillator = engine.ctx.createOscillator();
      var level = engine.ctx.createGain();
      oscillator.type = spec.type;
      var target = Math.max(20, hz * Math.pow(2, spec.octave));
      if (recipe.glide && previous && previous.until > when) {
        oscillator.frequency.setValueAtTime(Math.max(20, previous.hz * Math.pow(2, spec.octave)), when);
        oscillator.frequency.exponentialRampToValueAtTime(target, when + recipe.glide);
      } else {
        oscillator.frequency.setValueAtTime(target, when);
      }
      oscillator.detune.setValueAtTime(spec.detune + (extraDetune || 0), when);
      level.gain.setValueAtTime(spec.level, when);
      if (spec.decay) level.gain.exponentialRampToValueAtTime(0.0001, when + spec.decay);
      oscillator.connect(level);
      if (spec.pan && engine.ctx.createStereoPanner) {
        var pan = engine.ctx.createStereoPanner(); pan.pan.value = spec.pan;
        level.connect(pan); pan.connect(output);
      } else { level.connect(output); }
      if (modulator && index === 0) {
        var wire = engine.ctx.createGain();
        wire.gain.setValueAtTime(hz * recipe.fm.index * (0.15 + 0.85 * dynamics * dynamics), when);
        wire.gain.exponentialRampToValueAtTime(hz * 0.008, when + recipe.fm.indexDecay);
        modulator.connect(wire); wire.connect(oscillator.frequency);
      }
      if (drift) {
        var wobble = engine.ctx.createGain();
        wobble.gain.setValueAtTime(recipe.drift.cents * (index % 2 ? -1 : 1), when);
        drift.connect(wobble); wobble.connect(oscillator.detune);
      }
      trackSource(oscillator, destination);
      oscillator.start(when); oscillator.stop(stopAt);
      oscillators.push(oscillator);
    });
    if (recipe.mono) {
      bassSources[monoKey] = { sources: oscillators, gain: destination, hz: hz, until: stopAt };
      // Old imported authors do not accumulate for the lifetime of the station.
      Object.keys(bassSources).slice(0, -32).forEach(function (key) { delete bassSources[key]; });
    }
    return oscillators;
  }

  function colorVoice(filter, recipe, note, velocity, when) {
    var cutoff = Patches.filterHz(recipe, note) * (0.55 + velocity * 0.65);
    var ceiling = Math.min(14000, filter.context.sampleRate * 0.45);
    filter.type = "lowpass";
    filter.Q.setValueAtTime(recipe.filter.q || 0.5, when);
    filter.frequency.setValueAtTime(Math.min(ceiling, cutoff), when);
    if (recipe.filter.envelope) {
      filter.frequency.exponentialRampToValueAtTime(Math.min(ceiling,
        cutoff * (1 + recipe.filter.envelope * velocity)), when + 0.009);
      filter.frequency.exponentialRampToValueAtTime(Math.max(110, cutoff * 0.65),
        when + recipe.filter.decay);
    } else if (recipe.filter.bloom) {
      filter.frequency.exponentialRampToValueAtTime(Math.min(ceiling,
        cutoff * (1 + recipe.filter.bloom)), when + recipe.envelope.attack * 1.8);
      filter.frequency.exponentialRampToValueAtTime(Math.min(ceiling, cutoff),
        when + recipe.envelope.attack * 1.8 + recipe.envelope.decay);
    }
  }

  function applyEnvelope(gainNode, points, when) {
    points.forEach(function (point, index) {
      var level = Math.max(0.0001, point.level);
      if (index === 0) { gainNode.gain.setValueAtTime(level, when + point.at); }
      else { gainNode.gain.exponentialRampToValueAtTime(level, when + point.at); }
    });
  }

  function scheduleChord(event, absoluteBeat, when) {
    var engine = ensureAudio();
    if (!engine) { return; }
    var id = "event-" + event.id + "-" + absoluteBeat;
    sourceAuthor = event.author || null;
    var recipe = Patches.patch(event.instrument || "tape");
    var spec = Voice.chordSpec(event.degree, event.quality);
    var notes = (event.at === undefined ? voicedById[event.id] : null) || Voice.voiceChord(spec);
    var shift = state.tonality ? (state.tonality.root + (state.tonality.scale === "minor" ? 3 : 0)) % 12 : 0;
    notes = recipe.mono ? [48 + spec.rootPc + shift] : notes.map(function (n) { return n + shift; });
    var velocity = Math.max(0.05, Math.min(1, event.velocity == null ? 0.78 : event.velocity));
    visualHit(notes[0], velocity, when, event);
    var duration = event.duration ? event.duration * T.beatSeconds(state.tempo) : Patches.noteSeconds(recipe, T.beatSeconds(state.tempo));
    if (midiBridge) midiBridge.notes(notes.slice(0, 4), velocity, Date.now()/1000 + when - engine.ctx.currentTime, duration, event.midi_channel || 0, !!event.midi_origin);
    if (!soundEnabled(event.midi_origin)) return;
    if (sampler && event.instrument && event.instrument.indexOf('sample-') === 0) {
      notes.slice(0, 4).forEach(function (note, i) { sampler.play(event.instrument, note, event.sample_slot, velocity / 2, when + i * .004, duration, engine.input); });
      return;
    }
    var allocation = voiceLedger.allocate(id);
    allocation.steal.forEach(function (oldId) { stealEnvelope(oldId, engine.ctx.currentTime); });
    var gain = engine.ctx.createGain();
    var filter = engine.ctx.createBiquadFilter();
    colorVoice(filter, recipe, notes[0], velocity, when);
    var points = Patches.envelopePoints(recipe, velocity / Math.sqrt(notes.length), duration);
    applyEnvelope(gain, points, when);
    var tail = points[points.length - 1].at;
    gain.connect(filter); filter.connect(engine.input);
    var oscillators = [];
    notes.slice(0, 4).forEach(function (note, voiceIndex) {
      oscillators = oscillators.concat(buildStack(engine, recipe, note,
        when + voiceIndex * 0.004, when + tail + 0.05, gain, 0, velocity));
    });
    envelopes[id] = { gain: gain, oscillators: oscillators };
    stats.activeOscillators += oscillators.length;
    stats.activeEnvelopes = Object.keys(envelopes).length;
    window.setTimeout(function () { finishEnvelope(id); },
      Math.ceil((tail + Math.max(0, when - engine.ctx.currentTime) + 0.1) * 1000));
  }

  /* Single notes terminate themselves; held notes retain the existing
   * note-off token and are also caught by the shared source limit/panic. */
  function scheduleNote(instrument, note, velocity, when, extraGain, event) {
    event = event || {}; sourceAuthor = event.author || null;
    var engine = ensureAudio();
    if (!engine) { return; }
    var recipe = Patches.patch(instrument);
    velocity = Math.max(0.05, Math.min(1, velocity == null ? 0.8 : velocity));
    visualHit(note, velocity, when);
    var isHeld = !!event.midi_key && !event.midi_done;
    var noteDuration = event.duration_seconds || (event.duration ? event.duration * T.beatSeconds(state.tempo) : Patches.noteSeconds(recipe, T.beatSeconds(state.tempo)) * .6);
    if (midiBridge) midiBridge.notes([note], velocity, Date.now()/1000 + when - engine.ctx.currentTime, noteDuration, event.midi_channel || 0, !!event.midi_origin);
    if (event.midi_key) seenMidiTokens.add(event.midi_key);
    if (!soundEnabled(event.midi_origin)) return;
    if (sampler && instrument && instrument.indexOf('sample-') === 0) {
      var voice = sampler.play(instrument, note, event.sample_slot, velocity, when, noteDuration, engine.input, isHeld);
      if (isHeld && voice) heldVoices[event.midi_key] = voice;
      return;
    }
    var gain = engine.ctx.createGain();
    var filter = engine.ctx.createBiquadFilter();
    colorVoice(filter, recipe, note, velocity, when);
    var duration = isHeld ? 3600 : noteDuration;
    if (isHeld) recipe = Object.assign({}, recipe, { envelope: Object.assign({}, recipe.envelope, { sustain: Math.max(.25, recipe.envelope.sustain) }) });
    var points = Patches.envelopePoints(recipe, velocity * (extraGain || 1), duration);
    applyEnvelope(gain, points, when);
    var tail = points[points.length - 1].at;
    gain.connect(filter); filter.connect(engine.input);
    var oscillators = buildStack(engine, recipe, note, when, when + tail + 0.05, gain, 0, velocity);
    if (isHeld) heldVoices[event.midi_key] = { gain: gain, oscillators: oscillators };
    stats.activeOscillators += oscillators.length;
    // A note-off/panic can happen long before a held envelope's safety end.
    var remaining = oscillators.length;
    oscillators.forEach(function (source) {
      var ended = source.onended;
      source.onended = function () {
        if (ended) ended();
        stats.activeOscillators = Math.max(0, stats.activeOscillators - 1);
        remaining -= 1;
        if (!remaining && event.midi_key && heldVoices[event.midi_key] && heldVoices[event.midi_key].gain === gain) delete heldVoices[event.midi_key];
      };
    });
  }

  function scheduleDrum(lane, gainValue, when, event) {
    event = event || {}; sourceAuthor = event.author || null;
    var engine = ensureAudio();
    if (!engine) { return; }
    var recipe = Patches.drum(lane);
    if (!recipe) { return; }
    var velocity = Math.max(0.05, Math.min(1, gainValue == null ? 0.8 : gainValue));
    visualHit(["kick", "snare", "hat", "clap"].indexOf(lane), velocity, when);
    if (midiBridge) midiBridge.notes([{kick:36, snare:38, hat:42, clap:39}[lane]], velocity, Date.now()/1000 + when - engine.ctx.currentTime, .12, event.midi_channel == null ? 9 : event.midi_channel, !!event.midi_origin);
    if (!soundEnabled(event.midi_origin)) return;
    var level = recipe.gain * Math.pow(velocity, 1.25);
    var release = recipe.envelope.release * (0.75 + 0.25 * velocity);
    function tone(hz, amount, decay, endHz, type) {
      var osc = engine.ctx.createOscillator(), amp = engine.ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(hz, when);
      if (endHz) osc.frequency.exponentialRampToValueAtTime(endHz, when + recipe.sweep);
      amp.gain.setValueAtTime(0.0001, when);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * amount), when + 0.002);
      amp.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      osc.connect(amp); amp.connect(engine.input);
      trackSource(osc, amp); osc.start(when); osc.stop(when + decay + 0.02);
    }
    if (recipe.voice === "sweep") tone(recipe.startHz, 1, release, recipe.endHz);
    if (recipe.voice === "noise-tone") {
      tone(recipe.toneHz, 0.6, release * 0.7);
      tone(recipe.toneHz * 1.63, 0.22, release * 0.4);
    }
    (recipe.bursts || [0]).forEach(function (burstOffset, index, bursts) {
      var at = when + burstOffset;
      var tail = index < bursts.length - 1 ? 0.011 : release;
      var amp = engine.ctx.createGain();
      var noiseLevel = level * (recipe.click || 1) * (index < bursts.length - 1 ? 0.7 : 1);
      if (recipe.click) tail = 0.016;
      amp.gain.setValueAtTime(0.0001, at);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, noiseLevel), at + 0.001);
      amp.gain.exponentialRampToValueAtTime(0.0001, at + tail);
      amp.connect(engine.input);
      var color = engine.ctx.createBiquadFilter();
      color.type = lane === "hat" || lane === "kick" ? "highpass" : "bandpass";
      color.frequency.setValueAtTime((recipe.noiseHz || 3200) * (0.85 + 0.15 * velocity), at);
      color.Q.value = lane === "clap" ? 0.65 : 0.8;
      var source = engine.ctx.createBufferSource();
      source.buffer = ensureNoise(engine.ctx); source.loop = true;
      source.connect(color); color.connect(amp);
      trackSource(source, amp);
      source.start(at, T.hash(at * 173 + index) * 0.4);
      source.stop(at + tail + 0.02);
      if (recipe.metallic) {
        [421, 673, 997].forEach(function (hz) {
          var metal = engine.ctx.createOscillator(), metalLevel = engine.ctx.createGain();
          metal.type = "square"; metal.frequency.value = hz;
          metalLevel.gain.value = 0.08;
          metal.connect(metalLevel); metalLevel.connect(color);
          trackSource(metal, amp); metal.start(at); metal.stop(at + tail + 0.02);
        });
      }
    });
  }

  function schedulePulse(hit, when) {
    var engine = ensureAudio();
    if (!engine) { return; }
    var osc = engine.ctx.createOscillator();
    var gain = engine.ctx.createGain();
    osc.type = hit.type === "ghost" ? "sine" : "triangle";
    osc.frequency.setValueAtTime(hit.type === "seam" ? 43 : 54, when);
    osc.frequency.exponentialRampToValueAtTime(28, when + 0.13);
    gain.gain.setValueAtTime(Math.max(0.0001, hit.gain * 0.09), when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    osc.connect(gain);
    gain.connect(engine.input);
    trackSource(osc, gain);
    osc.start(when);
    osc.stop(when + 0.2);
  }

  function beatToEpoch(beat) {
    var tempo = state.tempo;
    if (!tempo || !tempo.bpm) { return beat / T.BPM * 60; }
    return tempo.anchor_epoch + (beat - tempo.anchor_beat) * 60 / tempo.bpm;
  }

  function scheduleBeat(beat, nowEpoch) {
    var engine = ensureAudio();
    if (!engine) { return; }
    var beatLen = T.beatSeconds(state.tempo);
    var when = engine.ctx.currentTime + Math.max(0, beatToEpoch(beat) - nowEpoch);
    T.eventsAtBeat(state.events || [], beat).forEach(function (event) {
      var target = event.born * 32 + event.beat;
      if (target > beat) { return; }
      scheduleChord(window.SynthWorkshop ? window.SynthWorkshop.vary(event, beat, state.wander) : event, beat, when);
    });
    T.layeredAtBeat(state.events || [], beat).forEach(function (found) {
      var event = window.SynthWorkshop ? window.SynthWorkshop.vary(found.event, beat, state.wander) : found.event;
      var target = event.born * 32 + Math.floor(event.beat);
      if (target > beat) { return; }
      var at = when + found.offset * beatLen;
      if (event.kind === "drum") {
        scheduleDrum(event.lane, event.velocity, at, event);
        if(event.ratchet) scheduleDrum(event.lane, event.velocity*.55, at+beatLen*.125, event);
      } else {
        scheduleNote(event.instrument, event.note, event.velocity, at, 1, event);
      }
    });
    T.rhythmHits(state.rhythm, beat, Number(state.pulse || 0)).forEach(function (hit) {
      scheduleDrum(hit.lane, hit.gain, when + hit.offset * beatLen);
    });
    if (state.rhythm === "off" || !state.rhythm) {
      T.pulseHits(Number(state.pulse || 0), beat).forEach(function (hit) {
        schedulePulse(hit, when);
      });
    }
    // SIGNAL damage is visual-only in the room instrument. The original audio
    // gate intentionally punched holes into the mix; on the station Mac those sounded
    // indistinguishable from underruns and made a healthy synth feel broken.
    stats.scheduledBeats += 1;
  }

  function scheduleLive(nowBeat, nowEpoch) {
    var engine = ensureAudio();
    if (!engine) { return; }
    T.dueLive(state.live || [], seenLiveIds, nowBeat, 2, nowEpoch).forEach(function (item) {
      seenLiveIds[item.id] = true;
      if(item.at_epoch != null ? nowEpoch > item.at_epoch + .2 : item.expires && nowBeat > item.expires) return;
      if(item.created_at) stats.inputToScheduleMs = Math.round((nowEpoch-item.created_at)*1000);
      var when = engine.ctx.currentTime + Math.max(0, (item.at_epoch == null ? beatToEpoch(item.at) : item.at_epoch) - nowEpoch);
      if (item.kind === "chord") { scheduleChord(item, item.at, when); }
      else if (item.lane) { scheduleDrum(item.lane, item.velocity, when, item); }
      else { scheduleNote(item.instrument, item.note, item.velocity, when, 1.15, item); }
    });
  }

  function audioTick() {
    if (!active) { return; }
    var engine = ensureAudio();
    if(unlockButton)unlockButton.hidden=!engine||engine.ctx.state==='running';
    voicesForEvents();
    var nowEpoch = Date.now() / 1000;
    var nowBeat = T.absoluteBeat(nowEpoch, state.tempo);
    stats.currentBeat = T.loopBeat(nowBeat);
    var lookahead = 0.180 * (state.tempo && state.tempo.bpm ? state.tempo.bpm : T.BPM) / 60;
    if (!(state.tempo || {}).paused) scheduler.advance(nowBeat, lookahead).forEach(function (beat) {
      scheduleBeat(beat, nowEpoch);
    });
    scheduleLive(nowBeat, nowEpoch);
    if(midiBridge){midiBridge.tick(state,nowEpoch);midiBridge.report(sampler);}
    var held=(((state.pocket||{}).midi||{}).held||[]).concat((state.pocket||{}).held||[]), tokens=new Set(held.map(function(n){return n.key;}));
    Object.keys(heldVoices).forEach(function(token){if(!tokens.has(token))releaseHeld(token);});
    seenMidiTokens.forEach(function(token){if(token.indexOf('hold:')===0&&!tokens.has(token))seenMidiTokens.delete(token);});
    if(engine)held.forEach(function(n){if(!seenMidiTokens.has(n.key))scheduleNote(n.instrument,n.note,n.velocity||.75,engine.ctx.currentTime,1,{midi_key:n.key,midi_origin:n.key.indexOf("hold:")!==0,author:n.author,sample_slot:n.sample_slot});});
    if(seenMidiTokens.size>256)seenMidiTokens=new Set([...seenMidiTokens].slice(-128));
    if (engine) {
      var now = engine.ctx.currentTime;
      engine.color.frequency.setTargetAtTime(effectOn("filter") ? 480 : 700 + 10500 * Number(state.signal == null ? .65 : state.signal), now, 0.035);
      engine.wet.gain.setTargetAtTime(effectOn("space") ? .55 : .04 + .32 * Number(state.body || 0), now, 0.08);
    }
  }

  function drawEvent(ctx, item) {
    var playerColors = ["#FF4F00", "#F5C400", "#1A1AFF", "#F0EDE8"];
    var color = item.player
      ? playerColors[Math.max(0, Math.min(3, item.player - 1))]
      : (item.style.phase ? "#1A1AFF" : "#FF4F00");
    for (var voice = 0; voice < item.ys.length; voice += 1) {
      var y = Math.round(item.ys[voice]);
      ctx.globalAlpha = item.intensity;
      if (item.style.knockout) {
        ctx.fillStyle = "#090806";
        ctx.fillRect(Math.round(item.x) - 3, y - 3, 7, 7);
        ctx.strokeStyle = "#1A1AFF";
        ctx.strokeRect(Math.round(item.x) - 3, y - 3, 7, 7);
      } else {
        ctx.fillStyle = voice === 2 && !item.player ? "#F5C400" : color;
        ctx.fillRect(Math.round(item.x) - 2, y - 2, 5, 5);
        if (item.style.topology === "twin") { ctx.fillRect(Math.round(item.x) - 2, y + 3, 5, 1); }
        if (item.style.topology === "shelf") { ctx.fillRect(Math.round(item.x), y, 11, 2); }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawVoiceRibbons(ctx, items) {
    if (!items.length) { return; }
    var ordered = items.slice().sort(function (a, b) { return a.x - b.x; });
    for (var voice = 0; voice < 4; voice += 1) {
      ctx.beginPath();
      ctx.moveTo(ordered[0].x, ordered[0].ys[voice]);
      for (var index = 1; index < ordered.length; index += 1) {
        var before = ordered[index - 1];
        var item = ordered[index];
        var mid = (before.x + item.x) / 2;
        ctx.bezierCurveTo(mid, before.ys[voice], mid, item.ys[voice], item.x, item.ys[voice]);
      }
      if (ordered.length === 1) {
        ctx.lineTo(Math.min(223, ordered[0].x + 28), ordered[0].ys[voice]);
      }
      ctx.globalAlpha = 0.72;
      ctx.strokeStyle = voice === 2 ? "#F5C400" : "#FF4F00";
      ctx.lineWidth = voice === 0 ? 2 : 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function render(now) {
    if (!active || !context2d) { return; }
    if (lastVisualAt && now - lastVisualAt < 33) {
      frameId = window.requestAnimationFrame(render);
      return;
    }
    lastVisualAt = now;
    var started = performance.now();
    var nowBeat = T.absoluteBeat(Date.now() / 1000, state.tempo);
    if (!pocketScene && window.PocketScene) {
      try { pocketScene = new window.PocketScene(960,720); } catch(error) { stats.sceneError=String(error); }
    }
    if (pocketScene) {
      visualHits = visualHits.filter(function(hit) {
        if (!audio || hit.at > audio.ctx.currentTime) return true;
        pocketScene.excite(hit.note, hit.velocity); if(hit.chord) lastChord=hit.chord; return false;
      });
      pocketScene.render(now, nowBeat, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      context2d.drawImage(pocketScene.canvas,0,0,960,720);
      context2d.save(); context2d.fillStyle='#eee9da'; context2d.font='18px monospace';
      context2d.fillText('SYNTH VISIONS / ROOM MACHINE',46,48);
      context2d.fillStyle='#ff8a31'; context2d.font='40px monospace';
      context2d.fillText(lastChord ? Voice.chordSpec(lastChord.degree,lastChord.quality).label : 'MAKE YOURSELF HEARD',46,112);
      context2d.font='18px monospace'; context2d.fillStyle='#eee9da';
      context2d.fillText(Math.round(state.bpm||63)+' BPM  /  '+((state.tempo||{}).paused?'PAUSED':'PLAYING'),46,674);
      context2d.textAlign='right';var position=T.loopBeat(nowBeat);
      context2d.fillText('BAR '+(Math.floor(position/4)+1)+' · '+(Math.floor(position%4)+1)+'   '+(state.players||[]).length+'/4 PLAYERS',880,674);
      context2d.textAlign='left';
      if(window.SynthWorkshop){
        var workshop=window.SynthWorkshop,bar=Math.floor(position/4);
        Object.keys(workshop.roles).forEach(function(role,row){
          var y=464+row*34;context2d.fillStyle=workshop.roles[role].color;context2d.font='13px monospace';context2d.fillText(workshop.roles[role].name,46,y+14);
          for(var step=0;step<16;step++){
            var at=bar*4+step/4,filled=(state.events||[]).some(function(e){return workshop.roleOf(e)===role&&Math.floor(e.beat*4)===Math.floor(at*4);});
            context2d.globalAlpha=filled?.85:.17;context2d.fillRect(160+step*45,y,34,18);
            if(!(state.tempo||{}).paused&&Math.floor((position%4)*4)===step){context2d.globalAlpha=1;context2d.strokeStyle='#eef0d6';context2d.strokeRect(157+step*45,y-3,40,24);}
          }
          context2d.globalAlpha=1;
        });
        context2d.font='13px monospace';context2d.fillStyle='#eef0d6';
        context2d.fillText((state.wander||{}).enabled?'WANDER / EXPLORING THE WRITTEN LOOP':'FOUR PARTS / ONE ROOM',46,630);
      }
      context2d.restore();stats.visualFrameMs=performance.now()-started;stats.visualFrames++;stats.scene='pocket-3d';
      frameId=window.requestAnimationFrame(render);return;
    }
    var rotation = Math.floor(nowBeat / 32);
    var events = voicesForEvents();
    var voicings = events.map(function (event) { return voicedById[event.id] || [48, 52, 55, 60]; });
    var model = Visual.primitives(events, voicings, rotation, T.loopBeat(nowBeat),
      Number(state.pulse || 0), Number(state.signal || 1), {
        amount: 0, confidence: expression.confidence,
        lean: expression.lean, lift: expression.lift, span: expression.span,
        depth: expression.depth, energy: expression.energy
      });
    var ctx = back.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 240, 180);
    ctx.globalAlpha = model.memory;
    ctx.drawImage(front, model.rowSlip, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(9,8,6," + (1 - model.memory).toFixed(3) + ")";
    ctx.fillRect(0, 0, 240, 180);
    if (!events.length) {
      var seedX = 120 + Math.sin(now * 0.0004) * 18;
      var seedY = 90 + Math.cos(now * 0.00031) * 12;
      ctx.fillStyle = "#FF4F00";
      ctx.fillRect(Math.round(seedX) - 2, Math.round(seedY) - 2, 5, 5);
    }
    drawVoiceRibbons(ctx, model.events);
    model.events.forEach(function (item) { drawEvent(ctx, item); });
    model.bodyAttractors.forEach(function (attractor) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = attractor.strength * 0.35;
      ctx.beginPath();
      ctx.ellipse(attractor.x, attractor.y, attractor.radius, attractor.radius * 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    if (model.dropout) {
      ctx.fillStyle = "#090806";
      ctx.fillRect(0, 0, 240, 180);
    }
    var swap = front; front = back; back = swap;
    context2d.imageSmoothingEnabled = false;
    context2d.fillStyle = "#090806";
    context2d.fillRect(0, 0, 960, 720);
    context2d.drawImage(front, 0, 0, 960, 720);
    context2d.save();
    context2d.globalAlpha = 0.5;
    context2d.fillStyle = "#17120D";
    for (var grid = 0; grid <= 32; grid += 4) {
      context2d.fillRect(Math.round(Visual.beatX(grid) * 4), 52, 4, 616);
    }
    context2d.globalAlpha = 0.24;
    context2d.fillStyle = "#FF4F00";
    context2d.fillRect(Math.round(model.beamX * 4) - 8, 52, 4, 616);
    context2d.fillRect(Math.round(model.beamX * 4) + 8, 52, 4, 616);
    context2d.globalAlpha = 0.95;
    context2d.fillStyle = "#F5C400";
    context2d.fillRect(Math.round(model.beamX * 4), 52, 4, 616);
    context2d.restore();
    drawBroadcastType(context2d, model, events);
    stats.visualFrameMs = performance.now() - started;
    stats.visualFrames += 1;
    frameId = window.requestAnimationFrame(render);
  }

  function drawBroadcastType(ctx, model, events) {
    ctx.save();
    ctx.font = "16px 'Madrid Mono', monospace";
    ctx.fillStyle = "#F0EDE8";
    ctx.fillText("CHANNEL MADRiD", 46, 48);
    ctx.textAlign = "center";
    ctx.fillText("CH 14 / SYNTH VISIONS", 480, 48);
    ctx.textAlign = "right";
    ctx.fillStyle = "#F5C400";
    ctx.fillText("ON AIR", 914, 48);
    ctx.textAlign = "left";
    if (events.length) {
      var latest = events[events.length - 1];
      var labels = ["C", "D", "E", "F", "G", "A", "B♭", "A♭"];
      ctx.fillStyle = "#FF4F00";
      ctx.fillRect(48, 112, 6, 64);
      ctx.fillStyle = "#F5C400";
      ctx.fillText("NOW WRITING / " + String(latest.beat + 1).padStart(2, "0"), 64, 124);
      ctx.font = "52px 'Madrid Display', monospace";
      ctx.fillStyle = "#F0EDE8";
      ctx.fillText(labels[latest.degree] + " " + String(latest.quality || "maj").toUpperCase(), 64, 168);
    } else {
      ctx.font = "38px 'Madrid Display', monospace";
      ctx.fillStyle = "#FF4F00";
      ctx.fillText("PLAY A CHORD", 54, 154);
    }
    ctx.font = "16px 'Madrid Mono', monospace";
    ctx.fillStyle = "#F5C400";
    ctx.fillText(Patches.label(state.instrument || "tape") + " / " +
      Math.round(state.tempo && state.tempo.bpm ? state.tempo.bpm : 63) + " BPM" +
      (state.rhythm && state.rhythm !== "off"
        ? " / " + String(state.rhythm).toUpperCase() : ""), 48, 96);
    ctx.fillStyle = "#F0EDE8";
    ctx.fillText(new Date().toLocaleTimeString("en-US", { hour12: false }), 48, 684);
    ctx.textAlign = "center";
    ctx.fillText("ROOM " + String((state.players || []).length) + "/4 / MEMORY " +
      String((state.events || []).length).padStart(2, "0") +
      " / PULSE " + Math.round((state.pulse || 0) * 100) +
      " / SIGNAL " + Math.round((state.signal || 0) * 100), 480, 684);
    ctx.textAlign = "right";
    ctx.fillText("BAR " + (Math.floor(T.loopBeat(T.absoluteBeat(Date.now()/1000,state.tempo))/4)+1), 912, 684);
    ctx.restore();
  }

  function stopRuntime() {
    if(unlockButton)unlockButton.hidden=true;
    if(roomWatch)roomWatch.stop();
    panic();
    if (pocketScene) { pocketScene.dispose(); pocketScene = null; }
    if (timer) { window.clearInterval(timer); timer = null; }
    if (frameId) { window.cancelAnimationFrame(frameId); frameId = null; }
    Object.keys(envelopes).forEach(function (id) { stealEnvelope(id, audio ? audio.ctx.currentTime : 0); });
    if (audio) { audio.master.gain.setTargetAtTime(0.0001, audio.ctx.currentTime, 0.04); }
    expression = neutralExpression();
    lastVisualAt = 0;
  }

  function setActive(next, nextState) {
    var wasActive = active;
    if (next && wasActive) {
      updateState(nextState);
    } else {
      state = nextState || state;
      seenEventIds = {};
      (state.events || []).forEach(function (event) { seenEventIds[event.id] = true; });
    }
    if (!next) {
      active = false;
    if(midiBridge)midiBridge.update(state,audio,false);
      stopRuntime();
      return;
    }
    if (!wasActive) { scheduler = T.createScheduler(); seenLiveIds = {}; }
    active = true;
    var engine = ensureAudio();
    if (engine) {
      if (engine.ctx.state === "suspended") { engine.ctx.resume(); }
      engine.master.gain.setTargetAtTime(recallPlaying ? 0.0001 : 0.72, engine.ctx.currentTime, 0.08);
    }
    if (!timer) { timer = window.setInterval(audioTick, 12); }
    if(roomWatch)roomWatch.start();
    if (!frameId) { frameId = window.requestAnimationFrame(render); }
  }

  function updateState(nextState) {
    var incoming = nextState || state;
    if ((incoming.pocket||{}).session === (state.pocket||{}).session && Number(incoming.rev||0)<Number(state.rev||0)) return;
    if ((incoming.pocket || {}).generation !== (state.pocket || {}).generation) { panic(); }
    (incoming.events || []).forEach(function (event) {
      if (!seenEventIds[event.id]) {
        if (T.isLate(event, scheduler)) { stats.lateEvents += 1; }
        seenEventIds[event.id] = true;
      }
    });
    var authors=(incoming.pocket||{}).author_generation||{}, previousAuthors=(state.pocket||{}).author_generation||{};
    Object.keys(authors).forEach(function(author){if(authors[author]!==previousAuthors[author]){
      playingSources.filter(function(item){return item.author===author;}).forEach(function(item){try{item.source.stop(audio.ctx.currentTime+.012);}catch(e){}});
    }});
    state = incoming;
    if(sampler)sampler.preload((state.events||[]).concat((state.players||[]).map(function(p){return {instrument:p.instrument};})).concat(Object.values(((state.pocket||{}).midi||{}).tracks||{}).map(function(id){return {instrument:id};})));
    if(midiBridge)midiBridge.update(state,ensureAudio(),active);
    // Bound the seen-live map to ids still advertised by the server.
    var liveIds = {};
    (state.live || []).forEach(function (item) { liveIds[item.id] = true; });
    Object.keys(seenLiveIds).forEach(function (id) {
      if (!liveIds[id]) { delete seenLiveIds[id]; }
    });
  }

  function debugStats() {
    var copy = {};
    Object.keys(stats).forEach(function (key) { copy[key] = stats[key]; });
    copy.activeSources = playingSources.length;
    copy.audioState = audio ? audio.ctx.state : "unavailable";
    copy.active = active;
    copy.recallPlaying = recallPlaying;
    return copy;
  }

  function setRecallPlaying(next) {
    recallPlaying = Boolean(next);
    if (audio) {
      audio.master.gain.setTargetAtTime(
        recallPlaying || !active ? 0.0001 : 0.72,
        audio.ctx.currentTime,
        0.06
      );
    }
  }

  if (canvas) {
    canvas.addEventListener("pointerdown", function () {
      var engine = ensureAudio();
      if (engine && engine.ctx.state === "suspended") { engine.ctx.resume(); }
    });
  }

  window.MadridSynth = {
    setActive: setActive,
    updateState: updateState,
    setRecallPlaying: setRecallPlaying,
    debugStats: debugStats,
    programCanvas: function () { return canvas; },
    recorderStream: function () { return audio ? audio.recorder.stream : null; }
  };
}());
