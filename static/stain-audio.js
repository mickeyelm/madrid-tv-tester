/* STAIN TV / CH 23 — audio engine.
 *
 * Everything here is synthesised. No sample files: the tube's audio path is
 * HDMI into the capture box, and a channel that depends on loadable assets is
 * a channel that can fail silently at 3am.
 *
 * Five voices, in the order the broadcast uses them:
 *   sadHorn()      the pathetic descending slide, once per COMING SOON loop
 *   ShepardStack   the endless descent, stacked at uneven rates
 *   horrorHorn()   ruptured brass clusters during the red transformation
 *   marchArmy()    one bear pose = one massed military footfall
 *   fartChorus()   chaos that resolves into something accidentally beautiful
 */
(function (global) {
  "use strict";

  var AudioCtx = global.AudioContext || global.webkitAudioContext;

  // Compensates the bandpass loss in _squelch; tuned by rendering the horn and
  // the chorus offline and matching their peaks.
  var SQUELCH_MAKEUP = 4.5;

  function StainAudio() {
    this.ctx = null;
    this.master = null;
    this.reverb = null;
    this.limiter = null;
    this.shepard = null;
    this.nodes = [];
  }

  StainAudio.prototype.ready = function () {
    if (this.ctx) {
      // Autoplay policy parks the context until something resumes it. The
      // appliance has no user gesture, so resume on every entry point.
      if (this.ctx.state === "suspended") { this.ctx.resume(); }
      return true;
    }
    if (!AudioCtx) { return false; }
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.78;
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -7;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 16;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.19;
    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
    this.reverb = this._buildReverb();
    this.reverb.connect(this.master);
    if (this.ctx.state === "suspended") { this.ctx.resume(); }
    return true;
  };

  /* A plate-ish impulse response, generated rather than fetched: exponentially
   * decaying noise. Long enough that the horn sounds like it is in an empty
   * room nobody is in. */
  StainAudio.prototype._buildReverb = function () {
    var ctx = this.ctx;
    var seconds = 2.6;
    var length = Math.floor(ctx.sampleRate * seconds);
    var impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (var channel = 0; channel < 2; channel += 1) {
      var data = impulse.getChannelData(channel);
      for (var i = 0; i < length; i += 1) {
        var progress = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - progress, 2.6);
      }
    }
    var convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    var wet = ctx.createGain();
    wet.gain.value = 0.34;
    convolver.connect(wet);
    wet.connect(this.master);
    var send = ctx.createGain();
    send.connect(convolver);
    return send;
  };

  StainAudio.prototype._track = function (node) {
    this.nodes.push(node);
    return node;
  };

  StainAudio.prototype._distortionCurve = function (amount) {
    var samples = 2048;
    var curve = new Float32Array(samples);
    var drive = Math.max(1, amount || 1);
    for (var i = 0; i < samples; i += 1) {
      var x = i * 2 / (samples - 1) - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return curve;
  };

  /* Brass after the image starts bleeding. This is not a musical fanfare:
   * six horns disagree about pitch, smear through saturation, and collapse
   * downward at different rates while a sub voice bends underneath them. */
  StainAudio.prototype.horrorHorn = function (when, intensity, variation) {
    if (!this.ready()) { return; }
    var ctx = this.ctx;
    var at = when || ctx.currentTime;
    var force = Math.max(0.15, Math.min(1, intensity || 0.5));
    var turn = variation || 0;
    var length = 4.2 + force * 2.8;
    var bus = this._track(ctx.createGain());
    bus.gain.setValueAtTime(0.0001, at);
    bus.gain.exponentialRampToValueAtTime(0.11 + force * 0.17, at + 0.08);
    bus.gain.setValueAtTime(0.08 + force * 0.12, at + length * 0.72);
    bus.gain.exponentialRampToValueAtTime(0.0001, at + length);

    var crush = this._track(ctx.createWaveShaper());
    crush.curve = this._distortionCurve(2.8 + force * 8);
    crush.oversample = "4x";
    var throat = this._track(ctx.createBiquadFilter());
    throat.type = "bandpass";
    throat.frequency.setValueAtTime(780 - force * 260, at);
    throat.frequency.exponentialRampToValueAtTime(110, at + length);
    throat.Q.value = 1.8 + force * 5;
    bus.connect(crush);
    crush.connect(throat);
    throat.connect(this.master);
    throat.connect(this.reverb);

    var ratios = [1, 1.018, 0.971, 1.414, 1.489, 0.503];
    var root = 92.5 * Math.pow(2, (turn % 3) / 12);
    for (var i = 0; i < ratios.length; i += 1) {
      var osc = this._track(ctx.createOscillator());
      osc.type = i % 3 === 0 ? "sawtooth" : (i % 3 === 1 ? "square" : "triangle");
      var start = root * ratios[i] * (i > 2 ? 2 : 1);
      osc.frequency.setValueAtTime(start, at);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(22, start * (0.19 + i * 0.035)), at + length
      );
      osc.detune.setValueAtTime((i - 2.5) * 17, at);
      osc.detune.linearRampToValueAtTime((2.5 - i) * 54, at + length);
      var voice = this._track(ctx.createGain());
      voice.gain.value = i < 3 ? 0.18 : 0.09;
      osc.connect(voice);
      voice.connect(bus);
      osc.start(at);
      osc.stop(at + length + 0.04);
    }

    var sub = this._track(ctx.createOscillator());
    sub.type = "sine";
    sub.frequency.setValueAtTime(52, at);
    sub.frequency.exponentialRampToValueAtTime(24, at + length);
    var subGain = this._track(ctx.createGain());
    subGain.gain.setValueAtTime(0.0001, at);
    subGain.gain.exponentialRampToValueAtTime(0.22 * force, at + 0.06);
    subGain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    sub.connect(subGain);
    subGain.connect(this.master);
    sub.start(at);
    sub.stop(at + length + 0.04);
  };

  /* One synchronized step, heard as an army. A stereo buffer contains dozens
   * of slightly offset boot impacts; a low thud, heel crack, distant ranks and
   * room return make five moving drawings feel like thousands of bodies. */
  StainAudio.prototype.marchArmy = function (when, intensity, step) {
    if (!this.ready()) { return; }
    var ctx = this.ctx;
    var at = when || ctx.currentTime;
    var force = Math.max(0.12, Math.min(1, intensity || 0.5));
    var seconds = 0.48;
    var frames = Math.floor(ctx.sampleRate * seconds);
    var buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
    var ranks = 34;
    for (var channel = 0; channel < 2; channel += 1) {
      var data = buffer.getChannelData(channel);
      for (var rank = 0; rank < ranks; rank += 1) {
        var spread = rank < 8 ? 0.025 : 0.13;
        var offset = Math.floor((Math.random() * spread + rank * 0.0014) * ctx.sampleRate);
        var decay = 170 + Math.floor(Math.random() * 520);
        var weight = (rank < 8 ? 0.24 : 0.07) * (0.65 + Math.random() * 0.7);
        if ((rank + channel + (step || 0)) % 3 === 0) { weight *= 1.35; }
        for (var sample = 0; sample < decay && offset + sample < frames; sample += 1) {
          var envelope = Math.pow(1 - sample / decay, 2.4);
          data[offset + sample] += (Math.random() * 2 - 1) * envelope * weight;
        }
      }
    }
    var boots = this._track(ctx.createBufferSource());
    boots.buffer = buffer;
    var low = this._track(ctx.createBiquadFilter());
    low.type = "lowpass";
    low.frequency.value = 210 + force * 90;
    low.Q.value = 1.2;
    var bootGain = this._track(ctx.createGain());
    bootGain.gain.value = 0.18 + force * 0.34;
    boots.connect(low);
    low.connect(bootGain);
    bootGain.connect(this.master);
    bootGain.connect(this.reverb);
    boots.start(at);
    boots.stop(at + seconds);

    var heel = this._track(ctx.createBufferSource());
    heel.buffer = buffer;
    var high = this._track(ctx.createBiquadFilter());
    high.type = "bandpass";
    high.frequency.value = 1450 + ((step || 0) % 4) * 170;
    high.Q.value = 0.8;
    var heelGain = this._track(ctx.createGain());
    heelGain.gain.value = 0.08 + force * 0.12;
    heel.connect(high);
    high.connect(heelGain);
    heelGain.connect(this.master);
    heel.start(at + 0.008);
    heel.stop(at + seconds);

    var thud = this._track(ctx.createOscillator());
    thud.type = "sine";
    thud.frequency.setValueAtTime(68, at);
    thud.frequency.exponentialRampToValueAtTime(32, at + 0.22);
    var thudGain = this._track(ctx.createGain());
    thudGain.gain.setValueAtTime(0.0001, at);
    thudGain.gain.exponentialRampToValueAtTime(0.18 + force * 0.2, at + 0.008);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
    thud.connect(thudGain);
    thudGain.connect(this.master);
    thud.start(at);
    thud.stop(at + 0.3);
  };

  /* The sad horn.
   *
   * Deliberately bad: a detuned pair a few cents apart so it beats against
   * itself, a lowpass that kills anything triumphant, and a pitch envelope
   * that slides down and then sags an extra step at the end, as if the player
   * gave up mid-note. Cut off abruptly rather than released.
   */
  StainAudio.prototype.sadHorn = function (when, options) {
    if (!this.ready()) { return; }
    var ctx = this.ctx;
    var at = when || ctx.currentTime;
    var settings = options || {};
    var root = settings.root || 233.08; // Bb3, a horn's most defeated register
    var length = settings.length || 2.6;
    var level = settings.level === undefined ? 0.5 : settings.level;

    var bus = this._track(ctx.createGain());
    bus.gain.setValueAtTime(0.0001, at);
    bus.gain.exponentialRampToValueAtTime(level, at + 0.09);
    bus.gain.setValueAtTime(level, at + length * 0.55);
    bus.gain.exponentialRampToValueAtTime(level * 0.35, at + length * 0.92);
    // No release. It just stops, which is the joke.
    bus.gain.setValueAtTime(0.0001, at + length);

    var tone = this._track(ctx.createBiquadFilter());
    tone.type = "lowpass";
    tone.frequency.setValueAtTime(1500, at);
    tone.frequency.linearRampToValueAtTime(430, at + length);
    tone.Q.value = 6;

    bus.connect(tone);
    tone.connect(this.master);
    tone.connect(this.reverb);

    var detunes = [0, 9, -7];
    for (var i = 0; i < detunes.length; i += 1) {
      var osc = this._track(ctx.createOscillator());
      osc.type = i === 0 ? "sawtooth" : "triangle";
      osc.detune.value = detunes[i];
      osc.frequency.setValueAtTime(root, at);
      // Slide down a minor third, then sag a further semitone: the sound of
      // an instrument being lowered rather than played.
      osc.frequency.linearRampToValueAtTime(root * 0.84, at + length * 0.62);
      osc.frequency.linearRampToValueAtTime(root * 0.77, at + length * 0.97);
      var voice = this._track(ctx.createGain());
      voice.gain.value = i === 0 ? 0.6 : 0.24;
      osc.connect(voice);
      voice.connect(bus);
      osc.start(at);
      osc.stop(at + length + 0.05);
    }

    // Wobble, slightly too slow and too wide to pass as vibrato.
    var lfo = this._track(ctx.createOscillator());
    lfo.frequency.value = 4.7;
    var lfoGain = this._track(ctx.createGain());
    lfoGain.gain.value = 7;
    lfo.connect(lfoGain);
    lfoGain.connect(tone.detune);
    lfo.start(at);
    lfo.stop(at + length + 0.05);
  };

  /* The descent.
   *
   * Not a true Shepard tone. A real one uses octave-spaced partials all sliding
   * at the same rate under a fixed spectral window, and it resolves into a
   * clean illusion. This is asked to smear instead: each layer gets its own
   * detune AND its own descent rate, so they drift apart from one another and
   * the illusion keeps almost-forming and failing.
   */
  function ShepardStack(engine) {
    this.engine = engine;
    this.layers = [];
    this.bus = null;
  }

  ShepardStack.prototype.start = function (when) {
    var engine = this.engine;
    if (!engine.ready()) { return; }
    var ctx = engine.ctx;
    var at = when || ctx.currentTime;
    this.bus = engine._track(ctx.createGain());
    this.bus.gain.value = 0.0001;
    this.bus.connect(engine.master);
    this.bus.connect(engine.reverb);
    this.startedAt = at;
  };

  /* Each added layer is one more horn falling forever at its own speed. */
  ShepardStack.prototype.addLayer = function (when, index) {
    var engine = this.engine;
    if (!engine.ready() || !this.bus) { return; }
    var ctx = engine.ctx;
    var at = when || ctx.currentTime;

    var top = 320 * Math.pow(2, (index % 3) * 0.34);
    // Uneven on purpose: rates are mutually irrational-ish so no two layers
    // ever line back up.
    var seconds = 15 + index * 4.3 + (index % 2 ? 2.7 : 0);
    var octaves = 3.2 + (index % 3) * 0.6;

    var osc = engine._track(ctx.createOscillator());
    osc.type = "sawtooth";
    osc.detune.value = (index % 2 ? 1 : -1) * (6 + index * 3.5);
    osc.frequency.setValueAtTime(top, at);

    var shape = engine._track(ctx.createBiquadFilter());
    shape.type = "lowpass";
    shape.frequency.value = 900;
    shape.Q.value = 3;

    var voice = engine._track(ctx.createGain());
    voice.gain.setValueAtTime(0.0001, at);
    voice.gain.exponentialRampToValueAtTime(0.17, at + 3.5);

    osc.connect(shape);
    shape.connect(voice);
    voice.connect(this.bus);
    osc.start(at);

    // Fall, snap silently back to the top, fall again. The re-arm is masked by
    // the other layers, which is the only part that behaves like a Shepard.
    var cycles = 40;
    for (var c = 0; c < cycles; c += 1) {
      var cycleStart = at + c * seconds;
      osc.frequency.setValueAtTime(top, cycleStart);
      osc.frequency.exponentialRampToValueAtTime(
        top / Math.pow(2, octaves),
        cycleStart + seconds
      );
    }
    this.layers.push({ osc: osc, gain: voice });
  };

  ShepardStack.prototype.swell = function (when, seconds, level) {
    if (!this.bus) { return; }
    var at = when || this.engine.ctx.currentTime;
    this.bus.gain.setValueAtTime(Math.max(this.bus.gain.value, 0.0001), at);
    this.bus.gain.exponentialRampToValueAtTime(level, at + seconds);
  };

  /* The anvil lands. Not a fade — a cut. */
  ShepardStack.prototype.kill = function (when) {
    if (!this.bus) { return; }
    var ctx = this.engine.ctx;
    var at = when || ctx.currentTime;
    this.bus.gain.cancelScheduledValues(at);
    this.bus.gain.setValueAtTime(this.bus.gain.value || 0.0001, at);
    this.bus.gain.linearRampToValueAtTime(0.0001, at + 0.04);
    for (var i = 0; i < this.layers.length; i += 1) {
      try { this.layers[i].osc.stop(at + 0.08); } catch (error) { /* already stopped */ }
    }
    this.layers = [];
  };

  StainAudio.prototype.createShepard = function () {
    this.shepard = new ShepardStack(this);
    return this.shepard;
  };

  /* One squelch. Bandpass-shaped noise with a pitch drop — the vowel of it is
   * entirely in the filter, which is what lets the chorus turn them into
   * voices later without changing the source. */
  StainAudio.prototype._squelch = function (at, formant, length, level, q) {
    var ctx = this.ctx;
    // A narrow bandpass on noise throws away most of the energy, which left
    // the chorus ~18dB under the horn — the payoff was inaudible after the
    // descent. Makeup restores it to the horn's register.
    level = level * SQUELCH_MAKEUP;
    var frames = Math.floor(ctx.sampleRate * length);
    var buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frames; i += 1) {
      var t = i / frames;
      // Brown-ish noise: wetter and heavier than white.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.4);
    }
    var source = this._track(ctx.createBufferSource());
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(1.5, at);
    source.playbackRate.exponentialRampToValueAtTime(0.55, at + length);

    var band = this._track(ctx.createBiquadFilter());
    band.type = "bandpass";
    band.frequency.setValueAtTime(formant, at);
    band.frequency.exponentialRampToValueAtTime(formant * 0.7, at + length);
    band.Q.value = q;

    var gain = this._track(ctx.createGain());
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);

    source.connect(band);
    band.connect(gain);
    gain.connect(this.master);
    gain.connect(this.reverb);
    source.start(at);
    source.stop(at + length + 0.05);
  };

  /* The chorus.
   *
   * Same generator throughout: only the scheduling and the filter Q change.
   * Chaos is random onsets on random formants at low Q. Beauty is the same
   * squelches quantised onto a slow grid, their formants snapped to a chord,
   * and Q raised until the band rings like a throat. Nothing is swapped out —
   * the farts become the choir.
   */
  StainAudio.prototype.fartChorus = function (when, seconds) {
    if (!this.ready()) { return; }
    var ctx = this.ctx;
    var at = when || ctx.currentTime;
    var chaos = seconds * 0.42;

    // Bb major over three octaves — the chord the squelches resolve onto.
    var chord = [116.5, 155.6, 233.1, 311.1, 466.2, 622.3];
    var cursor = 0;
    while (cursor < chaos) {
      // Ugly: anywhere in the spectrum, short, low Q, no rhythm.
      this._squelch(
        at + cursor,
        90 + Math.random() * 900,
        0.1 + Math.random() * 0.22,
        0.28 + Math.random() * 0.2,
        1.2 + Math.random() * 2
      );
      cursor += 0.04 + Math.random() * 0.13;
    }

    var beat = 0.5;
    var index = 0;
    cursor = chaos;
    while (cursor < seconds) {
      var progress = (cursor - chaos) / (seconds - chaos);
      // Onsets tighten onto the grid, Q climbs, notes lengthen into sustain.
      var jitter = (1 - progress) * 0.09;
      var note = chord[index % chord.length];
      this._squelch(
        at + cursor + (Math.random() - 0.5) * jitter,
        note,
        0.35 + progress * 1.5,
        0.16 + progress * 0.16,
        3 + progress * 26
      );
      if (progress > 0.45 && index % 2 === 0) {
        // Harmony arrives once they can hold a note.
        this._squelch(
          at + cursor,
          note * 1.5,
          0.45 + progress * 1.4,
          0.09 + progress * 0.12,
          6 + progress * 24
        );
      }
      cursor += beat;
      index += 1;
    }
  };

  StainAudio.prototype.silence = function (when) {
    if (!this.ctx) { return; }
    var at = when || this.ctx.currentTime;
    if (this.shepard) { this.shepard.kill(at); }
    this.master.gain.cancelScheduledValues(at);
    this.master.gain.setValueAtTime(this.master.gain.value, at);
    this.master.gain.linearRampToValueAtTime(0.0001, at + 0.25);
  };

  StainAudio.prototype.unsilence = function (when) {
    if (!this.ctx) { return; }
    var at = when || this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(at);
    this.master.gain.setValueAtTime(0.0001, at);
    this.master.gain.linearRampToValueAtTime(0.78, at + 0.6);
  };

  StainAudio.prototype.stop = function () {
    if (!this.ctx) { return; }
    var at = this.ctx.currentTime;
    if (this.shepard) { this.shepard.kill(at); }
    for (var i = 0; i < this.nodes.length; i += 1) {
      var node = this.nodes[i];
      try { if (node.stop) { node.stop(at); } } catch (error) { /* already stopped */ }
      try { node.disconnect(); } catch (error) { /* already gone */ }
    }
    this.nodes = [];
    if (this.master) {
      this.master.gain.cancelScheduledValues(at);
      this.master.gain.setValueAtTime(0.78, at);
    }
  };

  global.StainAudio = StainAudio;
  if (typeof module === "object" && module.exports) {
    module.exports = { StainAudio: StainAudio };
  }
})(typeof window === "undefined" ? this : window);
