/* MADRiD TV Web: the remote's ALERT and ALARM decks, on the page. Ported from
 * the station's remote.html (alert panel 261-271, alarm panel 550-580) and
 * remote.js (render 443-460 and 1061-1062, saveAlarm/doAlarmAction 1209-1237,
 * doAlertAction 1259-1272). The LIVE VOICE mode row is not here: there is no
 * dictation source in the web edition. */
(function (root) {
  "use strict";
  var Deck = root.MadridDeck, API = root.MadridStationAPI;
  if (!Deck) { return; }
  var mounted = {alert: null, alarm: null};
  function noop() {}
  function alarmDayLabel(days) {
    var names = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    if (!days || days.length === 7) { return "DAILY"; }
    if (days.join(",") === "0,1,2,3,4") { return "WEEKDAYS"; }
    return days.map(function (day) { return names[day]; }).join("·");
  }
  function settle(promise, done) {
    Promise.resolve(promise).then(function (state) { if (state && state.alarm) { done(state); } }, noop);
  }

  // --- CH 05 ALERT / TRANSMISSION --------------------------------------------
  Deck.register("alert", {
    title: "ALERT / TRANSMISSION",
    mount: function (el, api) {
      el.innerHTML =
        '<div class="deck-0513 deck-0513-alert">' +
        '<textarea maxlength="500" rows="4" aria-label="Alert message"></textarea>' +
        '<div class="deck-0513-grid">' +
        '<button type="button" data-alert-action="transmit">TRANSMIT</button>' +
        '<button type="button" data-alert-action="end">END ALERT</button>' +
        '</div></div>';
      var text = el.querySelector("textarea");
      function render(state) {
        if (document.activeElement !== text) { text.value = state.alert_text || ""; }
      }
      el.querySelector('[data-alert-action="transmit"]').addEventListener("click", function () {
        settle(api.post("/api/alert", {text: text.value}), render);
      });
      el.querySelector('[data-alert-action="end"]').addEventListener("click", function () {
        settle(api.post("/api/alert/end", {}), render);
      });
      mounted.alert = render;
      render(api.state());
    }
  });

  // --- CH 13 ALARM / WAKE TRANSMISSION ---------------------------------------
  Deck.register("alarm", {
    title: "ALARM / WAKE TRANSMISSION / CH 13",
    mount: function (el, api) {
      el.innerHTML =
        '<div class="deck-0513 deck-0513-alarm">' +
        '<div class="alarm-remote-status">STANDBY / DAILY 07:00</div>' +
        '<div class="alarm-form-row">' +
        '<label class="alarm-field-label">LOCAL TIME<input type="time" value="07:00" step="60" aria-label="Alarm time"></label>' +
        '<label class="alarm-field-label">TRANSMISSION LABEL<input type="text" value="WAKE UP" maxlength="40" aria-label="Alarm label"></label>' +
        '</div>' +
        '<div class="alarm-days" aria-label="Alarm days">' +
        ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map(function (name, day) {
          return '<button type="button" data-alarm-day="' + day + '" class="is-selected">' + name + '</button>';
        }).join("") +
        '</div>' +
        '<div class="deck-0513-grid">' +
        '<button type="button" data-alarm-action="arm">SAVE + ARM</button>' +
        '<button type="button" data-alarm-action="disarm">DISARM</button>' +
        '</div>' +
        '<div class="deck-0513-grid alarm-ringing-actions" style="display: none;">' +
        '<button type="button" data-alarm-action="snooze">SNOOZE 5</button>' +
        '<button type="button" data-alarm-action="dismiss">DISMISS</button>' +
        '</div>' +
        '<button type="button" data-alarm-action="test" class="surface-hero-button">TEST ALARM NOW</button>' +
        '</div>';
      var status = el.querySelector(".alarm-remote-status");
      var time = el.querySelector('input[type="time"]');
      var label = el.querySelector('input[type="text"]');
      var dayButtons = el.querySelectorAll("[data-alarm-day]");
      var ringingActions = el.querySelector(".alarm-ringing-actions");
      var editing = false;

      function selectedDays() {
        var days = [];
        Array.prototype.forEach.call(dayButtons, function (button) {
          if (button.classList.contains("is-selected")) { days.push(parseInt(button.getAttribute("data-alarm-day"), 10)); }
        });
        return days;
      }
      function render(state) {
        var alarm = state.alarm || {};
        var mode = alarm.ringing ? "RINGING" : (alarm.enabled ? "ARMED" : "STANDBY");
        status.textContent = mode + " / " + alarmDayLabel(alarm.days || []) + " " + (alarm.time || "07:00");
        ringingActions.style.display = alarm.ringing ? "grid" : "none";
        if (editing) { return; }
        time.value = alarm.time || "07:00";
        label.value = alarm.label || "WAKE UP";
        Array.prototype.forEach.call(dayButtons, function (button) {
          var day = parseInt(button.getAttribute("data-alarm-day"), 10);
          button.classList.toggle("is-selected", (alarm.days || []).indexOf(day) !== -1);
        });
      }
      function saveAlarm(enabled, done) {
        settle(api.post("/api/alarm/config", {
          time: time.value, label: label.value, enabled: enabled ? "true" : "false", days: selectedDays().join(",")
        }), function (state) { editing = false; render(state); if (done) { done(state); } });
      }
      var actions = {
        arm: function () { saveAlarm(true); },
        disarm: function () { saveAlarm(false); },
        test: function () {
          var current = api.state().alarm;
          saveAlarm(Boolean(current && current.enabled), function () { settle(api.post("/api/alarm/test", {}), render); });
        },
        snooze: function () { settle(api.post("/api/alarm/snooze", {minutes: "5"}), render); },
        dismiss: function () { settle(api.post("/api/alarm/dismiss", {}), render); }
      };
      Array.prototype.forEach.call(dayButtons, function (button) {
        button.addEventListener("click", function () { editing = true; button.classList.toggle("is-selected"); });
      });
      Array.prototype.forEach.call(el.querySelectorAll("[data-alarm-action]"), function (button) {
        button.addEventListener("click", actions[button.getAttribute("data-alarm-action")]);
      });
      [time, label].forEach(function (input) { input.addEventListener("input", function () { editing = true; }); });
      mounted.alarm = render;
      render(api.state());
    }
  });

  // The station's remote re-rendered on every poll; here the state module says when.
  if (API && API.subscribe) {
    API.subscribe(function (state) {
      if (mounted.alert) { mounted.alert(state); }
      if (mounted.alarm) { mounted.alarm(state); }
    });
  }
}(window));
