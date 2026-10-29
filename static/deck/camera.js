/* MADRiD TV Web: the remote's CAMERA deck, on the page. Ported from the
 * station's remote.html (camera panel 171-180) and remote.js (renderCamera
 * 663-676). The phone link line is gone: the transmitter is this browser.
 * USE CAMERA is the one control the phone page had that the TV remote did
 * not; STOP posts the station's own /api/camera/stop. */
(function (root) {
  "use strict";
  var Deck = root.MadridDeck, API = root.MadridStationAPI;
  if (!Deck) { return; }
  var render = null;
  Deck.register("camera", {
    title: "CAMERA / LIVE EYE",
    mount: function (el, api) {
      el.innerHTML =
        '<div class="deck-camera">' +
        '<div class="camera-remote-status"><i id="camera-remote-led"></i><span id="camera-remote-state">NO TRANSMITTER</span></div>' +
        '<div class="deck-camera-grid">' +
        '<button type="button" data-camera-action="start">USE CAMERA</button>' +
        '<button type="button" data-camera-action="stop">STOP</button>' +
        '</div></div>';
      var led = el.querySelector("#camera-remote-led");
      var label = el.querySelector("#camera-remote-state");
      function paint(state) {
        var camera = state && state.camera;
        if (!camera) { return; }
        var mode = "cold", text = "NO TRANSMITTER";
        if (camera.offer_pending && camera.answer_pending) { mode = "live"; text = "TRANSMITTER LINKED — LIVE"; }
        else if (camera.offer_pending) { mode = "warm"; text = "TRANSMITTER CALLING…"; }
        led.className = mode;
        label.textContent = text;
      }
      el.querySelector('[data-camera-action="start"]').addEventListener("click", function () { api.post("/api/camera/start", {}); });
      el.querySelector('[data-camera-action="stop"]').addEventListener("click", function () { api.post("/api/camera/stop", {}); });
      render = paint;
      paint(api.state());
    }
  });
  // The station's remote re-rendered on every poll; here the state module says when.
  if (API && API.subscribe) { API.subscribe(function (state) { if (render) { render(state); } }); }
}(window));
