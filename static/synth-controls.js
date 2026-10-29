/* Pure gesture controller for the destructive SYNTH VISIONS ERASE key. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SynthControls = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function createEraseGesture(clock, actions) {
    var repeatTimer = null;
    var clearTimer = null;
    var held = false;
    var repeats = 0;
    var cleared = false;

    function cancelTimers() {
      if (repeatTimer !== null) { clock.clearInterval(repeatTimer); }
      if (clearTimer !== null) { clock.clearTimeout(clearTimer); }
      repeatTimer = null;
      clearTimer = null;
    }

    return {
      down: function () {
        if (held) { return; }
        held = true;
        repeats = 0;
        cleared = false;
        repeatTimer = clock.setInterval(function () {
          if (!held || cleared) { return; }
          repeats += 1;
          actions.erase();
        }, 700);
        clearTimer = clock.setTimeout(function () {
          if (!held) { return; }
          cleared = true;
          if (repeatTimer !== null) { clock.clearInterval(repeatTimer); repeatTimer = null; }
          actions.clear();
        }, 3000);
      },
      up: function () {
        if (!held) { return; }
        held = false;
        cancelTimers();
        if (!cleared && repeats === 0) { actions.erase(); }
      },
      cancel: function () {
        held = false;
        cancelTimers();
      },
      state: function () { return { held: held, repeats: repeats, cleared: cleared }; }
    };
  }

  return { createEraseGesture: createEraseGesture };
}));
