/* MADRiD TV Web: the TV's own channel panels (static/deck/*), on the phone. In the phone app the
 * TV picture is on the TV and every control is on the phone (EXTERNAL-DISPLAY-CONTRACT.md in the
 * native remote). This page (phone.html, MadridHost role "controls") runs the very panels the TV's
 * remote drawer runs, unchanged: their in-page station API here is a stand-in whose state is the
 * TV's (sent by the app with every change) and whose calls, including plain fetches to /api/...,
 * go to the TV through the app, where pair.js answers them under its allowlist: a channel's calls
 * only while that channel is on air. Nothing here makes sound.
 *
 *   MadridRemoteDeck.use(deliver)            deliver(kind, data) -> Promise(result), from remote.js
 *   MadridRemoteDeck.update(full, webcam)    the TV's station state and camera status
 *   MadridRemoteDeck.mount(el, channelId)    show that channel's panel in el */
(function (root) {
  "use strict";
  var host = root.MadridHost;
  if (!host || host.version !== 1 || host.role !== "controls") { return; }
  var subscribers = [], deliver = function () { return Promise.resolve({ok: false, error: "not-ready"}); };
  var station = {state: {}, subscribe: function (fn) { subscribers.push(fn); }, handle: function () { return null; },
    register: function () {}, defaults: function () {}, emit: function () {}, audioContexts: []};
  root.MadridStationAPI = station;
  function bodyOf(b) {
    if (b === undefined || b === null || b === "") { return {}; }
    if (typeof b === "string") { try { return JSON.parse(b); } catch (e) { var o = {}; new URLSearchParams(b).forEach(function (v, k) { o[k] = v; }); return o; } }
    if (typeof URLSearchParams !== "undefined" && b instanceof URLSearchParams) { var p = {}; b.forEach(function (v, k) { p[k] = v; }); return p; }
    return b;
  }
  function call(method, path, body) {
    return deliver("api", method === "GET" ? {path: path, method: "GET"} : {path: path, body: bodyOf(body)}).then(function (r) {
      if (!r || !r.ok) { var e = new Error((r && r.error) || "the TV did not take that"); e.result = r; throw e; }
      return r.json === undefined ? null : r.json;
    });
  }
  // The panels' own fetches to /api/... go to the TV too (diK-pix's paintbox talks that way).
  var nativeFetch = root.fetch && root.fetch.bind(root);
  root.fetch = function (input, init) {
    var url = new URL(typeof input === "string" ? input : input.url, root.location.href), at = url.pathname.indexOf("/api/");
    if (url.origin !== root.location.origin || at < 0) { return nativeFetch(input, init); }
    var method = (init && init.method || "GET").toUpperCase(), path = url.pathname.slice(at);
    return call(method, path, init && init.body).then(function (json) {
      return new Response(JSON.stringify(json === null ? {} : json), {status: 200, headers: {"content-type": "application/json"}});
    }, function (error) {
      return new Response(JSON.stringify({error: error.message}), {status: 403, headers: {"content-type": "application/json"}});
    });
  };
  var webcam = {state: "idle"};
  var deckApi = {
    post: function (path, body) { return call("POST", path, body); },
    get: function (path) { return call("GET", path); },
    state: function () { return station.state; },
    tune: function (id) { return deliver("tune", {channel: String(id)}); },
    webcam: {                                         // the camera is the phone's: the app asks, on the phone
      status: function () { return webcam; },
      request: function () { return deliver("camera", {on: true}).then(function (r) { return Boolean(r && r.ok); }); },
      release: function () { deliver("camera", {on: false}); },
      forget: function () { deliver("camera", {on: false, forget: true}); },
      onChange: function () {}
    }
  };
  var mounted = null;
  root.MadridRemoteDeck = {
    use: function (fn) { deliver = fn; },
    update: function (full, camera) {
      if (full && typeof full === "object") {
        Object.keys(station.state).forEach(function (k) { delete station.state[k]; });
        Object.assign(station.state, full);
      }
      if (camera) { webcam = camera; }
      subscribers.forEach(function (fn) { try { fn(station.state); } catch (e) { /* a panel's own trouble */ } });
    },
    mount: function (el, channelId) {
      if (mounted === channelId) { return; }
      mounted = channelId; el.innerHTML = "";
      var spec = root.MadridDeck && root.MadridDeck.panels[channelId];
      el.hidden = !spec;
      if (!spec) { return; }
      var title = document.createElement("div"); title.className = "deck-panel-title"; title.textContent = spec.title || "";
      var body = document.createElement("div"); body.className = "deck-panel-body";
      el.appendChild(title); el.appendChild(body);
      try { spec.mount(body, deckApi); } catch (e) { body.textContent = "THIS CHANNEL'S CONTROLS ARE NOT AVAILABLE"; }
    }
  };
}(window));
