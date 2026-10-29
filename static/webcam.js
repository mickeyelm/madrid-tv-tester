/* MADRiD TV Web: the visitor's camera standing in for the station's Kinect.
 * The home station reads a Kinect through Apple Vision and publishes 13 body
 * joints at /api/kinect. Here the same payload is produced in the browser
 * from the visitor's webcam with MoveNet (TensorFlow.js), after an explicit
 * permission card. Frames stay in this page: nothing is recorded or sent.
 *
 *   MadridWebcam.request(reason) -> Promise<boolean>   ask once, then reuse
 *   MadridWebcam.snapshot()      -> /api/kinect-shaped object
 *   MadridWebcam.environment()   -> CH 09 room reading
 *   MadridWebcam.stream          -> MediaStream while live (CH 04 mirror)
 *   MadridWebcam.release()       -> stop the camera
 *
 * Joint contract (from the station's synth-motion.js): normalized x/y with
 * y-up, z in millimetres (1800 is the nominal standing distance), confidence
 * 0..1. The pose model gives x/y/confidence; z is estimated from shoulder
 * width. ponytail: that estimate assumes a ~65 degree webcam and a 0.40 m
 * shoulder span; add a per-camera calibration if depth ever matters more. */
(function (root) {
  "use strict";
  var base = (function () {
    var script = document.currentScript && document.currentScript.src;
    return script ? script.slice(0, script.lastIndexOf("/static/") + 1) : "";
  }());
  var JOINT_NAMES = {
    nose: "nose", left_shoulder: "leftShoulder", right_shoulder: "rightShoulder",
    left_elbow: "leftElbow", right_elbow: "rightElbow", left_wrist: "leftWrist",
    right_wrist: "rightWrist", left_hip: "leftHip", right_hip: "rightHip",
    left_knee: "leftKnee", right_knee: "rightKnee", left_ankle: "leftAnkle", right_ankle: "rightAnkle"
  };
  var MIN_SCORE = 0.3;
  var FRAME_MS = 66;            // ~15 fps is plenty for a body reading
  var state = "idle";           // idle | asking | loading | live | denied | unavailable
  var decision = null;          // true once allowed, false once refused this session
  var model = null;             // "movenet" | "motion"
  var stream = null, video = null, detector = null, loopTimer = null;
  var listeners = [];
  var last = {at: 0, joints: null, score: 0, people: 0, span: 0};
  var motion = {energy: 0, occupancy: 0, center: 0, previous: null, canvas: null, context: null};
  var consentCard = null, consentResolve = null, indicator = null, indicatorVideo = null;

  function emit() { listeners.forEach(function (fn) { try { fn(status()); } catch (e) { /* listener error */ } }); }
  function status() { return {state: state, model: model, decision: decision}; }
  function ensureIndicator() {
    if (indicator) { return; }
    indicator = document.createElement("div");
    indicator.id = "webcam-indicator";
    indicator.innerHTML = '<video muted playsinline autoplay></video><span>CAMERA ON · STAYS IN THIS BROWSER</span><button type="button">STOP</button>';
    indicatorVideo = indicator.querySelector("video");
    indicator.querySelector("button").addEventListener("click", function () { api.release(); });
    document.body.appendChild(indicator);
  }
  function showConsent(reason) {
    return new Promise(function (resolve) {
      if (consentCard) { consentCard.remove(); }
      consentCard = document.createElement("div");
      consentCard.id = "webcam-consent";
      consentCard.setAttribute("role", "dialog");
      consentCard.innerHTML =
        '<div class="webcam-consent-card"><span class="webcam-consent-kicker">CAMERA PERMISSION</span>' +
        '<strong></strong><p>Your camera stands in for the station’s body sensor. The picture is read in this browser only: nothing is recorded, stored, or uploaded. Your browser will ask once more.</p>' +
        '<div class="webcam-consent-actions"><button type="button" data-allow>USE MY CAMERA</button><button type="button" data-skip>NOT NOW</button></div></div>';
      consentCard.querySelector("strong").textContent = reason || "THIS CHANNEL WANTS YOUR CAMERA";
      consentResolve = resolve;
      consentCard.querySelector("[data-allow]").addEventListener("click", function () { consentCard.remove(); consentCard = null; consentResolve = null; resolve(true); });
      consentCard.querySelector("[data-skip]").addEventListener("click", function () { consentCard.remove(); consentCard = null; consentResolve = null; resolve(false); });
      document.body.appendChild(consentCard);
      consentCard.querySelector("[data-allow]").focus();
    });
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var tag = document.createElement("script");
      tag.src = src; tag.async = true;
      tag.onload = resolve; tag.onerror = function () { reject(new Error("failed " + src)); };
      document.head.appendChild(tag);
    });
  }
  function loadDetector() {
    if (detector) { return Promise.resolve(detector); }
    var chain = Promise.resolve();
    if (!root.tf) { chain = chain.then(function () { return loadScript(base + "static/vendor/tfjs/tf.min.js"); }); }
    if (!root.poseDetection) { chain = chain.then(function () { return loadScript(base + "static/vendor/pose-detection/pose-detection.min.js"); }); }
    return chain.then(function () {
      return root.poseDetection.createDetector(root.poseDetection.SupportedModels.MoveNet, {
        modelType: root.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        modelUrl: base + "static/models/movenet-singlepose-lightning-4/model.json"
      });
    }).then(function (created) { detector = created; return detector; });
  }
  function readMotion() {
    if (!motion.canvas) {
      motion.canvas = document.createElement("canvas");
      motion.canvas.width = 64; motion.canvas.height = 48;
      motion.context = motion.canvas.getContext("2d", {willReadFrequently: true});
    }
    var ctx = motion.context;
    ctx.drawImage(video, 0, 0, 64, 48);
    var data = ctx.getImageData(0, 0, 64, 48).data;
    var gray = new Uint8ClampedArray(64 * 48);
    for (var i = 0, p = 0; i < data.length; i += 4, p += 1) { gray[p] = (data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10; }
    if (motion.previous) {
      var changed = 0, sum = 0, sumX = 0;
      for (var q = 0; q < gray.length; q += 1) {
        var diff = Math.abs(gray[q] - motion.previous[q]);
        sum += diff;
        if (diff > 24) { changed += 1; sumX += q % 64; }
      }
      var energy = Math.min(1, (sum / gray.length) / 18);
      var occupancy = Math.min(1, changed / (gray.length * 0.25));
      motion.energy += (energy - motion.energy) * 0.35;
      motion.occupancy += (occupancy - motion.occupancy) * 0.2;
      if (changed > 8) { motion.center += ((sumX / changed) / 64 * 2 - 1 - motion.center) * 0.3; }
    }
    motion.previous = gray;
  }
  function readPose() {
    if (!detector || !video.videoWidth) { return Promise.resolve(); }
    return detector.estimatePoses(video, {flipHorizontal: false}).then(function (poses) {
      var pose = poses && poses[0];
      var joints = {}, scores = [], count = 0;
      if (pose) {
        pose.keypoints.forEach(function (kp) {
          var name = JOINT_NAMES[kp.name];
          if (!name) { return; }
          var score = typeof kp.score === "number" ? kp.score : 0;
          joints[name] = {x: kp.x / video.videoWidth, y: 1 - kp.y / video.videoHeight, confidence: score};
          scores.push(score); count += 1;
        });
      }
      var ls = joints.leftShoulder, rs = joints.rightShoulder;
      var span = ls && rs && ls.confidence >= MIN_SCORE && rs.confidence >= MIN_SCORE ? Math.abs(ls.x - rs.x) : 0;
      var z = span > 0.02 ? Math.min(4000, Math.max(800, 286 / span)) : 1800;
      Object.keys(joints).forEach(function (name) { joints[name].z = z; });
      var core = ["nose", "leftShoulder", "rightShoulder", "leftHip", "rightHip"].map(function (n) { return joints[n] ? joints[n].confidence : 0; });
      var score = core.reduce(function (a, b) { return a + b; }, 0) / core.length;
      last = {at: Date.now(), joints: count ? joints : null, score: score, people: score >= MIN_SCORE ? 1 : 0, span: span, z: z};
    }).catch(function () { last.people = 0; });
  }
  function loop() {
    loopTimer = null;
    if (state !== "live") { return; }
    var started = performance.now();
    try { readMotion(); } catch (e) { /* canvas unavailable */ }
    (model === "movenet" ? readPose() : Promise.resolve()).then(function () {
      if (state !== "live") { return; }
      loopTimer = root.setTimeout(loop, Math.max(0, FRAME_MS - (performance.now() - started)));
    });
  }
  function start() {
    state = "asking"; emit();
    return navigator.mediaDevices.getUserMedia({video: {facingMode: "user", width: {ideal: 640}, height: {ideal: 480}}, audio: false})
      .then(function (media) {
        stream = media;
        video = document.createElement("video");
        video.muted = true; video.playsInline = true; video.srcObject = stream;
        state = "loading"; emit();
        return video.play().then(function () { return loadDetector().then(function () { model = "movenet"; }, function () { model = "motion"; }); });
      })
      .then(function () {
        ensureIndicator();
        indicatorVideo.srcObject = stream; indicator.classList.add("is-shown");
        stream.getVideoTracks()[0].addEventListener("ended", function () { api.release(); });
        state = "live"; emit(); loop();
        return true;
      })
      .catch(function (error) {
        state = error && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "denied" : "unavailable";
        if (state === "denied") { decision = false; }
        stream = null; emit();
        return false;
      });
  }
  var api = {
    status: status,
    onChange: function (fn) { listeners.push(fn); },
    get stream() { return stream; },
    request: function (reason) {
      if (state === "live") { return Promise.resolve(true); }
      if (state === "asking" || state === "loading") { return new Promise(function (resolve) { api.onChange(function (s) { if (s.state === "live") { resolve(true); } else if (s.state === "denied" || s.state === "unavailable") { resolve(false); } }); }); }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { state = "unavailable"; emit(); return Promise.resolve(false); }
      if (decision === false) { return Promise.resolve(false); }
      // In the phone app the TV is never touched: the app asks on the phone when the page asks for
      // a camera (the phone's own), so there is no card on the picture to press.
      var hosted = Boolean(root.MadridHost && root.MadridHost.role === "output");
      var ask = decision === true || hosted ? Promise.resolve(true) : showConsent(reason);
      return ask.then(function (allowed) {
        if (allowed === null) { state = "idle"; emit(); return false; }   // dismissed by a channel change: may ask again later
        if (!allowed) { decision = false; state = "idle"; emit(); return false; }
        decision = true;
        return start();
      });
    },
    release: function () {
      if (loopTimer) { root.clearTimeout(loopTimer); loopTimer = null; }
      if (stream) { stream.getTracks().forEach(function (track) { track.stop(); }); }
      stream = null; video = null; last = {at: 0, joints: null, score: 0, people: 0, span: 0};
      motion.previous = null; motion.energy = 0; motion.occupancy = 0;
      if (indicator) { indicator.classList.remove("is-shown"); indicatorVideo.srcObject = null; }
      state = decision === false ? "denied" : "idle"; emit();
    },
    forget: function () { decision = null; api.release(); },
    dismiss: function () { if (consentCard) { consentCard.remove(); consentCard = null; } if (consentResolve) { var r = consentResolve; consentResolve = null; r(null); } },
    snapshot: function () {
      var age = last.at ? Date.now() - last.at : 999999;
      var fresh = state === "live" && model === "movenet" && age <= 2000;
      return {
        available: state === "live", fresh: fresh, age_ms: Math.min(age, 999999),
        status: state === "live" ? (model === "movenet" ? (last.people ? "tracking" : "no-body") : "motion-only") : state,
        source: "webcam", people: fresh ? last.people : 0, confidence: fresh ? last.score : 0,
        joints: fresh && last.people ? last.joints : null
      };
    },
    environment: function () {
      var live = state === "live";
      var tracked = live && model === "movenet" && last.people > 0;
      var center = motion.center;
      if (tracked && last.joints.leftHip && last.joints.rightHip) { center = ((last.joints.leftHip.x + last.joints.rightHip.x) / 2) * 2 - 1; }
      return {
        occupancy: live ? Math.max(tracked ? 1 : 0, motion.occupancy) : 0,
        averageDepth: tracked ? Math.min(1, Math.max(0, (last.z - 800) / 3200)) : 0.5,
        horizontalCenter: live ? Math.max(-1, Math.min(1, center)) : 0,
        movementEnergy: live ? motion.energy : 0,
        trackingConfidence: tracked ? last.score : (live ? 0.4 : 0)
      };
    }
  };
  root.MadridWebcam = api;
}(window));
