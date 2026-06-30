@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js LTS first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto fail
)

if not exist "%LOCALAPPDATA%\ms-playwright" (
  echo Installing Playwright Chromium...
  call npm.cmd run setup
  if errorlevel 1 goto fail
)

start "" "http://localhost:3737"
call npm.cmd start
exit /b 0

:fail
echo Failed. Check the error above.
pause
exit /b 1
