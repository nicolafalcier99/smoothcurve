# Changelog

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
