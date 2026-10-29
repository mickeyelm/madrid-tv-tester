/* MADRiD TV Web: the remote's CH 24 panel. The station list from radio.json (NTS first); a press
 * goes through the in-page API (POST /api/radio/station), the same call the phone remote may make. */
(function (root) {
  "use strict";
  var Deck = root.MadridDeck, API = root.MadridStationAPI;
  if (!Deck || !API) { return; }
  Deck.register("nts", {
    title: "NTS RADIO / STATIONS",
    mount: function (el, api) {
      var list = document.createElement("div"); list.className = "radio-deck";
      var line = document.createElement("p"); line.className = "radio-deck-status";
      var shown = "";
      function render() {
        var r = API.state.radio || {};
        var key = JSON.stringify([r.station, r.stations && r.stations.length]);
        if (key !== shown) {
          shown = key; list.innerHTML = "";
          (r.stations || []).forEach(function (s) {
            var b = document.createElement("button"); b.type = "button"; b.textContent = s.name;
            b.classList.toggle("is-on", s.id === r.station); b.setAttribute("aria-pressed", String(s.id === r.station));
            b.addEventListener("click", function () { api.post("/api/radio/station", {id: s.id}).then(render); });
            list.appendChild(b);
          });
        }
        line.textContent = [r.show, r.status === "LIVE" && !r.reactive ? "LIVE · PULSE" : r.status].filter(Boolean).join(" · ");
      }
      el.appendChild(list); el.appendChild(line); render();
      var timer = root.setInterval(function () { if (!el.isConnected) { root.clearInterval(timer); return; } render(); }, 1000);
    }
  });
}(window));
