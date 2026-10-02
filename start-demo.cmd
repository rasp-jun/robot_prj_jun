@echo off
setlocal
cd /d "%~dp0monitoring-twin"
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  if errorlevel 1 goto error
)
".venv\Scripts\python.exe" -c "import fastapi, uvicorn, websockets" >nul 2>&1
if errorlevel 1 (
  ".venv\Scripts\python.exe" -m pip install --no-cache-dir -r requirements.txt
  if errorlevel 1 goto error
)
set MT_SOURCE=mock
set MT_SCENARIO=normal
set MT_SPEED=1
set MT_DB=data/demo.db
echo.
echo LINE / TWIN - Simulation
echo Open http://127.0.0.1:8000 in your browser.
echo Press Ctrl+C to stop.
echo.
".venv\Scripts\python.exe" -m uvicorn server.main:app --host 127.0.0.1 --port 8000
if errorlevel 1 goto error
exit /b 0
:error
echo.
echo Could not start the simulator. Check the error above.
pause
exit /b 1

