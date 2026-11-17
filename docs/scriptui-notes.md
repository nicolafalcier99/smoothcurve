# Notes on a custom-drawn ScriptUI panel in EffectCraft 0.24.1

What building SmoothCurve showed about ScriptUI in EffectCraft 0.24.1 on macOS, for anyone writing
a panel that draws itself. Each point says how it was found. Version matters: EffectCraft moves
fast, and several of these are already being worked on upstream.

## Drawing

- **Every `onDraw` runs again after every handler.** The app takes a snapshot of the window after
  each script step, and the snapshot runs the `onDraw` of every control that has one
  (`__uiRunDraws` in `crates/script/src/scriptui.js`). So there is nothing to invalidate: change
  your state in the handler and the draw follows. `control.notify("onDraw")` calls the handler
  without recording anything, so it is only a cost.
- **The size of the draw list is the speed of the panel.** After each handler the whole draw list
  crosses from the script to the app as JSON twice: once inside the layout request (`__uiLayout`
  sends each control's previous `draw` along with the tree) and once in the snapshot. Measured
  through the control channel, one mouse-move event on the first build of this panel took 13 ms
  with 153 paint operations and 1,176 path segments, and 4 ms with 77 operations and 447 segments.
  Headless, the cost followed the JSON size closely (about 0.16 ms per kilobyte), and did not
  change with the size of the project (300 layers measured the same as none).
  What helped, in order: square controls instead of rounded ones drawn as polygons; one fill and
  one stroke for many shapes of the same colour (several `rectPath` or `moveTo`/`lineTo` runs in
  one path); rounding coordinates to a tenth of a pixel; not painting twice per event.
  Upstream: issue #2695 asks for a faster canvas path, and pull request #3748 adds a `canvas`
  control that repaints on demand.
- **An ellipse is cheap for the script and dear for the app.** `ellipsePath` is one segment in the
  draw list but 48 edges when filled, and a fill compares its edges pairwise on the UI thread
  each time the panel is painted. Fine for a few dots, not for the corners of fifty rounded
  rectangles.
- **Text is Inter Regular, anchored at the top left of its row. Bold and italic are ignored.**
  (`paint_draw` in `crates/ui-egui/src/panels/scriptui_view.rs`.) `measureString` does not measure:
  it returns 0.58 em per character. To centre or right-align text, or cut it to fit, carry the
  font's real advance widths. SmoothCurve has Inter's for characters 32 to 126 in `GLYPH_W`
  (`src/ui.js`), read from the font file the app embeds; Inter has no `kern` table, so the sum of
  the advances is the width.
- **There is no clip operation.** To keep a polyline inside a rectangle, cut it yourself
  (`clipLines` in `src/ui.js`).
- **Colours are sRGB values from 0 to 1**, and alpha blends as expected.

## Layout

- **Give every control its `bounds` and the automatic layout leaves it alone** (`fixed_bounds` in
  `crates/engine/src/scriptui.rs`). A docked panel is told its dock's size through `onResize`.
  Keep the content exactly that size: if it is larger, the dock scrolls it.
- **Set the bounds of real controls in the handler, not in `onDraw`.** The layout runs before the
  draws, so a field moved during a draw appears one event late.
- **A custom-drawn `button` makes a good canvas.** It senses clicks, so its `helpTip` shows as a
  tooltip (set it from the handler or the draw to change it with what is under the pointer), and
  real `edittext` controls added after it sit on top of it and take their own input.
- **Creation properties in the third argument of `add()` are dropped for a group.**
  `parent.add("group", undefined, {name: "x"})` leaves the group unnamed, because the third
  argument is always read as the text. `parent.add("group", undefined, undefined, {name: "x"})`
  works. (The JavaScript Tools Guide gives a group's creation properties as its third argument.)
- An invisible control takes no space, and `visible = false` is the way to hide a field.

## A docked panel and its dock's scroll bars

- **A docked panel sits in a scroll area, and in 0.24.1 that area's two scroll bars come up for
  good as soon as the panel shows one real control.** (`panel` in
  `crates/ui-egui/src/panels/scriptui_view.rs`.) The area's content is as large as the dock, or
  as the script's window when that is larger, and every real control (an `edittext`, a button
  that is not custom-drawn, a check box) adds 4 px under it: each is drawn in its own `scope`,
  which starts below the content. So the content is taller than the dock, the vertical bar comes
  up and takes 10 px of the width, that brings up the horizontal bar, and from then on each
  keeps the other up, also when the control is hidden again. The panel can then be slid by
  10 px sideways and by 10 px plus 4 px per control up and down: a two-finger swipe over the
  panel puts its left or top edge out of sight. The bundled `Ease Presets.jsx` does the same.
  Found from a user's window, where the panel's text sat on the dock's frame. Upstream this is
  issue #2796, fixed on `main` on 2026-11-12 (commit 8a2b4cc6: the bars stay hidden while the
  script's window fits its dock); 0.24.1 was cut a few hours earlier and does not have it.
- **The way out is a docked panel with no real control in it.** A custom-drawn control is
  painted, not laid out, and does not count as content; a control with `visible = false` is not
  drawn at all. A panel that is one canvas has no scroll bars and cannot be moved (checked in the
  app by scrolling over it towards every corner). SmoothCurve does everything that needs typing
  in a floating `palette` window with real fields and buttons (`openEntry` in `src/ui.js`): the
  numbers, names, the search, import and export.
- **The size the dock tells the script is rounded and arrives one frame late.** A window that
  takes that size is at times larger than the dock, which would make the content larger too.
  The script's window can stay 1 x 1 while the canvas is drawn at the dock's size: read `size`
  in `onResize`, then set it back.
- Floating windows: a `palette` opens in the middle of the app's window and cannot be placed by
  the script. `show()` returns at once, and its handlers run later like any others. A window
  that was closed cannot be shown again: make a new one. `alert`, `confirm` and `prompt` only
  print, so a script that needs an answer needs its own window.
- A script cannot give a field the keyboard (`active` does nothing): the user clicks into it.

## Mouse and keys

- `mousedown`, `mouseup`, `mousemove`, `mouseover`, `mouseout` and `click` arrive only when a
  listener asks for them, at the deepest control under the pointer, with `clientX` and `clientY`
  relative to that control. Moves arrive without a button held (hover works). After a press, the
  control it started on keeps receiving the moves, also outside the window.
- The events carry `shiftKey`, `ctrlKey`, `altKey` and `metaKey`. On a Mac, Cmd is `metaKey`.
- **There is no mouse-wheel event.** Nothing in `crates/script/src/scriptui.js` or
  `crates/ui-egui/src/panels/scriptui_view.rs` sends one, so a custom-drawn list cannot follow the
  wheel or the trackpad. Give it a bar to drag, and let a press on its content that moves up or
  down scroll it (SmoothCurve does both for its presets).
- `detail` is the click count, so a double-click needs no timer.
- **There is no wheel, pinch or key event for a script**, in 0.24.1 or on `main` at the time of
  writing: the only events are the six mouse ones above. The one thing in a docked panel that
  follows a two-finger swipe is the dock's own scroll area, which the script cannot read (a
  `mousemove` carries `screenX`/`screenY` beside the control's own coordinates, so their
  difference shows a scroll after the fact, but no event arrives while the pointer rests). So
  zoom and scrolling are drags: SmoothCurve zooms on a drag over the empty graph.
- There are no key events. An `edittext` reports each keystroke through `onChanging` when a
  handler is set, and its commit (Enter, or leaving the field) through `onChange`. The two cannot
  be told apart, so Enter cannot be made to mean "confirm".

## Undo, files, timers

- **An undo group ends with the handler.** `app.beginUndoGroup` in one mouse event and
  `endUndoGroup` in a later one does not make one step: each handler's edits become their own
  History state. Applying on every move of a drag would therefore fill the undo history. Apply on
  release.
- **`File.openDialog`, `File.saveDialog` and `Folder.selectDialog` return nothing** in 0.24.1
  (stubs in `crates/script/src/prelude.js`; upstream issues #1554 and #2894). `Folder.desktop`,
  `Folder.myDocuments` and `Folder.temp` are null, and `$.fileName` of an installed panel is only
  its name, so a script cannot find the home folder.
- **Scripts read files only inside the project's folder, and write none**, unless Settings ▸
  Scripting & Expressions ▸ Allow Scripts to Write Files and Access Network is on. The error
  message names the setting, so pass it on to the user.
- There is no clipboard access. A single-line `edittext` holding the text is the way to let the
  user copy it.
- `app.scheduleTask(code, delay, true)` works for animation, at most every 50 ms. The code string
  runs in the script's own global scope, so reach your function through `$.global`. The draw
  follows each run.
- `app.settings` is kept in `script_settings.json` in the settings folder by the app. The
  command-line tool keeps settings in memory only, which makes it safe for tests.

## Installing and testing

- A panel copied into `Scripts/ScriptUI Panels` is listed at once. Installing over a panel of the
  same name replaces it. An open tab keeps running the old file until it is closed and reopened.
  Panels that were open at quit reopen at launch.
- **A hidden `statictext` makes a panel testable.** SmoothCurve publishes its state and every
  clickable region as JSON in a control named `automation`; the tests read it with `scriptui.get`
  and send `scriptui.mouse` to pixel positions, in a headless `effectcraft-cli mcp` session.
- **To test in the real app without touching the one you work in**, start a second EffectCraft
  with `EFFECTCRAFT_CONFIG_DIR` set to its own folder and `--control <port>`
  (`tools/preview.py`). Its control channel takes `ui.drag`, `ui.click`, `ui.key` and `ui.type`,
  which go through the app's real event loop.
- The app makes a screenshot of itself only while its window is in front. `scriptui.get` returns
  the draw list, which can be painted outside the app (`tools/render.py`). On macOS,
  `screencapture -l <window id>` takes a window that is behind others without bringing it
  forward, but a covered window is not redrawn: the picture is the last frame it showed, which
  is only fresh in the first seconds after launch.
- The control channel also takes `ui.scroll` (`x`, `y`, `dx`, `dy`) and lists every dock gutter in
  `ui.elements` (`dock.gutter.*`), so a test can resize a dock by dragging and try to scroll it.
