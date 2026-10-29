/* MADRiD TV Web: CH 05 ALERT and CH 13 ALARM, the station server's part.
 * Port of channel_core.py transmit_alert / end_alert (1752-1783) and
 * configure_alarm / trigger_alarm / service_alarm / snooze_alarm /
 * dismiss_alarm (1514-1607), with channel_server.py's form parsing
 * (1722-1741, 1847-1873). The alarm schedule is this browser's alone: it is
 * kept in localStorage and nothing leaves the page. A snooze is not kept: a
 * stale snooze_until restored days later would ring on the first tick and
 * tune the visitor to CH 13 with no gesture. Live dictation
 * (/api/alert/live, /api/alert/live-text) is not here on purpose.
 * Load after static/station-api.js. */
(function (root) {
  "use strict";
  var API = root.MadridStationAPI;
  if (!API) { return; }
  var STORE = "madrid-tv-web.alarm";
  var S = API.state;
  var storage = null;
  try { storage = root["localStorage"] || null; } catch (e) { storage = null; }

  API.defaults({
    alert_text: "", alert_mode: "text", alert_live_text: "", pre_alert_channel: "signal",
    pre_alarm_channel: "signal",
    alarm: {time: "07:00", label: "WAKE UP", enabled: false, days: [0, 1, 2, 3, 4, 5, 6],
      ringing: false, snooze_until: 0, last_fired_date: "", rev: 0}
  });
  S.alert_mode = "text";            // channel_core.py:510; there is no live mode here
  S.alarm.ringing = false;          // never rings, flashes or sounds before a visitor asks

  // --- validators (channel_core.py 1069-1108, 1205-1213) -------------------
  function fail(message) { throw new Error(message); }
  function str(v) { return v == null ? "" : String(v); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function collapse(text) { return text.split(/\s+/).filter(Boolean).join(" "); }
  function normTime(value) {
    var p = str(value).split(":");
    if (p.length !== 2 || !/^\d\d$/.test(p[0]) || !/^\d\d$/.test(p[1])) { fail("invalid alarm time"); }
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (h > 23 || m > 59) { fail("invalid alarm time"); }
    return pad(h) + ":" + pad(m);
  }
  function normLabel(value) {
    var v = collapse(str(value));
    if (!v || v.length > 40) { fail("invalid alarm label"); }
    return v;
  }
  function normDays(value) {
    if (typeof value === "string") { value = value ? value.split(",") : []; }
    if (!Array.isArray(value)) { fail("invalid alarm days"); }
    var out = [];
    value.forEach(function (item) {
      if (!/^\s*\d+\s*$/.test(String(item))) { fail("invalid alarm days"); }
      var day = parseInt(item, 10);
      if (day > 6 || out.indexOf(day) !== -1) { fail("invalid alarm days"); }
      out.push(day);
    });
    return out.sort();
  }
  function normEnabled(value) {
    if (value === true || value === false) { return value; }
    var s = str(value).toLowerCase();
    if (s === "true" || s === "1") { return true; }
    if (s === "false" || s === "0") { return false; }
    fail("invalid alarm enabled state");
  }
  function normAlert(value) {
    var v = collapse(str(value));
    if (v.length > 500) { fail("invalid alert text"); }
    return v;
  }

  // --- the schedule, kept in this browser ------------------------------------
  function restore() {
    var saved = null;
    try { saved = JSON.parse(storage.getItem(STORE) || "null"); } catch (e) { saved = null; }
    if (!saved || typeof saved !== "object") { return; }
    try {
      var time = normTime(saved.time), label = normLabel(saved.label), days = normDays(saved.days);
      var a = S.alarm;
      a.time = time; a.label = label; a.days = days; a.enabled = saved.enabled === true;
      a.last_fired_date = typeof saved.last_fired_date === "string" ? saved.last_fired_date : "";
    } catch (e) { /* stale or hand-edited blob: keep the defaults */ }
  }
  function persist() {
    var a = S.alarm;
    try {
      storage.setItem(STORE, JSON.stringify({time: a.time, label: a.label, enabled: a.enabled,
        days: a.days, last_fired_date: a.last_fired_date}));
    } catch (e) { /* private window or blocked storage: the schedule lives for this page only */ }
  }
  try { S.alarm.days = normDays(S.alarm.days); } catch (e) { S.alarm.days = [0, 1, 2, 3, 4, 5, 6]; }
  restore();

  // --- alarm clockwork (channel_core.py 1538-1607) ---------------------------
  function dateKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function weekday(d) { return (d.getDay() + 6) % 7; }   // Python weekday(): Monday is 0
  function activate(now, scheduled) {
    var a = S.alarm;
    if (S.channel !== "alarm" && S.channel !== "alert") { S.pre_alarm_channel = S.channel; }
    a.ringing = true; a.snooze_until = 0; a.rev += 1;
    if (scheduled) { a.last_fired_date = dateKey(now); }
    // ALERT stays the override; a pending alarm takes over when the alert ends.
    if (S.channel !== "alert") { S.channel = "alarm"; }
    persist();
  }
  function service() {
    var a = S.alarm, now = new Date(), epoch = Date.now() / 1000;
    if (a.ringing) { return false; }
    if (a.snooze_until) {
      if (epoch >= a.snooze_until) { activate(now, false); return true; }
      return false;
    }
    if (!a.enabled) { return false; }
    var due = a.days.indexOf(weekday(now)) !== -1 &&
      pad(now.getHours()) + ":" + pad(now.getMinutes()) === a.time &&
      a.last_fired_date !== dateKey(now);
    if (due) { activate(now, true); return true; }
    return false;
  }
  // set_channel (channel_core.py:1335) remembers where the dial was when it
  // turns to ALERT; the shell changes state.channel directly, so watch it here.
  // ponytail: 1 s watch, same cadence as the station's poll; a dial change and
  // back inside one second is not remembered.
  var previousChannel = S.channel;
  var timer = root.setInterval(function () {
    if (S.channel !== previousChannel) {
      if (S.channel === "alert" && previousChannel !== "alert") { S.pre_alert_channel = previousChannel; }
      previousChannel = S.channel;
    }
    if (service()) { API.emit(); }
  }, 1000);
  if (timer && timer.unref) { timer.unref(); }   // lets the Node self-check exit

  // --- handlers (channel_server.py 1722-1741, 1847-1873) ---------------------
  API.register("POST", "/api/alert", function (body, query, ctx) {
    var text = normAlert(body.text);
    if (!text) { fail("invalid alert text"); }
    if (S.channel !== "alert") { S.pre_alert_channel = S.channel; }
    S.alert_text = text; S.alert_mode = "text"; S.channel = "alert";
    previousChannel = S.channel;
    ctx.emit(); return S;
  });
  API.register("POST", "/api/alert/end", function (body, query, ctx) {
    var channel = S.alarm.ringing ? "alarm" : S.pre_alert_channel;
    if (!channel || channel === "alert") { channel = "signal"; }
    S.channel = channel; S.pre_alert_channel = channel;
    S.alert_text = ""; S.alert_mode = "text"; S.alert_live_text = "";
    previousChannel = S.channel;
    ctx.emit(); return S;
  });
  API.register("POST", "/api/alarm/config", function (body, query, ctx) {
    var time = normTime(body.time), label = normLabel(body.label), days = normDays(body.days == null ? "" : body.days);
    var enabled = normEnabled(body.enabled);
    if (enabled && !days.length) { fail("armed alarm needs at least one day"); }
    var a = S.alarm;
    var scheduleChanged = time !== a.time || days.join(",") !== a.days.join(",");
    a.time = time; a.label = label; a.enabled = enabled; a.days = days; a.rev += 1;
    if (scheduleChanged) { a.last_fired_date = ""; }
    if (!enabled && !a.ringing) { a.snooze_until = 0; }
    persist(); ctx.emit(); return S;
  });
  API.register("POST", "/api/alarm/test", function (body, query, ctx) {
    activate(new Date(), false);
    previousChannel = S.channel;
    ctx.emit(); return S;
  });
  API.register("POST", "/api/alarm/snooze", function (body, query, ctx) {
    if (!S.alarm.ringing) { fail("alarm is not ringing"); }
    var raw = body.minutes === undefined ? "5" : body.minutes;
    if (!/^\s*-?\d+\s*$/.test(String(raw))) { fail("invalid snooze minutes"); }
    var minutes = parseInt(raw, 10);
    if (minutes < 1 || minutes > 60) { fail("invalid snooze minutes"); }
    S.alarm.ringing = false; S.alarm.snooze_until = Date.now() / 1000 + minutes * 60; S.alarm.rev += 1;
    if (S.channel === "alarm") { S.channel = S.pre_alarm_channel || "signal"; }
    previousChannel = S.channel;
    persist(); ctx.emit(); return S;
  });
  API.register("POST", "/api/alarm/dismiss", function (body, query, ctx) {
    S.alarm.ringing = false; S.alarm.snooze_until = 0; S.alarm.rev += 1;
    if (S.channel === "alarm") { S.channel = S.pre_alarm_channel || "signal"; }
    S.pre_alarm_channel = S.channel;
    previousChannel = S.channel;
    persist(); ctx.emit(); return S;
  });
}(window));
