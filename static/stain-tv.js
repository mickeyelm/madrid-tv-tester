/* STAIN TV / CH 23 — broadcast driver.
 *
 * Owns the DOM for #layer-stain. Schedule comes from stain-timeline.js and all
 * sound from stain-audio.js; this file only paints and cues.
 *
 * The bears are built here rather than sitting in tv.html because they need a
 * second, non-line-drawing existence: the CH 21 card draws them as strokes,
 * and the descent grows solid tissue inside those same strokes. Building both
 * from one geometry table keeps the flesh registered to the lines.
 */
(function (global) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  // The five bears, in the CH 21 card's own arrangement.
  var BEARS = [
    { x: 80, y: 40, scale: 1 },
    { x: 270, y: 70, scale: 0.85 },
    { x: 440, y: 120, scale: 0.58 },
    { x: 560, y: 135, scale: 0.52 },
    { x: 680, y: 90, scale: 0.72 }
  ];

  // One bear, in local coordinates, matching the CH 21 stick figure exactly.
  var HEAD = { cx: 85, cy: 78, r: 54 };
  var EARS = [{ cx: 48, cy: 38, r: 23 }, { cx: 122, cy: 38, r: 23 }];
  var EYES = [{ cx: 68, cy: 70, r: 4 }, { cx: 102, cy: 70, r: 4 }];
  var MOUTH = "M70 95 Q85 106 100 95";
  var BODY = "M85 132 L85 240 M85 158 L28 205 M85 158 L142 205 " +
             "M85 240 L42 302 M85 240 L128 302";
  // The hollows the crawlers travel: spine, then each arm, then each leg.
  var CHANNELS = [
    "M85 132 L85 240",
    "M85 158 L28 205",
    "M85 158 L142 205",
    "M85 240 L42 302",
    "M85 240 L128 302"
  ];

  function el(name, attributes) {
    var node = document.createElementNS(SVG_NS, name);
    for (var key in attributes) {
      if (Object.prototype.hasOwnProperty.call(attributes, key)) {
        node.setAttribute(key, attributes[key]);
      }
    }
    return node;
  }

  function StainTV(root) {
    this.root = root;
    this.stage = root.querySelector(".stain-stage");
    this.evidence = root.querySelector(".stain-evidence");
    this.anvil = root.querySelector(".stain-anvil");
    this.wash = root.querySelector(".stain-wash");
    this.audio = new global.StainAudio();
    this.timeline = global.StainTimeline;
    this.bears = [];
    this.running = false;
    this.startedAt = 0;
    this.frame = null;
    this.lastPhase = "";
    this.lastLoopIndex = -1;
    this.shepardLayers = 0;
    this.lastMarchBeat = -1;
    this.lastHorrorBar = -1;
    this._build();
  }

  StainTV.prototype._build = function () {
    if (!this.stage || this.stage.querySelector("svg")) { return; }
    var svg = el("svg", {
      viewBox: "0 0 900 330",
      class: "stain-bears",
      role: "img",
      "aria-label": "A family of stick figure bears"
    });
    var defs = el("defs", {});
    var corrupt = el("filter", {
      id: "stain-corrupt", x: "-20%", y: "-20%", width: "140%", height: "140%"
    });
    corrupt.appendChild(el("feTurbulence", {
      type: "fractalNoise", baseFrequency: ".018 .11", numOctaves: "2", seed: "23", result: "rot"
    }));
    corrupt.appendChild(el("feDisplacementMap", {
      "in": "SourceGraphic", in2: "rot", scale: "11", xChannelSelector: "R", yChannelSelector: "B"
    }));
    defs.appendChild(corrupt);
    svg.appendChild(defs);

    for (var i = 0; i < BEARS.length; i += 1) {
      var bear = BEARS[i];
      var group = el("g", {
        class: "stain-bear",
        transform: "translate(" + bear.x + " " + bear.y + ") scale(" + bear.scale + ")"
      });

      // Tissue is clipped to the head so it can only ever grow inside the
      // outline the bear already had.
      var clipId = "stain-head-" + i;
      var clip = el("clipPath", { id: clipId });
      clip.appendChild(el("circle", { cx: HEAD.cx, cy: HEAD.cy, r: HEAD.r }));
      defs.appendChild(clip);

      var flesh = el("g", { class: "stain-flesh", "clip-path": "url(#" + clipId + ")" });
      // Two masses entering from the sides of the skull, meeting at the front.
      flesh.appendChild(el("ellipse", {
        class: "stain-flesh-mass stain-flesh-left",
        cx: HEAD.cx, cy: HEAD.cy, rx: 46, ry: 54
      }));
      flesh.appendChild(el("ellipse", {
        class: "stain-flesh-mass stain-flesh-right",
        cx: HEAD.cx, cy: HEAD.cy, rx: 46, ry: 54
      }));
      var veins = el("g", { class: "stain-veins" });
      veins.appendChild(el("path", { d: "M38 54 Q65 63 82 102 M132 51 Q106 64 88 105" }));
      veins.appendChild(el("path", { d: "M47 88 Q69 78 82 45 M123 90 Q101 78 88 44" }));
      veins.appendChild(el("path", { d: "M58 112 Q74 92 85 77 Q96 92 114 112" }));
      flesh.appendChild(veins);
      group.appendChild(flesh);

      // Openings the tissue leaves behind: sockets, then a mouth, then teeth.
      var openings = el("g", { class: "stain-openings" });
      for (var e = 0; e < EYES.length; e += 1) {
        openings.appendChild(el("ellipse", {
          class: "stain-socket",
          cx: EYES[e].cx, cy: EYES[e].cy, rx: 11, ry: 13
        }));
      }
      openings.appendChild(el("path", {
        class: "stain-maw",
        d: "M62 92 Q85 84 108 92 Q85 126 62 92 Z"
      }));
      var teeth = el("g", { class: "stain-teeth" });
      for (var t = 0; t < 7; t += 1) {
        var tx = 65 + t * 7;
        var down = t % 2 === 0;
        teeth.appendChild(el("path", {
          d: down
            ? "M" + tx + " 92 L" + (tx + 4) + " 92 L" + (tx + 2) + " 104 Z"
            : "M" + tx + " 110 L" + (tx + 4) + " 110 L" + (tx + 2) + " 98 Z"
        }));
      }
      openings.appendChild(teeth);
      var buds = el("g", { class: "stain-bud-eyes" });
      var budPoints = [[52, 55], [84, 47], [116, 57], [55, 95], [115, 94]];
      for (var b = 0; b < budPoints.length; b += 1) {
        buds.appendChild(el("circle", { cx: budPoints[b][0], cy: budPoints[b][1], r: b === 1 ? 4 : 3 }));
      }
      openings.appendChild(buds);
      group.appendChild(openings);

      var anatomy = el("g", { class: "stain-anatomy" });
      anatomy.appendChild(el("path", { d: BODY }));
      anatomy.appendChild(el("circle", { cx: 85, cy: 184, r: 9 }));
      anatomy.appendChild(el("circle", { cx: 85, cy: 210, r: 7 }));
      group.appendChild(anatomy);

      // The original line drawing, still on top: the bear never stops being
      // the drawing, it just fills up.
      var lines = el("g", { class: "stain-lines" });
      lines.appendChild(el("circle", HEAD));
      for (var a = 0; a < EARS.length; a += 1) { lines.appendChild(el("circle", EARS[a])); }
      var pupils = el("g", { class: "stain-pupils" });
      for (var p = 0; p < EYES.length; p += 1) { pupils.appendChild(el("circle", EYES[p])); }
      lines.appendChild(pupils);
      lines.appendChild(el("path", { class: "stain-smile", d: MOUTH }));
      lines.appendChild(el("path", { d: BODY }));
      group.appendChild(lines);

      // Things moving through the hollows of the body.
      var crawlers = [];
      var tracks = el("g", { class: "stain-tracks" });
      for (var c = 0; c < CHANNELS.length; c += 1) {
        var track = el("path", { d: CHANNELS[c], class: "stain-track" });
        tracks.appendChild(track);
        var blob = el("circle", { class: "stain-crawler", cx: 0, cy: 0, r: 5 });
        tracks.appendChild(blob);
        crawlers.push({ track: track, blob: blob, offset: c * 0.17, rate: 0.6 + c * 0.13 });
      }
      // One more that leaves: it runs the spine and sprouts under the jaw.
      var jaw = el("circle", { class: "stain-crawler stain-crawler-jaw", cx: 85, cy: 120, r: 0 });
      tracks.appendChild(jaw);
      group.appendChild(tracks);

      svg.appendChild(group);
      this.bears.push({ group: group, crawlers: crawlers, jaw: jaw, index: i });
    }
    this.stage.appendChild(svg);
  };

  StainTV.prototype.start = function () {
    if (this.running) { return; }
    this.running = true;
    this.startedAt = Date.now();
    this.lastPhase = "";
    this.lastLoopIndex = -1;
    this.shepardLayers = 0;
    this.lastMarchBeat = -1;
    this.lastHorrorBar = -1;
    this.audio.ready();
    this.audio.unsilence();
    this.root.classList.add("is-live");
    this._tick();
  };

  StainTV.prototype.stop = function () {
    if (!this.running) { return; }
    this.running = false;
    if (this.frame) { global.cancelAnimationFrame(this.frame); this.frame = null; }
    this.audio.stop();
    this.root.classList.remove("is-live");
    this.root.setAttribute("data-phase", "loop");
    this.root.removeAttribute("data-march");
    this._paint(0, 0, 0, 0);
  };

  StainTV.prototype._tick = function () {
    if (!this.running) { return; }
    // Re-arm BEFORE painting. A throw inside _applyPhase used to end the
    // broadcast permanently — the channel would sit frozen on whatever frame
    // it died on, which on this set is indistinguishable from a dead TV.
    var self = this;
    this.frame = global.requestAnimationFrame(function () { self._tick(); });
    this.step(Date.now() - this.startedAt);
  };

  /* Paint one frame at an arbitrary elapsed time. Separate from _tick so the
   * broadcast can be stepped without a clock — which is how it gets verified
   * headlessly, where requestAnimationFrame is throttled to nothing. */
  StainTV.prototype.step = function (elapsedMs) {
    try {
      this._applyPhase(this.timeline.phaseAt(elapsedMs));
    } catch (error) {
      if (global.console && global.console.error) {
        global.console.error("[stain] frame failed", error);
      }
    }
  };

  /* Cue points fire once on entry; everything continuous is derived from
   * progress so a dropped frame cannot desync the picture from the sound. */
  StainTV.prototype._applyPhase = function (at) {
    var ctx = this.audio.ctx;
    var now = ctx ? ctx.currentTime : 0;

    if (at.phase !== this.lastPhase) {
      this.root.setAttribute("data-phase", at.phase);
      this._enterPhase(at, now);
      this.lastPhase = at.phase;
    }

    if (at.phase === "loop") {
      // One defeated horn per pass.
      if (at.loopIndex !== this.lastLoopIndex) {
        this.lastLoopIndex = at.loopIndex;
        // Sound it against the shatter, ~9.2s into the 14s card.
        this.audio.sadHorn(now + 9.2, { level: 0.5 });
      }
      this._paint(0, 0, 0, 0);
      return;
    }
    this.lastLoopIndex = -1;

    var red = 0, flesh = 0, approach = 0, wash = 0;
    if (at.phase === "bleed") {
      red = at.progress * 0.45;
      approach = at.progress * 0.12;
    } else if (at.phase === "flesh") {
      red = 0.45 + at.progress * 0.3;
      flesh = at.progress;
      approach = 0.12 + at.progress * 0.3;
      this._growShepard(at, now, 6);
    } else if (at.phase === "fill") {
      red = 0.75 + at.progress * 0.25;
      flesh = 1;
      approach = 0.42 + at.progress * 0.58;
      this._growShepard(at, now, 9);
    } else if (at.phase === "anvil") {
      red = 1;
      flesh = 1;
      approach = 1;
    } else if (at.phase === "chorus") {
      red = Math.max(0, 1 - at.progress * 1.15);
      flesh = Math.max(0, 1 - at.progress * 1.4);
      approach = Math.max(0, 1 - at.progress);
      wash = at.progress;
    } else if (at.phase === "evidence") {
      wash = 1;
    }
    this._paint(red, flesh, approach, wash);
    if (flesh > 0) { this._crawl(at, flesh); }
    if (red > 0) { this._vogue(at, red, flesh, now); }
  };

  StainTV.prototype._enterPhase = function (at, now) {
    if (at.phase === "bleed") {
      var shepard = this.audio.createShepard();
      shepard.start(now);
      shepard.addLayer(now, 0);
      shepard.swell(now, 8, 0.5);
      this.audio.horrorHorn(now + 0.15, 0.32, 0);
      this.shepardLayers = 1;
    } else if (at.phase === "anvil") {
      // The drop lands 3.9s in; the horn does not fade, it is interrupted.
      var impact = now + 3.9;
      if (this.audio.shepard) { this.audio.shepard.kill(impact); }
      this.root.style.setProperty("--stain-anvil-delay", "0s");
    } else if (at.phase === "chorus") {
      this.audio.fartChorus(now, 34);
    } else if (at.phase === "evidence") {
      this.audio.silence(now);
    } else if (at.phase === "loop") {
      // Coming back around after the evidence.
      this.audio.stop();
      this.audio.unsilence();
      this.shepardLayers = 0;
    }
  };

  StainTV.prototype._growShepard = function (at, now, target) {
    if (!this.audio.shepard) { return; }
    var want = Math.min(target, 1 + Math.floor(at.progress * target));
    while (this.shepardLayers < want) {
      this.audio.shepard.addLayer(now, this.shepardLayers);
      this.shepardLayers += 1;
    }
  };

  StainTV.prototype._paint = function (red, flesh, approach, wash) {
    var style = this.root.style;
    style.setProperty("--stain-red", red.toFixed(3));
    style.setProperty("--stain-flesh", flesh.toFixed(3));
    style.setProperty("--stain-approach", approach.toFixed(3));
    style.setProperty("--stain-wash", wash.toFixed(3));
  };

  /* Angular pose snaps on a beat rather than a smooth sway — voguing, not
   * dancing. Each bear is offset so they never hit the same pose together. */
  StainTV.prototype._vogue = function (at, red, flesh, now) {
    var beat = Math.floor(at.elapsedMs / 430);
    var impact = Math.min(1, red * 0.72 + flesh * 0.48);
    if (beat !== this.lastMarchBeat) {
      this.audio.marchArmy(now, impact, beat);
      this.lastMarchBeat = beat;
      this.root.setAttribute("data-march", String(beat % 2));
    }
    var horrorBar = Math.floor(beat / 8);
    if (horrorBar !== this.lastHorrorBar) {
      this.audio.horrorHorn(now + 0.03, impact, horrorBar);
      this.lastHorrorBar = horrorBar;
    }
    for (var i = 0; i < this.bears.length; i += 1) {
      var bear = this.bears[i];
      var step = (beat + i * 2) % 4;
      var tilt = [-8 - flesh * 5, 5 + flesh * 4, -4 - flesh * 3, 10 + flesh * 6][step];
      var lift = [0, -7 - flesh * 5, 4 + flesh * 3, -10 - flesh * 7][step];
      var base = BEARS[i];
      bear.group.setAttribute(
        "transform",
        "translate(" + base.x + " " + (base.y + lift) + ") " +
        "scale(" + base.scale + ") rotate(" + tilt + " 85 160)"
      );
    }
  };

  /* Crawlers ride the limb hollows; the jaw one emerges only once the tissue
   * is dense enough to have somewhere to emerge from. */
  StainTV.prototype._crawl = function (at, flesh) {
    var seconds = at.elapsedMs / 1000;
    for (var i = 0; i < this.bears.length; i += 1) {
      var bear = this.bears[i];
      for (var c = 0; c < bear.crawlers.length; c += 1) {
        var crawler = bear.crawlers[c];
        var track = crawler.track;
        var total = track.getTotalLength ? track.getTotalLength() : 0;
        if (!total) { continue; }
        var t = (seconds * crawler.rate + crawler.offset + i * 0.31) % 1;
        var point = track.getPointAtLength(t * total);
        crawler.blob.setAttribute("cx", point.x);
        crawler.blob.setAttribute("cy", point.y);
        crawler.blob.setAttribute("r", (3 + 3 * flesh).toFixed(2));
      }
      var sprout = Math.max(0, flesh - 0.55) / 0.45;
      bear.jaw.setAttribute("r", (sprout * 9).toFixed(2));
      bear.jaw.setAttribute("cy", (120 + sprout * 26).toFixed(2));
    }
  };

  function boot() {
    var root = document.getElementById("layer-stain");
    if (!root || !global.StainTimeline || !global.StainAudio) { return; }
    var channel = new StainTV(root);
    global.MadridStain = {
      sync: function (state) {
        // The broadcast restarts from loop 1 every time the dial arrives, so
        // the ten-loop wait is always honoured.
        if (state && state.channel === "stain") { channel.start(); }
        else { channel.stop(); }
      },
      channel: channel
    };
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }

  global.StainTV = StainTV;
  if (typeof module === "object" && module.exports) {
    module.exports = { StainTV: StainTV };
  }
})(typeof window === "undefined" ? this : window);
