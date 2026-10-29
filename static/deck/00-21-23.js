/* MADRiD TV Web: THE REMOTE's CH 21 panel, remote.html:183-189 / remote.js:1450-1453.
 * CH 00 and CH 23 have no panel on the station remote and get none here. */
(function (root) {
  "use strict";
  if (!root.MadridDeck) { return; }
  root.MadridDeck.register("facetime", {
    title: "FACETIME / COLD STORAGE",
    mount: function (el) {
      var status = document.createElement("p");
      status.className = "facetime-remote-status";
      status.textContent = "COMING SOON.... CAMERA, MIC, OBS, AND NATIVE FACETIME ARE OFF.";
      el.appendChild(status);
    }
  });
}(window));
