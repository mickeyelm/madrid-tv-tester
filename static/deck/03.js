/* MADRiD TV Web: THE REMOTE's CH 03 panel. remote.html:154-169 (the tape list and
 * its line) plus remote-deck.js:88-109 TUNING (quiet changes, reduce motion), which
 * posted to /api/broadcast/preferences. The REALITY LEAK mode button and its DESCENT
 * controls (remote.html:158-165) are stripped with that mode, which leaves one mode
 * and no mode row. The shell keys panels by dial id: CH 03 is "archive". */
(function (root) {
  "use strict";
  if (!root.MadridDeck) { return; }
  root.MadridDeck.register("archive", {
    title: "CH 03 / CHANNEL DRIFT",
    mount: function (el, api) {
      var list = document.createElement("div");
      list.className = "archive-list"; list.textContent = "NO TAPES LOADED";
      var description = document.createElement("p");
      description.className = "surface-privacy";
      description.textContent = "A TWO-HOUR BROADCAST OF 1990s TECHNOLOGY, VINTAGE AD BREAKS AND MADRiD STATION IDs. JOIN WHERE THE SIGNAL IS NOW.";
      var tuning = document.createElement("section");
      tuning.className = "deck-station-options";
      var heading = document.createElement("h2"); heading.textContent = "TUNING";
      function option(text) {
        var label = document.createElement("label"), box = document.createElement("input");
        box.type = "checkbox"; label.append(box, " " + text); return {label: label, box: box};
      }
      var quiet = option("Quiet channel changes"), motion = option("Reduce motion");
      var status = document.createElement("p");
      status.className = "deck-settings-status"; status.setAttribute("role", "status");
      tuning.append(heading, quiet.label, motion.label, status);
      // CHANNEL DRIFT: the mode the channel opened in, and a press to change it (POST /api/drift/mode).
      var modes = document.createElement("div"); modes.className = "drift-modes";
      [["programming", "PROGRAMMING"], ["rock-of-love", "ROCK OF LOVE"], ["reality-drift", "REALITY DRIFT"]].forEach(function (m) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = m[1]; b.dataset.mode = m[0];
        b.addEventListener("click", function () { api.post("/api/drift/mode", {mode: m[0]}).then(paintModes); });
        modes.appendChild(b);
      });
      function paintModes() {
        var d = api.state().drift || {};
        Array.prototype.forEach.call(modes.children, function (b) {
          b.classList.toggle("is-on", b.dataset.mode === d.mode);
          if (b.dataset.mode === "rock-of-love") { b.textContent = d.youtubeBlocked ? "ROCK OF LOVE · BLOCKED HERE" : "ROCK OF LOVE"; }
        });
      }
      var modeTimer = root.setInterval(function () { if (!el.isConnected) { root.clearInterval(modeTimer); return; } paintModes(); }, 800);
      paintModes();
      el.append(modes, list, description, tuning);

      function preference(key, value) {                              // remote-deck.js:105-109
        var data = {}; data[key] = value;
        api.post("/api/broadcast/preferences", data).then(function (result) {
          if (!result || result.error) { throw new Error(result && result.error || "Try again"); }
          status.textContent = "SAVED ON THE TV";
        }).catch(function (error) { status.textContent = error.message; });
      }
      quiet.box.addEventListener("change", function () { preference("quiet", quiet.box.checked); });
      motion.box.addEventListener("change", function () { preference("reduced_motion", motion.box.checked); });

      var signature = "";
      function render() {                                             // remote.js:396-421 renderArchive, archive mode
        var broadcast = api.state().broadcast;
        if (!broadcast || !broadcast.enabled) { return; }
        quiet.box.checked = Boolean(broadcast.quiet); motion.box.checked = Boolean(broadcast.reduced_motion);
        if (!broadcast.now) { return; }
        var next = JSON.stringify(broadcast.upcoming);
        if (next === signature) { return; }
        signature = next; list.textContent = "";
        var now = document.createElement("div"), following = document.createElement("p"), roster = document.createElement("ol");
        now.className = "broadcast-now"; now.textContent = "ON AIR / " + broadcast.now.title;
        following.textContent = "NEXT / " + broadcast.next.title;
        (broadcast.upcoming || []).slice(1).forEach(function (slot) {
          var row = document.createElement("li");
          row.textContent = new Date(slot.starts_at * 1000).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"}) + " · " + slot.title + (slot.year ? " (" + slot.year + ")" : "");
          roster.appendChild(row);
        });
        list.append(now, following, roster);
      }
      render();
      var timer = root.setInterval(function () { if (!el.isConnected) { root.clearInterval(timer); return; } render(); }, 1000);
    }
  });
}(window));
