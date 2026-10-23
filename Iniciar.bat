@echo off
title Sleks Descargador
cd /d "%~dp0"
start "" "http://127.0.0.1:5757"
node server.js
pause
