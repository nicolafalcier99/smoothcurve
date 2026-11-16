// T2 (the real result of every preset) and T3 (behaviour of the apply engine), in a project
// the script builds itself: one comp, solids with keyframes on rotation, opacity, scale and position.
#include "lib/assert.js"
#include "../src/core.js"
#include "../src/apply.js"

(function () {
  var comp = app.project.items.addComp("SmoothCurve Test", 640, 360, 1, 10, 30);
  comp.openInViewer();
  check("the test comp is the active item", app.project.activeItem === comp || (app.project.activeItem && app.project.activeItem.name === comp.name));

  var all = [];                                   // every keyed property made here, for deselecting
  function keyed(layer, prop, times, values) {
    for (var i = 0; i < times.length; i++) prop.setValueAtTime(times[i], values[i]);
    all.push(prop);
    return prop;
  }
  function solid(name) {
    return comp.layers.addSolid([1, 0, 0], name, 100, 100, 1);
  }
  function selectOnly(pairs) {                    // pairs: [[prop, [key indices]], ...]
    var i, k;
    for (i = 0; i < all.length; i++) for (k = 1; k <= all[i].numKeys; k++) all[i].setSelectedAtKey(k, false);
    for (i = 0; i < pairs.length; i++) for (k = 0; k < pairs[i][1].length; k++) pairs[i][0].setSelectedAtKey(pairs[i][1][k], true);
  }
  function side(prop, k, out) {                   // one side of a key as text, to compare states
    var e = out ? prop.keyOutTemporalEase(k) : prop.keyInTemporalEase(k), s = [];
    for (var d = 0; d < e.length; d++) s.push(Math.round(e[d].speed * 1e6) / 1e6 + "@" + Math.round(e[d].influence * 1e6) / 1e6);
    return (out ? prop.keyOutInterpolationType(k) : prop.keyInInterpolationType(k)) + ":" + s.join("/");
  }
  function state(prop) {
    var s = [];
    for (var k = 1; k <= prop.numKeys; k++) s.push(side(prop, k, false) + " | " + side(prop, k, true));
    return s.join(" || ");
  }
  function undo() {
    app.executeCommand(app.findMenuCommandId("Undo"));
  }

  var US = [0.1, 0.25, 0.5, 0.75, 0.9];
  var a = solid("A");
  var rot = keyed(a, a.transform.rotation, [0, 1], [0, 100]);
  var opa = keyed(a, a.transform.opacity, [0, 1], [0, 100]);
  var scl = keyed(a, a.transform.scale, [0, 1], [[100, 100], [200, 50]]);
  var b = solid("B");
  var pos = keyed(b, b.transform.position, [0, 1], [[100, 100], [500, 100]]);

  // ------------------------------------------------------------------ T2: all 25 presets
  var i, u, p, r, worst;
  for (i = 0; i < PRESETS.length; i++) {
    p = PRESETS[i];

    // Rotation: one dimension, no limits, so overshoot shows.
    selectOnly([[rot, [1, 2]]]);
    r = applyBezier(p.bezier, "In-Out");
    checkEq(p.name + ": eased both rotation keys", r.eased + "/" + r.roving + "/" + r.properties, "2/0/1");
    worst = 0;
    for (u = 0; u < US.length; u++) worst = Math.max(worst, Math.abs(rot.valueAtTime(US[u], false) - bezierY(p.bezier, US[u]) * 100));
    check(p.name + ": rotation follows the curve within 1 % of the change", worst <= 1, "worst error " + worst + " of 100");

    // Opacity (the design's example). valueAtTime reports the keyframe value before the
    // property's 0..100 limit, so overshooting presets are compared with the curve as it is.
    selectOnly([[opa, [1, 2]]]);
    applyBezier(p.bezier, "In-Out");
    worst = 0;
    for (u = 0; u < US.length; u++) worst = Math.max(worst, Math.abs(opa.valueAtTime(US[u], false) - bezierY(p.bezier, US[u]) * 100));
    check(p.name + ": opacity follows the curve within 1 % of the change", worst <= 1, "worst error " + worst + " of 100");

    // Scale: two dimensions with different changes (+100 and -50), eased per dimension.
    selectOnly([[scl, [1, 2]]]);
    applyBezier(p.bezier, "In-Out");
    worst = 0;
    for (u = 0; u < US.length; u++) {
      var sv = scl.valueAtTime(US[u], false), y = bezierY(p.bezier, US[u]);
      worst = Math.max(worst, Math.abs(sv[0] - (100 + 100 * y)) / 100, Math.abs(sv[1] - (100 - 50 * y)) / 50);
    }
    check(p.name + ": scale follows the curve in both dimensions", worst <= 0.01, "worst error " + worst + " of the change");

    // Position: a spatial property, eased along its path. A straight move of 400 px.
    selectOnly([[pos, [1, 2]]]);
    r = applyBezier(p.bezier, "In-Out");
    checkEq(p.name + ": eased both position keys", r.eased, 2);
    worst = 0;
    for (u = 0; u < US.length; u++) {
      var pv = pos.valueAtTime(US[u], false);
      worst = Math.max(worst, Math.abs(pv[0] - (100 + 400 * bezierY(p.bezier, US[u]))), Math.abs(pv[1] - 100));
    }
    check(p.name + ": position follows the curve within 1 % of the change", worst <= 4, "worst error " + worst + " px of 400");

    if (p.name === "Linear") {
      checkEq("Linear sets Linear interpolation (out side of the first key)", rot.keyOutInterpolationType(1), LINEAR);
      checkEq("Linear sets Linear interpolation (in side of the second key)", rot.keyInInterpolationType(2), LINEAR);
    } else {
      checkEq(p.name + ": Bezier interpolation", rot.keyOutInterpolationType(1) + "," + rot.keyInInterpolationType(2), BEZIER + "," + BEZIER);
    }
  }

  // A hand-drawn curve, as the panel would send it after a drag.
  var drawn = [0.2, 0.9, 0.35, 1.2];
  selectOnly([[rot, [1, 2]]]);
  applyBezier(drawn, "In-Out");
  worst = 0;
  for (u = 0; u < US.length; u++) worst = Math.max(worst, Math.abs(rot.valueAtTime(US[u], false) - bezierY(drawn, US[u]) * 100));
  check("a hand-drawn curve is applied as drawn", worst <= 1, "worst error " + worst);

  // captureBezier reads back what was applied.
  var read = captureBezier();
  check("From keys reads the applied curve back", read !== null && Math.abs(read[0] - 0.2) < 1e-6 && Math.abs(read[1] - 0.9) < 1e-6 && Math.abs(read[2] - 0.35) < 1e-6 && Math.abs(read[3] - 1.2) < 1e-6, String(read));
  selectOnly([]);
  checkEq("From keys with nothing selected is null", captureBezier(), null);

  // A curved path only has to work without an error.
  var c = solid("C");
  var bend = keyed(c, c.transform.position, [0, 1, 2], [[100, 100], [500, 100], [500, 300]]);
  selectOnly([[bend, [1, 2, 3]]]);
  checkThrowsNothing("a curved position path eases without an error", function () {
    var rr = applyBezier([0.42, 0, 0.58, 1], "In-Out");
    if (rr.eased !== 3) throw new Error("eased " + rr.eased + " keys, expected 3");
  });

  // ------------------------------------------------------------------ T3: behaviour
  var d = solid("D");
  var three = keyed(d, d.transform.rotation, [0, 1, 2], [0, 100, 40]);
  var EASE = [0.42, 0, 0.58, 1];
  var before, after;

  // In: only incoming sides.
  selectOnly([[three, [1, 2, 3]]]);
  before = [side(three, 1, true), side(three, 2, false), side(three, 2, true), side(three, 3, false)];
  r = applyBezier(EASE, "In");
  after = [side(three, 1, true), side(three, 2, false), side(three, 2, true), side(three, 3, false)];
  checkEq("In: eased the two keys that have a key before them", r.eased, 2);
  check("In: incoming sides changed", after[1] !== before[1] && after[3] !== before[3], after.join(" ; "));
  check("In: outgoing sides are untouched", after[0] === before[0] && after[2] === before[2], after.join(" ; ") + " <- " + before.join(" ; "));
  checkNear("In: the in side has the curve's influence", three.keyInTemporalEase(2)[0].influence, 42, 1e-6);
  checkNear("In: the in side has the curve's speed", three.keyInTemporalEase(2)[0].speed, 0, 1e-6);
  undo();
  checkEq("In: one undo restores every side", [side(three, 1, true), side(three, 2, false), side(three, 2, true), side(three, 3, false)].join(" ; "), before.join(" ; "));

  // Out: only outgoing sides.
  selectOnly([[three, [1, 2, 3]]]);
  r = applyBezier(EASE, "Out");
  after = [side(three, 1, true), side(three, 2, false), side(three, 2, true), side(three, 3, false)];
  checkEq("Out: eased the two keys that have a key after them", r.eased, 2);
  check("Out: outgoing sides changed", after[0] !== before[0] && after[2] !== before[2], after.join(" ; "));
  check("Out: incoming sides are untouched", after[1] === before[1] && after[3] === before[3], after.join(" ; "));
  undo();

  // In-Out on a whole selection: the middle key eases both of its segments.
  selectOnly([[three, [1, 2, 3]]]);
  r = applyBezier(EASE, "In-Out");
  after = [side(three, 1, true), side(three, 2, false), side(three, 2, true), side(three, 3, false)];
  checkEq("In-Out: eased all three keys", r.eased, 3);
  check("In-Out: every side with a neighbour changed", after[0] !== before[0] && after[1] !== before[1] && after[2] !== before[2] && after[3] !== before[3], after.join(" ; "));
  checkNear("In-Out: first segment follows the curve", three.valueAtTime(0.25, false), bezierY(EASE, 0.25) * 100, 1);
  checkNear("In-Out: second segment follows the curve (100 -> 40)", three.valueAtTime(1.25, false), 100 - 60 * bezierY(EASE, 0.25), 0.6);
  undo();
  checkEq("In-Out: one undo restores every side", [side(three, 1, true), side(three, 2, false), side(three, 2, true), side(three, 3, false)].join(" ; "), before.join(" ; "));

  // One selected key with neighbours: both of its sides, and the neighbours stay as they were.
  selectOnly([[three, [2]]]);
  r = applyBezier(EASE, "In-Out");
  after = [side(three, 1, true), side(three, 2, false), side(three, 2, true), side(three, 3, false)];
  checkEq("one key: eased 1", r.eased, 1);
  check("one key: both of its sides changed", after[1] !== before[1] && after[2] !== before[2], after.join(" ; "));
  check("one key: the neighbours are not changed", after[0] === before[0] && after[3] === before[3], after.join(" ; "));
  undo();

  // The first key has no key before it: In has nothing to ease there.
  selectOnly([[three, [1]]]);
  var s0 = state(three);
  r = applyBezier(EASE, "In");
  checkEq("first key, In: nothing to ease", r.eased, 0);
  checkEq("first key, In: nothing changed", state(three), s0);

  // Nothing selected: nothing happens.
  selectOnly([]);
  s0 = state(three) + state(rot) + state(pos);
  r = applyBezier(EASE, "In-Out");
  checkEq("nothing selected: eased 0", r.eased + "/" + r.roving + "/" + r.properties, "0/0/0");
  checkEq("nothing selected: nothing changed", state(three) + state(rot) + state(pos), s0);

  // A Hold side stays a Hold when the other side is eased.
  three.setInterpolationTypeAtKey(2, three.keyInInterpolationType(2), HOLD);
  selectOnly([[three, [2]]]);
  applyBezier(EASE, "In");
  checkEq("Hold: the out side is still a Hold after easing In", three.keyOutInterpolationType(2), HOLD);
  checkNear("Hold: the in side was eased", three.keyInTemporalEase(2)[0].influence, 42, 1e-6);
  checkEq("Hold: From keys on a hold segment is null", (function () { selectOnly([[three, [2, 3]]]); return captureBezier(); })(), null);

  // Roving keys are skipped and counted.
  var e = solid("E");
  var rove = keyed(e, e.transform.position, [0, 1, 2], [[0, 0], [200, 100], [400, 0]]);
  var canRove = false;
  try {
    rove.setRovingAtKey(2, true);
    canRove = rove.keyRoving(2) === true;
  } catch (x) {
    canRove = false;
  }
  check("the test could make a roving key", canRove);
  if (canRove) {
    selectOnly([[rove, [1, 2, 3]]]);
    r = applyBezier(EASE, "In-Out");
    checkEq("roving: the roving key is skipped and counted", r.eased + "/" + r.roving, "2/1");
    checkEq("roving: the key is still roving", rove.keyRoving(2), true);
  }

  // Two properties at once, one undo step.
  selectOnly([[rot, [1, 2]], [scl, [1, 2]]]);
  applyBezier([0, 0, 1, 1], "In-Out");
  var s1 = state(rot) + state(scl);
  r = applyBezier(EASE, "In-Out");
  checkEq("two properties: eased 4 keys on 2 properties", r.eased + "/" + r.properties, "4/2");
  check("two properties: both changed", state(rot) + state(scl) !== s1);
  undo();
  checkEq("two properties: one undo restores both", state(rot) + state(scl), s1);

  // A property with a single keyframe cannot ease.
  var f = solid("F");
  var single = keyed(f, f.transform.rotation, [0], [10]);
  selectOnly([[single, [1]]]);
  r = applyBezier(EASE, "In-Out");
  checkEq("a single keyframe: nothing eased", r.eased + "/" + r.properties, "0/0");

  // Speeds scale with the segment: a short, small move gets the same shape.
  var g = solid("G");
  var small = keyed(g, g.transform.rotation, [3, 3.2], [10, 12]);
  selectOnly([[small, [1, 2]]]);
  applyBezier(EASE, "In-Out");
  checkNear("a 0.2 s, 2 degree move follows the same curve", small.valueAtTime(3.05, false), 10 + 2 * bezierY(EASE, 0.25), 0.02);
})();

report();
