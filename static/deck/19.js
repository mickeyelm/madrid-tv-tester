/* MADRiD TV Web: the remote's diK-pix deck, on the page. The station's own
 * drawing deck (static/dikpix-remote.js, copied by tools/manifest.19.json)
 * builds the whole paintbox into <section id="dikpix-panel"> at load and talks
 * to /api/dikpix/* and /api/state with fetch, which static/station-api.js
 * answers in-page from static/shim/19.js. This file gives it that section in
 * the deck drawer, loads it the first time CH 19 is tuned (on later visits the
 * same section, canvas and tool state move back into place) and hands it the
 * state the way remote.js did on every poll (remote.js:988-992):
 * MadridDikPixRemote.sync(state.dikpix, state.channel === "dikpix"). */
(function (root) {
  "use strict";
  var Deck = root.MadridDeck, API = root.MadridStationAPI;
  if (!Deck || !API) { return; }
  var section = null, loading = false, ticking = false;
  function sync() {
    var remote = root.MadridDikPixRemote;
    if (remote) { remote.sync(API.state.dikpix, API.state.channel === "dikpix"); }
  }
  function tick() {
    // The shell's 400 ms heartbeat is not a subscription; keep the remote's own clock.
    if (ticking) { return; }
    ticking = true;
    var timer = root.setInterval(sync, 400);
    if (timer && timer.unref) { timer.unref(); }
    API.subscribe(sync);
    sync();
  }
  Deck.register("dikpix", {
    title: "diK-pix FAMILY / CH 19",
    mount: function (el) {
      if (!section) {
        section = document.createElement("section");
        section.id = "dikpix-panel";
        section.setAttribute("data-panel", "dikpix");
      }
      el.appendChild(section);
      if (root.MadridDikPixRemote) { tick(); return; }
      if (loading) { return; }
      loading = true;
      var script = document.createElement("script");
      script.src = "static/dikpix-remote.js";
      script.onload = tick;
      script.onerror = function () { el.textContent = "REMOTE PANEL UNAVAILABLE"; };
      document.head.appendChild(script);
    }
  });
}(window));
