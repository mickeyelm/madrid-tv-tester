(function (root) {
  "use strict";
  function neutral() {
    return {occupancy:0, horizontalCenter:0, averageDepth:.5,
      stillness:1, movementEnergy:0, trackingConfidence:0};
  }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function createModel(options) {
    options = options || {};
    var stale = options.staleAfterMs || 2000, fade = options.neutralFadeMs || 3000;
    var maximum = Math.max(1, Math.min(4, options.maximumPeople || 4));
    var target = neutral(), current = neutral(), lastFeed = null, lastSample = null;
    var previousPeople = [];
    var previousJoints = {};
    return {
      feed: function (snapshot, now) {
        if (!Number.isFinite(now) || (lastFeed !== null && now < lastFeed)) { return; }
        if (!snapshot || snapshot.fresh === false || snapshot.available === false) { return; }
        var people = (snapshot && Array.isArray(snapshot.occupants) ? snapshot.occupants : [])
          .filter(function (person) {
            return person && Number.isFinite(person.center_x) && person.center_x >= 0 &&
              person.center_x <= 1 && Number.isFinite(person.confidence) &&
              person.confidence >= .25 && person.confidence <= 1;
          }).slice(0, maximum);
        if (!people.length) { target = neutral(); previousPeople = []; lastFeed = now; return; }
        people.sort(function (a,b) { return a.center_x-b.center_x; });
        var weight = 0, center = 0, depth = 0, depthWeight = 0;
        people.forEach(function (person) {
          weight += person.confidence;
          center += person.center_x * person.confidence;
          if (snapshot.valid_depth === true && Number.isFinite(person.depth_mm) &&
              person.depth_mm >= 400 && person.depth_mm <= 6000) {
            depth += person.depth_mm * person.confidence; depthWeight += person.confidence;
          }
        });
        center /= weight;
        var elapsed = lastFeed === null ? .1 : Math.max(.05, (now-lastFeed)/1000);
        var confidence = weight / people.length;
        var movement = 0;
        // Sorted, bounded aggregates ignore observation ordering. A person
        // appearing/disappearing resets motion rather than creating a bloom.
        if (people.length === previousPeople.length) {
          people.forEach(function (person, index) {
            var previous = previousPeople[index];
            var delta = Math.abs(person.center_x-previous.center_x);
            if (snapshot.valid_depth === true && Number.isFinite(person.depth_mm) &&
                Number.isFinite(previous.depth_mm) && person.depth_mm >= 400 &&
                person.depth_mm <= 6000 && previous.depth_mm >= 400 && previous.depth_mm <= 6000) {
              delta += Math.abs(person.depth_mm-previous.depth_mm)/5600;
            }
            if (delta > .25) { confidence *= .2; }
            else { movement += clamp(delta/elapsed,0,1)/people.length; }
          });
        }
        var joints = snapshot.joints || {}, jointMovement = 0, jointCount = 0;
        Object.keys(joints).forEach(function (key) {
          var joint = joints[key], prior = previousJoints[key];
          if (!joint || !prior || joint.confidence < .25 || prior.confidence < .25 ||
              !Number.isFinite(joint.x) || !Number.isFinite(joint.y) ||
              !Number.isFinite(prior.x) || !Number.isFinite(prior.y)) return;
          var delta = Math.hypot(joint.x-prior.x, joint.y-prior.y);
          if (delta <= .25) { jointMovement += clamp(delta/elapsed,0,1); jointCount++; }
        });
        if (jointCount && people.length === previousPeople.length) {
          movement = Math.max(movement, jointMovement/jointCount * .5);
        }
        previousJoints = JSON.parse(JSON.stringify(joints));
        target = {
          occupancy: people.length/maximum, horizontalCenter:center*2-1,
          averageDepth:depthWeight ? clamp((depth/depthWeight-400)/5600,0,1) : .5,
          stillness:1-movement, movementEnergy:movement, trackingConfidence:confidence
        };
        previousPeople = people.map(function(person) {
          return {center_x:person.center_x, depth_mm:person.depth_mm};
        });
        lastFeed = now;
      },
      sample: function (now) {
        if (!Number.isFinite(now) || lastFeed === null) { return neutral(); }
        var age = Math.max(0, now-lastFeed);
        if (age >= stale+fade) {
          current = neutral(); lastSample = now;
          return Object.assign({}, current);
        }
        var dt = lastSample === null ? 0 : clamp(now-lastSample,0,1000);
        lastSample = now;
        var alpha = 1-Math.exp(-dt/1500);
        var baseline = neutral(), strength = age <= stale ? 1 : 1-(age-stale)/fade;
        Object.keys(current).forEach(function (key) {
          var desired = baseline[key]+(target[key]-baseline[key])*strength;
          current[key] += (desired-current[key])*alpha;
        });
        return Object.assign({},current);
      }
    };
  }
  var api = {createModel:createModel};
  root.DroneEnvironment = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
}(typeof window !== "undefined" ? window : this));
