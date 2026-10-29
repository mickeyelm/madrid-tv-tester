(function (root) {
  "use strict";
  var harmonics = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function compile(layer, profile, sampleRate) {
    var points = layer.points, count = points.length;
    if (!count || count > 128 || !Number.isFinite(sampleRate) || sampleRate < 8000) {
      throw new Error("invalid drone layer");
    }
    var x = 0, y = 0, distance = 0;
    points.forEach(function (point, i) {
      if (![point.x, point.y, point.t].every(Number.isFinite)) {
        throw new Error("invalid drone point");
      }
      x += point.x; y += point.y;
      if (i) { distance += Math.hypot(point.x - points[i-1].x, point.y - points[i-1].y); }
    });
    x /= count; y /= count;
    var duration = Math.max(0, points[count-1].t - points[0].t);
    var speed = distance / Math.max(.1, duration);
    var ratios = harmonics;
    if (profile && profile.root_hz > 0 && profile.peaks && profile.peaks.length) {
      ratios = profile.peaks.map(function (peak) { return peak.hz / profile.root_hz; })
        .filter(function (ratio) { return Number.isFinite(ratio) && ratio >= .5 && ratio <= 16; })
        .sort(function (a, b) { return a - b; });
      if (!ratios.length) { ratios = harmonics; }
    }
    var ratio = ratios[clamp(Math.round((1-y) * (ratios.length-1)), 0, ratios.length-1)];
    var brightness = layer.kind === "tap" ? .25 : clamp(.15 + speed * .35, .15, 1);
    var wave = new Float32Array(1024), modulation = new Float32Array(256);
    // Arc-index interpolation retains vertical strokes and folds without sorting x.
    function height(phase) {
      var at = phase * (count-1), index = Math.floor(at), blend = at-index;
      return points[index].y * (1-blend) + points[Math.min(count-1,index+1)].y * blend;
    }
    var maximum = 0, mean = 0;
    for (var i = 0; i < wave.length; i++) {
      var phase = i / wave.length, angle = phase * Math.PI * 2;
      var contour = (height(phase) - y) * 2;
      // Periodic sine carrier keeps endpoints continuous even for an open gesture.
      wave[i] = Math.sin(angle) + (layer.kind === "stroke" ?
        brightness * contour * Math.sin(angle * 2) +
        brightness * .2 * Math.sin(angle * 3) : 0);
      mean += wave[i] / wave.length;
    }
    for (i = 0; i < wave.length; i++) {
      wave[i] -= mean;
      maximum = Math.max(maximum, Math.abs(wave[i]));
    }
    for (i = 0; i < wave.length; i++) { wave[i] /= Math.max(1, maximum); }
    for (i = 0; i < modulation.length; i++) {
      modulation[i] = layer.kind === "tap" ? 0 :
        clamp((height(i / (modulation.length-1))-y) * 2, -1, 1);
    }
    return {
      id: layer.id, kind: layer.kind, wavetable: wave, modulation: modulation,
      rootRatio: ratio, pan: clamp(x * 2-1, -1, 1),
      attackSeconds: clamp(.6 / (1+speed), .04, .6),
      loopSeconds: clamp(duration || 2, .25, 8), brightness: brightness
    };
  }
  var api = {compile:compile};
  root.DroneLayerModel = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
}(typeof window !== "undefined" ? window : this));
