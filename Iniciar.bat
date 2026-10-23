@echo off
title Sleks Descargador
cd /d "%~dp0"

rem Si Python no tiene yt-dlp, lo instala antes de arrancar (solo la primera vez).
py -c "import yt_dlp" >nul 2>nul
if errorlevel 1 (
  echo Instalando yt-dlp, esto pasa una sola vez...
  py -m pip install --user -U "yt-dlp[default]"
  echo.
)

start "" "http://127.0.0.1:5757"
node server.js
pause
