/* MADRiD TV Web: CH 19 diK-pix FAMILY EDITION 2000, the station server's part.
 * Port of channel_core.py's dikpix store: bounds and whitelists (270-293),
 * default board (700-712), sanitizer (1114-1193), validators (2168-2232),
 * action normalizer (2235-2371), snapshot and presence (2382-2456),
 * add/undo/redo/clear (2484-2537), scene ops (2539-2589), show ops
 * (2591-2615), play effect (2617-2624); and channel_server.py's POST routes
 * (1898-1959). One visitor is the one hand: the board lives in this page and
 * in localStorage, nothing leaves the browser. The station's picture-audio
 * import (/api/dikpix/audio, ffmpeg) is not here; the remote module keeps a
 * recording as a blob: URL (tools/manifest.19.json) and this store accepts
 * that form. Load after static/station-api.js, before dikpix-core.js. */
(function (root) {
  "use strict";
  var API = root.MadridStationAPI;
  if (!API) { return; }
  var S = API.state;
  var STORE = "madrid-tv-web.dikpix";
  var storage = null;
  try { storage = root.localStorage || null; } catch (e) { storage = null; }

  // --- channel_core.py 270-293 ----------------------------------------------
  var MAX_ACTIONS = 1024, MAX_PAGES = 12, MAX_POINTS = 256, MAX_PLAYERS = 8, PLAYER_TTL = 12;
  var TOOLS = ["pencil", "marker", "spray", "eraser", "crayon", "chalk", "ribbon", "bubbles", "creatures"];
  var SHAPES = ["rectangle", "ellipse", "triangle"];
  var STAMPS = ["star", "heart", "flower", "smile", "lightning", "cat", "alien", "robot", "ufo", "fish", "eye"];
  var MOTIONS = ["still", "bounce", "orbit", "wiggle", "spin"];
  var TRANSITIONS = ["cut", "fade", "wipe"];
  var SOUNDTRACKS = ["off", "toybox", "dream", "disco"];
  var EFFECTS = ["wiggle", "confetti", "mirror", "spin", "squish", "invert"];
  var MIXERS = ["mirror", "invert", "mosaic"];
  var FILLS = ["solid", "gradient", "checkers", "stripes"];
  var COLORS = ["#171717", "#f0ede8", "#ff4f00", "#e3362d", "#f5c400", "#28a745", "#0044ff", "#18a6c9", "#8b45aa", "#f05d9d"];
  var PLAYER_COLORS = ["#ff4f00", "#0044ff", "#28a745", "#f5c400", "#e3362d", "#8b45aa", "#18a6c9", "#f05d9d"];

  function fail(message) { throw new Error(message); }
  function isInt(v) { return typeof v === "number" && Number.isInteger(v); }
  function isPlain(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function collapse(text) { return text.split(/\s+/).filter(Boolean).join(" "); }

  // --- validators (channel_core.py 2168-2232, 2626-2636) ---------------------
  function number(value, name) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) { fail("invalid dikpix " + name); }
    return value;
  }
  function color(value) {
    if (typeof value !== "string") { fail("invalid dikpix color"); }
    value = value.toLowerCase();
    if (COLORS.indexOf(value) === -1) { fail("invalid dikpix color"); }
    return value;
  }
  function size(value, low, high) {
    low = low === undefined ? 1 : low; high = high === undefined ? 72 : high;
    var v = value;
    if (typeof v === "string" && v.trim()) { v = Number(v); }
    if (typeof v !== "number" || !Number.isFinite(v) || v < low || v > high) { fail("invalid dikpix size"); }
    return v;
  }
  function identifier(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) { fail("invalid dikpix identifier"); }
    return value;
  }
  function validClient(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value); }

  function normalizePage(data) {
    var result = {};
    ["title", "audio_name"].forEach(function (key) {
      if (!(key in data)) { return; }
      var value = data[key];
      if (typeof value !== "string" || value.length > 64) { fail("invalid dikpix " + key); }
      value = collapse(value);
      if (key === "title" && !value) { fail("invalid dikpix title"); }
      result[key] = value;
    });
    if ("duration" in data) { result.duration = size(data.duration, 0.2, 45); }
    if ("transition" in data) {
      if (TRANSITIONS.indexOf(data.transition) === -1) { fail("invalid dikpix transition"); }
      result.transition = data.transition;
    }
    if ("audio" in data) {
      var audio = data.audio;
      if (typeof audio !== "string") { fail("invalid dikpix audio"); }
      // The station accepted /dikpix-audio/<sha256>.<ext> from its own disk.
      // Here a recording is a blob: URL minted by this page, nothing else.
      if (audio && audio.slice(0, 5 + root.location.origin.length + 1) !== "blob:" + root.location.origin + "/") { fail("invalid dikpix audio"); }
      result.audio = audio;
    }
    return result;
  }

  function normalizeAction(c) {
    if (!isPlain(c)) { fail("invalid dikpix action"); }
    var kind = c.kind, col = color(c.color === undefined ? "#171717" : c.color), result;
    if (kind === "clear") { return {kind: "clear"}; }
    if (kind === "paper") { return {kind: "paper", color: col}; }
    if (kind === "mixer") {
      if (MIXERS.indexOf(c.effect) === -1) { fail("invalid dikpix mixer"); }
      return {kind: "mixer", effect: c.effect};
    }
    if (kind === "object" || kind === "object_update" || kind === "object_delete") {
      result = {kind: kind, object_id: identifier(c.object_id)};
      if (kind === "object_delete") { return result; }
      var fields = ["stamp", "color", "size", "x", "y", "motion", "rotation"];
      if (kind === "object_update" && !fields.some(function (key) { return key in c; })) { fail("empty dikpix object update"); }
      fields.forEach(function (key) {
        if (kind === "object_update" && !(key in c)) { return; }
        if (key === "stamp") { if (STAMPS.indexOf(c.stamp) === -1) { fail("invalid dikpix stamp"); } result.stamp = c.stamp; }
        else if (key === "color") { result.color = col; }
        else if (key === "size") { result.size = size(c.size === undefined ? 48 : c.size, 12, 160); }
        else if (key === "x" || key === "y") { result[key] = number(c[key], key); }
        else if (key === "motion") {
          var motion = c.motion === undefined ? "still" : c.motion;
          if (MOTIONS.indexOf(motion) === -1) { fail("invalid dikpix motion"); }
          result.motion = motion;
        } else if (key === "rotation") { result.rotation = size(c.rotation === undefined ? 0 : c.rotation, -360, 360); }
      });
      return result;
    }
    if (kind === "stroke") {
      if (TOOLS.indexOf(c.tool) === -1) { fail("invalid dikpix tool"); }
      if (!Array.isArray(c.points) || c.points.length < 1 || c.points.length > MAX_POINTS) { fail("invalid dikpix points"); }
      var points = c.points.map(function (point) {
        if (!Array.isArray(point) || point.length !== 2) { fail("invalid dikpix point"); }
        return [number(point[0], "x"), number(point[1], "y")];
      });
      result = {kind: "stroke", tool: c.tool, color: col, size: size(c.size === undefined ? 8 : c.size), points: points};
      if ("seed" in c) {
        if (!isInt(c.seed) || c.seed < 1 || c.seed > 2147483647) { fail("invalid dikpix seed"); }
        result.seed = c.seed;
      }
      return result;
    }
    if (kind === "line" || kind === "shape") {
      result = {kind: kind, color: col, size: size(c.size === undefined ? 6 : c.size),
        x1: number(c.x1, "x1"), y1: number(c.y1, "y1"), x2: number(c.x2, "x2"), y2: number(c.y2, "y2")};
      if (kind === "line") { result.tool = "line"; }
      else { if (SHAPES.indexOf(c.shape) === -1) { fail("invalid dikpix shape"); } result.shape = c.shape; }
      return result;
    }
    if (kind === "stamp") {
      if (STAMPS.indexOf(c.stamp) === -1) { fail("invalid dikpix stamp"); }
      return {kind: "stamp", stamp: c.stamp, color: col, size: size(c.size === undefined ? 36 : c.size, 12, 96), x: number(c.x, "x"), y: number(c.y, "y")};
    }
    if (kind === "text") {
      if (typeof c.text !== "string") { fail("invalid dikpix text"); }
      var text = collapse(c.text);
      if (!text || text.length > 64) { fail("invalid dikpix text"); }
      return {kind: "text", text: text, color: col, size: size(c.size === undefined ? 28 : c.size, 12, 64), x: number(c.x, "x"), y: number(c.y, "y")};
    }
    if (kind === "fill") {
      result = {kind: "fill", color: col, x: number(c.x, "x"), y: number(c.y, "y")};
      if ("style" in c) { if (FILLS.indexOf(c.style) === -1) { fail("invalid dikpix fill style"); } result.style = c.style; }
      return result;
    }
    fail("invalid dikpix action");
  }

  // --- the board (channel_core.py 700-712) ------------------------------------
  function defaultPage() { return {id: "page-1", title: "Scene 1", actions: [], redo: [], duration: 5, transition: "cut", audio: "", audio_name: ""}; }
  function defaultBoard() {
    var page = defaultPage();
    return {pages: [page], active_page: page.id, actions: page.actions, redo: page.redo,
      show: {playing: false, started_at: 0, loop: true, soundtrack: "off"}, rev: 0, next_action_id: 1, next_page_id: 2};
  }
  var board = defaultBoard();
  var players = {};            // client -> {slot, last_seen, last_action}
  var effect = "wiggle", effectRev = 0;

  function sanitize(candidate) {
    // channel_core.py 1114-1193. Picture audio is skipped on purpose: a blob:
    // URL dies with the page that minted it, so a restored scene is silent.
    var out = defaultBoard(), pages = candidate.pages, usedIds = {}, pageIds = {};
    if (!Array.isArray(pages) || !pages.length) { pages = [Object.assign({}, candidate, {id: "page-1", title: "Scene 1"})]; }
    out.pages = [];
    pages.forEach(function (value) {
      if (!isPlain(value)) { return; }
      var page = defaultPage();
      try { page.id = identifier(value.id); } catch (e) { page.id = "page-" + out.next_page_id; }
      while (pageIds[page.id]) { out.next_page_id += 1; page.id = "page-" + out.next_page_id; }
      pageIds[page.id] = true;
      ["title", "duration", "transition"].forEach(function (key) {
        if (!(key in value)) { return; }
        var one = {}; one[key] = value[key];
        try { Object.assign(page, normalizePage(one)); } catch (e) { /* keep the default */ }
      });
      ["actions", "redo"].forEach(function (bucket) {
        var values = value[bucket];
        if (!Array.isArray(values)) { return; }
        // Existing art is never truncated to today's creation limit.
        values.forEach(function (item) {
          var action;
          try { action = normalizeAction(item); } catch (e) { return; }
          var id = item.id;
          if (!isInt(id) || id < 1 || usedIds[id]) { id = out.next_action_id; while (usedIds[id]) { id += 1; } }
          usedIds[id] = true;
          action.id = id;
          out.next_action_id = Math.max(out.next_action_id, id + 1);
          action.author = validClient(item.author) ? item.author : "";
          if (isInt(item.player) && item.player >= 1 && item.player <= MAX_PLAYERS) { action.player = item.player; }
          page[bucket].push(action);
        });
      });
      out.pages.push(page);
    });
    if (!out.pages.length) { out.pages = [defaultPage()]; }
    var active = out.pages.filter(function (p) { return p.id === candidate.active_page; })[0] || out.pages[0];
    out.active_page = active.id; out.actions = active.actions; out.redo = active.redo;
    while (pageIds["page-" + out.next_page_id]) { out.next_page_id += 1; }
    ["next_action_id", "next_page_id"].forEach(function (key) { if (isInt(candidate[key])) { out[key] = Math.max(out[key], candidate[key]); } });
    var show = candidate.show;
    if (isPlain(show)) {
      ["playing", "loop"].forEach(function (key) { if (typeof show[key] === "boolean") { out.show[key] = show[key]; } });
      if (SOUNDTRACKS.indexOf(show.soundtrack) !== -1) { out.show.soundtrack = show.soundtrack; }
      if (typeof show.started_at === "number" && Number.isFinite(show.started_at) && show.started_at >= 0) { out.show.started_at = show.started_at; }
    }
    if (isInt(candidate.rev) && candidate.rev >= 0) { out.rev = candidate.rev; }
    return out;
  }
  function restore() {
    var saved = null;
    try { saved = JSON.parse(storage.getItem(STORE) || "null"); } catch (e) { saved = null; }
    if (isPlain(saved)) { board = sanitize(saved); }
  }
  var persistTimer = null;
  function persist() {
    // ponytail: 250 ms debounce, one JSON blob; a full 12-scene board can pass
    // the localStorage quota, in which case the board lives for this page only.
    if (!storage || persistTimer) { return; }
    persistTimer = root.setTimeout(function () {
      persistTimer = null;
      try {
        storage.setItem(STORE, JSON.stringify({pages: board.pages, active_page: board.active_page, show: board.show,
          rev: board.rev, next_action_id: board.next_action_id, next_page_id: board.next_page_id}));
      } catch (e) { /* quota or private window */ }
    }, 250);
    if (persistTimer && persistTimer.unref) { persistTimer.unref(); }
  }

  // --- presence (channel_core.py 2373-2456): 8 slots, 12 s TTL ---------------
  function prune(now) {
    Object.keys(players).forEach(function (client) { if (now - players[client].last_seen > PLAYER_TTL) { delete players[client]; } });
  }
  function join(client, action) {
    var now = API.now();
    if (!validClient(client)) { fail("invalid dikpix player"); }
    action = typeof action === "string" ? collapse(action).slice(0, 24) : "";
    prune(now);
    var player = players[client];
    if (!player) {
      var occupied = Object.keys(players).map(function (c) { return players[c].slot; }), slot = 1;
      while (occupied.indexOf(slot) !== -1) { slot += 1; }
      if (slot > MAX_PLAYERS) { return null; }
      player = players[client] = {slot: slot, last_seen: now, last_action: action || "READY"};
    } else { player.last_seen = now; if (action) { player.last_action = action; } }
    return player.slot;
  }
  function touch(client, action) { return client ? join(client, action) : null; }
  function playerSnapshot() {
    prune(API.now());
    return Object.keys(players).map(function (client) {
      var p = players[client];
      return {client: client, slot: p.slot, label: "HAND " + p.slot, color: PLAYER_COLORS[p.slot - 1], last_action: p.last_action};
    }).sort(function (a, b) { return a.slot - b.slot; });
  }

  // --- snapshot (channel_core.py 2382-2397): a fresh copy every time ----------
  function snapshot() {
    return {actions: copy(board.actions), redo: copy(board.redo), pages: copy(board.pages), active_page: board.active_page,
      show: copy(board.show), page_limit: MAX_PAGES, action_limit: MAX_ACTIONS, rev: board.rev,
      players: playerSnapshot(), player_limit: MAX_PLAYERS, effect: effect, effect_rev: effectRev};
  }
  function publish() { S.dikpix = snapshot(); }
  function getPage(pageId) {
    if (pageId === undefined || pageId === null) { pageId = board.active_page; }
    identifier(pageId);
    var page = board.pages.filter(function (p) { return p.id === pageId; })[0];
    if (!page) { fail("dikpix scene no longer exists"); }
    return page;
  }
  function changed() {
    var page = getPage();
    board.actions = page.actions; board.redo = page.redo; board.rev += 1;
    persist(); publish();
  }
  function objectIds(page) {
    var ids = {};
    page.actions.forEach(function (a) {
      if (a.kind === "clear") { ids = {}; } else if (a.kind === "object") { ids[a.object_id] = true; } else if (a.kind === "object_delete") { delete ids[a.object_id]; }
    });
    return ids;
  }

  // --- the reducer (channel_core.py 2484-2624) --------------------------------
  function add(candidate, client, pageId) {
    var action = normalizeAction(candidate);
    if (client && !validClient(client)) { fail("invalid dikpix player"); }
    var page = getPage(pageId !== undefined && pageId !== null ? pageId : candidate.page_id);
    var redo = page.redo.filter(function (item) { return client && item.author !== client; });
    if (page.actions.length + redo.length >= MAX_ACTIONS) { fail("This scene is full. Add a new scene to keep drawing."); }
    if (action.kind === "object" || action.kind === "object_update" || action.kind === "object_delete") {
      var ids = objectIds(page);
      if (action.kind === "object" && ids[action.object_id]) { fail("dikpix object already exists"); }
      if (action.kind !== "object" && !ids[action.object_id]) { fail("dikpix object no longer exists"); }
    }
    var player = touch(client, String(action.tool || action.kind).toUpperCase());
    action.id = board.next_action_id; action.author = client || "";
    if (player !== null) { action.player = player; }
    board.next_action_id += 1;
    page.actions.push(action); page.redo = redo;
    changed();
  }
  function undo(client, pageId) {
    var page = getPage(pageId);
    touch(client, "UNDO");
    for (var i = page.actions.length - 1; i >= 0; i -= 1) {
      if (!client || page.actions[i].author === client) { page.redo.push(page.actions.splice(i, 1)[0]); changed(); break; }
    }
  }
  function redo(client, pageId) {
    var page = getPage(pageId);
    touch(client, "REDO");
    for (var i = page.redo.length - 1; i >= 0; i -= 1) {
      if (!client || page.redo[i].author === client) {
        page.actions.push(page.redo.splice(i, 1)[0]);
        // Replay at the original point, especially before later clears.
        page.actions.sort(function (a, b) { return a.id - b.id; });
        changed(); break;
      }
    }
  }
  function scene(client, command, data) {
    data = data === undefined || data === null ? {} : data;
    if (!isPlain(data) || ["add", "duplicate", "select", "update", "remove", "move"].indexOf(command) === -1) { fail("invalid dikpix scene command"); }
    if (client && !validClient(client)) { fail("invalid dikpix player"); }
    var settings = normalizePage(data);
    var page = getPage(data.page_id), pages = board.pages, index;
    if (command === "add" || command === "duplicate") {
      if (pages.length >= MAX_PAGES) { fail("This show has all 12 scenes. Save it before starting another."); }
      var fresh = copy(command === "duplicate" ? page : defaultPage());
      while (pages.some(function (p) { return p.id === "page-" + board.next_page_id; })) { board.next_page_id += 1; }
      fresh.id = "page-" + board.next_page_id; board.next_page_id += 1;
      if (command === "duplicate") {
        fresh.title = page.title.slice(0, 59) + " copy";
        fresh.actions.concat(fresh.redo).sort(function (a, b) { return a.id - b.id; }).forEach(function (action) {
          // Older textured strokes used their operation ID as a seed.
          if (action.kind === "stroke" && !("seed" in action)) { action.seed = action.id % 2147483647 || 1; }
          action.id = board.next_action_id; board.next_action_id += 1;
        });
      } else { fresh.title = "Scene " + (pages.length + 1); }
      Object.assign(fresh, settings);
      pages.splice(pages.indexOf(page) + 1, 0, fresh);
      board.active_page = fresh.id;
    } else if (command === "select") { board.active_page = page.id; }
    else if (command === "update") { Object.assign(page, settings); }
    else if (command === "remove") {
      if (pages.length === 1) { fail("Keep at least one scene in the show"); }
      index = pages.indexOf(page); pages.splice(index, 1);
      if (board.active_page === page.id) { board.active_page = pages[Math.min(index, pages.length - 1)].id; }
    } else if (command === "move") {
      index = data.index;
      if (!isInt(index) || index < 0 || index >= pages.length) { fail("invalid dikpix scene position"); }
      pages.splice(pages.indexOf(page), 1); pages.splice(index, 0, page);
    }
    touch(client, command.toUpperCase() + " SCENE");
    changed();
  }
  function show(client, command, data) {
    data = data === undefined || data === null ? {} : data;
    if (!isPlain(data) || ["start", "stop", "settings"].indexOf(command) === -1) { fail("invalid dikpix show command"); }
    if (client && !validClient(client)) { fail("invalid dikpix player"); }
    var settings = {};
    if ("loop" in data) { if (typeof data.loop !== "boolean") { fail("invalid dikpix loop"); } settings.loop = data.loop; }
    if ("soundtrack" in data) { if (SOUNDTRACKS.indexOf(data.soundtrack) === -1) { fail("invalid dikpix soundtrack"); } settings.soundtrack = data.soundtrack; }
    Object.assign(board.show, settings);
    if (command === "start") { board.show.playing = true; board.show.started_at = API.now(); }
    else if (command === "stop") { board.show.playing = false; }
    touch(client, command.toUpperCase() + " SHOW");
    changed();
  }
  function play(client, name) {
    if (EFFECTS.indexOf(name) === -1) { fail("invalid dikpix effect"); }
    touch(client, "PLAY " + name.toUpperCase());
    effect = name; effectRev += 1;
    publish();
  }

  restore();
  API.defaults({dikpix: snapshot()});
  publish();

  // --- routes (channel_server.py 1898-1959) -----------------------------------
  function client(body) { return body.client === undefined ? "" : String(body.client); }
  function parseJSON(text, message) {
    var out;
    try { out = JSON.parse(text); } catch (e) { fail(message); }
    return out;
  }
  function route(path, fn) {
    API.register("POST", "/api/dikpix/" + path, function (body, query, ctx) { fn(body); ctx.emit(); return S; });
  }
  route("join", function (body) { join(client(body)); publish(); });
  route("action", function (body) { add(parseJSON(body.data === undefined ? "" : body.data, "invalid dikpix action payload"), client(body)); });
  route("undo", function (body) { undo(client(body), body.page_id === undefined ? null : body.page_id); });
  route("redo", function (body) { redo(client(body), body.page_id === undefined ? null : body.page_id); });
  route("clear", function (body) { add({kind: "clear"}, client(body), body.page_id === undefined ? null : body.page_id); });
  route("play", function (body) { play(client(body), body.effect === undefined ? "wiggle" : body.effect); });
  ["page", "show"].forEach(function (path) {
    route(path, function (body) {
      var data = parseJSON(body.data === undefined ? "{}" : body.data, "Invalid picture command");
      if (!isPlain(data)) { fail("Invalid picture command"); }
      (path === "page" ? scene : show)(client(body), body.command === undefined ? "" : String(body.command), data);
    });
  });
}(window));
