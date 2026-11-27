@echo off
chcp 65001 >nul
cd /d "%~dp0app"
echo Altin Saat: http://localhost:4319
start "" http://localhost:4319
python -m http.server 4319
