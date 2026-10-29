/* CH09: bounded persistent layer voices, measured output, finite calibration. */
(function (root) {
  "use strict";
  var Layer = root.DroneLayerModel, Effects = root.DroneEffects;
  if (typeof module !== "undefined" && module.exports) {
    Layer = require("./drone-layer-model.js");
    Effects = require("./drone-effects.js");
  }
  var HARMONICS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16], MAX_LAYERS = 40;
  var bound = Effects.bounded;
  function harmonicFor(y) {
    return HARMONICS[Math.round(bound(1 - y, 0, 1, 0) * (HARMONICS.length - 1))];
  }
  function ramp(param, value, ctx, seconds) {
    var now = ctx.currentTime;
    if (param.cancelAndHoldAtTime) { param.cancelAndHoldAtTime(now); }
    else {
      var held = param.value;
      param.cancelScheduledValues(now); param.setValueAtTime(held, now);
    }
    param.linearRampToValueAtTime(value, now + seconds);
  }
  function selectedProfile(state) {
    return (state.profiles || []).filter(function (profile) {
      return profile.id === state.selected_profile_id;
    })[0] || null;
  }
  function layersFrom(state) {
    return Array.isArray(state.layers) ? state.layers : (state.nodes || []).map(function (node) {
      return {id: node.id, kind: "tap", muted: false,
        points: [{x: node.x, y: node.y, t: 0}]};
    });
  }
  function periodicWave(ctx, compiled, wave) {
    var real = new Float32Array(33), imaginary = new Float32Array(33);
    var samples = compiled.wavetable;
    for (var h = 1; h < real.length; h++) {
      for (var i = 0; i < samples.length; i++) {
        var angle = 2 * Math.PI * h * i / samples.length;
        real[h] += samples[i] * Math.cos(angle) * 2 / samples.length;
        imaginary[h] += samples[i] * Math.sin(angle) * 2 / samples.length;
      }
      var base = wave === "sine" ? (h === 1 ? 1 : 0) :
        wave === "triangle" ? (h % 2 ? Math.pow(-1, (h - 1) / 2) / (h * h) : 0) :
        wave === "square" ? (h % 2 ? 1 / h : 0) : Math.pow(-1, h + 1) / h;
      imaginary[h] = imaginary[h] * .7 + base * .3;
      real[h] *= .7;
    }
    return ctx.createPeriodicWave(real, imaginary);
  }
  function createEngine(ctx, options) {
    options = options || {};
    var voices = new Map(), state = {}, environment = {};
    var active = false, disposed = false, calibration = null, signal = null, watchdog = null;
    var setTimer = options.setTimeout || setTimeout, clearTimer = options.clearTimeout || clearTimeout;
    var bus = ctx.createGain(), filter = ctx.createBiquadFilter();
    var mix = ctx.createGain(), compressor = ctx.createDynamicsCompressor();
    var ordinary = ctx.createGain(), finalMix = ctx.createGain(), limiter = ctx.createWaveShaper();
    var analyser = ctx.createAnalyser(), calibrationGain = ctx.createGain();
    bus.gain.value = .7; filter.type = "lowpass"; ordinary.gain.value = 0;
    compressor.threshold.value = -16; compressor.knee.value = 12;
    compressor.ratio.value = 16; compressor.attack.value = .003; compressor.release.value = .25;
    var curve = new Float32Array(4097);
    for (var c = 0; c < curve.length; c++) {
      curve[c] = Math.max(-.85, Math.min(.85, (c / (curve.length - 1)) * 2 - 1));
    }
    limiter.curve = curve;
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = .65;
    calibrationGain.gain.value = 0;
    bus.connect(filter);
    var effects = Effects.create(ctx, filter, mix);
    mix.connect(compressor); compressor.connect(ordinary); ordinary.connect(finalMix);
    calibrationGain.connect(finalMix); finalMix.connect(limiter);
    limiter.connect(analyser); analyser.connect(options.destination || ctx.destination);
    var outputData = new Float32Array(analyser.fftSize);
    var spectrum = new Uint8Array(analyser.frequencyBinCount);
    var nodes = [bus, filter, mix, compressor, ordinary, finalMix, limiter, analyser, calibrationGain];
    // One quiet room-expression voice is independent of all authored layers.
    var room = ctx.createOscillator(), roomGain = ctx.createGain(), roomFilter = ctx.createBiquadFilter();
    var roomPan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    room.type = "sine"; roomGain.gain.value = 0;
    roomFilter.type = "lowpass"; roomFilter.Q.value = .5;
    room.connect(roomFilter); roomFilter.connect(roomGain); roomGain.connect(roomPan);
    roomPan.connect(bus); room.start();
    nodes.push(room, roomFilter, roomGain, roomPan);

    function soundGate() {
      ramp(ordinary.gain, active && !calibration && state.sound_enabled !== false ? .62 : 0,
        ctx, state.sound_enabled === false || calibration ? .025 : .25);
    }
    function destroyVoice(voice) {
      [voice.osc, voice.mod].forEach(function (source) {
        if (source) { try { source.stop(); } catch (error) { /* already stopped */ } }
      });
      voice.nodes.forEach(function (node) { node.disconnect(); });
      if (voice.mod) { voice.mod.disconnect(); }
    }
    function configureVoice(voice, layer, profile, wave) {
      var key = JSON.stringify([layer.kind, layer.points, profile, wave]);
      voice.muted = !!layer.muted;
      if (voice.key === key) { return; }
      var compiled = Layer.compile(layer, profile, ctx.sampleRate);
      voice.key = key; voice.compiled = compiled;
      if (layer.kind === "stroke") { voice.osc.setPeriodicWave(periodicWave(ctx, compiled, wave)); }
      else { voice.osc.type = wave; }
      if (voice.pan.pan) { ramp(voice.pan.pan, compiled.pan * .85, ctx, .15); }
      ramp(voice.filter.frequency, Math.min(ctx.sampleRate * .4, 500 + compiled.brightness * 8500), ctx, .15);
      if (voice.mod) { voice.mod.stop(); voice.mod.disconnect(); }
      voice.mod = null;
      if (layer.kind === "stroke") {
        // One looped control buffer, never one oscillator per point.
        var buffer = ctx.createBuffer(1, compiled.modulation.length, ctx.sampleRate);
        buffer.getChannelData(0).set(compiled.modulation);
        voice.mod = ctx.createBufferSource(); voice.mod.buffer = buffer;
        voice.mod.loop = true;
        voice.mod.playbackRate.value = buffer.duration / compiled.loopSeconds;
        voice.mod.connect(voice.modDepth); voice.mod.connect(voice.pitchDepth); voice.mod.start();
      }
    }
    function createVoice(layer, profile, wave) {
      var osc = ctx.createOscillator(), gain = ctx.createGain();
      var localFilter = ctx.createBiquadFilter();
      var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      var trace = ctx.createAnalyser(), modDepth = ctx.createGain(), pitchDepth = ctx.createGain();
      gain.gain.value = 0; localFilter.type = "lowpass";
      localFilter.Q.value = .5; trace.fftSize = 512; modDepth.gain.value = 280;
      pitchDepth.gain.value = 70;
      osc.connect(localFilter); localFilter.connect(gain); gain.connect(pan);
      pan.connect(trace); trace.connect(bus); modDepth.connect(localFilter.detune);
      pitchDepth.connect(osc.detune);
      var voice = {id: layer.id, osc: osc, gain: gain, filter: localFilter, pan: pan,
        analyser: trace, data: new Float32Array(trace.fftSize), modDepth: modDepth, pitchDepth: pitchDepth,
        nodes: [osc, gain, localFilter, pan, trace, modDepth, pitchDepth]};
      configureVoice(voice, layer, profile, wave); osc.start();
      return voice;
    }
    function apply(next) {
      if (disposed) { return; }
      state = next || {};
      var profile = selectedProfile(state), layers = layersFrom(state).slice(0, MAX_LAYERS);
      var wave = ["sine", "triangle", "sawtooth", "square"].indexOf(state.wave) >= 0 ?
        state.wave : "sawtooth";
      var wanted = new Set(layers.map(function (layer) { return layer.id; }));
      voices.forEach(function (voice, id) {
        if (!wanted.has(id)) { destroyVoice(voice); voices.delete(id); }
      });
      layers.forEach(function (layer) {
        if (!voices.has(layer.id)) { voices.set(layer.id, createVoice(layer, profile, wave)); }
        else { configureVoice(voices.get(layer.id), layer, profile, wave); }
      });
      var audible = layers.filter(function (layer) { return !layer.muted; }).length;
      var rootHz = bound(state.tuning, 24, 240, 55);
      voices.forEach(function (voice) {
        var ratio = voice.compiled.rootRatio;
        ramp(voice.osc.frequency, Math.min(ctx.sampleRate * .4, rootHz * ratio), ctx, .2);
        ramp(voice.gain.gain, voice.muted ? 0 :
          .48 / Math.sqrt(Math.max(1, audible)) / Math.pow(Math.max(1, ratio), .55),
        ctx, voice.muted ? .025 : voice.compiled.attackSeconds);
      });
      ramp(filter.frequency, Math.min(ctx.sampleRate * .45, bound(state.cutoff, 40, 12000, 900)), ctx, .15);
      ramp(filter.Q, .5 + bound(state.resonance, 0, 30, 7) * .12, ctx, .15);
      ramp(room.frequency, rootHz * 2, ctx, .3);
      effects.apply(state, environment); soundGate();
      if (state.sound_enabled === false && calibration) { stopCalibration(); }
    }
    function stopSignal() {
      if (signal) {
        signal.onended = null;
        try { signal.stop(); } catch (error) { /* finite source already ended */ }
        signal.disconnect(); signal = null;
      }
      calibrationGain.gain.cancelScheduledValues(ctx.currentTime);
      calibrationGain.gain.setValueAtTime(0, ctx.currentTime);
    }
    function stopCalibration() {
      stopSignal();
      if (watchdog !== null) { clearTimer(watchdog); watchdog = null; }
      calibration = null;
      if (!disposed) { soundGate(); }
    }
    var api = {
      ctx: ctx, voices: voices, analyser: analyser, effects: effects,
      apply: apply,
      setRunning: function (running) {
        if (disposed) { return; }
        active = !!running;
        if (!active) { api.dispose(); return; }
        if (ctx.state === "suspended" && ctx.resume && !ctx.startRendering) {
          var resumed = ctx.resume();
          if (resumed && resumed.catch) { resumed.catch(function () {}); }
        }
        soundGate();
      },
      applyEnvironment: function (snapshot) {
        if (disposed) { return; }
        environment = snapshot || {};
        var confidence = bound(environment.trackingConfidence, 0, 1, 0);
        room.type = bound(environment.occupancy, 0, 1, 0) > .5 ? "triangle" : "sine";
        ramp(roomFilter.frequency, 300 + (1 - bound(environment.averageDepth, 0, 1, .5)) * 1800, ctx, .8);
        ramp(roomGain.gain, .035 * bound(environment.occupancy, 0, 1, 0) * confidence, ctx, .8);
        if (roomPan.pan) {
          ramp(roomPan.pan, bound(environment.horizontalCenter, -1, 1, 0) * .6, ctx, .8);
        }
        ramp(room.detune, bound(environment.movementEnergy, 0, 1, 0) * 5, ctx, .8);
        effects.apply(state, environment);
      },
      beginCalibration: function (session) {
        if (!active || disposed || state.sound_enabled === false || !session ||
            !(session.id || session.session_id || session.session)) { return false; }
        stopCalibration();
        calibration = Object.assign({}, session);
        ordinary.gain.cancelScheduledValues(ctx.currentTime);
        ordinary.gain.setValueAtTime(0, ctx.currentTime);
        var expiry = session.expires_at || session.deadline;
        var remaining = Number.isFinite(expiry) ? expiry * (expiry < 1e12 ? 1000 : 1) - Date.now() : 30000;
        if (remaining <= 0) { stopCalibration(); return false; }
        watchdog = setTimer(function () {
          stopCalibration();
          if (options.onCalibrationTimeout) { options.onCalibrationTimeout(); }
        }, Math.min(40000, remaining));
        return true;
      },
      playCalibrationSignal: function (samples, sampleRate, level, onEnded) {
        if (!active || !calibration || disposed || !samples || !Number.isFinite(sampleRate) ||
            sampleRate < 8000 || sampleRate > 96000 || samples.length < 1 ||
            samples.length > sampleRate * 20 || !Number.isFinite(level) || level < 0) { return false; }
        for (var i = 0; i < samples.length; i++) {
          if (!Number.isFinite(samples[i]) || Math.abs(samples[i]) > 1) { return false; }
        }
        stopSignal();
        var buffer = ctx.createBuffer(1, samples.length, sampleRate);
        var signalData = buffer.getChannelData(0);
        for (i = 0; i < samples.length; i++) {
          signalData[i] = Math.max(-.12, Math.min(.12, samples[i] * level));
        }
        var source = signal = ctx.createBufferSource();
        source.buffer = buffer; source.connect(calibrationGain);
        calibrationGain.gain.setValueAtTime(1, ctx.currentTime);
        var sessionId = calibration.id || calibration.session_id || calibration.session;
        source.signalStartedAt = ctx.currentTime;
        source.onended = function () {
          if (signal !== source) { return; }
          source.disconnect(); signal = null;
          calibrationGain.gain.setValueAtTime(0, ctx.currentTime);
          if (calibration && (calibration.id || calibration.session_id || calibration.session) === sessionId &&
              onEnded) { onEnded(); }
        };
        source.start(); source.stop(ctx.currentTime + buffer.duration);
        return true;
      },
      stopCalibration: stopCalibration,
      stopCalibrationSignal: stopSignal,
      updateCalibration: function (snapshot) {
        if (calibration) { calibration = Object.assign({}, calibration, snapshot); }
      },
      readFrame: function () {
        analyser.getFloatTimeDomainData(outputData); analyser.getByteFrequencyData(spectrum);
        var peak = 0, energy = 0, traces = [];
        outputData.forEach(function (value) { peak = Math.max(peak, Math.abs(value)); energy += value * value; });
        voices.forEach(function (voice) {
          if (voice.muted || calibration || state.sound_enabled === false) { return; }
          voice.analyser.getFloatTimeDomainData(voice.data);
          traces.push({id: voice.id, data: voice.data});
        });
        var calibrationView = calibration && Object.assign({}, calibration);
        if (calibrationView && signal) {
          var elapsed = ctx.currentTime - signal.signalStartedAt;
          calibrationView.frequency_hz = calibration.phase === "pilot" ? 173 :
            30 * Math.pow(500 / 30, Math.min(1, elapsed / 12));
        }
        return {waveform: outputData, spectrum: spectrum, traces: traces,
          sampleRate: ctx.sampleRate, rms: Math.sqrt(energy / outputData.length),
          peak: peak, limiting: peak >= .83 || compressor.reduction < -6,
          profile: selectedProfile(state), calibration: calibrationView,
          soundEnabled: state.sound_enabled !== false, environment: environment,
          audioState: ctx.state, renderer: "canvas2d"};
      },
      inspect: function () {
        return {active: active, disposed: disposed, voiceCount: voices.size,
          principalOscillators: disposed ? 0 : voices.size + 1,
          modulationSources: Array.from(voices.values()).filter(function (v) { return !!v.mod; }).length,
          calibrating: !!calibration, signalPlaying: !!signal,
          soundEnabled: state.sound_enabled !== false, effects: Effects.settings(state, environment)};
      },
      dispose: function () {
        if (disposed) { return; }
        active = false; disposed = true; stopCalibration();
        ordinary.gain.cancelScheduledValues(ctx.currentTime); ordinary.gain.value = 0;
        voices.forEach(destroyVoice); voices.clear();
        room.stop(); effects.dispose();
        nodes.forEach(function (node) { node.disconnect(); });
      }
    };
    return api;
  }

  function calibrationSamples(phase, rate) {
    var duration = phase === "pilot" ? 1 : 12;
    var data = new Float32Array(Math.round(duration * rate)), logRatio = Math.log(500 / 30);
    var level = phase === "pilot" ? .03 : .05, fadeSeconds = phase === "pilot" ? .05 : .1;
    for (var i = 0; i < data.length; i++) {
      var time = i / rate, fade = Math.min(1, time / fadeSeconds, (duration - time) / fadeSeconds);
      var angle = phase === "pilot" ? 2 * Math.PI * 173 * time :
        2 * Math.PI * 30 * duration / logRatio * Math.expm1(time * logRatio / duration);
      data[i] = level * Math.max(0, fade) * Math.sin(angle);
    }
    return data;
  }
  function createCalibrationDriver(engine, send, options) {
    options = options || {};
    var now = options.now || Date.now, snapshot = null, baseState = null;
    var phase = "", session = "", lastSeen = 0, lastHeartbeat = 0, rejected = "";
    function event(name) {
      var id = session;
      var result;
      try { result = send({session: id, event: name}); }
      catch (error) { abort(false); return; }
      if (result && result.catch) {
        result.catch(function () {
          if (session === id) { abort(false); }
        });
      }
    }
    function abort(notify) {
      if (!session) { return; }
      rejected = session;
      engine.stopCalibration();
      if (baseState) { engine.apply(baseState); }
      if (notify) { event("aborted"); }
      session = ""; phase = ""; snapshot = null;
    }
    return {
      update: function (next, state) {
        baseState = state;
        if (!next || (!next.active && next.phase !== "audition") || !next.session ||
            !["waiting-capture", "quiet-check", "pilot", "sweeping", "decay", "analyzing", "audition"].includes(next.phase)) {
          abort(false); return;
        }
        if (state.sound_enabled === false) {
          if (!session && rejected !== next.session) { session = next.session; }
          abort(true); return;
        }
        if (rejected === next.session) { return; }
        if (session !== next.session) {
          abort(false);
          session = next.session;
          if (!engine.beginCalibration(next)) { abort(true); return; }
          event("ready"); lastHeartbeat = now();
          if (!session) { return; }
        }
        lastSeen = now(); snapshot = next;
        engine.updateCalibration(next);
        if (phase === next.phase && phase !== "audition") { return; }
        phase = next.phase;
        if (phase === "audition") {
          engine.stopCalibration();
          if (next.candidate) {
            engine.apply(Object.assign({}, state, {
              tuning: next.candidate.root_hz, profiles: [next.candidate],
              selected_profile_id: next.candidate.id
            }));
          }
        } else if (phase === "pilot" || phase === "sweeping") {
          var rate = 48000, current = session, expectedPhase = phase;
          // Samples already contain the analyzer's exact Float32 level and fade.
          var started = engine.playCalibrationSignal(calibrationSamples(phase, rate), rate, 1, function () {
            if (current === session && phase === expectedPhase) {
              event(expectedPhase === "pilot" ? "pilot-complete" : "sweep-complete");
            }
          });
          if (!started) { abort(true); }
        } else {
          engine.stopCalibrationSignal();
        }
      },
      tick: function () {
        if (!session) { return; }
        var expired = snapshot && Number.isFinite(snapshot.expires_at) && now() > snapshot.expires_at * 1000;
        if (now() - lastSeen > 3000 || expired) { abort(true); return; }
        if (now() - lastHeartbeat >= 900) { lastHeartbeat = now(); event("heartbeat"); }
      },
      stop: function () { abort(true); },
      inspect: function () { return {session: session, phase: phase, rejected: rejected}; }
    };
  }

  var station = {active: false, engine: null, renderer: null, state: {}, raf: null,
    environment: null, runtime: null, calibration: null, watchdog: null};
  function updateLabels(reading) {
    var count = root.document.getElementById("drone-count");
    var tuning = root.document.getElementById("drone-tuning-label");
    var status = root.document.getElementById("drone-audio-status");
    if (count) { count.textContent = layersFrom(station.state).length + " LAYERS"; }
    if (tuning) { tuning.textContent = bound(station.state.tuning, 24, 240, 55).toFixed(1) + " HZ"; }
    if (status) {
      status.textContent = reading.calibration ? "ROOM CALIBRATION" :
        reading.audioState !== "running" ? "AUDIO " + reading.audioState.toUpperCase() :
        !reading.soundEnabled ? "SOUND STOPPED" : reading.limiting ? "LIMIT" : "";
      status.classList.toggle("is-limiting", reading.limiting);
    }
  }
  function frame() {
    if (!station.active || !station.engine) { station.raf = null; return; }
    if (station.environment) { station.engine.applyEnvironment(station.environment.sample(Date.now())); }
    var reading = station.engine.readFrame();
    if (station.renderer) { station.renderer.draw(reading); }
    updateLabels(reading);
    station.raf = root.requestAnimationFrame(frame);
  }
  var api = {
    createEngine: createEngine, createCalibrationDriver: createCalibrationDriver,
    calibrationSamples: calibrationSamples, harmonicFor: harmonicFor, HARMONICS: HARMONICS,
    setActive: function (active, state, roomRuntime) {
      if (state) { station.state = state; }
      if (!active) {
        station.active = false;
        if (station.calibration) { station.calibration.stop(); station.calibration = null; }
        if (station.watchdog !== null) { root.clearInterval(station.watchdog); station.watchdog = null; }
        if (station.raf !== null) { root.cancelAnimationFrame(station.raf); station.raf = null; }
        if (station.engine) {
          var ctx = station.engine.ctx; station.engine.dispose(); station.engine = null;
          if (ctx.close) { ctx.close().catch(function () {}); }
        }
        station.environment = null; station.runtime = null;
        if (station.renderer) { station.renderer.clear(); }
        return;
      }
      station.active = true;
      if (!station.engine) {
        var Audio = root.AudioContext || root.webkitAudioContext;
        if (!Audio) { return; }
        station.engine = createEngine(new Audio());
        station.engine.setRunning(true);
        station.calibration = createCalibrationDriver(station.engine, function (message) {
          return root.fetch("/api/drone/calibration/renderer", {
            method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(message)
          }).then(function (response) {
            if (!response.ok) { throw new Error("calibration coordinator unavailable"); }
          });
        });
        station.watchdog = root.setInterval(function () {
          if (station.calibration) { station.calibration.tick(); }
        }, 250);
        if (root.DroneEnvironment) { station.environment = root.DroneEnvironment.createModel(); }
        var canvas = root.document.getElementById("drone-field");
        if (canvas && root.DroneOscilloscope) { station.renderer = root.DroneOscilloscope.create(canvas); }
      }
      var signature = JSON.stringify(station.state);
      if (station.engine.ctx.state === "suspended") { station.engine.setRunning(true); }
      if (station.engine.stateSignature !== signature) {
        station.engine.apply(station.state); station.engine.stateSignature = signature;
      }
      if (station.calibration) {
        station.calibration.update(roomRuntime && roomRuntime.calibration, station.state);
      }
      if (roomRuntime) { api.applyEnvironment(roomRuntime.environment || roomRuntime.kinect || roomRuntime); }
      if (station.raf === null) { frame(); }
    },
    apply: function (state) {
      station.state = state || {};
      if (station.engine) { station.engine.apply(station.state); }
    },
    applyEnvironment: function (snapshot) {
      if (!station.engine) { return; }
      if (snapshot && Number.isFinite(snapshot.movementEnergy)) {
        station.environment = null; station.engine.applyEnvironment(snapshot);
      } else if (station.environment && snapshot !== station.runtime) {
        station.runtime = snapshot; station.environment.feed(snapshot, Date.now());
      }
    },
    beginCalibration: function (session) { return !!station.engine && station.engine.beginCalibration(session); },
    playCalibrationSignal: function (samples, rate, level, onEnded) {
      return !!station.engine && station.engine.playCalibrationSignal(samples, rate, level, onEnded);
    },
    stopCalibration: function () { if (station.engine) { station.engine.stopCalibration(); } },
    inspect: function () { return station.engine ? station.engine.inspect() : {active: false, voiceCount: 0}; }
  };
  root.MadridDrone = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
}(typeof window !== "undefined" ? window : this));
