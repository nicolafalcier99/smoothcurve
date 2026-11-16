#!/usr/bin/env python3
"""Run the SmoothCurve tests headless with effectcraft-cli.

    python3 -I tests/run.py            # everything
    python3 -I tests/run.py t1 ui      # only the tests whose name contains one of the words

Each tests/t*.jsx is a script whose result is a report string ("PASSED all N checks" or
"FAILED ..."). Each tests/ui_*.py drives the built panel (dist/SmoothCurve.jsx) through the
scriptui.* commands, the way a user's mouse would. The CLI keeps settings in memory only, so
nothing here touches the real EffectCraft settings folder.
"""
import json
import os
import shutil
import subprocess
import sys
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

def find_cli():
    """effectcraft-cli: $EFFECTCRAFT_CLI, else a release folder next to this project, else the PATH."""
    if os.environ.get("EFFECTCRAFT_CLI"):
        return os.environ["EFFECTCRAFT_CLI"]
    parent = os.path.dirname(ROOT)
    for name in sorted(os.listdir(parent), reverse=True):
        path = os.path.join(parent, name, "effectcraft-cli")
        if name.startswith("effectcraft-cli") and os.path.isfile(path):
            return path
    return shutil.which("effectcraft-cli") or "effectcraft-cli"


CLI = find_cli()

# Scripts may only #include files from their own folder unless this setting is on. It is set
# for the CLI's in-memory session only.
ALLOW_FILES = {"command": "prefs.set", "params": {"key": "scripting.allowScriptsWriteFiles", "value": True}}


def run_steps(steps, project=None, allow_files=True, timeout=300):
    """Run engine commands in one headless session; returns the list of {command, result}."""
    all_steps = ([ALLOW_FILES] if allow_files else []) + list(steps)
    cmd = [CLI] + (["--project", project] if project else ["--empty"]) + ["run", "--commands", "-", "--json"]
    p = subprocess.run(cmd, input=json.dumps(all_steps), capture_output=True, text=True, timeout=timeout)
    try:
        out = json.loads(p.stdout)
    except ValueError:
        raise RuntimeError("CLI output is not JSON (exit %d): %s %s" % (p.returncode, p.stdout[:2000], p.stderr[:2000]))
    if isinstance(out, dict) and "error" in out:
        raise RuntimeError("CLI error: %s" % out["error"])
    return out[1:] if allow_files else out


def run_script(path):
    """Run one .jsx test; returns (ok, report text)."""
    try:
        out = run_steps([{"command": "file.runScript", "params": {"path": path}}])
    except RuntimeError as e:
        return False, str(e)
    r = out[-1]["result"]
    if r.get("error"):
        return False, "script error: %s" % json.dumps(r["error"])
    text = r.get("result")
    text = text if isinstance(text, str) else json.dumps(text)
    extra = r.get("output") or ""
    ok = text.startswith("PASSED") and "FAIL" not in text
    return ok, text + (("\n" + extra) if extra and not ok else "")


def build():
    p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "build.py")], capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit("build failed:\n" + p.stdout + p.stderr)


def main():
    words = [a for a in sys.argv[1:] if not a.startswith("-")]
    names = sorted(os.listdir(HERE))
    wanted = lambda n: not words or any(w in n for w in words)
    failed = 0
    if os.path.exists(os.path.join(ROOT, "build.py")):
        build()
    for n in names:
        if n.startswith("t") and n.endswith(".jsx") and wanted(n):
            ok, text = run_script(os.path.join(HERE, n))
            print("%-28s %s" % (n, text))
            failed += 0 if ok else 1
    for n in names:
        if (n.startswith("ui_") or n.startswith("check_")) and n.endswith(".py") and wanted(n):
            if HERE not in sys.path:
                sys.path.insert(0, HERE)
            spec = importlib.util.spec_from_file_location(n[:-3], os.path.join(HERE, n))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            ok, text = mod.run(sys.modules[__name__])
            print("%-28s %s" % (n, text))
            failed += 0 if ok else 1
    print("\n%s" % ("ALL GREEN" if not failed else "%d test file(s) FAILED" % failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
