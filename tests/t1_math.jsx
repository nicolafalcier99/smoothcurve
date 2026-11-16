// T1: maths round trip, curve evaluation, text parsing and handle constraints (no UI, no project).
#include "lib/assert.js"
#include "../src/core.js"

(function () {
  var i, d;

  // ---- presets table
  checkEq("25 presets", PRESETS.length, 25);
  checkEq("first preset is Linear", PRESETS[0].name, "Linear");
  var names = {};
  for (i = 0; i < PRESETS.length; i++) names[PRESETS[i].name.toLowerCase()] = (names[PRESETS[i].name.toLowerCase()] || 0) + 1;
  var dup = 0;
  for (var n in names) if (names[n] > 1) dup++;
  checkEq("preset names are unique", dup, 0);
  var want = { "Sine In": [0.12, 0, 0.39, 0], "Quad Out": [0.5, 1, 0.89, 1], "Cubic In-Out": [0.65, 0, 0.35, 1],
    "Circ In": [0.55, 0, 1, 0.45], "Circ Out": [0, 0.55, 0.45, 1], "Back In": [0.36, 0, 0.66, -0.56],
    "Back Out": [0.34, 1.56, 0.64, 1], "Back In-Out": [0.68, -0.6, 0.32, 1.6], "Expo In-Out": [0.87, 0, 0.13, 1] };
  for (var w in want) {
    var p = findPreset(PRESETS, w);
    check("preset " + w + " has the easings.net values", p >= 0 && PRESETS[p].bezier.join(",") === want[w].join(","), p >= 0 ? PRESETS[p].bezier.join(",") : "missing");
  }

  // ---- T1 round trip for all 25 (includes Circ with x = 0 or 1 and Back with y outside 0..1)
  for (i = 0; i < PRESETS.length; i++) {
    var b = PRESETS[i].bezier, c = bezierToCurve(b), back = curveToBezier(c), worst = 0;
    for (d = 0; d < 4; d++) worst = Math.max(worst, Math.abs(back[d] - b[d]));
    check("round trip " + PRESETS[i].name, worst <= 0.012, "worst coordinate error " + worst);
    check("influence and speed in range " + PRESETS[i].name,
      c.outInfluence >= 1 && c.outInfluence <= 100 && c.inInfluence >= 1 && c.inInfluence <= 100 &&
      Math.abs(c.outSpeed) <= 100 && Math.abs(c.inSpeed) <= 100, JSON.stringify(c));
  }
  var co = bezierToCurve([0, 0.55, 0.45, 1]);
  checkNear("Circ Out keeps its steep start (speed 55 at 1 % influence)", co.outSpeed, 55, 1e-9);
  checkNear("Circ Out influence is the 1 % minimum", co.outInfluence, 1, 1e-9);
  // A vertical handle taller than speed 100 allows: the influence grows instead of the handle flattening.
  var steep = bezierToCurve([0, 2.5, 1, 1]);
  checkNear("steep handle keeps its height", steep.outSpeed * steep.outInfluence / 100, 2.5, 1e-9);
  check("steep handle speed is capped at 100", Math.abs(steep.outSpeed) <= 100 + 1e-9, String(steep.outSpeed));
  var ease = bezierToCurve([0.42, 0, 0.58, 1]);
  checkNear("ease-in-out out influence", ease.outInfluence, 42, 1e-9);
  checkNear("ease-in-out in influence", ease.inInfluence, 42, 1e-9);
  checkNear("ease-in-out out speed", ease.outSpeed, 0, 1e-9);
  checkNear("ease-in-out in speed", ease.inSpeed, 0, 1e-9);

  // ---- bezierY
  checkNear("linear y(0.3)", bezierY([0, 0, 1, 1], 0.3), 0.3, 1e-6);
  checkNear("y(0) = 0", bezierY([0.42, 0, 0.58, 1], 0), 0, 1e-6);
  checkNear("y(1) = 1", bezierY([0.42, 0, 0.58, 1], 1), 1, 1e-6);
  checkNear("symmetric curve y(0.5) = 0.5", bezierY([0.42, 0, 0.58, 1], 0.5), 0.5, 1e-6);
  // cubic-bezier(.42,0,.58,1) at 0.25, from the closed form (t solved numerically elsewhere): 0.1291…
  checkNear("ease-in-out y(0.25)", bezierY([0.42, 0, 0.58, 1], 0.25), 0.12916, 2e-4);
  check("Back Out overshoots above 1", curveRange([0.34, 1.56, 0.64, 1]).max > 1.05, String(curveRange([0.34, 1.56, 0.64, 1]).max));
  check("Back In dips below 0", curveRange([0.36, 0, 0.66, -0.56]).min < -0.05, String(curveRange([0.36, 0, 0.66, -0.56]).min));
  checkNear("plain ease stays inside 0..1 (min)", curveRange([0.42, 0, 0.58, 1]).min, 0, 1e-9);
  checkNear("plain ease stays inside 0..1 (max)", curveRange([0.42, 0, 0.58, 1]).max, 1, 1e-9);

  // ---- sanitise
  checkEq("sanitise clamps x", sanitizeBezier([-1, 0, 2, 1]).join(","), "0,0,1,1");
  checkEq("sanitise clamps y", sanitizeBezier([0.5, -9, 0.5, 9]).join(","), "0.5," + Y_MIN + ",0.5," + Y_MAX);
  checkEq("sanitise rejects NaN", sanitizeBezier([0.1, NaN, 0.2, 1]), null);
  checkEq("sanitise rejects Infinity", sanitizeBezier([0.1, Infinity, 0.2, 1]), null);
  checkEq("sanitise rejects 3 numbers", sanitizeBezier([0.1, 0.2, 0.3]), null);
  checkEq("sanitise rejects strings", sanitizeBezier(["a", 0, 0, 1]), null);
  checkEq("sanitise rejects null", sanitizeBezier(null), null);

  // ---- parse / format (T6: paste of cubic-bezier(...), garbage ignored)
  checkEq("parse css", parseBezier("cubic-bezier(0.42, 0, 0.58, 1)").join(","), "0.42,0,0.58,1");
  checkEq("parse css with ;", parseBezier("  cubic-bezier(.17,.67,.83,.67);").join(","), "0.17,0.67,0.83,0.67");
  checkEq("parse plain", parseBezier("0.42, 0.00, 0.58, 1.00").join(","), "0.42,0,0.58,1");
  checkEq("parse spaces", parseBezier(".2 0 0 1").join(","), "0.2,0,0,1");
  checkEq("parse negative and overshoot", parseBezier("0.68, -0.6, 0.32, 1.6").join(","), "0.68,-0.6,0.32,1.6");
  checkEq("parse transition shorthand", parseBezier("transition: all 300ms cubic-bezier(0.2, 0, 0, 1);").join(","), "0.2,0,0,1");
  checkEq("parse garbage", parseBezier("hello"), null);
  checkEq("parse empty", parseBezier(""), null);
  checkEq("parse three numbers", parseBezier("1, 2, 3"), null);
  checkEq("parse five numbers", parseBezier("1, 2, 3, 4, 5"), null);
  checkEq("parse undefined", parseBezier(undefined), null);
  checkEq("parse clamps x", parseBezier("5, 0, -2, 1").join(","), "1,0,0,1");
  checkEq("format", formatBezier([0.42, 0, 0.58, 1]), "0.42, 0.00, 0.58, 1.00");
  checkEq("format negative", formatBezier([0.68, -0.6, 0.32, 1.6]), "0.68, -0.60, 0.32, 1.60");
  checkEq("format round trip", parseBezier(formatBezier([0.123, -0.456, 0.789, 1.234])).join(","), "0.12,-0.46,0.79,1.23");
  checkEq("isLinear", isLinear([0, 0, 1, 1]), true);
  checkEq("isLinear false", isLinear([0.42, 0, 0.58, 1]), false);

  // ---- handle constraints (T6)
  var none = { snap: false, length: false, angle: false, mirror: false };
  var start = [0.42, 0, 0.58, 1];
  var r = dragHandle(start, 0, [0.3, 0.2], none, start);
  checkEq("free drag moves handle 1 only", r.join(","), "0.3,0.2,0.58,1");
  r = dragHandle(start, 1, [0.7, 0.8], none, start);
  checkEq("free drag moves handle 2 only", r.join(","), "0.42,0,0.7,0.8");
  r = dragHandle(start, 0, [-0.4, 9], none, start);
  checkEq("drag is clamped", r.join(","), "0," + Y_MAX + ",0.58,1");

  r = dragHandle(start, 0, [0.3, 0.2], { snap: true }, start);
  checkEq("Shift snaps y to the floor", r.join(","), "0.3,0,0.58,1");
  r = dragHandle(start, 0, [0.3, 0.8], { snap: true }, start);
  checkEq("Shift snaps y to the ceiling", r.join(","), "0.3,1,0.58,1");
  r = dragHandle(start, 1, [0.6, 0.3], { snap: true }, start);
  checkEq("Shift snaps the second handle too", r.join(","), "0.42,0,0.6,0");

  var s2 = [0.3, 0.4, 0.58, 1];   // handle 1 length 0.5
  r = dragHandle(s2, 0, [0.9, 0], { length: true }, s2);
  checkNear("Ctrl keeps the length (pointing right)", Math.sqrt(r[0] * r[0] + r[1] * r[1]), 0.5, 1e-9);
  checkNear("Ctrl follows the pointer's direction", r[1], 0, 1e-9);
  r = dragHandle(s2, 0, [0.2, 0.2], { length: true }, s2);
  checkNear("Ctrl keeps the length (diagonal)", Math.sqrt(r[0] * r[0] + r[1] * r[1]), 0.5, 1e-9);
  checkNear("Ctrl diagonal x = y", r[0], r[1], 1e-9);
  r = dragHandle(s2, 0, [-0.5, 0.5], { length: true }, s2);
  check("Ctrl never leaves x in 0..1", r[0] >= 0 && r[0] <= 1, String(r[0]));
  checkNear("Ctrl keeps the length at the x limit", Math.sqrt(r[0] * r[0] + r[1] * r[1]), 0.5, 1e-9);
  var s3 = [0.42, 0, 0.7, 0.6];   // handle 2 vector (-0.3, -0.4), length 0.5
  r = dragHandle(s3, 1, [0.2, 1], { length: true }, s3);
  checkNear("Ctrl keeps the second handle's length", Math.sqrt((r[2] - 1) * (r[2] - 1) + (r[3] - 1) * (r[3] - 1)), 0.5, 1e-9);

  r = dragHandle(s2, 0, [0.9, 0.1], { angle: true }, s2);
  checkNear("Alt keeps the angle", Math.atan2(r[1], r[0]), Math.atan2(0.4, 0.3), 1e-9);
  check("Alt changes the length", Math.abs(Math.sqrt(r[0] * r[0] + r[1] * r[1]) - 0.5) > 0.05, String(r));
  r = dragHandle(s2, 0, [-0.5, -0.5], { angle: true }, s2);
  checkEq("Alt cannot pull the handle through its key", r[0] + "," + r[1], "0,0");
  r = dragHandle(s2, 0, [9, 12], { angle: true }, s2);
  check("Alt stops at the limits", r[0] <= 1 + 1e-9 && r[1] <= Y_MAX + 1e-9, String(r));
  checkNear("Alt keeps the angle at the limits", Math.atan2(r[1], r[0]), Math.atan2(0.4, 0.3), 1e-9);

  r = dragHandle(start, 0, [0.2, 0.3], { mirror: true }, start);
  checkEq("Ctrl+Shift mirrors the other handle", r.join(","), "0.2,0.3,0.8,0.7");
  r = dragHandle(start, 1, [0.6, 1.2], { mirror: true }, start);
  checkNear("mirror from the second handle x", r[0], 0.4, 1e-9);
  checkNear("mirror from the second handle y", r[1], -0.2, 1e-9);
  r = dragHandle(start, 0, [0.2, 0.3], { mirror: true, snap: true }, start);
  checkEq("mirror with snap", r.join(","), "0.2,0,0.8,1");
  r = dragHandle(start, 0, [NaN, 0.3], none, start);
  checkEq("a NaN pointer changes nothing", r.join(","), start.join(","));

  var f = modifierFlags({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }, none);
  checkEq("Shift = snap", f.snap + "," + f.length + "," + f.angle + "," + f.mirror, "true,false,false,false");
  f = modifierFlags({ shiftKey: false, ctrlKey: true, altKey: false, metaKey: false }, none);
  checkEq("Ctrl = length", f.snap + "," + f.length + "," + f.angle + "," + f.mirror, "false,true,false,false");
  f = modifierFlags({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: true }, none);
  checkEq("Cmd counts as Ctrl", f.length, true);
  f = modifierFlags({ shiftKey: false, ctrlKey: false, altKey: true, metaKey: false }, none);
  checkEq("Alt = angle", f.snap + "," + f.length + "," + f.angle + "," + f.mirror, "false,false,true,false");
  f = modifierFlags({ shiftKey: true, ctrlKey: true, altKey: false, metaKey: false }, none);
  checkEq("Ctrl+Shift = mirror only", f.snap + "," + f.length + "," + f.angle + "," + f.mirror, "false,false,false,true");
  f = modifierFlags({}, { snap: true, length: false, angle: true, mirror: true });
  checkEq("toggles alone", f.snap + "," + f.length + "," + f.angle + "," + f.mirror, "true,false,true,true");
  checkEq("preset click: Shift = In", presetClickMode({ shiftKey: true }), "In");
  checkEq("preset click: Alt = Out", presetClickMode({ altKey: true }), "Out");
  checkEq("preset click: Ctrl = In-Out", presetClickMode({ ctrlKey: true }), "In-Out");
  checkEq("preset click: Cmd = In-Out", presetClickMode({ metaKey: true }), "In-Out");
  checkEq("preset click: no key = no change", presetClickMode({}), null);

  // ---- motion strip
  var dots = motionDots([0, 0, 1, 1], 12);
  checkEq("12 dots", dots.length, 12);
  checkNear("linear dots are evenly spaced", dots[5] - dots[4], 1 / 11, 1e-6);
  dots = motionDots([0.42, 0, 0.58, 1], 12);
  check("ease dots bunch at the ends", dots[1] - dots[0] < dots[6] - dots[5], dots.join(" "));
  checkNear("first dot at 0", dots[0], 0, 1e-6);
  checkNear("last dot at 1", dots[11], 1, 1e-6);

  // ---- names
  checkEq("cleanName trims", cleanName("  Snappy  "), "Snappy");
  checkEq("cleanName rejects empty", cleanName("   "), null);
  checkEq("cleanName rejects 65 characters", cleanName(new Array(66).join("x")), null);
  checkEq("cleanName accepts 64 characters", cleanName(new Array(65).join("x")).length, 64);
  checkEq("cleanName rejects undefined", cleanName(undefined), null);
  checkEq("cleanName flattens line breaks", cleanName("a\nb"), "a b");
  checkEq("sameName ignores case", sameName("Quad Out", "quad out"), true);
})();

report();
