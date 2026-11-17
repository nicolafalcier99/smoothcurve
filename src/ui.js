// SmoothCurve panel: everything the user sees and touches.
//
// One custom-drawn canvas (a button with onDraw) fills the panel and does its own hit-testing;
// the few places that take typed text are real edit fields laid over it. EffectCraft re-runs
// onDraw after every handler, so the code below only changes `state` and the draw follows.

var SMOOTHCURVE_VERSION = "1.1.0";

// ------------------------------------------------------------------ text metrics
// EffectCraft draws ScriptUI text in Inter Regular, top-left anchored, and its measureString is
// only an estimate. These are Inter's advance widths (1/1000 em) for characters 32 to 126, read
// from the font file the app embeds, so text can be centred, right-aligned and cut to fit.
var GLYPH_W = [281, 288, 466, 633, 642, 982, 644, 300, 365, 365, 501, 662, 288, 460, 288, 360, 631, 407, 610, 618,
  646, 593, 620, 566, 619, 620, 288, 302, 662, 662, 662, 511, 966, 690, 654, 730, 722, 601, 590, 746, 743, 269, 571,
  672, 565, 903, 753, 765, 639, 765, 644, 642, 646, 744, 690, 985, 682, 679, 629, 365, 360, 365, 471, 456, 323, 562,
  612, 571, 612, 583, 370, 613, 591, 242, 242, 549, 242, 876, 591, 600, 612, 612, 376, 528, 327, 591, 562, 818, 546,
  562, 552, 426, 333, 426, 662];
var GLYPH_OTHER = { 8230: 864, 8220: 440, 8221: 440, 8226: 563, 215: 662, 8211: 500, 233: 583, 232: 583, 9656: 600, 183: 288 };
var CAP_MIDDLE = 0.605;      // from the top of a text row to the middle of its capitals, in em

function glyphWidth(code) {
  if (code >= 32 && code <= 126) return GLYPH_W[code - 32];
  return GLYPH_OTHER[code] || 620;
}

function textWidth(s, size, tracking) {
  var w = 0, n = s.length;
  for (var i = 0; i < n; i++) w += glyphWidth(s.charCodeAt(i));
  return w * size / 1000 + (tracking ? tracking * Math.max(0, n - 1) : 0);
}

// `s`, or its start with an ellipsis, so that it is at most `maxW` wide.
function fitText(s, size, maxW, tracking) {
  if (textWidth(s, size, tracking) <= maxW) return s;
  var t = s;
  while (t.length > 1 && textWidth(t + "…", size, tracking) > maxW) t = t.substring(0, t.length - 1);
  return t.replace(/\s+$/, "") + "…";
}

// `s` broken into lines at most `maxW` wide (at spaces; a single long word is cut to fit).
function wrapText(s, size, maxW) {
  var words = String(s).split(/\s+/), lines = [], cur = "";
  for (var i = 0; i < words.length; i++) {
    if (!words[i].length) continue;
    var next = cur.length ? cur + " " + words[i] : words[i];
    if (textWidth(next, size) <= maxW || !cur.length) cur = next;
    else {
      lines.push(cur);
      cur = words[i];
    }
  }
  if (cur.length) lines.push(cur);
  for (var j = 0; j < lines.length; j++) lines[j] = fitText(lines[j], size, maxW);
  return lines;
}

// ------------------------------------------------------------------ colours
// Our own dark, flat look: the panel paints its background, so it is the same in every theme.
var COLORS = {
  bg: [0.106, 0.110, 0.122, 1],
  well: [0.071, 0.075, 0.086, 1],
  surface: [0.157, 0.165, 0.184, 1],
  surfaceHover: [0.204, 0.216, 0.239, 1],
  line: [0.169, 0.180, 0.200, 1],
  lineStrong: [0.247, 0.259, 0.286, 1],
  text: [0.898, 0.906, 0.922, 1],
  dim: [0.588, 0.608, 0.647, 1],
  faint: [0.392, 0.408, 0.443, 1],
  accent: [0.29, 0.56, 1, 1],               // EffectCraft's own blue
  accentHover: [0.42, 0.65, 1, 1],
  accentPress: [0.22, 0.46, 0.86, 1],
  accentSoft: [0.29, 0.56, 1, 0.17],
  handle: [1, 0.78, 0.24, 1],
  danger: [0.87, 0.29, 0.30, 1],
  dangerHover: [0.95, 0.38, 0.39, 1],
  white: [1, 1, 1, 1]
};

var alphaColors = {};
function withAlpha(c, a) {
  var k = c[0] + "," + c[1] + "," + c[2] + "," + a;
  if (!alphaColors[k]) alphaColors[k] = [c[0], c[1], c[2], a];
  return alphaColors[k];
}

var MODES = ["In", "Out", "In-Out"];
// The graph's grid never changes size by itself. The 0..1 box is a square, and above and below
// it there is always room for overshoot: at least HEAD_MIN of the box's height, and up to
// HEAD_MAX when the panel is tall. To see a curve that goes further, the user zooms out: the
// box gets smaller in steps, down to where everything a handle can reach is in sight.
var HEAD_MIN = 0.14;
var HEAD_MAX = 0.4;
var ZOOMS = [1, 0.75, 0.55, 0.4, 0.3];
var GRAPH_PAD = 13;
var LOCKS = [
  ["length", "Length", "Keep the handle's length while dragging (or hold Ctrl / Cmd)"],
  ["angle", "Angle", "Keep the handle's angle while dragging (or hold Alt)"],
  ["mirror", "Mirror", "Move both handles symmetrically (or hold Ctrl / Cmd + Shift)"],
  ["snap", "Snap", "Snap the handle to the floor or the ceiling (or hold Shift)"]
];
var HANDLE_TIP = "Drag to shape the curve.\nShift: snap to floor or ceiling\nCtrl / Cmd: keep length\nAlt: keep angle\nCtrl / Cmd + Shift: mirror";

function buildPanel(thisObj) {
  var ui = thisObj instanceof Panel ? thisObj : new Window("palette", "SmoothCurve", undefined, { resizeable: true });
  ui.margins = 0;
  ui.spacing = 0;

  var canvas = ui.add("button", undefined, "", { name: "canvas" });
  var readout = ui.add("edittext", undefined, "", { name: "readout" });
  var searchField = ui.add("edittext", undefined, "", { name: "search" });
  var nameField = ui.add("edittext", undefined, "", { name: "name" });
  var sheetText = ui.add("edittext", undefined, "", { name: "libraryText" });
  var sheetPath = ui.add("edittext", undefined, "", { name: "libraryPath" });
  // The panel's state as JSON for scripts and agents that drive it (hidden, takes no space).
  var automation = ui.add("statictext", undefined, "", { name: "automation" });
  automation.visible = false;
  readout.helpTip = "x1, y1, x2, y2. Type numbers or paste cubic-bezier(0.42, 0, 0.58, 1)";
  searchField.helpTip = "Show only the curves whose name contains this";
  sheetPath.helpTip = "A full path, for example /Users/you/Desktop/My curves" + LIBRARY_EXTENSION;

  var store = loadStore();
  var saved = loadUiState();
  var W = 300, H = 720, L = null, G = null, hits = [];
  var state = {
    bezier: sanitizeBezier(saved.bezier) || PRESETS[3].bezier.slice(0),      // Sine In-Out
    ghost: null,                // the curve before the last change, drawn faintly
    hoverBezier: null,          // a hovered preset, drawn faintly on the graph
    mode: saved.mode === "In" || saved.mode === "Out" ? saved.mode : "In-Out",
    locks: { length: false, angle: false, mirror: false, snap: false },
    auto: saved.auto === true,
    tab: saved.tab === "mine" ? "mine" : "easings",
    selected: null,             // {lib: "easings" | "mine", name}
    search: "",
    scroll: 0,                  // first visible row of the preset grid
    zoom: saved.zoom === Math.round(saved.zoom) && saved.zoom > 0 && saved.zoom < ZOOMS.length ? saved.zoom : 0,      // index into ZOOMS
    status: "Select keyframes, then press Apply.",
    statusKind: "info",
    menu: null,                 // "library" | "more"
    bar: null,                  // {kind: "save" | "newLibrary" | "renameLibrary" | "deletePreset" | "deleteLibrary", …}
    page: "main",               // "main" | "export" | "import"
    sheetNote: "",
    drag: null,                 // {which, start}
    scrolling: null,            // the scroll bar while it is dragged
    gridPress: null,            // a press on a tile, which scrolls the list when it moves up or down
    hover: null,
    pressed: null,
    ball: null,                 // the motion strip's ball while it plays: {start}
    exportDir: typeof saved.exportDir === "string" ? saved.exportDir : ""
  };
  if (saved.locks && typeof saved.locks === "object") {
    for (var li = 0; li < LOCKS.length; li++) state.locks[LOCKS[li][0]] = saved.locks[LOCKS[li][0]] === true;
    if (state.locks.length && state.locks.angle) state.locks.angle = false;
  }
  var ballTask = null;

  // ------------------------------------------------------------------ small state helpers

  function setStatus(text, kind) {
    state.status = String(text);
    state.statusKind = kind || "info";
  }

  function lib() {
    return activeLibrary(store);
  }

  function selectedPreset() {
    if (!state.selected) return null;
    var list = state.selected.lib === "easings" ? PRESETS : lib().presets;
    var i = findPreset(list, state.selected.name);
    return i < 0 ? null : list[i];
  }

  // Keep the selection honest: the selected preset must be exactly the current curve. When it
  // is not, a built-in easing or one of the library's curves that is the current curve takes over.
  function matchSelection() {
    var sel = selectedPreset(), b = roundBezier(state.bezier), i;
    if (sel && sameBezier(roundBezier(sel.bezier), b)) return;
    state.selected = null;
    for (i = 0; i < PRESETS.length; i++) {
      if (sameBezier(PRESETS[i].bezier, b)) {
        state.selected = { lib: "easings", name: PRESETS[i].name };
        return;
      }
    }
    var list = lib().presets;
    for (i = 0; i < list.length; i++) {
      if (sameBezier(list[i].bezier, b)) {
        state.selected = { lib: "mine", name: list[i].name };
        if (!state.bar) nameField.text = list[i].name;
        return;
      }
    }
  }

  function isSaved() {
    var list = lib().presets, b = roundBezier(state.bezier);
    for (var i = 0; i < list.length; i++) if (sameBezier(list[i].bezier, b)) return true;
    return false;
  }

  function setCurve(b, keepGhost) {
    var clean = sanitizeBezier(b);
    if (!clean) return false;
    if (keepGhost && !sameBezier(clean, state.bezier)) state.ghost = state.bezier.slice(0);
    state.bezier = clean;
    readout.text = formatBezier(clean);
    matchSelection();
    return true;
  }

  function persist() {
    saveUiState({ bezier: roundBezier(state.bezier), mode: state.mode, locks: state.locks, auto: state.auto, tab: state.tab, zoom: state.zoom, exportDir: state.exportDir });
  }

  function saveLibraries() {
    if (!saveStore(store)) setStatus("EffectCraft could not save the libraries to its settings.", "warn");
  }

  // ------------------------------------------------------------------ actions

  function doApply() {
    var r;
    try {
      r = applyBezier(state.bezier, state.mode);
    } catch (e) {
      setStatus("Could not ease the keyframes: " + (e && e.message ? e.message : e), "warn");
      return;
    }
    var skipped = r.roving > 0 ? " " + plural(r.roving, "roving keyframe", "roving keyframes") + " skipped." : "";
    if (r.eased > 0) {
      var sides = state.mode === "In" ? " (incoming side)" : state.mode === "Out" ? " (outgoing side)" : "";
      setStatus("Eased " + plural(r.eased, "keyframe", "keyframes") + " on " + plural(r.properties, "property", "properties") + sides + "." + skipped, "ok");
    } else if (r.roving > 0) {
      setStatus("Nothing eased:" + skipped + " Turn off Roving to ease them.", "warn");
    } else if (!(app.project && app.project.activeItem instanceof CompItem)) {
      setStatus("Open a composition and select keyframes first.", "warn");
    } else {
      var where = state.mode === "In" ? "before" : state.mode === "Out" ? "after" : "next to";
      setStatus("Nothing eased. Select keyframes that have another keyframe " + where + " them.", "warn");
    }
  }

  function fromKeys() {
    var b = null;
    try {
      b = captureBezier();
    } catch (e) {
      b = null;
    }
    if (!b) {
      setStatus("Select two neighbouring keyframes whose value changes, then try From keys again.", "warn");
      return;
    }
    setCurve(b, true);
    setStatus("Read the curve between the first two selected keyframes.", "ok");
    persist();
  }

  function choosePreset(libKey, preset, e) {
    var m = presetClickMode(e);
    if (m) state.mode = m;
    setCurve(preset.bezier, true);
    state.selected = { lib: libKey, name: preset.name };
    state.bar = null;
    if (libKey === "mine") nameField.text = preset.name;
    if (state.auto || (e && e.detail >= 2)) doApply();
    else setStatus(preset.name + (m ? " (" + (m === "In" ? "incoming side" : m === "Out" ? "outgoing side" : "both sides") + ")" : "") + ". Double-click a curve to apply it at once.", "info");
    persist();
  }

  function openBar(kind, value, extra) {
    state.bar = { kind: kind, value: value || "" };
    if (extra) for (var k in extra) state.bar[k] = extra[k];
    state.menu = null;
    nameField.text = value || "";
  }

  function closeBar() {
    state.bar = null;
    var sel = selectedPreset();
    nameField.text = sel && state.selected.lib === "mine" ? sel.name : "";
  }

  function confirmBar() {
    var bar = state.bar, r;
    if (!bar) return;
    if (bar.kind === "save") {
      r = savePreset(store, nameField.text, state.bezier);
      if (r.ok) {
        saveLibraries();
        state.tab = "mine";
        state.search = "";
        searchField.text = "";
        state.selected = { lib: "mine", name: r.name };
      }
    } else if (bar.kind === "newLibrary") {
      r = newLibrary(store, nameField.text);
      if (r.ok) {
        saveLibraries();
        state.tab = "mine";
        state.selected = null;
        state.scroll = 0;
      }
    } else if (bar.kind === "renameLibrary") {
      r = renameLibrary(store, nameField.text);
      if (r.ok) saveLibraries();
    } else if (bar.kind === "deletePreset") {
      r = deletePreset(store, bar.name);
      if (r.ok) {
        saveLibraries();
        state.selected = null;
      }
    } else if (bar.kind === "deleteLibrary") {
      r = deleteLibrary(store);
      if (r.ok) {
        saveLibraries();
        state.selected = null;
        state.scroll = 0;
      }
    }
    if (!r) return;
    setStatus(r.message, r.ok ? "ok" : "warn");
    if (r.ok) closeBar();
  }

  function renameSelected() {
    var sel = selectedPreset();
    if (!sel || state.selected.lib !== "mine") return;
    var r = renamePreset(store, sel.name, nameField.text);
    if (r.ok) {
      saveLibraries();
      state.selected = { lib: "mine", name: r.name };
      nameField.text = r.name;
    }
    setStatus(r.message, r.ok ? "ok" : "warn");
  }

  function projectFolder() {
    try {
      var f = app.project && app.project.file;
      if (f && f.path) return String(f.path);
    } catch (e) {}
    return "";
  }

  function openPage(page) {
    state.page = page;
    state.menu = null;
    state.bar = null;
    state.sheetNote = "";
    var dir = state.exportDir || projectFolder();
    if (page === "export") {
      sheetText.text = libraryToText(lib());
      sheetPath.text = dir ? dir.replace(/[\/\\]+$/, "") + "/" + lib().name.replace(/[\/\\:*?"<>|]/g, "-") + LIBRARY_EXTENSION : "";
    } else {
      sheetText.text = "";
      sheetPath.text = "";
    }
  }

  function closePage() {
    state.page = "main";
    state.sheetNote = "";
    sheetText.text = "";
  }

  function rememberFolder(path) {
    var m = /^(.*)[\/\\][^\/\\]*$/.exec(path);
    if (m && m[1].length) {
      state.exportDir = m[1];
      persist();
    }
  }

  function saveLibraryFile() {
    var r = writeTextFile(sheetPath.text, libraryToText(lib()));
    state.sheetNote = r.message;
    if (r.ok) rememberFolder(r.path);
  }

  function importFrom(text) {
    var r = importLibrary(store, text);
    if (!r.ok) {
      state.sheetNote = r.message;
      return false;
    }
    saveLibraries();
    state.tab = "mine";
    state.selected = null;
    state.scroll = 0;
    state.search = "";
    searchField.text = "";
    closePage();
    setStatus(r.message, "ok");
    persist();
    return true;
  }

  function loadLibraryFile() {
    var r = readTextFile(sheetPath.text);
    if (!r.ok) {
      state.sheetNote = r.message;
      return;
    }
    rememberFolder(r.path);
    importFrom(r.text);
  }

  function playStrip() {
    state.ball = { start: new Date().getTime() };
    try {
      if (ballTask !== null) app.cancelTask(ballTask);
      ballTask = app.scheduleTask("if ($.global.__smoothCurveTick) $.global.__smoothCurveTick();", 50, true);
    } catch (e) {
      ballTask = null;
      state.ball = null;
    }
  }

  // One tick of the strip's ball (app.scheduleTask runs it; the draw that follows moves the ball).
  $.global.__smoothCurveTick = guarded(function () {
    if (state.ball && new Date().getTime() - state.ball.start <= 1500) return;
    state.ball = null;
    if (ballTask !== null) {
      try { app.cancelTask(ballTask); } catch (e) {}
      ballTask = null;
    }
  });

  // ------------------------------------------------------------------ drawing primitives
  // With G null these do nothing: the same code then only collects the hit regions.

  var fonts = {};
  function pen(c, w) {
    var k = "p" + w;
    if (!c[k]) c[k] = G.newPen(G.PenType.SOLID_COLOR, [c[0], c[1], c[2], c[3]], w);
    return c[k];
  }
  function brush(c) {
    if (!c.b) c.b = G.newBrush(G.BrushType.SOLID_COLOR, [c[0], c[1], c[2], c[3]]);
    return c.b;
  }
  function font(size) {
    if (!fonts[size]) fonts[size] = ScriptUI.newFont("dialog", "REGULAR", size);
    return fonts[size];
  }

  function fillRect(x, y, w, h, c) {
    if (!G || w <= 0 || h <= 0) return;
    G.newPath();
    G.rectPath(q(x), q(y), q(w), q(h));
    G.fillPath(brush(c));
  }

  // The draw list is sent to the app as text after every event, so its size is the panel's
  // speed: coordinates are kept to a tenth of a pixel and shapes to as few points as look right.
  function q(v) {
    return Math.round(v * 10) / 10;
  }

  function line(x1, y1, x2, y2, c, w) {
    if (!G) return;
    G.newPath();
    G.moveTo(q(x1), q(y1));
    G.lineTo(q(x2), q(y2));
    G.strokePath(pen(c, w || 1));
  }

  // pts: [x0, y0, x1, y1, …]
  function polyline(pts, c, w) {
    if (!G || pts.length < 4) return;
    G.newPath();
    G.moveTo(q(pts[0]), q(pts[1]));
    for (var i = 2; i < pts.length; i += 2) G.lineTo(q(pts[i]), q(pts[i + 1]));
    G.strokePath(pen(c, w || 1));
  }

  function polygon(pts, fill, stroke, lw) {
    if (!G || pts.length < 6) return;
    G.newPath();
    G.moveTo(q(pts[0]), q(pts[1]));
    for (var i = 2; i < pts.length; i += 2) G.lineTo(q(pts[i]), q(pts[i + 1]));
    G.closePath();
    if (fill) G.fillPath(brush(fill));
    if (stroke) G.strokePath(pen(stroke, lw || 1));
  }

  function circle(cx, cy, r, fill, stroke, lw) {
    if (!G) return;
    G.newPath();
    G.ellipsePath(q(cx - r), q(cy - r), r * 2, r * 2);
    if (fill) G.fillPath(brush(fill));
    if (stroke) G.strokePath(pen(stroke, lw || 1));
  }

  // A rectangle, with corners rounded by `r` when r is 1 or more. ScriptUI has no rounded
  // rectangle: this is a polygon with two steps per corner. Controls are square; only the two
  // surfaces (the graph's well and an open menu) use it.
  var CORNER = (function () {
    var out = [];
    for (var c = 0; c < 4; c++) for (var k = 0; k <= 2; k++) {
      var a = (-90 + c * 90 + k * 45) * Math.PI / 180;
      out.push([Math.cos(a), Math.sin(a)]);
    }
    return out;
  })();
  function boxPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    G.newPath();
    if (r < 1) {
      G.rectPath(q(x), q(y), q(w), q(h));
      return;
    }
    var cx = [x + w - r, x + w - r, x + r, x + r], cy = [y + r, y + h - r, y + h - r, y + r];
    for (var i = 0; i < 12; i++) {
      var c = Math.floor(i / 3), px = q(cx[c] + r * CORNER[i][0]), py = q(cy[c] + r * CORNER[i][1]);
      if (i === 0) G.moveTo(px, py); else G.lineTo(px, py);
    }
    G.closePath();
  }
  function rrect(x, y, w, h, r, fill, stroke, lw) {
    if (!G || w <= 0 || h <= 0) return;
    if (fill) {
      boxPath(x, y, w, h, r);
      G.fillPath(brush(fill));
    }
    if (stroke) {
      boxPath(x + 0.5, y + 0.5, w - 1, h - 1, r);
      G.strokePath(pen(stroke, lw || 1));
    }
  }

  // Text with its row's top at y. align: "l" (default), "c" or "r" about x.
  function drawText(s, x, y, size, c, align, maxW, tracking) {
    s = String(s);
    if (maxW !== undefined && maxW !== null) s = fitText(s, size, Math.max(0, maxW), tracking);
    if (!G || !s.length) return;
    var w = align === "c" || align === "r" ? textWidth(s, size, tracking) : 0;
    var tx = align === "c" ? x - w / 2 : align === "r" ? x - w : x;
    tx = Math.round(tx * 2) / 2;
    y = Math.round(y * 2) / 2;
    if (tracking) {
      for (var i = 0; i < s.length; i++) {
        G.drawString(s.charAt(i), pen(c, 1), tx, y, font(size));
        tx += glyphWidth(s.charCodeAt(i)) * size / 1000 + tracking;
      }
    } else {
      G.drawString(s, pen(c, 1), tx, y, font(size));
    }
  }

  // Text whose capitals are vertically centred on cy.
  function drawTextMid(s, x, cy, size, c, align, maxW, tracking) {
    drawText(s, x, cy - size * CAP_MIDDLE, size, c, align, maxW, tracking);
  }

  // ------------------------------------------------------------------ hit regions

  function hit(id, x, y, w, h, o) {
    hits.push({ id: id, x: x, y: y, w: w, h: h, tip: o && o.tip ? o.tip : "", click: o && o.click, down: o && o.down, hover: o && o.hover });
  }

  function hitAt(x, y) {
    for (var i = hits.length - 1; i >= 0; i--) {
      var r = hits[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
    }
    return null;
  }

  // A text button. o: {tip, click, primary, danger, on, choice, size, tracking, quiet}
  function button(id, x, y, w, h, label, o) {
    var hov = state.hover === id, prs = state.pressed === id && hov;
    var fill, ink = COLORS.text, edge = null;
    if (o.primary) fill = prs ? COLORS.accentPress : hov ? COLORS.accentHover : COLORS.accent, ink = COLORS.white;
    else if (o.danger) fill = hov ? COLORS.dangerHover : COLORS.danger, ink = COLORS.white;
    else if (o.choice) fill = hov ? COLORS.accentHover : COLORS.accent, ink = COLORS.white;         // the chosen one of several
    else if (o.on) fill = COLORS.accentSoft, edge = COLORS.accent;                                 // a switch that is on
    else fill = hov ? COLORS.surfaceHover : COLORS.surface, ink = hov ? COLORS.text : COLORS.dim;
    rrect(x, y, w, h, o.radius || 0, fill, edge);
    drawTextMid(label, x + w / 2, y + h / 2, o.size || 11, ink, "c", w - 6, o.tracking);
    hit(id, x, y, w, h, o);
  }

  // ------------------------------------------------------------------ layout

  function gridMeasure(w, mode, h) {
    var m = { grouped: false, labels: mode !== "strip" };
    if (state.tab === "easings" && mode !== "strip") {
      m = easingsMeasure(w);
      // With room to spare the tiles grow taller, up to square.
      if (h) m.th = clamp(Math.floor((h + 6) / m.rows) - 21, m.th, m.tw);
      m.rowH = m.th + 21;
      return m;
    } else {
      var list = shownPresets();
      m.list = list;
      m.gap = mode === "strip" ? 3 : 6;
      // In the strip a tile is as tall as the strip (up to 30 px, then more rows fit).
      var stripH = mode === "strip" ? clamp((h || 30) - 2, 14, 30) : 0;
      var want = mode === "strip" ? Math.round(stripH * 1.25) : 68;
      m.perRow = Math.max(1, Math.floor((w + m.gap) / (want + m.gap)));
      m.tw = Math.floor((w - (m.perRow - 1) * m.gap) / m.perRow);
      m.th = mode === "strip" ? stripH : clamp(Math.round(m.tw * 0.46), 22, 34);
      m.count = list.length;
      // A low grid shows two rows of lower tiles rather than one row over a gap.
      var two = Math.floor(((h || 0) + 6) / 2) - 21;
      if (mode !== "strip" && m.count > m.perRow && two >= 22 && two < m.th) m.th = two;
    }
    m.rowH = m.th + (m.labels ? 21 : 3);
    m.rows = Math.ceil(m.count / m.perRow);
    return m;
  }

  // The built-in easings as groups: one family's In, Out and In-Out side by side over its name.
  function easingsMeasure(w) {
    var m = { grouped: true, labels: true, gap: 10, tgap: 2 };
    m.perRow = w >= 258 ? 3 : w >= 168 ? 2 : 1;
    m.gw = Math.floor((w - (m.perRow - 1) * m.gap) / m.perRow);
    m.tw = Math.min(46, Math.floor((m.gw - 2 * m.tgap) / 3));
    m.th = clamp(Math.round(m.tw * 0.8), 18, 34);
    m.count = PRESET_FAMILIES.length + 1;
    m.rowH = m.th + 21;
    m.rows = Math.ceil(m.count / m.perRow);
    return m;
  }

  // The presets the grid lists when it is not the grouped Easings view.
  function shownPresets() {
    var out = [], i;
    if (state.tab === "easings") {
      for (i = 1; i < PRESETS.length; i++) out.push({ lib: "easings", preset: PRESETS[i] });
      out.push({ lib: "easings", preset: PRESETS[0] });
      return out;
    }
    var list = lib().presets, q = state.search.toLowerCase();
    for (i = 0; i < list.length; i++) if (!q.length || list[i].name.toLowerCase().indexOf(q) >= 0) out.push({ lib: "mine", preset: list[i] });
    return out;
  }

  function presetRowWanted(mode) {
    return (mode === "tall" || mode === "wide") && state.tab === "mine" && !state.bar && state.selected !== null && state.selected.lib === "mine" && selectedPreset() !== null;
  }

  function searchWanted() {
    return state.tab === "mine" && !state.bar && (lib().presets.length > 8 || state.search.length > 0);
  }

  function baseLayout() {
    var P = W < 250 ? 8 : 10;
    var o = { W: W, H: H, P: P, narrow: W < 250, mode: "tall", rows: true, strip: true };
    if (state.page !== "main") {
      o.mode = "sheet";
      return o;
    }
    var HEADER = 30, STATUS = 30, APPLY = 30, TABS = 24;         // the status line may wrap once
    var below = 6 + 24 + 6 + 24 + 6 + 22 + 4 + 22 + 4 + 20;        // strip, readout, ease, lock, auto rows
    var belowCompact = 6 + 24 + 6 + 22;                             // readout and ease rows only
    var bottom = 8 + APPLY + 5 + STATUS + 6;
    var wide = W >= 520 && W > H * 1.2;
    var colW = wide ? clamp(Math.round(W * 0.42), 240, 420) : W - 2 * P;
    var gridW = wide ? W - colW - 3 * P : W - 2 * P;
    var presetRow = presetRowWanted(wide ? "wide" : "tall") ? 28 : 0;
    // The sizes depend on the built-in easings' rows whatever tab is showing, so the graph does
    // not jump when the tab changes.
    var eg = easingsMeasure(gridW);
    var gridWanted = eg.rows * eg.rowH - 6, gridMin = eg.rowH, gridTwo = Math.min(gridWanted, 2 * eg.rowH - 6);
    // ...and for two rows of your own curves under the rename row, which are taller tiles.
    var mineCols = Math.max(1, Math.floor((gridW + 6) / 74)), mineTw = Math.floor((gridW - (mineCols - 1) * 6) / mineCols);
    gridWanted = Math.max(gridWanted, 2 * (clamp(Math.round(mineTw * 0.46), 22, 34) + 21) - 6 + 28);
    var GMIN = 88, GGOOD = 150, avail, graphH = 0, compact = false, editor = true;
    // The graph at its full size: a square box as wide as the column with the least headroom...
    var graphFull = Math.ceil((colW - 2 * GRAPH_PAD) * (1 + 2 * HEAD_MIN)) + 2 * GRAPH_PAD;
    // ...and at its tallest: the same box with the most headroom.
    var graphCap = Math.round((colW - 2 * GRAPH_PAD) * (1 + 2 * HEAD_MAX)) + 2 * GRAPH_PAD;
    // Below this the graph is too small to work in, and something else gives way.
    var graphGood = Math.max(GGOOD, Math.round(graphFull * 0.65));
    // The graph comes before the presets. It takes its full size and the presets scroll in what
    // is left, down to two rows; with less height than that the graph shrinks (its box stays
    // square), and when it would get too small the presets go down to one row. Only when every
    // row of presets shows does spare height become more headroom.
    var graphShare = function (a) {
      if (a >= graphFull + gridWanted) return Math.min(a - gridWanted, graphCap);
      if (a - gridTwo >= graphGood) return Math.min(graphFull, a - gridTwo);
      return Math.min(graphFull, a - gridMin);
    };

    if (H < 150 || W < 150) {
      o.mode = "strip";
    } else if (wide) {
      avail = H - HEADER - 4 - below - bottom;
      if (avail < GGOOD) {
        compact = true;
        avail = H - HEADER - 4 - belowCompact - bottom;
      }
      if (avail < GMIN) editor = false;
      else graphH = Math.min(avail, graphCap);
      o.mode = editor ? "wide" : "presets";
    } else if (W < 200) {
      // Too narrow for four switches in a row: the compact rows whatever the height.
      compact = true;
      avail = H - HEADER - 4 - belowCompact - (8 + TABS + 4) - bottom;
      if (avail < GMIN + gridMin) editor = false;
      else graphH = graphShare(avail);
      o.mode = editor ? "tall" : "presets";
    } else {
      var presetsFixed = 8 + TABS + 4;
      avail = H - HEADER - 4 - below - presetsFixed - bottom;
      if (avail - gridTwo < graphGood) {
        // Not enough height for a graph to work in over two rows of presets: the strip, the
        // locks and Auto-apply go first.
        compact = true;
        avail = H - HEADER - 4 - belowCompact - presetsFixed - bottom;
      }
      if (avail < GMIN + gridMin) editor = false;
      else graphH = graphShare(avail);
      o.mode = editor ? "tall" : "presets";
    }
    o.rows = !compact;
    o.strip = !compact;

    if (o.mode === "strip") {
      if (W < 150) {
        // A sliver: tiles over the button, or the button alone when there is no height either.
        var ah = H < 70 ? Math.max(1, H - 12) : 28;
        o.apply = { x: P, y: H - 6 - ah, w: W - 2 * P, h: ah };
        o.grid = { x: P, y: 6, w: W - 2 * P, h: Math.max(0, o.apply.y - 12) };
      } else {
        var bw = clamp(Math.round(W * 0.2), 58, 110);
        o.apply = { x: W - P - bw, y: 6, w: bw, h: H - 12 };
        o.grid = { x: P, y: 6, w: W - 3 * P - bw, h: H - 12 };
      }
      return o;
    }
    o.header = { x: 0, y: 0, w: W, h: HEADER };
    if (o.mode === "presets") {
      // No room for the graph: tabs, tiles and Apply, like a presets-only palette.
      o.tabs = { x: P, y: HEADER + 4, w: W - 2 * P, h: TABS };
      o.status = { x: P, y: H - 6 - STATUS, w: W - 2 * P, h: STATUS };
      o.apply = { x: P, y: o.status.y - 5 - APPLY, w: W - 2 * P, h: APPLY };
      o.grid = { x: P, y: o.tabs.y + TABS + 4, w: W - 2 * P, h: Math.max(0, o.apply.y - 8 - (o.tabs.y + TABS + 4)) };
      return o;
    }
    var y = HEADER + 4;
    o.graph = { x: P, y: y, w: colW, h: graphH };
    y += graphH;
    if (o.strip) {
      o.motion = { x: P, y: y + 6, w: colW, h: 24 };
      y += 30;
    }
    o.readout = { x: P, y: y + 6, w: colW - 28, h: 24 };
    o.star = { x: P + colW - 24, y: y + 6, w: 24, h: 24 };
    y += 30;
    o.ease = { x: P, y: y + 6, w: colW, h: 22 };
    y += 28;
    if (o.rows) {
      o.lock = { x: P, y: y + 4, w: colW, h: 22 };
      y += 26;
      o.auto = { x: P, y: y + 4, w: colW, h: 20 };
      y += 24;
    }
    o.status = { x: P, y: H - 6 - STATUS, w: colW, h: STATUS };
    o.apply = { x: P, y: o.status.y - 5 - APPLY, w: colW, h: APPLY };
    if (o.mode === "wide") {
      var gx = colW + 2 * P;
      o.tabs = { x: gx, y: HEADER + 4, w: gridW, h: TABS };
      var gy = o.tabs.y + TABS + 4;
      if (presetRow) {
        o.presetRow = { x: gx, y: gy, w: gridW, h: 24 };
        gy += presetRow;
      }
      o.grid = { x: gx, y: gy, w: gridW, h: Math.max(0, H - P - gy) };
    } else {
      o.tabs = { x: P, y: y + 8, w: colW, h: TABS };
      y = o.tabs.y + TABS + 4;
      if (presetRow) {
        o.presetRow = { x: P, y: y, w: colW, h: 24 };
        y += presetRow;
      }
      o.grid = { x: P, y: y, w: colW, h: Math.max(0, o.apply.y - 8 - y) };
    }
    return o;
  }

  function isDangerBar() {
    return state.bar !== null && (state.bar.kind === "deletePreset" || state.bar.kind === "deleteLibrary");
  }

  // The open menu's entries: the libraries to switch to, or what can be done with the active one.
  function menuItems() {
    var items = [], i;
    if (state.menu === "library") {
      for (i = 0; i < store.libraries.length; i++) {
        (function (name) {
          items.push({ label: name, mark: sameName(name, store.active), click: function () {
            var r = switchLibrary(store, name);
            if (r.ok) {
              saveLibraries();
              state.tab = "mine";
              state.selected = null;
              state.scroll = 0;
              state.search = "";
              searchField.text = "";
              matchSelection();
              setStatus("Showing " + r.name + " (" + plural(lib().presets.length, "curve", "curves") + ").", "info");
            }
          } });
        })(store.libraries[i].name);
      }
      return items;
    }
    items.push({ label: "New library\u2026", click: function () { state.tab = "mine"; openBar("newLibrary", ""); } });
    items.push({ label: "Rename " + lib().name + "\u2026", click: function () { state.tab = "mine"; openBar("renameLibrary", lib().name); } });
    items.push({ label: "Delete " + lib().name + "\u2026", click: function () { state.tab = "mine"; openBar("deleteLibrary", ""); } });
    items.push({ sep: true });
    items.push({ label: "Import a library\u2026", click: function () { openPage("import"); } });
    items.push({ label: "Export " + lib().name + "\u2026", click: function () { openPage("export"); } });
    return items;
  }

  function menuLayout(o) {
    var items = menuItems(), w = 120, h = 8;
    for (var i = 0; i < items.length; i++) {
      if (items[i].sep) h += 9;
      else {
        h += 24;
        w = Math.max(w, textWidth(items[i].label, 11.5) + 40);
      }
    }
    w = Math.round(Math.min(w, W - 2 * o.P));
    var right = state.menu === "library" ? Math.max(o.libraryBtn.x + o.libraryBtn.w, o.P + w) : W - o.P;
    return { items: items, x: Math.round(right - w), y: o.header.h - 2, w: w, h: h };
  }

  // The export and import pages: a field holding the library as text (which always works) and
  // an optional file path (which needs EffectCraft's permission to read or write files).
  function sheetLayout(o) {
    var P = o.P, w = W - 2 * P, exporting = state.page === "export", y = 62;
    var sh = { exporting: exporting, w: w, title: exporting ? "Export " + lib().name : "Import a library" };
    sh.intro = wrapText(exporting
      ? plural(lib().presets.length, "curve", "curves") + ". Click in the field, select all, copy, and paste it into a note or a message. On the other Mac, choose Import a library and paste it."
      : "Paste a library's text here (the text that Export shows), then press Import.", 11, w);
    sh.introY = y;
    y += sh.intro.length * 15 + 6;
    sh.textRect = { x: P, y: y, w: exporting ? w : w - 66, h: 22 };
    sh.importBtn = exporting ? null : { x: P + w - 60, y: y - 1, w: 60, h: 24 };
    y += 34;
    sh.fileIntro = wrapText(exporting ? "Or save it as a file. Type the full path:" : "Or read a " + LIBRARY_EXTENSION + " file. Type its full path:", 11, w);
    sh.fileIntroY = y;
    y += sh.fileIntro.length * 15 + 6;
    sh.pathRect = { x: P, y: y, w: w - 78, h: 22 };
    sh.fileBtn = { x: P + w - 72, y: y - 1, w: 72, h: 24 };
    y += 32;
    sh.note = state.sheetNote ? wrapText(state.sheetNote, 11, w).slice(0, 6) : [];
    sh.noteY = y;
    if (sh.note.length) y += sh.note.length * 15 + 8;
    sh.doneBtn = { x: P, y: Math.min(y + 2, H - 36), w: 64, h: 26 };
    return sh;
  }

  // Where everything goes for the current size and state. The edit fields are placed from this
  // before anything is painted, so a field never lags a step behind what is drawn.
  function computeLayout() {
    var o = baseLayout(), P = o.P, r;
    o.view = o.graph ? graphView(o.graph) : null;
    o.nameRect = null;
    o.searchRect = null;
    o.sheet = null;
    o.menu = null;
    if (o.mode === "sheet") {
      o.sheet = sheetLayout(o);
      return o;
    }
    if (o.header) {
      o.titleW = W >= 230 ? textWidth("SMOOTHCURVE", 10, 1.3) + 12 : 0;      // no room for the title in a narrow panel
      o.more = { x: W - P - 24, y: 4, w: 24, h: 22 };
      o.libraryName = fitText(lib().name, 11, Math.max(16, o.more.x - 4 - (P + o.titleW) - 22));
      var bw = Math.round(Math.min(textWidth(o.libraryName, 11) + 22, o.more.x - 4 - P));
      o.libraryBtn = { x: o.more.x - 4 - bw, y: 4, w: bw, h: 22 };
      if (state.menu) o.menu = menuLayout(o);
    }
    if (o.tabs) {
      r = o.tabs;
      if (state.bar) {
        o.barOk = { x: r.x + r.w - 110, y: r.y, w: 54, h: r.h };
        o.barCancel = { x: r.x + r.w - 52, y: r.y, w: 52, h: r.h };
        if (!isDangerBar()) o.nameRect = { x: r.x, y: r.y + 1, w: o.barOk.x - r.x - 6, h: 22 };
      } else {
        o.tabsEnd = r.x + textWidth(BUILT_IN_LIBRARY, 11.5) + 16 + textWidth("Mine", 11.5) + 16;
        if (searchWanted()) {
          var sw = Math.round(Math.min(120, r.x + r.w - o.tabsEnd - 34));
          if (sw >= 50) o.searchRect = { x: r.x + r.w - sw, y: r.y + 1, w: sw, h: 22 };
        }
        if (o.presetRow) o.nameRect = { x: o.presetRow.x, y: o.presetRow.y + 1, w: o.presetRow.w - 118, h: 22 };
      }
    }
    return o;
  }

  // Graph geometry. The 0..1 box is a square in the middle of the well: as wide as the well
  // lets it be with HEAD_MIN of headroom, times the zoom. The well's inner height shows the
  // values from view.lo to view.hi, with the same headroom above and below the box. It depends
  // on the graph's size and on the zoom the user chose, never on the curve.
  function graphView(g) {
    var iw = Math.max(1, g.w - 2 * GRAPH_PAD), ih = Math.max(1, g.h - 2 * GRAPH_PAD);
    var full = Math.min(iw, ih / (1 + 2 * HEAD_MIN)), side = full * ZOOMS[state.zoom];
    var head = (ih - side) / 2 / side, head0 = (ih - full) / 2 / full;
    // lo0 and hi0 are the values in sight without zoom: the motion strip keeps that scale.
    return { lo: -head, hi: 1 + head, lo0: -head0, hi0: 1 + head0, x: g.x + GRAPH_PAD + (iw - side) / 2, w: side };
  }
  // The rectangle that maps the graph's units: its width is x from 0 to 1 (the box), its
  // height is the values from view.hi down to view.lo (the well's inner height).
  function graphBox() {
    var g = L.graph;
    return { x: L.view.x, y: g.y + GRAPH_PAD, w: L.view.w, h: Math.max(1, g.h - 2 * GRAPH_PAD) };
  }
  // Graph units to pixels and back. Both are straight lines that carry on past the well, so a
  // handle far outside keeps its true place and a drag out there stays exact.
  function toPx(u, v) {
    var b = graphBox(), view = L.view;
    return [b.x + u * b.w, b.y + (view.hi - v) / (view.hi - view.lo) * b.h];
  }
  function toUnit(px, py) {
    var b = graphBox(), view = L.view;
    return [(px - b.x) / b.w, view.hi - (py - b.y) / b.h * (view.hi - view.lo)];
  }

  // The parts of a polyline between the heights `top` and `bot`: a list of polylines, cut
  // where the line crosses an edge. (Cut, not bent along the edge: a curve that leaves the
  // graph keeps its shape and simply goes out of sight.)
  function clipLines(pts, top, bot) {
    var out = [], cur = [];
    for (var i = 0; i + 3 < pts.length; i += 2) {
      var x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3], dy = y1 - y0, t0 = 0, t1 = 1;
      if (dy === 0) {
        if (y0 < top || y0 > bot) t1 = -1;
      } else {
        var a = (top - y0) / dy, b = (bot - y0) / dy;
        t0 = Math.max(0, Math.min(a, b));
        t1 = Math.min(1, Math.max(a, b));
      }
      if (t0 > t1) {
        if (cur.length >= 4) out.push(cur);
        cur = [];
        continue;
      }
      if (t0 > 0 || !cur.length) {
        if (cur.length >= 4) out.push(cur);
        cur = [x0 + t0 * (x1 - x0), y0 + t0 * dy];
      }
      cur.push(x0 + t1 * (x1 - x0), y0 + t1 * dy);
      if (t1 < 1) {
        out.push(cur);
        cur = [];
      }
    }
    if (cur.length >= 4) out.push(cur);
    return out;
  }

  // Several polylines as one stroke.
  function strokeLines(list, c, w) {
    if (!G || !list.length) return;
    G.newPath();
    for (var k = 0; k < list.length; k++) {
      var p = list[k];
      G.moveTo(q(p[0]), q(p[1]));
      for (var i = 2; i < p.length; i += 2) G.lineTo(q(p[i]), q(p[i + 1]));
    }
    G.strokePath(pen(c, w || 1));
  }

  // ------------------------------------------------------------------ painting

  function paintHeader() {
    var h = L.header, cy = h.y + h.h / 2, m = L.more, b = L.libraryBtn;
    if (L.titleW) drawTextMid("SMOOTHCURVE", L.P, cy, 10, COLORS.dim, "l", null, 1.3);
    // The three dots: what can be done with the library.
    var hovMore = state.hover === "more" || state.menu === "more";
    if (hovMore) fillRect(m.x, m.y, m.w, m.h, COLORS.surfaceHover);
    for (var d = -1; d <= 1; d++) fillRect(m.x + 10.5 + d * 5, cy - 1.5, 3, 3, hovMore ? COLORS.text : COLORS.dim);
    hit("more", m.x, m.y, m.w, m.h, { tip: "New, rename, delete, import or export a library", click: function () { state.menu = state.menu === "more" ? null : "more"; } });
    // The active library's name: click to switch.
    var hovLib = state.hover === "library" || state.menu === "library";
    fillRect(b.x, b.y, b.w, b.h, hovLib ? COLORS.surfaceHover : COLORS.surface);
    drawTextMid(L.libraryName, b.x + 7, cy, 11, hovLib ? COLORS.text : COLORS.dim, "l");
    polygon([b.x + b.w - 13, cy - 2, b.x + b.w - 6, cy - 2, b.x + b.w - 9.5, cy + 2.5], hovLib ? COLORS.text : COLORS.dim);
    hit("library", b.x, b.y, b.w, b.h, { tip: "Your library: " + lib().name + ". Click to switch.", click: function () { state.menu = state.menu === "library" ? null : "library"; } });
  }

  function curvePoints(b, steps, map) {
    var pts = [];
    for (var s = 0; s <= steps; s++) {
      var p = bezierPoint(b, s / steps), q = map(p[0], p[1]);
      pts.push(q[0], q[1]);
    }
    return pts;
  }

  function paintGraph() {
    var g = L.graph, box = graphBox(), b = state.bezier, i;
    rrect(g.x, g.y, g.w, g.h, 4, COLORS.well);
    // Curves are cut where they leave the well; a handle beyond it is marked on the edge.
    var top = g.y + 4, bot = g.y + g.h - 4, pinTop = g.y + 9, pinBot = g.y + g.h - 9;
    var c00 = toPx(0, 0), c11 = toPx(1, 1);
    var cut = function (curve, steps) {
      return clipLines(curvePoints(curve, steps, toPx), top, bot);
    };
    // The 0..1 box and its quarter lines.
    if (G) {
      G.newPath();
      for (i = 1; i < 4; i++) {
        var gx = Math.round(box.x + box.w * i / 4) + 0.5, gy = Math.round(c11[1] + (c00[1] - c11[1]) * i / 4) + 0.5;
        G.moveTo(gx, q(c11[1]));
        G.lineTo(gx, q(c00[1]));
        G.moveTo(q(c00[0]), gy);
        G.lineTo(q(c11[0]), gy);
      }
      G.strokePath(pen(COLORS.line, 1));
      // The box, and the straight line across it for comparison.
      G.newPath();
      G.rectPath(Math.round(c00[0]) + 0.5, Math.round(c11[1]) + 0.5, Math.round(c11[0] - c00[0]) - 1, Math.round(c00[1] - c11[1]) - 1);
      G.moveTo(q(c00[0]), q(c00[1]));
      G.lineTo(q(c11[0]), q(c11[1]));
      G.strokePath(pen(COLORS.lineStrong, 1));
    }
    if (state.ghost && !sameBezier(state.ghost, b)) strokeLines(cut(state.ghost, 24), withAlpha(COLORS.text, 0.2), 1.5);
    if (state.hoverBezier && !sameBezier(state.hoverBezier, b)) strokeLines(cut(state.hoverBezier, 24), withAlpha(COLORS.accent, 0.5), 1.5);
    // Handles. The side the Ease control leaves alone is drawn faint: In uses the second
    // handle (the incoming side of a keyframe), Out the first.
    var keys = [c00, c11], al = [state.mode === "In" ? 0.3 : 1, state.mode === "Out" ? 0.3 : 1];
    var hs = [], pins = [];
    for (i = 0; i < 2; i++) {
      var t = toPx(b[i * 2], b[i * 2 + 1]), k = keys[i], pin = t[1] < pinTop ? -1 : t[1] > pinBot ? 1 : 0;
      if (pin) {
        // Out of sight: the marker sits where the handle's line leaves the well.
        var edge = pin < 0 ? pinTop : pinBot, f = (edge - k[1]) / (t[1] - k[1]);
        t = [clamp(k[0] + f * (t[0] - k[0]), g.x + 8, g.x + g.w - 8), edge];
      }
      line(k[0], k[1], t[0], t[1], withAlpha(COLORS.handle, 0.85 * al[i]), 1);
      hs.push(t);
      pins.push(pin);
    }
    strokeLines(cut(b, 48), COLORS.accent, 2);
    if (G) {
      G.newPath();
      G.rectPath(q(c00[0] - 2.5), q(c00[1] - 2.5), 5, 5);
      G.rectPath(q(c11[0] - 2.5), q(c11[1] - 2.5), 5, 5);
      G.fillPath(brush(COLORS.text));
    }
    for (i = 0; i < 2; i++) {
      var x = hs[i][0], y = hs[i][1], s = pins[i];
      var active = (state.drag && state.drag.which === i) || (!state.drag && state.hover === "handle" + i);
      if (active) circle(x, y, 9, withAlpha(COLORS.handle, 0.28));
      // A round dot is the handle itself; an arrowhead on the edge says it is further out that way.
      if (s) polygon([x - 5.5, y - s * 4, x + 5.5, y - s * 4, x, y + s * 5], withAlpha(COLORS.handle, al[i]), COLORS.well, 1.5);
      else circle(x, y, 5, withAlpha(COLORS.handle, al[i]), COLORS.well, 1.5);
    }
    // The second handle is registered last so that it wins where the two overlap… unless the
    // first is nearer: mousedown measures the real distances.
    hit("graph", g.x, g.y, g.w, g.h, {});
    paintZoom();
    for (i = 0; i < 2; i++) {
      hit("handle" + i, hs[i][0] - 12, hs[i][1] - 12, 24, 24, { tip: pins[i] ? "This handle is beyond the graph (" + fixed2(b[i * 2 + 1]) + "). Drag it back, or further.\n" + HANDLE_TIP : HANDLE_TIP });
    }
    L.handles = hs;
    L.pinned = [pins[0] !== 0, pins[1] !== 0];
  }

  // Zoom, in the well's top right corner: out (always in the corner) and, once zoomed out, in.
  // A step that cannot be taken has no button. The handles are painted and hit after these,
  // so a handle that sits here can still be taken.
  function paintZoom() {
    var g = L.graph, S = 18, y = g.y + 5, x = g.x + g.w - 5 - S;
    var one = function (id, bx, plus, tip, step) {
      var hov = state.hover === id, cx = bx + S / 2, cy = y + S / 2, ink = hov ? COLORS.text : COLORS.dim;
      fillRect(bx, y, S, S, hov ? COLORS.surfaceHover : COLORS.surface);
      fillRect(cx - 4, cy - 0.75, 8, 1.5, ink);
      if (plus) fillRect(cx - 0.75, cy - 4, 1.5, 8, ink);
      hit(id, bx, y, S, S, { tip: tip, click: function () {
        state.zoom = clamp(state.zoom + step, 0, ZOOMS.length - 1);
        persist();
      } });
    };
    if (state.zoom < ZOOMS.length - 1) one("zoom:out", x, false, "Zoom out, to see a curve that goes beyond the graph", 1);
    if (state.zoom > 0) one("zoom:in", x - S - 2, true, "Zoom in", -1);
  }

  var dots = [], dotsKey = "";
  function paintMotion() {
    var m = L.motion, view = L.view, pad = 9;
    var x0 = m.x + pad, w = m.w - 2 * pad, yA = m.y + 7, yB = m.y + 18;
    var at = function (v) { return clamp(x0 + (v - view.lo0) / (view.hi0 - view.lo0) * w, m.x + 3, m.x + m.w - 3); };
    var key = state.bezier.join(","), i;
    if (dotsKey !== key) {
      dotsKey = key;
      dots = motionDots(state.bezier, 12);
    }
    if (G) {
      G.newPath();
      G.moveTo(q(at(0)), yA + 0.5);
      G.lineTo(q(at(1)), yA + 0.5);
      G.moveTo(q(at(0)), yB + 0.5);
      G.lineTo(q(at(1)), yB + 0.5);
      G.strokePath(pen(COLORS.line, 1));
      G.newPath();
      for (i = 0; i < 12; i++) G.ellipsePath(q(at(i / 11) - 2), yB - 1.5, 4, 4);
      G.fillPath(brush(COLORS.faint));
      G.newPath();
      for (i = 0; i < 12; i++) G.ellipsePath(q(at(dots[i]) - 2.5), yA - 2, 5, 5);
      G.fillPath(brush(COLORS.accentHover));
    }
    if (state.ball) {
      var t = clamp((new Date().getTime() - state.ball.start) / 900, 0, 1);
      circle(at(bezierY(state.bezier, t)), yA + 0.5, 4.5, COLORS.handle, COLORS.well, 1.5);
      circle(at(t), yB + 0.5, 3.5, COLORS.dim, COLORS.well, 1.5);
    }
    hit("motion", m.x, m.y, m.w, m.h, { tip: "Where the value is at 12 evenly spaced moments: close dots are slow, wide dots are fast.\nThe lower row is a straight line. Click to play.", click: playStrip });
  }

  function starPoints(cx, cy, R, r) {
    var pts = [];
    for (var a = 0; a < 10; a++) {
      var rad = a % 2 ? r : R, ang = -Math.PI / 2 + a * Math.PI / 5;
      pts.push(cx + rad * Math.cos(ang), cy + rad * Math.sin(ang));
    }
    return pts;
  }

  function paintReadoutRow() {
    var s = L.star, hov = state.hover === "star", kept = isSaved();
    if (hov) fillRect(s.x, s.y + 1, s.w, s.h - 2, COLORS.surfaceHover);
    var pts = starPoints(s.x + s.w / 2, s.y + s.h / 2 + 0.5, 7, 3.1);
    if (kept) polygon(pts, COLORS.handle);
    else polygon(pts, null, hov ? COLORS.text : COLORS.dim, 1.2);
    hit("star", s.x, s.y, s.w, s.h, {
      tip: kept ? "This curve is in " + lib().name + ". Click to keep it under another name." : "Keep this curve in " + lib().name,
      click: function () {
        var sel = selectedPreset();
        state.tab = "mine";
        openBar("save", sel && state.selected.lib === "mine" ? sel.name : "");
      }
    });
  }

  // A row of equal buttons with an optional word in front of it.
  function rowOfButtons(r, label, items) {
    var x = r.x, w = r.w;
    if (label && !L.narrow) {
      drawTextMid(label, r.x, r.y + r.h / 2, 11, COLORS.dim, "l");
      x += 36;
      w -= 36;
    }
    var gap = 3, bw = (w - gap * (items.length - 1)) / items.length;
    for (var i = 0; i < items.length; i++) button(items[i].id, Math.round(x + i * (bw + gap)), r.y, Math.round(bw), r.h, items[i].label, items[i]);
  }

  function paintControls() {
    var items = [], i;
    var tips = { "In": "Ease the incoming side of each selected keyframe (the curve's second handle)", "Out": "Ease the outgoing side of each selected keyframe (the curve's first handle)", "In-Out": "Ease both sides of each selected keyframe" };
    for (i = 0; i < MODES.length; i++) {
      (function (m) {
        items.push({ id: "mode:" + m, label: m, choice: state.mode === m, tip: tips[m], click: function () { state.mode = m; persist(); } });
      })(MODES[i]);
    }
    rowOfButtons(L.ease, "Ease", items);
    if (!L.rows) return;
    items = [];
    for (i = 0; i < LOCKS.length; i++) {
      (function (key, label, tip) {
        items.push({ id: "lock:" + key, label: label, on: state.locks[key], tip: tip, size: L.W < 280 ? 10 : 11, click: function () {
          state.locks[key] = !state.locks[key];
          if (state.locks[key] && key === "length") state.locks.angle = false;
          if (state.locks[key] && key === "angle") state.locks.length = false;
          persist();
        } });
      })(LOCKS[i][0], LOCKS[i][1], LOCKS[i][2]);
    }
    rowOfButtons(L.lock, "Lock", items);
    // Auto-apply: a check box and its label.
    var a = L.auto, cy = a.y + a.h / 2, hov = state.hover === "auto";
    var label = "Auto-apply", lw = textWidth(label, 11);
    rrect(a.x, cy - 6.5, 13, 13, 0, state.auto ? COLORS.accent : COLORS.surface, state.auto ? null : (hov ? COLORS.dim : COLORS.lineStrong));
    if (state.auto) polyline([a.x + 3, cy + 0.2, a.x + 5.6, cy + 2.8, a.x + 10, cy - 2.8], COLORS.white, 1.6);
    drawTextMid(label, a.x + 19, cy, 11, state.auto || hov ? COLORS.text : COLORS.dim, "l");
    hit("auto", a.x, a.y, 19 + lw + 6, a.h, { tip: "Apply as soon as you let go of a handle or click a curve.\nEach time is one undo step.", click: function () { state.auto = !state.auto; persist(); } });
    var fw = 68;
    button("fromKeys", a.x + a.w - fw, a.y, fw, a.h, "From keys", { tip: "Read the curve between the first two selected keyframes", click: fromKeys });
  }

  function paintTabsOrBar() {
    var r = L.tabs, cy = r.y + r.h / 2, bar = state.bar;
    if (bar) {
      var danger = isDangerBar();
      var okLabel = bar.kind === "save" ? "Save" : bar.kind === "newLibrary" ? "Create" : bar.kind === "renameLibrary" ? "Rename" : "Delete";
      if (danger) {
        var ask = bar.kind === "deletePreset" ? "Delete \u201C" + bar.name + "\u201D?" : "Delete " + lib().name + " and its " + plural(lib().presets.length, "curve", "curves") + "?";
        drawTextMid(ask, r.x, cy, 11, COLORS.text, "l", L.barOk.x - r.x - 8);
      }
      button("bar:ok", L.barOk.x, L.barOk.y, L.barOk.w, L.barOk.h, okLabel, { primary: !danger, danger: danger, click: confirmBar });
      button("bar:cancel", L.barCancel.x, L.barCancel.y, L.barCancel.w, L.barCancel.h, "Cancel", { click: closeBar });
      return;
    }
    var x = r.x, tabs = [["easings", BUILT_IN_LIBRARY, "The 25 built-in easings"], ["mine", "Mine", "Your own curves in " + lib().name]];
    for (var i = 0; i < tabs.length; i++) {
      var id = "tab:" + tabs[i][0], on = state.tab === tabs[i][0], hov = state.hover === id;
      var tw = textWidth(tabs[i][1], 11.5);
      drawTextMid(tabs[i][1], x, cy, 11.5, on || hov ? COLORS.text : COLORS.dim, "l");
      if (on) fillRect(x, r.y + r.h - 3, tw, 2, COLORS.accent);
      (function (key) {
        hit(id, x - 3, r.y, tw + 6, r.h, { tip: tabs[i][2], click: function () {
          if (state.tab !== key) {
            state.tab = key;
            state.scroll = 0;
            persist();
          }
        } });
      })(tabs[i][0]);
      x += tw + 16;
    }
    if (L.searchRect) drawTextMid("Find", L.searchRect.x - 6, cy, 11, COLORS.faint, "r");
    var p = L.presetRow;
    if (!p) return;
    button("preset:rename", p.x + p.w - 112, p.y, 56, p.h, "Rename", { tip: "Give the selected curve the name in the field", click: renameSelected });
    button("preset:delete", p.x + p.w - 52, p.y, 52, p.h, "Delete", { tip: "Remove the selected curve from " + lib().name, click: function () {
      var sel = selectedPreset();
      if (sel) openBar("deletePreset", "", { name: sel.name });
    } });
  }

  // A preset's thumbnail: ten points in a unit box, worked out once per curve.
  var thumbs = {}, thumbCount = 0;
  function thumbOf(b) {
    var key = b[0] + "," + b[1] + "," + b[2] + "," + b[3];
    if (thumbs[key]) return thumbs[key];
    var r = curveRange(b), pts = [];
    for (var i = 0; i <= 9; i++) {
      var p = bezierPoint(b, i / 9);
      pts.push(p[0], (r.max - p[1]) / (r.max - r.min));
    }
    if (thumbCount > 600) {
      thumbs = {};
      thumbCount = 0;
    }
    thumbCount++;
    thumbs[key] = pts;
    return pts;
  }

  function thumbPath(t) {
    var pts = thumbOf(t.preset.bezier), pad = Math.min(5, Math.max(3, Math.round(t.h * 0.16)));
    var ix = t.x + pad, iw = t.w - 2 * pad, iy = t.y + pad, ih = t.h - 2 * pad;
    G.moveTo(q(ix + pts[0] * iw), q(iy + pts[1] * ih));
    for (var i = 2; i < pts.length; i += 2) G.lineTo(q(ix + pts[i] * iw), q(iy + pts[i + 1] * ih));
  }

  // Register a tile; paintTiles draws them together.
  function addTile(list, x, y, w, h, libKey, preset) {
    var id = "tile:" + libKey + ":" + preset.name;
    list.push({ x: x, y: y, w: w, h: h, preset: preset, hov: state.hover === id,
      sel: state.selected !== null && state.selected.lib === libKey && sameName(state.selected.name, preset.name) });
    // The tooltip is only worked out for the tile under the pointer.
    hit(id, x, y, w, h, { tip: function () { return preset.name + "\n" + formatBezier(preset.bezier); }, hover: preset.bezier, click: function (e) { choosePreset(libKey, preset, e); } });
  }

  // Every paint operation costs more than its points, so the plain tiles share one fill and
  // one stroke; only the hovered and the selected tile are painted on their own.
  function paintTiles(list) {
    if (!G || !list.length) return;
    var i, t, plain = 0;
    G.newPath();
    for (i = 0; i < list.length; i++) {
      t = list[i];
      if (!t.sel && !t.hov) {
        G.rectPath(q(t.x), q(t.y), q(t.w), q(t.h));
        plain++;
      }
    }
    if (plain) G.fillPath(brush(COLORS.surface));
    for (i = 0; i < list.length; i++) {
      t = list[i];
      if (t.sel || t.hov) rrect(t.x, t.y, t.w, t.h, 0, t.sel ? COLORS.accentSoft : COLORS.surfaceHover, t.sel ? COLORS.accent : null, 1.5);
    }
    G.newPath();
    for (i = 0; i < list.length; i++) if (!list[i].sel && !list[i].hov) thumbPath(list[i]);
    if (plain) G.strokePath(pen(COLORS.dim, 1.5));
    for (i = 0; i < list.length; i++) {
      t = list[i];
      if (t.sel || t.hov) {
        G.newPath();
        thumbPath(t);
        G.strokePath(pen(t.sel ? COLORS.accentHover : COLORS.text, 1.5));
      }
    }
  }

  function paintGrid() {
    var g = L.grid, mode = L.mode, i, row, col, tiles = [];
    if (g.h < 14 || g.w < 30) return;
    var m = gridMeasure(g.w, mode, g.h);
    if (state.tab === "mine" && !lib().presets.length) {
      var lines = wrapText("No curves in " + lib().name + " yet. Shape one, then press the star to keep it.", 11, g.w - 8);
      for (i = 0; i < lines.length && (i + 1) * 15 <= g.h; i++) drawText(lines[i], g.x, g.y + 2 + i * 15, 11, COLORS.faint, "l");
      return;
    }
    if (state.tab === "mine" && !m.count) {
      drawText("No curve in " + lib().name + " is named like that.", g.x, g.y + 2, 11, COLORS.faint, "l", g.w);
      return;
    }
    var slack = m.labels ? 6 : 3;                // the space under the last row is not needed
    var visible = Math.max(1, Math.floor((g.h + slack) / m.rowH));
    if (m.rows > visible) {
      // A scroll bar is needed: it takes 9 px, so measure again in the narrower space.
      m = gridMeasure(g.w - 9, mode, g.h);
      visible = Math.max(1, Math.floor((g.h + slack) / m.rowH));
    }
    // A single row that is shorter than its space sits in the middle of it (the strip).
    var lift = !m.labels && visible === 1 ? Math.max(0, Math.round((g.h - m.th) / 2)) : 0;
    var maxScroll = Math.max(0, m.rows - visible);
    state.scroll = clamp(Math.round(state.scroll), 0, maxScroll);
    L.maxScroll = maxScroll;
    L.gridRowH = m.rowH;
    for (i = 0; i < m.count; i++) {
      row = Math.floor(i / m.perRow) - state.scroll;
      col = i % m.perRow;
      if (row < 0 || row >= visible) continue;
      var y = g.y + row * m.rowH;
      if (m.grouped) {
        var x = g.x + col * (m.gw + m.gap), blockW = 3 * m.tw + 2 * m.tgap;
        if (i < PRESET_FAMILIES.length) {
          for (var s = 0; s < 3; s++) addTile(tiles, x + s * (m.tw + m.tgap), y, m.tw, m.th, "easings", PRESETS[1 + i * 3 + s]);
          drawText(PRESET_FAMILIES[i][0], x + blockW / 2, y + m.th + 3, 10, COLORS.dim, "c", blockW);
        } else {
          addTile(tiles, x, y, m.tw, m.th, "easings", PRESETS[0]);
          drawText("Linear", x + m.tw / 2, y + m.th + 3, 10, COLORS.dim, "c");
        }
      } else {
        var e = m.list[i], tx = g.x + col * (m.tw + m.gap);
        addTile(tiles, tx, y + lift, m.tw, m.th, e.lib, e.preset);
        if (m.labels) drawText(e.preset.name, tx + m.tw / 2, y + m.th + 3, 10, COLORS.dim, "c", m.tw);
      }
    }
    paintTiles(tiles);
    if (maxScroll > 0) {
      var sx = g.x + g.w - 6, sh = visible === 1 ? g.h : visible * m.rowH - slack;
      var th2 = Math.max(14, sh * visible / m.rows), ty = g.y + (sh - th2) * state.scroll / maxScroll;
      fillRect(sx, g.y, 6, sh, COLORS.surface);
      fillRect(sx, ty, 6, th2, state.hover === "scroll" || state.scrolling ? COLORS.dim : COLORS.faint);
      hit("scroll", sx - 4, g.y, 14, sh, { tip: "Drag to see more curves (or drag the curves themselves up and down)", down: function (e2, px, py) {
        state.scrolling = { y: g.y, h: sh, thumb: th2, max: maxScroll };
        scrollTo(py);
      } });
    }
  }

  function scrollTo(py) {
    var s = state.scrolling;
    if (!s) return;
    var span = Math.max(1, s.h - s.thumb);
    state.scroll = clamp(Math.round((py - s.y - s.thumb / 2) / span * s.max), 0, s.max);
  }

  function paintApply() {
    var a = L.apply;
    button("apply", a.x, a.y, a.w, a.h, "APPLY", { primary: true, size: 11.5, tracking: 1.6, tip: "Ease the selected keyframes with this curve (" + state.mode + ")", click: doApply });
  }

  function paintStatus() {
    var s = L.status;
    if (!s) return;
    var c = state.statusKind === "warn" ? COLORS.handle : state.statusKind === "ok" ? COLORS.text : COLORS.dim;
    var lines = wrapText(state.status, 11, s.w);
    if (lines.length > 2) {
      // More than two lines: the second ends in an ellipsis and the whole text is the tooltip.
      lines = [lines[0], fitText(lines.slice(1).join(" "), 11, s.w)];
      hit("status", s.x, s.y, s.w, s.h, { tip: state.status });
    }
    for (var i = 0; i < lines.length; i++) drawText(lines[i], s.x, s.y + i * 14, 11, c, "l");
  }

  function paintMenu() {
    var m = L.menu;
    if (!m) return;
    // A click anywhere else closes the menu.
    hit("menu:away", 0, 0, L.W, L.H, { click: function () { state.menu = null; } });
    rrect(m.x, m.y, m.w, m.h, 4, COLORS.surface, COLORS.lineStrong);
    var iy = m.y + 4;
    for (var i = 0; i < m.items.length; i++) {
      var it = m.items[i];
      if (it.sep) {
        line(m.x + 8, iy + 4.5, m.x + m.w - 8, iy + 4.5, COLORS.lineStrong, 1);
        iy += 9;
        continue;
      }
      var id = "menu:" + i, hov = state.hover === id;
      if (hov) fillRect(m.x + 3, iy, m.w - 6, 24, COLORS.surfaceHover);
      if (it.mark) polyline([m.x + 9, iy + 12.2, m.x + 12, iy + 15.2, m.x + 17, iy + 8.8], COLORS.accentHover, 1.6);
      drawTextMid(it.label, m.x + 24, iy + 12, 11.5, hov || it.mark ? COLORS.text : COLORS.dim, "l", m.w - 32);
      (function (fn) {
        hit(id, m.x + 3, iy, m.w - 6, 24, { click: function () {
          state.menu = null;
          fn();
        } });
      })(it.click);
      iy += 24;
    }
  }

  function paintSheet() {
    var P = L.P, sh = L.sheet, i;
    drawTextMid("SMOOTHCURVE", P, 15, 10, COLORS.dim, "l", null, 1.3);
    drawText(sh.title, P, 38, 14, COLORS.text, "l", sh.w);
    for (i = 0; i < sh.intro.length; i++) drawText(sh.intro[i], P, sh.introY + i * 15, 11, COLORS.dim, "l");
    if (sh.importBtn) button("sheet:import", sh.importBtn.x, sh.importBtn.y, sh.importBtn.w, sh.importBtn.h, "Import", { primary: true, click: function () { importFrom(sheetText.text); } });
    for (i = 0; i < sh.fileIntro.length; i++) drawText(sh.fileIntro[i], P, sh.fileIntroY + i * 15, 11, COLORS.dim, "l");
    button("sheet:file", sh.fileBtn.x, sh.fileBtn.y, sh.fileBtn.w, sh.fileBtn.h, sh.exporting ? "Save file" : "Load file", { click: sh.exporting ? saveLibraryFile : loadLibraryFile });
    for (i = 0; i < sh.note.length; i++) drawText(sh.note[i], P, sh.noteY + i * 15, 11, /^Saved /.test(state.sheetNote) ? COLORS.text : COLORS.handle, "l");
    button("sheet:done", sh.doneBtn.x, sh.doneBtn.y, sh.doneBtn.w, sh.doneBtn.h, sh.exporting ? "Done" : "Cancel", { click: closePage });
  }

  function paintAll() {
    hits = [];
    fillRect(0, 0, W, H, COLORS.bg);
    L.handles = null;
    L.pinned = null;
    if (L.mode === "sheet") {
      paintSheet();
      return;
    }
    if (L.mode === "strip") {
      paintGrid();
      paintApply();
      return;
    }
    paintHeader();
    if (L.mode !== "presets") {
      paintGraph();
      if (L.strip) paintMotion();
      paintReadoutRow();
      paintControls();
    }
    paintTabsOrBar();
    paintGrid();
    paintApply();
    paintStatus();
    paintMenu();
  }

  // ------------------------------------------------------------------ fields

  function overlaps(a, b) {
    return a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function placeField(field, r) {
    var show = !!r && !overlaps(r, L.menu);
    if (field.visible !== show) field.visible = show;
    if (show) field.bounds = [r.x, r.y, r.x + r.w, r.y + r.h];
  }

  // After every event: lay out for the current size and state and place the edit fields. The
  // draw that follows paints it and collects the regions the mouse can hit.
  function refresh() {
    var size = ui.size;
    if (size && size.width >= 60 && size.height >= 30) {
      W = Math.round(size.width);
      H = Math.round(size.height);
    }
    canvas.bounds = [0, 0, W, H];
    L = computeLayout();
    placeField(readout, L.readout || null);
    placeField(searchField, L.searchRect);
    placeField(nameField, L.nameRect);
    placeField(sheetText, L.sheet ? L.sheet.textRect : null);
    placeField(sheetPath, L.sheet ? L.sheet.pathRect : null);
  }

  var pointer = null;
  function hitAtPointer() {
    return pointer ? hitAt(pointer[0], pointer[1]) : null;
  }

  // What automation reads (scriptui.get, control "automation"): the state, and every region the
  // mouse can hit as [id, x, y, width, height] in canvas pixels, the topmost last.
  function publish() {
    var list = [];
    for (var i = 0; i < hits.length; i++) list.push([hits[i].id, q(hits[i].x), q(hits[i].y), q(hits[i].w), q(hits[i].h)]);
    var libs = [];
    for (i = 0; i < store.libraries.length; i++) libs.push({ name: store.libraries[i].name, curves: store.libraries[i].presets.length });
    var text = JSON.stringify({
      version: SMOOTHCURVE_VERSION, size: [W, H], layout: L.mode, page: state.page,
      bezier: roundBezier(state.bezier), mode: state.mode, locks: state.locks, auto: state.auto,
      tab: state.tab, selected: state.selected, library: store.active, libraries: libs,
      bar: state.bar ? state.bar.kind : null, menu: state.menu, status: state.status, statusKind: state.statusKind,
      note: state.sheetNote, view: L.view ? [L.view.lo, L.view.hi] : null, handles: L.handles, pinned: L.pinned,
      graph: L.graph ? graphBox() : null, well: L.graph ? { x: L.graph.x, y: L.graph.y, w: L.graph.w, h: L.graph.h } : null,
      zoom: ZOOMS[state.zoom], scroll: state.scroll, playing: state.ball !== null,
      hover: state.hover, preview: state.hoverBezier ? roundBezier(state.hoverBezier) : null,
      ghost: state.ghost ? roundBezier(state.ghost) : null, hits: list
    });
    if (automation.text !== text) automation.text = text;
  }

  // ------------------------------------------------------------------ events

  function guarded(fn) {
    return function (e) {
      try {
        fn.call(this, e);
      } catch (err) {
        setStatus("SmoothCurve hit a problem: " + (err && err.message ? err.message : err), "warn");
      }
      try {
        refresh();
      } catch (err2) {
        state.status = "SmoothCurve could not lay itself out: " + (err2 && err2.message ? err2.message : err2);
      }
    };
  }

  function updateHover() {
    var h = hitAtPointer();
    state.hover = h ? h.id : null;
    state.hoverBezier = h && h.hover ? h.hover : null;
  }

  canvas.addEventListener("mousedown", guarded(function (e) {
    if (e.target !== canvas || e.button !== 0) return;
    pointer = [e.clientX, e.clientY];
    var h = hitAtPointer();
    state.pressed = h ? h.id : null;
    state.gridPress = null;
    state.hover = state.pressed;
    if (h && (h.id === "handle0" || h.id === "handle1" || h.id === "graph") && L.handles) {
      // The nearer handle within reach, so overlapping handles can both be picked up.
      var best = -1, bd = 14 * 14;
      for (var i = 0; i < 2; i++) {
        var dx = pointer[0] - L.handles[i][0], dy = pointer[1] - L.handles[i][1], d = dx * dx + dy * dy;
        if (d <= bd) {
          bd = d;
          best = i;
        }
      }
      if (best >= 0) {
        // The grab keeps its offset, so nothing jumps: not a handle taken off-centre, and not
        // one taken by its marker on the edge while it really sits further out.
        var at = toPx(state.bezier[best * 2], state.bezier[best * 2 + 1]);
        state.drag = { which: best, start: state.bezier.slice(0), dx: at[0] - pointer[0], dy: at[1] - pointer[1] };
        state.ghost = state.bezier.slice(0);
        state.hoverBezier = null;
      }
    } else if (h && h.down) {
      h.down(e, pointer[0], pointer[1]);
    } else if (h && h.id.indexOf("tile:") === 0 && L.maxScroll > 0) {
      // No mouse wheel reaches a panel, so the tiles drag their list: a press that moves up or
      // down scrolls by whole rows and is no longer a click.
      state.gridPress = { y: pointer[1], scroll: state.scroll, rowH: L.gridRowH, max: L.maxScroll, moved: false };
    }
  }));

  canvas.addEventListener("mousemove", guarded(function (e) {
    if (e.target !== canvas) return;
    pointer = [e.clientX, e.clientY];
    if (state.drag) {
      var b = dragHandle(state.bezier, state.drag.which, toUnit(pointer[0] + state.drag.dx, pointer[1] + state.drag.dy), modifierFlags(e, state.locks), state.drag.start);
      state.bezier = b;
      readout.text = formatBezier(b);
      state.selected = null;
      return;
    }
    if (state.scrolling) {
      scrollTo(pointer[1]);
      return;
    }
    var gp = state.gridPress;
    if (gp) {
      var dy = pointer[1] - gp.y;
      if (Math.abs(dy) > 8) gp.moved = true;
      if (gp.moved) {
        state.scroll = clamp(gp.scroll - Math.round(dy / gp.rowH), 0, gp.max);
        state.hover = null;
        state.hoverBezier = null;
        return;
      }
    }
    updateHover();
  }));

  canvas.addEventListener("mouseup", guarded(function (e) {
    if (e.target !== canvas || e.button !== 0) return;
    pointer = [e.clientX, e.clientY];
    var pressed = state.pressed;
    state.pressed = null;
    if (state.drag) {
      var moved = !sameBezier(state.drag.start, state.bezier);
      state.drag = null;
      matchSelection();
      if (moved) {
        if (state.auto) doApply();
        persist();
      }
      return;
    }
    if (state.scrolling) {
      state.scrolling = null;
      return;
    }
    if (state.gridPress) {
      var scrolled = state.gridPress.moved;
      state.gridPress = null;
      if (scrolled) {
        updateHover();
        return;
      }
    }
    var h = hitAtPointer();
    if (h && h.id === pressed && h.click) h.click(e);
  }));

  canvas.addEventListener("mouseover", guarded(function (e) {
    if (e.target !== canvas) return;
    pointer = [e.clientX, e.clientY];
    if (!state.drag && !state.scrolling && !(state.gridPress && state.gridPress.moved)) updateHover();
  }));

  canvas.addEventListener("mouseout", guarded(function (e) {
    if (e.target !== canvas || state.drag || state.scrolling || state.gridPress) return;
    pointer = null;
    state.hover = null;
    state.hoverBezier = null;
  }));

  canvas.onDraw = function () {
    if (!L) return;
    G = this.graphics;
    try {
      paintAll();
      // The regions are fresh now: the tooltip and the published state follow them.
      var h = hitAtPointer(), tip = h && h.tip ? (typeof h.tip === "function" ? h.tip() : h.tip) : "";
      if (canvas.helpTip !== tip) canvas.helpTip = tip;
      publish();
    } catch (e) {
      // A drawing problem must never take the panel down: show what happened instead.
      try {
        G.newPath();
        G.rectPath(0, 0, W, H);
        G.fillPath(G.newBrush(G.BrushType.SOLID_COLOR, COLORS.bg));
        G.drawString("SmoothCurve could not draw: " + (e && e.message ? e.message : e), G.newPen(G.PenType.SOLID_COLOR, COLORS.handle, 1), 8, 8);
      } catch (e2) {}
    }
    G = null;
  };

  // Typing in the readout moves the handles as soon as the text is a curve; leaving the field
  // tidies the text, or puts the old numbers back when it was not a curve.
  readout.onChanging = guarded(function () {
    var b = parseBezier(readout.text);
    if (!b) return;
    if (!sameBezier(b, state.bezier)) state.ghost = state.ghost || state.bezier.slice(0);
    state.bezier = b;
    matchSelection();
  });
  readout.onChange = guarded(function () {
    var b = parseBezier(readout.text);
    if (b) {
      setCurve(b, true);
      readout.text = formatBezier(b);
      if (state.auto) doApply();
      persist();
    } else {
      readout.text = formatBezier(state.bezier);
      setStatus("That is not a curve. Type four numbers like 0.42, 0, 0.58, 1 or paste a cubic-bezier(…).", "warn");
    }
  });
  searchField.onChanging = searchField.onChange = guarded(function () {
    state.search = String(searchField.text).replace(/^\s+|\s+$/g, "");
    state.scroll = 0;
  });
  nameField.onChanging = nameField.onChange = guarded(function () {});
  sheetText.onChange = guarded(function () {});
  sheetPath.onChange = guarded(function () {});

  ui.onResizing = ui.onResize = guarded(function () {});

  readout.text = formatBezier(state.bezier);
  matchSelection();
  if (ui instanceof Window) {
    ui.size = [W, H];
    refresh();
    ui.show();
  } else {
    ui.layout.layout(true);
    refresh();
  }
  return ui;
}
