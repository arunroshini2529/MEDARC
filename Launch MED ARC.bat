@echo off
set "NODE=C:\Users\Arun\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "APP_DIR=%~dp0"
start "MED ARC local app server" /min "%NODE%" "%APP_DIR%app-server.cjs"
timeout /t 2 /nobreak >nul
start "MED ARC" msedge --app=http://127.0.0.1:4177/
