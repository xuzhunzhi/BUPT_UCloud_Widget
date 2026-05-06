@echo off
REM Helper: bupt-hw.cmd login | fetch | widget  （须在仓库根目录）
cd /d "%~dp0"
if exist "%~dp0.venv\Scripts\python.exe" (
  "%~dp0.venv\Scripts\python.exe" "%~dp0python\app.py" %*
) else (
  python "%~dp0python\app.py" %*
)
