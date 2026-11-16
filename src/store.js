// SmoothCurve store: the user's own curves, kept in libraries with app.settings.
//
// Section "SmoothCurve" (our own: the built-in Ease Presets panel's section is never read or
// written), key "libraries":
//   {"version": 1, "active": "My curves",
//    "libraries": [{"name": "My curves", "presets": [{"name": "Snappy", "bezier": [0.2, 0, 0, 1]}]}]}
// The 25 built-in presets are code (PRESETS in core.js), shown as the read-only library "Easings".
//
// A library travels as text: {"format": "curve-library", "version": 1, "name": …, "presets": […]}.
// Everything that reads text or settings validates each entry and skips bad ones with a message;
// nothing here throws.

var SETTINGS_SECTION = "SmoothCurve";
var OLD_SETTINGS_SECTION = "CurveCraft";   // the panel's name before its first public release
var LIBRARIES_KEY = "libraries";
var UI_KEY = "ui";
var BUILT_IN_LIBRARY = "Easings";
var DEFAULT_LIBRARY = "My curves";
var LIBRARY_FORMAT = "curve-library";
var LIBRARY_EXTENSION = ".curves.json";
var MAX_PRESETS = 500;           // per library
var MAX_LIBRARIES = 50;
var MAX_LIBRARY_TEXT = 1048576;  // 1 MiB of text is far more than 500 curves

function emptyStore() {
  return { version: 1, active: DEFAULT_LIBRARY, libraries: [{ name: DEFAULT_LIBRARY, presets: [] }] };
}

function findLibrary(store, name) {
  for (var i = 0; i < store.libraries.length; i++) if (sameName(store.libraries[i].name, name)) return i;
  return -1;
}

function activeLibrary(store) {
  var i = findLibrary(store, store.active);
  return store.libraries[i < 0 ? 0 : i];
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

// "Name", or "Name 2", "Name 3"… when taken (names are at most 64 characters).
function uniqueName(taken, base) {
  var name = base, n = 1;
  while (taken(name)) {
    n++;
    var suffix = " " + n;
    name = base.substring(0, MAX_NAME - suffix.length) + suffix;
  }
  return name;
}

// The usable presets of a list of anything: {presets, skipped: [reasons]}. A preset needs a name
// of 1 to 64 characters that isn't a built-in's or a repeat, and four finite numbers with x in 0..1.
function cleanPresets(list) {
  var out = [], skipped = [];
  if (!(list instanceof Array)) return { presets: out, skipped: skipped };
  for (var i = 0; i < list.length; i++) {
    var e = list[i], label = "entry " + (i + 1);
    if (out.length >= MAX_PRESETS) {
      skipped.push("everything after the first " + MAX_PRESETS + " curves");
      break;
    }
    if (!e || typeof e !== "object") { skipped.push(label + " (not a curve)"); continue; }
    var name = typeof e.name === "string" ? cleanName(e.name) : null;
    if (!name) { skipped.push(label + " (no usable name)"); continue; }
    label = "“" + name + "”";
    var b = e.bezier;
    if (!(b instanceof Array) || b.length !== 4 || !isNumber(b[0]) || !isNumber(b[1]) || !isNumber(b[2]) || !isNumber(b[3])) { skipped.push(label + " (needs four numbers)"); continue; }
    if (b[0] < 0 || b[0] > 1 || b[2] < 0 || b[2] > 1) { skipped.push(label + " (x outside 0 to 1)"); continue; }
    if (findPreset(PRESETS, name) >= 0) { skipped.push(label + " (a built-in name)"); continue; }
    if (findPreset(out, name) >= 0) { skipped.push(label + " (name used twice)"); continue; }
    out.push({ name: name, bezier: roundBezier(sanitizeBezier(b)) });
  }
  return { presets: out, skipped: skipped };
}

// A store from whatever the settings held: always at least one library and a valid active name.
function normalizeStore(doc) {
  var store = { version: 1, active: DEFAULT_LIBRARY, libraries: [] };
  var libs = doc && doc.libraries instanceof Array ? doc.libraries : [];
  for (var i = 0; i < libs.length && store.libraries.length < MAX_LIBRARIES; i++) {
    var name = libs[i] && typeof libs[i].name === "string" ? cleanName(libs[i].name) : null;
    if (!name || sameName(name, BUILT_IN_LIBRARY) || findLibrary(store, name) >= 0) continue;
    store.libraries.push({ name: name, presets: cleanPresets(libs[i].presets).presets });
  }
  if (!store.libraries.length) store.libraries.push({ name: DEFAULT_LIBRARY, presets: [] });
  var a = doc && typeof doc.active === "string" ? findLibrary(store, doc.active) : -1;
  store.active = store.libraries[a < 0 ? 0 : a].name;
  return store;
}

// A setting of this panel as text, or null. Settings saved under the panel's earlier name are
// read until something is saved under the new one; the old section is never changed.
function readSetting(key) {
  if (app.settings.haveSetting(SETTINGS_SECTION, key)) return app.settings.getSetting(SETTINGS_SECTION, key);
  if (app.settings.haveSetting(OLD_SETTINGS_SECTION, key)) return app.settings.getSetting(OLD_SETTINGS_SECTION, key);
  return null;
}

function loadStore() {
  try {
    var text = readSetting(LIBRARIES_KEY);
    return text === null ? emptyStore() : normalizeStore(JSON.parse(text));
  } catch (e) {
    return emptyStore();
  }
}

// True when the settings took it.
function saveStore(store) {
  try {
    app.settings.saveSetting(SETTINGS_SECTION, LIBRARIES_KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    return false;
  }
}

// The panel's own state (last curve, mode, toggles, tab): a plain object, {} when missing.
function loadUiState() {
  try {
    var text = readSetting(UI_KEY);
    if (text === null) return {};
    var v = JSON.parse(text);
    return v && typeof v === "object" && !(v instanceof Array) ? v : {};
  } catch (e) {
    return {};
  }
}

function saveUiState(state) {
  try {
    app.settings.saveSetting(SETTINGS_SECTION, UI_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------------------ presets
// Each returns {ok, message}; `store` is changed only when ok.

// Keep `bezier` as `name` in the active library; an existing preset of that name is replaced.
function savePreset(store, name, bezier) {
  var n = cleanName(name), b = sanitizeBezier(bezier);
  if (!n) return { ok: false, message: "Type a name of 1 to " + MAX_NAME + " characters." };
  if (!b) return { ok: false, message: "This curve has no usable numbers." };
  if (findPreset(PRESETS, n) >= 0) return { ok: false, message: "“" + n + "” is a built-in easing. Choose another name." };
  var lib = activeLibrary(store), i = findPreset(lib.presets, n);
  if (i >= 0) {
    lib.presets[i] = { name: lib.presets[i].name, bezier: roundBezier(b) };
    return { ok: true, message: "Updated “" + lib.presets[i].name + "” in " + lib.name + ".", name: lib.presets[i].name, replaced: true };
  }
  if (lib.presets.length >= MAX_PRESETS) return { ok: false, message: lib.name + " is full (" + MAX_PRESETS + " curves). Start a new library." };
  lib.presets.push({ name: n, bezier: roundBezier(b) });
  return { ok: true, message: "Saved “" + n + "” to " + lib.name + ".", name: n, replaced: false };
}

function renamePreset(store, oldName, newName) {
  var lib = activeLibrary(store), i = findPreset(lib.presets, oldName), n = cleanName(newName);
  if (i < 0) return { ok: false, message: "Select one of your own curves first." };
  if (!n) return { ok: false, message: "Type a name of 1 to " + MAX_NAME + " characters." };
  if (findPreset(PRESETS, n) >= 0) return { ok: false, message: "“" + n + "” is a built-in easing. Choose another name." };
  var other = findPreset(lib.presets, n);
  if (other >= 0 && other !== i) return { ok: false, message: "A curve named “" + lib.presets[other].name + "” is already in " + lib.name + "." };
  lib.presets[i].name = n;
  return { ok: true, message: "Renamed to “" + n + "”.", name: n };
}

function deletePreset(store, name) {
  var lib = activeLibrary(store), i = findPreset(lib.presets, name);
  if (i < 0) return { ok: false, message: "Select one of your own curves first." };
  var gone = lib.presets.splice(i, 1)[0];
  return { ok: true, message: "Deleted “" + gone.name + "”.", name: gone.name };
}

// ------------------------------------------------------------------ libraries

function checkLibraryName(store, name, except) {
  var n = cleanName(name);
  if (!n) return { ok: false, message: "Type a name of 1 to " + MAX_NAME + " characters." };
  if (sameName(n, BUILT_IN_LIBRARY)) return { ok: false, message: "“" + BUILT_IN_LIBRARY + "” is the built-in library. Choose another name." };
  var i = findLibrary(store, n);
  if (i >= 0 && i !== except) return { ok: false, message: "A library named “" + store.libraries[i].name + "” exists." };
  return { ok: true, name: n };
}

function newLibrary(store, name) {
  var c = checkLibraryName(store, name, -1);
  if (!c.ok) return c;
  if (store.libraries.length >= MAX_LIBRARIES) return { ok: false, message: "That is the limit of " + MAX_LIBRARIES + " libraries." };
  store.libraries.push({ name: c.name, presets: [] });
  store.active = c.name;
  return { ok: true, message: "Made the library “" + c.name + "”.", name: c.name };
}

function renameLibrary(store, name) {
  var i = findLibrary(store, store.active);
  var c = checkLibraryName(store, name, i);
  if (!c.ok) return c;
  store.libraries[i].name = c.name;
  store.active = c.name;
  return { ok: true, message: "Renamed the library to “" + c.name + "”.", name: c.name };
}

// Remove the active library; there is always one left (an empty "My curves" if it was the last).
function deleteLibrary(store) {
  var i = findLibrary(store, store.active);
  if (i < 0) return { ok: false, message: "No library to delete." };
  var gone = store.libraries.splice(i, 1)[0];
  if (!store.libraries.length) store.libraries.push({ name: DEFAULT_LIBRARY, presets: [] });
  store.active = store.libraries[Math.min(i, store.libraries.length - 1)].name;
  return { ok: true, message: "Deleted the library “" + gone.name + "” (" + plural(gone.presets.length, "curve", "curves") + ").", name: gone.name };
}

function switchLibrary(store, name) {
  var i = findLibrary(store, name);
  if (i < 0) return { ok: false, message: "No library named “" + name + "”." };
  store.active = store.libraries[i].name;
  return { ok: true, message: "", name: store.active };
}

// ------------------------------------------------------------------ export / import

// One library as text (compact JSON on one line, so it survives a single-line text field).
function libraryToText(lib) {
  var presets = [];
  for (var i = 0; i < lib.presets.length; i++) presets.push({ name: lib.presets[i].name, bezier: lib.presets[i].bezier.slice(0) });
  return JSON.stringify({ format: LIBRARY_FORMAT, version: 1, name: lib.name, presets: presets });
}

// {ok, message, name, presets, skipped} from a library's text. Never throws.
function parseLibraryText(text) {
  var s = String(text === undefined || text === null ? "" : text).replace(/^\s+|\s+$/g, "");
  if (!s.length) return { ok: false, message: "Nothing to import: paste a library's text first." };
  if (s.length > MAX_LIBRARY_TEXT) return { ok: false, message: "That text is too long to be a curve library." };
  var doc;
  try {
    doc = JSON.parse(s);
  } catch (e) {
    return { ok: false, message: "That text is not a curve library (it is damaged or cut off)." };
  }
  if (!doc || typeof doc !== "object" || doc instanceof Array || doc.format !== LIBRARY_FORMAT) return { ok: false, message: "That text is not a SmoothCurve library." };
  if (!isNumber(doc.version) || doc.version < 1) return { ok: false, message: "That library has no version number." };
  if (doc.version > 1) return { ok: false, message: "That library was made by a newer SmoothCurve (format " + doc.version + ")." };
  if (!(doc.presets instanceof Array)) return { ok: false, message: "That library holds no list of curves." };
  var c = cleanPresets(doc.presets);
  var name = typeof doc.name === "string" ? cleanName(doc.name) : null;
  if (!name || sameName(name, BUILT_IN_LIBRARY)) name = "Imported";
  return { ok: true, message: "", name: name, presets: c.presets, skipped: c.skipped };
}

// Add the library in `text` as a new library and make it active. A library of the same name is
// never replaced: the new one gets a number after its name, and the message says so.
function importLibrary(store, text) {
  var p = parseLibraryText(text);
  if (!p.ok) return p;
  if (store.libraries.length >= MAX_LIBRARIES) return { ok: false, message: "That is the limit of " + MAX_LIBRARIES + " libraries. Delete one first." };
  var name = uniqueName(function (n) { return findLibrary(store, n) >= 0; }, p.name);
  store.libraries.push({ name: name, presets: p.presets });
  store.active = name;
  var msg = "Imported " + plural(p.presets.length, "curve", "curves") + " as “" + name + "”";
  if (name !== p.name) msg += " (“" + p.name + "” exists)";
  msg += ".";
  if (p.skipped.length) msg += " Skipped " + p.skipped.length + ": " + p.skipped.slice(0, 3).join(", ") + (p.skipped.length > 3 ? "…" : "") + ".";
  return { ok: true, message: msg, name: name, count: p.presets.length, skipped: p.skipped };
}

// ------------------------------------------------------------------ files
// EffectCraft 0.24.1 has no file dialogs for scripts, and scripts may only write files when
// Settings > Scripting & Expressions > Allow Scripts to Write Files and Access Network is on
// (reading works inside the project's folder without it). So files are optional: the text itself
// can always be copied and pasted.

function fileGateMessage(e, doing) {
  var m = String(e && e.message ? e.message : e);
  if (/Allow Scripts to Write Files/i.test(m)) return "EffectCraft blocked " + doing + ". Turn on Settings ▸ Scripting & Expressions ▸ Allow Scripts to Write Files, or copy the text instead.";
  return "Could not finish " + doing + ": " + m;
}

function writeTextFile(path, text) {
  var p = String(path === undefined || path === null ? "" : path).replace(/^\s+|\s+$/g, "");
  if (!p.length) return { ok: false, message: "Type where to save the file, for example /Users/you/Desktop/My curves" + LIBRARY_EXTENSION };
  try {
    var f = new File(p);
    f.encoding = "UTF-8";
    if (!f.open("w")) return { ok: false, message: "Could not open " + p + " for writing." };
    f.write(text);
    f.close();
    return { ok: true, message: "Saved " + p, path: p };
  } catch (e) {
    return { ok: false, message: fileGateMessage(e, "writing the file") };
  }
}

function readTextFile(path) {
  var p = String(path === undefined || path === null ? "" : path).replace(/^\s+|\s+$/g, "");
  if (!p.length) return { ok: false, message: "Type the path of a " + LIBRARY_EXTENSION + " file first." };
  try {
    var f = new File(p);
    f.encoding = "UTF-8";
    if (!f.open("r")) return { ok: false, message: "No file at " + p };
    var text = f.read();
    f.close();
    return { ok: true, message: "", text: text, path: p };
  } catch (e) {
    return { ok: false, message: fileGateMessage(e, "reading the file") };
  }
}
