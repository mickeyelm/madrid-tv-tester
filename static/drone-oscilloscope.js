(function (root) {
  "use strict";
  var WIDTH = 640, HEIGHT = 480;
  function frequencyX(hz) { return 44 + Math.log(Math.max(30, Math.min(12000, hz)) / 30) / Math.log(400) * 552; }
  function create(canvas) {
    canvas.width = WIDTH; canvas.height = HEIGHT;
    // Canvas is the baseline renderer as well as the GPU-independent fallback.
    // No WebGL context is needed, so unavailable/lost GPUs cannot stop the scope.
    var ctx = canvas.getContext("2d"), frames = 0;
    function clear() {
      if (!ctx) { return; }
      ctx.fillStyle = "#080d0c"; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    function trace(data, color, weight, gain) {
      if (!data || !data.length) { return; }
      // Trigger on a rising zero crossing, retaining actual samples unchanged.
      var start = 0;
      for (var i = 1; i < Math.min(data.length / 3, 256); i++) {
        if (data[i - 1] <= 0 && data[i] > 0) { start = i; break; }
      }
      var length = Math.min(data.length - start, 1024);
      ctx.strokeStyle = color; ctx.lineWidth = weight; ctx.beginPath();
      for (i = 0; i < length; i++) {
        var x = 32 + i / (length - 1) * 576;
        var y = 232 - Math.max(-1, Math.min(1, data[start + i] * gain)) * 142;
        if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
    }
    clear();
    return {
      mode: "canvas2d", clear: clear,
      inspect: function () { return {width: WIDTH, height: HEIGHT, frames: frames, mode: "canvas2d"}; },
      draw: function (reading) {
        if (!ctx) { return; }
        frames++;
        var env = reading.environment || {};
        var persistence = .2 + Math.max(0, Math.min(1, env.averageDepth || .5)) * .2;
        ctx.fillStyle = "rgba(8,13,12," + persistence + ")";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.lineWidth = .5; ctx.strokeStyle = "rgba(101,144,125,.14)";
        ctx.beginPath();
        for (var x = 32; x <= 608; x += 48) { ctx.moveTo(x, 82); ctx.lineTo(x, 374); }
        for (var y = 88; y <= 376; y += 48) { ctx.moveTo(32, y); ctx.lineTo(608, y); }
        ctx.stroke();
        var colors = ["rgba(124,168,223,.25)", "rgba(226,132,150,.22)", "rgba(160,212,119,.24)"];
        (reading.traces || []).slice(0, 40).forEach(function (layer, index) {
          trace(layer.data, colors[index % colors.length], .7, 3);
        });
        var main = reading.limiting ? "#ff7869" : reading.calibration ? "#f5ca72" : "#d0ffe0";
        ctx.shadowColor = main;
        ctx.shadowBlur = 5 + Math.min(1, env.movementEnergy || 0) * 7;
        trace(reading.waveform, main, 1.8, 2.3);
        ctx.shadowBlur = 0;
        // Spectrum has its own frequency axis; no pitch markers on the time trace.
        ctx.fillStyle = "#080d0c"; ctx.fillRect(32, 389, 576, 66);
        ctx.strokeStyle = "#50715e"; ctx.lineWidth = .5;
        ctx.beginPath(); ctx.moveTo(44, 437); ctx.lineTo(596, 437); ctx.stroke();
        var bins = reading.spectrum || [], rate = reading.sampleRate || 48000;
        ctx.fillStyle = "#6fbd96";
        for (var column = 0; column < 184; column++) {
          var hz = 30 * Math.pow(400, column / 183);
          var bin = Math.min(bins.length - 1, Math.round(hz / (rate / 2) * bins.length));
          var height = (bins[bin] || 0) / 255 * 34;
          ctx.fillRect(44 + column * 3, 437 - height, 2, height);
        }
        ctx.font = "9px monospace"; ctx.fillStyle = "#8ba197";
        [30, 100, 500, 2000, 12000].forEach(function (hz) {
          ctx.fillText(hz >= 1000 ? hz / 1000 + "k" : String(hz), frequencyX(hz) - 7, 450);
        });
        var peaks = reading.profile && reading.profile.peaks || [];
        if (reading.calibration && reading.calibration.peaks) { peaks = reading.calibration.peaks; }
        ctx.fillStyle = "#ebba78";
        peaks.slice(0, 12).forEach(function (peak) {
          var pos = frequencyX(peak.hz);
          ctx.fillRect(pos, 396, 1, 41); ctx.fillRect(pos - 2, 394, 5, 2);
        });
        if (reading.calibration) {
          var hzNow = reading.calibration.frequency_hz;
          if (Number.isFinite(hzNow)) {
            ctx.fillStyle = "#fff0bd"; ctx.fillRect(frequencyX(hzNow), 390, 2, 49);
          }
          ctx.fillStyle = "#f5ca72"; ctx.font = "11px monospace";
          var confidence = reading.calibration.confidence;
          ctx.fillText(String(reading.calibration.phase || "MEASURING").toUpperCase() +
            (Number.isFinite(confidence) ? "  " + Math.round(confidence * 100) + "%" : ""), 44, 70);
        }
      }
    };
  }
  var api = {create: create, frequencyX: frequencyX};
  root.DroneOscilloscope = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
}(typeof window !== "undefined" ? window : this));
