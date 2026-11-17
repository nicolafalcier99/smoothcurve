# Changelog

## 1.2.0 (2026-11-17)

From the first user's notes on 1.1.0.

- Fixed: the docked panel could be slid a few pixels inside its dock, which put its left or top
  edge out of sight (text touching the frame), and it had EffectCraft's two scroll bars around
  it. EffectCraft 0.24.1 does that to any docked script panel that holds a real control. The
  panel now holds none: it is one drawn canvas, and it stays still.
- Because of that, everything typed is typed in a small floating window: click the numbers under
  the graph to type or paste a curve, and the star, Rename, Find, Import and Export open theirs.
- Zoom goes further: at full size the box is as large as the graph lets it be, and it zooms out
  to about a sixth of that. Drag up or down on the empty graph to zoom without steps (a
  double-click there is the full size), or use the buttons: eight steps, and holding one keeps
  going. The buttons are in the graph's top left corner, away from the curve's end point.
- An **i** in the header opens a page with every key and click, on one page.
- **From keys** is beside the numbers, in every layout that has the graph. Before, a short
  panel hid it together with the Auto-apply row.
- A little more room around everything.

## 1.1.0 (2026-11-17)

From the first user's notes on 1.0.0.

- The graph comes before the presets. Its 0..1 box is now always a square, as wide as the panel
  when there is the height for it. The presets keep two rows and scroll in what is left; they
  show more rows only when the graph has its full size.
- Zoom: a **−** button in the graph's corner makes the box smaller in four steps, so a curve or a
  handle that goes far beyond it can be seen whole; **+** comes back. The zoom changes only when
  asked and is kept between launches.
- The preset list scrolls by dragging the tiles up or down as well as by its bar, which is wider.
  (EffectCraft 0.24.1 sends a panel no mouse-wheel events.)
- A low list of your own curves shows two rows of lower tiles instead of one.

## 1.0.0 (2026-11-17)

First release. Built and tested for EffectCraft 0.24.1 on macOS.

- A graph with two draggable handles; the curve is applied to the selected keyframes in one
  undo step, on the incoming side, the outgoing side or both.
- 25 built-in easings (Linear, and Sine, Quad, Cubic, Quart, Quint, Expo, Circ and Back as In,
  Out and In-Out).
- Lock switches and modifier keys while dragging: snap, keep length, keep angle, mirror.
- A grid that never changes size, with room above and below it for overshoot.
- A motion strip that shows the speed, and plays it on a click.
- Your own curves in named libraries; export and import as text or as a `.curves.json` file.
- Auto-apply, From keys, typed or pasted `cubic-bezier(...)` values, hover preview.
- Layouts for a tall, a wide and a strip-shaped panel.
