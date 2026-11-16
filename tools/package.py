#!/usr/bin/env python3
"""Make the release download: release/SmoothCurve-<version>.zip and release/SHA256SUMS.txt.

The zip holds what someone who only wants to use the panel needs: SmoothCurve.jsx, a short
INSTALL.txt, the changelog and the licence files. Nothing else from the project goes in.

    python3 -I tools/package.py
"""
import hashlib
import os
import re
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

INSTALL = """SmoothCurve {version}: an easing curve panel for EffectCraft

Install
  1. In EffectCraft: File > Scripts > Install ScriptUI Panel...
  2. Pick SmoothCurve.jsx from this folder.
  3. Open it at the bottom of the Window menu: SmoothCurve.jsx. It docks like any panel.
  No restart is needed. To update, install the new file the same way, then close the
  panel's tab and open it again.

Use
  Select keyframes, shape the curve (drag the two handles, click a tile, or type four
  numbers), press Apply. One Undo takes it back.

Built and tested for EffectCraft 0.24.1 on macOS. Not tried on Windows or Linux yet.
An independent community panel: not made or endorsed by the ArtCraft Team.
Free to use, change and share: MIT or Apache-2.0, see the licence files.
More: {home}
"""


def main():
    p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "build.py")], capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit("build failed:\n" + p.stdout + p.stderr)
    jsx = open(os.path.join(ROOT, "dist", "SmoothCurve.jsx"), encoding="utf-8").read()
    version = re.search(r"^// SmoothCurve (\S+):", jsx, re.M).group(1)
    home = os.environ.get("SMOOTHCURVE_HOME_URL", "https://github.com/nicolafalcier99/smoothcurve")
    out_dir = os.path.join(ROOT, "release")
    os.makedirs(out_dir, exist_ok=True)
    name = "SmoothCurve-%s" % version
    zip_path = os.path.join(out_dir, name + ".zip")
    files = [("SmoothCurve.jsx", jsx.encode("utf-8")), ("INSTALL.txt", INSTALL.format(version=version, home=home).encode("utf-8"))]
    for extra in ("CHANGELOG.md", "LICENSE-MIT", "LICENSE-APACHE", "NOTICE"):
        files.append((extra, open(os.path.join(ROOT, extra), "rb").read()))
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for fname, data in files:
            info = zipfile.ZipInfo(name + "/" + fname, date_time=(2026, 1, 1, 0, 0, 0))   # same bytes on every build
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
    sums = []
    for path, label in ((zip_path, name + ".zip"), (os.path.join(ROOT, "dist", "SmoothCurve.jsx"), "SmoothCurve.jsx")):
        sums.append("%s  %s" % (hashlib.sha256(open(path, "rb").read()).hexdigest(), label))
    with open(os.path.join(out_dir, "SHA256SUMS.txt"), "w") as f:
        f.write("\n".join(sums) + "\n")
    print("made release/%s.zip (%d bytes) and release/SHA256SUMS.txt" % (name, os.path.getsize(zip_path)))
    for s in sums:
        print("  " + s)


if __name__ == "__main__":
    main()
