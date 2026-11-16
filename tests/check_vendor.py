"""The apply engine in src/apply.js must stay the upstream code.

Compares every vendored function with the pinned copy of EffectCraft's Ease Presets.jsx
(vendor/EasePresets.v0.24.1.jsx, SHA-256 checked first). The one allowed difference is the undo
step's name.
"""
import hashlib
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(ROOT, "vendor", "EasePresets.v0.24.1.jsx")
VENDOR_SHA256 = "2a667cd060b34bb43f367f0df53959cefbcc399917aeb854ca05dd9eb04d1785"
FUNCTIONS = ["curve", "finite", "sanitized", "selectedKeyed", "selectedPairs", "pathLength", "layerOf",
             "slopes", "easeSide", "eases", "applyCurve", "captureCurve"]


def function_source(text, name):
    """The source of top-level `function name(...) {...}` in `text` (after removing 2-space indents)."""
    lines = [l[2:] if l.startswith("  ") else l for l in text.split("\n")]
    for i, l in enumerate(lines):
        if l.startswith("function %s(" % name):
            depth, out = 0, []
            for m in lines[i:]:
                out.append(m)
                depth += m.count("{") - m.count("}")
                if depth == 0:
                    return "\n".join(out)
    return None


def run(_runner):
    raw = open(VENDOR, "rb").read()
    if hashlib.sha256(raw).hexdigest() != VENDOR_SHA256:
        return False, "FAILED the pinned vendor file changed (SHA-256 mismatch)"
    vendor = raw.decode("utf-8")
    ours = open(os.path.join(ROOT, "src", "apply.js"), encoding="utf-8").read()
    start, end = ours.index("// ---- vendored from"), ours.index("// ---- end of vendored code")
    # src/apply.js is not indented inside an IIFE, the vendor file is: indent ours to compare.
    region = "\n".join(("  " + l) if l else l for l in ours[start:end].split("\n"))
    bad = []
    for name in FUNCTIONS:
        theirs = function_source(vendor, name)
        mine = function_source(region, name)
        if theirs is None or mine is None:
            bad.append("%s: not found (%s)" % (name, "vendor" if theirs is None else "src/apply.js"))
            continue
        mine = mine.replace("app.beginUndoGroup(UNDO_NAME)", 'app.beginUndoGroup("Apply Ease Preset")')
        if mine != theirs:
            bad.append("%s: differs from the pinned upstream code" % name)
    if bad:
        return False, "FAILED %d of %d vendored functions\n%s" % (len(bad), len(FUNCTIONS), "\n".join("FAIL " + b for b in bad))
    return True, "PASSED all %d vendored functions match the pinned upstream file" % len(FUNCTIONS)
