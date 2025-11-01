#!/usr/bin/env python3
"""
setup.py
Installs Python, required libraries, and FFmpeg on Windows.

Usage:
  python setup.py
  python setup.py --install-dir "C:\\Tools\\ffmpeg" --add-to-path
  python setup.py --force

Notes:
- Installs Python via winget if not found.
- Installs libraries from requirements.txt.
- Downloads and installs FFmpeg (ffmpeg.exe + ffprobe.exe).
- Default FFmpeg install directory: %LOCALAPPDATA%\\MP3Grabber\\ffmpeg
- Writes ffmpeg_location.txt next to this script for your app to read if desired.
"""

import argparse
import ctypes
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
import subprocess
from pathlib import Path

# ---------- Config ----------
MIRROR_URLS = [
    # Stable “release” essentials zip (name changes occasionally; we try several)
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    # Popular community builds; filenames may change with versions — script tries in order:
    "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n6.1.1-essentials_build.zip",
    "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip",
]

DEFAULT_INSTALL_DIR = Path(os.getenv("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "MP3Grabber" / "ffmpeg"
LOCATION_MARKER = "ffmpeg_location.txt"
LIBRARIES = ["requests", "musicbrainzngs", "yt-dlp", "mutagen"]

# ---------- Helpers ----------
def windows() -> bool:
    return os.name == "nt"

def is_admin() -> bool:
    if not windows():
        return False
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False

def run_command(command: list[str], shell=False):
    """Runs a command and returns its exit code, prints output."""
    print(f"[CMD] {' '.join(command)}")
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace', shell=shell)
        while True:
            output = process.stdout.readline()
            if output == '' and process.poll() is not None:
                break
            if output:
                print(output.strip())
        return process.poll()
    except FileNotFoundError:
        print(f"[!] Command not found: {command[0]}")
        return -1
    except Exception as e:
        print(f"[!] An error occurred: {e}")
        return -1

def human(n: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"

def download_with_progress(url: str, dest: Path):
    print(f"[+] Downloading:\n    {url}")
    with urllib.request.urlopen(url) as r, open(dest, "wb") as f:
        total = r.length if hasattr(r, "length") and r.length else None
        read = 0
        block = 1024 * 256
        while True:
            chunk = r.read(block)
            if not chunk:
                break
            f.write(chunk)
            read += len(chunk)
            if total:
                pct = int(read * 100 / total)
                print(f"\r    {pct:3d}% ({human(read)} / {human(total)})", end="", flush=True)
        if total:
            print()
    print(f"[+] Saved to {dest}")

def extract_zip(zip_path: Path, to_dir: Path) -> Path:
    print(f"[+] Extracting {zip_path.name} …")
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(to_dir)
    print(f"[+] Extracted into {to_dir}")
    return to_dir

def find_binaries(root: Path):
    ffmpeg = None
    ffprobe = None
    for p in root.rglob("*"):
        if p.name.lower() == "ffmpeg.exe":
            ffmpeg = p
        elif p.name.lower() == "ffprobe.exe":
            ffprobe = p
        if ffmpeg and ffprobe:
            break
    return ffmpeg, ffprobe

def ensure_dir(d: Path):
    d.mkdir(parents=True, exist_ok=True)

def copy_binaries(ffmpeg_src: Path, ffprobe_src: Path, install_dir: Path):
    ensure_dir(install_dir)
    dst1 = install_dir / "ffmpeg.exe"
    dst2 = install_dir / "ffprobe.exe"
    shutil.copy2(ffmpeg_src, dst1)
    shutil.copy2(ffprobe_src, dst2)
    print(f"[+] Installed:\n    {dst1}\n    {dst2}")
    return dst1, dst2

def write_location_marker(install_dir: Path):
    marker = Path(__file__).with_name(LOCATION_MARKER)
    marker.write_text(str(install_dir.resolve()), encoding="utf-8")
    print(f"[+] Wrote {LOCATION_MARKER} next to this script: {marker}")

def add_to_user_path(install_dir: Path):
    # Safer to use setx to append for current user. Warn about length.
    path_cmd = f'setx PATH "%PATH%;{install_dir}"'
    print("[+] Adding to user PATH (will affect new terminals only):")
    print(f"    {path_cmd}")
    # Use cmd /c so it works from PowerShell or Python
    ret = os.system(f'cmd /c {path_cmd}')
    if ret == 0:
        print("[+] PATH updated. Open a new terminal for changes to take effect.")
    else:
        print("[!] Failed to update PATH automatically. You can add this folder manually:")
        print(f"    {install_dir}")

# ---------- Setup Steps ----------

def install_python():
    print("\n--- Python Installation ---")
    if shutil.which("python"):
        print("[=] Python is already installed.")
        return True

    print("[+] Python not found. Attempting to install with winget.")
    if not shutil.which("winget"):
        print("[x] winget not found. Please install Python manually from python.org or the Microsoft Store.")
        return False

    print("[+] Updating winget source...")
    run_command(["winget", "source", "update"])

    python_ids = ["Python.Python.3.11", "Python.Python.3"]
    for py_id in python_ids:
        print(f"[+] Trying to install {py_id}...")
        cmd = [
            "winget", "install", "-e", "--id", py_id,
            "--accept-package-agreements", "--silent", "--disable-interactivity"
        ]
        ret = run_command(cmd)
        if ret == 0 and shutil.which("python"):
            print(f"[✓] Successfully installed {py_id}.")
            return True
        print(f"[!] Failed to install {py_id}. Trying next option...")

    print("[x] Failed to install Python using winget.")
    print("Please ensure Python is installed and available in your PATH.")
    return False

def install_libraries():
    print("\n--- Library Installation ---")
    print(f"[+] Installing required Python libraries...")
    python_exe = sys.executable
    ret = run_command([python_exe, "-m", "pip", "install"] + LIBRARIES)
    if ret == 0:
        print("[✓] Libraries installed successfully.")
        return True
    else:
        print("[x] Failed to install libraries. Please run pip install manually.")
        return False

def install_ffmpeg(args):
    print("\n--- FFmpeg Installation ---")
    install_dir: Path = args.install_dir

    if (install_dir / "ffmpeg.exe").exists() and (install_dir / "ffprobe.exe").exists() and not args.force:
        print(f"[=] FFmpeg already present at: {install_dir}")
        write_location_marker(install_dir)
        if args.add_to_path:
            add_to_user_path(install_dir)
        print("[=] Nothing to do. Use --force to reinstall.")
        return 0

    ensure_dir(install_dir)

    with tempfile.TemporaryDirectory() as td:
        tdir = Path(td)
        last_err = None
        zip_file = tdir / "ffmpeg.zip"

        for url in MIRROR_URLS:
            try:
                download_with_progress(url, zip_file)
                break
            except Exception as e:
                print(f"[!] Failed to download from this URL. Trying next…\n    {e}")
                last_err = e
        else:
            print("[x] All download URLs failed.")
            if last_err:
                print(f"    Last error: {last_err}")
            return 2

        # Extract
        extract_dir = tdir / "unpacked"
        extract_zip(zip_file, extract_dir)

        # Locate binaries
        ffmpeg_bin, ffprobe_bin = find_binaries(extract_dir)
        if not (ffmpeg_bin and ffprobe_bin):
            print("[x] Could not find ffmpeg.exe and ffprobe.exe in the downloaded archive.")
            return 3

        # Copy to install dir
        copy_binaries(ffmpeg_bin, ffprobe_bin, install_dir)

    # Optional: write a location marker file so your app can read it.
    write_location_marker(install_dir)

    # Optional: update PATH
    if args.add_to_path:
        add_to_user_path(install_dir)

    print("\n[✓] FFmpeg is ready.")
    print(f"    Folder: {install_dir}")
    return 0

# ---------- Main ----------
def main():
    if not windows():
        print("This setup script targets Windows. On macOS/Linux, please install dependencies manually.")
        return 1

    parser = argparse.ArgumentParser(description="Setup Yoinker environment on Windows.")
    parser.add_argument("--install-dir", type=Path, default=DEFAULT_INSTALL_DIR, help="Destination for ffmpeg.exe/ffprobe.exe")
    parser.add_argument("--add-to-path", action="store_true", help="Append FFmpeg install dir to the current user PATH")
    parser.add_argument("--force", action="store_true", help="Reinstall FFmpeg even if it already exists")
    args = parser.parse_args()

    # Step 1: Install Python
    if not install_python():
        return 1 # Stop if python installation fails

    # Step 2: Install Libraries
    if not install_libraries():
        return 1 # Stop if library installation fails

    # Step 3: Install FFmpeg
    ffmpeg_ret = install_ffmpeg(args)
    if ffmpeg_ret != 0:
        return ffmpeg_ret

    print("\n[✓] All setup steps completed successfully!")
    return 0

if __name__ == "__main__":
    sys.exit(main())
