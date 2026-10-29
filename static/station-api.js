/* MADRiD TV Web: the station server, in the page.
 * The home station's channel modules talk to a Python server at /api/... with
 * fetch and XMLHttpRequest. Here those requests never leave the page: this
 * module answers them from an in-page state store so the modules can stay
 * byte-for-byte copies. Load it before any channel module.
 *
 *   MadridStationAPI.state                      the live state object (what /api/state returns)
 *   MadridStationAPI.defaults({slice: {...}})   merge default state for a channel (deep for plain objects)
 *   MadridStationAPI.register(method, path, fn) fn(body, query, ctx) -> JSON; path is a string or RegExp;
 *                                               method 'GET' | 'POST' | 'ANY'; body is a plain object
 *   MadridStationAPI.emit()                     ask the shell to re-render from state (coalesced)
 *   MadridStationAPI.subscribe(fn)              fn(state) on every emit
 *   MadridStationAPI.now()                      seconds, the station's epoch clock
 *   MadridStationAPI.handle(method, url, body)  answer a request without the network ({status, json} or null)
 */
(function (root) {
  "use strict";
  var handlers = [];
  var subscribers = [];
  var pending = null;
  var state = {
    channel: "off-air", channels: [], epoch: Date.now() / 1000, server_time_ms: Date.now(),
    desktop_mode: false, surfaces: {}, weather: null, station: {host: "", port: 0, version: "web"},
    alert_mode: "ribbons", alert_text: "", alert_live_text: "",
    alarm: {enabled: false, ringing: false, label: "WAKE UP", time: "07:00", days: [1, 2, 3, 4, 5, 6, 0]},
    broadcast: {enabled: false, quiet: true, reduced_motion: false},
    programming: {}, sound_enabled: true
  };
  function isPlain(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function merge(target, source) {
    Object.keys(source).forEach(function (key) {
      if (isPlain(source[key]) && isPlain(target[key])) { merge(target[key], source[key]); }
      else if (!(key in target)) { target[key] = source[key]; }
    });
    return target;
  }
  function parseBody(body) {
    if (!body) { return {}; }
    if (typeof body === "string") {
      var trimmed = body.trim();
      if (trimmed[0] === "{" || trimmed[0] === "[") { try { return JSON.parse(trimmed); } catch (e) { return {}; } }
      var out = {}; new URLSearchParams(body).forEach(function (v, k) { out[k] = v; }); return out;
    }
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) { var o = {}; body.forEach(function (v, k) { o[k] = v; }); return o; }
    if (typeof FormData !== "undefined" && body instanceof FormData) { var f = {}; body.forEach(function (v, k) { f[k] = v; }); return f; }
    if (isPlain(body)) { return body; }
    return {};
  }
  function apiPath(url) {
    var u; try { u = new URL(url, root.location.href); } catch (e) { return null; }
    if (u.origin !== root.location.origin) { return null; }
    var i = u.pathname.indexOf("/api/");
    return i < 0 ? null : {path: u.pathname.slice(i), query: u.searchParams};
  }
  function find(method, path) {
    for (var i = handlers.length - 1; i >= 0; i -= 1) {
      var h = handlers[i];
      if (h.method !== method && h.method !== "ANY") { continue; }
      if (typeof h.path === "string" ? h.path === path : h.path.test(path)) { return h; }
    }
    return null;
  }
  function tick() { state.server_time_ms = Date.now(); state.epoch = state.server_time_ms / 1000; }
  function handle(method, url, body) {
    var target = apiPath(url);
    if (!target) { return null; }
    tick();
    var h = find(String(method || "GET").toUpperCase(), target.path);
    if (!h) { return {status: 404, json: {error: "not in the web edition", path: target.path}}; }
    try {
      var out = h.fn(parseBody(body), target.query, {state: state, emit: emit});
      return {status: 200, json: out === undefined ? {ok: true} : out};
    } catch (error) { return {status: 500, json: {error: String(error && error.message || error)}}; }
  }
  function emit() {
    if (pending) { return; }
    pending = root.setTimeout(function () { pending = null; tick(); subscribers.forEach(function (fn) { try { fn(state); } catch (e) { /* subscriber error */ } }); }, 0);
  }
  var api = {
    state: state,
    defaults: function (slice) { merge(state, slice); return state; },
    register: function (method, path, fn) { handlers.push({method: String(method).toUpperCase(), path: path, fn: fn}); },
    emit: emit,
    subscribe: function (fn) { subscribers.push(fn); },
    now: function () { return Date.now() / 1000; },
    handle: handle
  };
  api.register("GET", "/api/state", function () { return state; });
  api.register("GET", "/api/kinect", function () {
    if (root.MadridWebcam) { return root.MadridWebcam.snapshot(); }
    return {available: false, fresh: false, status: "no-camera"};
  });
  api.register("POST", "/api/channel", function (body) { if (body.channel) { state.channel = body.channel; emit(); } return state; });

  var realFetch = root.fetch ? root.fetch.bind(root) : null;
  if (realFetch) {
    root.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url);
      var method = (init && init.method) || (input && input.method) || "GET";
      var answer = handle(method, url, init && init.body);
      if (!answer) { return realFetch(input, init); }
      return Promise.resolve(new Response(JSON.stringify(answer.json), {status: answer.status, headers: {"content-type": "application/json"}}));
    };
  }
  var XHR = root.XMLHttpRequest;
  if (XHR) {
    var open = XHR.prototype.open, send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) { this.__madridRequest = {method: method, url: url}; return open.apply(this, arguments); };
    XHR.prototype.send = function (body) {
      var request = this.__madridRequest;
      var answer = request && handle(request.method, request.url, body);
      if (!answer) { return send.apply(this, arguments); }
      var xhr = this;
      var text = JSON.stringify(answer.json);
      Object.defineProperty(xhr, "readyState", {value: 4, configurable: true});
      Object.defineProperty(xhr, "status", {value: answer.status, configurable: true});
      Object.defineProperty(xhr, "statusText", {value: answer.status === 200 ? "OK" : "Error", configurable: true});
      Object.defineProperty(xhr, "responseText", {value: text, configurable: true});
      Object.defineProperty(xhr, "response", {value: text, configurable: true});
      root.setTimeout(function () {
        if (typeof xhr.onreadystatechange === "function") { xhr.onreadystatechange(new Event("readystatechange")); }
        xhr.dispatchEvent(new Event("readystatechange"));
        if (typeof xhr.onload === "function") { xhr.onload(new Event("load")); }
        xhr.dispatchEvent(new Event("load"));
        xhr.dispatchEvent(new Event("loadend"));
      }, 0);
    };
  }
  /* Browsers gate audio behind a gesture and the station's modules each make
   * their own AudioContext at load. Every context is tracked here, before any
   * module runs, so the shell can resume or suspend them all with one SOUND key. */
  var contexts = [];
  (function trackAudioContexts() {
    var Native = root.AudioContext || root.webkitAudioContext;
    if (!Native) { return; }
    var nativeResume = Native.prototype.resume;
    function Tracked() {
      var ctx = new (Function.prototype.bind.apply(Native, [null].concat(Array.prototype.slice.call(arguments))))();
      contexts.push(ctx);
      // A module may call resume() whenever it likes (the station had no gate); here it only takes while SOUND is on.
      ctx.resume = function () { return state.sound_enabled === true ? nativeResume.call(ctx) : Promise.resolve(); };
      if (state.sound_enabled !== true && ctx.state === "running" && ctx.suspend) { ctx.suspend().catch(function () {}); }
      return ctx;
    }
    Tracked.prototype = Native.prototype;
    root.AudioContext = Tracked;
    if (root.webkitAudioContext) { root.webkitAudioContext = Tracked; }
  }());
  api.audioContexts = contexts;
  root.MadridStationAPI = api;
}(window));
