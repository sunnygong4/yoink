Yoinker - A tool for downloading music and videos from various sources.

## About

Yoinker is a Python application that allows you to download music and videos from various sources, including YouTube and Bilibili. It also includes a song downloader that uses the MusicBrainz database to find and download songs.

## Files

- `yoinker.py` The main application file.
- `setup.py`: A Python script that installs Python, all required libraries, and ffmpeg.
- `yoinker.bat`: A batch script that runs the `setup.py` script and the `yoinker.py` script in order.
- `README.md`: This file.

## Installation
 
To install and run Yoinker, simply run the `yoinker.bat` script. This will automatically run the setup script and then start the application.

Alternatively, you can run the scripts manually:

1.  Run `python setup.py` to install all dependencies.
2.  Run `python yoinker.py` to start the application.

## Usage

Once the application is running, you can use the following features:

- **Song Downloader**: Search for and download songs from the MusicBrainz database.
- **Download from Youtube/Bilibili**: Download videos and audio from YouTube and Bilibili.
