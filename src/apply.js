// SmoothCurve apply engine: turns a curve into keyframe eases on the selected keyframes.
//
// The functions between the two "vendored" markers are taken from EffectCraft's bundled panel
// "Ease Presets.jsx" (extensions/scriptui-panels/Ease Presets.jsx at tag v0.24.1 of
// github.com/storytold/effectcraft; original work by the EffectCraft contributors, licensed
// MIT OR Apache-2.0; the pinned copy is vendor/EasePresets.v0.24.1.jsx). They are unchanged
// except for one thing: the undo step's name is UNDO_NAME instead of "Apply Ease Preset".
// tests/check_vendor.py compares them with the pinned copy.
//
// What they do (from the upstream file): a curve is the out side of a segment's first key and
// the in side of its second: influence in percent of the segment, and speed relative to the
// segment's average speed (1 = as fast as a straight line, 0 = at rest). Applied to selected
// keyframes, In eases each key's incoming side with the curve's in side, Out its outgoing side
// with the curve's out side, In-Out both: a side is eased when it has a neighbouring key
// (selected or not; the neighbour isn't changed), its speeds scaled to the segment on that side:
// per dimension, along the motion path for spatial properties, or as overall progress for
// shapes. Roving keys are skipped. Everything happens in one undo step.

var UNDO_NAME = "SmoothCurve Ease";
var MIN_INFLUENCE = 0.1;     // percent: the smallest influence a keyframe ease takes
var LINEAR = KeyframeInterpolationType.LINEAR;
var BEZIER = KeyframeInterpolationType.BEZIER;
var HOLD = KeyframeInterpolationType.HOLD;

// ---- vendored from Ease Presets.jsx (v0.24.1) ---------------------------------------------

function curve(outInfluence, outSpeed, inInfluence, inSpeed) {
  return { outInfluence: outInfluence, outSpeed: outSpeed, inInfluence: inInfluence, inSpeed: inSpeed };
}

function finite(v) {
  return typeof v === "number" && isFinite(v);
}

// The curve with influences in 0.1–100 % and speeds within ±100; null when a number is missing.
function sanitized(c) {
  if (!c || !finite(c.outInfluence) || !finite(c.outSpeed) || !finite(c.inInfluence) || !finite(c.inSpeed)) return null;
  var inf = function (v) { return Math.min(100, Math.max(MIN_INFLUENCE, v)); };
  var speed = function (v) { return Math.min(MAX_SPEED, Math.max(-MAX_SPEED, v)); };
  return curve(inf(c.outInfluence), speed(c.outSpeed), inf(c.inInfluence), speed(c.inSpeed));
}

// ------------------------------------------------------------------ keyframes

// Selected properties of the active comp whose keys can ease: {prop, keys} (their selected keys).
function selectedKeyed() {
  var comp = app.project.activeItem;
  var out = [];
  if (!(comp instanceof CompItem)) return out;
  var props = comp.selectedProperties;
  for (var i = 0; i < props.length; i++) {
    var p = props[i];
    if (p.propertyType !== PropertyType.PROPERTY || p.numKeys < 2 || !p.isInterpolationTypeValid(BEZIER)) continue;
    var keys = p.selectedKeys;
    if (keys.length) out.push({ prop: p, keys: keys });
  }
  return out;
}

// Pairs of neighbouring selected keyframes: {prop, key} (the earlier key's index), by property.
function selectedPairs() {
  var keyed = selectedKeyed(), out = [];
  for (var i = 0; i < keyed.length; i++) {
    var keys = keyed[i].keys;
    for (var k = 0; k + 1 < keys.length; k++) if (keys[k + 1] === keys[k] + 1) out.push({ prop: keyed[i].prop, key: keys[k] });
  }
  return out;
}

// Length of the motion path from `a` to `b` with the tangents of their keys.
function pathLength(a, outTangent, inTangent, b) {
  var p = [], n = Math.max(a.length, b.length), len = 0, prev = null;
  for (var d = 0; d < n; d++) p.push([a[d] || 0, (a[d] || 0) + (outTangent[d] || 0), (b[d] || 0) + (inTangent[d] || 0), b[d] || 0]);
  for (var s = 0; s <= 128; s++) {
    var t = s / 128, u = 1 - t, pt = [];
    for (var e = 0; e < n; e++) pt.push(u * u * u * p[e][0] + 3 * u * u * t * p[e][1] + 3 * u * t * t * p[e][2] + t * t * t * p[e][3]);
    if (prev) {
      var sq = 0;
      for (var f = 0; f < n; f++) sq += (pt[f] - prev[f]) * (pt[f] - prev[f]);
      len += Math.sqrt(sq);
    }
    prev = pt;
  }
  return len;
}

// The layer a property belongs to.
function layerOf(p) {
  return p.propertyGroup(p.propertyDepth);
}

// Average speed of segment `a` → `a + 1` for each entry of its eases, in the units the eases use
// (keyframe times move with the layer, so the duration is in the layer's time). Null when the
// segment has no duration.
function slopes(p, a) {
  var stretch = layerOf(p).stretch || 100;
  var dur = (p.keyTime(a + 1) - p.keyTime(a)) * 100 / stretch;
  if (!(dur > 0) || !isFinite(dur)) return null;
  var n = Math.max(1, p.keyOutTemporalEase(a).length);
  var v0 = p.keyValue(a), v1 = p.keyValue(a + 1), out = [];
  var vt = p.propertyValueType;
  if (vt === PropertyValueType.TwoD_SPATIAL || vt === PropertyValueType.ThreeD_SPATIAL) {
    var speed = pathLength(v0, p.keyOutSpatialTangent(a), p.keyInSpatialTangent(a + 1), v1) / dur;
    for (var i = 0; i < n; i++) out.push(speed);
  } else if (typeof v0 === "number" && typeof v1 === "number") {
    out.push((v1 - v0) / dur);
  } else if (v0 instanceof Array && v1 instanceof Array && v0.length === v1.length) {
    for (var d = 0; d < n; d++) out.push(((v1[d] || 0) - (v0[d] || 0)) / dur);
  } else {
    // Shapes and other values ease their overall progress.
    for (var j = 0; j < n; j++) out.push(1 / dur);
  }
  return out;
}

// Ease one side of key `k` with `eases`, leaving its other side as it plays (auto-Bezier and
// linear sides keep their shape; a continuous key stops being continuous, its sides now differ).
function easeSide(p, k, out, eases, interpolation) {
  var inType = p.keyInInterpolationType(k), outType = p.keyOutInterpolationType(k);
  var inEase = p.keyInTemporalEase(k), outEase = p.keyOutTemporalEase(k);
  if (p.keyTemporalContinuous(k)) p.setTemporalContinuousAtKey(k, false);
  if (out) {
    p.setTemporalEaseAtKey(k, inEase, eases);
    p.setInterpolationTypeAtKey(k, inType, interpolation);
  } else {
    p.setTemporalEaseAtKey(k, eases, outEase);
    p.setInterpolationTypeAtKey(k, interpolation, outType);
  }
}

// The eases of one side with `speed` (relative to the segment's average) and `influence`.
function eases(s, speed, influence) {
  var out = [];
  for (var d = 0; d < s.length; d++) out.push(new KeyframeEase(speed * s[d], influence));
  return out;
}

// Ease the sides `mode` names ("In", "Out" or "In-Out") of every selected keyframe with `c`, in
// one undo step: a side with a neighbouring key, scaled to the segment on that side. Returns
// {eased, roving}: the number of keyframes eased, and of selected roving keyframes skipped.
function applyCurve(c, mode, interpolation) {
  var keyed = selectedKeyed(), sides = [], keys = 0, roving = 0;
  var doIn = mode !== "Out", doOut = mode !== "In";
  // Every side and its eases first: the segments are measured before any key changes.
  for (var i = 0; i < keyed.length; i++) {
    var p = keyed[i].prop;
    for (var j = 0; j < keyed[i].keys.length; j++) {
      var k = keyed[i].keys[j], before = sides.length;
      if (p.keyRoving(k)) {
        roving++;
        continue;
      }
      var s = doIn && k > 1 ? slopes(p, k - 1) : null;
      if (s || (doIn && interpolation === LINEAR)) sides.push({ prop: p, key: k, out: false, eases: s ? eases(s, c.inSpeed, c.inInfluence) : p.keyInTemporalEase(k) });
      s = doOut && k < p.numKeys ? slopes(p, k) : null;
      if (s || (doOut && interpolation === LINEAR)) sides.push({ prop: p, key: k, out: true, eases: s ? eases(s, c.outSpeed, c.outInfluence) : p.keyOutTemporalEase(k) });
      if (sides.length > before) keys++;
    }
  }
  if (!sides.length) return { eased: 0, roving: roving };
  app.beginUndoGroup(UNDO_NAME);
  try {
    for (var e = 0; e < sides.length; e++) easeSide(sides[e].prop, sides[e].key, sides[e].out, sides[e].eases, interpolation);
  } finally {
    app.endUndoGroup();
  }
  return { eased: keys, roving: roving };
}

// The curve between the first selected pair of keyframes (measured on the dimension that
// changes most); null for holds and segments whose value doesn't change.
function captureCurve() {
  var pairs = selectedPairs();
  if (!pairs.length) return null;
  var p = pairs[0].prop, a = pairs[0].key;
  if (p.keyOutInterpolationType(a) === HOLD) return null;
  var s = slopes(p, a);
  if (!s) return null;
  var d = 0;
  for (var i = 1; i < s.length; i++) if (Math.abs(s[i]) > Math.abs(s[d])) d = i;
  if (Math.abs(s[d]) < 1e-12) return null;
  var o = p.keyOutTemporalEase(a), n = p.keyInTemporalEase(a + 1);
  var oe = o[d] || o[0], ne = n[d] || n[0];
  if (!oe || !ne) return null;
  return sanitized(curve(oe.influence, oe.speed / s[d], ne.influence, ne.speed / s[d]));
}

// ---- end of vendored code ------------------------------------------------------------------

// Ease the sides `mode` names ("In", "Out" or "In-Out") of every selected keyframe with the
// bezier `b`. Returns {eased, roving, properties}: keyframes eased, selected roving keyframes
// skipped, and the number of selected properties that had keyframes to ease.
// The straight line is applied as Linear interpolation, so its keys get diamond icons.
function applyBezier(b, mode) {
  var properties = selectedKeyed().length;
  var r = isLinear(b) ? applyCurve(curve(100 / 3, 1, 100 / 3, 1), mode, LINEAR) : applyCurve(bezierToCurve(b), mode, BEZIER);
  return { eased: r.eased, roving: r.roving, properties: properties };
}

// The curve between the first selected pair of neighbouring keyframes as a bezier; null when
// there is no such pair, for holds and for segments whose value doesn't change.
function captureBezier() {
  var c = captureCurve();
  return c ? sanitizeBezier(curveToBezier(c)) : null;
}
