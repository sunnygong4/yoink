"""Zip the extension for the website's download link (web/public/yoinker-ipod.zip) and the Chrome Web Store."""
import json
import zipfile
from pathlib import Path

here = Path(__file__).resolve().parent
out = here.parent / "web" / "public" / "yoinker-ipod.zip"
version = json.loads((here / "manifest.json").read_text(encoding="utf-8"))["version"]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(here.rglob("*")):
        if f.is_file() and f.name != "pack.py" and f.suffix != ".svg" and "__pycache__" not in f.parts:
            z.write(f, f.relative_to(here).as_posix())
print(f"wrote {out} (version {version})")
