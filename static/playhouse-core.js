(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  if (root) { root.MadridPlayhouseCore = api; }
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var ROUND_SECONDS = 240;
  var BINSKY_SECONDS = 25;

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, Number(value) || 0));
  }

  function pad(value, length) {
    var text = String(Math.max(0, Math.floor(value)));
    while (text.length < length) { text = "0" + text; }
    return text;
  }

  function formatTime(seconds) {
    var safe = Math.max(0, Math.ceil(Number(seconds) || 0));
    return pad(Math.floor(safe / 60), 2) + ":" + pad(safe % 60, 2);
  }

  function rankForScore(score) {
    score = Math.max(0, Number(score) || 0);
    if (score >= 150000) { return "CATASTROPHIC PLAYHOUSE"; }
    if (score >= 75000) { return "MARLIN MENACE"; }
    if (score >= 30000) { return "PROPERTY DAMAGE"; }
    if (score >= 8000) { return "SERIOUS MESS"; }
    return "ROOM TONE";
  }

  function collisionAward(impact, type, combo) {
    impact = clamp(impact, 0, 28);
    combo = clamp(combo, 1, 24);
    var multiplier = {
      vhs: 1.0,
      cassette: 1.1,
      laundry: 0.65,
      analog: 2.4,
      furniture: 1.8,
      glass: 2.0
    }[type] || 1.0;
    return Math.max(0, Math.round((impact * impact * 1.8 + 8) * multiplier * combo));
  }

  function collisionLabel(type, combo, impact) {
    if (type === "analog" && impact > 5) { return "ANALOG SACRILEGE"; }
    if (type === "vhs" && combo >= 5) { return "LOAD-BEARING VHS"; }
    if (combo >= 10) { return "MARLIN MAYHEM"; }
    if (combo >= 6) { return "COLLATERAL"; }
    if (impact >= 8) { return "BANK SHOT"; }
    if (combo >= 3) { return "DOMINO DAMAGE"; }
    return "PROPERTY DAMAGE";
  }

  function mapJoint(joint, depthScale) {
    joint = joint || {};
    var z = typeof joint.z === "number" ? joint.z : 1800;
    return {
      x: (0.5 - clamp(joint.x, 0, 1)) * 3.6,
      y: 0.08 + clamp(joint.y, 0, 1) * 2.75,
      z: clamp((z - 1800) / 1000, -0.7, 0.7) * (depthScale || 0.7)
    };
  }

  return {
    ROUND_SECONDS: ROUND_SECONDS,
    BINSKY_SECONDS: BINSKY_SECONDS,
    clamp: clamp,
    formatTime: formatTime,
    rankForScore: rankForScore,
    collisionAward: collisionAward,
    collisionLabel: collisionLabel,
    mapJoint: mapJoint
  };
}));
