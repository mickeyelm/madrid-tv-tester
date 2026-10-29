/* MADRiD TV Web: CH 24 NTS RADIO. The station's NTS channel, rebuilt for a page: the stream
 * plays straight from the radio station to the visitor (radio.json; nothing relayed or stored)
 * and drives the station's own BIOSPHERE visual (static/tv-airplay-visual.mjs) with the audio
 * features tv-nts.mjs:101 computed: {rms, low, mid, high, spectrum, waveform}.
 *
 * Two players. "analysed" asks for CORS and feeds an AnalyserNode, so the picture follows the
 * music. A stream that refuses CORS cannot be analysed (the browser hands Web Audio silence),
 * so it plays on "direct" instead and the visual runs on a steady pulse; Safari always plays
 * direct, because WebKit routes live streams into Web Audio silently. The slate says PULSE
 * when the picture is not listening.
 *
 * In-page API (deck, keys, and the phone remote's allowlisted calls):
 *   POST /api/radio/station {id} or {step: 1|-1}     GET /api/radio */
(function (root) {
  "use strict";
  var api = root.MadridStationAPI;
  if (!api) { return; }
  var script = document.currentScript && document.currentScript.src;
  var VISUAL = script ? new URL("../tv-airplay-visual.mjs", script).href : "static/tv-airplay-visual.mjs";
  var SAFARI = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent);
  var stations = [], station = null, onAir = false, mode = "", status = "TUNING", show = "";
  var context = null, analyser = null, spectrum = null, waveform = null, silentSince = 0;
  var visual = null, visualLoading = null, frame = null, showTimer = null, retryTimer = null, failures = 0;
  api.defaults({radio: {station: "nts1", status: "TUNING", reactive: false, show: ""}});

  function el(id) { return document.getElementById(id); }
  function publish() {
    api.state.radio = {station: station ? station.id : "", name: station ? station.name : "", status: status, reactive: mode === "analysed", show: show,
      stations: stations.map(function (s) { return {id: s.id, name: s.name}; })};
    var slate = document.querySelector("#layer-nts .radio-slate");
    if (!slate) { return; }
    slate.querySelector("[data-radio-station]").textContent = station ? station.name : "";
    slate.querySelector("[data-radio-show]").textContent = show;
    slate.querySelector("[data-radio-status]").textContent = status + (onAir && mode !== "analysed" && status === "LIVE" ? " · PULSE" : "");
  }
  function players() { return {analysed: el("radio-analysed"), direct: el("radio-direct")}; }
  function silence() {
    var p = players();
    [p.analysed, p.direct].forEach(function (a) { if (a && a.getAttribute("src")) { a.pause(); a.removeAttribute("src"); a.load(); } });
  }
  function graph() {
    if (context) { return; }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) { return; }
    context = new AC();                                   // tracked by station-api.js: silent until SOUND is on
    analyser = context.createAnalyser(); analyser.fftSize = 1024;
    context.createMediaElementSource(players().analysed).connect(analyser);
    analyser.connect(context.destination);
    spectrum = new Uint8Array(analyser.frequencyBinCount); waveform = new Float32Array(analyser.fftSize);
  }
  function first() { return SAFARI || !root.AudioContext || (station && station.cors === false) ? "direct" : "analysed"; }
  function play(which) {
    var p = players(), audio = p[which];
    if (!audio || !station) { return; }
    mode = which; status = "TUNING"; publish();
    if (which === "analysed") { graph(); }
    audio.src = station.url; audio.load();
    audio.muted = api.state.sound_enabled !== true && which === "direct";
    var started = audio.play();
    if (started && started.catch) { started.catch(function () { /* muted autoplay refused or sound off: the next tap retries via sync */ }); }
  }
  function tuneStation(next) {
    if (!next) { return; }
    station = next; show = ""; failures = 0; silentSince = 0;
    try { root.localStorage.setItem("madrid-tv-radio", next.id); } catch (e) { /* this browser keeps nothing */ }
    if (onAir) { silence(); play(first()); nowPlaying(); }
    publish();
  }
  function retry() {
    if (retryTimer || !onAir) { return; }
    status = "RECONNECTING"; publish();
    retryTimer = root.setTimeout(function () { retryTimer = null; if (onAir) { silence(); play(mode || "analysed"); } }, Math.min(30000, 1500 * Math.pow(2, Math.min(failures++, 5))));
  }
  function wire() {
    var p = players();
    if (!p.analysed || p.analysed.__wired) { return; }
    p.analysed.__wired = true;
    // A stream that refuses CORS fails here at once: play it direct, with the pulse.
    p.analysed.addEventListener("error", function () { if (onAir && mode === "analysed" && p.analysed.getAttribute("src")) { silence(); play("direct"); } });
    p.direct.addEventListener("error", function () { if (onAir && mode === "direct" && p.direct.getAttribute("src")) { retry(); } });
    [p.analysed, p.direct].forEach(function (a) {
      a.addEventListener("playing", function () { if (onAir) { status = "LIVE"; failures = 0; publish(); } });
      a.addEventListener("ended", function () { if (onAir) { retry(); } });
    });
  }
  function nowPlaying() {
    root.clearTimeout(showTimer);
    if (!onAir || !station || !station.live) { show = ""; publish(); return; }
    var wanted = station;
    root.fetch(station.live.api, {cache: "no-store"}).then(function (r) { return r.json(); }).then(function (data) {
      if (wanted !== station) { return; }
      var live = (data.results || []).filter(function (r) { return String(r.channel_name) === wanted.live.channel; })[0];
      show = live && live.now && live.now.broadcast_title ? String(live.now.broadcast_title).toUpperCase().slice(0, 80) : "";
      publish();
    }).catch(function () { /* the show title is optional */ });
    showTimer = root.setTimeout(nowPlaying, 60000);
  }
  function features(now) {
    if (mode === "analysed" && analyser && context && context.state === "running") {
      analyser.getByteFrequencyData(spectrum); analyser.getFloatTimeDomainData(waveform);
      var sum = 0; for (var i = 0; i < waveform.length; i += 1) { sum += waveform[i] * waveform[i]; }
      var band = function (from, to) {
        var total = 0, count = 0;
        for (var b = Math.max(1, Math.floor(from * analyser.fftSize / context.sampleRate)); b < Math.min(spectrum.length, Math.ceil(to * analyser.fftSize / context.sampleRate)); b += 1) { total += spectrum[b] / 255; count += 1; }
        return total / Math.max(1, count);
      };
      var rms = Math.sqrt(sum / waveform.length);
      if (rms > 0.0005) { silentSince = 0; return {rms: rms, low: band(30, 250), mid: band(250, 3000), high: band(3000, 12000), spectrum: Array.from(spectrum, function (v) { return v / 255; }), waveform: Array.from(waveform)}; }
      if (!silentSince) { silentSince = now; }
    }
    // The pulse: a steady 120 bpm swell, so the picture keeps moving when it cannot listen.
    var t = now / 1000, beat = Math.pow(Math.max(0, Math.cos(t * Math.PI * 2)), 6);
    var rmsP = 0.08 + 0.12 * beat, spec = [], wave = [];
    for (var k = 0; k < 64; k += 1) { spec.push(Math.max(0, 0.5 * Math.exp(-k / 18) * (0.6 + 0.4 * beat) + 0.05 * Math.sin(t * 1.3 + k * 0.4))); }
    for (var w = 0; w < 256; w += 1) { wave.push(rmsP * Math.sin(w / 256 * Math.PI * 8 + t * 6)); }
    return {rms: rmsP, low: 0.2 + 0.5 * beat, mid: 0.25 + 0.1 * Math.sin(t * 0.7), high: 0.15 + 0.1 * Math.sin(t * 1.9), spectrum: spec, waveform: wave};
  }
  function loop(now) {
    frame = null;
    if (!onAir) { return; }
    if (visual) { try { visual.render(now, features(now)); } catch (e) { /* a lost GL context: the slate stays */ } }
    frame = root.requestAnimationFrame(loop);
  }
  function start() {
    wire();
    if (!visual && !visualLoading) {
      visualLoading = import(VISUAL).then(function (m) { visual = m.createMadridAirplayVisual(el("radio-visual")); }).catch(function () { visualLoading = null; });
    }
    if (!frame) { frame = root.requestAnimationFrame(loop); }
    if (!mode || (!players().analysed.getAttribute("src") && !players().direct.getAttribute("src"))) { play(first()); }
    nowPlaying();
  }
  function stop() {
    if (frame) { root.cancelAnimationFrame(frame); frame = null; }
    root.clearTimeout(showTimer); root.clearTimeout(retryTimer); retryTimer = null;
    silence(); mode = ""; status = "TUNING"; show = ""; publish();
  }
  function sync() {
    var want = api.state.channel === "nts";
    if (want !== onAir) { onAir = want; if (onAir) { start(); } else { stop(); } }
    var direct = players().direct;
    if (direct) { direct.muted = api.state.sound_enabled !== true; }
    if (onAir && mode && status !== "LIVE") {
      var a = players()[mode];
      if (a && a.paused && a.getAttribute("src")) { var p = a.play(); if (p && p.catch) { p.catch(function () {}); } }
    }
  }

  api.register("GET", "/api/radio", function () { return api.state.radio; });
  api.register("POST", "/api/radio/station", function (body) {
    if (!stations.length) { throw new Error("radio list not loaded"); }
    var next = null;
    if (typeof body.id === "string") { next = stations.filter(function (s) { return s.id === body.id; })[0]; if (!next) { throw new Error("unknown station"); } }
    else if (Number(body.step) === 1 || Number(body.step) === -1) { var i = stations.indexOf(station); next = stations[(i + Number(body.step) + stations.length) % stations.length]; }
    else { throw new Error("station id or step required"); }
    tuneStation(next);
    return api.state.radio;
  });

  root.fetch("radio.json", {cache: "no-store"}).then(function (r) { return r.json(); }).then(function (data) {
    stations = (data.stations || []).filter(function (s) { return s && typeof s.id === "string" && /^https:\/\//.test(s.url || ""); });
    var kept = null; try { kept = root.localStorage.getItem("madrid-tv-radio"); } catch (e) { /* none */ }
    station = stations.filter(function (s) { return s.id === kept; })[0] || stations.filter(function (s) { return s.id === data.default; })[0] || stations[0] || null;
    publish();
  }).catch(function (error) { if (root.console) { root.console.error("CH 24 radio list unavailable: " + (error && error.message || error)); } });

  // ← → change station while CH 24 is on air.
  document.addEventListener("keydown", function (event) {
    if (api.state.channel !== "nts" || event.metaKey || event.ctrlKey || event.altKey) { return; }
    var t = event.target; if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) { return; }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { api.handle("POST", "/api/radio/station", JSON.stringify({step: event.key === "ArrowRight" ? 1 : -1})); event.preventDefault(); }
  });
  ["click", "keydown"].forEach(function (type) { document.addEventListener(type, function () { root.setTimeout(sync, 0); }); });
  var timer = root.setInterval(sync, 400);
  if (timer && timer.unref) { timer.unref(); }
}(window));
