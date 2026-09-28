@echo off
rem Double-click to start KeyFall on Windows and open it in the browser.
rem Always uses http://localhost:5173 - the browser's LUMI (MIDI/SysEx) permission belongs to that exact address.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing KeyFall's dependencies the first time - this takes a minute...
  call npm install
)
echo KeyFall is running at http://localhost:5173 - close this window to stop it.
call npm start
pause
