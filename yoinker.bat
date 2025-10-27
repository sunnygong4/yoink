@echo off

echo Running install_all.bat...
call install_all.bat

echo Running prepare_ffmpeg.py...
python prepare_ffmpeg.py

echo Running yoinker.py...
python yoinker.py
