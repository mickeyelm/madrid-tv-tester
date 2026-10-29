/* CH 12 — lazy entrypoint shared by the station and local preview. */
(function () {
  "use strict";
  var canvas = document.getElementById("aquarium-canvas");
  if (!canvas) return;
  var runtime = null, loading = null, requested = false, state = {}, error = null;
  var view = "scene", disposed = false;
  var roomClient = null, roomModule = null, roomLoading = null, syncCanvas = null, syncFrame = null;
  var station = false; // web edition: the room output (projector extension) is not shipped
  function roomSync() {
    if (!roomClient || !roomModule) return;
    var room = roomClient.state;
    if (runtime) runtime.setRoomSource(room && room.enabled ? function () { return roomClient.frame(); } : null);
    if (syncFrame !== null) cancelAnimationFrame(syncFrame);
    syncFrame = null;
    var testing = requested && room && room.enabled && room.sync_test && !state.desktop_mode;
    if (testing && !syncCanvas) {
      syncCanvas = document.createElement("canvas");
      syncCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:2";
      canvas.parentElement.appendChild(syncCanvas);
    }
    if (syncCanvas) syncCanvas.hidden = !testing;
    if (testing) {
      var draw = function () {
        var width = canvas.clientWidth, height = canvas.clientHeight;
        if (syncCanvas.width !== width) syncCanvas.width = width;
        if (syncCanvas.height !== height) syncCanvas.height = height;
        var frame = roomClient.frame(); if (frame) roomModule.drawSync(syncCanvas, frame);
        syncFrame = requestAnimationFrame(draw);
      };
      draw();
    }
  }
  function connectRoom() {
    if (!station || roomClient || roomLoading || !requested) return;
    roomLoading = Promise.all([import("./room-client.mjs?v=20261003room3"), import("./room-core.mjs?v=20261003room5")]).then(function (modules) {
      if (disposed || !requested) return;
      roomModule = modules[1];
      roomClient = modules[0].createRoomClient({ output: "tv", onState: function () { roomSync(); sync(); } });
    }).catch(function (failure) { console.warn("Room output unavailable:", failure); }).finally(function () { roomLoading = null; });
  }
  function sync() {
    if (disposed) return;
    connectRoom();
    if (runtime) {
      var selected = state.programming && state.programming.selected;
      var presentation = selected && selected.channel === "aquarium" &&
        selected.status === "scheduled" ? selected.presentation || {} : {};
      var room = roomClient && roomClient.state;
      runtime.setProfile(room && room.enabled ? room.profile || "reef" : presentation.profile || "reef");
      runtime.setVisible(!document.hidden);
      runtime.setView(presentation.view || view);
      runtime.setActive(requested && !(room && room.enabled && room.sync_test), state);
      return;
    }
    if (!requested || document.hidden || state.desktop_mode || loading || error) return;
    loading = import("./aquarium/runtime.js?v=20261003room8").then(function (module) {
      if (disposed) return;
      runtime = module.createAquarium(canvas);
      roomSync();
      sync();
    }).catch(function (failure) {
      error = String(failure.message || failure);
      console.error("CH 12 aquarium:", failure);
    }).finally(function () { loading = null; });
  }
  function visibility() { sync(); }
  function resize() { if (runtime) runtime.resize(); }
  function unlock() { if (runtime) runtime.unlockAudio(); }
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("resize", resize);
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  window.MadridAquarium = Object.freeze({
    setActive: function (value, nextState) {
      if (value && !requested) error = null;
      requested = Boolean(value); state = nextState || {}; sync();
      if (!requested && roomClient) { roomClient.dispose(); roomClient = null; if (runtime) runtime.setRoomSource(null); }
      if (!requested && syncFrame !== null) { cancelAnimationFrame(syncFrame); syncFrame = null; }
      if (!requested && syncCanvas) syncCanvas.hidden = true;
    },
    setView: function (value) { view = value === "portrait" ? "portrait" : "scene"; if (runtime) runtime.setView(view); },
    get diagnostics() {
      var roomClock = roomClient ? Object.freeze({
        uncertaintyMs: roomClient.clock.uncertaintyMs,
        ageMs: roomClient.clock.ageMs,
        seconds: roomClient.clock.time() / 1000,
        epoch: roomClient.state && roomClient.state.scene_epoch_ms
      }) : null;
      return Object.freeze(Object.assign({}, runtime ? runtime.diagnostics() :
        { active: false, loading: Boolean(loading), ready: false, error: error }, { roomClock: roomClock }));
    },
    dispose: function () {
      disposed = true; requested = false;
      if (runtime) runtime.dispose();
      if (roomClient) roomClient.dispose();
      if (syncFrame !== null) cancelAnimationFrame(syncFrame);
      if (syncCanvas) syncCanvas.remove();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    }
  });
}());
