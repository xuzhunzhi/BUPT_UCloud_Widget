@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] .venv not found. Run: python -m venv .venv
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m playwright install chromium
echo.
pause
