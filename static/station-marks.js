/* MADRiD TV Web: Jeremy's marks on the station (static/marks/, copied from
 * _Outputs/JeremyMadridTVMarks-20261029/motion, approved by MADRiD 2026-10-29).
 * The cyclone (vortex) is the places: boot, OFF AIR, the moment of tuning. Scratchy is on air: the
 * bug, bottom right, in plasma-orange DOS text. Both sit in the overlay's square 1280x720, never in
 * the program area, whose pixels are stretched 4:3 to 16:9.
 * station.js says what is on air with a "madrid:tuned" event ({id, bug, boot}); MadridShell.tuned()
 * gives the last one, for a page that announced before this module ran. */
import {mountMark} from "./marks/madrid-mark.js";
import {mountText} from "./marks/madrid-text.js";

const overlay = document.getElementById("overlay");
const bug = document.getElementById("station-bug");
const black = document.getElementById("boot-black");
const TUNING_MS = 1500;

const cycloneHost = document.createElement("div");
cycloneHost.id = "cyclone";
cycloneHost.setAttribute("role", "img"); cycloneHost.setAttribute("aria-label", "MADRiD TV");
overlay.appendChild(cycloneHost);
let cyclone = null, booting = Boolean(black), onAir = null;

function showCyclone(state) {
  cycloneHost.classList.add("is-shown");
  if (cyclone) { cyclone.then(c => c && c.play(state)); return; }
  cyclone = mountMark(cycloneHost, {mark: "vortex", state}).catch(() => null);
}
function hideCyclone() {
  cycloneHost.classList.remove("is-shown");
  const going = cyclone; cyclone = null;
  if (going) window.setTimeout(() => going.then(c => { if (c && !cyclone) c.dispose(); }), 900);   // after the fade
}

// The bug: scratchy, with the cyclone standing in for it while a channel tunes.
let tag = null, tuning = null, tuneTimer = 0;
const tagHost = document.createElement("div"), tuneHost = document.createElement("div");
if (bug) {
  tagHost.className = "bug-tag"; tuneHost.className = "bug-cyclone";
  bug.append(tuneHost, tagHost);
  bug.classList.add("has-mark");
  tag = mountText(tagHost, {mark: "scratchy", cols: 72, state: "in", label: "MADRiD TV"}).catch(() => { bug.classList.remove("has-mark"); return null; });
  // Mounted once and kept (about 0.2 ms a frame): building it on each tune could outlast the tune.
  tuning = mountMark(tuneHost, {mark: "vortex", state: "idle"}).catch(() => null);
}
function tuneBug() {
  if (!tag) return;
  if (!bug.classList.contains("is-tuning")) tuning.then(c => c && c.play("loading"));
  bug.classList.add("is-tuning");
  window.clearTimeout(tuneTimer);
  tuneTimer = window.setTimeout(() => {
    bug.classList.remove("is-tuning");
    tag.then(c => c && c.play("in"));
    tuning.then(c => c && c.play("idle"));
  }, TUNING_MS);
}

function tuned(detail) {
  if (!detail) return;
  const wasOffAir = onAir === "off-air";
  onAir = detail.id;
  if (onAir === "off-air") { if (!wasOffAir && !booting) showCyclone("in"); }
  else if (!booting) hideCyclone();
  if (!detail.boot && detail.bug) tuneBug();
}
window.addEventListener("madrid:tuned", event => tuned(event.detail));

// Boot: the cyclone ignites over black (its "in" reads in about 2.4 s), then the picture shows and the
// cyclone stays only on OFF AIR. However slowly the mark loads, the boot ends 4 s after the page did.
if (booting) {
  black.classList.add("is-live");
  showCyclone("in");
  const end = () => {
    if (!booting) return;
    booting = false;
    black.classList.remove("is-shown");
    if (onAir !== "off-air") hideCyclone();
  };
  cyclone.then(() => window.setTimeout(end, 2400));
  window.setTimeout(end, 4000);
}
const shell = window.MadridShell;
if (shell && typeof shell.tuned === "function") tuned(shell.tuned());
