/* MADRiD TV Web: CH 03 MADRiD 90s (AFTER THE FUTURE), the broadcast layer.
 * The station's channel_broadcast.py computed a wall-clock schedule on the
 * server and tv.js polled it into state.broadcast; tv-broadcast.js only reads
 * that slice. Here the schedule math (_schedule_at, _slot, _slot_at, snapshot)
 * runs in the page over lineup.json and refreshes state.broadcast every
 * second. Loads after static/station-api.js and before static/tv-broadcast.js.
 * Not ported: REALITY LEAK mode (Kinect; OUT), the CH 14 community-slot
 * rotation and POST /api/broadcast/publish, GET /api/broadcast/library,
 * broadcast-settings.json persistence (quiet/reduced_motion live in this
 * visitor's localStorage). The layer never read the Kinect, so no webcam. */
(function (root) {
  "use strict";
  var api = root.MadridStationAPI;
  if (!api) { return; }
  var state = api.state;
  var CYCLE = 7200;                      // channel_broadcast.py:83 "broadcast must be two hours"
  var PREFS_KEY = "madrid-tv.broadcast";
  var lineup = null, timezone = "America/New_York", formatter = null;

  // channel_broadcast.py:23 settings, per visitor instead of per station.
  var prefs = {quiet: true, reduced_motion: false};
  try {
    var saved = JSON.parse(root.localStorage.getItem(PREFS_KEY) || "{}");
    ["quiet", "reduced_motion"].forEach(function (key) { if (typeof saved[key] === "boolean") { prefs[key] = saved[key]; } });
  } catch (e) { /* no storage: station defaults */ }

  api.defaults({
    channel: "off-air", desktop_mode: false, epoch: Date.now() / 1000, server_time_ms: Date.now(),
    broadcast: {enabled: true, quiet: prefs.quiet, reduced_motion: prefs.reduced_motion, mode: "archive",
      title: "", duration: CYCLE, now: null, next: null, upcoming: []}
  });
  // station-api.js seeds broadcast {enabled:false, quiet, reduced_motion} and defaults() keeps
  // existing keys, so the three are set here. enabled stays true for the life of the page:
  // the shell only shows the broadcast layer for CH 03 while it is.
  state.broadcast.enabled = true;
  state.broadcast.quiet = prefs.quiet;
  state.broadcast.reduced_motion = prefs.reduced_motion;

  /* ---- wall clock in lineup.timezone (zoneinfo -> Intl) ----------------- */
  function parts(seconds) {
    formatter = formatter || new Intl.DateTimeFormat("en-US", {timeZone: timezone, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric"});
    var out = {};
    formatter.formatToParts(new Date(seconds * 1000)).forEach(function (p) { if (p.type !== "literal") { out[p.type] = Number(p.value); } });
    if (out.hour === 24) { out.hour = 0; }
    return out;
  }
  // datetime.combine(date, time(hour), tz).timestamp(): invert the zone offset, twice for DST edges.
  function localToEpoch(dateMs, hour) {
    var guess = dateMs + hour * 3600000;
    function offsetAt(ms) { var p = parts(ms / 1000); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms; }
    var result = guess - offsetAt(guess);
    var again = offsetAt(result);
    if (again !== offsetAt(guess)) { result = guess - again; }
    return result / 1000;
  }
  function mod(a, b) { return ((a % b) + b) % b; }

  /* ---- channel_broadcast.py:196-272 ----------------------------------- */
  function scheduleAt(timestamp) {                                   // _schedule_at
    var local = parts(timestamp);
    var dayparts = lineup.dayparts || [];
    for (var i = 0; i < dayparts.length; i += 1) {
      var daypart = dayparts[i], start = daypart.start_hour, end = daypart.end_hour;
      var active = start < end && start <= local.hour && local.hour < end;
      active = active || (start > end && (local.hour >= start || local.hour < end));
      if (!active) { continue; }
      var startDate = Date.UTC(local.year, local.month - 1, local.day);
      if (start > end && local.hour < end) { startDate -= 86400000; }
      return {schedule: daypart, anchor: localToEpoch(startDate, start)};
    }
    return {schedule: lineup, anchor: lineup.anchor_epoch};
  }
  function slot(schedule, anchor, index, cycle) {                   // _slot (community rotation not ported)
    var slots = schedule.slots, source = slots[index];
    var start = anchor + cycle * CYCLE;
    for (var i = 0; i < index; i += 1) { start += slots[i].duration; }
    var out = Object.assign({}, source, {starts_at: start, ends_at: start + source.duration, block_title: schedule.title});
    var program = source.asset && lineup.programs ? lineup.programs[source.asset] : null;
    var cleared = Boolean(program && program.cleared === true && program.url);
    out.available = !source.asset || cleared;                        // resolve(): cleared programme instead of a file on disk
    if (cleared) { out.url = program.url; out.media_duration = program.duration; }
    else if (source.asset) { out.kind = "ident"; }                   // uncleared: a stand-by ident card for the slot's duration, no url
    if (out.kind === "community") { out.kind = "program"; }         // CH 14 rotation not ported: cleared, it is a plain programme (tv-broadcast.js:43 slates 'community')
    if (!out.year) { out.year = parts(start).year; }                 // tv-broadcast.js:39 stamps a copied place name when year is missing
    return out;
  }
  function slotAt(timestamp) {                                      // _slot_at
    var at = scheduleAt(timestamp);
    var cycle = Math.floor((timestamp - at.anchor) / CYCLE);
    var offset = mod(timestamp - at.anchor, CYCLE);
    var slots = at.schedule.slots, cursor = 0, index = 0;
    for (var i = 0; i < slots.length; i += 1) { cursor += slots[i].duration; if (offset < cursor) { index = i; break; } }
    return slot(at.schedule, at.anchor, index, cycle);
  }
  function snapshot(now) {                                           // snapshot(), archive mode only
    // CHANNEL DRIFT (shim/drift.js): outside PROGRAMMING the station's player stands down.
    var programming = !root.MadridDrift || root.MadridDrift.programming();
    var result = {enabled: programming, quiet: prefs.quiet, reduced_motion: prefs.reduced_motion, mode: "archive"};
    if (!lineup) { return result; }
    var current = slotAt(now);
    var count = lineup.slots.length;
    (lineup.dayparts || []).forEach(function (d) { count = Math.max(count, d.slots.length); });
    var upcoming = [current], cursor = current.ends_at;
    for (var i = 0; i < count; i += 1) { var following = slotAt(cursor + 0.000001); upcoming.push(following); cursor = following.ends_at; }
    result.title = current.block_title; result.duration = CYCLE;
    result.now = current; result.next = upcoming[1]; result.upcoming = upcoming;
    return result;
  }
  function validate(config) {                                        // _validate_schedule, the two-hour invariant
    [config].concat(config.dayparts || []).forEach(function (schedule) {
      var sum = schedule.slots.reduce(function (a, s) { return a + s.duration; }, 0);
      if (Math.abs(sum - CYCLE) > 0.001) { throw new Error("broadcast must be two hours: " + (schedule.id || "main") + " sums to " + sum); }
    });
  }

  /* ---- the heartbeat the server's poll used to carry ------------------- */
  // The video element ships muted so a cold visitor's autoplay is never refused (tv-broadcast.js:21
  // latches a refusal until the slot changes); the shell's SOUND state unmutes it.
  function applySound() {
    var video = document.getElementById("broadcast-video");
    if (video) { video.muted = state.sound_enabled !== true; }
  }
  function tick() {
    var now = Date.now() / 1000;
    state.server_time_ms = now * 1000; state.epoch = now;
    Object.assign(state.broadcast, snapshot(now));
    applySound();
  }
  function load(data) {
    validate(data);
    timezone = data.timezone || "America/New_York"; formatter = null; lineup = data;
    tick(); api.emit();
  }
  if (root.fetch) {
    root.fetch("lineup.json", {cache: "no-store"})
      .then(function (r) { if (!r.ok) { throw new Error("lineup.json " + r.status); } return r.json(); })
      .then(load)
      .catch(function (error) { if (root.console) { root.console.error("CH 03 lineup unavailable: " + (error && error.message || error)); } });
  }
  var timer = root.setInterval(tick, 1000);
  if (timer && typeof timer.unref === "function") { timer.unref(); }   // lets a Node self-check exit; inert in browsers
  // A refused start latches PLAYBACK PAUSED until the slot changes (tv-broadcast.js:21), and a phone
  // can refuse even muted autoplay (iOS Low Power Mode). A tap or key is a gesture: restart the tape.
  function retryRefused() {
    var video = document.getElementById("broadcast-video"), detail = document.getElementById("broadcast-detail");
    if (state.channel !== "archive" || !video || !video.paused || !detail || !/^PLAYBACK PAUSED/.test(detail.textContent) || !root.MadridBroadcast) { return; }
    root.MadridBroadcast.stop(); api.emit();
  }
  if (document.addEventListener) {
    ["pointerdown", "keydown", "click"].forEach(function (type) { document.addEventListener(type, applySound); });
    ["keydown", "click"].forEach(function (type) { document.addEventListener(type, retryRefused); });
  }

  // channel_server.py:1346-1360 + channel_broadcast.py:91-104 preferences(): quiet / reduced_motion
  // booleans (deck.js posts them URL-encoded, so "true"/"false" count); mode is fixed to "archive";
  // decay_minutes belonged to REALITY LEAK. Anything else is "invalid tuning preference", as on the station.
  api.register("POST", "/api/broadcast/preferences", function (body) {
    var keys = Object.keys(body || {}), next = {};
    if (!keys.length) { throw new Error("invalid tuning preference"); }
    keys.forEach(function (key) {
      var value = body[key];
      if (value === "true") { value = true; } else if (value === "false") { value = false; }
      if ((key === "quiet" || key === "reduced_motion") && typeof value === "boolean") { next[key] = value; return; }
      if (key === "mode" && value === "archive") { return; }
      throw new Error("invalid tuning preference");
    });
    Object.assign(prefs, next);
    try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* private window */ }
    tick();
    return state.broadcast;
  });
}(window));
