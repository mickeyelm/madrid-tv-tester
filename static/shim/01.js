/* MADRiD TV Web, CH 01 SIGNAL shim. Ports channel_weather.py + the server's
 * weather thread into the page: the station fetched Open-Meteo every 900 s,
 * cached <media_root>/weather.json, and set state["weather"] to the cache
 * snapshot on every /api/state. Here the cache is localStorage and the fetch
 * is the visitor's browser. The layer reads nothing else: state.channel is the
 * shell's, the clock is the shell's, there is no Kinect and no remote panel. */
(function (root) {
  "use strict";
  var API = root.MadridStationAPI;
  // channel_weather.py WEATHER_URL with the coordinate rounded to 2 decimals.
  var WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=40.70&longitude=-73.90" +
    "&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FNew_York";
  var REFRESH_SECONDS = 900;   // station: WEATHER_REFRESH_SECONDS = 900
  var FRESH_SECONDS = 21600;   // station: channel_weather.FRESH_SECONDS
  var CACHE_KEY = "madrid-tv.weather";
  // WeatherCache.snapshot builds a new dict each call; a shared constant would
  // keep anything a later defaults() merged into it.
  function offline() { return {available: false, label: "WEATHER --"}; }
  // channel_weather._condition_for_code; an unknown code fails the refresh
  // (the server raised ValueError) instead of throwing.
  var CONDITIONS = {
    0: "CLEAR", 1: "MOSTLY CLEAR", 2: "CLOUDY", 3: "CLOUDY", 45: "FOG", 48: "FOG",
    51: "DRIZZLE", 53: "DRIZZLE", 55: "DRIZZLE", 56: "DRIZZLE", 57: "DRIZZLE",
    61: "RAIN", 63: "RAIN", 65: "RAIN", 66: "RAIN", 67: "RAIN",
    71: "SNOW", 73: "SNOW", 75: "SNOW", 77: "SNOW", 85: "SNOW", 86: "SNOW",
    80: "SHOWERS", 81: "SHOWERS", 82: "SHOWERS", 95: "STORM", 96: "STORM", 99: "STORM"
  };
  function now() { return Date.now() / 1000; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function load() {
    var c;
    try { c = JSON.parse(root.localStorage.getItem(CACHE_KEY)); } catch (e) { return null; }
    if (!c || !isNum(c.fetched_epoch) || !isNum(c.temperature_f) || typeof c.condition !== "string" || typeof c.observed_at !== "string") { return null; }
    if (now() - c.fetched_epoch > FRESH_SECONDS) { return null; }
    return {fetched_epoch: c.fetched_epoch, temperature_f: c.temperature_f, condition: c.condition, observed_at: c.observed_at};
  }
  function save(v) { try { root.localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch (e) { /* no storage: label lives for this page only */ } }
  // channel_weather.normalize_weather; null where the server raised.
  function normalize(payload) {
    var cur = payload && payload.current;
    if (!cur || !isNum(cur.temperature_2m) || !isNum(cur.weather_code) || typeof cur.time !== "string" || !cur.time) { return null; }
    var condition = CONDITIONS[Math.round(cur.weather_code)];
    if (!condition) { return null; }
    return {temperature_f: Math.round(cur.temperature_2m), condition: condition, observed_at: cur.time};
  }
  // WeatherCache.snapshot
  var memory = null;  // last good normalized payload when localStorage is unavailable
  function snapshot() {
    var c = load() || (memory && now() - memory.fetched_epoch <= FRESH_SECONDS ? memory : null);
    if (!c) { return offline(); }
    var s = {}; Object.keys(c).forEach(function (k) { s[k] = c[k]; });
    s.available = true;
    s.label = s.temperature_f + "F " + s.condition;
    return s;
  }
  function publish() { API.state.weather = snapshot(); API.emit(); }
  // WeatherCache.refresh: any failure keeps the previous snapshot.
  function refresh() {
    var fetch = root.fetch;
    if (typeof fetch !== "function") { publish(); return; }
    var done = function () { publish(); };
    try {
      fetch(WEATHER_URL).then(function (r) { return r.ok ? r.json() : null; }).then(function (payload) {
        var n = normalize(payload);
        if (n) { n.fetched_epoch = now(); memory = n; save(n); }
      }).then(done, done);
    } catch (e) { done(); }
  }
  API.defaults({channel: "off-air", weather: offline()});
  publish();
  var cached = load();
  if (!cached || now() - cached.fetched_epoch >= REFRESH_SECONDS) { refresh(); }
  root.setInterval(refresh, REFRESH_SECONDS * 1000);
}(window));
