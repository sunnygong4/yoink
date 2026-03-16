import os
import sys
from pathlib import Path

sys.path.append(os.path.join(os.path.dirname(__file__)))

from app.core.bootstrap import ensure_repo_root_on_path

ensure_repo_root_on_path()

from yoinker_core import DownloadOptions, download_url


def test_download():
    output_dir = Path("media") / "manual-test"
    output_dir.mkdir(parents=True, exist_ok=True)

    query = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    print(f"Attempting to download: {query}")
    print(f"Output directory: {output_dir.absolute()}")

    try:
        items = download_url(
            DownloadOptions(
                url=query,
                output_dir=output_dir,
                mode="audio",
                allow_playlist=False,
                audio_bitrate_kbps=192,
            )
        )
        print("Download SUCCESS!")
        for item in items:
            print(item)
    except Exception as e:
        print("Download FAILED!")
        print(f"Error type: {type(e)}")
        print(f"Error message: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    test_download()
