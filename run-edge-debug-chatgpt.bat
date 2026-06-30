@echo off
setlocal

set EDGE=
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

if not defined EDGE (
  echo Microsoft Edge was not found.
  pause
  exit /b 1
)

echo Close all Edge windows first if the program cannot connect to your current ChatGPT tab.
echo Opening Edge with remote debugging on port 9222...
start "" "%EDGE%" --remote-debugging-port=9222 --remote-allow-origins=* "https://chatgpt.com/"
