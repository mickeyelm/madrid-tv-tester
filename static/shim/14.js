/* MADRiD TV Web: CH 14 SYNTH VISIONS, the station server's part.
 * Port of channel_core.py's synth store: constants (310-333),
 * synth_absolute_beat (342-351), _default_synth (820-835),
 * _normalize_synth_event (915-1030), the snapshot block (1293-1311),
 * the player seats (2627-2722), add_synth_chord (2723-2790),
 * erase/clear (2792-2809), set_synth_params/instrument/rhythm/bpm (2811-2878),
 * add_synth_layer (2885-2926), add_synth_strum (2928-3024) and
 * calibrate_synth_body (3031-3038), with channel_server.py's form parsing
 * (1961-2063) and the pocket_events reply shape (channel_synth_pocket.py:42-49).
 * The multi-phone room collapses to one visitor; the sampler, MIDI, the
 * capture archive and the pocket command set answer "disabled".
 * Load after static/station-api.js and before the synth modules. */
(function (root) {
  "use strict";
  var API = root.MadridStationAPI;
  if (!API) { return; }
  var S = API.state;

  var TOTAL_BEATS = 32, MAX_EVENTS = 32, MAX_LAYER_EVENTS = 256, MAX_LAYER_COMMIT = 64, DEGREE_COUNT = 8;
  var QUALITIES = ["default", "maj", "min", "7", "sus", "ghost"];
  var INSTRUMENTS = ["tape", "organ", "harp", "keys", "bass", "brass", "vox"];
  var LANES = ["kick", "snare", "hat", "clap"];
  var RHYTHMS = ["off", "train", "waltz", "bossa", "rock"];
  var GRID = 0.25, LIVE_MAX = 48, LIVE_KEEP_BEATS = 4, MIN_LEAD_SECONDS = 0.5;
  var BPM_MIN = 20, BPM_MAX = 300, MAX_PLAYERS = 4, PLAYER_TTL = 12;
  var COLORS = ["#FF4F00", "#F5C400", "#1A1AFF", "#F0EDE8"];

  API.defaults({
    synth: {
      bpm: 112, tempo: {bpm: 112, anchor_epoch: 0, anchor_beat: 0, paused: false}, beats: TOTAL_BEATS,
      pulse: 0, signal: 1, body: 0, calibrate_rev: 0, rev: 0, instrument: "tape", rhythm: "off",
      tonality: {root: 0, scale: "major"}, wander: {enabled: false, amount: 0.35, locks: []},
      events: [], live: [], players: [], player_limit: MAX_PLAYERS,
      pocket: {version: 3, held: [], fresh_generation: 0, sample_revision: 0, midi: {enabled: false, held: []},
        sample_errors: {}, samples_ready: [], session: "web", time_unit: "seconds", generation: 0,
        author_generation: {}, undo: [], redo: [], fx: {}},
      body_source: "slider"            // own-made: "camera" once the visitor hands BODY to the webcam
    },
    synth_archive: {active: null, playing: null, creations: [], encoder_ready: false}
  });
  var synth = S.synth;
  var nextEventId = 1, nextLiveId = 1, cursor = null;   // next_event_id / next_live_id / _synth_cursor
  var seats = {};                                          // _synth_players: client -> seat

  function fail(message) { throw new Error(message); }
  function num(value) { var n = typeof value === "number" ? value : parseFloat(value); return isFinite(n) ? n : NaN; }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clamp01(n) { return Math.min(1, Math.max(0, n)); }
  function validClient(id) { return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id); }
  function absoluteBeat(tempo, epoch) {
    if (tempo.paused) { return Number(tempo.anchor_beat); }
    return Number(tempo.anchor_beat) + (epoch - Number(tempo.anchor_epoch)) * Number(tempo.bpm) / 60;
  }
  function layeredCount() { return synth.events.filter(function (e) { return (e.kind || "chord") !== "chord"; }).length; }
  function commit() { synth.rev += 1; synth.bpm = synth.tempo.bpm; API.emit(); return S; }

  // --- seats (join_synth_player / touch_synth_player / _synth_player_snapshot) ---
  function prunePlayers(now) {
    Object.keys(seats).forEach(function (id) { if (now - seats[id].last_seen > PLAYER_TTL) { delete seats[id]; } });
    synth.players = Object.keys(seats).map(function (id) {
      var p = seats[id];
      return {client: id, slot: p.slot, label: "PLAYER " + p.slot, recording: false, instrument: "harp", color: COLORS[p.slot - 1], last_action: p.last_action};
    }).sort(function (a, b) { return a.slot - b.slot; });
  }
  function join(client, action) {
    if (!validClient(client)) { fail("invalid synth player"); }
    var now = API.now();
    action = typeof action === "string" ? action.split(/\s+/).join(" ").slice(0, 40) : "";
    prunePlayers(now);
    var seat = seats[client];
    if (!seat) {
      var taken = Object.keys(seats).map(function (id) { return seats[id].slot; });
      var slot = [1, 2, 3, 4].filter(function (s) { return taken.indexOf(s) < 0; })[0];
      if (!slot) { return null; }
      seat = seats[client] = {slot: slot, last_seen: now, last_action: action || "READY"};
    } else { seat.last_seen = now; if (action) { seat.last_action = action; } }
    prunePlayers(now);
    return seat.slot;
  }
  function actor(body, action) {        // channel_server.py synth_actor
    if (!body.client) { return null; }
    var slot = join(body.client, action);
    if (slot === null) { fail("Room full. Watching until a place opens."); }
    return slot;
  }

  // --- _normalize_synth_event (sample ids excluded: no sampler here) ---
  function normalizeEvent(event) {
    if (!event || typeof event !== "object") { return null; }
    var kind = event.kind === undefined ? "chord" : event.kind;
    if (!isInt(event.born) || event.born < 0) { return null; }
    var instrument = event.instrument === undefined ? "tape" : event.instrument;
    var player = isInt(event.player) && event.player >= 1 && event.player <= MAX_PLAYERS ? event.player : null;
    var out;
    if (kind === "chord") {
      if (!isInt(event.degree) || event.degree < 0 || event.degree >= DEGREE_COUNT) { return null; }
      if (!isInt(event.beat) || event.beat < 0 || event.beat >= TOTAL_BEATS) { return null; }
      if (QUALITIES.indexOf(event.quality) < 0) { return null; }
      out = {kind: "chord", degree: event.degree, quality: event.quality, beat: event.beat, born: event.born,
        instrument: INSTRUMENTS.indexOf(instrument) < 0 ? "tape" : instrument};
    } else {
      var beat = typeof event.beat === "number" ? event.beat : NaN;
      if (!isFinite(beat) || beat < 0 || beat >= TOTAL_BEATS) { return null; }
      beat = Math.round(beat / GRID) * GRID;
      if (beat >= TOTAL_BEATS) { beat = 0; }
      var velocity = event.velocity === undefined ? 1 : event.velocity;
      if (typeof velocity !== "number" || !isFinite(velocity)) { return null; }
      velocity = Math.min(1, Math.max(0.05, velocity));
      if (kind === "note") {
        if (!isInt(event.note) || event.note < 0 || event.note > 127) { return null; }
        if (INSTRUMENTS.indexOf(instrument) < 0) { return null; }
        out = {kind: "note", note: event.note, velocity: velocity, beat: beat, born: event.born, instrument: instrument};
      } else if (kind === "drum") {
        if (LANES.indexOf(event.lane) < 0) { return null; }
        out = {kind: "drum", lane: event.lane, velocity: velocity, beat: beat, born: event.born, instrument: "kit"};
      } else { return null; }
    }
    if (player !== null) { out.player = player; }
    if (event.author !== undefined) { if (!validClient(event.author)) { return null; } out.author = event.author; }
    var bounds = {duration: [0.01, 32], sample_slot: [0, 23], midi_channel: [0, 15]};
    for (var key in bounds) {
      if (!(key in event)) { continue; }
      var v = event[key];
      if (typeof v !== "number" || !isFinite(v) || v < bounds[key][0] || v > bounds[key][1]) { return null; }
      if (key !== "duration" && !isInt(v)) { return null; }
      out[key] = v;
    }
    if (["afterhours", "daybreak", "arcade"].indexOf(event.groove) >= 0) { out.groove = event.groove; }
    return out;
  }
  function parseList(body, key) {       // the HTTP route carries JSON in "data"; the command table passes arrays
    var raw = body[key] !== undefined ? body[key] : body.data;
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch (e) { fail("invalid synth " + key + " payload"); } }
    return raw;
  }

  // --- the loop ---
  API.register("POST", "/api/synth/chord", function (body) {
    var degree = typeof body.degree === "number" ? Math.trunc(body.degree) : /^[+-]?\d+$/.test(String(body.degree).trim()) ? parseInt(body.degree, 10) : NaN;   // int(): "3.5" raises
    if (!isFinite(degree) || degree < 0 || degree >= DEGREE_COUNT) { fail("invalid synth degree"); }
    var quality = body.quality === undefined ? "default" : body.quality;
    if (QUALITIES.indexOf(quality) < 0) { fail("invalid synth quality"); }
    var player = actor(body, "CHORD");
    var now = API.now(), tempo = synth.tempo;
    var absolute = absoluteBeat(tempo, now);
    var target = Math.ceil(absolute + MIN_LEAD_SECONDS * tempo.bpm / 60);
    if (cursor !== null && cursor > absolute && target <= cursor) { target = cursor + 1; }
    cursor = target;
    var beat = target % TOTAL_BEATS, born = Math.floor(target / TOTAL_BEATS);
    var event = {id: nextEventId++, kind: "chord", degree: degree, quality: quality, beat: beat, born: born, instrument: synth.instrument};
    if (player !== null) { event.player = player; }
    synth.events = synth.events.filter(function (e) { return (e.kind || "chord") !== "chord" || e.beat !== beat; });
    synth.events.push(event);
    var chords = synth.events.filter(function (e) { return (e.kind || "chord") === "chord"; });
    if (chords.length > MAX_EVENTS) {
      var drop = chords.slice(0, chords.length - MAX_EVENTS);
      synth.events = synth.events.filter(function (e) { return drop.indexOf(e) < 0; });
    }
    return commit();
  });
  API.register("POST", "/api/synth/erase", function (body) {
    actor(body, "UNDO");
    if (!synth.events.length) { return S; }
    synth.events.pop();
    return commit();
  });
  API.register("POST", "/api/synth/clear", function (body) {
    actor(body, "CLEARED LOOP");
    synth.events = [];
    return commit();
  });
  API.register("POST", "/api/synth/params", function (body) {
    actor(body, "MIX");
    var changed = false;
    ["pulse", "signal", "body"].forEach(function (name) {
      if (body[name] === undefined || body[name] === null) { return; }
      var value = num(body[name]);
      if (isNaN(value)) { fail("invalid synth " + name); }
      synth[name] = clamp01(value);
      changed = true;
    });
    if (!changed) { fail("no synth parameters supplied"); }
    return commit();
  });
  API.register("POST", "/api/synth/instrument", function (body) {
    if (INSTRUMENTS.indexOf(body.instrument) < 0) { fail("invalid synth instrument"); }
    actor(body, "PATCH");
    synth.instrument = body.instrument;
    return commit();
  });
  API.register("POST", "/api/synth/rhythm", function (body) {
    if (RHYTHMS.indexOf(body.preset) < 0) { fail("invalid synth rhythm preset"); }
    actor(body, "RHYTHM");
    synth.rhythm = body.preset;
    return commit();
  });
  API.register("POST", "/api/synth/bpm", function (body) {
    var bpm = num(body.bpm);
    if (isNaN(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) { fail("invalid synth bpm"); }
    actor(body, "TEMPO");
    var now = API.now(), old = synth.tempo;
    // Re-anchor at the change moment so the loop position is continuous.
    synth.tempo = {bpm: bpm, anchor_epoch: now, anchor_beat: absoluteBeat(old, now), paused: Boolean(old.paused)};
    cursor = null;
    return commit();
  });
  API.register("POST", "/api/synth/strum", function (body) {
    var plucks = parseList(body, "plucks");
    var record = body.record === true || body.record === "1" || body.record === "true";
    if (!Array.isArray(plucks) || !plucks.length) { fail("invalid synth strum"); }
    if (plucks.length > 16) { fail("synth strum too large"); }
    var player = actor(body, record ? "REC STRUM" : "STRUM");
    var now = API.now(), tempo = synth.tempo;
    var absolute = absoluteBeat(tempo, now), lead = MIN_LEAD_SECONDS * tempo.bpm / 60;
    var recorded = [];
    plucks.forEach(function (pluck) {
      if (!pluck || typeof pluck !== "object") { fail("invalid synth strum pluck"); }
      var lane = pluck.lane === undefined ? null : pluck.lane, note = pluck.note;
      if (lane !== null) { if (LANES.indexOf(lane) < 0) { fail("invalid synth strum pluck"); } note = null; }
      else if (!isInt(note) || note < 0 || note > 127) { fail("invalid synth strum pluck"); }
      var velocity = pluck.velocity === undefined ? 1 : pluck.velocity;
      if (typeof velocity !== "number" || !isFinite(velocity)) { fail("invalid synth strum pluck"); }
      velocity = Math.min(1, Math.max(0.05, velocity));
      var offset = pluck.offset === undefined ? 0 : pluck.offset;
      if (typeof offset !== "number" || !isFinite(offset)) { fail("invalid synth strum pluck"); }
      offset = Math.min(4, Math.max(0, offset));
      var target = Math.ceil((absolute + lead + offset) / GRID) * GRID;
      var entry = {id: nextLiveId++, velocity: velocity, at: target, instrument: synth.instrument};
      if (player !== null) { entry.player = player; }
      if (lane !== null) { entry.lane = lane; entry.instrument = "kit"; } else { entry.note = note; }
      synth.live.push(entry);
      if (record) {
        var stamped = lane !== null ? {kind: "drum", lane: lane, velocity: velocity}
          : {kind: "note", note: note, velocity: velocity, instrument: synth.instrument};
        stamped.beat = target % TOTAL_BEATS;
        stamped.born = Math.floor(target / TOTAL_BEATS);
        if (player !== null) { stamped.player = player; }
        recorded.push(stamped);
      }
    });
    synth.live = synth.live.slice(-LIVE_MAX).filter(function (item) { return item.at >= absolute - LIVE_KEEP_BEATS; });
    if (!recorded.length) { API.emit(); return S; }
    var room = Math.max(0, MAX_LAYER_EVENTS - layeredCount());
    recorded.slice(0, room).forEach(function (cleaned) {
      var normalized = normalizeEvent(cleaned);
      if (normalized) { normalized.id = nextEventId++; synth.events.push(normalized); }
    });
    return commit();
  });
  API.register("POST", "/api/synth/layer", function (body) {
    var entries = parseList(body, "entries");
    if (!Array.isArray(entries) || !entries.length) { fail("invalid synth layer"); }
    if (entries.length > MAX_LAYER_COMMIT) { fail("synth layer commit too large"); }
    var player = actor(body, "LAYER");
    var born = Math.floor(absoluteBeat(synth.tempo, API.now()) / TOTAL_BEATS);
    var normalized = entries.map(function (entry) {
      if (!entry || typeof entry !== "object") { fail("invalid synth layer entry"); }
      var candidate = Object.assign({}, entry, {born: born});
      if (candidate.kind === "note" && !("instrument" in candidate)) { candidate.instrument = synth.instrument; }
      var cleaned = normalizeEvent(candidate);
      if (!cleaned || cleaned.kind === "chord") { fail("invalid synth layer entry"); }
      if (player !== null) { cleaned.player = player; }
      return cleaned;
    });
    if (layeredCount() + normalized.length > MAX_LAYER_EVENTS) { fail("synth layer is full"); }
    normalized.forEach(function (cleaned) { cleaned.id = nextEventId++; synth.events.push(cleaned); });
    return commit();
  });
  API.register("POST", "/api/synth/calibrate", function () { synth.calibrate_rev += 1; return commit(); });
  API.register("POST", "/api/synth/join", function (body) { join(body.client); API.emit(); return S; });
  API.register("GET", "/api/synth/events", function () { return {synth: synth, channel: S.channel, epoch: API.now()}; });

  // --- BODY from the visitor's camera (own-made; the Kinect's reading on the station) ---
  API.register("POST", "/api/synth/body-source", function (body) {
    synth.body_source = body.source === "camera" ? "camera" : "slider";
    return commit();
  });
  root.setInterval(function () {
    var now = API.now();
    if (Object.keys(seats).length) { prunePlayers(now); }
    var webcam = root.MadridWebcam;
    if (synth.body_source !== "camera" || !webcam || webcam.status().state !== "live" || S.channel !== "synth") { return; }
    var reading = Math.round(clamp01(webcam.environment().movementEnergy) * 100) / 100;
    if (Math.abs(reading - synth.body) >= 0.01) { synth.body = reading; commit(); }
  }, 250);

  // --- what is not in the web edition: sampler, MIDI, capture archive, pocket command set ---
  API.register("ANY", /^\/api\/synth\/(pocket|captures|recall|visions|samples|midi|engine)(\/|$)/, function () {
    return {disabled: true, error: "not in the web edition", creations: [], cartridges: [], needs_confirmation: false};
  });
}(window));
