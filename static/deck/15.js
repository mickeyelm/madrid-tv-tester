/* MADRiD TV Web: CH 15 MARLIN'S PLAYHOUSE on the remote. The station remote's
 * playhouse panel (remote.html #playhouse-panel) moved onto the page: the same
 * surface actions posted to the same /api/surface-command (remote.js
 * sendSurfaceCommand), plus the camera that stands in for the Kinect. */
(function (root) {
  "use strict";
  if (!root.MadridDeck) { return; }
  var REASON = "CH 15 MARLIN'S PLAYHOUSE WANTS YOUR CAMERA";
  var cameraButtons = [];
  var watching = false;

  function paintCamera(webcam) {
    var live = webcam.status().state === "live";
    cameraButtons = cameraButtons.filter(function (button) { return button.isConnected !== false; });
    cameraButtons.forEach(function (button) {
      button.textContent = live ? "STOP CAMERA" : "USE CAMERA";
      button.classList.toggle("is-live", live);
    });
  }

  root.MadridDeck.register("playhouse", {
    title: "CH 15 / MARLIN'S PLAYHOUSE",
    mount: function (el, api) {
      el.innerHTML =
        '<div class="playhouse-deck">' +
          '<div class="playhouse-deck-status"><span>BODY CONTROL</span><strong>MAKE THE BIGGEST MESS POSSIBLE</strong></div>' +
          '<button type="button" class="playhouse-deck-hero" data-surface-action="start">START 4:00 ROUND</button>' +
          '<div class="playhouse-deck-grid">' +
            '<button type="button" data-surface-action="calibrate">RECALIBRATE BODY</button>' +
            '<button type="button" data-surface-action="reset">RESET ROOM</button>' +
            '<button type="button" data-camera>USE CAMERA</button>' +
          '</div>' +
          '<button type="button" class="playhouse-deck-binsky" data-surface-action="binsky">TEST BINSKY MODE</button>' +
        '</div>';
      Array.prototype.forEach.call(el.querySelectorAll("[data-surface-action]"), function (button) {
        button.addEventListener("click", function () {
          Promise.resolve(api.post("/api/surface-command", {surface: "playhouse", action: button.getAttribute("data-surface-action")}))
            .catch(function () { /* the deck is fire-and-forget, like the station remote */ });
        });
      });
      var camera = el.querySelector("[data-camera]");
      var webcam = api.webcam || root.MadridWebcam;
      if (!webcam) { camera.disabled = true; return; }
      cameraButtons.push(camera);
      if (!watching) { watching = true; webcam.onChange(function () { paintCamera(webcam); }); }
      camera.addEventListener("click", function () {
        if (webcam.status().state === "live") { webcam.release(); return; }
        webcam.forget();
        webcam.request(REASON).then(function () { paintCamera(webcam); });
      });
      paintCamera(webcam);
    }
  });
}(window));
