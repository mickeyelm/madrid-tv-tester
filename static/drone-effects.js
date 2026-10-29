(function (root) {
  "use strict";
  function bounded(value, low, high, fallback) {
    return Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
  }
  function settings(state, environment) {
    state = state || {};
    var delay = state.delay || {}, reverb = state.reverb || {};
    var amount = bounded(state.movement_fx, 0, 1, 0);
    // The zero branch is exact: sensor values cannot influence either baseline.
    var movement = amount === 0 ? 0 :
      amount * bounded(environment && environment.movementEnergy, 0, 1, 0);
    return {
      time: bounded(delay.time, .02, 2, .375),
      feedback: Math.min(.8, bounded(delay.feedback, 0, .8, .28) + movement * .12),
      tone: bounded(delay.tone, 80, 12000, 3200),
      delaySend: bounded(delay.send, 0, 1, 0),
      decay: bounded(reverb.decay, .1, 8, 2.6),
      damping: bounded(reverb.damping, 80, 12000, 4800),
      reverbSend: Math.min(1, bounded(reverb.send, 0, 1, .34) + movement * .16)
    };
  }
  function slew(param, value, ctx) {
    param.cancelScheduledValues(ctx.currentTime);
    param.setTargetAtTime(value, ctx.currentTime, .12);
  }
  function impulse(ctx, seconds) {
    var length = Math.ceil(ctx.sampleRate * seconds);
    var buffer = ctx.createBuffer(2, length, ctx.sampleRate), seed = 739;
    for (var c = 0; c < 2; c++) {
      var data = buffer.getChannelData(c);
      for (var i = 0; i < length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = (seed / 2147483648 - 1) * Math.exp(-7 * i / length);
      }
    }
    return buffer;
  }
  function create(ctx, input, output) {
    var send = ctx.createGain(), delay = ctx.createDelay(2);
    var tone = ctx.createBiquadFilter(), feedback = ctx.createGain();
    var delayWet = ctx.createGain(), reverbSend = ctx.createGain();
    var damping = ctx.createBiquadFilter(), reverb = ctx.createConvolver();
    var reverbWet = ctx.createGain(), dry = ctx.createGain();
    tone.type = damping.type = "lowpass";
    tone.Q.value = damping.Q.value = .5;
    dry.gain.value = .8; delayWet.gain.value = .22; reverbWet.gain.value = .3;
    send.gain.value = reverbSend.gain.value = feedback.gain.value = 0;
    input.connect(dry); dry.connect(output);
    input.connect(send); send.connect(delay); delay.connect(tone);
    tone.connect(feedback); feedback.connect(delay);
    tone.connect(delayWet); delayWet.connect(output);
    input.connect(reverbSend); reverbSend.connect(damping);
    damping.connect(reverb); reverb.connect(reverbWet); reverbWet.connect(output);
    var nodes = [send, delay, tone, feedback, delayWet, reverbSend, damping, reverb, reverbWet, dry];
    var decay = null, last = null;
    return {
      nodes: nodes, delay: delay, feedback: feedback,
      apply: function (state, environment) {
        var next = settings(state, environment);
        if (last && JSON.stringify(last) === JSON.stringify(next)) { return last; }
        slew(delay.delayTime, next.time, ctx); slew(feedback.gain, next.feedback, ctx);
        slew(tone.frequency, Math.min(ctx.sampleRate * .45, next.tone), ctx);
        slew(send.gain, next.delaySend, ctx);
        slew(damping.frequency, Math.min(ctx.sampleRate * .45, next.damping), ctx);
        slew(reverbSend.gain, next.reverbSend, ctx);
        if (decay !== next.decay) {
          reverb.buffer = impulse(ctx, next.decay); decay = next.decay;
        }
        last = next;
        return next;
      },
      dispose: function () {
        feedback.gain.cancelScheduledValues(ctx.currentTime);
        feedback.gain.value = 0;
        nodes.forEach(function (node) { node.disconnect(); });
        reverb.buffer = null;
      }
    };
  }
  var api = {settings: settings, create: create, bounded: bounded};
  root.DroneEffects = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
}(typeof window !== "undefined" ? window : this));
