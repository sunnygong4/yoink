import os
import re
import sys
import shutil
import subprocess
import threading
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
import time
 


import requests
import musicbrainzngs as mb
from yt_dlp import YoutubeDL, DownloadError
from mutagen.easyid3 import EasyID3
from mutagen.id3 import ID3, APIC
from mutagen.mp3 import MP3

class WidgetLogHandler(logging.Handler):
    def __init__(self, widget):
        logging.Handler.__init__(self)
        self.widget = widget

    def emit(self, record):
        msg = self.format(record)
        self.widget.after(0, self.widget.insert, tk.END, msg + '\n')
        self.widget.after(0, self.widget.see, tk.END)

APP_NAME = "Yoinker"
APP_VER = "3.0"  # Torrent support, UI redesign, unified interface

mb.set_useragent(APP_NAME, APP_VER, "https://example.com")

CLEAN_PARENS = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]\s*")
LOG_DIR_NAME = "SmartMP3Grabber_Logs"

# ---------------- Logging ----------------
def setup_logging(dest_root: Path | None) -> Path:
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    app_logs = Path(__file__).with_name("logs"); app_logs.mkdir(exist_ok=True)
    logfile = app_logs / f"run-{ts}.log"
    handlers = [RotatingFileHandler(logfile, maxBytes=2_000_000, backupCount=5, encoding="utf-8")]
    if dest_root:
        dest_logs = Path(dest_root) / LOG_DIR_NAME; dest_logs.mkdir(parents=True, exist_ok=True)
        dest_file = dest_logs / f"run-{ts}.log"
        handlers.append(RotatingFileHandler(dest_file, maxBytes=2_000_000, backupCount=3, encoding="utf-8"))
    logging.basicConfig(level=logging.DEBUG, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s", handlers=handlers)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.info("===== %s %s started ====", APP_NAME, APP_VER)
    if dest_root:
        logging.info("Logs mirrored under: %s", (Path(dest_root)/LOG_DIR_NAME).as_posix())
        return dest_file
    return logfile

class YTDLPLogger:
    def __init__(self, name="yt-dlp"): self.l = logging.getLogger(name)
    def debug(self, msg): self.l.debug(msg)
    def info(self, msg): self.l.info(msg)
    def warning(self, msg): self.l.warning(msg)
    def error(self, msg): self.l.error(msg)

# --------------- Helpers -----------------
def sanitize(name: str) -> str:
    name = name.strip().replace(":", " - ")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1F]', "", name)
    name = re.sub(r"\s+", " ", name)
    return name[:180]

def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)

def read_ffmpeg_location() -> str | None:
    marker = Path(__file__).with_name("ffmpeg_location.txt")
    if marker.exists():
        return marker.read_text(encoding="utf-8").strip()
    return None

def _which_ffmpeg(ff_loc: str | None) -> str | None:
    if ff_loc and Path(ff_loc).exists():
        return ff_loc
    from shutil import which
    return which("ffmpeg")

def tag_mp3(file_path: Path, *, title=None, artist=None, album=None,
            album_artist=None, track_number=None, year=None, cover_bytes=None):
    try:
        try:
            audio = MP3(file_path.as_posix(), ID3=ID3); audio.add_tags()
        except Exception:
            pass
        tags = EasyID3(file_path.as_posix())
        if title: tags["title"] = str(title)
        if artist: tags["artist"] = str(artist)
        if album: tags["album"] = str(album)
        if album_artist: tags["albumartist"] = str(album_artist)
        if "tracknumber" in tags: del tags["tracknumber"]
        if track_number: tags["tracknumber"] = str(track_number)
        if year: tags["date"] = str(year)
        tags.save()
        if cover_bytes:
            audio = MP3(file_path.as_posix(), ID3=ID3)
            try:
                for k in list(audio.tags.keys()):
                    if k.startswith("APIC"): del audio.tags[k]
            except Exception:
                pass
            audio.tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover_bytes))
            audio.save()
    except Exception:
        logging.exception("Tagging failed for %s", file_path)

def clean_title_for_search(t: str) -> str:
    if not t: return ""
    t = CLEAN_PARENS.sub(" ", t)
    parts = [p.strip() for p in t.split(" - ", 1)]
    if len(parts) == 2 and parts[1]: t = parts[1]
    return re.sub(r"\s{2,}", " ", t).strip()

def fetch_thumbnail_bytes(info: dict) -> bytes | None:
    url = info.get("thumbnail")
    if not (isinstance(url, str) and url.startswith("http")): return None
    try:
        r = requests.get(url, timeout=20)
        if r.ok and r.content: return r.content
    except Exception:
        logging.exception("Thumbnail fetch failed: %s", url)
    return None

# --- Cover Art helpers ---
def fetch_cover_from_caa(release_id: str) -> bytes | None:
    if not release_id: return None
    for endpoint in (f"https://coverartarchive.org/release/{release_id}/front",
                     f"https://coverartarchive.org/release/{release_id}/front-500",
                     f"https://coverartarchive.org/release/{release_id}/front-250"):
        try:
            r = requests.get(endpoint, timeout=12, headers={"User-Agent": f"{APP_NAME}/{APP_VER}"})
            if r.ok and r.content:
                logging.info("Fetched cover from CAA: %s", endpoint); return r.content
        except Exception as e:
            logging.warning("CAA fetch failed (%s): %s", type(e).__name__, endpoint)
    return None

def fetch_cover_from_wikipedia(album: str | None, artist: str | None) -> bytes | None:
    if not (album or artist): return None
    try:
        q = (f"{album or ''} {artist or ''} album").strip() or (artist or '')
        logging.info("Wikipedia search query: %s", q)
        sr = requests.get("https://en.wikipedia.org/w/api.php",
                          params={"action": "query","list":"search","srsearch":q,"format":"json","srlimit":1},
                          timeout=12)
        if not sr.ok:
            return None
        data = sr.json()
        hits = data.get("query", {}).get("search", [])
        if not hits: return None
        page_title = hits[0].get("title")
        pi = requests.get("https://en.wikipedia.org/w/api.php",
                          params={"action":"query","prop":"pageimages","piprop":"thumbnail","pithumbsize":1024,"titles":page_title,"format":"json"},
                          timeout=12)
        if not pi.ok:
            return None
        data2 = pi.json()
        for p in data2.get("query", {}).get("pages", {}).values():
            thumb = p.get("thumbnail", {}).get("source")
            if thumb:
                img = requests.get(thumb, timeout=12)
                if img.ok and img.content:
                    logging.info("Fetched cover from Wikipedia: %s", thumb)
                    return img.content
    except Exception:
        logging.exception("Wikipedia cover fetch failed")
    return None

# ---------- MusicBrainz ----------
def mb_search_recordings(title: str | None, artist: str | None = None, release: str | None = None, limit=40):
    q = {"limit": limit}
    if title: q["recording"] = title
    if artist: q["artist"] = artist
    if release: q["release"] = release
    try:
        res = mb.search_recordings(**q)
        return res.get("recording-list", [])
    except Exception:
        logging.exception("MB search_recordings failed")
        return []

def mb_search_albums(album: str | None, artist: str | None = None, limit=40):
    q = {"limit": limit}
    if album: q["release"] = album
    if artist: q["artist"] = artist
    try:
        res = mb.search_releases(**q)
        return res.get("release-list", [])
    except Exception:
        logging.exception("MB search_releases failed")
        return []

def mb_get_recording_details(rec_id: str):
    try:
        rec = mb.get_recording_by_id(rec_id, includes=["releases", "artist-credits", "media"])
        return rec.get("recording")
    except Exception:
        logging.exception("MB get_recording_by_id failed for %s", rec_id)
        return None

def mb_get_release_tracks(release_id: str):
    try:
        rel = mb.get_release_by_id(release_id, includes=["recordings", "artists", "release-groups", "media"])
        r = rel["release"]
    except Exception:
        logging.exception("MB get_release_by_id failed for %s", release_id); return [], None, None, None
    year = (r.get("date") or "")[:4] or None
    tracks = []
    for med in r.get("medium-list", []):
        for tr in med.get("track-list", []):
            pos = tr.get("position")
            title = tr.get("recording", {}).get("title") or tr.get("title")
            artist = r.get("artist-credit-phrase") or tr.get("recording", {}).get("artist-credit-phrase")
            try: pos = int(pos)
            except: pos = None
            tracks.append({"pos": pos, "title": title, "artist": artist, "album": r.get("title"), "year": year})
    tracks.sort(key=lambda x: (x["pos"] if x["pos"] is not None else 9999, x["title"].lower()))
    album_artist = r.get("artist-credit-phrase")
    return tracks, r.get("title"), album_artist, year

# ---------- yt-dlp core ----------
def get_cookies_browser():
    """Try different browsers for cookies, starting with chrome"""
    browsers = ["chrome", "edge", "firefox"]
    for browser in browsers:
        try:
            # Test if browser cookies are accessible
            test_opts = {"cookiesfrombrowser": (browser,)}
            with YoutubeDL(test_opts) as ydl:
                # Just test if we can create the ydl instance
                pass
            logging.info("Using cookies from browser: %s", browser)
            return browser
        except Exception:
            logging.debug("Browser %s cookies not available", browser)
            continue
    logging.warning("No browser cookies available")
    return None

def make_ydl_common(ff_loc: str | None, cookies_from_browser: str | None = None, allow_playlists: bool = True,
                    hooks=None, max_abr_kbps: int | None = None, url_video_mp4: bool = False, log_name="yt-dlp",
                    format_override: str | None = None, extractor_args: dict | None = None, video_quality: str | None = None):
    postprocessors = []
    if url_video_mp4:
        if video_quality and video_quality != "Best":
            # Map quality strings to height values
            quality_map = {"480p": "480", "720p": "720", "1080p": "1080", "1440p": "1440", "2160p": "2160"}
            height = quality_map.get(video_quality, "720")
            fmt = f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/best[height<={height}][ext=mp4]/best"
        else:
            fmt = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
    else:
        fmt = (
               format_override or
               (f"bestaudio[ext=m4a][abr<={max_abr_kbps}]/bestaudio[ext=m4a]/bestaudio/best" if max_abr_kbps else
                "bestaudio[ext=m4a]/bestaudio/best")
              )
        postprocessors = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": str(max_abr_kbps or 0)},
            {"key": "FFmpegMetadata"},
        ]
    opts = {
        "format": fmt,
        "quiet": True,
        "verbose": True,
        "no_warnings": False,
        "postprocessors": postprocessors,
        "noplaylist": not allow_playlists,
        "ignoreerrors": True,
        "logger": YTDLPLogger(log_name),
        "extractor_args": extractor_args or {},
        "retries": 3,
        "default_search": "ytsearch",
    }
    if hooks: opts["progress_hooks"] = hooks
    if ff_loc: opts["ffmpeg_location"] = ff_loc
    
    # Use cookie fallback logic

    
    logging.debug("yt-dlp options (%s): %s", log_name, {k: v for k,v in opts.items() if k != "logger"})
    return opts

def _variants_for_yt():
    return [
        ("default", {}),
        ("force_m4a", {"format_override": "bestaudio[ext=m4a]/bestaudio/best"}),
        ("android_client", {"extractor_args": {"youtube": {"player_client": ["android"]}}}),
        ("android_m4a", {"format_override": "bestaudio[ext=m4a]/bestaudio/best",
                         "extractor_args": {"youtube": {"player_client": ["android"]}}}),
        ("tv_client", {"extractor_args": {"youtube": {"player_client": ["tv"]}}}),
        ("web_music", {"extractor_args": {"youtube": {"player_client": ["web_music"]}}}),
    ]

def extract_with_retries(id_or_url: str, base_opts: dict, *, outtmpl: str):
    last_err = None
    for note, extra in _variants_for_yt():
        opts = dict(base_opts); opts.update(extra); opts["outtmpl"] = outtmpl
        logging.info("yt-dlp try variant: %s", note)
        try:
            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(id_or_url, download=True)
            return info, note
        except DownloadError as de:
            last_err = de
            logging.warning("yt-dlp variant failed (%s): %s", note, de)
        except Exception as e:
            last_err = e
            logging.exception("yt-dlp variant error (%s)", note)
    raise last_err or RuntimeError("All yt-dlp variants failed")

def _resolve_downloaded_paths(info, root: Path):
    paths = []
    for k in ("requested_downloads", "requested_formats"):
        if k in info and info[k]:
            for it in info[k]:
                fp = it.get("filepath") or it.get("filename")
                if fp: paths.append(Path(fp))
    if not paths:
        if "filepath" in info: paths.append(Path(info["filepath"]))
        if "filename" in info: paths.append(Path(info["filename"]))
    if not paths:
        title = (info.get("title") or "output").strip()
        ext = info.get("ext") or "mp3"
        paths.append(root / f"{title}.{ext}")
    uniq = []
    for p in paths:
        if p.exists():
            uniq.append(p)
        else:
            cand = root / p.name
            if cand.exists(): uniq.append(cand)
    return uniq

def ensure_mp3_from_any(source_path: Path, ff_loc: str | None, target_dir: Path) -> Path:
    if source_path.suffix.lower() == ".mp3":
        return source_path
    ff = _which_ffmpeg(ff_loc)
    if not ff:
        raise FileNotFoundError("ffmpeg not found to transcode non-mp3 audio")
    out = target_dir / (source_path.stem + ".mp3")
    i = 2
    while out.exists():
        out = target_dir / (source_path.stem + f" ({i}).mp3"); i += 1
    logging.info("Transcoding with ffmpeg: %s -> %s", source_path, out)
    try:
        subprocess.run([ff, "-y", "-i", source_path.as_posix(), "-vn", "-c:a", "libmp3lame", "-q:a", "0", out.as_posix()],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return out
    except subprocess.CalledProcessError as e:
        logging.error("ffmpeg transcode failed: %s", e.stderr.decode("utf-8", "ignore"))
        raise

def yt_first_match(query: str, ydl_common: dict, music_root: Path, is_video: bool = False, ff_loc: str | None = None):
    q = f"ytsearch1:{query} audio" if not is_video else f"ytsearch1:{query}"
    base_opts = dict(ydl_common)
    outtmpl = str(music_root / "% (title)s.%(ext)s")
    info, used = extract_with_retries(q, base_opts, outtmpl=outtmpl)
    logging.info("yt-dlp search success via: %s", used)
    paths = _resolve_downloaded_paths(info, music_root)
    # Fallback: sometimes yt-dlp search returns info without producing a file (no paths).
    # Try downloading the direct first-entry webpage URL if available and re-resolve paths.
    if not paths:
        try:
            # If search returned a playlist/search result with entries, try first entry directly
            if isinstance(info, dict) and info.get("entries"):
                first = info["entries"][0]
                target = first.get("webpage_url") or first.get("url")
                if target:
                    logging.info("No paths from search; retrying direct download of first entry: %s", target)
                    info2, used2 = extract_with_retries(target, base_opts, outtmpl=outtmpl)
                    paths = _resolve_downloaded_paths(info2, music_root)
                    if paths:
                        info = info2
                        logging.info("Direct entry download success via: %s", used2)
        except Exception:
            logging.exception("Fallback direct-entry download failed for query: %s", query)
    if not paths:
        raise FileNotFoundError("No file produced by search download (no paths reported).")
    if is_video:
        for p in paths:
            if p.suffix.lower() in (".mp4",".mkv",".webm"): return p, info
        vids = list(music_root.glob("*.mp4")) + list(music_root.glob("*.mkv")) + list(music_root.glob("*.webm"))
        if vids: return max(vids, key=lambda p: p.stat().st_mtime), info
        raise FileNotFoundError("No video produced by download.")
    for p in paths:
        if p.suffix.lower() == ".mp3": return p, info
    for p in paths:
        if p.suffix.lower() in (".m4a",".webm",".opus",".mp4"):
            mp3 = ensure_mp3_from_any(p, ff_loc, music_root)
            return mp3, info
    mp3s = list(music_root.glob("*.mp3"))
    if mp3s:
        return max(mp3s, key=lambda p: p.stat().st_mtime), info
    raise FileNotFoundError("No MP3 produced; postprocess/transcode failed.")

# ---------- Update check ----------
def check_and_update_ytdlp() -> str:
    try:
        # Try different ways to run yt-dlp
        commands = [
            ["yt-dlp", "-U"],
            [sys.executable, "-m", "yt_dlp", "-U"],
            [sys.executable, "-c", "import yt_dlp; yt_dlp.main([\"-U\"])"]
        ]
        
        for cmd in commands:
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                out = (r.stdout or "") + (r.stderr or "")
                logging.info("yt-dlp -U output: %s", out.strip())
                if "yt-dlp is up to date" in out:
                    return "yt-dlp is up to date"
                if "Updated yt-dlp to" in out or "Now at version" in out:
                    return "yt-dlp updated"
                break
            except FileNotFoundError:
                continue
            except Exception as e:
                logging.debug("yt-dlp command failed: %s", e)
                continue
        
        # If update check didn't work, try pip install
        r2 = subprocess.run([sys.executable, "-m", "pip", "install", "-U", "yt-dlp"],
                            capture_output=True, text=True, timeout=120)
        out2 = (r2.stdout or "") + (r2.stderr or "")
        logging.info("pip install -U yt-dlp output: %s", out2.strip())
        if "Successfully installed" in out2 or "Requirement already satisfied" in out2:
            return "yt-dlp updated via pip"
        return "yt-dlp update checked"
    except Exception as e:
        logging.warning("yt-dlp update check failed: %s", e)
        return "yt-dlp update check failed"

# ---------- GUI ----------
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_NAME)
        self.geometry("1060x780")
        self.minsize(920, 660)
        self.ff_loc = read_ffmpeg_location()
        self.per_task = {}
        setup_logging(None)
        self.build()
        self.after(100, self._auto_update_check)

    def _auto_update_check(self):
        self.ui_status("Checking yt-dlp…")
        def run():
            res = check_and_update_ytdlp()
            self.ui_status(res)
        threading.Thread(target=run, daemon=True).start()

    def build(self):
        pad = 8
        # Main container with left and right panels
        main_container = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        main_container.pack(fill="both", expand=True, padx=pad, pady=pad)
        
        # Left panel (main content)
        left_panel = ttk.Frame(main_container)
        main_container.add(left_panel, weight=1)
        
        # Right panel (task manager)
        right_panel = ttk.Frame(main_container, width=300)
        main_container.add(right_panel, weight=1)
        
        # Music root
        top = ttk.LabelFrame(left_panel, text="Destination (Music Root)")
        top.pack(fill="x", padx=0, pady=(0, pad))
        self.dest = tk.StringVar(value=str(Path.home() / "Music"))
        ttk.Entry(top, textvariable=self.dest).pack(side="left", fill="x", expand=True, padx=(pad, 4), pady=pad)
        ttk.Button(top, text="Browse…", command=self.choose_dest).pack(side="left", padx=(4, pad), pady=pad)

        # Set default values for removed options
        self.use_mb = tk.BooleanVar(value=True)
        self.use_playlist_index = tk.BooleanVar(value=True)
        self.cookies_browser = tk.StringVar(value="chrome")
        self.max_kbps = tk.StringVar(value="192")

        # Notebook
        nb = ttk.Notebook(left_panel); nb.pack(fill="both", expand=True, padx=0, pady=(0, pad))
        self.tab_search = ttk.Frame(nb); self.tab_urls = ttk.Frame(nb); self.tab_torrents = ttk.Frame(nb)
        nb.add(self.tab_search, text="Song Downloader")
        nb.add(self.tab_urls, text="Download from Youtube/Bilibili")
        nb.select(self.tab_search)

        # URL tab
        self.urls_text = tk.Text(self.tab_urls, height=12, wrap="word")
        self.urls_text.insert("1.0",
            "https://www.youtube.com/watch?v=... | Title Hint (optional)\n"
            "https://www.bilibili.com/video/BV... | Title Hint (optional)\n"
            "https://www.youtube.com/playlist?list=...\n"
        )
        self.urls_text.pack(fill="both", expand=True, padx=pad, pady=(pad, 0))
        
        # URL tab options
        url_options = ttk.LabelFrame(self.tab_urls, text="Download Options")
        url_options.pack(fill="x", padx=pad, pady=(6, 0))
        
        # Mode selector
        mode_frame = ttk.Frame(url_options)
        mode_frame.pack(fill="x", padx=pad, pady=(pad, 0))
        ttk.Label(mode_frame, text="Mode:").pack(side="left")
        self.url_mode = tk.StringVar(value="MP3")
        mode_cb = ttk.Combobox(mode_frame, values=["MP3", "MP4"], textvariable=self.url_mode, width=10, state="readonly")
        mode_cb.pack(side="left", padx=(6, 16))
        mode_cb.bind("<<ComboboxSelected>>", lambda e: self._switch_url_mode())
        
        # Audio quality options (for MP3 mode)
        self.url_audio_frame = ttk.Frame(url_options)
        self.url_audio_frame.pack(fill="x", padx=pad, pady=(0, pad))
        ttk.Label(self.url_audio_frame, text="Audio Quality:").pack(side="left")
        self.url_max_kbps = tk.StringVar(value="192")
        ttk.Combobox(self.url_audio_frame, values=["96","128","160","192","256","320","No limit"], 
                     textvariable=self.url_max_kbps, width=10, state="readonly").pack(side="left", padx=(6, 0))
        
        # Video quality options (for MP4 mode)
        self.url_video_frame = ttk.Frame(url_options)
        ttk.Label(self.url_video_frame, text="Video Quality:").pack(side="left")
        self.url_video_quality = tk.StringVar(value="720p")
        ttk.Combobox(self.url_video_frame, values=["480p","720p","1080p","1440p","2160p","Best"], 
                     textvariable=self.url_video_quality, width=10, state="readonly").pack(side="left", padx=(6, 0))
        
        bar1 = ttk.Frame(self.tab_urls); bar1.pack(fill="x", padx=pad, pady=(6, pad))
        ttk.Button(bar1, text="Clear", command=lambda: self.urls_text.delete("1.0", "end")).pack(side="right")
        ttk.Button(bar1, text="Download", command=self.start_by_url).pack(side="right", padx=(0, 8))



        # Results list
        self.results = tk.Listbox(self.tab_search, height=16, selectmode=tk.EXTENDED)
        self.results.pack(fill="both", expand=True, padx=pad, pady=(pad, pad))
        self.result_items = []

        # Unified Search Area (moved to bottom)
        search_frame = ttk.LabelFrame(self.tab_search, text="Search")
        search_frame.pack(fill="x", padx=pad, pady=(0, pad))
        
        # Mode toggle slider and audio quality
        mode_frame = ttk.Frame(search_frame)
        mode_frame.pack(fill="x", padx=pad, pady=(pad, 0))
        ttk.Label(mode_frame, text="Mode:").pack(side="left")
        self.mode_var = tk.StringVar(value="Song")
        mode_cb = ttk.Combobox(mode_frame, values=["Song", "Album"], textvariable=self.mode_var, width=10, state="readonly")
        mode_cb.pack(side="left", padx=(6, 16))
        mode_cb.bind("<<ComboboxSelected>>", lambda e: self._switch_mode())
        
        ttk.Label(mode_frame, text="Audio Quality:").pack(side="left")
        ttk.Combobox(mode_frame, values=["96","128","160","192","256","320","No limit"], 
                     textvariable=self.max_kbps, width=10, state="readonly").pack(side="left", padx=(6, 0))
        
        # Unified input fields
        input_frame = ttk.Frame(search_frame)
        input_frame.pack(fill="x", padx=pad, pady=(0, pad))
        
        # Configure grid weights
        for i in range(4): input_frame.grid_columnconfigure(i, weight=1)
        
        # Song/Album title field
        ttk.Label(input_frame, text="Song/Album Name:").grid(row=0, column=0, sticky="e", padx=6, pady=4)
        self.unified_title = tk.StringVar()
        e_unified_title = ttk.Entry(input_frame, textvariable=self.unified_title)
        e_unified_title.grid(row=0, column=1, sticky="we", padx=(0,8), pady=4)
        
        # Artist field
        ttk.Label(input_frame, text="Artist:").grid(row=0, column=2, sticky="e", padx=6, pady=4)
        self.unified_artist = tk.StringVar()
        e_unified_artist = ttk.Entry(input_frame, textvariable=self.unified_artist)
        e_unified_artist.grid(row=0, column=3, sticky="we", padx=(0,8), pady=4)

        # Bottom action buttons
        bottom_frame = ttk.Frame(self.tab_search)
        bottom_frame.pack(fill="x", padx=pad, pady=(pad, 0))
        self.btn_find = ttk.Button(bottom_frame, text="Find Song", command=self.find_song)
        self.btn_find.pack(side="left", padx=(0, 8))

        ttk.Button(bottom_frame, text="Download Selected", command=self.download_selected_from_db).pack(side="right")

        # Status bar
        status_frame = ttk.Frame(left_panel)
        status_frame.pack(fill="x", padx=0, pady=(pad, 0))
        self.status = tk.StringVar(value="Idle")
        ttk.Label(status_frame, textvariable=self.status, width=44, anchor="e").pack(side="right")

        # Task Manager (Right Panel)
        self.progress_frame = ttk.LabelFrame(right_panel, text="Task Progress")
        self.progress_frame.pack(fill="both", expand=True, padx=0, pady=0)
        self.progress_frame_visible = True

        self._switch_mode(initial=True)
        self._switch_url_mode()

        # Enter key bindings
        for w in (mode_cb, e_unified_title, e_unified_artist):
            w.bind("<Return>", self._on_enter_search)
        self.results.bind("<Return>", self._on_enter_download)



    # ------------- Organizer (Library) -------------
    def intended_path(self, base: Path, mp3_path: Path):
        try:
            tags = EasyID3(mp3_path.as_posix())
        except Exception:
            tags = {}
        artist = (tags.get("albumartist") or tags.get("artist") or ["Unknown Artist"])[0]
        album = (tags.get("album") or ["Unknown Album"])[0]
        title = (tags.get("title") or [mp3_path.stem])[0]
        track = None
        try:
            tn = (tags.get("tracknumber") or [None])[0]
            if tn:
                tn = str(tn).split("/")[0]
                track = int(tn)
        except Exception:
            track = None
        folder = base / sanitize(artist) / sanitize(album)
        prefix = f"{track:02d} - " if isinstance(track, int) and track > 0 else ""
        dest = folder / f"{prefix}{sanitize(title)}.mp3"
        return dest

    def organize_library(self):
        base_dir = Path(self.dest.get().strip() or (Path.home()/ "Music"))
        if not base_dir.exists():
            messagebox.showerror("Folder not found", f"{base_dir}")
            return
        key = f"organize::{datetime.now().strftime('%H%M%S')}"
        self._create_task_row(key, f"[Organize] {base_dir}")
        threading.Thread(target=self._organize_worker, args=(key, base_dir), daemon=True).start()

    def _organize_worker(self, key: str, base_dir: Path):
        try:
            mp3s = list(base_dir.rglob("*.mp3"))
            # Only move those not already inside Artist/Album (>=3 parts from base)
            targets = [p for p in mp3s if len(p.relative_to(base_dir).parts) < 3]
            total = max(1, len(targets))
            for i, mp3 in enumerate(targets, start=1):
                if self.per_task.get(key, {}).get("cancel"): 
                    self._finish_task(key, "Cancelled"); 
                    return
                dest = self.intended_path(base_dir, mp3)
                dest.parent.mkdir(parents=True, exist_ok=True)
                if dest.exists():
                    k = 2
                    base_name = dest.stem
                    while True:
                        alt = dest.with_name(f"{base_name} ({k}).mp3")
                        if not alt.exists():
                            dest = alt; break
                        k += 1
                shutil.move(mp3.as_posix(), dest.as_posix())
                pct = int(i * 100 / total)
                self.after(0, lambda k=key, p=pct, d=dest: self._update_task_progress(k, p, f"[Organize] {d.name}"))
            self._finish_task(key, "Done")
        except Exception:
            logging.exception("Organizer failed")
            self._finish_task(key, "Failed")

    # ---- Enter key handlers ----
    def _on_enter_search(self, event=None):
        if self.mode_var.get() == "Song":
            self.find_song()
        else:
            self.find_album()

    def _on_enter_download(self, event=None):
        if list(self.results.curselection()):
            self.download_selected_from_db()
        else:
            self._on_enter_search()

    # ---- Task rows + cancel ----
    def _create_task_row(self, key: str, title: str):
        # Main task frame
        main_frame = ttk.Frame(self.progress_frame)
        main_frame.pack(fill="x", padx=8, pady=4)
        
        # Top row: Title and controls
        top_frame = ttk.Frame(main_frame)
        top_frame.pack(fill="x")
        
        label = ttk.Label(top_frame, text=title, width=50, anchor="w")
        label.pack(side="left")
        
        cancel_btn = ttk.Button(top_frame, text="✕", width=3, command=lambda k=key: self._cancel_task(k))
        cancel_btn.pack(side="right", padx=(6,0))
        
        pct = ttk.Label(top_frame, text="0%", width=5, anchor="e")
        pct.pack(side="right", padx=(6,0))
        
        # Progress bar
        progress_bar = ttk.Progressbar(top_frame, mode="determinate", maximum=100, length=200)
        progress_bar.pack(side="right", padx=(6,0))
        
        # Bottom row: Detailed info
        info_frame = ttk.Frame(main_frame)
        info_frame.pack(fill="x", pady=(2,0))

        log_frame = ttk.Frame(main_frame)
        log_frame.pack(fill="x", expand=True, pady=(2,0))
        log_text = tk.Text(log_frame, height=5, wrap="word", font=("TkDefaultFont", 7))
        log_text.pack(fill="x", expand=True, side="left")
        scrollbar = ttk.Scrollbar(log_frame, command=log_text.yview)
        scrollbar.pack(fill="y", side="right")
        log_text.config(yscrollcommand=scrollbar.set)

        handler = WidgetLogHandler(log_text)
        logging.getLogger().addHandler(handler)

        # Speed and file info
        speed_label = ttk.Label(info_frame, text="Speed: --", font=("TkDefaultFont", 8))
        speed_label.pack(side="left")
        
        file_info_label = ttk.Label(info_frame, text="Size: --", font=("TkDefaultFont", 8))
        file_info_label.pack(side="left", padx=(20,0))
        
        # Peer/seed info (for torrents)
        peer_info_label = ttk.Label(info_frame, text="Peers: --", font=("TkDefaultFont", 8))
        peer_info_label.pack(side="left", padx=(20,0))
        
        # ETA
        eta_label = ttk.Label(info_frame, text="ETA: --", font=("TkDefaultFont", 8))
        eta_label.pack(side="right")
        
        self.per_task[key] = {
            "main_frame": main_frame,
            "label": label, 
            "pct": pct, 
            "progress_bar": progress_bar,
            "speed_label": speed_label,
            "file_info_label": file_info_label,
            "peer_info_label": peer_info_label,
            "eta_label": eta_label,
            "log_text": log_text,
            "cancel": False, 
            "btn": cancel_btn,
            "start_time": None,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "final_path": None
        }

    def _set_task_title(self, key: str, title: str):
        t = self.per_task.get(key)
        if t:
            t["label"]["text"] = title

    def _cancel_task(self, key: str):
        t = self.per_task.get(key)
        if t:
            t["cancel"] = True
            t["btn"]["state"] = "disabled"
            t["btn"]["text"] = "✕"
            logging.info("Task flagged for cancel: %s", key)
            final_path = t.get("final_path")
            if final_path and final_path.exists():
                try:
                    final_path.unlink()
                    logging.info(f"Cleaned up partially downloaded file: {final_path}")
                except Exception as e:
                    logging.error(f"Failed to clean up file: {final_path}, error: {e}")

    def _update_task_progress(self, key: str, pct: int, subtitle: str | None = None, 
                             speed: str | None = None, file_size: str | None = None, 
                             peers: str | None = None, eta: str | None = None):
        t = self.per_task.get(key)
        if not t: return
        
        # Update percentage and progress bar
        t["pct"]["text"] = f"{int(pct)}%"
        t["progress_bar"]["value"] = max(0, min(100, pct))
        
        # Update subtitle if provided
        if subtitle: 
            t["label"]["text"] = subtitle
        
        # Update speed
        if speed:
            t["speed_label"]["text"] = f"Speed: {speed}"
        
        # Update file size info
        if file_size:
            t["file_info_label"]["text"] = f"Size: {file_size}"
        
        # Update peer/seed info
        if peers:
            t["peer_info_label"]["text"] = f"Peers: {peers}"
        
        # Update ETA
        if eta:
            t["eta_label"]["text"] = f"ETA: {eta}"
        
        t["log_text"].see(tk.END)
        
        # Initialize start time if not set
        if t["start_time"] is None:
            t["start_time"] = datetime.now()

    def _finish_task(self, key: str, status: str = "Done"):
        t = self.per_task.get(key)
        if not t: return
        if status == "Done":
            t["pct"]["text"] = "100%"
            t["progress_bar"]["value"] = 100
            t["speed_label"]["text"] = "Speed: Complete"
            t["eta_label"]["text"] = "ETA: Done"
            final_path = t.get("final_path")
            if final_path:
                open_folder_btn = ttk.Button(t["main_frame"], text="Open Folder", command=lambda p=final_path: os.startfile(p.parent))
                open_folder_btn.pack(side="right", padx=(6,0))
        t["label"]["text"] = f"{t['label']['text']} — {status}"
        t["btn"]["state"] = "disabled"
        logging.info("Task finished: %s -> %s", key, status)

    # ---- Mode + UI helpers ----
    def _switch_mode(self, initial=False):
        if self.mode_var.get() == "Song":
            self.btn_find.configure(text="Find Song", command=self.find_song)
        else:
            self.btn_find.configure(text="Find Album", command=self.find_album)
    
    def _switch_url_mode(self):
        if self.url_mode.get() == "MP3":
            self.url_audio_frame.pack(fill="x", padx=8, pady=(0, 8))
            self.url_video_frame.pack_forget()
        else:  # MP4
            self.url_video_frame.pack(fill="x", padx=8, pady=(0, 8))
            self.url_audio_frame.pack_forget()

    def choose_dest(self):
        d = filedialog.askdirectory(initialdir=self.dest.get(), title="Choose Music Folder")
        if d:
            self.dest.set(d)
            for h in list(logging.getLogger().handlers):
                logging.getLogger().removeHandler(h)
            setup_logging(Path(d))

    def ui_status(self, text): self.after(0, lambda: self.status.set(text))

    # ---- URL tab ----
    def parse_url_lines(self):
        items = []
        for ln in self.urls_text.get("1.0","end").splitlines():
            ln = ln.strip()
            if not ln: continue
            if "|" in ln:
                url, hint = ln.split("|", 1)
                items.append((url.strip(), hint.strip()))
            else:
                items.append((ln, None))
        return items

    def start_by_url(self):
        items = self.parse_url_lines()
        if not items:
            messagebox.showwarning("No URLs","Paste at least one link."); return
        threading.Thread(target=self.worker_by_url, args=(items,), daemon=True).start()

    def _url_hook(self, key: str, overall=None):
        def _hk(d):
            if self.per_task.get(key, {}).get("cancel"):
                raise KeyboardInterrupt("Task cancelled by user")
            status = d.get("status")
            if status == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes") or 0
                pct_file = int(downloaded * 100 / total) if total else 0
                pct = pct_file if overall is None else int(overall[0] + pct_file * overall[1])
                
                # Calculate speed
                speed_str = "--"
                if total and downloaded > 0:
                    task = self.per_task.get(key, {})
                    if task.get("start_time"):
                        elapsed = (datetime.now() - task["start_time"]).total_seconds()
                        if elapsed > 0:
                            speed_bps = downloaded / elapsed
                            if speed_bps > 1024*1024:  # MB/s
                                speed_str = f"{speed_bps/(1024*1024):.1f} MB/s"
                            elif speed_bps > 1024:  # KB/s
                                speed_str = f"{speed_bps/1024:.1f} KB/s"
                            else:  # B/s
                                speed_str = f"{speed_bps:.0f} B/s"
                
                # Calculate ETA
                eta_str = "--"
                if total and downloaded > 0 and pct_file > 0:
                    remaining_bytes = total - downloaded
                    if remaining_bytes > 0 and speed_bps > 0:
                        eta_seconds = remaining_bytes / speed_bps
                        if eta_seconds < 60:
                            eta_str = f"{int(eta_seconds)}s"
                        elif eta_seconds < 3600:
                            eta_str = f"{int(eta_seconds/60)}m"
                        else:
                            eta_str = f"{int(eta_seconds/3600)}h"
                
                # Format file size
                file_size_str = "--"
                if total > 0:
                    if total > 1024*1024*1024:  # GB
                        file_size_str = f"{total/(1024*1024*1024):.1f} GB"
                    elif total > 1024*1024:  # MB
                        file_size_str = f"{total/(1024*1024):.1f} MB"
                    else:  # KB
                        file_size_str = f"{total/1024:.1f} KB"
                
                self.after(0, lambda: self._update_task_progress(key, pct, 
                    speed=speed_str, file_size=file_size_str, eta=eta_str))
            elif status == "finished":
                self.after(0, lambda: self._update_task_progress(key, 100, 
                    speed="Complete", eta="Done"))
        return _hk

    def worker_by_url(self, items):
        music_root = Path(self.dest.get().strip() or (Path.home()+"Music"))
        
        for url, hint in items:
            if "youtube.com" in url or "youtu.be" in url:
                download_folder = music_root / "Youtube"
            elif "bilibili.com" in url:
                download_folder = music_root / "Bilibili"
            else:
                download_folder = music_root

            ensure_dir(download_folder)

            # Get URL-specific settings
            is_video = (self.url_mode.get() == "MP4")
            if is_video:
                video_quality = self.url_video_quality.get()
                max_kbps = None  # No audio quality limit for video downloads
            else:
                cap = self.url_max_kbps.get()
                max_kbps = None if cap == "No limit" else int(cap)
                video_quality = None
                
            logging.info("URL worker: items=%d, mode=%s, kbps=%s, video_quality=%s", 
                         len(items), self.url_mode.get(), max_kbps, video_quality)

            max_workers = min(4, len(items))
            with ThreadPoolExecutor(max_workers=max_workers) as ex:
                futs = []
                key = f"url::{url}"
                self._create_task_row(key, f"URL: {url[:80]}")
                futs.append(ex.submit(self._download_url_task, key, url, hint, download_folder, max_kbps, is_video, video_quality))
                for i, f in enumerate(as_completed(futs), start=1):
                    status, key = f.result()
                    self.after(0, lambda k=key, s=status: self._finish_task(k, s))
            self.ui_status("Done ✓")

    def _download_url_task(self, key, url, title_hint, music_root, max_kbps, is_video, video_quality=None):
        logging.info("Task start (URL): %s", url)
        try:
            base_opts = make_ydl_common(self.ff_loc, allow_playlists=True,
                                        max_abr_kbps=max_kbps, url_video_mp4=is_video, log_name=f"yt-dlp:{key}:probe",
                                        video_quality=video_quality)
            with YoutubeDL(base_opts) as ydl:
                info = ydl.extract_info(url, download=False)
            ttl = (info.get("title") or title_hint or url) if isinstance(info, dict) else (title_hint or url)
            self.after(0, lambda: self._set_task_title(key, f"[URL] {ttl}"))

            if info and info.get("_type") == "playlist" and "entries" in info:
                entries = [e for e in info["entries"] if e]
                total = len(entries) or 1
                for idx, e in enumerate(entries, start=1):
                    if self.per_task.get(key, {}).get("cancel"): return "Cancelled", key
                    base = int((idx-1) * 100 / total); scale = 1/total
                    hooks = [self._url_hook(key, overall=(base, scale))]
                    opts = make_ydl_common(self.ff_loc, self.cookies_browser.get() or None, allow_playlists=False,
                                           hooks=hooks, max_abr_kbps=max_kbps, url_video_mp4=is_video,
                                           log_name=f"yt-dlp:{key}:{idx}/{total}", video_quality=video_quality)
                    outtmpl = str(music_root / "% (title)s.%(ext)s")
                    target = e.get("webpage_url") or e.get("url")
                    info_e, used = extract_with_retries(target, opts, outtmpl=outtmpl)
                    logging.info("URL entry success via: %s", used)
                    self._finalize_one_download(info_e, title_hint, music_root, is_video=is_video)
                return "Done", key
            else:
                hooks = [self._url_hook(key)]
                opts = make_ydl_common(self.ff_loc, self.cookies_browser.get() or None, allow_playlists=False,
                                       hooks=hooks, max_abr_kbps=max_kbps, url_video_mp4=is_video,
                                       log_name=f"yt-dlp:{key}", video_quality=video_quality)
                outtmpl = str(music_root / "% (title)s.%(ext)s")
                info_one, used = extract_with_retries(url, opts, outtmpl=outtmpl)
                logging.info("URL single success via: %s", used)
                ttl2 = info_one.get("title") or ttl
                self.after(0, lambda: self._set_task_title(key, f"[URL] {ttl2}"))
                final_path = music_root / f"{info_one.get('title')}.{info_one.get('ext')}"
                self.per_task[key]["final_path"] = final_path
                self._finalize_one_download(info_one, title_hint, music_root, is_video=is_video)
                return "Done", key
        except KeyboardInterrupt:
            logging.info("Task cancelled (URL): %s", url); return "Cancelled", key
        except DownloadError as de:
            logging.exception("DownloadError (URL): %s", url); return "Failed", key
        except Exception:
            logging.exception("Unhandled error (URL): %s", url); return "Failed", key

    def _finalize_one_download(self, info_entry, title_hint, music_root: Path, is_video: bool = False):
        paths = _resolve_downloaded_paths(info_entry, music_root)
        yt_title = info_entry.get("title") or "Untitled"

        if is_video:
            for p in paths:
                if p.suffix.lower() in (".mp4",".mkv",".webm"):
                    produced = p; break
            else:
                vids = list(music_root.glob("*.mp4")) + list(music_root.glob("*.mkv")) + list(music_root.glob("*.webm"))
                if not vids: raise FileNotFoundError("Output video not found after download.")
                produced = max(vids, key=lambda p: p.stat().st_mtime)

            artist_hint = info_entry.get("uploader") or info_entry.get("channel") or "Videos"
            album_hint = info_entry.get("playlist_title") or "Downloads"
            title = title_hint.strip() if title_hint else yt_title
            folder = Path(self.dest.get()) / sanitize(artist_hint) / sanitize(album_hint)
            ensure_dir(folder)
            final_path = folder / f"{sanitize(title)}{produced.suffix}"
            if final_path.exists():
                k=2
                while True:
                    alt = folder / f"{sanitize(title)} ({k}){produced.suffix}"
                    if not alt.exists(): final_path = alt; break
                    k+=1
            logging.info("Move video %s -> %s", produced, final_path)
            produced.replace(final_path)
            self.ui_status(f"Saved: {final_path.name}")
            return

        produced = None
        for p in paths:
            if p.suffix.lower() == ".mp3":
                produced = p; break
        if not produced:
            for p in paths:
                if p.suffix.lower() in (".m4a",".webm",".opus",".mp4"):
                    produced = ensure_mp3_from_any(p, self.ff_loc, music_root); break
        if not produced:
            mp3s = list(music_root.glob("*.mp3"))
            if mp3s: produced = max(mp3s, key=lambda p: p.stat().st_mtime)
        if not produced:
            raise FileNotFoundError("Output MP3 not found after download/transcode.")

        meta = None; cover_bytes = None
        if self.use_mb.get():
            meta = build_mb_tags(info_entry, title_hint)
            if meta and meta.get("release_id"):
                cover_bytes = fetch_cover_from_caa(meta["release_id"])
        if not meta:
            artist_hint = info_entry.get("artist") or info_entry.get("uploader") or info_entry.get("channel") or "Unknown Artist"
            album_hint = info_entry.get("album") or info_entry.get("playlist_title") or "Unknown Album"
            year_hint = info_entry.get("release_year") or (info_entry.get("upload_date") or "")[:4] or str(datetime.now().year)
            meta = {"artist": artist_hint, "album": album_hint, "year": year_hint, "track": None,
                    "title": title_hint.strip() if title_hint else clean_title_for_search(yt_title)}
        if not cover_bytes:
            cover_bytes = fetch_cover_from_wikipedia(meta.get("album"), meta.get("artist")) or fetch_thumbnail_bytes(info_entry)
        self._move_and_tag(produced, meta, info_entry, cover_override=cover_bytes)

    def _move_and_tag(self, produced_path: Path, meta: dict, source_info: dict | None, cover_override: bytes | None = None):
        album_artist = meta.get("artist") or "Unknown Artist"
        album = meta.get("album") or "Unknown Album"
        year = meta.get("year"); track = meta.get("track")
        title = meta.get("title") or produced_path.stem

        folder = Path(self.dest.get()) / sanitize(album_artist) / sanitize(album)
        ensure_dir(folder)
        prefix = f"{int(track):02d} - " if isinstance(track, int) and track > 0 else ""
        final_path = folder / f"{prefix}{sanitize(title)}.mp3"
        if final_path.exists():
            k = 2
            while True:
                alt = folder / f"{prefix}{sanitize(title)} ({k}).mp3"
                if not alt.exists(): final_path = alt; break
                k += 1
        logging.info("Move audio %s -> %s", produced_path, final_path)
        produced_path.replace(final_path)

        cover = cover_override if cover_override else fetch_thumbnail_bytes(source_info or {})
        try:
            tag_mp3(final_path, title=title, artist=album_artist, album=album,
                    album_artist=album_artist, track_number=track, year=year, cover_bytes=cover)
        except Exception:
            logging.exception("Tagging failed for %s", final_path)
        self.ui_status(f"Saved: {final_path.name}")

    # ---- Search tab actions ----
    def find_song(self):
        title = self.unified_title.get().strip() or None
        artist = self.unified_artist.get().strip() or None
        if not (title or artist):
            messagebox.showwarning("Missing", "Enter an Artist, or Artist + Title."); return
        self.results.delete(0, "end"); self.result_items.clear()
        self.ui_status("Searching MusicBrainz for song…")
        logging.info("Find song: title=%s artist=%s", title, artist)
        recs = mb_search_recordings(title, artist, None, limit=40)
        if not recs:
            self.ui_status("No results."); return
        for r in recs:
            ac = r.get("artist-credit-phrase") or ""
            ttl = r.get("title") or ""
            rels = r.get("release-list", []) or []
            alb = rels[0].get("title") if rels else ""
            date = (rels[0].get("date") or "") if rels else ""
            line = f"[Song] {ttl} — {ac}    [{alb} {date}]"
            self.results.insert("end", line)
            self.result_items.append({"type":"recording","rec":r})
        self.ui_status(f"{len(recs)} song result(s). Select and Download.")

    def find_album(self):
        album = self.unified_title.get().strip() or None
        artist = self.unified_artist.get().strip() or None
        if not (album or artist):
            messagebox.showwarning("Missing", "Enter an Artist, or Artist + Album."); return
        self.results.delete(0, "end"); self.result_items.clear()
        self.ui_status("Searching MusicBrainz for album…")
        logging.info("Find album: album=%s artist=%s", album, artist)
        rels = mb_search_albums(album, artist, limit=40)
        if not rels:
            self.ui_status("No results."); return
        for r in rels:
            alb = r.get("title") or ""
            ac = r.get("artist-credit-phrase") or ""
            date = r.get("date") or ""
            line = f"[Album] {alb} — {ac}    [{date}]"
            self.results.insert("end", line)
            self.result_items.append({"type":"album","rel":r})
        self.ui_status(f"{len(rels)} album result(s). Select and Download.")

    def download_selected_from_db(self):
        sel = list(self.results.curselection())
        if not sel:
            messagebox.showwarning("No selection","Select at least one item."); return
        threading.Thread(target=self.worker_from_db, args=(sel,), daemon=True).start()

    def _db_hook(self, key: str, idx: int, total: int):
        base = int((idx-1)*100/total); scale = 1/total
        def _hk(d):
            if self.per_task.get(key, {}).get("cancel"):
                raise KeyboardInterrupt("Task cancelled by user")
            status = d.get("status")
            if status == "downloading":
                total_b = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                dl = d.get("downloaded_bytes") or 0
                pct_file = int(dl*100/total_b) if total_b else 0
                pct = int(base + pct_file*scale)
                
                # Calculate speed and other info (similar to URL hook)
                speed_str = "--"
                if total_b and dl > 0:
                    task = self.per_task.get(key, {})
                    if task.get("start_time"):
                        elapsed = (datetime.now() - task["start_time"]).total_seconds()
                        if elapsed > 0:
                            speed_bps = dl / elapsed
                            if speed_bps > 1024*1024:
                                speed_str = f"{speed_bps/(1024*1024):.1f} MB/s"
                            elif speed_bps > 1024:
                                speed_str = f"{speed_bps/1024:.1f} KB/s"
                            else:
                                speed_str = f"{speed_bps:.0f} B/s"
                
                # File size
                file_size_str = "--"
                if total_b > 0:
                    if total_b > 1024*1024*1024:
                        file_size_str = f"{total_b/(1024*1024*1024):.1f} GB"
                    elif total_b > 1024*1024:
                        file_size_str = f"{total_b/(1024*1024):.1f} MB"
                    else:
                        file_size_str = f"{total_b/1024:.1f} KB"
                
                # ETA
                eta_str = "--"
                if total_b and dl > 0 and pct_file > 0:
                    remaining_bytes = total_b - dl
                    if remaining_bytes > 0 and speed_bps > 0:
                        eta_seconds = remaining_bytes / speed_bps
                        if eta_seconds < 60:
                            eta_str = f"{int(eta_seconds)}s"
                        elif eta_seconds < 3600:
                            eta_str = f"{int(eta_seconds/60)}m"
                        else:
                            eta_str = f"{int(eta_seconds/3600)}h"
                
                self.after(0, lambda: self._update_task_progress(key, pct, 
                    speed=speed_str, file_size=file_size_str, eta=eta_str))
            elif status == "finished":
                pct = int(idx*100/total)
                self.after(0, lambda: self._update_task_progress(key, pct, 
                    speed="Complete", eta="Done"))
        return _hk

    def worker_from_db(self, sel_indices):
        music_root = Path(self.dest.get().strip() or (Path.home()+"Music"))
        ensure_dir(music_root)
        cap = self.max_kbps.get(); max_kbps = None if cap == "No limit" else int(cap)
        logging.info("DB worker: items=%d, kbps=%s", len(sel_indices), cap)
        max_workers = min(4, len(sel_indices))
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futs = []
            for idx in sel_indices:
                item = self.result_items[idx]
                key = f"db::{idx}"
                if item["type"] == "recording":
                    title = item["rec"].get("title") or "Song"
                    artist = item["rec"].get("artist-credit-phrase") or ""
                    self._create_task_row(key, f"[Song] {artist} - {title}")
                else:
                    alb = item["rel"].get("title") or "Album"
                    art = item["rel"].get("artist-credit-phrase") or ""
                    self._create_task_row(key, f"[Album] {art} — {alb}")
                futs.append(ex.submit(self._download_db_item, key, item, music_root, max_kbps))
            for i, f in enumerate(as_completed(futs), start=1):
                status, key = f.result()
                self.after(0, lambda k=key, s=status: self._finish_task(k, s))
        self.ui_status("Done ✓")

    def _download_db_item(self, key: str, item, music_root: Path, max_kbps: int | None):
        try:
            if item["type"] == "recording":
                r_basic = item["rec"]; rec_id = r_basic.get("id")
                r = mb_get_recording_details(rec_id) if rec_id else None
                if not r: raise RuntimeError("Could not fetch recording details from MusicBrainz.")
                ttl = r.get("title") or ""; artist = r.get("artist-credit-phrase") or ""
                chosen = None
                for rel in r.get("release-list", []) or []:
                    if "medium-list" in rel: chosen = rel; break
                if not chosen:
                    rels = r.get("release-list", []); chosen = rels[0] if rels else {}
                album = chosen.get("title") or "Unknown Album"
                year = (chosen.get("date") or "")[:4] or None
                track_no = None
                if chosen:
                    for med in chosen.get("medium-list", []):
                        for tr in med.get("track-list", []):
                            if tr.get("recording", {}).get("id") == r.get("id"):
                                try: track_no = int(tr.get("position"))
                                except: track_no = None
                                break
                self.after(0, lambda: self._set_task_title(key, f"[Song] {artist} - {ttl}"))

                hooks = [self._db_hook(key, 1, 1)]
                base_opts = make_ydl_common(self.ff_loc, allow_playlists=False,
                                            hooks=hooks, max_abr_kbps=max_kbps, url_video_mp4=False,
                                            log_name=f"yt-dlp:{key}")
                outtmpl = str(music_root / "% (title)s.%(ext)s")
                info, used = extract_with_retries(f"ytsearch1:{artist} - {ttl} audio", base_opts, outtmpl=outtmpl)
                logging.info("DB song success via: %s", used)
                produced, entry = yt_first_match(f"{artist} - {ttl}", base_opts, music_root, is_video=False, ff_loc=self.ff_loc)
                final_path = music_root / f"{artist} - {ttl}.mp3"
                self.per_task[key]["final_path"] = final_path
                cover = fetch_cover_from_caa(chosen.get("id")) or fetch_cover_from_wikipedia(album, artist) or fetch_thumbnail_bytes(entry if isinstance(entry, dict) else info)
                meta = {"title": ttl, "artist": artist, "album": album, "year": year, "track": track_no}
                self._move_and_tag(produced, meta, entry if isinstance(entry, dict) else info, cover_override=cover)
                return "Done", key

            elif item["type"] == "album":
                rel = item["rel"]; rel_id = rel["id"]
                tracks, album, album_artist, year = mb_get_release_tracks(rel_id)
                cover = fetch_cover_from_caa(rel_id) or fetch_cover_from_wikipedia(album, album_artist)
                total = max(1, len(tracks))
                self.after(0, lambda: self._set_task_title(key, f"[Album] {album_artist} — {album}"))
                for i, t in enumerate(tracks, start=1):
                    if self.per_task.get(key, {}).get("cancel"): return "Cancelled", key
                    ttl = t["title"]; art = t["artist"] or album_artist
                    pos = t["pos"]; yr = t["year"] or year
                    hooks = [self._db_hook(key, i, total)]
                    base_opts = make_ydl_common(self.ff_loc, self.cookies_browser.get() or None, allow_playlists=False,
                                                hooks=hooks, max_abr_kbps=max_kbps, url_video_mp4=False,
                                                log_name=f"yt-dlp:{key}:{i}/{total}")
                    produced, entry = yt_first_match(f"{art} - {ttl}", base_opts, music_root, is_video=False, ff_loc=self.ff_loc)
                    cbytes = cover or fetch_thumbnail_bytes(entry if isinstance(entry, dict) else {})
                    meta = {"title": ttl, "artist": art, "album": album, "year": yr, "track": pos}
                    self._move_and_tag(produced, meta, entry if isinstance(entry, dict) else {}, cover_override=cbytes)
                return "Done", key
        except KeyboardInterrupt:
            logging.info("Task cancelled (DB): %s", key); return "Cancelled", key
        except DownloadError as de:
            logging.exception("DownloadError (DB): %s", key); return "Failed", key
        except Exception:
            logging.exception("Unhandled error (DB): %s", key); return "Failed", key


    
    def _parse_size_to_bytes(self, size_str):
        """Convert size string like '2.1 GB' to bytes"""
        try:
            size_str = size_str.upper().replace(' ', '')
            if 'GB' in size_str:
                return float(size_str.replace('GB', '')) * 1024 * 1024 * 1024
            elif 'MB' in size_str:
                return float(size_str.replace('MB', '')) * 1024 * 1024
            elif 'KB' in size_str:
                return float(size_str.replace('KB', '')) * 1024
            else:
                return float(size_str)
        except:
            return 2 * 1024 * 1024 * 1024  # Default 2GB
    
    def open_torrent_file(self):
        file_path = filedialog.askopenfilename(
            title="Select Torrent File",
            filetypes=[("Torrent files", "*.torrent"), ("All files", "*.*")]
        )
        if file_path:
            # In real implementation, you would open the torrent file with a torrent client
            messagebox.showinfo("Torrent File", f"Opening torrent file: {file_path}")
            logging.info("Opening torrent file: %s", file_path)
    
    def open_magnet_link(self):
        magnet_link = tk.simpledialog.askstring("Magnet Link", "Enter magnet link:")
        if magnet_link:
            # In real implementation, you would open the magnet link with a torrent client
            messagebox.showinfo("Magnet Link", f"Opening magnet link: {magnet_link[:50]}...")
            logging.info("Opening magnet link: %s", magnet_link)

# helper for URL tagging
def build_mb_tags(yt_info: dict, title_hint: str | None):
    raw_title = yt_info.get("title") or "Untitled"
    title_for_search = clean_title_for_search(title_hint or raw_title)
    artist_hint = yt_info.get("artist") or yt_info.get("uploader") or yt_info.get("channel")
    try:
        recs = mb.search_recordings(recording=title_for_search, artist=artist_hint, limit=5)
        recs = recs.get("recording-list", [])
    except Exception:
        recs = []
    if not recs: return None
    rec = max(recs, key=lambda r: int(r.get("ext:score", "0")))
    rec_id = rec.get("id")
    if not rec_id: return None
    try:
        details = mb.get_recording_by_id(rec_id, includes=["releases","artist-credits","media"]).get("recording")
    except Exception:
        return None
    releases = details.get("release-list", []) or []
    chosen = None
    if releases:
        def score(rel):
            t = (rel.get("title") or "").lower()
            date = (rel.get("date") or "9999")[:4]
            try: y = int(date)
            except: y = 9999
            has_tracks = 1 if "medium-list" in rel else 0
            is_comp = 1 if ("greatest hits" in t or "best of" in t or "精选" in t) else 0
            return (has_tracks, -is_comp, -(9999-y))
        chosen = sorted(releases, key=score, reverse=True)[0]
    album = chosen.get("title") if chosen else None
    date = chosen.get("date") if chosen else None
    year = date[:4] if date else None
    artist_phrase = details.get("artist-credit-phrase") or artist_hint
    track_no = None
    if chosen:
        for med in chosen.get("medium-list", []):
            for tr in med.get("track-list", []):
                if tr.get("recording", {}).get("id") == details.get("id"):
                    try: track_no = int(tr.get("position"))
                    except Exception: track_no = None
                    break
    return {"artist": artist_phrase, "album": album, "year": year, "track": track_no,
            "title": title_hint.strip() if title_hint else clean_title_for_search(raw_title),
            "release_id": chosen.get("id") if chosen else None}

if __name__ == "__main__":
    App().mainloop()
