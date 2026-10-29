/* MADRiD TV Web: phones as the remote. The screen side of the site's relay (RELAY.md in the
 * site repository; mounted at /tv/relay/ only when the site turns it on) and of the iframe bridge
 * a host page may use. Every command, from the relay or the bridge, goes through apply() below:
 * a fixed set of kinds, and for "api" a fixed set of in-page channel calls answered by
 * MadridStationAPI, only while that channel is on air. Nothing is fetched on a phone's behalf.
 * A phone cannot unlock this screen's sound or full screen: browsers want a gesture on the
 * screen itself, so the screen keeps its own TAP FOR SOUND and the phone is told so.
 *
 *   MadridPair.open() / close() / revoke(id) / status()     (the remote drawer's PAIR PHONE)
 *   status().available: null until PAIR PHONE is pressed, then true (relay here) or false (none) */
(function (root) {
  "use strict";
  var API = root.MadridStationAPI, Shell = root.MadridShell;
  if (!API || !Shell) { return; }
  var BASE = "relay/";                                   // relative: /tv/relay/ on the site, absent elsewhere
  var KINDS = ["tune", "step", "key", "sound", "fullscreen", "controls", "api", "camera", "perform"];
  var HOST_ONLY = {camera: 1, perform: 1};             // the owner's phone app only, never a paired phone
  var KEYS = {up: 1, down: 1, left: 1, right: 1, ok: 1, back: 1, menu: 1, guide: 1, mute: 1, play: 1, pause: 1, info: 1};
  // In-page calls a phone may make, each only while its channel is on air: the calls the remote's
  // own channel panels make (static/deck/*), so a phone can run those panels. A path ending in "/"
  // is a prefix (the synth's and diK-pix's families).
  var CALLS = {
    "/api/radio/station": "nts", "/api/surface-command": "playhouse",
    "/api/alarm/snooze": "alarm", "/api/alarm/dismiss": "alarm", "/api/alarm/config": "alarm", "/api/alarm/test": "alarm",
    "/api/alert": "alert", "/api/alert/end": "alert",
    "/api/drone/node": "drone", "/api/drone/clear": "drone", "/api/drone/params": "drone",
    "/api/synth/": "synth", "/api/dikpix/": "dikpix",
    "/api/broadcast/preferences": "archive", "/api/drift/mode": "archive",
    "/api/camera/start": "camera", "/api/camera/stop": "camera"
  };
  var READS = {"/api/state": 1, "/api/radio": 1, "/api/drift": 1};   // GETs that only read
  function callChannel(path) {
    if (typeof path !== "string" || !/^\/api\/[a-z0-9\/-]{1,64}$/.test(path)) { return null; }
    if (CALLS[path]) { return CALLS[path]; }
    var prefix = Object.keys(CALLS).filter(function (k) { return k.slice(-1) === "/" && path.indexOf(k) === 0; })[0];
    return prefix ? CALLS[prefix] : null;
  }
  var perform = {blackout: false, before: null, locked: false};   // the owner's performance layer
  var plain = function (v) { return v !== null && typeof v === "object" && !Array.isArray(v); };

  function gateButton(which) { return document.querySelector("#gate [data-" + which + "]"); }
  function apply(kind, data) {
    if (KINDS.indexOf(kind) < 0) { return {ok: false, error: "unsupported"}; }
    if (!plain(data)) { return {ok: false, error: "bad-data"}; }
    if (kind === "tune") {
      if (typeof data.channel !== "string" || !/^[A-Za-z0-9-]{1,16}$/.test(data.channel)) { return {ok: false, error: "bad-channel"}; }
      return Shell.tune(data.channel) ? {ok: true} : {ok: false, error: "unknown-channel"};
    }
    if (kind === "step") {
      if (data.delta !== 1 && data.delta !== -1) { return {ok: false, error: "bad-delta"}; }
      Shell.step(data.delta); return {ok: true};
    }
    if (kind === "key") {
      if (!KEYS[data.key]) { return {ok: false, error: "bad-key"}; }
      if (data.down === false) { return {ok: true}; }              // presses only; nothing on this screen is held
      var key = data.key;
      if (key === "up") { Shell.step(1); }
      else if (key === "down") { Shell.step(-1); }
      else if (key === "left" || key === "right") {
        if (API.state.channel === "nts") { API.handle("POST", "/api/radio/station", JSON.stringify({step: key === "right" ? 1 : -1})); }
      }
      else if (key === "ok") { var tuneIn = gateButton("tune"); if (tuneIn) { tuneIn.click(); } }
      else if (key === "back") { var stay = gateButton("stay"); if (stay) { stay.click(); } else { Shell.setDeck(false); } }
      else if (key === "menu" || key === "guide") { Shell.setDeck(!Shell.deckOpen()); }
      else if (key === "mute") { Shell.sound(!API.state.sound_enabled); }
      return {ok: true};
    }
    if (kind === "sound") {
      if (typeof data.on !== "boolean") { return {ok: false, error: "bad-sound"}; }
      Shell.sound(data.on); return {ok: true};
    }
    if (kind === "fullscreen") { Shell.fullscreen(); return {ok: true}; }   // the browser may refuse without a tap on the screen
    if (kind === "controls") {
      if (typeof data.visible !== "boolean") { return {ok: false, error: "bad-controls"}; }
      Shell.setDeck(data.visible); return {ok: true};
    }
    if (kind === "camera") {                         // the phone app asks its own owner, on the phone
      if (typeof data.on !== "boolean" || !root.MadridWebcam) { return {ok: false, error: "bad-camera"}; }
      if (data.forget) { root.MadridWebcam.forget(); }
      if (data.on) { root.MadridWebcam.request("FROM THE PHONE"); } else { root.MadridWebcam.release(); }
      return {ok: true};
    }
    if (kind === "perform") {
      if (data.action === "blackout") {              // to OFF AIR and back to where it was
        perform.blackout = !perform.blackout;
        if (perform.blackout) { perform.before = API.state.channel; Shell.tune("00"); } else if (perform.before) { Shell.tune(perform.before); }
        return {ok: true};
      }
      if (data.action === "lock") { perform.locked = !perform.locked; return {ok: true}; }   // paired phones stop steering
      return {ok: false, error: "unsupported"};
    }
    // kind === "api"
    if (data.method === "GET") {
      if (!READS[data.path]) { return {ok: false, error: "not-allowed"}; }
      var read = API.handle("GET", data.path);
      return read && read.status === 200 ? {ok: true, json: read.json} : {ok: false, error: "refused"};
    }
    var channel = callChannel(data.path);
    if (!channel) { return {ok: false, error: "not-allowed"}; }
    if (API.state.channel !== channel) { return {ok: false, error: "not-on-air"}; }
    var body = data.body === undefined ? {} : data.body;
    if (!plain(body) || JSON.stringify(body).length > 16384) { return {ok: false, error: "bad-body"}; }
    var answer = API.handle("POST", data.path, JSON.stringify(body));
    API.emit();
    return answer && answer.status === 200 ? {ok: true, json: answer.json} : {ok: false, error: "refused"};
  }

  /* ---- what the phones see ------------------------------------------- */
  function snapshot() {
    var dial = Shell.dial.map(function (c) { return {id: c.id, number: c.number, name: c.name}; });
    var here = Shell.dial.filter(function (c) { return c.id === API.state.channel; })[0] || null;
    var panel = root.MadridDeck && here && root.MadridDeck.panels[here.id];
    var out = {channel: here && {id: here.id, number: here.number, name: here.name, network: here.network || ""}, dial: dial,
      sound: Boolean(API.state.sound_enabled), soundReady: Shell.soundReady(), controls: Shell.deckOpen(),
      fullscreen: Boolean(document.fullscreenElement || document.webkitFullscreenElement), gate: Boolean(document.getElementById("gate")),
      panel: panel ? {id: here.id, title: panel.title || ""} : null};
    if (here && here.id === "nts" && API.state.radio) { out.radio = {station: API.state.radio.station, name: API.state.radio.name, show: API.state.radio.show, stations: API.state.radio.stations}; }
    return out;
  }
  var lastState = "", lastHost = "", stateTimer = null;
  function watchState() {
    var now = JSON.stringify(snapshot());
    if (now === lastState && !host) { return; }
    var same = now === lastState;
    lastState = now;
    if (room && !same) { publish(now); }
    if (embedded && !same) { bridgeSend({op: "state", state: JSON.parse(now)}); }
    if (host) {
      var out = JSON.parse(now); out.title = "MADRiD TV"; out.ident = out.channel && {number: out.channel.number, name: out.channel.name};
      // the phone app runs the TV's own channel panels: they read the whole station state
      try { out.full = JSON.parse(JSON.stringify(API.state)); } catch (e) { out.full = null; }
      out.webcam = root.MadridWebcam ? root.MadridWebcam.status() : {state: "unavailable"};
      out.perform = {blackout: perform.blackout, locked: perform.locked};
      var text = JSON.stringify(out);
      if (text !== lastHost) { lastHost = text; host.post({type: "state", state: out}); }
    }
  }

  /* ---- the relay --------------------------------------------------------- */
  var room = null, since = 0, generation = 0, available = null, listeners = [], card = null, codeTimer = null;
  function store(key, value) { try { if (value === null) { root.sessionStorage.removeItem(key); } else { root.sessionStorage.setItem(key, value); } } catch (e) { /* this tab only */ } }
  function stored(key) { try { return root.sessionStorage.getItem(key); } catch (e) { return null; } }
  function displayId() {
    var id = stored("madrid-tv-display");
    if (!id) { id = (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : String(Math.random()).slice(2) + String(Date.now())).replace(/[^A-Za-z0-9-]/g, "").slice(0, 64); store("madrid-tv-display", id); }
    return id;
  }
  function call(method, path, body) {
    var headers = {"content-type": "application/json"};
    if (room && room.key) { headers.authorization = "Bearer " + room.key; }
    return root.fetch(BASE + path, {method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", credentials: "same-origin"})
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (json) { if (!r.ok) { var e = new Error(json.message || json.error || ("relay " + r.status)); e.status = r.status; throw e; } return json; }); });
  }
  function changed() { listeners.forEach(function (fn) { try { fn(status()); } catch (e) { /* listener */ } }); renderCard(); deckButton(); }
  /* PAIR PHONE in the remote drawer, only where the relay answers; PHONES · n once a room is open. */
  function deckButton() {
    var actions = document.querySelector("#deck .deck-actions"), button = document.getElementById("deck-pair");
    if (!actions) { return; }
    if (!button) {
      button = document.createElement("button"); button.type = "button"; button.id = "deck-pair";
      button.addEventListener("click", function () { open().catch(function () { deckButton(); }); });
      actions.insertBefore(button, document.getElementById("deck-hide"));
    }
    button.disabled = available === false;
    button.textContent = room ? "PHONES · " + room.controllers.length : available === false ? "NO PHONE PAIRING HERE" : "PAIR PHONE";
  }
  function status() { return {available: available, open: Boolean(room), code: room && room.code, codeExpiresAt: room && room.codeExpiresAt, controllers: room ? room.controllers : []}; }
  function publish(text) { call("POST", "display/state", {state: JSON.parse(text)}).catch(gone); }
  function gone(error) {
    if (!error || error.status !== 403) { return; }
    room = null; store("madrid-tv-room", null); generation += 1; changed();   // the room closed or expired: offer pairing again
  }
  // The relay keeps recent commands, so a reloaded tab must not take them again: the cursor of
  // the last batch taken is saved with the room key BEFORE the batch is applied (each command at
  // most once), and a tab with no saved cursor starts from a fresh baseline, dropping the backlog.
  function keepRoom() { if (room) { store("madrid-tv-room", JSON.stringify({key: room.key, since: since})); } }
  function poll(mine, baseline) {
    if (!room || mine !== generation) { return; }
    call("GET", "display/events?since=" + since + "&wait=" + (baseline ? 0 : 20000)).then(function (answer) {
      if (!room || mine !== generation) { return; }
      since = answer.seq; keepRoom(); room.controllers = answer.controllers || [];
      if (baseline) { lastState = ""; changed(); watchState(); poll(mine); return; }
      if (answer.code) { room.code = answer.code; room.codeExpiresAt = Date.now() + (answer.codeExpiresIn || 0) * 1000; }
      if (answer.room && answer.room.closed) { gone({status: 403}); return; }
      (answer.events || []).forEach(function (event) {
        if (event.kind === "joined" || event.kind === "left") { changed(); return; }
        if (perform.locked || HOST_ONLY[event.kind]) { return; }
        apply(event.kind, event.data || {});
      });
      if (answer.resync) { lastState = ""; }
      changed(); watchState();
      poll(mine);
    }).catch(function (error) {
      if (error.status === 403) { gone(error); return; }
      root.setTimeout(function () { poll(mine); }, 3000);        // the site restarted or the network dropped: try again
    });
  }
  function open() {
    if (room) { renderCard(true); return Promise.resolve(status()); }
    return call("POST", "rooms", {display: displayId(), name: "MADRiD TV"}).catch(function (error) {
      if (error.status === 404 || error.status === 405 || !error.status) { available = false; changed(); }   // no relay on this site
      throw error;
    }).then(function (answer) {
      available = true;
      room = {key: answer.displayKey, code: answer.code, codeExpiresAt: Date.now() + answer.codeExpiresIn * 1000, controllers: []};
      since = 0; keepRoom(); generation += 1; lastState = ""; poll(generation); watchState(); renderCard(true); changed();
      return status();
    });
  }
  function newCode() { return call("POST", "display/code", {}).then(function (a) { room.code = a.code; room.codeExpiresAt = Date.now() + a.codeExpiresIn * 1000; changed(); }).catch(gone); }
  function revoke(id) { return call("POST", "display/revoke", {controller: id}).then(function (a) { room.controllers = a.controllers || []; changed(); }).catch(gone); }
  function close() {
    if (!room) { return Promise.resolve(); }
    var done = call("POST", "display/close", {}).catch(function () {});
    room = null; store("madrid-tv-room", null); generation += 1; renderCard(false); changed();
    return done;
  }

  /* ---- the pairing card on the picture ------------------------------- */
  function phonePage(code) {
    var url = new URL("remote/", root.location.href); url.search = ""; url.hash = "code=" + code;   // the code rides in the fragment, never to a server
    return url.href;
  }
  function renderCard(show) {
    if (show === false) { if (card) { card.remove(); card = null; } root.clearInterval(codeTimer); return; }
    if (show === true && !card) {
      card = document.createElement("div"); card.id = "pair-card"; card.setAttribute("role", "dialog");
      card.innerHTML = '<div class="pair-box"><b>PHONE REMOTE</b><div class="pair-qr" aria-hidden="true"></div><strong data-code></strong><span data-url></span><div data-phones class="pair-phones"></div><div class="pair-actions"><button type="button" data-done>DONE</button><button type="button" data-end>END PAIRING</button></div></div>';
      card.querySelector("[data-done]").addEventListener("click", function () { renderCard(false); });
      card.querySelector("[data-end]").addEventListener("click", function () { close(); });
      document.body.appendChild(card);
      root.clearInterval(codeTimer);
      codeTimer = root.setInterval(function () { if (room && card && room.codeExpiresAt - Date.now() < 60000) { newCode(); } }, 15000);
    }
    if (!card || !room) { return; }
    var code = room.code || "";
    card.querySelector("[data-code]").textContent = code.length === 8 ? code.slice(0, 4) + "-" + code.slice(4) : code;
    card.querySelector("[data-url]").textContent = phonePage("").replace(/#code=$/, "");
    var phones = card.querySelector("[data-phones]"), listed = JSON.stringify(room.controllers);
    if (phones.dataset.listed !== listed) {
      phones.dataset.listed = listed; phones.textContent = "";
      room.controllers.forEach(function (c) {
        var row = document.createElement("span"), label = document.createElement("i"), drop = document.createElement("button");
        label.textContent = (c.name || "PHONE").toUpperCase() + (c.online === false ? " · AWAY" : "");
        drop.type = "button"; drop.textContent = "DISCONNECT"; drop.addEventListener("click", function () { revoke(c.id); });
        row.appendChild(label); row.appendChild(drop); phones.appendChild(row);
      });
    }
    var qr = card.querySelector(".pair-qr");
    if (qr.dataset.drawn !== code && root.qrcode) {
      qr.dataset.drawn = code;                            // not data-code: that names the code line above
      try { var q = root.qrcode(0, "M"); q.addData(phonePage(code)); q.make(); qr.innerHTML = q.createSvgTag({cellSize: 5, margin: 2, scalable: true}); } catch (e) { qr.textContent = ""; }
    }
  }

  /* ---- the iframe bridge (a host page holds the relay connection) ----- */
  var embedded = root.parent && root.parent !== root;
  function bridgeSend(message) {
    message.type = "madrid-tv"; message.v = 1;
    try { root.parent.postMessage(message, root.location.origin); } catch (e) { /* host gone */ }
  }
  if (embedded) {
    root.addEventListener("message", function (event) {
      var m = event.data;
      if (event.origin !== root.location.origin || event.source !== root.parent) { return; }
      if (!plain(m) || m.type !== "madrid-tv" || m.v !== 1 || m.op !== "command") { return; }
      var result = perform.locked || HOST_ONLY[m.kind] ? {ok: false, error: "locked"} : apply(String(m.kind), m.data || {});
      bridgeSend({op: "ack", seq: m.seq, ok: result.ok, error: result.error});
      watchState();
    });
    bridgeSend({op: "ready", kinds: KINDS.slice()});
  }

  /* ---- the phone app (window.MadridHost, role "output") ----------------
   * EXTERNAL-DISPLAY-CONTRACT.md in the native remote. The app's own controls send the same
   * kinds as a paired phone, through apply(); "visibility" is the app's own (backgrounded or back). */
  var host = root.MadridHost && root.MadridHost.version === 1 && root.MadridHost.role === "output" && typeof root.MadridHost.post === "function" ? root.MadridHost : null;
  if (host) {
    host.receive = function (message) {
      if (!plain(message)) { return {ok: false, error: "bad-message"}; }
      if (message.kind === "visibility") { return {ok: true}; }
      var result = apply(String(message.kind), plain(message.data) ? message.data : {});
      watchState();
      return result;
    };
    host.post({type: "ready", kinds: KINDS.slice()});
  }

  /* ---- a tab that paired before this reload keeps its room ----------------
   * No request is made on load otherwise: a site without the relay answers 404 and the
   * relay answers 403 to strangers, and either would land in the console of every visit.
   * The relay is first asked when someone presses PAIR PHONE. */
  (function resume() {
    var kept = null; try { kept = JSON.parse(stored("madrid-tv-room") || "null"); } catch (e) { kept = null; }
    if (kept && kept.key) {
      available = true; room = {key: kept.key, code: "", codeExpiresAt: 0, controllers: []};
      var cursor = typeof kept.since === "number" && kept.since >= 0;
      since = cursor ? kept.since : 0; generation += 1; lastState = "";
      poll(generation, !cursor);                          // no cursor: take the current sequence, apply nothing
    }
  }());

  stateTimer = root.setInterval(function () { watchState(); deckButton(); }, 500);
  root.MadridPair = {open: open, close: close, revoke: revoke, newCode: newCode, status: status, onChange: function (fn) { listeners.push(fn); }, apply: apply};
}(window));
