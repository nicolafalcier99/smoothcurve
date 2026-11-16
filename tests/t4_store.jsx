// T4 (the parts that need no window): libraries, saving, export and import, bad input.
#include "lib/assert.js"
#include "../src/core.js"
#include "../src/store.js"

(function () {
  var r, s = loadStore();
  checkEq("a fresh store has one empty library", s.libraries.length + ":" + s.libraries[0].name + ":" + s.libraries[0].presets.length, "1:My curves:0");
  checkEq("the active library is My curves", s.active, "My curves");

  // ---- saving
  r = savePreset(s, "  Snappy ", [0.2, 0, 0, 1]);
  check("save a curve", r.ok && r.name === "Snappy" && !r.replaced, r.message);
  checkEq("the curve is in the library", JSON.stringify(activeLibrary(s).presets), '[{"name":"Snappy","bezier":[0.2,0,0,1]}]');
  r = savePreset(s, "snappy", [0.3, 0.1, 0.2, 1]);
  check("saving under the same name updates that curve", r.ok && r.replaced && activeLibrary(s).presets.length === 1, r.message);
  checkEq("the update keeps the first spelling", activeLibrary(s).presets[0].name + ":" + activeLibrary(s).presets[0].bezier.join(","), "Snappy:0.3,0.1,0.2,1");
  r = savePreset(s, "Quad Out", [0.2, 0, 0, 1]);
  check("a built-in name cannot be taken", !r.ok && /built-in/.test(r.message), r.message);
  r = savePreset(s, "LINEAR", [0.2, 0, 0, 1]);
  check("a built-in name cannot be taken in another case", !r.ok, r.message);
  r = savePreset(s, "   ", [0.2, 0, 0, 1]);
  check("an empty name is refused", !r.ok, r.message);
  r = savePreset(s, new Array(70).join("x"), [0.2, 0, 0, 1]);
  check("a 69-character name is refused", !r.ok, r.message);
  r = savePreset(s, "Broken", [0.2, NaN, 0, 1]);
  check("a curve with NaN is refused", !r.ok, r.message);
  checkEq("refused saves changed nothing", activeLibrary(s).presets.length, 1);
  savePreset(s, "Overshoot", [0.34, 1.56, 0.64, 1]);
  savePreset(s, "Soft", [0.123456, 0, 0.654321, 1]);
  checkEq("curves are kept to three decimals", activeLibrary(s).presets[2].bezier.join(","), "0.123,0,0.654,1");

  // ---- rename, delete
  r = renamePreset(s, "Soft", "Softer");
  check("rename", r.ok && findPreset(activeLibrary(s).presets, "Softer") === 2, r.message);
  r = renamePreset(s, "Softer", "SNAPPY");
  check("rename onto another curve's name is refused", !r.ok && /already/.test(r.message), r.message);
  r = renamePreset(s, "Softer", "softer");
  check("rename may change only the case", r.ok && activeLibrary(s).presets[2].name === "softer", r.message);
  r = renamePreset(s, "softer", "Sine In");
  check("rename to a built-in name is refused", !r.ok, r.message);
  r = renamePreset(s, "Nope", "X");
  check("rename of a missing curve is refused", !r.ok, r.message);
  r = deletePreset(s, "softer");
  check("delete", r.ok && activeLibrary(s).presets.length === 2, r.message);
  r = deletePreset(s, "softer");
  check("delete of a missing curve is refused", !r.ok, r.message);

  // ---- settings round trip (what a restart reads back)
  check("the store saves", saveStore(s));
  var again = loadStore();
  checkEq("the store reads back the same", JSON.stringify(again), JSON.stringify(s));
  checkEq("the built-in panel's settings section is untouched", app.settings.haveSetting("Ease Presets", "userPresets"), false);

  // ---- libraries
  r = newLibrary(s, "Client A");
  check("new library becomes active", r.ok && s.active === "Client A" && s.libraries.length === 2, r.message);
  r = newLibrary(s, "client a");
  check("a second library of the same name is refused", !r.ok && /exists/.test(r.message), r.message);
  r = newLibrary(s, "Easings");
  check("the built-in library's name is refused", !r.ok && /built-in/.test(r.message), r.message);
  r = newLibrary(s, "");
  check("an empty library name is refused", !r.ok, r.message);
  savePreset(s, "Bouncy", [0.68, -0.6, 0.32, 1.6]);
  checkEq("curves go to the active library", s.libraries[1].presets.length + "/" + s.libraries[0].presets.length, "1/2");
  r = savePreset(s, "Snappy", [0.5, 0, 0.5, 1]);
  check("the same curve name may exist in two libraries", r.ok && !r.replaced, r.message);
  r = renameLibrary(s, "Client B");
  check("rename library", r.ok && s.active === "Client B" && findLibrary(s, "Client A") < 0, r.message);
  r = renameLibrary(s, "My curves");
  check("rename onto another library is refused", !r.ok, r.message);
  r = switchLibrary(s, "my curves");
  check("switch library", r.ok && s.active === "My curves", r.message);
  r = switchLibrary(s, "Nope");
  check("switch to a missing library is refused", !r.ok && s.active === "My curves", r.message);

  // ---- export then import gives identical curves
  var text = libraryToText(s.libraries[0]);
  check("export is one line of text", text.indexOf("\n") < 0 && text.charAt(0) === "{", text);
  var p = parseLibraryText(text);
  check("the export parses", p.ok && p.name === "My curves" && p.skipped.length === 0, p.message);
  checkEq("export then import: identical curves", JSON.stringify(p.presets), JSON.stringify(s.libraries[0].presets));
  r = importLibrary(s, text);
  check("importing a library whose name exists adds a numbered copy", r.ok && r.name === "My curves 2" && /exists/.test(r.message), r.message);
  checkEq("the original library is untouched", JSON.stringify(s.libraries[0].presets), JSON.stringify(p.presets));
  checkEq("the copy has identical curves", JSON.stringify(activeLibrary(s).presets), JSON.stringify(s.libraries[0].presets));
  r = importLibrary(s, "  \n" + text + "\n  ");
  check("surrounding blank space is fine", r.ok && r.name === "My curves 3", r.message);

  // ---- bad text: a message, never an error
  var bad = [
    ["empty text", ""],
    ["plain words", "hello there"],
    ["cut-off text", text.substring(0, text.length - 9)],
    ["a number", "42"],
    ["a list", "[1,2,3]"],
    ["null", "null"],
    ["another format", '{"format":"something-else","version":1,"presets":[]}'],
    ["no format", '{"version":1,"name":"x","presets":[]}'],
    ["a newer version", '{"format":"curve-library","version":2,"name":"x","presets":[]}'],
    ["no version", '{"format":"curve-library","name":"x","presets":[]}'],
    ["presets not a list", '{"format":"curve-library","version":1,"name":"x","presets":{"a":1}}']
  ];
  var before = JSON.stringify(s);
  for (var i = 0; i < bad.length; i++) {
    (function (label, t) {
      checkThrowsNothing("import of " + label + " does not throw", function () { r = importLibrary(s, t); });
      check("import of " + label + " gives a message", r && r.ok === false && typeof r.message === "string" && r.message.length > 10, r && r.message);
    })(bad[i][0], bad[i][1]);
  }
  checkThrowsNothing("import of undefined does not throw", function () { r = importLibrary(s, undefined); });
  check("import of undefined gives a message", r.ok === false, r.message);
  checkEq("failed imports changed nothing", JSON.stringify(s), before);

  // ---- bad entries inside a good library are skipped one by one
  var mixed = JSON.stringify({ format: "curve-library", version: 1, name: "Mixed", presets: [
    { name: "Good", bezier: [0.1, 0.2, 0.3, 0.4] },
    { name: "Good", bezier: [0.5, 0.5, 0.5, 0.5] },
    { name: "X out of range", bezier: [1.5, 0, 0.5, 1] },
    { name: "Negative x", bezier: [0.5, 0, -0.1, 1] },
    { name: "Three numbers", bezier: [0.1, 0.2, 0.3] },
    { name: "Text numbers", bezier: ["0.1", 0.2, 0.3, 0.4] },
    { name: "", bezier: [0.1, 0.2, 0.3, 0.4] },
    { name: 12, bezier: [0.1, 0.2, 0.3, 0.4] },
    { name: "Cubic In", bezier: [0.1, 0.2, 0.3, 0.4] },
    { name: "Null numbers", bezier: [null, 0, 0, 1] },
    null,
    "words",
    { name: "Tall", bezier: [0.5, 99, 0.5, -99] },
    { name: "Also good", bezier: [0, 0, 1, 1] }
  ] });
  r = importLibrary(s, mixed);
  check("a library with bad entries still imports", r.ok && r.name === "Mixed", r.message);
  checkEq("only the good entries arrive", JSON.stringify(activeLibrary(s).presets), '[{"name":"Good","bezier":[0.1,0.2,0.3,0.4]},{"name":"Tall","bezier":[0.5,2.5,0.5,-1.5]},{"name":"Also good","bezier":[0,0,1,1]}]');
  checkEq("eleven entries are reported as skipped", r.skipped.length, 11);
  check("the message says how many were skipped", /Skipped 11/.test(r.message), r.message);
  r = importLibrary(s, '{"format":"curve-library","version":1,"name":"Easings","presets":[]}');
  check("a library named like the built-in one is renamed", r.ok && r.name === "Imported", r.message);
  r = importLibrary(s, '{"format":"curve-library","version":1,"presets":[]}');
  check("a library with no name is called Imported", r.ok && r.name === "Imported 2", r.message);

  // ---- delete library
  var count = s.libraries.length;
  r = deleteLibrary(s);
  check("delete library", r.ok && s.libraries.length === count - 1 && findLibrary(s, "Imported 2") < 0, r.message);
  while (s.libraries.length > 1) deleteLibrary(s);
  r = deleteLibrary(s);
  check("deleting the last library leaves an empty My curves", r.ok && s.libraries.length === 1 && s.libraries[0].name === "My curves" && s.libraries[0].presets.length === 0, JSON.stringify(s));

  // ---- damaged settings load as an empty store
  var damaged = ["{oops", "null", "[]", '{"libraries":"x"}', '{"version":1,"active":7,"libraries":[{"name":"","presets":[]},{"name":"Easings","presets":[]},null,{"name":"Kept","presets":[{"name":"A","bezier":[0,0,1,1]},{"name":"A","bezier":[0,0,1,1]},{"bezier":[0,0,1,1]}]}]}'];
  for (i = 0; i < damaged.length; i++) {
    app.settings.saveSetting(SETTINGS_SECTION, LIBRARIES_KEY, damaged[i]);
    checkThrowsNothing("damaged settings " + (i + 1) + " load without an error", function () { again = loadStore(); });
    check("damaged settings " + (i + 1) + " give a usable store", again && again.libraries.length >= 1 && findLibrary(again, again.active) >= 0, JSON.stringify(again));
  }
  checkEq("usable parts of damaged settings survive", JSON.stringify(again), '{"version":1,"active":"Kept","libraries":[{"name":"Kept","presets":[{"name":"A","bezier":[0,0,1,1]}]}]}');

  // ---- panel state
  check("panel state saves", saveUiState({ bezier: [0.1, 0.2, 0.3, 0.4], mode: "Out" }));
  checkEq("panel state reads back", JSON.stringify(loadUiState()), '{"bezier":[0.1,0.2,0.3,0.4],"mode":"Out"}');
  app.settings.saveSetting(SETTINGS_SECTION, UI_KEY, "[1,2");
  checkEq("damaged panel state reads as empty", JSON.stringify(loadUiState()), "{}");

  // ---- files (this test session allows scripts to write files; the panel test covers the blocked case)
  var dir = new File($.fileName).path;
  var path = dir + "/tmp-export" + LIBRARY_EXTENSION;
  var lib = { name: "File test", presets: [{ name: "A", bezier: [0.2, 0, 0, 1] }, { name: "B éè “quoted”", bezier: [0.68, -0.6, 0.32, 1.6] }] };
  r = writeTextFile(path, libraryToText(lib));
  check("write a library file", r.ok, r.message);
  r = readTextFile(path);
  check("read it back", r.ok, r.message);
  p = parseLibraryText(r.text);
  checkEq("the file round trip gives identical curves", JSON.stringify(p.presets), JSON.stringify(lib.presets));
  try { new File(path).remove(); } catch (e) {}
  r = readTextFile(dir + "/no-such-file" + LIBRARY_EXTENSION);
  check("a missing file gives a message", !r.ok && r.message.length > 5, r.message);
  r = writeTextFile("   ", "x");
  check("an empty path gives a message", !r.ok, r.message);
  r = writeTextFile(dir + "/no-such-folder/x/y" + LIBRARY_EXTENSION, "x");
  check("an unwritable path gives a message, no error", !r.ok && r.message.length > 5, r.message);
})();

report();
