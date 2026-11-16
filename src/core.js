// SmoothCurve core: pure maths, no app and no UI. Everything here can run in a bare script.
//
// A curve is a cubic bezier [x1, y1, x2, y2] with end points fixed at (0, 0) and (1, 1), the
// same convention as CSS cubic-bezier(): x is time across the segment between two keyframes,
// y is progress. x1 and x2 stay in 0..1; y1 and y2 may leave 0..1 (overshoot).

var Y_MIN = -1.5;            // how far a handle may overshoot below and above the 0..1 box
var Y_MAX = 2.5;
var MIN_HANDLE_X = 0.01;     // 1 % influence: keeps Circ's vertical handles steep without infinite speed
var MAX_SPEED = 100;         // the apply engine's own limit for relative speed
var MAX_NAME = 64;

// The 25 built-in presets: Linear, then eight families in In / Out / In-Out. Values are the
// cubic-bezier approximations of Robert Penner's easing functions as listed on easings.net.
var PRESET_FAMILIES = [
  ["Sine",  [0.12, 0, 0.39, 0],     [0.61, 1, 0.88, 1],    [0.37, 0, 0.63, 1]],
  ["Quad",  [0.11, 0, 0.5, 0],      [0.5, 1, 0.89, 1],     [0.45, 0, 0.55, 1]],
  ["Cubic", [0.32, 0, 0.67, 0],     [0.33, 1, 0.68, 1],    [0.65, 0, 0.35, 1]],
  ["Quart", [0.5, 0, 0.75, 0],      [0.25, 1, 0.5, 1],     [0.76, 0, 0.24, 1]],
  ["Quint", [0.64, 0, 0.78, 0],     [0.22, 1, 0.36, 1],    [0.83, 0, 0.17, 1]],
  ["Expo",  [0.7, 0, 0.84, 0],      [0.16, 1, 0.3, 1],     [0.87, 0, 0.13, 1]],
  ["Circ",  [0.55, 0, 1, 0.45],     [0, 0.55, 0.45, 1],    [0.85, 0, 0.15, 1]],
  ["Back",  [0.36, 0, 0.66, -0.56], [0.34, 1.56, 0.64, 1], [0.68, -0.6, 0.32, 1.6]]
];
var PRESET_SIDES = ["In", "Out", "In-Out"];

var PRESETS = (function () {
  var out = [{ name: "Linear", family: "Linear", side: "", bezier: [0, 0, 1, 1] }];
  for (var f = 0; f < PRESET_FAMILIES.length; f++) {
    for (var s = 0; s < 3; s++) {
      out.push({ name: PRESET_FAMILIES[f][0] + " " + PRESET_SIDES[s], family: PRESET_FAMILIES[f][0], side: PRESET_SIDES[s], bezier: PRESET_FAMILIES[f][s + 1].slice(0) });
    }
  }
  return out;
})();

function isNumber(v) {
  return typeof v === "number" && isFinite(v);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ------------------------------------------------------------------ bezier <-> keyframe ease

// The curve as the apply engine wants it: influence in percent of the segment, speed relative to
// the segment's average speed (1 = as fast as a straight line, 0 = at rest).
function bezierToCurve(b) {
  // A handle directly above its key would need influence 0 and infinite speed. The influence
  // is at least 1 %, and more when that is what keeps the handle's height within the speed limit.
  var oi = clamp(b[0], Math.max(MIN_HANDLE_X, Math.abs(b[1]) / MAX_SPEED), 1);
  var ii = clamp(1 - b[2], Math.max(MIN_HANDLE_X, Math.abs(1 - b[3]) / MAX_SPEED), 1);
  return { outInfluence: oi * 100, outSpeed: b[1] / oi, inInfluence: ii * 100, inSpeed: (1 - b[3]) / ii };
}

function curveToBezier(c) {
  var oi = c.outInfluence / 100, ii = c.inInfluence / 100;
  return [oi, c.outSpeed * oi, 1 - ii, 1 - c.inSpeed * ii];
}

// [x, y] of the curve at bezier parameter t.
function bezierPoint(b, t) {
  var u = 1 - t, a = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * b[0] + c * b[2] + d, a * b[1] + c * b[3] + d];
}

// Progress y at time fraction u (0..1): solves x(t) = u by bisection (x is monotonic).
function bezierY(b, u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  var lo = 0, hi = 1, t = 0.5;
  for (var i = 0; i < 40; i++) {
    t = (lo + hi) / 2;
    if (bezierPoint(b, t)[0] < u) lo = t; else hi = t;
  }
  return bezierPoint(b, t)[1];
}

// The lowest and highest progress the curve reaches (0 and 1 are always included).
function curveRange(b) {
  var min = 0, max = 1;
  for (var s = 1; s < 48; s++) {
    var y = bezierPoint(b, s / 48)[1];
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { min: min, max: max };
}

// `n` progress values at evenly spaced times: where a dot would be at each tick (the motion strip).
function motionDots(b, n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(bezierY(b, i / (n - 1)));
  return out;
}

function isLinear(b) {
  return b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 1;
}

function sameBezier(a, b) {
  for (var i = 0; i < 4; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return false;
  return true;
}

// A usable bezier from anything: four finite numbers, x clamped to 0..1 and y to the overshoot
// limits; null when it isn't four finite numbers.
function sanitizeBezier(v) {
  if (!v || typeof v !== "object" || v.length !== 4) return null;
  for (var i = 0; i < 4; i++) if (!isNumber(v[i])) return null;
  return [clamp(v[0], 0, 1), clamp(v[1], Y_MIN, Y_MAX), clamp(v[2], 0, 1), clamp(v[3], Y_MIN, Y_MAX)];
}

// ------------------------------------------------------------------ text

// The four numbers of "0.42, 0, 0.58, 1", ".42 0 .58 1" or anything holding
// "cubic-bezier(0.42, 0, 0.58, 1)". Null for everything else.
function parseBezier(text) {
  if (text === undefined || text === null) return null;
  var s = String(text);
  var css = /cubic-bezier\s*\(([^)]*)\)/i.exec(s);
  if (css) s = css[1];
  s = s.replace(/^[\s\[\(]+|[\s\]\);]+$/g, "");
  if (!s.length) return null;
  var parts = s.split(/[\s,]+/), nums = [];
  for (var i = 0; i < parts.length; i++) {
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(parts[i])) return null;
    nums.push(parseFloat(parts[i]));
  }
  return sanitizeBezier(nums);
}

function fixed2(v) {
  var r = Math.round(v * 100) / 100;
  if (r === 0) r = 0;                       // no "-0.00"
  var neg = r < 0, a = Math.abs(r), whole = Math.floor(a + 1e-9), frac = Math.round((a - whole) * 100);
  if (frac === 100) { whole++; frac = 0; }
  return (neg ? "-" : "") + whole + "." + (frac < 10 ? "0" : "") + frac;
}

// "0.42, 0.00, 0.58, 1.00": what the readout line shows.
function formatBezier(b) {
  return fixed2(b[0]) + ", " + fixed2(b[1]) + ", " + fixed2(b[2]) + ", " + fixed2(b[3]);
}

function roundBezier(b) {
  var out = [];
  for (var i = 0; i < 4; i++) {
    var r = Math.round(b[i] * 1000) / 1000;
    out.push(r === 0 ? 0 : r);
  }
  return out;
}

// ------------------------------------------------------------------ names

// A trimmed name of 1 to 64 characters (line breaks become spaces), or null.
function cleanName(name) {
  var n = String(name === undefined || name === null ? "" : name).replace(/[\r\n\t]+/g, " ").replace(/^\s+|\s+$/g, "");
  return n.length > 0 && n.length <= MAX_NAME ? n : null;
}

function sameName(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

// Index of the entry named `name` (case ignored) in a list of {name}, or -1.
function findPreset(list, name) {
  for (var i = 0; i < list.length; i++) if (sameName(list[i].name, name)) return i;
  return -1;
}

// ------------------------------------------------------------------ handle dragging

// Which constraints apply to a drag: the panel's toggles, plus the keys Flow users know.
// Shift = snap to the floor or ceiling, Ctrl (or Cmd) = keep the length, Alt = keep the angle,
// Ctrl+Shift = move both handles symmetrically.
function modifierFlags(e, toggles) {
  var shift = !!(e && e.shiftKey), ctrl = !!(e && (e.ctrlKey || e.metaKey)), alt = !!(e && e.altKey);
  var t = toggles || {};
  return {
    snap: !!t.snap || (shift && !ctrl),
    length: !!t.length || (ctrl && !shift),
    angle: !!t.angle || alt,
    mirror: !!t.mirror || (ctrl && shift)
  };
}

// What a modifier key means on a preset click: Shift = In, Alt = Out, Ctrl (or Cmd) = In-Out.
function presetClickMode(e) {
  if (!e) return null;
  if (e.shiftKey) return "In";
  if (e.altKey) return "Out";
  if (e.ctrlKey || e.metaKey) return "In-Out";
  return null;
}

// The curve after dragging handle `which` (0 or 1) to `p` (graph units). `start` is the curve
// when the drag began: length and angle locks keep that handle's length or angle.
function dragHandle(b, which, p, flags, start) {
  if (!p || !isNumber(p[0]) || !isNumber(p[1])) return b.slice(0);
  flags = flags || {};
  var anchor = which === 0 ? [0, 0] : [1, 1];
  var s = start || b;
  var sv = [s[which * 2] - anchor[0], s[which * 2 + 1] - anchor[1]];
  var slen = Math.sqrt(sv[0] * sv[0] + sv[1] * sv[1]);
  var v = [p[0] - anchor[0], p[1] - anchor[1]];
  // The handle may reach x in 0..1 and y in Y_MIN..Y_MAX: as limits on its vector from the key.
  var xlo = -anchor[0], xhi = 1 - anchor[0], ylo = Y_MIN - anchor[1], yhi = Y_MAX - anchor[1];

  if (flags.angle && slen > 1e-9) {
    // Slide along the starting direction, never through the key and never past a limit.
    var dir = [sv[0] / slen, sv[1] / slen];
    var len = Math.max(0, v[0] * dir[0] + v[1] * dir[1]);
    if (dir[0] > 1e-12) len = Math.min(len, xhi / dir[0]);
    if (dir[0] < -1e-12) len = Math.min(len, xlo / dir[0]);
    if (dir[1] > 1e-12) len = Math.min(len, yhi / dir[1]);
    if (dir[1] < -1e-12) len = Math.min(len, ylo / dir[1]);
    v = [len * dir[0], len * dir[1]];
  } else if (flags.length && slen > 1e-9) {
    // Turn around the key at the starting length.
    var plen = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    if (plen > 1e-9) {
      v = [v[0] / plen * slen, v[1] / plen * slen];
      if (v[0] < xlo || v[0] > xhi) {
        var x = clamp(v[0], xlo, xhi);
        var rest = Math.sqrt(Math.max(0, slen * slen - x * x));
        v = [x, v[1] < 0 ? -rest : rest];
      }
    } else {
      v = sv;
    }
  }
  var out = b.slice(0);
  var hx = clamp(anchor[0] + v[0], 0, 1), hy = anchor[1] + v[1];
  if (flags.snap) hy = hy < 0.5 ? 0 : 1;
  hy = clamp(hy, Y_MIN, Y_MAX);
  out[which * 2] = hx;
  out[which * 2 + 1] = hy;
  if (flags.mirror) {
    var o = 1 - which;
    out[o * 2] = clamp(1 - hx, 0, 1);
    out[o * 2 + 1] = clamp(1 - hy, Y_MIN, Y_MAX);
  }
  return out;
}
