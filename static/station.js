/* MADRiD TV Web: the shell. On the home station this work is split between
 * tv.js (the picture), overlay.js (bug, static burst, tuner OSD) and a phone
 * remote talking to a Python server. Here one page does all three: the dial
 * lives in the page, the state lives in MadridStationAPI, and the channel
 * modules are called with exactly the hooks tv.js used. */
(function () {
  "use strict";
  var API = window.MadridStationAPI;
  var state = API.state;
  var program = document.getElementById("program-area");
  var stage = document.getElementById("stage");
  var layers = document.querySelectorAll(".channel-layer");
  var clocks = document.querySelectorAll("[data-signal-clock]");
  var alarmClocks = document.querySelectorAll("[data-alarm-clock]");
  var weathers = document.querySelectorAll("[data-signal-weather]");
  var dial = [];
  var activeChannel = "";
  var activeState = null;
  var deck = null;

  /* ---- the dial ------------------------------------------------------- */
  function entry(target) {
    var key = String(target || "").trim();
    for (var i = 0; i < dial.length; i += 1) {
      if (dial[i].id === key || dial[i].number === key || dial[i].number === key.padStart(2, "0")) { return dial[i]; }
    }
    return null;
  }
  function tune(target, skipGate) {
    var next = entry(target);
    if (!next) { return false; }
    if (GATES[next.id] && !gateAccepted[next.id] && !skipGate) { showGate(next); return true; }
    if (skipGate) { gateAccepted[next.id] = true; }
    state.channel = next.id;
    state.channel_tuned_at = Date.now() / 1000;
    applyState(state);
    return true;
  }
  function step(delta) {
    var current = entry(state.channel);
    var index = current ? dial.indexOf(current) : 0;
    tune(dial[(index + delta + dial.length) % dial.length].id);
  }

  /* ---- a click-through for channels that flash and shout --------------- */
  var GATES = {stain: "FLASHING LIGHT \u00b7 LOUD SOUND"};
  var CAMERA_CHANNELS = {camera: true, drone: true, synth: true, playhouse: true, archive: true};
  var gateAccepted = {};
  function showGate(channel) {
    var old = document.getElementById("gate");
    if (old) { old.remove(); }
    var gate = document.createElement("div");
    gate.id = "gate"; gate.setAttribute("role", "dialog");
    gate.innerHTML = '<div class="gate-card"><b></b><span></span><div class="gate-actions"><button type="button" data-tune>TUNE IN</button><button type="button" data-stay>STAY</button></div></div>';
    gate.querySelector("b").textContent = "CH " + channel.number + "  " + channel.name;
    gate.querySelector("span").textContent = GATES[channel.id];
    gate.querySelector("[data-tune]").addEventListener("click", function () { gateAccepted[channel.id] = true; gate.remove(); tune(channel.id); });
    gate.querySelector("[data-stay]").addEventListener("click", function () { gate.remove(); renderDeck(); });
    document.body.appendChild(gate);
    gate.querySelector("[data-tune]").focus();
  }

  /* ---- layers (tv.js setLayer) ---------------------------------------- */
  function setLayer(name) {
    for (var i = 0; i < layers.length; i += 1) {
      layers[i].classList.toggle("is-active", layers[i].getAttribute("data-layer") === name);
    }
  }

  /* ---- a dial entry that only runs on the home station (home: true) --- */
  function renderHome(channel) {
    var kicker = document.querySelector("[data-home-kicker]"), name = document.querySelector("[data-home-name]");
    if (kicker) { kicker.textContent = "CH " + channel.number; }
    if (name) { name.textContent = channel.name; }
  }

  /* ---- CH 05 ALERT (tv.js renderAlert) ------------------------------- */
  var currentAlertText = null;
  function renderAlert(text) {
    if (text === currentAlertText) { return; }
    currentAlertText = text;
    var ribbons = document.getElementById("alert-ribbons");
    var empty = document.getElementById("alert-empty");
    if (ribbons) { ribbons.textContent = ""; }
    if (!text) {
      if (empty) { empty.style.display = "block"; }
    } else {
      if (empty) { empty.style.display = "none"; }
      for (var i = 0; i < 3; i++) {
        var div = document.createElement("div");
        div.textContent = text;
        if (ribbons) { ribbons.appendChild(div); }
      }
    }
  }

  /* ---- CH 13 ALARM (tv.js renderAlarm + bell) ------------------------ */
  var alarmAudioContext = null, alarmToneTimer = null, alarmToneStep = 0;
  function alarmDayLabel(days) {
    var names = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    if (!days || days.length === 7) { return "DAILY"; }
    if (days.join(",") === "0,1,2,3,4") { return "WEEKDAYS"; }
    return days.map(function (day) { return names[day]; }).join("·");
  }
  function ringAlarmPulse() {
    if (!alarmAudioContext) { return; }
    try {
      if (alarmAudioContext.state === "suspended") { alarmAudioContext.resume(); }
      var start = alarmAudioContext.currentTime;
      var frequencies = alarmToneStep % 2 ? [660, 990] : [880, 1320];
      for (var i = 0; i < frequencies.length; i += 1) {
        var oscillator = alarmAudioContext.createOscillator();
        var gain = alarmAudioContext.createGain();
        oscillator.type = i ? "square" : "triangle";
        oscillator.frequency.value = frequencies[i];
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(i ? 0.045 : 0.11, start + 0.015);
        gain.gain.setValueAtTime(i ? 0.045 : 0.11, start + 0.23);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
        oscillator.connect(gain);
        gain.connect(alarmAudioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.36);
      }
      alarmToneStep += 1;
    } catch (error) { /* the visual alarm still fires if audio is unavailable */ }
  }
  function startAlarmTone() {
    if (alarmToneTimer) { return; }
    try { alarmAudioContext = alarmAudioContext || new (window.AudioContext || window.webkitAudioContext)(); }
    catch (error) { return; }
    ringAlarmPulse();
    alarmToneTimer = window.setInterval(ringAlarmPulse, 620);
  }
  function stopAlarmTone() {
    if (alarmToneTimer) { window.clearInterval(alarmToneTimer); }
    alarmToneTimer = null;
    alarmToneStep = 0;
  }
  function renderAlarm(state) {
    var alarm = state.alarm || {};
    var ringing = alarm.ringing === true;
    var label = document.getElementById("alarm-label");
    var status = document.getElementById("alarm-state");
    var schedule = document.getElementById("alarm-schedule");
    var instruction = document.getElementById("alarm-instruction");
    if (label) { label.textContent = alarm.label || "WAKE UP"; }
    if (status) { status.textContent = ringing ? "ALARM TRANSMITTING" : (alarm.enabled ? "ALARM ARMED" : "ALARM STANDBY"); }
    if (schedule) { schedule.textContent = alarmDayLabel(alarm.days || []) + " / " + (alarm.time || "07:00"); }
    if (instruction) { instruction.textContent = ringing ? "SNOOZE OR DISMISS ON THE REMOTE" : "ARM OR TEST FROM THE REMOTE"; }
    document.body.classList.toggle("is-alarm-ringing", ringing);
    if (ringing && state.channel === "alarm") { startAlarmTone(); } else { stopAlarmTone(); }
  }

  /* ---- the overlay (overlay.js: bug, static burst, tuner OSD, hiss) -- */
  var overlay = (function () {
    var canvas = document.getElementById("static-burst");
    var context = canvas ? canvas.getContext("2d") : null;
    var osd = document.getElementById("channel-osd");
    var bug = document.getElementById("station-bug");
    var burstUntil = 0, burstFrame = null, osdTimer = null, audioCtx = null, lastTuned = null;
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function hiss(duration) {
      try {
        if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        if (audioCtx.state === "suspended") { audioCtx.resume(); }
        var length = Math.floor(audioCtx.sampleRate * duration);
        var buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
        var data = buffer.getChannelData(0);
        for (var i = 0; i < length; i += 1) { data[i] = (Math.random() * 2 - 1) * (1 - i / length); }
        var source = audioCtx.createBufferSource(); source.buffer = buffer;
        var gain = audioCtx.createGain(); gain.gain.value = 0.09;
        var filter = audioCtx.createBiquadFilter(); filter.type = "highpass"; filter.frequency.value = 900;
        source.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
        source.start();
      } catch (error) { /* silent burst */ }
    }
    function drawStatic() {
      var remaining = burstUntil - Date.now();
      if (remaining <= 0 || !context) { if (canvas) { canvas.style.opacity = "0"; } burstFrame = null; return; }
      canvas.style.opacity = Math.min(1, remaining / 220).toFixed(2);
      var image = context.createImageData(320, 240);
      var data = image.data;
      for (var i = 0; i < data.length; i += 4) {
        var value = (Math.random() * 255) | 0;
        data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      var tear = ((Date.now() % 320) / 320) * 240;
      context.fillStyle = "rgba(255,255,255,0.5)";
      context.fillRect(0, tear, 320, 6);
      burstFrame = window.requestAnimationFrame(drawStatic);
    }
    return {
      channelChanged: function (channel) {
        var quiet = !state.broadcast || state.broadcast.quiet !== false;
        burstUntil = Date.now() + (reducedMotion ? 0 : 240);
        if (!burstFrame && !reducedMotion) { drawStatic(); }
        if (!quiet && state.sound_enabled) { hiss(0.12); }
        if (osd) {
          osd.textContent = "CH " + channel.number + "  " + channel.name;
          osd.classList.add("is-shown");
          window.clearTimeout(osdTimer);
          osdTimer = window.setTimeout(function () { osd.classList.remove("is-shown"); }, 2600);
        }
        if (bug) { bug.classList.toggle("is-shown", channel.bug !== false && channel.id !== "off-air" && channel.id !== "alert"); }
        announce(channel, false);
      },
      boot: function (channel) {
        if (bug && channel) { bug.classList.toggle("is-shown", channel.bug !== false && channel.id !== "off-air" && channel.id !== "alert"); }
        if (channel) { announce(channel, true); }
      },
      tuned: function () { return lastTuned; }
    };
    // What is on air, for the marks (static/station-marks.js): the cyclone on OFF AIR and while tuning.
    function announce(channel, boot) {
      lastTuned = {id: channel.id, number: channel.number, bug: Boolean(bug && bug.classList.contains("is-shown")), boot: boot};
      window.dispatchEvent(new CustomEvent("madrid:tuned", {detail: lastTuned}));
    }
  }());

  /* ---- applyState (tv.js, the public subset) ------------------------- */
  function applyState(state) {
    if (window.MadridBroadcast) { window.MadridBroadcast.sync(state); }
    var channel = state.channel;
    var changed = channel !== activeChannel;
    if (state.weather) { for (var wi = 0; wi < weathers.length; wi += 1) { weathers[wi].textContent = state.weather.label; } }
    if (changed) {
      program.classList.add("is-switching");
      window.setTimeout(function () { program.classList.remove("is-switching"); }, 90);
      var current = entry(channel);
      if (activeChannel && current) { overlay.channelChanged(current); }
      if (window.MadridWebcam && window.MadridWebcam.dismiss) { window.MadridWebcam.dismiss(); }
      if (!CAMERA_CHANNELS[channel] && window.MadridWebcam && window.MadridWebcam.status().state === "live") { window.MadridWebcam.release(); }
      if (current) { try { history.replaceState(null, "", "#" + current.number); } catch (e) { /* file:// */ } }
      activeChannel = channel;
    }
    activeState = state;
    var here = entry(channel);
    if (here && here.home) { setLayer("home"); renderHome(here); }
    else if (channel === "archive") { setLayer("broadcast"); }   // CHANNEL DRIFT draws its other modes in the same layer
    else if (channel === "alarm") { setLayer("alarm"); renderAlarm(state); }
    else if (channel === "alert") { setLayer("alert"); renderAlert(state.alert_text); }
    else { setLayer(channel); }
    if (window.MadridStained2) { window.MadridStained2.sync(state); }
    if (window.MadridStain) { window.MadridStain.sync(state); }
    if (channel !== "alarm") { document.body.classList.remove("is-alarm-ringing"); stopAlarmTone(); }
    if (window.MadridPlayhouse && window.MadridPlayhouse.setActive) { window.MadridPlayhouse.setActive(channel === "playhouse", state); }
    if (window.MadridSynth && window.MadridSynth.setActive) { window.MadridSynth.setActive(channel === "synth", state.synth || {}); }
    if (window.SynthCapture && window.SynthCapture.sync) { window.SynthCapture.sync(state.synth_archive || {}, state.synth || {}, channel === "synth"); }
    if (window.MadridDrone) { window.MadridDrone.setActive(channel === "drone", state.drone, Object.assign({}, state.drone_runtime, {kinect: state.kinect})); }
    if (window.MadridAquarium) { window.MadridAquarium.setActive(channel === "aquarium", state); }
    if (window.MadridDikPix && window.MadridDikPix.setActive) { window.MadridDikPix.setActive(channel === "dikpix", state.dikpix || {}); }
    if (changed) { renderDeck(); }
  }

  /* ---- the heartbeat: the station re-sent state every 400 ms --------- */
  function heartbeat() {
    window.setTimeout(function () {
      state.server_time_ms = Date.now(); state.epoch = state.server_time_ms / 1000;
      if (window.MadridWebcam) { state.kinect = window.MadridWebcam.snapshot(); }
      applyState(state);
      heartbeat();
    }, activeChannel === "synth" ? 100 : 400);
  }
  function updateClock() {
    var now = new Date();
    function pad(value) { return value < 10 ? "0" + value : String(value); }
    var stamp = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
    for (var ci = 0; ci < clocks.length; ci += 1) { clocks[ci].textContent = stamp; }
    var alarmStamp = pad(now.getHours()) + ":" + pad(now.getMinutes());
    for (var ai = 0; ai < alarmClocks.length; ai += 1) { alarmClocks[ai].textContent = alarmStamp; }
  }

  /* ---- sound: browsers gate audio behind a gesture ------------------- */
  var contexts = API.audioContexts || [];
  var silenced = function (ctx) { return ctx.state !== "running" && ctx.state !== "closed"; };   // iOS parks a context in 'interrupted'
  /* ?mute opens the page held silent, for previews on a machine whose speakers are not yours (the
   * home Mini's are the living room's). A person's own press of SOUND, M or TAP FOR SOUND on this
   * page lifts it for the rest of this tab (a trusted event: a script's .click() or a paired phone
   * cannot). ?hardmute is the QA lock: nothing lifts it. */
  var LIFTED = "madrid-tv-sound-lifted";
  var query = new URLSearchParams(window.location.search);
  var hard = query.has("hardmute");
  var held = hard || query.has("mute");
  try { if (held && !hard && window.sessionStorage.getItem(LIFTED) === "1") { held = false; } } catch (e) { /* no storage: stays held */ }
  /* The phone app's TV output (window.MadridHost, role "output": EXTERNAL-DISPLAY-CONTRACT.md in
   * the native remote) is never touched: the phone decides sound through the app, whose media
   * policy needs no gesture here, and the remote drawer and every prompt stay off the picture. */
  var HOST = Boolean(window.MadridHost && window.MadridHost.version === 1 && window.MadridHost.role === "output");
  if (HOST) { document.body.classList.add("host-output"); }
  var hush = held ? window.setInterval(function () { Array.prototype.forEach.call(document.querySelectorAll("video, audio"), function (el) { el.muted = true; }); }, 500) : 0;
  function lift(event) {
    if (!held || hard || !event || event.isTrusted !== true) { return; }
    held = false; window.clearInterval(hush);
    try { window.sessionStorage.setItem(LIFTED, "1"); } catch (e) { /* lifted for this page only */ }
  }
  var muteSound = function () {
    state.sound_enabled = false;
    contexts.forEach(function (ctx) { if (ctx.state === "running") { ctx.suspend().catch(function () {}); } });
    document.body.classList.remove("sound-on");
  };
  var unlockSound = function () {
    if (held) { muteSound(); return; }
    state.sound_enabled = true;
    // iPhone: Web Audio follows the ring/silent switch unless the page plays as media (Safari 17+).
    try { if (navigator.audioSession) { navigator.audioSession.type = "playback"; } } catch (e) { /* older Safari */ }
    contexts.forEach(function (ctx) { if (silenced(ctx)) { ctx.resume().catch(function () {}); } });
    document.body.classList.add("sound-on");
  };
  /* A finger's pointerdown is not a user gesture to the browser (its pointerup is; a
   * mouse's pointerdown is), so a phone's first tap unlocks on the way up. The picture
   * carries a TAP FOR SOUND card until then, as the portable receiver did; while ?mute
   * holds, only the card or SOUND lifts it, so the card stays. */
  var firstGesture = HOST;
  var soundPrompt = document.createElement("button");
  soundPrompt.type = "button"; soundPrompt.id = "sound-prompt"; soundPrompt.textContent = "TAP FOR SOUND";
  soundPrompt.hidden = hard || HOST;
  soundPrompt.addEventListener("click", function (event) { lift(event); unlockSound(); soundPrompt.hidden = state.sound_enabled || hard; renderDeck(); });
  if (stage) { stage.appendChild(soundPrompt); }
  function onGesture(event) {
    if (firstGesture) { return; }
    if (event.type === "pointerdown" && event.pointerType && event.pointerType !== "mouse") { return; }
    firstGesture = true;
    if (held) { return; }
    soundPrompt.hidden = true;
    // The SOUND key's own click decides; unlocking here first made that click turn it straight off again.
    var onSoundKey = event.target && event.target.closest && event.target.closest("#deck-sound, #sound-prompt");
    if (!onSoundKey) { unlockSound(); renderDeck(); }
  }
  window.addEventListener("pointerdown", onGesture, true);
  window.addEventListener("pointerup", onGesture, true);
  window.addEventListener("keydown", onGesture, true);

  /* ---- fullscreen-first: the picture always fills the window, centred; the
   * remote is a drawer over it (closed until R, the handle, or a tap on it),
   * so opening it never shrinks the picture. */
  function fit() {
    if (!stage) { return; }
    var height = stage.clientHeight || window.innerHeight;
    var scale = Math.min(window.innerWidth / 1280, height / 720);
    stage.style.setProperty("--fit", scale.toFixed(4));
    stage.style.setProperty("--top", Math.max(0, Math.round((height - 720 * scale) / 2)) + "px");
  }
  function setDeck(open) {
    if (!deck || (open && HOST)) { return; }
    deck.classList.toggle("is-open", open);
    document.body.classList.toggle("deck-open", open);
    if (open) { var active = deck.querySelector(".deck-channel.is-active") || deck.querySelector("button"); if (active) { active.focus({preventScroll: true}); } }
  }
  function toggleFullscreen() {
    var el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    var request = el.requestFullscreen || el.webkitRequestFullscreen;
    var pending = request && request.call(el);
    if (pending && pending.catch) { pending.catch(function () {}); }
  }
  /* Idle for 3 s: the handle and the pointer leave the picture (station.css). */
  var idleTimer = null;
  function awake() {
    document.body.classList.remove("is-idle");
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(function () { document.body.classList.add("is-idle"); }, 3000);
  }
  ["pointermove", "pointerdown", "keydown", "touchstart"].forEach(function (type) { window.addEventListener(type, awake, {passive: true}); });

  /* ---- the remote, on the page --------------------------------------- */
  function buildDeck() {
    deck = document.getElementById("deck");
    if (!deck) { return; }
    deck.innerHTML = "";
    var dialEl = document.createElement("div"); dialEl.className = "deck-dial";
    dial.forEach(function (channel) {
      var button = document.createElement("button");
      button.type = "button"; button.className = "deck-channel"; button.dataset.channel = channel.id;
      button.innerHTML = "<b></b><span></span>";
      button.querySelector("b").textContent = channel.number;
      button.querySelector("span").textContent = channel.name;
      var tag = channel.home ? ["HOME", "on the home station only"] : channel.status === "soon" ? ["SOON", "coming soon"] : channel.camera ? ["CAM", "asks for your camera"] : null;
      if (tag) {
        var mark = document.createElement("i"); mark.className = "deck-tag"; mark.textContent = tag[0];
        button.appendChild(mark);
        button.setAttribute("aria-label", "CH " + channel.number + " " + channel.name + ", " + tag[1]);
      }
      button.addEventListener("click", function () { tune(channel.id); });
      dialEl.appendChild(button);
    });
    var panel = document.createElement("div"); panel.className = "deck-panel"; panel.id = "deck-panel";
    var actions = document.createElement("div"); actions.className = "deck-actions";
    [["deck-prev", "CH −", function () { step(-1); }],
     ["deck-next", "CH +", function () { step(1); }],
     ["deck-sound", "SOUND", function (event) { if (state.sound_enabled) { muteSound(); } else { lift(event); unlockSound(); soundPrompt.hidden = state.sound_enabled || hard; } renderDeck(); }],
     ["deck-full", "FULL SCREEN", toggleFullscreen],
     ["deck-hide", "HIDE REMOTE", function () { setDeck(false); }]
    ].forEach(function (spec) {
      // iPhone Safari has no element fullscreen; Add to Home Screen is its full screen (manifest.webmanifest).
      if (spec[0] === "deck-full" && !document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) { return; }
      var button = document.createElement("button");
      button.type = "button"; button.id = spec[0]; button.textContent = spec[1];
      button.addEventListener("click", spec[2]);
      actions.appendChild(button);
    });
    var keys = document.createElement("div"); keys.className = "deck-keys";
    keys.textContent = "0–9 TUNE · ↑ ↓ CH · M SOUND · F FULL SCREEN · R REMOTE";
    deck.appendChild(dialEl); deck.appendChild(panel); deck.appendChild(actions); deck.appendChild(keys);
    var handle = document.getElementById("deck-handle");
    if (handle) { handle.addEventListener("click", function () { setDeck(true); }); }
  }
  var mountedPanel = "";
  function renderDeck() {
    if (!deck) { return; }
    var current = entry(state.channel);
    Array.prototype.forEach.call(deck.querySelectorAll(".deck-channel"), function (button) {
      button.classList.toggle("is-active", Boolean(current) && button.dataset.channel === current.id);
    });
    var sound = document.getElementById("deck-sound");
    if (sound) { sound.classList.toggle("is-on", Boolean(state.sound_enabled)); sound.textContent = state.sound_enabled ? "SOUND ON" : "SOUND OFF"; }
    var panel = document.getElementById("deck-panel");
    if (!panel || !current) { return; }
    var spec = window.MadridDeck && window.MadridDeck.panels[current.id];
    if (mountedPanel === current.id) { return; }
    mountedPanel = current.id;
    panel.innerHTML = "";
    panel.hidden = !spec;
    document.body.classList.toggle("panel-channel", Boolean(spec));
    if (!spec) { return; }
    var title = document.createElement("div"); title.className = "deck-panel-title"; title.textContent = spec.title || ("CH " + current.number);
    panel.appendChild(title);
    var body = document.createElement("div"); body.className = "deck-panel-body"; panel.appendChild(body);
    try { spec.mount(body, deckApi); } catch (error) { body.textContent = "REMOTE PANEL UNAVAILABLE"; }
  }
  var deckApi = {
    post: function (path, body) {
      var encoded = body && typeof body !== "string" && !(body instanceof URLSearchParams) && !(typeof FormData !== "undefined" && body instanceof FormData) ? JSON.stringify(body) : body;
      var answer = API.handle("POST", path, encoded);
      API.emit();
      return Promise.resolve(answer ? answer.json : null);
    },
    get: function (path) { var answer = API.handle("GET", path); return Promise.resolve(answer ? answer.json : null); },
    state: function () { return state; },
    tune: tune,
    get webcam() { return window.MadridWebcam; }
  };

  /* ---- keyboard: a real TV remote -------------------------------------- */
  var typed = "", typedTimer = null;
  document.addEventListener("keydown", function (event) {
    var target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) { return; }
    if (event.metaKey || event.ctrlKey || event.altKey) { return; }
    if (/^[0-9]$/.test(event.key)) {
      typed += event.key;
      window.clearTimeout(typedTimer);
      if (typed.length >= 2) { tune(typed); typed = ""; }
      else { typedTimer = window.setTimeout(function () { tune(typed); typed = ""; }, 1200); }
      event.preventDefault();
    } else if (event.key === "ArrowUp" || event.key === "PageUp") { step(1); event.preventDefault(); }
    else if (event.key === "ArrowDown" || event.key === "PageDown") { step(-1); event.preventDefault(); }
    else if (event.key === "m" || event.key === "M") { if (state.sound_enabled) { muteSound(); } else { lift(event); unlockSound(); } renderDeck(); }
    else if (event.key === "r" || event.key === "R") { setDeck(!(deck && deck.classList.contains("is-open"))); }
    else if (event.key === "f" || event.key === "F") { toggleFullscreen(); }
    else if (event.key === "Escape") { setDeck(false); }
  });

  /* ---- boot ------------------------------------------------------------ */
  window.MadridShell = {tune: tune, step: step, renderDeck: renderDeck, dial: dial, state: state, fit: fit, setDeck: setDeck, tuned: overlay.tuned,
    deckOpen: function () { return Boolean(deck && deck.classList.contains("is-open")); },
    fullscreen: toggleFullscreen,
    // From a phone: on asks for sound, but only a tap on this screen can start it (soundReady says whether it has).
    sound: function (on) { if (on) { unlockSound(); } else { muteSound(); } renderDeck(); },
    soundReady: function () { return Boolean(state.sound_enabled && firstGesture && !held); }};
  window.MadridTVWeb = {
    tune: function (target, skipGate) { return tune(target, skipGate); },
    state: function () { var current = entry(state.channel); return {channel: state.channel, channelNumber: current ? current.number : null, sound: Boolean(state.sound_enabled)}; }
  };
  state.sound_enabled = false;
  /* ?dial=<name> previews channels.<name>.json (a proposed lineup) without touching the public dial. */
  var dialName = (new URLSearchParams(window.location.search).get("dial") || "").replace(/[^a-z0-9-]/g, "");
  fetch(dialName ? "channels." + dialName + ".json" : "channels.json", {cache: "no-store"}).then(function (r) { return r.json(); }).then(function (data) {
    dial.push.apply(dial, data.channels);
    state.channels = data.channels.map(function (c) { return {id: c.id, number: c.number, name: c.name}; });
    buildDeck();
    updateClock(); window.setInterval(updateClock, 1000);
    var wanted = (location.hash || "").replace("#", "");
    var start = entry(wanted) || entry("00");
    var gated = GATES[start.id] ? start : null;
    if (gated) { start = entry("00"); }
    state.channel = start.id;
    overlay.boot(start);
    applyState(state);
    API.subscribe(applyState);
    window.addEventListener("resize", fit);
    window.addEventListener("hashchange", function () { var next = entry((location.hash || "").replace("#", "")); if (next && next.id !== state.channel) { tune(next.id); } });
    window.addEventListener("load", function () { applyState(state); fit(); });
    fit();
    heartbeat();
    if (gated) { showGate(gated); }
  }).catch(function (error) {
    document.body.classList.add("no-dial");
    throw error;
  });
}());
