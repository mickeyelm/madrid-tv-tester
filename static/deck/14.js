/* MADRiD TV Web: CH 14 SYNTH VISIONS on the remote. The phone remote's synth
 * panel (remote.html #synth-panel 585-700, remote.js "CH 14 Omnichord+ decks"
 * 1846-2340) on the page: the same chord pads, quality bank, strumplate,
 * instrument row, kit, UNDO/CLEAR, auto rhythm, BPM/TAP and PULSE/IMAGE
 * MEMORY/BODY, posting to the same /api/synth/* paths. UNDO LAST carries the
 * station's ERASE hold gesture (synth-controls.js). Room seats, JAM/SAVED,
 * SING/BEATBOX and SAVE VISION are not here. */
(function (root) {
  "use strict";
  if (!root.MadridDeck) { return; }
  var REASON = "CH 14 SYNTH VISIONS WANTS YOUR CAMERA";
  var INSTRUMENTS = [["tape", "TAPE STRINGS"], ["organ", "ORGAN"], ["harp", "HARP"], ["keys", "FM KEYS"],
    ["bass", "MONO BASS"], ["brass", "BRASS"], ["vox", "VOX PAD"]];
  var CHORDS = [["C", "MAJOR", "maj"], ["D", "MINOR", "min"], ["E", "MINOR", "min"], ["F", "MAJOR", "maj"],
    ["G", "SEVEN", "7"], ["A", "MINOR", "min"], ["B♭", "MAJOR", "maj"], ["A♭", "GHOST", "ghost"]];
  var QUALITIES = ["auto", "maj", "min", "7", "sus", "ghost"];
  var RHYTHMS = ["off", "train", "waltz", "bossa", "rock"];
  var LANES = ["kick", "snare", "hat", "clap"];

  function clientId() {          // remote.js synthClientIdentity, without localStorage
    var bytes = new Uint8Array(12), id = "room-";
    if (root.crypto && root.crypto.getRandomValues) { root.crypto.getRandomValues(bytes); }
    else { for (var i = 0; i < bytes.length; i += 1) { bytes[i] = Math.floor(Math.random() * 256); } }
    for (var j = 0; j < bytes.length; j += 1) { id += bytes[j].toString(16).padStart(2, "0"); }
    return id;
  }
  var client = clientId();         // one identity for the page: remounts on return to CH 14 keep the same seat
  function pad2(n) { return String(n).padStart(2, "0"); }
  function buttons(list, attr, label) {
    return list.map(function (item, index) {
      var value = Array.isArray(item) ? item[0] : item;
      return '<button type="button" ' + attr + '="' + value + '"' + (index === 0 && attr !== "data-synth-drum" ? ' class="is-active"' : "") + ">" + label(item, index) + "</button>";
    }).join("");
  }
  function markup() {
    return '<div class="synth-remote">' +
      '<header class="synth-remote-head"><div><span>CH</span><strong>14</strong></div><h2>ROOM<br>SYNTH</h2></header>' +
      '<section class="synth-transport-strip"><div><span>LOOP / 32</span><strong data-beat>00.0</strong><span data-bpm-label>112 BPM</span></div>' +
        '<div class="synth-beat-rail" aria-label="32 beat loop"></div></section>' +
      '<div class="synth-jam-status" aria-live="polite">TAP A CHORD. SWIPE THE ORANGE STRIP.</div>' +
      '<div class="synth-deck-label">01 / PICK A CHORD</div>' +
      '<section class="synth-chord-grid" aria-label="Chord roots">' +
        CHORDS.map(function (c, i) { return '<button type="button" data-synth-degree="' + i + '" data-synth-default-quality="' + c[2] + '"><span>' + pad2(i + 1) + "</span><strong>" + c[0] + "</strong><small>" + c[1] + "</small></button>"; }).join("") +
      "</section>" +
      '<section class="synth-quality-bank" aria-label="Chord quality override">' + buttons(QUALITIES, "data-synth-quality", function (q) { return q.toUpperCase(); }) + "</section>" +
      '<div class="synth-deck-label">02 / SWIPE TO PLAY</div>' +
      '<div class="synth-strum" aria-label="Strumplate"><span class="synth-strum-hint">SWIPE ANY DIRECTION</span></div>' +
      '<section class="synth-instrument-row" aria-label="Instrument">' +
        '<button type="button" data-instrument-step="-1">&#9664;</button><strong data-instrument-label>TAPE STRINGS</strong>' +
        '<button type="button" data-instrument-step="1">&#9654;</button><button type="button" data-strum-record aria-pressed="false">LOOP: OFF</button></section>' +
      '<div class="synth-deck-label">03 / ADD A BEAT</div>' +
      '<section class="synth-kit-row" aria-label="Drum kit">' + buttons(LANES, "data-synth-drum", function (l) { return l.toUpperCase(); }) + "</section>" +
      '<div class="synth-bottom-row synth-jam-actions"><button type="button" data-synth-erase>UNDO LAST</button><button type="button" data-synth-clear>CLEAR LOOP</button></div>' +
      '<details class="synth-tools"><summary>OPEN SOUND + LOOP TOOLS</summary>' +
        '<div class="synth-deck-label">AUTO RHYTHM</div>' +
        '<section class="synth-rhythm-row" aria-label="Auto rhythm">' + buttons(RHYTHMS, "data-synth-rhythm", function (r) { return r.toUpperCase(); }) + "</section>" +
        '<section class="synth-bpm-row" aria-label="Tempo"><label class="synth-bpm-slider"><span>BPM</span><input data-synth-bpm type="range" min="50" max="140" step="1" value="112"><output data-synth-bpm-value>112</output></label>' +
          '<button type="button" data-tap-tempo>TAP</button></section>' +
        '<div class="synth-deck-label">PICTURE / GROOVE</div>' +
        '<section class="synth-expression">' +
          '<label class="synth-vertical"><span>PULSE</span><input data-synth-param="pulse" type="range" min="0" max="100" value="0"><output>00</output></label>' +
          '<label class="synth-signal"><span>IMAGE MEMORY</span><input data-synth-param="signal" type="range" min="0" max="100" value="100"><output>100</output><small>VISUAL ONLY / AUDIO STAYS CLEAN</small></label>' +
        "</section>" +
        '<section class="synth-body-row"><label><span>BODY</span><input data-synth-param="body" type="range" min="0" max="100" value="0"><output>00</output></label>' +
          '<button type="button" data-camera>USE CAMERA</button></section>' +
      "</details>" +
      '<div class="synth-event-count" data-event-count>00 EVENTS / LOOP</div>' +
    "</div>";
  }

  root.MadridDeck.register("synth", {
    title: "CH 14 / SYNTH VISIONS",
    mount: function (el, api) {
      el.innerHTML = markup();
      var q = function (sel) { return el.querySelector(sel); };
      var all = function (sel) { return Array.prototype.slice.call(el.querySelectorAll(sel)); };
      var status = q(".synth-jam-status");
      var lastChord = {degree: 0, quality: "default"};
      var quality = "auto", recording = false, pending = {}, joinedAt = 0;
      function say(text) { status.textContent = text; }
      function synth() { return api.state().synth || {}; }
      function bpm() { var t = synth().tempo; return t && t.bpm ? t.bpm : 63; }
      function nowBeat() {               // remote.js synthNowBeat, same clock as the page
        var t = synth().tempo, epoch = Date.now() / 1000;
        if (!t || !t.bpm) { return (epoch * 63 / 60) % 32; }
        var absolute = t.paused ? t.anchor_beat : t.anchor_beat + (epoch - t.anchor_epoch) * t.bpm / 60;
        return ((absolute % 32) + 32) % 32;
      }
      function post(path, body) {
        body = body || {}; body.client = client;
        return Promise.resolve(api.post(path, body)).then(function (json) {
          if (json && json.error) { say(String(json.error).toUpperCase()); }   // a refused post is not a success
          return json;
        }).catch(function () { /* fire and forget, like the phone */ });
      }
      function hit(button) { button.classList.add("is-hit"); root.setTimeout(function () { button.classList.remove("is-hit"); }, 110); }
      function setQuality(next) {
        quality = next;
        all("[data-synth-quality]").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-synth-quality") === next); });
      }

      // 01 / PICK A CHORD
      all("[data-synth-degree]").forEach(function (button) {
        button.addEventListener("click", function () {
          hit(button);
          var chosen = quality === "auto" ? button.getAttribute("data-synth-default-quality") : quality;
          lastChord = {degree: Number(button.getAttribute("data-synth-degree")), quality: chosen};
          post("/api/synth/chord", {degree: lastChord.degree, quality: chosen});
          say("CHORD ADDED / SWIPE TO PLAY IT NOW");
          setQuality("auto");
        });
      });
      all("[data-synth-quality]").forEach(function (button) {
        button.addEventListener("click", function () { setQuality(button.getAttribute("data-synth-quality")); });
      });

      // 02 / SWIPE TO PLAY: the gesture trace accumulates; every ~90 ms newly crossed zones flush as ONE strum post.
      var plate = q(".synth-strum"), trace = [], sent = 0, notes = [], flushTimer = null;
      function plateX(event) { var r = plate.getBoundingClientRect(); return Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)); }
      function flushStrum() {
        var plucks = root.SynthStrum.plucksForTrace(notes, trace);
        if (plucks.length <= sent) { return; }
        var fresh = plucks.slice(sent), base = fresh[0].offsetSeconds;
        sent = plucks.length;
        post("/api/synth/strum", {record: recording ? "1" : "0", data: JSON.stringify(fresh.map(function (p) {
          return {note: p.note, velocity: p.velocity, offset: Math.max(0, (p.offsetSeconds - base) * bpm() / 60)};
        }))});
      }
      function endStrum() {
        if (!trace.length) { return; }
        flushStrum(); trace = []; sent = 0;
        plate.classList.remove("is-touched");
        if (flushTimer) { root.clearInterval(flushTimer); flushTimer = null; }
      }
      plate.addEventListener("pointerdown", function (event) {
        if (!root.SynthStrum) { return; }
        try { plate.setPointerCapture(event.pointerId); } catch (e) { /* no capture */ }
        notes = root.SynthStrum.ladder(lastChord.degree, lastChord.quality);
        trace = [{x: plateX(event), t: Date.now()}]; sent = 0;
        plate.classList.add("is-touched");
        if (!flushTimer) { flushTimer = root.setInterval(flushStrum, 90); }
      });
      plate.addEventListener("pointermove", function (event) { if (trace.length) { trace.push({x: plateX(event), t: Date.now()}); event.preventDefault(); } });
      plate.addEventListener("pointerup", endStrum);
      plate.addEventListener("pointercancel", endStrum);

      all("[data-instrument-step]").forEach(function (button) {
        button.addEventListener("click", function () {
          var index = 0, current = synth().instrument || "tape";
          INSTRUMENTS.forEach(function (item, i) { if (item[0] === current) { index = i; } });
          var next = INSTRUMENTS[(index + Number(button.getAttribute("data-instrument-step")) + INSTRUMENTS.length) % INSTRUMENTS.length];
          post("/api/synth/instrument", {instrument: next[0]});
        });
      });
      var record = q("[data-strum-record]");
      record.addEventListener("click", function () {
        recording = !recording;
        record.classList.toggle("is-active", recording);
        record.setAttribute("aria-pressed", String(recording));
        record.textContent = recording ? "LOOP: ON" : "LOOP: OFF";
      });

      // 03 / ADD A BEAT
      all("[data-synth-drum]").forEach(function (button) {
        button.addEventListener("click", function () {
          hit(button);
          post("/api/synth/strum", {record: "1", data: JSON.stringify([{lane: button.getAttribute("data-synth-drum"), velocity: 0.9}])});
        });
      });

      // UNDO LAST carries the ERASE key gesture: tap undoes one, hold repeats, three seconds clears.
      var erase = q("[data-synth-erase]"), clear = q("[data-synth-clear]"), clearArmedAt = 0;
      function sendErase() { post("/api/synth/erase"); say("LAST EVENT REMOVED"); }
      function sendClear() { post("/api/synth/clear"); say("LOOP CLEARED / START SOMETHING NEW"); }
      if (root.SynthControls) {
        var gesture = root.SynthControls.createEraseGesture(root, {erase: sendErase, clear: sendClear});
        erase.addEventListener("pointerdown", function (event) { try { erase.setPointerCapture(event.pointerId); } catch (e) { /* no capture */ } gesture.down(); });
        erase.addEventListener("pointerup", function () { gesture.up(); });
        erase.addEventListener("pointercancel", function () { gesture.cancel(); });
        erase.addEventListener("contextmenu", function (event) { event.preventDefault(); });
      } else { erase.addEventListener("click", sendErase); }
      clear.addEventListener("click", function () {
        var now = Date.now();
        if (now - clearArmedAt > 15000) {
          clearArmedAt = now;
          clear.classList.add("is-armed"); clear.textContent = "TAP AGAIN TO CLEAR";
          say("CLEAR IS ARMED / TAP AGAIN WITHIN 15 SECONDS");
          root.setTimeout(function () { if (Date.now() - clearArmedAt >= 14900) { clearArmedAt = 0; clear.classList.remove("is-armed"); clear.textContent = "CLEAR LOOP"; } }, 15000);
          return;
        }
        clearArmedAt = 0; clear.classList.remove("is-armed"); clear.textContent = "CLEAR LOOP";
        sendClear();
      });

      // SOUND + LOOP TOOLS
      all("[data-synth-rhythm]").forEach(function (button) {
        button.addEventListener("click", function () { post("/api/synth/rhythm", {preset: button.getAttribute("data-synth-rhythm")}); });
      });
      var bpmSlider = q("[data-synth-bpm]"), bpmValue = q("[data-synth-bpm-value]");
      bpmSlider.addEventListener("input", function () {
        bpmValue.textContent = bpmSlider.value;
        root.clearTimeout(pending.bpm);
        pending.bpm = root.setTimeout(function () { pending.bpm = null; post("/api/synth/bpm", {bpm: bpmSlider.value}); }, 220);
      });
      var taps = [];
      q("[data-tap-tempo]").addEventListener("click", function () {
        var now = Date.now();
        taps = taps.filter(function (t) { return now - t < 3000; }); taps.push(now);
        if (taps.length < 3) { return; }
        var intervals = [];
        for (var i = 1; i < taps.length; i += 1) { intervals.push(taps[i] - taps[i - 1]); }
        intervals.sort(function (a, b) { return a - b; });
        var tapped = Math.min(140, Math.max(50, Math.round(60000 / intervals[Math.floor(intervals.length / 2)])));
        bpmSlider.value = tapped; bpmValue.textContent = String(tapped);
        post("/api/synth/bpm", {bpm: tapped});
      });
      all("[data-synth-param]").forEach(function (input) {
        input.addEventListener("input", function () {
          input.nextElementSibling.textContent = pad2(Math.round(Number(input.value)));
          root.clearTimeout(pending.params);
          pending.params = root.setTimeout(function () {
            pending.params = null;
            var body = {};
            all("[data-synth-param]").forEach(function (item) { if (!item.disabled) { body[item.getAttribute("data-synth-param")] = Number(item.value) / 100; } });
            post("/api/synth/params", body);
          }, 120);
        });
      });

      // BODY from the camera: asked for here, never on tune.
      var camera = q("[data-camera]"), webcam = api.webcam || root.MadridWebcam;
      function cameraOn() { return Boolean(webcam) && synth().body_source === "camera" && webcam.status().state === "live"; }
      if (!webcam) { camera.disabled = true; }
      camera.addEventListener("click", function () {
        if (!webcam) { return; }
        if (cameraOn()) { post("/api/synth/body-source", {source: "slider"}); webcam.release(); return; }
        webcam.request(REASON).then(function (allowed) {
          if (allowed) { post("/api/synth/body-source", {source: "camera"}); say("BODY FOLLOWS YOUR CAMERA"); }
          else { say("CAMERA OFF / BODY STAYS ON THE SLIDER"); }
        });
      });

      // render (remote.js renderSynth, the loop parts)
      var beat = q("[data-beat]"), bpmLabel = q("[data-bpm-label]"), rail = q(".synth-beat-rail");
      var instrumentLabel = q("[data-instrument-label]"), eventCount = q("[data-event-count]");
      for (var r = 0; r < 32; r += 1) { rail.appendChild(document.createElement("i")); }
      function render() {
        if (!el.isConnected) { root.clearInterval(timer); endStrum(); return; }
        var state = api.state(), s = state.synth || {}, events = s.events || [], position = nowBeat();
        beat.textContent = position.toFixed(1).padStart(4, "0");
        Array.prototype.forEach.call(rail.children, function (cell, i) {
          cell.classList.toggle("is-head", i === Math.floor(position));
          cell.classList.toggle("is-event", events.some(function (e) { return Math.floor(e.beat) === i; }));
        });
        var found = INSTRUMENTS.filter(function (item) { return item[0] === (s.instrument || "tape"); })[0];
        instrumentLabel.textContent = found ? found[1] : "TAPE STRINGS";
        var tempo = Math.round(bpm());
        bpmLabel.textContent = tempo + " BPM";
        if (document.activeElement !== bpmSlider && !pending.bpm) { bpmSlider.value = tempo; bpmValue.textContent = String(tempo); }
        all("[data-synth-rhythm]").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-synth-rhythm") === (s.rhythm || "off")); });
        all("[data-synth-degree]").forEach(function (b) {
          var degree = Number(b.getAttribute("data-synth-degree"));
          b.classList.toggle("is-looped", events.some(function (e) { return e.degree === degree; }));
        });
        var live = cameraOn();
        all("[data-synth-param]").forEach(function (input) {
          var name = input.getAttribute("data-synth-param");
          if (name === "body") { input.disabled = live; }
          if (document.activeElement !== input && !pending.params) { input.value = Math.round(Number(s[name] || 0) * 100); }
          input.nextElementSibling.textContent = pad2(Math.round(Number(input.value)));
        });
        camera.textContent = live ? "STOP CAMERA" : "USE CAMERA";
        camera.classList.toggle("is-live", live);
        eventCount.textContent = pad2(events.length) + " EVENTS / LOOP";
        if (state.channel === "synth" && Date.now() - joinedAt > 5000) { joinedAt = Date.now(); post("/api/synth/join"); }
      }
      var timer = root.setInterval(render, 100);
      render();
    }
  });
}(window));
