# Changelog

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
