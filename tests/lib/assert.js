// Tiny test helper shared by the SmoothCurve tests. Each test file ends with `report()`, whose
// string is the script's result: the runner looks for "FAIL" in it.

var __results = [];
var __failed = 0;

function check(name, ok, detail) {
  if (ok) {
    __results.push("ok   " + name);
  } else {
    __failed++;
    __results.push("FAIL " + name + (detail !== undefined ? " :: " + detail : ""));
  }
}

function near(a, b, tol) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;
}

function checkNear(name, got, want, tol) {
  check(name, near(got, want, tol), "got " + got + ", want " + want + " (tol " + tol + ")");
}

function checkEq(name, got, want) {
  check(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}

function checkThrowsNothing(name, f) {
  try {
    f();
    check(name, true);
  } catch (e) {
    check(name, false, "threw " + (e && e.message ? e.message : e));
  }
}

function report() {
  var n = 0;
  for (var j = 0; j < __results.length; j++) if (__results[j].indexOf("note") !== 0) n++;
  var head = (__failed ? "FAILED " + __failed + " of " : "PASSED all ") + n + " checks";
  var lines = [];
  for (var i = 0; i < __results.length; i++) if (__results[i].indexOf("FAIL") === 0 || __results[i].indexOf("note") === 0) lines.push(__results[i]);
  return head + (lines.length ? "\n" + lines.join("\n") : "");
}
