/* STAIN TV / CH 23 — broadcast timeline.
 *
 * Pure arithmetic, no DOM, so the whole schedule can be asserted headlessly
 * under the repo's Electron-as-node runner. The driver in stain-tv.js is the
 * only thing that touches the page.
 *
 * One full broadcast:
 *   loop      10 x 14s   the frozen CH 21 COMING SOON card, sad horn each pass
 *   bleed     45s        white goes red, the bears begin to vogue
 *   flesh     55s        tissue grows in from the sides of the head
 *   fill      35s        they reach the glass
 *   anvil     7s         the drop; the horn stops mid-descent
 *   chorus    35s        squelch turns into harmony, the wash clears the dark
 *   evidence  30s        the tape, in silence
 * then back to loop, forever, until the dial moves.
 */
(function (global) {
  "use strict";

  var LOOP_MS = 14000;
  var LOOP_COUNT = 10;

  var PHASES = [
    { name: "loop", ms: LOOP_MS * LOOP_COUNT },
    { name: "bleed", ms: 45000 },
    { name: "flesh", ms: 55000 },
    { name: "fill", ms: 35000 },
    { name: "anvil", ms: 7000 },
    { name: "chorus", ms: 35000 },
    { name: "evidence", ms: 30000 }
  ];

  var TOTAL_MS = PHASES.reduce(function (sum, phase) { return sum + phase.ms; }, 0);
  // Everything after the ten loops is the descent; the second and later
  // broadcasts still open with the full ten loops, exactly as the first did.
  var DESCENT_START_MS = LOOP_MS * LOOP_COUNT;

  function phaseAt(elapsedMs) {
    var elapsed = Math.max(0, elapsedMs);
    // The broadcast repeats forever rather than ending.
    var cyclePosition = elapsed % TOTAL_MS;
    var cycle = Math.floor(elapsed / TOTAL_MS);
    var offset = 0;
    for (var i = 0; i < PHASES.length; i += 1) {
      var phase = PHASES[i];
      if (cyclePosition < offset + phase.ms) {
        var into = cyclePosition - offset;
        return {
          phase: phase.name,
          progress: phase.ms ? into / phase.ms : 0,
          intoPhaseMs: into,
          phaseMs: phase.ms,
          // Which of the ten COMING SOON passes we are on, 0-based.
          loopIndex: phase.name === "loop" ? Math.floor(into / LOOP_MS) : -1,
          loopProgress: phase.name === "loop" ? (into % LOOP_MS) / LOOP_MS : 0,
          cycle: cycle,
          elapsedMs: elapsed
        };
      }
      offset += phase.ms;
    }
    // Unreachable while PHASES sums to TOTAL_MS; kept so a future edit that
    // breaks that invariant fails loudly instead of returning undefined.
    throw new Error("stain timeline overran its own phase table");
  }

  function phaseStartMs(name) {
    var offset = 0;
    for (var i = 0; i < PHASES.length; i += 1) {
      if (PHASES[i].name === name) { return offset; }
      offset += PHASES[i].ms;
    }
    return -1;
  }

  var StainTimeline = {
    LOOP_MS: LOOP_MS,
    LOOP_COUNT: LOOP_COUNT,
    TOTAL_MS: TOTAL_MS,
    DESCENT_START_MS: DESCENT_START_MS,
    PHASES: PHASES,
    phaseAt: phaseAt,
    phaseStartMs: phaseStartMs
  };

  global.StainTimeline = StainTimeline;
  if (typeof module === "object" && module.exports) {
    module.exports = StainTimeline;
  }
})(typeof window === "undefined" ? this : window);
